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
 * Scenario (every step asserts numerically; docs/modules/qa.md lists the checks):
 *   1. Main menu with no query: menu phase, aircraft catalog, FLY enabled, no errors.
 *   2. `_test-jet` lined up at KTEB 01 (scattered weather): scenery streams in
 *      (terrain complete, runway under the aircraft), cockpit displays powered
 *      and drawing, sky visible, runway visible from the cockpit and chase views.
 *   3. Parking brake set (input command): 20 s of sim time with no drift, no
 *      bounce and every sim var finite. The frame profile of this segment is logged.
 *   4. Scripted takeoff (brakes off, full thrust through the input router, the
 *      ScriptedPilot holds the centre line with the pedals, rotates at VR and
 *      holds 10 deg): lift-off inside the runway, climb above 1000 ft AGL,
 *      gear up. Chase, orbit and tower views must show the aircraft.
 *   5. 10 nm final: trimmed (altitude within 600 ft over 10 s), ILS received.
 * Writes tests/output/{*.png, vars.json, stats.json, console.log}. Exits non-zero on failure.
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
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : String(x));

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
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.png')) fs.rmSync(path.join(OUT, f));
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
  const checks = [];
  const logLines = [];
  const pageErrors = [];
  const consoleErrors = [];
  const results = {};
  const t0 = Date.now();
  const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const log = (s) => {
    logLines.push(`[${stamp()}] ${s}`);
    console.log(`smoke ${stamp()} ${s}`);
  };
  /** Records a numeric check; failures fail the run. */
  const check = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail });
    log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${detail}`);
    if (!ok) failures.push(`${name}: ${detail}`);
  };

  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on('console', (m) => {
      const line = `[console.${m.type()}] ${m.text()}`;
      logLines.push(`[${stamp()}] ${line}`);
      if (m.type() === 'error') consoleErrors.push(m.text());
    });
    page.on('pageerror', (e) => {
      pageErrors.push(String(e?.stack || e));
      logLines.push(`[${stamp()}] [pageerror] ${e?.stack || e}`);
    });

    const shot = async (name) => {
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      log(`screenshot ${name}.png`);
    };
    const frames = () => page.evaluate(() => window.__sim.frames);
    const waitFrames = async (n, maxMs = 90_000) => {
      const start = await frames();
      await page.waitForFunction((s) => window.__sim.frames >= s, start + n, { timeout: maxMs, polling: 200 }).catch(() => log(`waitFrames(${n}) timed out`));
    };
    const simTime = () => page.evaluate(() => window.__sim.get('sim.time_s'));
    const waitSim = async (seconds, maxMs = 240_000) => {
      const s0 = await simTime();
      await page.waitForFunction((t) => window.__sim.get('sim.time_s') >= t, s0 + seconds, { timeout: maxMs, polling: 250 }).catch(() => log(`waitSim(${seconds}) timed out`));
    };
    const setView = async (mode, n = 4) => {
      await page.evaluate((m) => window.__sim.view(m), mode);
      await waitFrames(n);
    };
    /** Scans a grid of screen points around (cx, cy) for a pick of `kind`. */
    const findKind = (kind, cx = 0, cy = 0, r = 0.35) =>
      page.evaluate(
        ({ kind, cx, cy, r }) => {
          // 9 x 9 grid, visited centre-out (raycasts are slow under software GL).
          const n = 9;
          const pts = [];
          for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pts.push([cx + r * ((2 * i) / (n - 1) - 1), cy + r * ((2 * j) / (n - 1) - 1)]);
          pts.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cy) - Math.hypot(b[0] - cx, b[1] - cy));
          for (const [x, y] of pts) {
            const p = window.__sim.pick(x, y);
            if (p && p.kind === kind) return { ...p, x, y };
          }
          return null;
        },
        { kind, cx, cy, r },
      );
    const nonFinite = () => page.evaluate(() => Object.entries(window.__sim.vars()).filter(([, v]) => !Number.isFinite(v)).map(([k]) => k));

    // ---------------------------------------------------------------- 1) main menu
    log('1) main menu (no query)');
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__sim?.phase === 'menu' || window.__sim?.phase === 'error', null, { timeout: 90_000 });
    await sleep(500);
    await shot('menu');
    const menu = await page.evaluate(() => ({
      phase: window.__sim?.phase,
      titles: [...document.querySelectorAll('.amg-menu .amg-col:first-child .amg-card .amg-title')].map((t) => t.textContent || ''),
      inDev: [...document.querySelectorAll('.amg-menu .amg-col:first-child .amg-card .amg-badge')].filter((b) => /in development/i.test(b.textContent || '')).length,
      flyEnabled: !document.querySelector('#amg-fly')?.hasAttribute('disabled'),
      airportList: document.querySelectorAll('.amg-menu .amg-list-item').length,
    }));
    check('menu.phase', menu.phase === 'menu', `phase=${menu.phase}`);
    // The eight requested types (the user's list) must be offered.
    const wanted = [/Citation M2/, /Citation Longitude/, /Skyhawk.*steam/i, /Skyhawk.*G1000/i, /G650/, /G800/, /Global 6000/, /737/];
    const missing = wanted.filter((re) => !menu.titles.some((t) => re.test(t))).map(String);
    check('menu.catalog', missing.length === 0, `${menu.titles.length} aircraft (${menu.inDev} in development)${missing.length ? `; missing ${missing.join(', ')}` : ''}`);
    check('menu.fly', menu.flyEnabled && menu.airportList > 0, `FLY enabled=${menu.flyEnabled}, ${menu.airportList} departure/position entries`);
    check('menu.errors', pageErrors.length === 0, `${pageErrors.length} uncaught errors on the menu`);

    // ---------------------------------------------------------------- 2) flight start
    const q = `?aircraft=_test-jet&airport=${AIRPORT}&runway=${RUNWAY}&state=takeoff&time=15:00&weather=scattered&autotest=1`;
    log(`2) launching ${q}`);
    const launchT = Date.now();
    await page.goto(base + q, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__sim?.ready === true || window.__sim?.phase === 'error', null, { timeout: TIMEOUT_S * 1000, polling: 500 });
    const phase = await page.evaluate(() => window.__sim?.phase);
    check('flight.start', phase === 'flying', `phase=${phase} after ${((Date.now() - launchT) / 1000).toFixed(0)} s ${phase === 'error' ? await page.evaluate(() => window.__sim?.error) : ''}`);
    if (phase !== 'flying') {
      await shot('error');
      throw new Error('launch failed');
    }
    // Hold the aircraft on the parking brake while the scenery streams in.
    await page.evaluate(() => {
      if (window.__sim.get('ac.demo.park_brake') === 0) window.__sim.emit('input.parking_brake_toggle');
    });
    // Scenery: wait for the terrain LOD to converge (all desired leaves loaded, nothing pending).
    const sceneT = Date.now();
    await page
      .waitForFunction(() => {
        const w = window.__sim.stats().world;
        return w && w.terrain.completeness >= 0.98 && w.terrain.pendingUploads === 0 && w.terrain.pendingLoads === 0;
      }, null, { timeout: 120_000, polling: 500 })
      .catch(() => log('terrain did not fully converge in 120 s'));
    const world = await page.evaluate(() => window.__sim.stats().world);
    check('scenery.terrain', world.terrain.completeness >= 0.9, `completeness ${(world.terrain.completeness * 100).toFixed(0)} % (${world.terrain.shown} tiles shown, ${world.tilesLoaded} loaded, ${world.tilesFailed} failed) after ${((Date.now() - sceneT) / 1000).toFixed(0)} s`);
    check('scenery.airports', world.airports.built >= 1, `${world.airports.built} airports built, ${world.airports.lights} lights`);
    const ground = await page.evaluate(() => window.__sim.ground());
    check('scenery.runway_under_aircraft', ground.precise && /asphalt|concrete/.test(ground.surface), `surface ${ground.surface}, elevation ${fmt(ground.elevation_m, 2)} m, precise ${ground.precise}`);

    await setView('cockpit', 6);
    await sleep(500);
    await shot('cockpit');
    const displays = await page.evaluate(() => window.__sim.displays());
    const drawing = displays.filter((d) => d.powered && !d.booting && d.renders > 0 && d.lit > 0.15);
    check('cockpit.displays', displays.length > 0 && drawing.length === displays.length, displays.map((d) => `${d.id}: powered ${d.powered} renders ${d.renders} lit ${(d.lit * 100).toFixed(0)}%`).join('; '));
    const sky = await page.evaluate(() => window.__sim.pick(0, 0.85));
    check('cockpit.sky', !sky, sky ? `sky blocked by ${sky.name}` : 'nothing opaque above the horizon');
    const rwyCockpit = await findKind('airport', 0, 0.2, 0.2);
    check('cockpit.runway_visible', !!rwyCockpit, rwyCockpit ? `${rwyCockpit.name} at ndc (${fmt(rwyCockpit.x, 2)}, ${fmt(rwyCockpit.y, 2)}), ${fmt(rwyCockpit.distance_m, 0)} m` : 'no pavement visible ahead');
    await page.evaluate(() => window.__sim.emit('view.cockpit'));
    await waitFrames(3);
    await sleep(500);
    await shot('cockpit_pedestal');
    await setView('chase', 6);
    await sleep(500);
    await shot('chase_lineup');
    const acChase = await findKind('aircraft', 0, 0, 0.4);
    const rwyChase = await findKind('airport', 0, -0.55, 0.3);
    check('chase.aircraft_visible', !!acChase, acChase ? `${acChase.name} at ${fmt(acChase.distance_m, 0)} m` : 'aircraft not found near the screen centre');
    check('chase.runway_visible', !!rwyChase, rwyChase ? `${rwyChase.name} at ${fmt(rwyChase.distance_m, 0)} m` : 'no pavement under the aircraft');
    await setView('cockpit', 3);

    // ---------------------------------------------------------------- 3) stability on the parking brake
    log('3) 20 s on the parking brake');
    const park = await page.evaluate(() => window.__sim.get('ac.demo.park_brake'));
    check('ground.parking_brake', park === 1, `ac.demo.park_brake=${park} (set through input.parking_brake_toggle)`);
    await waitSim(2);
    await page.evaluate(() => window.__sim.profile(true));
    const keys = ['fdm.lat_deg', 'fdm.lon_deg', 'fdm.alt_msl_ft', 'fdm.pitch_deg', 'fdm.bank_deg', 'fdm.hdg_true_deg', 'fdm.gs_kt', 'fdm.on_ground', 'eng1.n1_pct', 'eng2.n1_pct', 'elec.main_v'];
    const samples = [];
    const stabT0 = await simTime();
    while ((await simTime()) < stabT0 + 20) {
      samples.push(await page.evaluate((k) => Object.fromEntries(k.map((n) => [n, window.__sim.get(n)])), keys));
      await sleep(400);
    }
    const profileGround = await page.evaluate(() => window.__sim.profile(true));
    const first = samples[0];
    const last = samples[samples.length - 1];
    const span = (k) => Math.max(...samples.map((s) => s[k])) - Math.min(...samples.map((s) => s[k]));
    const mPerDegLat = 111_132;
    const drift = Math.hypot((last['fdm.lat_deg'] - first['fdm.lat_deg']) * mPerDegLat, (last['fdm.lon_deg'] - first['fdm.lon_deg']) * mPerDegLat * Math.cos((first['fdm.lat_deg'] * Math.PI) / 180));
    const maxGs = Math.max(...samples.map((s) => s['fdm.gs_kt']));
    check('ground.samples', samples.length >= 10, `${samples.length} samples over 20 s of sim time`);
    check('ground.no_drift', drift < 0.5 && maxGs < 0.3, `drift ${fmt(drift, 3)} m, max GS ${fmt(maxGs, 3)} kt`);
    check('ground.no_bounce', span('fdm.alt_msl_ft') < 0.5 && span('fdm.pitch_deg') < 0.3 && span('fdm.bank_deg') < 0.3, `alt span ${fmt(span('fdm.alt_msl_ft'), 3)} ft, pitch span ${fmt(span('fdm.pitch_deg'), 3)} deg, bank span ${fmt(span('fdm.bank_deg'), 3)} deg`);
    check('ground.heading', span('fdm.hdg_true_deg') < 0.3, `heading span ${fmt(span('fdm.hdg_true_deg'), 3)} deg`);
    check('ground.on_ground', samples.every((s) => s['fdm.on_ground'] === 1), 'weight on wheels throughout');
    check('ground.engines', samples.every((s) => s['eng1.n1_pct'] > 20 && s['eng2.n1_pct'] > 20) && last['elec.main_v'] > 26, `N1 ${fmt(last['eng1.n1_pct'])}/${fmt(last['eng2.n1_pct'])} %, main bus ${fmt(last['elec.main_v'])} V`);
    const nf1 = await nonFinite();
    check('ground.finite', nf1.length === 0, nf1.length ? `non-finite vars: ${nf1.slice(0, 10).join(', ')}` : 'every sim var finite');
    results.profileGround = profileGround;
    log(`profile (cockpit, stationary): frame interval ${fmt(profileGround.frameIntervalMs)} ms over ${profileGround.frames} frames; ${profileGround.sections.slice(0, 7).map((s) => `${s.name} ${fmt(s.msPerFrame, 2)}`).join(', ')} ms/frame`);

    // ---------------------------------------------------------------- 4) scripted takeoff
    log('4) scripted takeoff');
    await setView('chase', 3);
    await page.evaluate(() => {
      window.__sim.emit('input.parking_brake_toggle');
      window.__sim.emit('input.throttle_full');
    });
    await waitFrames(2);
    const lever = await page.evaluate(() => ({ park: window.__sim.get('ac.demo.park_brake'), tla1: window.__sim.get('ac.demo.tla1'), tla2: window.__sim.get('ac.demo.tla2') }));
    check('takeoff.controls', lever.park === 0 && lever.tla1 === 1 && lever.tla2 === 1, `parking brake ${lever.park}, thrust levers ${lever.tla1}/${lever.tla2}`);
    const pilotPhase = await page.evaluate(() => window.__sim.pilot.takeoff());
    const place = await page.evaluate(() => window.__sim.stats().placement);
    log(`pilot ${pilotPhase}; runway ${place?.runway}`);
    await page.evaluate(() => window.__sim.profile(true));
    await waitSim(6);
    await shot('chase_roll');
    const rollCheck = await page.evaluate(() => ({ gs: window.__sim.get('fdm.gs_kt'), phase: window.__sim.pilot.state().phase }));
    const rwyRoll = await findKind('airport', 0, -0.55, 0.3);
    check('takeoff.accelerating', rollCheck.gs > 15, `GS ${fmt(rollCheck.gs)} kt after 6 s (${rollCheck.phase})`);
    check('takeoff.runway_visible', !!rwyRoll, rwyRoll ? `${rwyRoll.name} under the aircraft in chase view` : 'no pavement visible under the rolling aircraft');
    await page
      .waitForFunction(() => {
        const s = window.__sim.pilot.state();
        return (s.phase === 'climb' && window.__sim.get('fdm.alt_agl_ft') > 1100) || window.__sim.get('fdm.crashed') !== 0 || s.log.elapsedS > 90;
      }, null, { timeout: 360_000, polling: 500 })
      .catch(() => log('takeoff: climb target not reached in time'));
    const profileFlight = await page.evaluate(() => window.__sim.profile(true));
    results.profileFlight = profileFlight;
    const to = await page.evaluate(() => ({ ...window.__sim.pilot.state(), v: window.__sim.vars(['fdm.', 'gear.', 'ac.demo.gear']) }));
    const L = to.log;
    const vr = 110; // _test-jet meta.typical.rotateKias
    const rwyLenM = 6997 * 0.3048; // KTEB 1/19 (FAA 5010), placement 45 m from the pavement end
    results.takeoff = L;
    log(`takeoff: rotate ${fmt(L.rotateIasKt)} kt, lift-off ${fmt(L.liftoffIasKt)} kt at ${fmt(L.liftoffDistM, 0)} m / ${fmt(L.liftoffTimeS)} s, max centre-line deviation ${fmt(L.maxGroundDeviationM, 2)} m, max pitch ${fmt(L.maxPitchDeg)} deg, AGL ${fmt(to.v['fdm.alt_agl_ft'], 0)} ft, VS ${fmt(to.v['fdm.vs_fpm'], 0)} fpm, IAS ${fmt(to.v['fdm.ias_kt'], 0)} kt`);
    check('takeoff.no_crash', to.v['fdm.crashed'] === 0, `crashed=${to.v['fdm.crashed']}`);
    check('takeoff.rotate_at_vr', L.rotateIasKt >= vr && L.rotateIasKt < vr + 5, `rotation at ${fmt(L.rotateIasKt)} kt (VR ${vr})`);
    check('takeoff.liftoff', L.liftoffIasKt > vr && L.liftoffIasKt < vr + 25 && L.liftoffDistM > 200 && L.liftoffDistM < rwyLenM - 45, `lift-off ${fmt(L.liftoffIasKt)} kt after ${fmt(L.liftoffDistM, 0)} m of ${fmt(rwyLenM - 45, 0)} m available`);
    check('takeoff.centre_line', L.maxGroundDeviationM < 10, `max deviation ${fmt(L.maxGroundDeviationM, 2)} m (runway half-width 22.9 m)`);
    check('takeoff.rotation', L.maxPitchDeg > 8 && L.maxPitchDeg < 13, `max pitch ${fmt(L.maxPitchDeg)} deg (target 10)`);
    check('takeoff.climb', to.phase === 'climb' && to.v['fdm.alt_agl_ft'] > 1000 && to.v['fdm.vs_fpm'] > 500, `${to.phase}, ${fmt(to.v['fdm.alt_agl_ft'], 0)} ft AGL, ${fmt(to.v['fdm.vs_fpm'], 0)} fpm`);
    check('takeoff.gear_up', L.gearUpCommanded && to.v['ac.demo.gear_handle'] === 1 && to.v['gear.pos1'] < 0.05, `gear handle ${to.v['ac.demo.gear_handle']}, left main position ${fmt(to.v['gear.pos1'], 2)}`);
    await shot('climb_chase');
    for (const [mode, n] of [
      ['orbit', 8],
      ['tower', 10],
    ]) {
      await setView(mode, n);
      await sleep(500);
      await shot(`climb_${mode}`);
      const ac = await findKind('aircraft', 0, 0, mode === 'tower' ? 0.5 : 0.4);
      check(`view.${mode}`, !!ac, ac ? `aircraft visible (${ac.name}, ${fmt(ac.distance_m, 0)} m)` : 'aircraft not visible near the screen centre');
    }
    await setView('cockpit', 4);
    await sleep(500);
    await shot('climb_cockpit');
    const nf2 = await nonFinite();
    check('takeoff.finite', nf2.length === 0, nf2.length ? `non-finite vars: ${nf2.slice(0, 10).join(', ')}` : 'every sim var finite');
    await page.evaluate(() => window.__sim.pilot.stop());

    // ---------------------------------------------------------------- 5) 10 nm final
    log('5) 10 nm final');
    await page.evaluate(() => window.__sim.launch({ state: 'approach', spot: { kind: 'auto' } }));
    await page.waitForFunction(() => window.__sim.ready === true || window.__sim.phase === 'error', null, { timeout: TIMEOUT_S * 1000, polling: 500 });
    await waitFrames(6);
    const appr0 = await page.evaluate(() => window.__sim.vars(['fdm.', 'sim.']));
    await waitSim(10, 180_000);
    const appr1 = await page.evaluate(() => window.__sim.vars(['fdm.', 'sim.', 'nav1.']));
    const apprPlace = await page.evaluate(() => window.__sim.stats().placement);
    await shot('approach_cockpit');
    await setView('chase', 4);
    await sleep(500);
    await shot('approach_chase');
    const dAlt = appr1['fdm.alt_msl_ft'] - appr0['fdm.alt_msl_ft'];
    log(`approach: ${apprPlace?.description}; alt ${fmt(appr0['fdm.alt_msl_ft'], 0)} -> ${fmt(appr1['fdm.alt_msl_ft'], 0)} ft, IAS ${fmt(appr1['fdm.ias_kt'], 0)}, NAV1 ${appr1['nav1.active_mhz']} loc=${appr1['nav1.is_loc']} received=${appr1['nav1.received']} gs_valid=${appr1['nav1.gs_valid']} cdi=${fmt(appr1['nav1.cdi'], 2)}`);
    check('approach.flying', !appr1['fdm.on_ground'] && !appr1['fdm.crashed'], `on_ground ${appr1['fdm.on_ground']} crashed ${appr1['fdm.crashed']}`);
    check('approach.trimmed', Math.abs(dAlt) < 600, `altitude changed ${fmt(dAlt, 0)} ft in 10 s`);
    if (apprPlace?.ils) check('approach.ils', appr1['nav1.received'] === 1 && appr1['nav1.is_loc'] === 1 && Math.abs(appr1['nav1.cdi']) < 0.5, `ILS ${apprPlace.ils.ident} ${apprPlace.ils.freqMhz}: received ${appr1['nav1.received']}, CDI ${fmt(appr1['nav1.cdi'], 2)}`);
    const acAppr = await findKind('aircraft', 0, 0, 0.4);
    check('approach.chase_aircraft', !!acAppr, acAppr ? 'aircraft visible in chase view' : 'aircraft not visible');

    fs.writeFileSync(path.join(OUT, 'vars.json'), JSON.stringify(await page.evaluate(() => window.__sim.vars()), null, 1));
    results.stats = await page.evaluate(() => window.__sim.stats());
  } catch (e) {
    failures.push(`smoke aborted: ${e?.message ?? e}`);
    if (page) await page.screenshot({ path: path.join(OUT, 'error.png') }).catch(() => undefined);
  } finally {
    await browser.close().catch(() => undefined);
    server.close();
  }

  check('page.errors', pageErrors.length === 0, pageErrors.length ? `${pageErrors.length} uncaught page error(s): ${pageErrors[0].split('\n')[0]}` : 'no uncaught page errors');
  // Console errors: missing optional resources are expected offline; anything else is a failure.
  const unexpected = [...new Set(consoleErrors)].filter((m) => !/Failed to load resource|net::ERR_|status of 404/.test(m));
  check('console.errors', unexpected.length === 0, unexpected.length ? unexpected.slice(0, 3).join(' | ') : `${consoleErrors.length} resource-load messages only`);
  fs.writeFileSync(path.join(OUT, 'stats.json'), JSON.stringify({ checks, ...results }, null, 2));
  fs.writeFileSync(path.join(OUT, 'console.log'), logLines.join('\n'));
  const passed = checks.filter((c) => c.ok).length;
  if (failures.length) {
    console.error(`\nSMOKE FAILED (${passed}/${checks.length} checks passed):\n - ` + failures.join('\n - '));
    process.exit(1);
  }
  console.log(`\nSMOKE PASSED: ${passed}/${checks.length} checks in ${((Date.now() - t0) / 1000).toFixed(0)} s. Screenshots in tests/output/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
