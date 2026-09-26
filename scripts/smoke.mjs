#!/usr/bin/env node
/**
 * Smoke test: serves the built app (dist/, run `npm run build` first) with a
 * tiny static server, drives it in headless Chromium (playwright-core,
 * software WebGL) and writes screenshots + diagnostics to tests/output/.
 *
 *   npm run build && npm run smoke
 *
 * Environment:
 *   CHROMIUM_PATH     Chromium executable (default /opt/pw-browsers/chromium-1194/chrome-linux/chrome)
 *   SMOKE_AIRPORT     departure airport (default KTEB), SMOKE_RUNWAY (default 01)
 *   SMOKE_TIMEOUT_S   max seconds to reach the flying state (default 240)
 *   HTTPS_PROXY       passed to Chromium (terrain tiles, live METARs)
 *   SMOKE_CA_FILE     PEM file of extra CA certificates Chromium should trust, e.g.
 *                     a TLS-inspecting proxy's CA (default: NODE_EXTRA_CA_CERTS).
 *                     Trust is added by public-key pin (--ignore-certificate-errors-spki-list):
 *                     only chains containing one of these CA keys are accepted in
 *                     addition to Chromium's own store; verification stays on.
 *
 * Flow: main menu screenshot -> scripted launch (?autotest=1: test jet on the
 * runway) -> cockpit screenshots -> release brakes, full thrust -> external
 * views -> checks (no uncaught errors, the aircraft accelerates, engines run,
 * FDM valid) -> tests/output/{*.png, vars.json, stats.json, console.log}.
 * Exits non-zero on failure.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'tests', 'output');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const AIRPORT = process.env.SMOKE_AIRPORT || 'KTEB';
const RUNWAY = process.env.SMOKE_RUNWAY || '01';
const TIMEOUT_S = Number(process.env.SMOKE_TIMEOUT_S || 240);

/** SHA-256 SPKI hashes (base64) of the CA certificates in a PEM file (empty if none). */
function caSpkiHashes(file) {
  if (!file || !fs.existsSync(file)) return [];
  const pems = fs.readFileSync(file, 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
  const out = [];
  for (const pem of pems) {
    try {
      const cert = new crypto.X509Certificate(pem);
      if (!cert.ca) continue;
      out.push(crypto.createHash('sha256').update(cert.publicKey.export({ type: 'spki', format: 'der' })).digest('base64'));
    } catch {
      // Skip certificates node cannot parse.
    }
  }
  return [...new Set(out)];
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.gz': 'application/octet-stream',
  '.ico': 'image/x-icon',
};

function serve(dir) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let p = decodeURIComponent(url.pathname);
    if (p === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(dir, p));
    if (!file.startsWith(dir)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('smoke: dist/ is missing; run `npm run build` first');
    process.exit(2);
  }
  if (!fs.existsSync(CHROMIUM)) {
    console.error(`smoke: Chromium not found at ${CHROMIUM} (set CHROMIUM_PATH)`);
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = await import('playwright-core');
  const server = await serve(DIST);
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/`;
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  const args = [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ];
  const caPins = caSpkiHashes(process.env.SMOKE_CA_FILE || process.env.NODE_EXTRA_CA_CERTS);
  if (caPins.length) args.push(`--ignore-certificate-errors-spki-list=${caPins.join(',')}`);
  const browser = await chromium.launch({
    executablePath: CHROMIUM,
    headless: true,
    args,
    proxy: proxy ? { server: proxy, bypass: '127.0.0.1,localhost' } : undefined,
  });
  const failures = [];
  const logLines = [];
  const pageErrors = [];
  const consoleErrors = [];
  const t0 = Date.now();
  const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const log = (s) => {
    logLines.push(`[${stamp()}] ${s}`);
    console.log(`smoke ${stamp()} ${s}`);
  };

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('console', (m) => {
      const line = `[console.${m.type()}] ${m.text()}`;
      logLines.push(`[${stamp()}] ${line}`);
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => {
      pageErrors.push(String(e?.stack || e));
      logLines.push(`[${stamp()}] [pageerror] ${e?.stack || e}`);
    });

    // 1) Main menu.
    log('loading main menu');
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__sim?.phase === 'menu' || window.__sim?.phase === 'error', null, { timeout: 90_000 });
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, 'menu.png') });
    const menuPhase = await page.evaluate(() => window.__sim?.phase);
    if (menuPhase !== 'menu') failures.push(`main menu did not load (phase ${menuPhase})`);
    const flyEnabled = await page.evaluate(() => !document.querySelector('#amg-fly')?.hasAttribute('disabled'));
    log(`menu phase=${menuPhase} fly enabled=${flyEnabled}`);

    // 2) Scripted flight: test jet lined up on the runway.
    const q = `?aircraft=_test-jet&airport=${AIRPORT}&runway=${RUNWAY}&state=takeoff&time=15:00&weather=scattered&autotest=1`;
    log(`launching ${q}`);
    await page.goto(base + q, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__sim?.ready === true || window.__sim?.phase === 'error', null, { timeout: TIMEOUT_S * 1000, polling: 500 });
    const phase = await page.evaluate(() => window.__sim?.phase);
    log(`phase=${phase}`);
    if (phase !== 'flying') {
      failures.push(`flight did not start: ${await page.evaluate(() => window.__sim?.error)}`);
      await page.screenshot({ path: path.join(OUT, 'error.png') });
      throw new Error('launch failed');
    }
    // Let a few frames render and terrain stream in.
    const waitFrames = async (n, maxMs) => {
      const start = await page.evaluate(() => window.__sim.frames);
      await page.waitForFunction((s) => window.__sim.frames >= s, start + n, { timeout: maxMs, polling: 250 }).catch(() => log(`waitFrames(${n}) timed out`));
    };
    await waitFrames(8, 60_000);
    await sleep(3000);
    await page.screenshot({ path: path.join(OUT, 'cockpit.png') });
    log('cockpit screenshot');
    const ground0 = await page.evaluate(() => window.__sim.vars(['fdm.', 'eng1.', 'eng2.', 'gear.', 'elec.main', 'display.']));
    log(`on runway: gs=${ground0['fdm.gs_kt']?.toFixed(2)} n1=${ground0['eng1.n1_pct']?.toFixed(1)} wow=${ground0['gear.wow1']} bus=${ground0['elec.main_v']?.toFixed(1)}`);
    if (!(ground0['eng1.running'] === 1 && ground0['eng2.running'] === 1)) failures.push('engines are not running in the takeoff state');
    if (!(ground0['fdm.on_ground'] === 1)) failures.push('aircraft is not on the ground in the takeoff state');
    if (!(ground0['elec.main_v'] > 20)) failures.push(`main bus not powered (${ground0['elec.main_v']})`);

    // Pedestal preset view.
    await page.evaluate(() => window.__sim.emit('view.cockpit'));
    await waitFrames(3, 30_000);
    await sleep(800);
    await page.screenshot({ path: path.join(OUT, 'cockpit_pedestal.png') });
    await page.evaluate(() => window.__sim.view('cockpit'));

    // 3) Take-off roll: release the parking brake, full thrust (through the input command router).
    log('releasing brakes, full thrust');
    await page.evaluate(() => {
      window.__sim.emit('input.throttle_full');
      window.__sim.set('ac.demo.park_brake', 0);
    });
    await page.evaluate(() => window.__sim.view('chase'));
    // External views need a few frames for terrain LOD around the new camera position (software GL is ~1-3 fps).
    await waitFrames(15, 90_000);
    await sleep(1500);
    await page.screenshot({ path: path.join(OUT, 'chase.png') });
    log('chase screenshot');
    // Wait for ~20 s of simulated time.
    const simT0 = await page.evaluate(() => window.__sim.get('sim.time_s'));
    await page.waitForFunction((t) => window.__sim.get('sim.time_s') >= t + 20, simT0, { timeout: 180_000, polling: 500 }).catch(() => log('20 s of sim time not reached'));
    const roll = await page.evaluate(() => window.__sim.vars(['fdm.', 'eng1.', 'eng2.', 'sim.', 'fadec.']));
    log(`after roll: t=${(roll['sim.time_s'] - simT0).toFixed(1)}s gs=${roll['fdm.gs_kt']?.toFixed(1)} ias=${roll['fdm.ias_kt']?.toFixed(1)} n1=${roll['eng1.n1_pct']?.toFixed(1)} alt=${roll['fdm.alt_agl_ft']?.toFixed(0)} crashed=${roll['fdm.crashed']}`);
    if (!(roll['fdm.gs_kt'] > 15)) failures.push(`aircraft did not accelerate (gs ${roll['fdm.gs_kt']})`);
    if (roll['fdm.crashed']) failures.push(`aircraft crashed: ${await page.evaluate(() => window.__sim.getString('fdm.crash_reason'))}`);
    for (const k of ['fdm.lat_deg', 'fdm.lon_deg', 'fdm.alt_msl_ft', 'fdm.pitch_deg']) if (!Number.isFinite(roll[k])) failures.push(`${k} is not finite`);

    await page.evaluate(() => window.__sim.view('orbit'));
    await waitFrames(12, 90_000);
    await sleep(800);
    await page.screenshot({ path: path.join(OUT, 'orbit.png') });
    await page.evaluate(() => window.__sim.view('tower'));
    await waitFrames(20, 120_000);
    await sleep(800);
    await page.screenshot({ path: path.join(OUT, 'tower.png') });
    await page.evaluate(() => window.__sim.view('cockpit'));
    await waitFrames(4, 60_000);
    await sleep(800);
    await page.screenshot({ path: path.join(OUT, 'cockpit_roll.png') });
    log('external screenshots done');

    // 4) In-air start: 10 nm final.
    log('launching approach state');
    await page.evaluate(() => window.__sim.launch({ state: 'approach', spot: { kind: 'auto' } }));
    await page.waitForFunction(() => window.__sim.ready === true || window.__sim.phase === 'error', null, { timeout: TIMEOUT_S * 1000, polling: 500 });
    await waitFrames(6, 60_000);
    const appr0 = await page.evaluate(() => window.__sim.vars(['fdm.', 'sim.']));
    await page.waitForFunction((t) => window.__sim.get('sim.time_s') >= t + 10, appr0['sim.time_s'], { timeout: 120_000, polling: 500 }).catch(() => log('approach: 10 s of sim time not reached'));
    const appr1 = await page.evaluate(() => window.__sim.vars(['fdm.', 'sim.', 'nav1.']));
    const apprPlace = await page.evaluate(() => window.__sim.stats().placement);
    await page.screenshot({ path: path.join(OUT, 'approach_cockpit.png') });
    await page.evaluate(() => window.__sim.view('chase'));
    await waitFrames(4, 60_000);
    await sleep(800);
    await page.screenshot({ path: path.join(OUT, 'approach_chase.png') });
    const dAlt = appr1['fdm.alt_msl_ft'] - appr0['fdm.alt_msl_ft'];
    log(`approach: ${apprPlace?.description}; alt ${appr0['fdm.alt_msl_ft']?.toFixed(0)} -> ${appr1['fdm.alt_msl_ft']?.toFixed(0)} ft, ias ${appr1['fdm.ias_kt']?.toFixed(0)}, nav1 ${appr1['nav1.active_mhz']} loc=${appr1['nav1.is_loc']} received=${appr1['nav1.received']} gs_valid=${appr1['nav1.gs_valid']} cdi=${appr1['nav1.cdi']?.toFixed(2)}`);
    if (apprPlace?.ils && !(appr1['nav1.received'] === 1 && appr1['nav1.is_loc'] === 1)) failures.push(`approach state: NAV1 auto-tuned to ILS ${apprPlace.ils.ident} but no localizer received`);
    if (appr1['fdm.on_ground'] || appr1['fdm.crashed']) failures.push('approach state: aircraft not flying');
    if (!(Math.abs(dAlt) < 600)) failures.push(`approach state not trimmed: altitude changed ${dAlt.toFixed(0)} ft in 10 s`);

    fs.writeFileSync(path.join(OUT, 'vars.json'), JSON.stringify(await page.evaluate(() => window.__sim.vars()), null, 1));
    fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify(await page.evaluate(() => window.__sim.stats()), null, 2));
  } catch (e) {
    failures.push(`smoke aborted: ${e?.message ?? e}`);
  } finally {
    await browser.close().catch(() => undefined);
    server.close();
  }

  if (pageErrors.length) failures.push(`${pageErrors.length} uncaught page error(s): ${pageErrors[0].split('\n')[0]}`);
  fs.writeFileSync(path.join(OUT, 'console.log'), logLines.join('\n'));
  if (consoleErrors.length) log(`console errors (${consoleErrors.length}): ${[...new Set(consoleErrors)].slice(0, 5).join(' | ')}`);
  if (failures.length) {
    console.error('\nSMOKE FAILED:\n - ' + failures.join('\n - '));
    process.exit(1);
  }
  console.log(`\nSMOKE PASSED (${((Date.now() - t0) / 1000).toFixed(0)} s). Screenshots in tests/output/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
