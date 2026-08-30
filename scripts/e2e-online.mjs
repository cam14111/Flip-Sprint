// End-to-end test of the online mode.
//
// Drives real Chromium pages — real "phones" — through real UI interactions:
// create, share the code, join, auto-start, play a full race, refresh
// mid-race, chain into the next race, and abandon. Checks that every device
// agrees on the board throughout.
//
//   npm run e2e:online          # against the Firebase emulators (default)
//   npm run e2e:online -- --live  # against the REAL project
//
// The emulator run needs Java. The live run needs the rules deployed, writes
// a handful of records to the real database, and deletes them on the way out.
// Both need Chromium via Playwright.

import { spawn } from "node:child_process";
import process from "node:process";
import { chromium } from "playwright";
import { emulatorEnv, startEmulators, waitForHttp } from "./emulators.mjs";

const LIVE = process.argv.includes("--live");
// `--coups-bas` runs the whole race under the variant's rules: a different
// deck, a different wire action, and a different set of database rules.
const COUPS_BAS = process.argv.includes("--coups-bas");
const VITE_PORT = 8123;
const BASE = `http://127.0.0.1:${VITE_PORT}/`;

// The two runners are named apart so a check can tell whose lane it is looking
// at. Fourteen characters is the field's limit.
const HOST_NAME = "Hote";
const GUEST_NAME = "Invite";

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
  let emulators = { stop: () => {} };
  if (LIVE) {
    console.log("cible : PROJET RÉEL (les règles doivent y être déployées)");
  } else {
    console.log("démarrage des émulateurs…");
    emulators = await startEmulators();
  }

  console.log("démarrage du serveur de développement…");
  const viteEnv = LIVE
    ? { ...process.env }
    : { ...emulatorEnv(), VITE_FIREBASE_EMULATORS: "1" };
  const vite = spawn(
    "npx",
    ["vite", "--port", String(VITE_PORT), "--host", "127.0.0.1"],
    { stdio: ["ignore", "pipe", "pipe"], detached: true, env: viteEnv }
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
      // Reaching the real Firebase means going through the sandbox proxy;
      // the local dev server and emulators must bypass it.
      proxy:
        LIVE && process.env.HTTPS_PROXY
          ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" }
          : undefined,
    });

    /** One phone. Each gets its own context so the anonymous uids differ. */
    const openPhone = async (label, runner) => {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      page.on("pageerror", (e) =>
        failures.push(`${label}: erreur de page — ${e.message}`)
      );
      // Upkeep writes report themselves; surface them so a stalled table
      // comes with its reason rather than a mystery.
      page.on("console", (m) => {
        const text = m.text();
        if (text.includes("[flip-sprint]")) {
          console.error(`      ${label} → ${text.slice(0, 220)}`);
        }
      });
      return { label, runner, context, page };
    };

    const host = await openPhone("hôte", HOST_NAME);
    const guest = await openPhone("invité", GUEST_NAME);

    // ---- Create -----------------------------------------------------------
    console.log(`\ncréation du salon (${COUPS_BAS ? "Coups bas" : "classique"})`);
    await host.page.goto(BASE, { waitUntil: "networkidle" });
    await host.page.evaluate(() => localStorage.clear());
    await host.page.reload({ waitUntil: "networkidle" });
    // Distinct names, so the checks below can tell the two phones' lanes apart
    // — left to the default, both runners would be called "Toi".
    await host.page.getByPlaceholder("Toi").fill(HOST_NAME);
    await host.page.getByRole("button", { name: "En ligne" }).click();
    if (COUPS_BAS) {
      await host.page.getByRole("button", { name: "Coups bas", exact: true }).click();
    }
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
    // The invite link goes straight to the board, so the name has to be set on
    // the home screen first — it is read from this device's own settings.
    await guest.page.goto(BASE, { waitUntil: "networkidle" });
    await guest.page.evaluate(() => localStorage.clear());
    await guest.page.reload({ waitUntil: "networkidle" });
    await guest.page.getByPlaceholder("Toi").fill(GUEST_NAME);
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

    // Each phone keeps its own lane at the bottom of the screen, including —
    // and especially — the one that is only watching. Anything else means your
    // cards jump into the rivals' strip the moment somebody else acts.
    //
    // The lane pinned at the bottom is the last one in the document; a lane
    // names its runner in its aria-label, under either of the two wordings it
    // takes (plain, or offered as a target).
    const bottomName = async (page) => {
      // Lanes only. A card offered for a Relais or an Aspiration answers to
      // "Choisir" too, but it is a plain <button> — a lane carries the role
      // attribute explicitly, which is what tells the two apart here.
      const labels = await page
        .locator('[aria-label^="Couloir de "], [role="button"][aria-label^="Choisir "]')
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getAttribute("aria-label") ?? "")
        );
      return (labels.at(-1) ?? "")
        .replace(/^Couloir de /, "")
        .replace(/^Choisir /, "");
    };
    const bottomIsMine = async (phone) =>
      (await bottomName(phone.page)) === phone.runner;
    check(
      (await bottomIsMine(host)) && (await bottomIsMine(guest)),
      "chaque appareil garde son propre couloir en bas, même en attendant"
    );

    // ---- Play -------------------------------------------------------------
    console.log("\ndéroulement de la course");
    const phones = [host, guest];

    /** Plays whichever phone currently has the initiative. */
    const playOneMove = async () => {
      for (const phone of phones) {
        const target = phone.page.locator('[aria-label^="Choisir"]').first();
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
    let anchorBreaks = 0;
    for (let step = 0; step < 160 && !raceScored; step++) {
      const next = phones[0].page.getByRole("button", { name: "Course suivante" });
      if (await next.count()) {
        raceScored = true;
        break;
      }
      // The anchoring has to hold at every point of the race, not just at the
      // start: the initiative changes hands on almost every move.
      for (const phone of phones) {
        if (!(await bottomIsMine(phone))) anchorBreaks++;
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
    check(
      anchorBreaks === 0,
      `le couloir du bas ne bouge jamais pendant la course (${anchorBreaks} écart(s))`
    );

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

    // ---- Next-race handshake ---------------------------------------------
    console.log("\nenchaînement des courses");
    await host.page.getByRole("button", { name: "Course suivante" }).click();
    const hostWaits = await until(
      async () =>
        (await host.page.getByText("En attente des autres").count()) > 0,
      15_000
    );
    check(!!hostWaits, "la course suivante attend que tout le monde soit prêt");

    await guest.page.getByRole("button", { name: "Course suivante" }).click();

    // The new race is dealt when the recap is gone on both devices and exactly
    // one of them has the initiative again. Checking for the "Accélérer"
    // buttons on a *given* phone would be wrong: the opening card of a course
    // moves one seat along, so the host may legitimately be the one waiting.
    const nextDealt = await until(async () => {
      const recaps =
        (await host.page.getByText(/Fin de course/).count()) +
        (await guest.page.getByText(/Fin de course/).count());
      if (recaps > 0) return false;
      const [h, g] = await waitCounts();
      return h + g === 1;
    }, 30_000);
    if (!nextDealt) {
      // Read the database through the page's dev handle: the truth about a
      // stalled handshake is in `state` and `nextReady`, not on screen.
      const dump = await host.page.evaluate(async (gameCode) => {
        const fb = window.__fsdb;
        if (!fb) return "pas de handle base";
        const snap = await fb.get(fb.ref(fb.db, `games/${gameCode}`));
        const value = snap.val() ?? {};
        return JSON.stringify({
          state: value.state,
          nextReady: value.nextReady,
          courses: Object.keys(value.courses ?? {}),
          result: value.result,
        });
      }, code);
      console.error(`      base : ${dump}`);
    }
    check(!!nextDealt, "la course suivante démarre quand les deux sont prêts");

    // ---- Abandon ----------------------------------------------------------
    console.log("\nabandon");
    await guest.page.getByRole("button", { name: "Menu" }).click();
    await guest.page.getByTestId("abandon").click();

    // Two runners, one leaves: the other is the last one standing.
    const hostSawEnd = await until(
      async () => (await host.page.getByText(/Arrivée/).count()) > 0,
      40_000
    );
    check(!!hostSawEnd, "le départ d'un joueur met fin à un duel");
    if (LIVE && code) {
      // Leave the real database as we found it.
      const removed = await host.page
        .evaluate(async (gameCode) => {
          const fb = window.__fsdb;
          if (!fb) return false;
          await fb.update(fb.ref(fb.db), {
            [`games/${gameCode}`]: null,
            [`secrets/${gameCode}`]: null,
          });
          return true;
        }, code)
        .catch(() => false);
      check(removed, "la partie de test est effacée de la base réelle");
    }
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
