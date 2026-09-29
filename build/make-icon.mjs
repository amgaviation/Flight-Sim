#!/usr/bin/env node
/**
 * Generates the application icon procedurally (no image assets, no
 * dependencies): an attitude-indicator face (sky/ground, horizon, bank scale,
 * yellow aircraft symbol) in a dark rounded square.
 *
 *   node build/make-icon.mjs      -> build/icon.png (512x512), build/icon.ico (16-256 px)
 *
 * PNG encoding: RGBA8, filter 0, zlib (node:zlib). ICO: PNG-compressed
 * entries (supported by Windows Vista and later).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// ------------------------------------------------------------------ PNG
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------------------------------ drawing (unit square 0..1, y down)
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const C = {
  bgTop: hex('#12304f'),
  bgBot: hex('#060d18'),
  bezel: hex('#1b222b'),
  rim: hex('#45b8f0'),
  skyTop: hex('#1662b0'),
  skyHor: hex('#58a8e8'),
  gndHor: hex('#8a5a2e'),
  gndBot: hex('#4a2f16'),
  white: [245, 248, 250],
  yellow: hex('#ffc72c'),
  black: [10, 10, 10],
};

function inPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function roundedSquare(x, y, r) {
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
  return dx * dx + dy * dy <= r * r;
}

// Aircraft symbol (classic ADI "inverted T" wings with inner legs and a centre dot), unit coordinates.
const WING_L = [
  [0.19, 0.49],
  [0.43, 0.49],
  [0.43, 0.56],
  [0.405, 0.56],
  [0.405, 0.515],
  [0.19, 0.515],
];
const WING_R = WING_L.map(([x, y]) => [1 - x, y]);
const inDot = (x, y, r) => Math.hypot(x - 0.5, y - 0.5) < r;
const inSymbol = (x, y) => inPoly(x, y, WING_L) || inPoly(x, y, WING_R) || inDot(x, y, 0.022);

function shade(x, y) {
  // Returns [r, g, b, a] for one sample.
  if (!roundedSquare(x, y, 0.19)) return [0, 0, 0, 0];
  const cx = x - 0.5;
  const cy = y - 0.5;
  const r = Math.hypot(cx, cy);
  const R = 0.37;
  let col;
  if (r > R + 0.045) {
    const t = y;
    col = C.bgTop.map((v, i) => v + (C.bgBot[i] - v) * t);
  } else if (r > R) {
    col = r > R + 0.036 ? C.rim : C.bezel;
  } else {
    // ADI: 8 deg nose-up-ish horizon slightly below centre, 12 deg right bank.
    const a = (12 * Math.PI) / 180;
    const hy = cx * Math.sin(a) + cy * Math.cos(a) - 0.03;
    if (Math.abs(hy) < 0.006) col = C.white;
    else if (hy < 0) {
      const t = Math.min(1, -hy / R);
      col = C.skyHor.map((v, i) => v + (C.skyTop[i] - v) * t);
    } else {
      const t = Math.min(1, hy / R);
      col = C.gndHor.map((v, i) => v + (C.gndBot[i] - v) * t);
    }
    // Pitch ladder lines (sky side).
    const along = cx * Math.cos(a) - cy * Math.sin(a);
    for (const p of [-0.09, -0.18]) {
      if (Math.abs(hy - p) < 0.004 && Math.abs(along) < (p === -0.09 ? 0.07 : 0.1)) col = C.white;
    }
    // Bank scale ticks at the top of the dial (fixed to the case).
    const ang = (Math.atan2(cx, -cy) * 180) / Math.PI;
    for (const t of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
      const len = Math.abs(t) % 30 === 0 ? 0.05 : 0.03;
      if (Math.abs(ang - t) < 1.1 && r > R - len && r < R - 0.004) col = C.white;
    }
    if (Math.abs(ang) < 3.2 && r > R - 0.05 && r < R - 0.004 && Math.abs(ang) < ((R - r) / 0.05) * 3.2) col = C.white;
  }
  // Aircraft symbol with a thin black outline.
  if (inSymbol(x, y)) return [...C.yellow, 255];
  const outline = [-0.007, 0, 0.007].some((ox) => [-0.007, 0, 0.007].some((oy) => inSymbol(x + ox, y + oy)));
  if (outline) return [...C.black, 255];
  return [...col, 255];
}

function render(size) {
  const ss = size <= 64 ? 6 : 4;
  const out = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [cr, cg, cb, ca] = shade((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          r += cr * ca;
          g += cg * ca;
          b += cb * ca;
          a += ca;
        }
      }
      const o = (py * size + px) * 4;
      const n = ss * ss;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round(a / n);
    }
  }
  return out;
}

function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const png512 = encodePng(512, render(512));
fs.writeFileSync(path.join(HERE, 'icon.png'), png512);
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
fs.writeFileSync(path.join(HERE, 'icon.ico'), encodeIco(icoSizes.map((s) => ({ size: s, data: encodePng(s, render(s)) }))));
console.log(`icon: wrote build/icon.png (512x512, ${png512.length} bytes) and build/icon.ico (${icoSizes.join(', ')} px)`);
