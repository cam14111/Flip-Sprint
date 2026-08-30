// Checks that the announcement of a card played on you goes away on its own.
//
// Played in SOLO on purpose. The announcement counts down for a couple of
// seconds, and the bug this guards against only appears when the board keeps
// moving during that countdown — a rival drawing, the race ending. In local
// play nothing moves while the popup is up (the game is waiting for a tap), so
// the countdown finishes undisturbed and a broken build looks perfectly fine.
// Against the AI, the other runners carry on by themselves, which is exactly
// the situation a player is in.
//
// What it caught, and must keep catching: the dismissal timer was armed inside
// the effect that watches for events, so the next transition ran that effect's
// cleanup, cancelled the timer and returned early without arming another. The
// announcement then stayed forever — hidden under the race recap, and back on
// screen at the following race.
//
//   npm run dev                    # in another shell
//   node scripts/check-alerts.mjs [url]

import process from "node:process";
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://127.0.0.1:8080/";
const MAX_STEPS = 3000;
// Comfortably longer than the announcement's own countdown, so a slow machine
// is not mistaken for a stuck popup.
const PATIENCE_MS = 8000;

const problems = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.on("pageerror", (e) => problems.push(`erreur de page : ${e.message}`));

const visible = (l) => l.isVisible().catch(() => false);
const alert = page.locator('[data-testid="incoming-alert"]');

await page.goto(BASE, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "Solo", exact: true }).click();
// Two rivals, not six. The announcement only fires when a card is played on
// THIS runner, and the AI picks its victim among the rivals it can see: the
// fewer of them there are, the more often that victim is us. Two rather than
// one so that, once we are whistled out, the other AI keeps the board moving —
// which is the whole point, since the bug this guards against is a countdown
// cancelled by a later transition.
await page.getByRole("button", { name: "2", exact: true }).first().click();
await page.getByRole("button", { name: /Jouer/ }).click();
await page.waitForTimeout(500);

let seen = 0;
let checked = false;

for (let step = 0; step < MAX_STEPS && !checked; step++) {
  if (await visible(alert)) {
    seen++;
    const label = (await alert.getAttribute("aria-label")) ?? "?";

    // Deliberately not clicked: the whole point is that a player who does
    // nothing gets their board back.
    const gone = await alert
      .waitFor({ state: "hidden", timeout: PATIENCE_MS })
      .then(() => true)
      .catch(() => false);

    if (!gone) {
      problems.push(
        `« ${label} » ne se referme pas toute seule (étape ${step})`
      );
      break;
    }
    console.log(`  ok   « ${label} » se referme sans être touchée`);

    // And it must not come back later without a new card: the original bug
    // reappeared at the start of the next race. Play on to the next race and
    // look again.
    let racesToGo = 1;
    for (let s = 0; s < 260 && racesToGo > 0; s++) {
      const next = page.getByRole("button", { name: "Course suivante" });
      if (await visible(next)) {
        await next.click();
        await page.waitForTimeout(400);
        racesToGo--;
        if (await visible(alert)) {
          problems.push("l'annonce revient au début de la course suivante");
        }
        break;
      }
      if (await visible(page.getByRole("button", { name: "Nouvelle partie" }))) {
        break;
      }
      if (await visible(alert)) {
        await alert.click();
        await page.waitForTimeout(80);
        continue;
      }
      const target = page
        .locator('[role="button"][aria-label^="Choisir"]')
        .first();
      if (await target.count()) {
        await target.click({ timeout: 5000 }).catch(() => undefined);
        await page.waitForTimeout(90);
        continue;
      }
      const go = page.getByRole("button", { name: "Accélérer" });
      if (await go.isEnabled().catch(() => false)) {
        await go.click({ timeout: 5000 }).catch(() => undefined);
      }
      await page.waitForTimeout(90);
    }
    if (problems.length === 0) {
      console.log("  ok   elle ne revient pas à la course suivante");
    }
    checked = true;
    break;
  }

  if (await visible(page.getByRole("button", { name: "Nouvelle partie" }))) {
    await page.getByRole("button", { name: "Nouvelle partie" }).click();
    await page.waitForTimeout(300);
    continue;
  }
  const next = page.getByRole("button", { name: "Course suivante" });
  if (await visible(next)) {
    await next.click();
    await page.waitForTimeout(120);
    continue;
  }
  const target = page.locator('[role="button"][aria-label^="Choisir"]').first();
  if (await target.count()) {
    await target.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(90);
    continue;
  }
  // Play like a cautious human, so this runner stays in the race long enough
  // to be worth targeting.
  const risk = Number(
    (await page
      .locator('[role="meter"]')
      .getAttribute("aria-valuenow")
      .catch(() => "0")) ?? 0
  );
  const stay = page.getByRole("button", { name: "Souffler" });
  if (risk > 30 && (await stay.isEnabled().catch(() => false))) {
    await stay.click({ timeout: 5000 }).catch(() => undefined);
  } else {
    const go = page.getByRole("button", { name: "Accélérer" });
    if (await go.isEnabled().catch(() => false)) {
      await go.click({ timeout: 5000 }).catch(() => undefined);
    }
  }
  await page.waitForTimeout(90);
}

await browser.close();

// A run where no card was ever played on us proved nothing. Say so instead of
// reporting a green that means "never tested".
if (seen === 0) {
  problems.push(
    `aucune annonce en ${MAX_STEPS} coups : la vérification n'a pas eu lieu`
  );
}

if (problems.length > 0) {
  console.error("\nANNONCES — ÉCHEC");
  for (const p of problems) console.error(" -", p);
  process.exit(1);
}
console.log("\nannonces ok");
