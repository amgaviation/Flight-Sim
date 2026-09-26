/**
 * Development preview of the Pro Line Fusion suite (not part of the app
 * bundle): the four AFDs in the T arrangement, both CTPs and the IESI with
 * a scripted flight state, for screenshots and visual inspection.
 *
 *   npx vite --port 5199  ->  http://localhost:5199/src/avionics/collins-fusion/dev/preview.html?state=cruise
 *
 * Query: state = cruise | approach | ground | boot | rev | split;
 * sys = synoptic page 0-9 on the SYSTEMS window; menu = 1 opens the window
 * menu on AFD 3; ctp = radio | pfd | hsi; win = content code forced into
 * AFD 3 R; chkl = 1 shows the checklist on AFD 3 R; mem = display memory
 * recalled (2 = full PFDs); fms / fms2 = FMS page ids of the two FMS windows. Terrain is a synthetic
 * sine field (SVS / VSD / EVS check only). `window.__fusion` exposes the
 * suite; `window.__fusionReady` turns true once loaded.
 */
import { SimVars } from '../../../core/SimVars';
import { EventBus } from '../../../core/EventBus';
import { ADC, AP, GPS, NAV } from '../../../core/vars';
import { createNavDatabase } from '../../../nav/NavDatabase';
import { Fms } from '../../../nav/fms/Fms';
import { Afcs, AFCS_PROLINE_FUSION } from '../../../systems/autopilot';
import { createFusionSuite } from '../suite';
import { BR710A2_20_ENGINES, GLOBAL6000_AIRFRAME } from '../config';
import { FUSION_EVENTS, FUSION_VARS, Win } from '../vars';
import type { WorldQuery } from '../../../world/types';

const q = new URLSearchParams(location.search);
const state = q.get('state') ?? 'cruise';

/** Synthetic terrain (m): rolling hills, sea west of lon -71.0. */
const world: WorldQuery = {
  elevationAt: (lat: number, lon: number) => {
    const h = 380 + 320 * Math.sin(lat * 23) * Math.cos(lon * 17) + 160 * Math.sin(lat * 71 + lon * 53);
    return lon > -71.0 ? -1 : Math.max(0, h);
  },
  sampleGround: () => ({ elevation: 0, normal: { x: 0, y: 1, z: 0 }, surface: 'asphalt' }) as never,
  ensureLoaded: async () => {},
};

async function main(): Promise<void> {
  const vars = new SimVars();
  const events = new EventBus();
  const nav = createNavDatabase({ baseUrl: '/data/' });
  await nav.load();
  const fms = new Fms({ vars, events, nav }, { style: 'boeing', engineCount: 2 });
  const checklists = [
    { title: 'Before Start', phase: 'Normal', items: [{ challenge: 'Parking brake', response: 'SET' }, { challenge: 'Batteries', response: 'ON' }, { challenge: 'APU', response: 'RUNNING' }] },
    { title: 'Before Takeoff', phase: 'Normal', items: [{ challenge: 'Flaps', response: '6 / 16' }, { challenge: 'Trim', response: 'SET' }, { challenge: 'Avionics', response: 'CHECKED' }, { challenge: 'Transponder', response: 'TA/RA' }] },
    { title: 'Hydraulic System 1 Low Pressure', phase: 'Non-Normal', items: [{ challenge: 'HYD PUMP 1B', response: 'ON' }, { challenge: 'Landing distance', response: 'CHECK' }] },
  ];
  const suite = createFusionSuite({ vars, events, nav, world, fms, canvas: 'dom' }, { airframe: GLOBAL6000_AIRFRAME, engines: BR710A2_20_ENGINES, checklists, casChecklists: { hyd1_lo: 'Hydraulic System 1 Low Pressure' } });
  const afcs = new Afcs({ vars, events, nav }, AFCS_PROLINE_FUSION);
  const systems = [fms, suite.system, afcs];

  const approach = state === 'approach';
  const ground = state === 'ground' || state === 'boot';
  const lat = approach ? 42.27 : ground ? 40.85 : 41.6;
  const lon = approach ? -71.1 : ground ? -74.06 : -72.6;
  const alt = approach ? 2200 : ground ? 9 : 41000;
  const hdg = approach ? 42 : ground ? 190 : 52;
  const ias = approach ? 140 : ground ? 0 : 262;
  const mv = -14;
  const setTruth = (t: number): void => {
    const pitch = approach ? -1.5 : ground ? 0 : 2.4 + Math.sin(t * 0.3) * 0.3;
    const bank = ground ? 0 : Math.sin(t * 0.2) * 4;
    vars.set(GPS.valid, 1);
    vars.set(GPS.lat, lat);
    vars.set(GPS.lon, lon);
    vars.set(GPS.alt, alt);
    vars.set(GPS.gs, ground ? 0 : approach ? 138 : 478);
    vars.set(GPS.trackTrue, hdg + mv + 3);
    vars.set(GPS.trackMag, hdg + 3);
    vars.set(GPS.magVar, mv);
    for (const s of [1, 2, 3, 4]) {
      vars.set(ADC.valid(s), 1);
      vars.set(ADC.ahrsValid(s), 1);
      vars.set(ADC.ias(s), ias + Math.sin(t) * 0.8);
      vars.set(ADC.tas(s), ground ? 0 : approach ? 146 : 470);
      vars.set(ADC.mach(s), ground ? 0 : approach ? 0.22 : 0.85);
      vars.set(ADC.baroAlt(s), alt + Math.sin(t * 0.5) * 5);
      vars.set(ADC.vs(s), approach ? -720 : 0);
      vars.set(ADC.sat(s), approach ? 8 : ground ? 15 : -56);
      vars.set(ADC.pitch(s), pitch);
      vars.set(ADC.bank(s), bank);
      vars.set(ADC.heading(s), hdg);
      vars.set(ADC.headingTrue(s), hdg + mv);
      if (!vars.has(ADC.baroSetting(s))) vars.set(ADC.baroSetting(s), approach ? 29.87 : 29.92);
    }
    if (!approach && !ground) {
      vars.set(ADC.baroStd(1), 1);
      vars.set(ADC.baroStd(2), 1);
      vars.set(ADC.baroStd(3), 1);
    }
    for (const r of [1, 2]) {
      vars.set(`ra${r}.valid`, 1);
      vars.set(`ra${r}.alt_ft`, approach ? 2150 : ground ? 0 : 3000);
      vars.set(`ra${r}.ncd`, approach || ground ? 0 : 1);
    }
    vars.set('stall.aoa_norm', approach ? 0.45 : 0.3);
    vars.set('gear.air_ground', ground ? 1 : 0);
    vars.set('gear.down_locked', approach || ground ? 1 : 0);
    for (let i = 0; i < 3; i++) vars.set(`gear.pos${i}`, approach || ground ? 1 : 0);
    vars.set('gear.handle_down', approach || ground ? 1 : 0);
    vars.set('surf.flaps_deg', approach ? 30 : ground ? 6 : 0);
    vars.set('surf.slats', approach || ground ? 1 : 0);
    vars.set('ac.flap_lever', approach ? 4 : ground ? 2 : 0);
    vars.set('trim.pitch_units', ground ? 7.5 : 5.2);
    vars.set('surf.aileron', Math.sin(t * 0.7) * 0.15);
    vars.set('surf.elevator', 0.05);
    vars.set('surf.rudder', 0);
    vars.set('surf.spoiler_left', 0);
    vars.set('surf.spoiler_right', 0);
    vars.set('surf.speedbrake', 0);
    vars.set('surf.ground_spoilers', 0);
    const running = state !== 'boot';
    for (const e of [1, 2]) {
      vars.set(`eng${e}.running`, running ? 1 : 0);
      vars.set(`eng${e}.n1_pct`, running ? (ground ? 27 : approach ? 58 : 88.6) + e * 0.2 : 0);
      vars.set(`eng${e}.itt_c`, running ? (ground ? 470 : approach ? 610 : 745) : 20);
      vars.set(`eng${e}.n2_pct`, running ? (ground ? 61 : approach ? 80 : 94.1) : 0);
      vars.set(`eng${e}.oil_press_psi`, running ? 62 : 0);
      vars.set(`eng${e}.oil_temp_c`, running ? 91 : 15);
      vars.set(`eng${e}.ff_pph`, running ? (ground ? 520 : approach ? 1150 : 1480) : 0);
      vars.set(`eng${e}.vib_n1`, running ? 0.4 : 0);
      vars.set(`ac.eng${e}.oil_qty_qt`, 11.4);
    }
    vars.set('fuel.tank0_kg', 5210);
    vars.set('fuel.tank1_kg', 3880);
    vars.set('fuel.tank2_kg', 5185);
    vars.set('fuel.tank3_kg', 640);
    vars.set('fuel.total_kg', 14915);
    vars.set('fuel.used_kg', 3100);
    vars.set('fuel.l_main_temp_c', ground ? 14 : -24);
    vars.set('fuel.r_main_temp_c', ground ? 14 : -23);
    vars.set('press.cabin_alt_ft', ground ? 10 : 4800);
    vars.set('press.cabin_rate_fpm', approach ? -300 : 0);
    vars.set('press.diff_psi', ground ? 0 : 10.2);
    vars.set('press.ldg_elev_ft', 20);
    vars.set('press.outflow_pos', 0.35);
    vars.set('env.time_utc_h', 14.25);
    // Electrical (default readout var names).
    for (let g = 1; g <= 4; g++) {
      vars.set(`elec.gen${g}_v`, running ? 115 : 0);
      vars.set(`elec.gen${g}_kva`, running ? 14 + g : 0);
      vars.set(`elec.gen${g}_hz`, running ? 520 + g * 3 : 0);
      vars.set(`elec.gen${g}_online`, running ? 1 : 0);
      vars.set(`elec.gen${g}_tripped`, 0);
      vars.set(`ac.elec.gen${g}_sw`, 1);
      vars.set(`elec.ac_bus${g}_powered`, running || ground ? 1 : 0);
      vars.set(`elec.ac_bus${g}_shed`, 0);
      vars.set(`ac.elec.ac_bus${g}_isol`, 0);
    }
    vars.set('elec.apu_gen_online', ground && running ? 1 : 0);
    vars.set('elec.apu_gen_v', ground ? 115 : 0);
    vars.set('elec.apu_gen_kva', ground ? 22 : 0);
    vars.set('elec.apu_gen_hz', ground ? 400 : 0);
    vars.set('elec.ac_ess_powered', 1);
    vars.set('elec.rat_gen_online', 0);
    vars.set('ac.rat.deployed', 0);
    vars.set('elec.ext_ac_avail', 0);
    vars.set('elec.ext_ac_online', 0);
    for (const tr of ['tru1', 'tru2', 'ess_tru1', 'ess_tru2']) {
      vars.set(`elec.${tr}_v`, 28);
      vars.set(`elec.${tr}_amps`, 60);
      vars.set(`elec.${tr}_online`, 1);
    }
    for (const b of ['dc_bus1', 'dc_bus2', 'dc_ess', 'batt_bus', 'dc_emer']) vars.set(`elec.${b}_powered`, 1);
    vars.set('elec.dc_bus1_shed', 0);
    vars.set('elec.dc_bus2_shed', 0);
    for (const b of ['av_batt', 'apu_batt']) {
      vars.set(`elec.${b}_v`, 27.4);
      vars.set(`elec.${b}_amps`, 2);
      vars.set(`elec.${b}_temp_c`, 21);
      vars.set(`elec.${b}_chgr_fail`, 0);
    }
    for (let h = 1; h <= 3; h++) {
      vars.set(`hyd.sys${h}_psi`, running ? 3000 : 0);
      vars.set(`hyd.sys${h}_qty_pct`, 62 - h * 3);
      vars.set(`hyd.sys${h}_temp_c`, 45 + h);
    }
    for (const p of ['1a', '1b', '2a', '2b', '3a', '3b']) {
      vars.set(`hyd.pump${p}_on`, running && (p.endsWith('a') || approach) ? 1 : 0);
      vars.set(`hyd.pump${p}_lowpress`, 0);
      vars.set(`ac.hyd.pump${p}_sw`, 1);
    }
    vars.set('hyd.sov1_open', 1);
    vars.set('hyd.sov2_open', 1);
    vars.set('brakes.accum_psi', 2900);
    for (const p of ['pri_l1', 'pri_l2', 'pri_r1', 'pri_r2', 'aux_l', 'aux_r', 'ctr_xfer1', 'ctr_xfer2', 'aft_xfer1', 'aft_xfer2']) {
      vars.set(`fuel.${p}_on`, running && p.startsWith('pri') ? 1 : 0);
      vars.set(`fuel.${p}_lowpress`, 0);
    }
    vars.set('fuel.xfeed_open', 0);
    vars.set('fuel.sov1_open', 1);
    vars.set('fuel.sov2_open', 1);
    vars.set('fuel.apu_on', ground ? 1 : 0);
    vars.set('eng1.fuel_on', running ? 1 : 0);
    vars.set('eng2.fuel_on', running ? 1 : 0);
    vars.set('pneu.eng1_psi', running ? 42 : 0);
    vars.set('pneu.eng2_psi', running ? 41 : 0);
    vars.set('apu.bleed_psi', ground ? 38 : 0);
    vars.set('pneu.eng1_valve_open', running ? 1 : 0);
    vars.set('pneu.eng2_valve_open', running ? 1 : 0);
    vars.set('pneu.apu_valve_open', 0);
    vars.set('pneu.iso_open', 0);
    vars.set('pneu.eng1_trip', 0);
    vars.set('pneu.eng2_trip', 0);
    vars.set('pneu.pack_l_on', 1);
    vars.set('pneu.pack_r_on', 1);
    vars.set('pneu.pack_l_outlet_c', 12);
    vars.set('pneu.pack_r_outlet_c', 13);
    vars.set('pneu.start1_valve_open', 0);
    vars.set('pneu.start2_valve_open', 0);
    for (let z = 1; z <= 3; z++) {
      vars.set(`pneu.zone${z}_temp_c`, 22 + z * 0.5);
      vars.set(`ac.ecs.zone${z}_temp_c`, 22);
    }
    vars.set('ice.wing_l_protected', 0);
    vars.set('ice.wing_r_protected', 0);
    vars.set('eng1.anti_ice', approach ? 1 : 0);
    vars.set('eng2.anti_ice', approach ? 1 : 0);
    vars.set('ice.detected', 0);
    vars.set('ice.windshield_l_protected', 1);
    vars.set('ice.windshield_r_protected', 1);
    vars.set('ice.pitot1_protected', 1);
    vars.set('ac.ice.wing_sw', 0);
    vars.set('ac.ice.cowl_l_sw', approach ? 1 : 0);
    vars.set('ac.ice.cowl_r_sw', approach ? 1 : 0);
    for (const d of ['pax', 'emer', 'bag', 'aft_eqpt', 'svc_large', 'svc_small']) vars.set(`ac.door.${d}_open`, ground && d === 'pax' ? 1 : 0);
    vars.set('oxy.crew_psi', 1720);
    vars.set('brakes.temp_left_c', ground ? 60 : 30);
    vars.set('brakes.temp_right_c', ground ? 180 : 30);
    vars.set('apu.n_pct', ground ? 100 : 0);
    vars.set('apu.egt_c', ground ? 540 : 0);
    vars.set('apu.running', ground ? 1 : 0);
    vars.set('fadec.rating', 0);
    vars.setString('fadec.rating', approach ? 'GA' : ground ? 'TO' : 'CRZ');
    vars.set('fadec.n1_limit_pct', ground ? 100.4 : approach ? 98.2 : 91.5);
    vars.set('surf.rudder_trim', 0.02);
    vars.set('surf.aileron_trim', -0.01);
    vars.set('brakes.parking_set', ground ? 1 : 0);
  };
  setTruth(0);
  if (state !== 'boot') suite.applyState(ground ? 'ready_to_taxi' : approach ? 'approach' : 'cruise');
  else suite.applyState('cold_dark');

  // Flight plan.
  if (approach) {
    await fms.loadRoute('KJFK KBOS');
    const plan = fms.plans.edit();
    const procs = await nav.loadProcedures('KBOS');
    const ils = procs?.approaches.find((a) => a.approachType === 'ILS' && a.runways.includes('04R')) ?? procs?.approaches.find((a) => a.approachType === 'ILS');
    if (ils) plan.setApproach(ils);
    fms.plans.commit();
    fms.plans.exec();
    vars.set(AP.selAltitude, 2000);
    vars.set(NAV.activeFreq(1), 110.3);
    vars.set(NAV.received(1), 1);
    vars.set(NAV.isLoc(1), 1);
    vars.set(NAV.cdi(1), 0.12);
    vars.set(NAV.gsValid(1), 1);
    vars.set(NAV.gsDev(1), -0.25);
    vars.set(NAV.obs(1), 35);
  } else if (!ground) {
    await fms.loadRoute('KTEB DIXIE MERIT HFD PUT KBOS');
    fms.setCruiseAltitude(41000);
    fms.plans.exec();
    fms.directTo('PUT');
    fms.plans.exec();
    vars.set(AP.selAltitude, 41000);
  } else {
    await fms.loadRoute('KTEB KBOS');
    fms.plans.exec();
    vars.set(AP.selAltitude, 5000);
  }
  vars.set(AP.selHeading, hdg + 10);
  vars.set(AP.selSpeed, approach ? 140 : 250);
  vars.set(AP.selMach, 0.85);
  vars.set(AP.speedIsMach, approach || ground ? 0 : 1);
  vars.set(AP.minimums(1), 200);
  vars.set(AP.minimums(2), 200);
  vars.set(FUSION_VARS.brg(1, 1), 1);
  vars.set(FUSION_VARS.brg(1, 2), 3);
  if (approach) {
    vars.set(FUSION_VARS.navSource(1), 1);
    vars.set(FUSION_VARS.navSource(2), 1);
  }
  const sys = q.get('sys');
  if (sys !== null) {
    vars.set(FUSION_VARS.sysPage(1), Number(sys));
    vars.set(FUSION_VARS.sysPage(2), Number(sys));
  }
  if (state === 'rev') vars.set(FUSION_VARS.afdFail(1), 1);
  if (state === 'split') {
    suite.layout.setHalfSplit(3, 'R', true);
    suite.layout.select(3, 'RU', Win.Vsd);
    suite.layout.select(3, 'RL', Win.Chart);
    suite.layout.select(2, 'R', Win.Map);
    suite.layout.select(1, 'R', Win.Evs);
    suite.layout.select(4, 'L', Win.Chkl);
  }
  const win = q.get('win');
  if (win !== null) suite.layout.select(3, 'R', Number(win) as Win);
  if (q.get('chkl') === '1') suite.layout.select(3, 'R', Win.Chkl);
  const mem = q.get('mem');
  if (mem !== null) suite.layout.recall(1, Number(mem));
  const fp = q.get('fms');
  if (fp !== null) {
    suite.fmsWin[0].show(fp as never);
    suite.fmsWin[1].show((q.get('fms2') ?? fp) as never);
  }
  const ctp = q.get('ctp');
  if (ctp === 'pfd') events.emit(FUSION_EVENTS.ctpKey(1), 'PFD');
  if (ctp === 'hsi') events.emit(FUSION_EVENTS.ctpKey(1), 'HSI');
  vars.set(NAV.comActive(1), 124.525);
  vars.set(NAV.comStandby(1), 118.3);
  vars.set(NAV.xpdrCode, 4721);
  vars.set(NAV.xpdrMode, 5);

  // DOM (T arrangement: AFD 1, 2, 4 across; CTPs, AFD 3 and the IESI below).
  const row1 = document.getElementById('row1')!;
  const row2 = document.getElementById('row2')!;
  const add = (row: HTMLElement, d: { id: string; canvas: HTMLCanvasElement | OffscreenCanvas }): void => {
    const wrap = document.createElement('div');
    wrap.id = `wrap-${d.id.replace(/\./g, '-')}`;
    const l = document.createElement('span');
    l.className = 'lbl';
    l.textContent = d.id;
    wrap.appendChild(l);
    const c = d.canvas as HTMLCanvasElement;
    c.id = `cv-${d.id.replace(/\./g, '-')}`;
    wrap.appendChild(c);
    row.appendChild(wrap);
  };
  add(row1, suite.afd[0]);
  add(row1, suite.afd[1]);
  add(row1, suite.afd[3]);
  add(row2, suite.ctp[0]);
  add(row2, suite.afd[2]);
  add(row2, suite.ctp[1]);
  add(row2, suite.iesi);
  const displays = suite.displays;
  for (const d of displays) {
    const c = d.canvas as HTMLCanvasElement;
    const pos = (e: MouseEvent): [number, number] => {
      const r = c.getBoundingClientRect();
      return [((e.clientX - r.left) * c.width) / r.width, ((e.clientY - r.top) * c.height) / r.height];
    };
    c.addEventListener('mousedown', (e) => d.onPointer?.(...pos(e), 'down'));
    c.addEventListener('mouseup', (e) => d.onPointer?.(...pos(e), 'up'));
    c.addEventListener('mousemove', (e) => d.onPointer?.(...pos(e), 'move'));
    c.addEventListener('wheel', (e) => d.onPointer?.(...pos(e), 'wheel', -e.deltaY));
  }

  let t = 0;
  const step = (dt: number): void => {
    t += dt;
    setTruth(t);
    for (const s of systems) s.update(dt);
  };
  // Sample crew alerts (CAS window, STATUS page, CAS-linked checklist).
  if (q.get('cas') !== '0') {
    const m = suite.cas.model;
    m.set('hyd1_lo', 'HYD SYS 1 LO PRESS', 'caution', q.get('cas') === '2');
    m.set('ice', 'L COWL A/ICE ON', 'advisory', approach);
    m.set('apu_bleed', 'APU BLEED ON', 'status', ground);
    m.set('pbrake', 'PARK BRAKE ON', 'status', ground);
    m.set('fuel_recirc', 'L FUEL RECIRC OFF', 'status', !ground && !approach);
    m.set('xpdr', 'TCAS OFF', 'advisory', ground);
    m.set('cfg', 'CONFIG FLAPS', 'warning', q.get('cas') === '2');
  }
  const warm = state === 'boot' ? 3 : 2;
  for (let i = 0; i < warm * 60; i++) step(1 / 60);
  if (!ground && state !== 'boot') {
    events.emit('ap.fd1');
    events.emit(FUSION_EVENTS.fcp('ap'));
    events.emit(FUSION_EVENTS.fcp('yd'));
    events.emit(FUSION_EVENTS.fcp('at'));
    if (approach) {
      events.emit(FUSION_EVENTS.fcp('hdg'));
      events.emit(FUSION_EVENTS.fcp('appr'));
    } else {
      events.emit(FUSION_EVENTS.fcp('nav'));
      events.emit(FUSION_EVENTS.fcp('vnav'));
    }
  }
  for (let i = 0; i < (state === 'boot' ? 2 : 7) * 60; i++) step(1 / 60);
  if (q.get('menu') === '1') {
    suite.cursor.place(1, 3, 700, 300);
    suite.cursor.menu(1);
  } else {
    suite.cursor.place(1, 2, 760, 200);
    suite.cursor.place(2, 3, 800, 420);
  }
  for (const d of displays) d.render(1 / 30);
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
  if (q.get('static') !== '1') requestAnimationFrame(loop);
  const w = window as unknown as { __fusion: unknown; __fusionReady: boolean };
  w.__fusion = { suite, vars, events, step, render: () => displays.forEach((d) => d.render(1 / 30)) };
  w.__fusionReady = true;
}

main().catch((e) => {
  document.body.textContent = String((e as Error).stack ?? e);
  console.error(e);
});
