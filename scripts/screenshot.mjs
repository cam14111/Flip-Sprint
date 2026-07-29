// Dev helper: screenshots the running app at a given viewport.
//
// Used to eyeball the board at the sizes that matter without a device farm.
// Start the dev server first (npm run dev), then:
//
//   node scripts/screenshot.mjs http://127.0.0.1:8080/ out.png 390 844
//   node scripts/screenshot.mjs http://127.0.0.1:8080/ out.png 390 844 --full
//
// Page errors and console errors are surfaced, so a blank screenshot always
// comes with the reason.

import { chromium } from "playwright";

const [url, out, width, height] = process.argv.slice(2);
if (!url || !out) {
  console.error(
    "usage: node scripts/screenshot.mjs <url> <out.png> [width] [height] [--full]"
  );
  process.exit(1);
}

const fullPage = process.argv.includes("--full");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
});
const page = await browser.newPage({
  viewport: { width: Number(width) || 390, height: Number(height) || 844 },
  deviceScaleFactor: 2,
});

let failed = false;
page.on("pageerror", (e) => {
  failed = true;
  console.error("page error:", e.message);
});
page.on("console", (m) => {
  if (m.type() === "error") console.error("console:", m.text());
});

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(900); // let entrance animations settle
await page.screenshot({ path: out, fullPage });
await browser.close();

console.log(failed ? `wrote ${out} (WITH PAGE ERRORS)` : `wrote ${out}`);
process.exit(failed ? 1 : 0);
