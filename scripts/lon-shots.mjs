#!/usr/bin/env node
/**
 * Visual check for one aircraft (written for the Citation Longitude cockpit work; works for any id):
 * serves dist/ (run `npm run build` first), launches the aircraft in headless Chromium
 * (SwiftShader) and writes screenshots of the pilot view, every cockpit preset view and a few
 * exterior views to tests/output/<aircraft>/, plus display / control probes.
 *
 *   node scripts/lon-shots.mjs
 * Environment:
 *   SHOT_AIRCRAFT (citation-longitude), SHOT_AIRPORT (KTEB), SHOT_RUNWAY (01), SHOT_STATE (ready_to_taxi),
 *   SHOT_TIME (15:00), SHOT_WEATHER (cavok), SHOT_PARTS (cockpit,views,exterior), SHOT_EVAL (JS run in the
 *   page before the shots, e.g. "__sim.set('ac.lon.lt.ldg_l',1)"), SHOT_WAIT_S (sim seconds before shots, 4),
 *   CHROMIUM_PATH, HTTPS_PROXY, SMOKE_CA_FILE (see scripts/smoke.mjs).
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.SHOT_DIST ? path.resolve(process.env.SHOT_DIST) : path.join(ROOT, 'dist');
const AC = process.env.SHOT_AIRCRAFT || 'citation-longitude';
const OUT = path.join(ROOT, 'tests', 'output', AC);
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PARTS = (process.env.SHOT_PARTS || 'cockpit,views,exterior').split(',');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.gz': 'application/octet-stream' };

function caSpkiHashes(file) {
  if (!file || !fs.existsSync(file)) return [];
  const pems = fs.readFileSync(file, 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  const out = [];
  for (const pem of pems) {
    try {
      const cert = new crypto.X509Certificate(pem);
      if (cert.ca) out.push(crypto.createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64'));
    } catch {
      /* skip */
    }
  }
  return [...new Set(out)];
}

function serve(dir) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(dir, p));
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end('not found');
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = await import('playwright-core');
  const server = await serve(DIST);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];
  const pins = caSpkiHashes(process.env.SMOKE_CA_FILE || process.env.NODE_EXTRA_CA_CERTS);
  if (pins.length) args.push(`--ignore-certificate-errors-spki-list=${pins.join(',')}`);
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args, proxy: proxy ? { server: proxy, bypass: '127.0.0.1,localhost' } : undefined });
  const t0 = Date.now();
  const log = (s) => console.log(`shots ${((Date.now() - t0) / 1000).toFixed(0)}s ${s}`);
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e?.stack || e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    const q = `?aircraft=${AC}&airport=${process.env.SHOT_AIRPORT || 'KTEB'}&runway=${process.env.SHOT_RUNWAY || '01'}&state=${process.env.SHOT_STATE || 'ready_to_taxi'}&time=${process.env.SHOT_TIME || '15:00'}&weather=${process.env.SHOT_WEATHER || 'cavok'}&autotest=1`;
    log(`launch ${q}`);
    await page.goto(base + q, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__sim?.ready === true || window.__sim?.phase === 'error', null, { timeout: 300_000, polling: 500 });
    const phase = await page.evaluate(() => window.__sim.phase);
    if (phase !== 'flying') {
      log(`launch failed: ${await page.evaluate(() => window.__sim.error)}`);
      await page.screenshot({ path: path.join(OUT, 'error.png') });
      return;
    }
    if (process.env.SHOT_EVAL) await page.evaluate(process.env.SHOT_EVAL);
    const simT = () => page.evaluate(() => window.__sim.get('sim.time_s'));
    const s0 = await simT();
    const wait = Number(process.env.SHOT_WAIT_S || 4);
    await page.waitForFunction((t) => window.__sim.get('sim.time_s') >= t, s0 + wait, { timeout: 240_000, polling: 250 }).catch(() => log('sim wait timed out'));
    const frames = async (n) => {
      const f = await page.evaluate(() => window.__sim.frames);
      await page.waitForFunction((x) => window.__sim.frames >= x, f + n, { timeout: 120_000, polling: 200 }).catch(() => undefined);
    };
    const shot = async (name) => {
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      log(`screenshot ${name}.png`);
    };
    if (PARTS.includes('cockpit') || PARTS.includes('views')) {
      await page.evaluate(() => window.__sim.view('cockpit'));
      await frames(6);
      await sleep(400);
      await shot('cockpit_pilot');
      const disp = await page.evaluate(() => window.__sim.displays());
      log(`displays: ${disp.map((d) => `${d.id} p${d.powered ? 1 : 0} b${d.booting ? 1 : 0} r${d.renders} lit ${(d.lit * 100).toFixed(0)}%`).join('; ')}`);
      const st = await page.evaluate(() => ({ render: window.__sim.stats().render, fps: window.__sim.stats().fps }));
      log(`renderer: ${JSON.stringify(st)}`);
      const sky = await page.evaluate(() => window.__sim.pick(0, 0.85));
      log(`sky pick: ${sky ? sky.name : 'clear'}`);
    }
    if (PARTS.includes('views')) {
      const n = Number(process.env.SHOT_VIEWS || 7);
      for (let i = 1; i <= n; i++) {
        await page.evaluate(() => window.__sim.emit('view.cockpit'));
        await frames(5);
        await sleep(500);
        await shot(`view_${i}`);
      }
    }
    if (PARTS.includes('exterior')) {
      await page.evaluate(() => window.__sim.view('chase'));
      await frames(6);
      await sleep(300);
      await shot('ext_chase');
      await page.evaluate(() => window.__sim.view('orbit'));
      await frames(4);
      const box = { x: 640, y: 360 };
      for (const [name, dx, dy] of [
        ['ext_side', 360, 0],
        ['ext_front34', 240, 0],
        ['ext_front', 120, 0],
        ['ext_top', 0, 200],
      ]) {
        await page.mouse.move(box.x, box.y);
        await page.mouse.down({ button: 'left' });
        await page.mouse.move(box.x + dx, box.y + dy, { steps: 8 });
        await page.mouse.up({ button: 'left' });
        await frames(4);
        await sleep(300);
        await shot(name);
      }
    }
    log(`errors: ${errors.length ? errors.slice(0, 5).join(' | ') : 'none'}`);
  } finally {
    await browser.close().catch(() => undefined);
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
