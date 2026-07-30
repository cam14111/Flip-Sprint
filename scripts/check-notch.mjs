// Guards against the black band behind the notch.
//
// On an installed PWA the physical screen is taller than the page: the strip
// behind a camera cutout or status bar, and the overscroll gutter, are painted
// by the OS with a SOLID colour it takes from the document root. CSS cannot
// draw there. So the only way that strip disappears is for that solid colour
// to match what the app paints right next to it — the TOP of the track
// gradient, which is much lighter than the rest of the board.
//
// Get it wrong and nothing looks broken in a browser; it only shows on a real
// phone, as a black bar. Hence this check, which measures the actual pixels
// rather than trusting the stylesheet.
//
//   npm run dev                 # in another shell
//   node scripts/check-notch.mjs [url]

import { existsSync, readFileSync } from "node:fs";
import zlib from "node:zlib";
import process from "node:process";
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://127.0.0.1:8080/";
const BUILT_MANIFEST = new URL(
  "../dist/manifest.webmanifest",
  import.meta.url
).pathname;

// Below this, the eye reads one surface; above it, a seam. Corners of the
// gradient sit around 12, which is invisible; the bug this catches scored 76.
const SEAM = 30;

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

/** Decodes a 1×1 PNG straight from Playwright into [r, g, b]. */
const decode = (png) => {
  let off = 8;
  let colourType = 6;
  const idat = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString("ascii", off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") colourType = data[9];
    if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  // One scanline: a filter byte, then the sample. Filter 0 for a 1×1 image.
  const raw = zlib.inflateSync(Buffer.concat(idat));
  return [raw[1], raw[2], raw[3]];
};

const hex = ([r, g, b]) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

/** Weighted RGB distance — close enough to "would a person see a seam?". */
const distance = (a, b) =>
  Math.round(
    Math.sqrt(
      2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2
    )
  );

/** "rgb(37, 16, 86)" → [37, 16, 86] */
const parse = (css) => css.match(/\d+/g).slice(0, 3).map(Number);

/** "#251056" → [37, 16, 86] */
const fromHex = (value) =>
  [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium",
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });

  const root = parse(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).backgroundColor
    )
  );
  console.log(`\nfond du document (ce que l'OS peint) : ${hex(root)}`);

  // --- The colour the OS paints must match the top of the board ------------
  console.log("\nraccord avec le haut de l'écran");
  const topOf = async (label) => {
    const png = await page.screenshot({
      clip: { x: 195, y: 0, width: 1, height: 1 },
    });
    const rgb = decode(png);
    const d = distance(rgb, root);
    check(d <= SEAM, `${label} : ${hex(rgb)}, écart ${d}`);
  };

  await topOf("accueil");
  await page.getByRole("button", { name: "Solo", exact: true }).click();
  await page.getByRole("button", { name: /Jouer/ }).click();
  await page.waitForTimeout(600);
  await topOf("plateau");

  // --- And the declared colours must agree with it -------------------------
  // The meta tag colours the browser toolbar, the manifest colours the splash
  // and the task switcher. Three places, one colour: drift in any of them puts
  // the band back on a different surface.
  console.log("\ncouleurs déclarées");
  const meta = await page.getAttribute('meta[name="theme-color"]', "content");
  check(
    meta !== null && distance(fromHex(meta), root) === 0,
    `meta theme-color = ${meta}`
  );

  // The plugin only injects the manifest into a production build, so in dev we
  // fall back to the last build on disk. Absent both, say so rather than pass
  // quietly — a skipped check that reads as green is worse than no check.
  const link = page.locator('link[rel="manifest"]');
  const manifest = (await link.count())
    ? await page.evaluate(
        (href) => fetch(href).then((r) => r.json()),
        await link.getAttribute("href")
      )
    : existsSync(BUILT_MANIFEST)
      ? JSON.parse(readFileSync(BUILT_MANIFEST, "utf8"))
      : null;

  if (manifest) {
    for (const key of ["theme_color", "background_color"]) {
      const value = manifest[key] ?? "";
      check(
        value.toLowerCase() === hex(root).toLowerCase(),
        `manifest ${key} = ${value}`
      );
    }
  } else {
    console.log("  --   manifeste non vérifié (aucun build : npm run build)");
  }
} finally {
  await browser.close();
}

console.log(`\n${passed} vérifications passées, ${failures.length} échec(s)`);
if (failures.length > 0) {
  for (const f of failures) console.error(` - ${f}`);
  console.error(
    "\nLa zone derrière l'encoche apparaîtra comme une bande. Aligner\n" +
      "html{background-color}, meta[theme-color] et les couleurs du manifeste\n" +
      "sur la couleur peinte EN HAUT de l'écran."
  );
  process.exit(1);
}
