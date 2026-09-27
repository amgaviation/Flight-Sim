/**
 * Development preview of the G1000 NXi suite (not part of the app bundle):
 * shows the PFD and MFD side by side with a scripted 172S flight state so the
 * formats can be screenshotted and inspected.
 *
 *   npx vite --port 5199  ->  http://localhost:5199/src/avionics/garmin-g1000/dev/preview.html?state=cruise
 *
 * Query: state = cruise | approach | ground | rev | boot | splash; page = MFD page id (e.g. aux_setup,
 * nrst_apt, fpl, wpt_apt, map_terrain); win = PFD window id (tmrref, nearest, fpl, dto, proc, alerts);
 * eis = engine | lean | system; map = inset | hsi. `window.__g1k` exposes the suite for automation;
 * `window.__g1kReady` turns true once loaded.
 */
import { SimVars } from '../../../core/SimVars';
import { EventBus } from '../../../core/EventBus';
import { ADC, AP, FDM } from '../../../core/vars';
import { createNavDatabase } from '../../../nav/NavDatabase';
import { Afcs } from '../../../systems/autopilot';
import { G1000Suite } from '../Suite';
import { C172S_NXI } from '../presets';
import { AFCS_GFC700_NXI } from '../state/afcs';
import { G1K, PFD_MAP } from '../vars';
import type { PfdWindowId } from '../state/System';

const q = new URLSearchParams(location.search);
const state = q.get('state') ?? 'cruise';

async function main(): Promise<void> {
  const vars = new SimVars();
  const events = new EventBus();
  const nav = createNavDatabase({ baseUrl: '/data/' });
  await nav.load();
  const suite = new G1000Suite(
    { vars, events, nav },
    {
      ...C172S_NXI,
      power: {},
      aglFt: 3000,
      checklists: [
        { title: 'Before Takeoff', phase: 'Normal', items: [{ challenge: 'Parking Brake', response: 'SET' }, { challenge: 'Flight Controls', response: 'FREE AND CORRECT' }, { challenge: 'Altimeters', response: 'SET' }] },
        { title: 'Engine Fire In Flight', phase: 'Emergency', items: [{ challenge: 'Mixture', response: 'IDLE CUTOFF' }, { challenge: 'Fuel Shutoff Valve', response: 'OFF' }] },
      ],
    },
    { canvas: 'dom' },
  );
  const afcs = new Afcs({ vars, events, nav }, { ...AFCS_GFC700_NXI, ...suite.afcsWiring() });
  const systems = [...suite.systems, afcs];

  const approach = state === 'approach';
  const ground = state === 'ground' || state === 'boot' || state === 'splash';
  const lat = approach ? 42.3 : ground ? 41.06 : 41.3;
  const lon = approach ? -71.1 : ground ? -73.71 : -73.2;
  const alt = approach ? 2200 : ground ? 439 : 5500;
  const hdg = approach ? 42 : ground ? 160 : 62;
  const ias = approach ? 85 : ground ? 0 : 112;
  const setTruth = (t: number): void => {
    const pitch = approach ? -1.5 : ground ? 0 : 1.2 + Math.sin(t * 0.3) * 0.3;
    const bank = ground ? 0 : Math.sin(t * 0.2) * 4;
    vars.set(FDM.lat, lat);
    vars.set(FDM.lon, lon);
    vars.set(FDM.altMsl, alt);
    vars.set(FDM.gs, ground ? 0 : ias * 1.08);
    vars.set(FDM.trackTrue, hdg - 13);
    vars.set(FDM.headingTrue, hdg - 13);
    vars.set(FDM.vs, approach ? -450 : 0);
    vars.set(ADC.valid(1), 1);
    vars.set(ADC.ahrsValid(1), 1);
    vars.set(ADC.ias(1), ias + Math.sin(t) * 0.6);
    vars.set(ADC.tas(1), ias * (ground ? 1 : 1.08));
    vars.set(ADC.baroAlt(1), alt + Math.sin(t * 0.5) * 5);
    vars.set(ADC.vs(1), approach ? -450 : 0);
    vars.set(ADC.sat(1), approach ? 9 : ground ? 17 : 4);
    vars.set(ADC.pitch(1), pitch);
    vars.set(ADC.bank(1), bank);
    vars.set(ADC.heading(1), hdg);
    vars.set(ADC.headingTrue(1), hdg - 13);
    vars.set(ADC.turnRate(1), bank * 0.1);
    if (!vars.has(ADC.baroSetting(1))) vars.set(ADC.baroSetting(1), 30.01);
    vars.set('gear.air_ground', ground ? 1 : 0);
    const running = state !== 'boot' && state !== 'splash';
    vars.set('eng1.rpm', running ? (ground ? 1000 : approach ? 1900 : 2450) : 0);
    vars.set('eng1.ff_gph', running ? (ground ? 2.1 : approach ? 5.5 : 8.6) : 0);
    vars.set('eng1.oil_press_psi', running ? 68 : 0);
    vars.set('eng1.oil_temp_f', running ? 185 : 60);
    vars.set('eng1.egt_f', running ? (ground ? 1150 : 1420) : 60);
    vars.set('eng1.cht_f', running ? (ground ? 250 : 360) : 60);
    vars.set('ac.vac.suction_inhg', running ? 5.0 : 0);
    vars.set('fuel.left_ind_kg', 18.5 * 2.7216);
    vars.set('fuel.right_ind_kg', 17.8 * 2.7216);
    vars.set('ac.c172.m_bus_v', running ? 28.1 : 24.2);
    vars.set('ac.c172.e_bus_v', running ? 28.0 : 24.1);
    vars.set('ac.c172.m_batt_a', running ? 1.8 : -4.5);
    vars.set('ac.c172.s_batt_a', 0);
  };
  setTruth(0);
  if (state !== 'boot' && state !== 'splash') suite.applyState(ground ? 'ready_to_taxi' : approach ? 'approach' : 'cruise');
  suite.radios?.gps?.forceAcquired();
  // One update so the GPS position is valid before the flight plan identifiers are resolved (nearest first).
  for (const s of systems) s.update(1 / 60);

  const fpl = suite.system.fpl!;
  if (approach) {
    fpl.setOrigin('KHPN');
    fpl.setDestination('KBOS');
    const procs = await fpl.loadProcedures('KBOS');
    const ils = procs?.approaches.find((a) => a.approachType === 'ILS' && a.runways.includes('04R')) ?? procs?.approaches.find((a) => a.approachType === 'ILS');
    if (ils) fpl.loadApproach('KBOS', ils.ident, undefined, 'vtf');
    vars.set(AP.selAltitude, 2000);
    suite.system.refs.mins.setMode(1);
    suite.system.refs.mins.setValue(1300);
  } else if (!ground) {
    fpl.setOrigin('KHPN');
    for (const id of ['CMK', 'BDR', 'MAD']) {
      const all = fpl.resolve(id);
      const w = all.find((x) => x.kind !== 'airport') ?? all[0];
      if (w) fpl.appendEnroute(w);
    }
    fpl.setDestination('KHVN');
    vars.set(AP.selAltitude, 5500);
  } else {
    fpl.setOrigin('KHPN');
    fpl.setDestination('KHVN');
  }
  vars.set(AP.selHeading, hdg);
  vars.set(G1K.pfdMap, q.get('map') === 'hsi' ? PFD_MAP.hsi : PFD_MAP.inset);
  vars.set(G1K.brg1Source, 1);
  vars.set(G1K.brg2Source, 3);
  vars.set(G1K.dmeWindow, 1);
  if (state === 'rev') vars.set(G1K.displayBackup, 1);
  const eis = q.get('eis');
  if (eis) vars.set(G1K.eisPage, eis === 'lean' ? 1 : eis === 'system' ? 2 : 0);
  suite.system.refs.vspeeds.setAll(true);

  const row = document.getElementById('row1')!;
  const displays = suite.displayList();
  for (const d of displays) {
    const wrap = document.createElement('div');
    const l = document.createElement('span');
    l.className = 'lbl';
    l.textContent = d.id;
    wrap.appendChild(l);
    wrap.appendChild(d.canvas as HTMLCanvasElement);
    row.appendChild(wrap);
  }
  let t = 0;
  const step = (dt: number): void => {
    t += dt;
    setTruth(t);
    for (const s of systems) s.update(dt);
  };
  // 'splash': run past the 15 s GDU boot to the MFD power-on page.
  for (let i = 0; i < (state === 'splash' ? 17 : 2) * 60; i++) step(1 / 60);
  if (!ground) {
    events.emit('g1k.pfd.key_ap');
    if (approach) {
      events.emit('g1k.pfd.key_hdg');
      events.emit('g1k.pfd.key_apr');
    } else {
      events.emit('g1k.pfd.key_nav');
      events.emit('g1k.pfd.key_alt');
    }
  }
  const page = q.get('page');
  if (page) suite.system.mfd.selectById(page);
  const win = q.get('win');
  if (win) suite.system.openPfdWindow(win as PfdWindowId);
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
  (window as unknown as { __g1k: unknown }).__g1k = { suite, vars, events, step, render: () => displays.forEach((d) => d.render(1 / 30)) };
  (window as unknown as { __g1kReady: boolean }).__g1kReady = true;
}

main().catch((e) => {
  document.body.textContent = String((e as Error).stack ?? e);
  console.error(e);
});
