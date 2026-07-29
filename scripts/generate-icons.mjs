// Generates the PWA icons and the social (OG) image as real PNGs, with no
// external dependency — the encoder below writes the file bytes directly.
//
// The motif is original to Flip Sprint: a fan of three cards breaking left to
// right across the night-track indigo, with speed lines behind them. The colours
// are the game's own risk ramp — cyan, amber, magenta.
//
//   npm run generate:icons
//
// The PNGs are committed, so a build never needs to run this.

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(__dirname, "..", "public");
mkdirSync(publicDir, { recursive: true });

const hex = (h) => {
  const s = h.replace("#", "");
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
};

// Night-track background, and the three card colours of the risk ramp.
const BG_GLOW = hex("#3d1a86");
const BG_BASE = hex("#0b0522");
const BG_WARM = hex("#5a1450");
const CARD_EDGE = hex("#f4f1ff");
const CARDS = [
  { fill: hex("#38bdf8"), angle: -0.34, dx: -0.3, dy: 0.05 },
  { fill: hex("#fb5b86"), angle: 0.34, dx: 0.3, dy: 0.05 },
  { fill: hex("#fbbf24"), angle: 0, dx: 0, dy: -0.05 },
];

const mix = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Signed containment test for an axis-aligned rounded rectangle. */
const insideRR = (px, py, x, y, w, h, r) => {
  const rr = Math.min(r, w / 2, h / 2);
  const ix = Math.max(x + rr, Math.min(px, x + w - rr));
  const iy = Math.max(y + rr, Math.min(py, y + h - rr));
  const dx = px - ix;
  const dy = py - iy;
  return dx * dx + dy * dy <= rr * rr;
};

/** Same test for a card rotated about its own centre. */
const insideCard = (px, py, cx, cy, w, h, r, angle) => {
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const dx = px - cx;
  const dy = py - cy;
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;
  return insideRR(lx, ly, -w / 2, -h / 2, w, h, r);
};

const render = (W0, H0, frac) => {
  const ss = 4; // supersampling, for smooth rounded corners and edges
  const W = W0 * ss;
  const H = H0 * ss;
  const buf = new Uint8Array(W * H * 4);

  // --- Background: an indigo glow from the top, a warm one bottom-right ----
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const gx = (x - W * 0.5) / (W * 0.85);
      const gy = (y - H * 0.02) / (H * 0.95);
      const glow = Math.min(1, Math.sqrt(gx * gx + gy * gy));
      let c = mix(BG_GLOW, BG_BASE, glow ** 0.85);

      const wx = (x - W * 1.02) / (W * 0.7);
      const wy = (y - H * 1.02) / (H * 0.7);
      const warm = Math.min(1, Math.sqrt(wx * wx + wy * wy));
      c = mix(BG_WARM, c, warm ** 0.7);

      const i = (y * W + x) * 4;
      buf[i] = c[0];
      buf[i + 1] = c[1];
      buf[i + 2] = c[2];
      buf[i + 3] = 255;
    }
  }

  const blend = (idx, color, alpha) => {
    buf[idx] = buf[idx] + (color[0] - buf[idx]) * alpha;
    buf[idx + 1] = buf[idx + 1] + (color[1] - buf[idx + 1]) * alpha;
    buf[idx + 2] = buf[idx + 2] + (color[2] - buf[idx + 2]) * alpha;
  };

  // --- Speed lines, raked across behind the cards -------------------------
  const box = Math.min(W, H) * frac;
  const lineGap = box * 0.085;
  const lineW = box * 0.016;
  const slope = 0.34; // rise per unit run — matches the card tilt
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x + y * slope;
      const phase = ((u % lineGap) + lineGap) % lineGap;
      if (phase >= lineW) continue;
      // Fade the lines out towards the edges so they never look cropped.
      const fade =
        1 - Math.min(1, Math.abs(y - H * 0.5) / (H * 0.55)) ** 2;
      blend((y * W + x) * 4, [255, 255, 255], 0.1 * fade);
    }
  }

  // --- The fan of three cards ---------------------------------------------
  const cardH = box * 0.74;
  const cardW = cardH * 0.7;
  const edge = cardW * 0.085;
  const radius = cardW * 0.16;
  const cx = W / 2;
  const cy = H / 2;

  for (const card of CARDS) {
    const x = cx + cardW * card.dx * 1.55;
    const y = cy + cardH * card.dy;
    const half = Math.ceil(Math.max(cardW, cardH));
    const x0 = Math.max(0, Math.floor(x - half));
    const x1 = Math.min(W, Math.ceil(x + half));
    const y0 = Math.max(0, Math.floor(y - half));
    const y1 = Math.min(H, Math.ceil(y + half));

    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const sx = px + 0.5;
        const sy = py + 0.5;
        if (!insideCard(sx, sy, x, y, cardW, cardH, radius, card.angle)) {
          continue;
        }
        const inner = insideCard(
          sx,
          sy,
          x,
          y,
          cardW - edge * 2,
          cardH - edge * 2,
          radius * 0.72,
          card.angle
        );
        const idx = (py * W + px) * 4;
        const color = inner ? card.fill : CARD_EDGE;
        buf[idx] = color[0];
        buf[idx + 1] = color[1];
        buf[idx + 2] = color[2];
        buf[idx + 3] = 255;
      }
    }
  }

  // --- Box downsample to the target size ----------------------------------
  const out = new Uint8Array(W0 * H0 * 4);
  for (let y = 0; y < H0; y++) {
    for (let x = 0; x < W0; x++) {
      let sr = 0;
      let sg = 0;
      let sb = 0;
      for (let dy = 0; dy < ss; dy++) {
        for (let dx = 0; dx < ss; dx++) {
          const idx = ((y * ss + dy) * W + (x * ss + dx)) * 4;
          sr += buf[idx];
          sg += buf[idx + 1];
          sb += buf[idx + 2];
        }
      }
      const n = ss * ss;
      const o = (y * W0 + x) * 4;
      out[o] = Math.round(sr / n);
      out[o + 1] = Math.round(sg / n);
      out[o + 2] = Math.round(sb / n);
      out[o + 3] = 255;
    }
  }
  return out;
};

// --- PNG encoding ----------------------------------------------------------

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crc32 = (buf) => {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
};

const encodePNG = (rgba, w, h) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // no filter
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

// --- ICO (favicon.ico wraps a 32x32 and a 48x48 PNG) -----------------------

const encodeICO = (entries) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const dir = [];
  for (const e of entries) {
    const entry = Buffer.alloc(16);
    entry[0] = e.size >= 256 ? 0 : e.size;
    entry[1] = e.size >= 256 ? 0 : e.size;
    entry[4] = 1; // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32BE(0, 8);
    entry.writeUInt32LE(e.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    dir.push(entry);
    offset += e.png.length;
  }
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.png)]);
};

// --- Outputs ---------------------------------------------------------------

const targets = [
  { file: "pwa-192x192.png", w: 192, h: 192, frac: 0.92 },
  { file: "pwa-512x512.png", w: 512, h: 512, frac: 0.92 },
  // Maskable icons get cropped to a circle by the launcher: keep the motif
  // well inside the safe zone.
  { file: "maskable-512x512.png", w: 512, h: 512, frac: 0.62 },
  { file: "apple-touch-icon.png", w: 180, h: 180, frac: 0.92 },
  { file: "favicon-32x32.png", w: 32, h: 32, frac: 0.96 },
  { file: "og-image.png", w: 1200, h: 630, frac: 0.82 },
];

for (const t of targets) {
  const png = encodePNG(render(t.w, t.h, t.frac), t.w, t.h);
  writeFileSync(resolve(publicDir, t.file), png);
  console.log(`wrote public/${t.file} (${png.length} bytes)`);
}

const ico = encodeICO(
  [32, 48].map((size) => ({
    size,
    png: encodePNG(render(size, size, 0.96), size, size),
  }))
);
writeFileSync(resolve(publicDir, "favicon.ico"), ico);
console.log(`wrote public/favicon.ico (${ico.length} bytes)`);
