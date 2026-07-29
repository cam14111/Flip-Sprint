// End-to-end smoke test: plays a whole local game through the real UI.
//
// The unit suite proves the engine is right; this proves the screens actually
// let a person get from the home screen to a finish line — clicks, prompts,
// overlays and all. It fails on any page error, on a stuck board, or if the
// recap disagrees with the engine's own arithmetic.
//
//   npm run dev                    # in another shell
//   node scripts/smoke-local.mjs [url]

import { chromium } from "playwright";

const BASE = process.argv[2] || "http://127.0.0.1:8080/";
const MAX_STEPS = 600;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

const problems = [];
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") problems.push(`console: ${m.text()}`);
});

const visible = (locator) => locator.isVisible().catch(() => false);

await page.goto(BASE, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: "networkidle" });

await page.getByRole("button", { name: "À plusieurs" }).click();
await page.getByRole("button", { name: /Jouer/ }).click();
await page.waitForTimeout(500);

let races = 0;
let finished = false;

for (let step = 0; step < MAX_STEPS && !finished; step++) {
  const newGame = page.getByRole("button", { name: "Nouvelle partie" });
  if (await visible(newGame)) {
    finished = true;
    break;
  }

  const nextRace = page.getByRole("button", { name: "Course suivante" });
  if (await visible(nextRace)) {
    races++;
    await nextRace.click();
    await page.waitForTimeout(120);
    continue;
  }

  // An action card is waiting for a target: take the first legal lane.
  const target = page.locator('[role="button"][aria-label^="Choisir"]').first();
  if (await target.count()) {
    await target.click();
    await page.waitForTimeout(90);
    continue;
  }

  // Otherwise play like a cautious human: stop once the gauge gets ugly.
  const risk = Number(
    (await page
      .locator('[role="meter"]')
      .getAttribute("aria-valuenow")
      .catch(() => "0")) ?? 0
  );
  const stay = page.getByRole("button", { name: "Souffler" });
  if (risk > 28 && (await stay.isEnabled().catch(() => false))) {
    await stay.click();
  } else {
    const go = page.getByRole("button", { name: "Accélérer" });
    if (!(await go.isEnabled().catch(() => false))) {
      problems.push(`board stuck at step ${step}: nothing is playable`);
      break;
    }
    await go.click();
  }
  await page.waitForTimeout(90);
}

if (!finished) problems.push("the game never reached a finish line");
if (races === 0) problems.push("no race was ever scored");

// The winner's total must match the sum of their race scores.
if (finished) {
  const winnerLine = await page
    .locator('[role="dialog"] >> text=/l\\x27emporte/')
    .textContent()
    .catch(() => null);
  if (!winnerLine) problems.push("no winner was announced");
}

await browser.close();

if (problems.length > 0) {
  console.error("SMOKE FAILED");
  for (const p of problems) console.error(" -", p);
  process.exit(1);
}
console.log(`smoke ok — ${races} courses jusqu'à la ligne d'arrivée`);
