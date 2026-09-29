/**
 * Development preview of the G3000 / G5000 suite (not part of the app
 * bundle): serves every display side by side with a scripted flight state so
 * the formats can be screenshotted and inspected.
 *
 *   npx vite --port 5199   ->  http://localhost:5199/src/avionics/garmin-g3000/dev/preview.html?ac=m2&state=cruise
 *
 * Query: ac = m2 | longitude; state = cruise | approach | ground | split |
 * rev | boot. `window.__g3k` exposes the suite (tap GTC buttons, press
 * softkeys) for automation; `window.__g3kReady` turns true once loaded.
 */
import { SimVars } from '../../../core/SimVars';
import { EventBus } from '../../../core/EventBus';
import { ADC, AP, FDM, GPS, NAV } from '../../../core/vars';
import { createNavDatabase } from '../../../nav/NavDatabase';
import { Afcs, AFCS_GFC700_G3000, AFCS_GFC_G5000 } from '../../../systems/autopilot';
import { G3000Suite } from '../Suite';
import { G3000_M2_LAYOUT, G5000_LONGITUDE_LAYOUT } from '../presets';
import { G3K, PANE_CONTENT } from '../vars';
import type { SynopticPageDef } from '../gdu/synoptic';

const q = new URLSearchParams(location.search);
const ac = q.get('ac') ?? 'm2';
const state = q.get('state') ?? 'cruise';

const FUEL_SYN: SynopticPageDef = {
  id: 'fuel',
  title: 'FUEL',
  width: 500,
  height: 640,
  elements: [
    { type: 'aircraft', x: 250, y: 300, scale: 1 },
    { type: 'tank', x: 90, y: 200, w: 90, h: 200, qty: 'fuel.tank0_kg * 2.20462', capacity: 1648, label: 'L', unit: 'LB' },
    { type: 'tank', x: 320, y: 200, w: 90, h: 200, qty: 'fuel.tank1_kg * 2.20462', capacity: 1648, label: 'R', unit: 'LB' },
    { type: 'pump', x: 135, y: 440, on: 'ac.fuel.boost_l', label: 'BOOST' },
    { type: 'pump', x: 365, y: 440, on: 'ac.fuel.boost_r', label: 'BOOST' },
    { type: 'line', points: [135, 400, 135, 520, 180, 560], active: 1 },
    { type: 'line', points: [365, 400, 365, 520, 320, 560], active: 1 },
    { type: 'engine', x: 180, y: 580, label: 'ENG 1', running: 'eng1.running' },
    { type: 'engine', x: 320, y: 580, label: 'ENG 2', running: 'eng2.running' },
  ],
  controls: [
    { label: 'L Boost', kind: 'toggle', var: 'ac.fuel.boost_l' },
    { label: 'R Boost', kind: 'toggle', var: 'ac.fuel.boost_r' },
  ],
};

async function main(): Promise<void> {
  const vars = new SimVars();
  const events = new EventBus();
  const nav = createNavDatabase({ baseUrl: '/data/' });
  await nav.load();
  const layout = ac === 'longitude' ? G5000_LONGITUDE_LAYOUT : G3000_M2_LAYOUT;
  const gtcs580 = q.get('gtc') === '580' ? { gtcs: [{ id: 'gtc1' as const, model: 'GTC580' as const, side: 1 as const, modes: ['MFD' as const, 'PFD' as const, 'NAVCOM' as const] }] } : {};
  const suite = new G3000Suite({ vars, events, nav }, { ...layout, ...gtcs580, aircraftId: ac, synoptics: [FUEL_SYN], checklists: [
    { title: 'Before Takeoff', phase: 'Normal', items: [{ challenge: 'Flaps', response: 'T/O' }, { challenge: 'Trim', response: 'SET' }, { challenge: 'Avionics', response: 'CHECKED' }] },
  ] }, { canvas: 'dom' });
  const afcs = new Afcs({ vars, events, nav }, ac === 'longitude' ? AFCS_GFC_G5000 : AFCS_GFC700_G3000);
  const systems = [...suite.systems, afcs];

  // Position / state.
  const approach = state === 'approach';
  const ground = state === 'ground' || state === 'boot';
  const lat = approach ? 42.30 : ground ? 40.85 : 41.6;
  const lon = approach ? -71.05 : ground ? -74.06 : -72.6;
  const alt = approach ? 2200 : ground ? 9 : 25000;
  const hdg = approach ? 42 : ground ? 190 : 52;
  const ias = approach ? 140 : ground ? 0 : 250;
  const setTruth = (t: number): void => {
    const pitch = approach ? -2.5 : ground ? 0 : 1.8 + Math.sin(t * 0.3) * 0.4;
    const bank = ground ? 0 : Math.sin(t * 0.2) * 3;
    vars.set(FDM.lat, lat);
    vars.set(FDM.lon, lon);
    vars.set(FDM.altMsl, alt);
    vars.set(FDM.gs, ground ? 0 : ias * 1.25);
    vars.set(FDM.trackTrue, hdg - 14);
    vars.set(FDM.headingTrue, hdg - 14);
    vars.set(FDM.vs, approach ? -750 : 0);
    for (const s of [1, 2]) {
      vars.set(ADC.valid(s), 1);
      vars.set(ADC.ahrsValid(s), 1);
      vars.set(ADC.ias(s), ias + Math.sin(t) * 0.8);
      vars.set(ADC.tas(s), ias * (approach ? 1.05 : ground ? 1 : 1.45));
      vars.set(ADC.mach(s), ground ? 0 : approach ? 0.22 : 0.63);
      vars.set(ADC.baroAlt(s), alt + Math.sin(t * 0.5) * 5);
      vars.set(ADC.vs(s), approach ? -750 : 0);
      vars.set(ADC.sat(s), approach ? 8 : ground ? 15 : -34);
      vars.set(ADC.pitch(s), pitch);
      vars.set(ADC.bank(s), bank);
      vars.set(ADC.heading(s), hdg);
      vars.set(ADC.headingTrue(s), hdg - 14);
      if (!vars.has(ADC.baroSetting(s))) vars.set(ADC.baroSetting(s), 29.92);
    }
    vars.set('ra1.valid', 1);
    vars.set('ra1.alt_ft', approach ? 2100 : ground ? 0 : 3000);
    vars.set('stall.aoa_norm', approach ? 0.45 : 0.25);
    vars.set('gear.air_ground', ground ? 1 : 0);
    vars.set('gear.down_locked', approach || ground ? 1 : 0);
    vars.set('surf.flaps_deg', approach ? 35 : ground ? 15 : 0);
    const running = state !== 'boot';
    for (const e of [1, 2]) {
      vars.set(`eng${e}.running`, running ? 1 : 0);
      vars.set(`eng${e}.n1_pct`, running ? (ground ? 24 : approach ? 62 : 89.4) + e * 0.2 : 0);
      vars.set(`eng${e}.itt_c`, running ? (ground ? 480 : approach ? 640 : 790) : 20);
      vars.set(`eng${e}.n2_pct`, running ? (ground ? 58 : approach ? 80 : 94.5) : 0);
      vars.set(`eng${e}.oil_press_psi`, running ? 72 : 0);
      vars.set(`eng${e}.oil_temp_c`, running ? 88 : 15);
      vars.set(`eng${e}.ff_pph`, running ? (ground ? 230 : approach ? 520 : 610) : 0);
    }
    vars.set('fuel.tank0_kg', 560);
    vars.set('fuel.tank1_kg', 548);
    vars.set('fuel.total_kg', 1108);
    vars.set('press.cabin_alt_ft', ground ? 10 : 6500);
    vars.set('press.diff_psi', ground ? 0 : 7.9);
    vars.set('env.time_utc_h', 14.25);
  };
  setTruth(0);
  suite.radios?.gps?.forceAcquired();
  if (state !== 'boot') suite.applyState(ground ? 'ready_to_taxi' : approach ? 'approach' : 'cruise');

  // Flight plan.
  const fpl = suite.system.fpl!;
  if (approach) {
    fpl.setOrigin('KJFK');
    fpl.setDestination('KBOS');
    const procs = await fpl.loadProcedures('KBOS');
    const ils = procs?.approaches.find((a) => a.approachType === 'ILS' && a.runways.includes('04R')) ?? procs?.approaches.find((a) => a.approachType === 'ILS');
    if (ils) fpl.loadApproach('KBOS', ils.ident, undefined, 'vtf');
    vars.set(AP.selAltitude, 2000);
  } else if (!ground) {
    fpl.setOrigin('KTEB');
    for (const id of ['DIXIE', 'MERIT', 'HFD', 'PUT']) {
      const all = fpl.resolve(id);
      const w = all.find((x) => x.kind !== 'airport') ?? all[0];
      if (w) fpl.appendEnroute(w);
    }
    fpl.setDestination('KBOS');
    fpl.setCruiseAltitude(25000);
    vars.set(AP.selAltitude, 25000);
  } else {
    fpl.setOrigin('KTEB');
    fpl.setDestination('KBOS');
  }
  vars.set(AP.selHeading, hdg);
  if (state === 'split') {
    suite.system.setPfdSplit(1, true);
    suite.system.setPaneContent('pfd1', PANE_CONTENT.traffic);
    suite.system.setPaneContent('mfd2', PANE_CONTENT.synoptics, 0);
    vars.set(G3K.pfdMap(2), 1);
  }
  if (state === 'rev') vars.set(G3K.reversionSwitch('mfd'), 1);
  vars.set(G3K.pfdMap(1), state === 'split' ? 0 : 1);
  vars.set(G3K.brg1Source(1), 1);
  vars.set(G3K.brg2Source(1), 3);

  // DOM.
  const row1 = document.getElementById('row1')!;
  const row2 = document.getElementById('row2')!;
  const add = (row: HTMLElement, d: { id: string; canvas: HTMLCanvasElement | OffscreenCanvas }): void => {
    const wrap = document.createElement('div');
    const l = document.createElement('span');
    l.className = 'lbl';
    l.textContent = d.id;
    wrap.appendChild(l);
    wrap.appendChild(d.canvas as HTMLCanvasElement);
    row.appendChild(wrap);
  };
  const displays = suite.displayList();
  for (const d of displays) add(d.id.startsWith('gtc') ? row2 : row1, d);
  // Pointer passthrough for GTCs and softkeys.
  for (const d of displays) {
    const c = d.canvas as HTMLCanvasElement;
    const pos = (e: MouseEvent): [number, number] => {
      const r = c.getBoundingClientRect();
      return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height];
    };
    c.addEventListener('mousedown', (e) => d.onPointer?.(...pos(e), 'down'));
    c.addEventListener('mouseup', (e) => d.onPointer?.(...pos(e), 'up'));
    c.addEventListener('mousemove', (e) => d.onPointer?.(...pos(e), 'move'));
  }

  let t = 0;
  const step = (dt: number): void => {
    t += dt;
    setTruth(t);
    for (const s of systems) s.update(dt);
  };
  // Warm up (boot timers, FMS geometry), then engage the AFCS, then let the modes settle.
  const warm = state === 'boot' ? 3 : 2;
  for (let i = 0; i < warm * 60; i++) step(1 / 60);
  if (!ground && state !== 'boot') {
    events.emit('ap.fd');
    events.emit('ap.ap');
    if (approach) {
      events.emit('ap.hdg');
      events.emit('g3k.gmc.key_apr');
    } else {
      events.emit('ap.nav');
      events.emit('ap.vnav');
    }
  }
  for (let i = 0; i < 2 * 60; i++) step(1 / 60);
  for (const d of displays) d.render(1 / 30);
  let last = performance.now();
  const loop = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const n = Math.max(1, Math.round(dt * 60));
    for (let i = 0; i < n; i++) step(dt / n);
    for (const d of displays) d.render(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  (window as unknown as { __g3k: unknown; __g3kReady: boolean }).__g3k = { suite, vars, events, step, render: () => displays.forEach((d) => d.render(1 / 30)) };
  (window as unknown as { __g3kReady: boolean }).__g3kReady = true;
}

main().catch((e) => {
  document.body.textContent = String((e as Error).stack ?? e);
  console.error(e);
});

void GPS;
void NAV;
