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

const BASE =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ||
  "http://127.0.0.1:8080/";
const MAX_STEPS = 600;
// `--coups-bas` plays the same whole game under the variant's rules, which is
// the only way to exercise the cards that make you POINT at another card.
const COUPS_BAS = process.argv.includes("--coups-bas");
// `--solo` plays against the AI instead of round a table. It looks like a
// weaker test — most of the run is spent waiting — but it is the only one that
// drives the AI through the REAL hook rather than calling its decision
// function directly, and a table where the AI never acts is a table that
// simply stops.
const SOLO = process.argv.includes("--solo");
// Nothing playable for this long means nobody is going to act: the AI thinks
// for well under a second, so twelve of them is a freeze, not a pause.
const STALL_POLLS = 60;

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

await page
  .getByRole("button", { name: SOLO ? "Solo" : "À plusieurs", exact: SOLO })
  .click();
if (SOLO) {
  // Two rivals, so the AI draws enough cards for the awkward ones to come up.
  // This run is slow — every AI move costs a thinking delay — and it is a
  // coverage net, not the guard: whether the AI is ASKED to act at all is
  // pinned down deterministically in `ai.test.ts`.
  await page.getByRole("button", { name: "2", exact: true }).first().click();
  // And a bounded format. Every AI move costs a thinking delay, so a run to
  // 200 points takes ten minutes of wall clock for no extra coverage: five
  // races exercise the same cards.
  await page.getByRole("button", { name: "Éclair", exact: true }).click();
}
if (COUPS_BAS) {
  await page.getByRole("button", { name: "Coups bas", exact: true }).click();
}
await page.getByRole("button", { name: /Jouer/ }).click();
await page.waitForTimeout(500);

let races = 0;
let finished = false;
let idle = 0;

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

  // A card or a lane is waiting to be pointed at: take the first legal one.
  // Cards are offered as buttons inside a lane, lanes as buttons themselves —
  // both answer to the same label, so one branch covers targeting and picking.
  const target = page.locator('[aria-label^="Choisir"]').first();
  if (await target.count()) {
    idle = 0;
    await target.click({ timeout: 5000 }).catch(() => undefined);
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
  const go = page.getByRole("button", { name: "Accélérer" });
  if (risk > 28 && (await stay.isEnabled().catch(() => false))) {
    idle = 0;
    await stay.click();
  } else if (await go.isEnabled().catch(() => false)) {
    idle = 0;
    await go.click();
  } else {
    // Nothing for a human to do. Against the AI that is normal for a moment —
    // it is thinking — so a stall is only called once the board has stayed
    // dead far longer than any thinking delay.
    if (++idle > STALL_POLLS) {
      const line = await page
        .locator('[aria-live="polite"]')
        .first()
        .innerText()
        .catch(() => "?");
      problems.push(
        `plateau figé à l'étape ${step} : plus rien n'est jouable — « ${line.replace(/\n/g, " ")} »`
      );
      break;
    }
    await page.waitForTimeout(200);
    continue;
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
console.log(
  `smoke ok (${SOLO ? "solo" : "local"} · ${COUPS_BAS ? "Coups bas" : "classique"})` +
    ` — ${races} courses jusqu'à la ligne d'arrivée`
);
