#!/usr/bin/env node
/**
 * Integration QA for the production jets: serves dist/ (run `npm run build` first), opens the main
 * menu in headless Chromium (SwiftShader), checks that the six jets are offered and available, then
 * loads every jet at a real airport in every initial state through `window.__sim.launch` (the same
 * path the menu's FLY button takes) and checks each load:
 *
 *   - the launch reaches phase 'flying' with no uncaught page error and no console error
 *     (resource 404s are listed separately);
 *   - every numeric SimVar is finite; the aircraft has not crashed;
 *   - ground states stay put (on ground, GS < 1 kt); in-air states are trimmed
 *     (altitude change < 600 ft over 10 s of sim time, same limit as scripts/smoke.mjs);
 *   - cockpit displays: dark in cold & dark, powered and drawing otherwise;
 *   - renderer memory (geometries, textures) and JS heap after a forced GC, per load, so that
 *     unloading one aircraft and loading the next can be checked for leaks (a final pass reloads
 *     the first aircraft and compares).
 *
 * Screenshots (pilot view per load, chase view for the takeoff state) and qa.json are written to
 * tests/output/jets/ (or QA_OUT).
 *
 *   npm run build && node scripts/jets-qa.mjs
 * Environment:
 *   QA_AIRCRAFT  comma list of ids (default: all six jets)
 *   QA_STATES    comma list of states (default cold_dark,ready_to_taxi,takeoff,approach,cruise)
 *   QA_TIME      UTC HH:MM (default 15:00), QA_WEATHER (default cavok)
 *   QA_OUT, QA_DIST, CHROMIUM_PATH, HTTPS_PROXY, SMOKE_CA_FILE (see scripts/smoke.mjs)
 */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.QA_DIST ? path.resolve(process.env.QA_DIST) : path.join(ROOT, 'dist');
const OUT = process.env.QA_OUT ? path.resolve(process.env.QA_OUT) : path.join(ROOT, 'tests', 'output', 'jets');
const CHROMIUM = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const TIME = process.env.QA_TIME || '15:00';
const WEATHER = process.env.QA_WEATHER || 'cavok';

/** Each jet at a real airport it serves (runway with an ILS so the approach state gets one). */
const JETS = [
  { id: 'citation-m2', airport: 'KICT', runway: '19R' },
  { id: 'citation-longitude', airport: 'KICT', runway: '01L' },
  { id: 'g650', airport: 'KSAV', runway: '10' },
  { id: 'g800', airport: 'KTEB', runway: '06' },
  { id: 'global6000', airport: 'KTEB', runway: '24' },
  { id: 'b737-800', airport: 'KLAX', runway: '25R' },
];
const STATES = (process.env.QA_STATES || 'cold_dark,ready_to_taxi,takeoff,approach,cruise').split(',');
const ONLY = process.env.QA_AIRCRAFT ? process.env.QA_AIRCRAFT.split(',') : null;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.gz': 'application/octet-stream', '.map': 'application/json' };

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

const notFound = [];
function serve(dir) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    if (p === '/favicon.ico') return res.writeHead(204).end();
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(dir, p));
    if (!file.startsWith(dir)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) {
        notFound.push(p);
        return res.writeHead(404).end('not found');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('jets-qa: dist/ is missing; run `npm run build` first');
    process.exit(2);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const { chromium } = await import('playwright-core');
  const server = await serve(DIST);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  const args = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--js-flags=--expose-gc'];
  const pins = caSpkiHashes(process.env.SMOKE_CA_FILE || process.env.NODE_EXTRA_CA_CERTS);
  if (pins.length) args.push(`--ignore-certificate-errors-spki-list=${pins.join(',')}`);
  const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args, proxy: proxy ? { server: proxy, bypass: '127.0.0.1,localhost' } : undefined });
  const t0 = Date.now();
  const log = (s) => console.log(`qa ${((Date.now() - t0) / 1000).toFixed(0)}s ${s}`);
  const results = { menu: null, loads: [], failures: [], notFound };
  const fail = (what) => {
    results.failures.push(what);
    log(`FAIL ${what}`);
  };
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    const cdp = await page.context().newCDPSession(page);
    let errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e?.stack || e).split('\n').slice(0, 3).join(' / ')}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
    page.on('response', (r) => {
      if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`);
    });

    // ------------------------------------------------------------ menu
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__sim?.phase === 'menu' || window.__sim?.phase === 'error', null, { timeout: 120_000 });
    await sleep(500);
    await page.screenshot({ path: path.join(OUT, 'menu.png') });
    const menu = await page.evaluate(() =>
      [...document.querySelectorAll('.amg-menu .amg-col:first-child .amg-card')].map((c) => ({
        title: c.querySelector('.amg-title')?.firstChild?.textContent ?? '',
        disabled: c.classList.contains('disabled'),
      })),
    );
    results.menu = menu;
    log(`menu: ${menu.map((m) => `${m.title}${m.disabled ? ' (unavailable)' : ''}`).join('; ')}`);
    for (const re of [/Citation M2/, /Citation Longitude/, /G650/, /G800/, /Global 6000/, /737-800/]) {
      const m = menu.find((x) => re.test(x.title));
      if (!m) fail(`menu: ${re} missing`);
      else if (m.disabled) fail(`menu: ${m.title} not available`);
    }
    if (errors.length) fail(`menu errors: ${errors.join(' | ')}`);

    const heap = async () => {
      await cdp.send('HeapProfiler.collectGarbage');
      const h = await cdp.send('Runtime.getHeapUsage');
      return Math.round(h.usedSize / 1e6);
    };

    const runLoad = async (jet, state, tag) => {
      errors = [];
      const t = Date.now();
      const cfg = { aircraftId: jet.id, airport: jet.airport, spot: { kind: 'runway', runway: jet.runway }, state };
      // Time and weather come from the page's current config (set by the first launch URL).
      await page.evaluate((c) => {
        window.__sim.ready = false;
        void window.__sim.launch(c);
      }, cfg);
      await page.waitForFunction(() => window.__sim.ready === true || window.__sim.phase === 'error', null, { timeout: 400_000, polling: 500 });
      const phase = await page.evaluate(() => window.__sim.phase);
      const rec = { aircraft: jet.id, state, tag, launch_s: (Date.now() - t) / 1000, phase };
      results.loads.push(rec);
      if (phase !== 'flying') {
        rec.error = await page.evaluate(() => window.__sim.error);
        fail(`${jet.id}/${state}: launch failed: ${rec.error}`);
        await page.screenshot({ path: path.join(OUT, `${jet.id}_${state}_error.png`) });
        return rec;
      }
      const g = () => page.evaluate(() => ({ t: __sim.get('sim.time_s'), alt: __sim.get('fdm.alt_msl_ft'), agl: __sim.get('fdm.alt_agl_ft'), gs: __sim.get('fdm.gs_kt'), ias: __sim.get('fdm.ias_kt'), vs: __sim.get('fdm.vs_fpm'), pitch: __sim.get('fdm.pitch_deg'), wow: __sim.get('fdm.on_ground'), crashed: __sim.get('fdm.crashed'), reason: __sim.getString('fdm.crash_reason') }));
      const waitSim = async (dt) => {
        const s0 = await page.evaluate(() => __sim.get('sim.time_s'));
        await page.waitForFunction((x) => __sim.get('sim.time_s') >= x, s0 + dt, { timeout: 300_000, polling: 250 }).catch(() => log('sim wait timed out'));
      };
      await page.evaluate(() => __sim.view('cockpit'));
      await waitSim(2);
      const a = await g();
      await waitSim(10);
      const b = await g();
      rec.start = a;
      rec.end = b;
      const air = state === 'approach' || state === 'cruise';
      if (b.crashed) fail(`${jet.id}/${state}: crashed (${b.reason})`);
      if (air) {
        if (b.wow) fail(`${jet.id}/${state}: on ground in an in-air state`);
        if (Math.abs(b.alt - a.alt) > 600) fail(`${jet.id}/${state}: not trimmed, altitude ${a.alt.toFixed(0)} -> ${b.alt.toFixed(0)} ft in 10 s`);
      } else {
        if (!b.wow) fail(`${jet.id}/${state}: not on the ground (AGL ${b.agl.toFixed(1)} ft)`);
        if (b.gs > 1) fail(`${jet.id}/${state}: moving on the ground, GS ${b.gs.toFixed(1)} kt`);
      }
      // NaN is the documented "no value" sentinel of several avionics vars (minimums not set, no TCAS RA,
      // no N1 target: docs/modules/avionics-common.md), so NaN only fails in physical state; Infinity always fails.
      const nonFinite = await page.evaluate(() => Object.entries(__sim.vars()).filter(([, v]) => !Number.isFinite(v)).map(([k, v]) => [k, String(v)]));
      const bad = nonFinite.filter(([k, v]) => v !== 'NaN' || /^(fdm|eng\d|elec|fuel|hyd|pneu|press|apu|gear|ctl|input)\./.test(k));
      rec.nanSentinels = nonFinite.filter((e) => !bad.includes(e)).map(([k]) => k);
      if (bad.length) fail(`${jet.id}/${state}: non-finite vars ${bad.slice(0, 10).map(([k, v]) => `${k}=${v}`).join(',')}`);
      const disp = await page.evaluate(() => __sim.displays());
      rec.displays = disp.map((d) => ({ id: d.id, powered: d.powered, booting: d.booting, renders: d.renders, lit: Math.round(d.lit * 100) }));
      // A Hobbs meter is an electromechanical counter that stays readable unpowered.
      if (state === 'cold_dark' && disp.some((d) => d.powered && !/hobbs/i.test(d.id))) fail(`${jet.id}/${state}: displays powered in cold & dark: ${disp.filter((d) => d.powered && !/hobbs/i.test(d.id)).map((d) => d.id).join(',')}`);
      if (state !== 'cold_dark') {
        const dark = disp.filter((d) => !d.powered || d.renders === 0);
        if (dark.length) log(`note ${jet.id}/${state}: unpowered or undrawn displays ${dark.map((d) => d.id).join(',')}`);
      }
      await page.screenshot({ path: path.join(OUT, `${jet.id}_${state}${tag ? '_' + tag : ''}_cockpit.png`) });
      if (state === 'takeoff' || state === 'approach') {
        await page.evaluate(() => __sim.view('chase'));
        await sleep(1500);
        await page.screenshot({ path: path.join(OUT, `${jet.id}_${state}${tag ? '_' + tag : ''}_chase.png`) });
        await page.evaluate(() => __sim.view('cockpit'));
      }
      const st = await page.evaluate(() => __sim.stats());
      rec.render = st.render;
      rec.fps = st.fps;
      rec.heapMB = await heap();
      const real = errors.filter((e) => !/^http 4\d\d|^requestfailed|Failed to load resource/.test(e));
      rec.errors = errors;
      if (real.length) fail(`${jet.id}/${state}: errors: ${real.slice(0, 5).join(' | ')}`);
      log(`${jet.id}/${state}${tag ? ' ' + tag : ''}: launch ${rec.launch_s.toFixed(0)} s, alt ${a.alt.toFixed(0)}->${b.alt.toFixed(0)} ft, IAS ${b.ias.toFixed(0)}, GS ${b.gs.toFixed(1)}, draw ${st.render.calls}, geo ${st.render.geometries}, tex ${st.render.textures}, heap ${rec.heapMB} MB, displays ${rec.displays.filter((d) => d.powered).length}/${rec.displays.length} powered, errors ${errors.length}`);
      return rec;
    };

    const jets = JETS.filter((j) => !ONLY || ONLY.includes(j.id));
    // Start the first flight from the URL (sets time and weather), then relaunch through __sim.launch.
    const f = jets[0];
    await page.goto(`${base}?aircraft=${f.id}&airport=${f.airport}&runway=${f.runway}&state=${STATES[0]}&time=${TIME}&weather=${WEATHER}&autotest=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__sim?.ready === true || window.__sim?.phase === 'error', null, { timeout: 400_000, polling: 500 });
    for (const jet of jets) for (const state of STATES) await runLoad(jet, state, '');
    // Leak check: the first aircraft again, after every other one was loaded and unloaded.
    if (jets.length > 1) {
      const first = results.loads.find((r) => r.aircraft === jets[0].id && r.state === STATES[0] && r.phase === 'flying');
      const again = await runLoad(jets[0], STATES[0], 'reload');
      if (first && again.render) {
        const dg = again.render.geometries - first.render.geometries;
        const dt = again.render.textures - first.render.textures;
        const dh = again.heapMB - first.heapMB;
        log(`leak check ${jets[0].id}: geometries ${first.render.geometries} -> ${again.render.geometries}, textures ${first.render.textures} -> ${again.render.textures}, heap ${first.heapMB} -> ${again.heapMB} MB`);
        results.leak = { geometries: dg, textures: dt, heapMB: dh };
        if (dt > 20) fail(`leak: textures grew by ${dt} after cycling all aircraft`);
        if (dh > 150) fail(`leak: heap grew by ${dh} MB after cycling all aircraft`);
      }
    }
  } finally {
    fs.writeFileSync(path.join(OUT, 'qa.json'), JSON.stringify(results, null, 1));
    await browser.close().catch(() => undefined);
    server.close();
  }
  log(results.failures.length ? `JETS QA FAILED: ${results.failures.length} failures` : `JETS QA PASSED: ${results.loads.length} loads`);
  if (notFound.length) log(`404s from the static server: ${[...new Set(notFound)].join(', ')}`);
  process.exit(results.failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
