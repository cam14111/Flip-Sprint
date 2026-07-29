// End-to-end test of the online mode against the Firebase emulators.
//
// Boots Auth + Realtime Database (with the real security rules) and a Vite
// server, then drives real Chromium pages — real "phones" — through real UI
// interactions: create, share the code, join, auto-start, play a full race,
// refresh mid-race, and check that every device agrees on the board.
//
//   npm run e2e:online
//
// Requires Java (the database emulator) and Chromium via Playwright.

import { spawn } from "node:child_process";
import process from "node:process";
import { chromium } from "playwright";
import { emulatorEnv, startEmulators, waitForHttp } from "./emulators.mjs";

const VITE_PORT = 8123;
const BASE = `http://127.0.0.1:${VITE_PORT}/`;

let passed = 0;
const failures = [];
const check = (ok, label) => {
  if (ok) {
    passed++;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.error(`  FAIL ${label}`);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls until `read` returns something truthy, or gives up. */
const until = async (read, timeoutMs = 20_000, step = 250) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read().catch(() => null);
    if (value) return value;
    await sleep(step);
  }
  return null;
};

const main = async () => {
  console.log("démarrage des émulateurs…");
  const emulators = await startEmulators();

  console.log("démarrage du serveur de développement…");
  const vite = spawn(
    "npx",
    ["vite", "--port", String(VITE_PORT), "--host", "127.0.0.1"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      env: { ...emulatorEnv(), VITE_FIREBASE_EMULATORS: "1" },
    }
  );
  const stopVite = () => {
    try {
      process.kill(-vite.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  };

  let browser;
  try {
    await waitForHttp(BASE, 90_000);

    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
    });

    /** One phone. Each gets its own context so the anonymous uids differ. */
    const openPhone = async (label) => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      page.on("pageerror", (e) =>
        failures.push(`${label}: erreur de page — ${e.message}`)
      );
      return { label, context, page };
    };

    const host = await openPhone("hôte");
    const guest = await openPhone("invité");

    // ---- Create -----------------------------------------------------------
    console.log("\ncréation du salon");
    await host.page.goto(BASE, { waitUntil: "networkidle" });
    await host.page.evaluate(() => localStorage.clear());
    await host.page.reload({ waitUntil: "networkidle" });
    await host.page.getByRole("button", { name: "En ligne" }).click();
    await host.page.getByRole("button", { name: /Jouer/ }).click();

    // Two seats, so the race starts as soon as the guest sits down.
    await host.page.getByTestId("seats-2").click();
    check(
      (await host.page.getByTestId("seats-2").getAttribute("aria-pressed")) === "true",
      "le salon est réglé sur 2 places"
    );
    await host.page.getByRole("button", { name: "Créer une partie" }).click();

    const code = await until(async () => {
      const text = await host.page.getByTestId("game-code").textContent();
      return text && /^[A-Z0-9]{6}$/.test(text.trim()) ? text.trim() : null;
    }, 30_000);
    check(!!code, `un code à 6 caractères est généré (${code})`);
    if (!code) throw new Error("pas de code — impossible de continuer");

    // ---- Join -------------------------------------------------------------
    console.log("\narrivée de l'invité");
    await guest.page.goto(`${BASE}?join=${code}`, { waitUntil: "networkidle" });

    // Either both seats fill (and we can see it), or the race has already
    // started — the auto-start can be quicker than this poll.
    const bothSeated = await until(async () => {
      const empty = await host.page
        .locator('[data-testid="seat-row"][data-filled="no"]')
        .count();
      const playing = await host.page
        .getByRole("button", { name: "Accélérer" })
        .count();
      return empty === 0 || playing > 0;
    }, 30_000);
    check(!!bothSeated, "les deux sièges se remplissent dans le salon");

    // ---- Auto-start -------------------------------------------------------
    console.log("\ndémarrage automatique");
    const started = await until(
      async () =>
        (await host.page.getByRole("button", { name: "Accélérer" }).count()) > 0,
      30_000
    );
    check(!!started, "la course démarre dès que le salon est plein");

    // Exactly one phone is asked to act; the other is told to wait. Polled
    // rather than slept on: the two devices sync independently.
    const waitCounts = async () => [
      await host.page.getByTestId("waiting-for").count(),
      await guest.page.getByTestId("waiting-for").count(),
    ];
    const oneActs = await until(async () => {
      const [h, g] = await waitCounts();
      return h + g === 1;
    }, 20_000);
    if (!oneActs) {
      const [h, g] = await waitCounts();
      const text = (await guest.page.textContent("body")) ?? "";
      console.error(`      diagnostic : attente hôte=${h}, invité=${g}`);
      console.error(
        `      écran de l'invité : ${text.replace(/\s+/g, " ").slice(0, 340)}`
      );
    }
    check(!!oneActs, "un seul appareil a la main, l'autre attend");

    // ---- Play -------------------------------------------------------------
    console.log("\ndéroulement de la course");
    const phones = [host, guest];

    /** Plays whichever phone currently has the initiative. */
    const playOneMove = async () => {
      for (const phone of phones) {
        const target = phone.page
          .locator('[role="button"][aria-label^="Choisir"]')
          .first();
        if (await target.count()) {
          await target.click();
          return true;
        }
        const go = phone.page.getByRole("button", { name: "Accélérer" });
        if (await go.isEnabled().catch(() => false)) {
          const risk = Number(
            (await phone.page
              .locator('[role="meter"]')
              .getAttribute("aria-valuenow")
              .catch(() => "0")) ?? 0
          );
          const stay = phone.page.getByRole("button", { name: "Souffler" });
          if (risk > 28 && (await stay.isEnabled().catch(() => false))) {
            await stay.click();
          } else {
            await go.click();
          }
          return true;
        }
      }
      return false;
    };

    let moves = 0;
    let raceScored = false;
    for (let step = 0; step < 160 && !raceScored; step++) {
      const next = phones[0].page.getByRole("button", { name: "Course suivante" });
      if (await next.count()) {
        raceScored = true;
        break;
      }
      if (await playOneMove()) {
        moves++;
        await sleep(250);
      } else {
        await sleep(250);
      }
    }
    check(moves > 4, `des coups ont été joués de part et d'autre (${moves})`);
    check(raceScored, "la course va jusqu'à son décompte");

    // ---- Both devices agree ----------------------------------------------
    console.log("\ncohérence entre appareils");
    const readRecap = async (page) => {
      const rows = await page
        .locator('[role="dialog"] .tabular-nums')
        .allTextContents();
      return rows.join("|");
    };
    const hostRecap = await readRecap(host.page);
    const guestRecap = await until(async () => {
      const text = await readRecap(guest.page);
      return text && text === hostRecap ? text : null;
    }, 15_000);
    check(
      !!guestRecap,
      "les deux appareils affichent exactement le même décompte"
    );

    // ---- Refresh mid-game -------------------------------------------------
    console.log("\nreprise après rafraîchissement");
    await guest.page.reload({ waitUntil: "networkidle" });
    const resumed = await until(
      async () => (await guest.page.getByText(/Fin de course/).count()) > 0,
      30_000
    );
    check(!!resumed, "un rafraîchissement ramène l'invité dans sa course");
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    stopVite();
    emulators.stop();
  }

  console.log(`\n${passed} vérifications passées, ${failures.length} échec(s)`);
  if (failures.length > 0) {
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }
};

await main();
