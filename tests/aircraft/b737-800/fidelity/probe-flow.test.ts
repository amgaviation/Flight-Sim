/**
 * 737-800 line check, headless: one continuous flight from cold & dark at Los
 * Angeles (KLAX) to San Francisco (KSFO) and back to cold & dark, flown only
 * through the cockpit controls (B738 vars), the MCP / EFIS events, CDU 1 keys
 * and the yoke, pedals, tiller, toe brakes, thrust and reverse levers.
 *
 *   KLAX/25R  DCT VTU  DCT RZS  J126  SNS  ->  ILS 28R KSFO, cruise FL320
 *
 * Phases (FCOM NP.21 normal procedures, QRH normal checklist; dossier §8):
 *  1. cold & dark
 *  2. Electrical power-up: BAT, ground power, APU start on the battery, APU GENs, GPU off
 *  3. Preflight: IRS to NAV; CDU IDENT -> POS INIT -> RTE -> DEP/ARR -> PERF INIT -> N1 LIMIT -> TAKEOFF REF; MCP set-up
 *  4. Before start / engine start: pumps, APU bleed, engine 2 then 1 (GRD, IDLE at 25 % N2, cut-out 56 %)
 *  5. Before taxi: GENs, APU bleed off, packs AUTO, APU off, probe heat, flaps 5, CONT, stab trim
 *  6. Taxi (tiller) and before take-off; take-off with TO/GA (N1, THR HLD at 84 kt), LNAV / VNAV armed
 *  7. Climb: CMD A, LNAV / VNAV SPD, flap retraction, FL320, pressurization
 *  8. Cruise: VNAV PTH / FMC SPD at the ECON Mach, fuel flow sanity
 *  9. Descent (VNAV at T/D) and approach set-up: ILS tuning, APP, CMD B, flaps / gear, autobrake 2
 * 10. Autoland: LAND 3, FLARE, RETARD, touchdown, ROLLOUT, auto speedbrake, reversers, autobrake
 * 11. After landing, taxi to the stand, shutdown and secure
 */
import { describe, expect, it } from 'vitest';
import { NavDatabaseImpl } from '../../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../../src/nav/data/nodeLoader';
import { destinationPoint } from '../../../../src/core/geo';
import { AP, ENG, FDM, INPUT, NAV } from '../../../../src/core/vars';
import { B738, APU_SW, ENG_START, FUEL_PUMPS, HYD_PUMP_SWITCHES, GEAR_LEVER, SPEEDBRAKE, XPDR_SEL } from '../../../../src/aircraft/b737-800/vars';
import { FLAP_LEVER } from '../../../../src/aircraft/b737-800/data';
import { vref } from '../../../../src/avionics/boeing-737/data/perf';
import { flapManeuverSpeed } from '../../../../src/avionics/boeing-737/data/b738';
import { makeFlightRig, fma, press, mcp, cdu, cduEnter, cduScreen, cduSelect, bearingTo, distTo, wrap180, type FlightRig } from '../verify/flightRig';
import { B738_CHECKLISTS } from '../../../../src/aircraft/b737-800/checklists';
import { appendFileSync } from 'node:fs';
function ck(r: FlightRig, title: string, note = ''): void {
  const c = B738_CHECKLISTS.find((x) => x.title === title)!;
  const res = c.items.map((it) => `${it.challenge}:${it.check ? (it.check(r.vars) ? 'Y' : 'N') : '-'}`);
  appendFileSync('/tmp/ref/b737/flow.log', `${title} ${note} [${res.join(' | ')}] MC=${r.vars.get('ac.b738.lt.master_caution')} CAS=${r.sys.cas.list.filter((e) => e.active).map((e) => e.id).join(',')}\n`);
}


const LOG: string[] = [];
function log(r: FlightRig, what: string): void {
  const v = r.vars;
  LOG.push(
    `[${(r.t / 60).toFixed(1).padStart(5)} min] ${what} | ${v.get(FDM.altMsl).toFixed(0)} ft ${v.get(FDM.ias).toFixed(0)} KIAS M${v.get(FDM.mach).toFixed(3)} VS ${v.get(FDM.vs).toFixed(0)} GS ${v.get(FDM.gs).toFixed(0)} | N1 ${v.get('eng1.n1_pct').toFixed(1)}/${v.get('eng2.n1_pct').toFixed(1)} | ${fma(r)} | CMD ${v.get(AP.engaged)} | fuel ${v.get('fuel.total_kg').toFixed(0)} kg GW ${v.get(FDM.mass).toFixed(0)}`,
  );
}
const active = (r: FlightRig): string[] => r.sys.cas.list.filter((e) => e.active).map((e) => e.id);

/** Ground steering + speed controller (pilot on the tiller, toe brakes and thrust levers). */
function taxiStep(r: FlightRig, tgtLat: number, tgtLon: number, gsKt: number): void {
  const v = r.vars;
  const err = wrap180(bearingTo(r, tgtLat, tgtLon) - v.get(FDM.headingTrue));
  v.set(B738.tiller3d, Math.max(-1, Math.min(1, err / 25)));
  const e = gsKt - v.get(FDM.gs);
  const lever = Math.max(0, Math.min(0.3, 0.08 + 0.03 * e));
  v.set(B738.tla(1), lever);
  v.set(B738.tla(2), lever);
  const brake = e < -2 ? Math.min(1, -0.12 * e) : 0;
  v.set(INPUT.brakeLeft, brake);
  v.set(INPUT.brakeRight, brake);
}

function stopOnGround(r: FlightRig): void {
  const v = r.vars;
  v.set(B738.tla(1), 0);
  v.set(B738.tla(2), 0);
  v.set(B738.tiller3d, 0);
  r.run(60, () => {
    v.set(INPUT.brakeLeft, 0.6);
    v.set(INPUT.brakeRight, 0.6);
    return v.get(FDM.gs) < 0.3;
  });
  v.set(INPUT.brakeLeft, 0);
  v.set(INPUT.brakeRight, 0);
}

/** Taxi to a point (stop within `tolM` metres). */
function taxiTo(r: FlightRig, p: { lat: number; lon: number }, gsKt: number, tolM = 25, maxS = 600): void {
  r.run(maxS, () => {
    const d = distTo(r, p.lat, p.lon) * 1852;
    taxiStep(r, p.lat, p.lon, d < 150 ? Math.max(4, Math.min(gsKt, d / 15)) : gsKt);
    return d < tolM;
  });
}

/** Pilot flying the flight director by hand (yoke pitch / roll), PD on attitude. */
const hf = { lastPitch: NaN };
function flyFd(r: FlightRig, pitchCmd?: number, rateCmd = 0): void {
  const v = r.vars;
  const pitch = v.get(FDM.pitch);
  const q = Number.isNaN(hf.lastPitch) ? 0 : (pitch - hf.lastPitch) * 60;
  hf.lastPitch = pitch;
  const tgt = pitchCmd ?? v.get(AP.fdPitch);
  v.set(INPUT.pitch, Math.max(-1, Math.min(1, 0.09 * (tgt - pitch) - (rateCmd > 0 ? 0.25 : 0.12) * (q - rateCmd))));
  const bank = v.get(FDM.bank);
  v.set(INPUT.roll, Math.max(-1, Math.min(1, 0.04 * (v.get(AP.fdBank) - bank))));
}
function handsOff(r: FlightRig): void {
  r.vars.set(INPUT.pitch, 0);
  r.vars.set(INPUT.roll, 0);
  hf.lastPitch = NaN;
}

/** Flap retraction on the PFD maneuver bugs (FCTM "Flap retraction schedule"): 5 -> 1 at the F5 bug, 1 -> UP at the F1 bug. */
function flapRetractStep(r: FlightRig): void {
  const v = r.vars;
  const ias = v.get(FDM.ias);
  const gw = v.get(FDM.mass);
  const lever = v.get(B738.flapLever);
  if (lever >= FLAP_LEVER.f5 && ias > flapManeuverSpeed(5, gw)) v.set(B738.flapLever, FLAP_LEVER.f1);
  else if (lever === FLAP_LEVER.f1 && v.get('surf.flaps_deg') < 1.5 && ias > flapManeuverSpeed(1, gw)) v.set(B738.flapLever, FLAP_LEVER.up);
}

/** Speedbrake technique: FLIGHT DETENT (partial) when > 10 kt above the target in a descent, stowed near it. */
function speedbrakeStep(r: FlightRig, targetKt: number, stowTo: number = SPEEDBRAKE.down): void {
  const v = r.vars;
  const fast = v.get(FDM.ias) - targetKt;
  const sb = v.get(B738.speedbrake);
  if (fast > 10) v.set(B738.speedbrake, SPEEDBRAKE.flightDetent * 0.75);
  else if (sb > SPEEDBRAKE.armed + 0.01 && fast < 3) v.set(B738.speedbrake, stowTo);
}

/** MCP knob to a value with encoder clicks (altitude 100 ft, heading 1 deg, speed 1 kt per click). */
function mcpKnob(r: FlightRig, knob: 'alt' | 'hdg' | 'spd', target: number): void {
  const v = r.vars;
  const cur = knob === 'alt' ? v.get(AP.selAltitude) / 100 : knob === 'hdg' ? v.get(AP.selHeading) : v.get(AP.selSpeed);
  let clicks = Math.round((knob === 'alt' ? target / 100 : target) - cur);
  if (knob === 'hdg') clicks = Math.round(wrap180(clicks));
  if (clicks) r.events.emit(`ac.mcp.${knob}_${clicks > 0 ? 'inc' : 'dec'}`, Math.abs(clicks));
  r.run(0.2);
}

describe.skipIf(!process.env.AMG_LONG_TESTS)('probe checklist flow KLAX -> KSFO (full normal procedure)', () => {
  it('flies cold & dark to cold & dark through the cockpit controls', { timeout: 1_800_000 }, async () => {
    const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
    await db.load();
    const klax = db.airport('KLAX')!;
    const ksfo = db.airport('KSFO')!;
    const rw25r = klax.runways.find((x) => x.ident === '25R')!;
    const rw28r = ksfo.runways.find((x) => x.ident === '28R')!;
    expect(rw25r && rw28r).toBeTruthy();
    expect(rw28r.ils).toBeTruthy();
    // Stand: 250 m right of the 25R centre line abeam a point 150 m down the runway, nose toward the runway.
    const lineup = destinationPoint(rw25r.lat, rw25r.lon, rw25r.headingTrue, 150 / 1852);
    const holdShort = destinationPoint(lineup.lat, lineup.lon, rw25r.headingTrue + 90, 90 / 1852);
    const stand = destinationPoint(lineup.lat, lineup.lon, rw25r.headingTrue + 90, 250 / 1852);
    // 162 pax + bags (default 14 t payload) and 8,000 kg of fuel (1,000 kg in the centre tank): ~63.6 t ramp weight.
    const r = makeFlightRig({ db, origin: klax, dest: ksfo, start: { lat: stand.lat, lon: stand.lon, headingTrue: rw25r.headingTrue - 90 }, fuelKg: [3500, 3500, 1000] });
    const v = r.vars;
    const sys = r.sys;
    r.fdm.massModel.update();
    const zfwKg = r.fdm.massModel.mass - 8000;
    try {
      // ================================================================ 1. cold & dark
      r.run(1);
      expect(v.get('elec.batt_bus_powered')).toBe(0);
      expect(v.get('elec.xfr1_powered') + v.get('elec.xfr2_powered')).toBe(0);
      expect(v.get(ENG.running(1)) + v.get(ENG.running(2))).toBe(0);
      expect(v.get('display.b737_du_capt_out.power')).toBe(0);
      expect(v.get(B738.lt.masterCaution)).toBe(0);
      log(r, 'cold & dark');

      // ================================================================ 2. power-up (FCOM SP.6 "Electrical power up")
      v.set(B738.batSw, 1);
      v.set(B738.stbyPwrSw, 1);
      r.run(3);
      expect(v.get('elec.batt_bus_powered')).toBe(1);
      expect(v.get('elec.dc_stby_powered')).toBe(1);
      expect(v.get('elec.ac_stby_powered')).toBe(1);
      expect(v.get(B738.lt.xfrBusOff(1))).toBe(1);
      expect(v.get(B738.lt.xfrBusOff(2))).toBe(1);
      expect(v.get(B738.lt.sourceOff(1))).toBe(1);
      // Ground power at the stand: GRD CALL, the ground engineer connects the GPU.
      press(r, B738.grdCall);
      expect(v.get(B738.lt.callLt)).toBe(0);
      expect(v.get(B738.lt.grdPwrAvail)).toBe(0);
      r.run(21);
      // The ground engineer calls back (blue CALL light) once the GPU is connected.
      expect(v.get(B738.lt.callLt)).toBe(1);
      r.run(4);
      expect(v.get(B738.lt.grdPwrAvail)).toBe(1);
      press(r, B738.grdPwrSw);
      r.run(2);
      expect(v.get(B738.xfrSrc(1))).toBe(3);
      expect(v.get(B738.xfrSrc(2))).toBe(3);
      expect(v.get(B738.lt.xfrBusOff(1)) + v.get(B738.lt.sourceOff(1))).toBe(0);
      expect(v.get('elec.xfr1_v')).toBeGreaterThan(110);
      // Emergency exit lights ARMED, no smoking, position lights STEADY, window heat, hydraulic ENG pumps ON (preflight).
      v.set(B738.emerExitLt, 1);
      v.set(B738.noSmoking, 1);
      v.set(B738.positionLt, -1);
      for (const w of ['l_side', 'l_fwd', 'r_fwd', 'r_side'] as const) v.set(B738.windowHeat(w), 1);
      v.set(B738.hydPump('eng1'), 1);
      v.set(B738.hydPump('eng2'), 1);
      // IRS mode selectors OFF -> NAV (ALIGN lights).
      v.set('ac.irs1_mode', 2);
      v.set('ac.irs2_mode', 2);
      r.run(5);
      expect(v.get(B738.lt.irsAlign(1))).toBe(1);
      expect(v.get(B738.lt.irsAlign(2))).toBe(1);
      // APU start (FCOM SP.7): fuel pump L AFT ON, APU switch START then ON.
      v.set(B738.fuelPump('l_aft'), 1);
      v.set(B738.apuSw, APU_SW.start);
      r.run(0.5);
      v.set(B738.apuSw, APU_SW.on);
      const tApu = r.run(150, () => v.get('apu.avail') === 1);
      expect(v.get('apu.avail')).toBe(1);
      expect(tApu).toBeGreaterThan(20);
      r.run(1);
      expect(v.get(B738.lt.apuGenOffBus)).toBe(1); // APU running, not on the buses
      expect(v.get(B738.lt.apuEgtC)).toBeGreaterThan(250);
      expect(v.get(B738.lt.apuEgtC)).toBeLessThan(710);
      press(r, B738.apuGenSw(1));
      press(r, B738.apuGenSw(2));
      r.run(1);
      expect(v.get(B738.xfrSrc(1))).toBe(2);
      expect(v.get(B738.xfrSrc(2))).toBe(2);
      expect(v.get(B738.lt.apuGenOffBus)).toBe(0);
      expect(v.get(B738.lt.grdPwrAvail)).toBe(1);
      press(r, B738.grdCall); // ground engineer removes the GPU
      r.run(12);
      expect(v.get(B738.lt.grdPwrAvail)).toBe(0);
      expect(v.get('elec.xfr1_powered') + v.get('elec.xfr2_powered')).toBe(2);
      log(r, 'APU on the buses');

      // ================================================================ 3. preflight: FMC / CDU (FCOM NP.21 "Preflight procedure - First Officer / Captain")
      r.run(3);
      expect(v.get('display.b737_du_capt_out.power')).toBe(1);
      expect(sys.suite.cdus[0].pageId).toBe('ident');
      expect(cduScreen(r).join('\n')).toContain('737-800W');
      cdu(r, 'R6'); // POS INIT
      expect(sys.suite.cdus[0].pageId).toBe('pos');
      cduEnter(r, 'KLAX', 'L2');
      cdu(r, 'R2'); // REF AIRPORT position to the scratchpad
      cdu(r, 'R4'); // SET IRS POS
      expect(sys.suite.cdus[0].entryError).toBe('');
      cdu(r, 'R6'); // ROUTE
      expect(sys.suite.cdus[0].pageId).toBe('rte');
      cduEnter(r, 'KLAX', 'L1');
      cduEnter(r, 'KSFO', 'R1');
      cduEnter(r, 'AAL1234', 'R2');
      cduEnter(r, '25R', 'L3');
      cdu(r, 'NEXT_PAGE');
      cduEnter(r, 'VTU', 'R1');
      cduEnter(r, 'RZS', 'R2');
      cduEnter(r, 'J126', 'L3');
      cduEnter(r, 'SNS', 'R3');
      console.log(cduScreen(r).join('\n'));
      cdu(r, 'R6'); // ACTIVATE
      expect(v.get('ac.fmc.exec_light')).toBe(1);
      cdu(r, 'EXEC');
      r.run(0.5);
      expect(v.get('ac.fmc.exec_light')).toBe(0);
      // Arrival: ILS 28R (manual VHF NAV tuning later: SCOPE of the FMC, see the suite docs).
      cdu(r, 'DEP_ARR', 'R2');
      for (let i = 0; i < 50 && cduScreen(r).join('').includes('LOADING'); i++) {
        await new Promise((res) => setTimeout(res, 50));
        r.run(0.1);
      }
      console.log(cduScreen(r).join('\n'));
      expect(cduSelect(r, 'ILS28R') || cduSelect(r, 'ILS 28R')).toBe(true);
      r.run(0.3);
      console.log(cduScreen(r).join('\n'));
      cdu(r, 'EXEC');
      r.run(0.5);
      const plan = sys.suite.fmc!.plans.active;
      const idents = plan.legs.map((l) => l.fix?.ident ?? '?');
      console.log('LEGS', idents.join(' '));
      expect(idents).toContain('VTU');
      expect(idents).toContain('RZS');
      expect(idents).toContain('SNS');
      expect(plan.approachProcedure).toBeTruthy();
      // Close the route discontinuity after SNS: LEGS, CEPIN to the scratchpad, into the box line, EXEC.
      cdu(r, 'LEGS');
      let closed = false;
      for (let pg = 0; pg < 4 && !closed; pg++) {
        const lines = cduScreen(r);
        const rowOf = (re: RegExp) => [1, 2, 3, 4, 5].find((row) => re.test(lines[2 * row] ?? ''));
        const boxRow = rowOf(/\u25a1|THEN|□/);
        const cepRow = rowOf(/^CEPIN/);
        if (boxRow && cepRow) {
          // SCOPE (nav FlightPlan, Boeing style): copying CEPIN into the box re-inserts a discontinuity before the
          // approach IF, so the crew deletes the discontinuity instead (DEL + LSK), which the FMC also accepts.
          cdu(r, 'DEL', `L${boxRow}`);
          closed = true;
        } else cdu(r, 'NEXT_PAGE');
      }
      expect(closed).toBe(true);
      cdu(r, 'EXEC');
      r.run(0.5);
      console.log('LEGS', sys.suite.fmc!.plans.active.legs.map((l) => l.fix?.ident ?? '?').join(' '));
      log(r, 'route entered');
      // PERF INIT (FCOM 11.40): ZFW, reserves, cost index, cruise altitude FL320.
      cdu(r, 'INIT_REF', 'L6', 'L3');
      expect(sys.suite.cdus[0].pageId).toBe('perfInit');
      cduEnter(r, (zfwKg / 1000).toFixed(1), 'L3');
      cduEnter(r, '2.5', 'L4');
      cduEnter(r, '45', 'L5');
      cduEnter(r, 'FL320', 'R1');
      cdu(r, 'EXEC');
      r.run(0.5);
      console.log(cduScreen(r).join('\n'));
      expect(Math.abs(v.get('ac.fmc.gw_kg') - v.get(FDM.mass))).toBeLessThan(600);
      cdu(r, 'R6'); // N1 LIMIT
      console.log(cduScreen(r).join('\n'));
      cdu(r, 'INIT_REF', 'L6', 'L4'); // TAKEOFF REF
      cduEnter(r, '5', 'L1');
      const cg = v.get(FDM.cgPctMac);
      expect(cg).toBeGreaterThan(8);
      expect(cg).toBeLessThan(33);
      cduEnter(r, cg.toFixed(1), 'L3');
      cdu(r, 'R1', 'R2', 'R3'); // accept the QRH V1 / VR / V2
      const vs = { v1: v.get('ac.fmc.v1_kt'), vr: v.get('ac.fmc.vr_kt'), v2: v.get('ac.fmc.v2_kt') };
      console.log(cduScreen(r).join('\n'));
      expect(vs.v1).toBeGreaterThan(125);
      expect(vs.v1).toBeLessThanOrEqual(vs.vr);
      expect(vs.v2).toBeGreaterThan(vs.vr);
      expect(vs.v2).toBeLessThan(160);
      const trimLine = cduScreen(r)[6];
      const toTrim = Number(/%\s+([\d.]+)/.exec(trimLine)?.[1]);
      expect(toTrim).toBeGreaterThan(2);
      expect(toTrim).toBeLessThan(9);
      log(r, `TAKEOFF REF V1 ${vs.v1} VR ${vs.vr} V2 ${vs.v2} CG ${cg.toFixed(1)} % trim ${toTrim}`);
      // MCP (FCOM NP.21): F/Ds ON (Capt first), A/T ARM, IAS V2, HDG runway heading, ALT FL320 (cleared), LNAV + VNAV armed.
      v.set('ap.fd1_on', 1);
      v.set('ap.fd2_on', 1);
      v.set('ac.at_arm', 1);
      mcpKnob(r, 'spd', vs.v2);
      mcpKnob(r, 'hdg', Math.round(rw25r.headingTrue - v.get('gps.mag_var_deg')));
      mcpKnob(r, 'alt', 32000);
      mcp(r, 'lnav');
      mcp(r, 'vnav');
      expect(v.get('ap.sel_alt_ft')).toBe(32000);
      expect(v.get('ap.sel_spd_kt')).toBe(vs.v2);
      console.log('FMA', fma(r));
      expect(v.getString('ac.fma.status')).toBe('FD');
      expect(v.getString('ac.fma.roll_armed')).toContain('LNAV');
      expect(v.getString('ac.fma.pitch_armed')).toContain('VNAV');
      // IRS alignment (FCOM: 10 min maximum; ALIGN lights out, then the MAP shows).
      const tAlign = r.run(900, () => v.get('irs1.state') === 2 && v.get('irs2.state') === 2);
      expect(v.get('irs1.state')).toBe(2);
      expect(v.get(B738.lt.irsAlign(1))).toBe(0);
      log(r, `IRS aligned after ${(tAlign / 60).toFixed(1)} more min`);
      ck(r, 'BEFORE START', 'after preflight, before pumps');

      // ================================================================ 4. before start / engine start (FCOM NP.21, SP.7)
      for (const p of FUEL_PUMPS) v.set(B738.fuelPump(p), 1); // centre pumps ON: 1,000 kg in the centre tank
      for (const p of HYD_PUMP_SWITCHES) v.set(B738.hydPump(p), 1);
      v.set(B738.antiColl, 1);
      v.set(B738.fastenBelts, 2);
      v.set(B738.pack(1), 0);
      v.set(B738.pack(2), 0);
      v.set(B738.isoValve, 1);
      v.set(B738.apuBleed, 1);
      r.run(10);
      expect(v.get('hyd.a_psi')).toBeGreaterThan(2800);
      expect(v.get('hyd.b_psi')).toBeGreaterThan(2800);
      expect(v.get('pneu.l_duct_psi')).toBeGreaterThan(30);
      for (const p of FUEL_PUMPS) expect(v.get(B738.lt.fuelLowPress(p)), p).toBe(0);
      // YAW DAMPER ON (system B pressurized, IRS aligned: the SMYD engages it).
      v.set(B738.ydSw, 1);
      ck(r, 'BEFORE START', 'before engine start');
      r.run(2);
      expect(v.get(B738.ydSw)).toBe(1);
      expect(v.get(B738.lt.yawDamper)).toBe(0);
      // Before-start recall (FCOM NP.21): only the expected lights (engines stopped, probe heat off).
      const recall = active(r).sort();
      expect(recall).toEqual(['drive1', 'drive2', 'fdr_off', 'probe_aux_pitot', 'probe_capt_pitot', 'probe_fo_pitot', 'probe_l_alpha', 'probe_l_elev_pitot', 'probe_r_alpha', 'probe_r_elev_pitot'].sort());
      expect(v.get(B738.lt.masterCaution)).toBe(1);
      expect(v.get(B738.lt.group('elec'))).toBe(1);
      expect(v.get(B738.lt.group('anti_ice'))).toBe(1);
      expect(v.get(B738.lt.group('overhead'))).toBe(1);
      press(r, B738.masterCaution(1));
      r.run(0.5);
      expect(v.get(B738.lt.masterCaution)).toBe(0);
      expect(v.get(B738.lt.group('elec'))).toBe(0);
      for (const i of [2, 1] as const) {
        v.set(B738.engStart(i), ENG_START.grd);
        r.run(1);
        expect(v.get(B738.lt.engStartValve(i))).toBe(1);
        let lever = NaN;
        let maxEgt = 0;
        let release = NaN;
        r.run(120, () => {
          const n2 = v.get(ENG.n2(i));
          if (Number.isNaN(lever) && n2 >= 25) {
            v.set(B738.startLever(i), 1);
            lever = n2;
          }
          if (Number.isNaN(release) && v.get(B738.engStart(i)) !== ENG_START.grd) release = n2;
          maxEgt = Math.max(maxEgt, v.get(ENG.itt(i)));
          return v.get(ENG.running(i)) === 1 && n2 > 58;
        });
        r.run(10);
        log(r, `engine ${i} started: fuel at ${lever.toFixed(1)} % N2, cut-out ${release.toFixed(1)} %, peak EGT ${maxEgt.toFixed(0)} C`);
        expect(release).toBeGreaterThan(54);
        expect(release).toBeLessThan(60);
        expect(maxEgt).toBeLessThan(725);
        expect(v.get(B738.lt.engStartValve(i))).toBe(0);
        expect(v.get(ENG.n1(i))).toBeGreaterThan(18);
        expect(v.get(ENG.n1(i))).toBeLessThan(24);
        expect(v.get(ENG.oilPressPsi(i))).toBeGreaterThan(26);
        expect(v.get(B738.lt.genOffBus(i))).toBe(1);
      }

      // ================================================================ 5. before taxi (FCOM NP.21)
      press(r, B738.genSw(1));
      press(r, B738.genSw(2));
      r.run(1);
      expect(v.get(B738.xfrSrc(1))).toBe(1);
      expect(v.get(B738.xfrSrc(2))).toBe(1);
      expect(v.get(B738.lt.genOffBus(1)) + v.get(B738.lt.genOffBus(2))).toBe(0);
      expect(v.get(B738.lt.apuGenOffBus)).toBe(1);
      v.set(B738.probeHeat('a'), 1);
      v.set(B738.probeHeat('b'), 1);
      v.set(B738.apuBleed, 0);
      v.set(B738.pack(1), 1);
      v.set(B738.pack(2), 1);
      v.set(B738.isoValve, 1);
      v.set(B738.apuSw, APU_SW.off);
      for (const i of [1, 2] as const) v.set(B738.engStart(i), ENG_START.cont);
      v.set(B738.flapLever, FLAP_LEVER.f5);
      v.set(B738.autobrake, -1); // RTO
      v.set(B738.xpdrModeSel, XPDR_SEL.taRa);
      // Stabilizer trim to the TAKEOFF REF setting with the control wheel trim switches.
      r.run(60, () => {
        const e = toTrim - v.get('trim.pitch_units');
        v.set(B738.yokeTrim(1), Math.abs(e) < 0.03 ? 0 : Math.sign(e));
        return Math.abs(e) < 0.03;
      });
      v.set(B738.yokeTrim(1), 0);
      r.run(20);
      expect(Math.abs(v.get('trim.pitch_units') - toTrim)).toBeLessThan(0.1);
      expect(v.get('surf.flaps_deg')).toBeCloseTo(5, 0);
      expect(v.get(B738.lt.leFlapsExt)).toBe(1);
      expect(v.get('pneu.pack1_on') ?? 1).toBeTruthy();
      for (const p of HYD_PUMP_SWITCHES) expect(v.get(B738.lt.hydLowPress(p)), p).toBe(0);
      expect(v.get(B738.lt.masterCaution), active(r).join(',')).toBe(0);
      expect(v.get('cas.warning_count')).toBe(0);
      log(r, 'before taxi complete');
      ck(r, 'BEFORE TAXI');

      // ================================================================ 6. taxi, before take-off, take-off
      v.set(B738.taxiLt, 1);
      v.set(B738.parkBrake, 0);
      r.run(1);
      expect(v.get(B738.lt.parkingBrake)).toBe(0);
      taxiTo(r, holdShort, 12);
      stopOnGround(r);
      expect(distTo(r, holdShort.lat, holdShort.lon) * 1852).toBeLessThan(40);
      log(r, 'holding short 25R');
      // Before take-off: landing / turnoff lights, strobes, transponder TA/RA (FCOM NP.21).
      for (const i of [1, 2] as const) {
        v.set(B738.landingRetract(i), 2);
        v.set(B738.landingFixed(i), 1);
        v.set(B738.turnoff(i), 1);
      }
      v.set(B738.positionLt, 1);
      expect(v.get(B738.lt.takeoffConfig)).toBe(0);
      // Line up on 25R (the tiller turns onto the centre line, stop aligned).
      const farEnd = destinationPoint(rw25r.lat, rw25r.lon, rw25r.headingTrue, 3);
      taxiTo(r, lineup, 8, 15);
      r.run(40, () => {
        taxiStep(r, farEnd.lat, farEnd.lon, 6);
        return Math.abs(wrap180(v.get(FDM.headingTrue) - rw25r.headingTrue)) < 2;
      });
      stopOnGround(r);
      v.set(B738.taxiLt, 0);
      for (const i of [1, 2] as const) v.set(B738.turnoff(i), 0);
      expect(Math.abs(wrap180(v.get(FDM.headingTrue) - rw25r.headingTrue))).toBeLessThan(6);
      log(r, 'lined up 25R');
      ck(r, 'BEFORE TAKEOFF', 'lined up');
      // Take-off: levers to ~40 % N1, stabilize, TO/GA; A/T N1 then THR HLD at 84 kt (FCOM 4.20).
      v.set(B738.tla(1), 0.25);
      v.set(B738.tla(2), 0.25);
      r.run(4);
      press(r, INPUT.toga);
      r.run(1);
      expect(v.getString('ac.fma.at')).toBe('N1');
      expect(v.getString('ac.fma.pitch')).toBe('TO/GA');
      const start = { lat: v.get(FDM.lat), lon: v.get(FDM.lon) };
      let rotated = false;
      let rotTgt = 0;
      let maxGroundPitch = 0;
      let thrHld = false;
      let liftoffKt = NaN;
      let liftoffM = NaN;
      let lnavAt = NaN;
      let vnavAt = NaN;
      let gearUp = false;
      r.run(120, () => {
        const ias = v.get(FDM.ias);
        const onGround = v.get('gear.air_ground') === 1;
        if (v.getString('ac.fma.at') === 'THR HLD') thrHld = true;
        if (onGround) maxGroundPitch = Math.max(maxGroundPitch, v.get(FDM.pitch));
        if (onGround) {
          // Centre line with the rudder pedals (nose-wheel steering via pedals) until rotation.
          const xt = wrap180(bearingTo(r, farEnd.lat, farEnd.lon) - v.get(FDM.headingTrue));
          v.set(INPUT.yaw, Math.max(-1, Math.min(1, xt / 4)));
          if (ias >= vs.vr) rotated = true;
          if (rotated) {
            rotTgt = Math.min(15, rotTgt + 2.5 / 60); // FCTM: ~2-3 deg/s rotation to ~15 deg
            flyFd(r, rotTgt, rotTgt < 15 ? 2.5 : 0);
          }
        } else {
          v.set(INPUT.yaw, 0);
          if (Number.isNaN(liftoffKt)) {
            liftoffKt = ias;
            liftoffM = distTo(r, start.lat, start.lon) * 1852;
          }
          const climbing = rotTgt < v.get(AP.fdPitch) - 0.05;
          rotTgt = Math.min(rotTgt + 2.5 / 60, v.get(AP.fdPitch));
          flyFd(r, rotTgt, climbing ? 2.5 : 0);
        }
        if (!gearUp && !onGround && v.get(FDM.vs) > 300 && v.get(FDM.radioAlt) > 25) {
          v.set(B738.gearLever, GEAR_LEVER.up);
          gearUp = true;
        }
        if (Number.isNaN(lnavAt) && v.getString('ac.fma.roll') === 'LNAV') lnavAt = v.get(FDM.radioAlt);
        if (Number.isNaN(vnavAt) && v.getString('ac.fma.pitch').startsWith('VNAV')) vnavAt = v.get(FDM.radioAlt);
        return v.get(FDM.altAgl) > 1200;
      });
      log(r, `lift-off ${liftoffKt.toFixed(0)} KIAS at ${liftoffM.toFixed(0)} m, max ground pitch ${maxGroundPitch.toFixed(1)}, LNAV at ${lnavAt.toFixed(0)} ft RA, VNAV at ${vnavAt.toFixed(0)} ft RA`);
      expect(thrHld).toBe(true);
      expect(liftoffKt).toBeGreaterThan(vs.vr);
      // All-engine lift-off ~V2 + 5..15 kt (FCTM: V2 + 15-20 kt at 35 ft), no tail strike (11 deg, dossier §2).
      expect(liftoffKt).toBeLessThan(vs.v2 + 20);
      expect(maxGroundPitch).toBeLessThan(11);
      expect(liftoffM).toBeLessThan(2000);
      expect(lnavAt).toBeGreaterThan(40);
      expect(lnavAt).toBeLessThan(200);
      expect(vnavAt).toBeGreaterThan(380);
      expect(vnavAt).toBeLessThan(700);
      expect(v.get('gear.up_locked')).toBe(1);
      v.set(B738.gearLever, GEAR_LEVER.off);
      // CMD A above 1,000 ft (FCOM: minimum A/P engage altitude after take-off 400 ft).
      handsOff(r);
      mcp(r, 'cmd_a');
      r.run(1);
      expect(v.get(AP.engaged)).toBe(1);
      expect(v.getString('ac.fma.status')).toBe('CMD');
      log(r, 'CMD A');

      // ================================================================ 7. climb (VNAV SPD, LNAV), flaps up, after take-off checklist
      let sawN1Climb = false;
      r.run(300, () => {
        flapRetractStep(r);
        if (v.getString('ac.fma.at') === 'N1') sawN1Climb = true;
        return v.get(B738.flapLever) === FLAP_LEVER.up && v.get('surf.flaps_deg') < 0.1 && v.get(FDM.altMsl) > 5000;
      });
      expect(v.get('surf.flaps_deg')).toBeLessThan(0.1);
      expect(v.get(B738.lt.leFlapsExt) + v.get(B738.lt.leFlapsTransit)).toBe(0);
      expect(sawN1Climb).toBe(true);
      for (const i of [1, 2] as const) {
        v.set(B738.landingRetract(i), 0);
        v.set(B738.engStart(i), ENG_START.off);
      }
      v.set(B738.autobrake, 0);
      log(r, 'flaps up, after take-off checklist');
      ck(r, 'AFTER TAKEOFF');
      expect(v.getString('ac.fma.roll')).toBe('LNAV');
      expect(v.getString('ac.fma.pitch')).toBe('VNAV SPD');

      // Climb to FL320: transition altitude 18,000 ft -> STD; speed 250 below 10,000 ft (FMC restriction).
      let std = false;
      let maxIasBelow10k = 0;
      let maxCabinAlt = 0;
      let maxDiff = 0;
      let maxBank = 0;
      r.run(1800, () => {
        const alt = v.get(FDM.altMsl);
        if (alt < 9500) maxIasBelow10k = Math.max(maxIasBelow10k, v.get(FDM.ias));
        if (!std && alt > 18000) {
          r.events.emit('ac.efis1.baro_std');
          r.events.emit('ac.efis2.baro_std');
          std = true;
        }
        maxCabinAlt = Math.max(maxCabinAlt, v.get(B738.lt.cabinAltFt));
        maxDiff = Math.max(maxDiff, v.get(B738.lt.cabinDiffPsi));
        maxBank = Math.max(maxBank, Math.abs(v.get(FDM.bank)));
        if (Math.round(r.t * 60) % 18000 === 0) log(r, 'climb');
        return v.get(FDM.altMsl) > 31900 && /VNAV (PTH|ALT)/.test(v.getString('ac.fma.pitch')) && Math.abs(v.get(FDM.vs)) < 200;
      });
      log(r, `top of climb (max ${maxIasBelow10k.toFixed(0)} KIAS below 10,000 ft, max bank ${maxBank.toFixed(0)} deg)`);
      // FCOM 4.20: levelling at the FMC cruise altitude (MCP altitude = CRZ ALT) is VNAV PTH, not VNAV ALT.
      expect(v.getString('ac.fma.at')).toBe('FMC SPD');
      expect(v.getString('ac.fma.pitch')).toBe('VNAV PTH');
      expect(v.getString('ac.fma.roll')).toBe('LNAV');
      expect(maxIasBelow10k).toBeLessThan(262);
      expect(maxBank).toBeLessThan(31);
      expect(v.get('adc1.baro_std')).toBe(1);

      // ================================================================ 8. cruise
      // Centre tank empty: both CTR LOW PRESSURE lights -> CTR pumps OFF (FCOM NP.21 / SP.12), master caution reset.
      r.run(1200, () => v.get(B738.lt.fuelLowPress('c_l')) === 1 && v.get(B738.lt.fuelLowPress('c_r')) === 1);
      expect(v.get('fuel.tank2_kg')).toBeLessThan(60);
      expect(v.get(B738.lt.masterCaution)).toBe(1);
      expect(v.get(B738.lt.group('fuel'))).toBe(1);
      v.set(B738.fuelPump('c_l'), 0);
      v.set(B738.fuelPump('c_r'), 0);
      press(r, B738.masterCaution(2));
      r.run(2);
      log(r, 'centre tank empty, CTR pumps off');
      r.run(240);
      const mach = v.get(FDM.mach);
      const ffKgH = (v.get(ENG.fuelFlowPph(1)) + v.get(ENG.fuelFlowPph(2))) * 0.45359237;
      log(r, `cruise FL320: M${mach.toFixed(3)} ${v.get('fdm.tas_kt')?.toFixed?.(0)} KTAS, total FF ${ffKgH.toFixed(0)} kg/h, cabin ${v.get(B738.lt.cabinAltFt).toFixed(0)} ft / ${v.get(B738.lt.cabinDiffPsi).toFixed(2)} psi`);
      expect(Math.abs(v.get(FDM.altMsl) - 32000)).toBeLessThan(100);
      // ECON at CI 45: ~M0.78-0.79 (FCOM / line practice); 737-800W at ~62 t: ~2,300-2,500 kg/h at FL320-350.
      expect(mach).toBeGreaterThan(0.74);
      expect(mach).toBeLessThan(0.81);
      expect(ffKgH).toBeGreaterThan(1900);
      expect(ffKgH).toBeLessThan(2900);
      // Pressurization (FLT ALT still 35,000 in the controller window): cabin <= 8,000 ft, max diff 8.35 psi (FCOM).
      expect(v.get(B738.lt.cabinAltFt)).toBeLessThan(8000);
      expect(v.get(B738.lt.cabinDiffPsi)).toBeGreaterThan(6.5);
      expect(maxDiff).toBeLessThan(9.1);
      expect(v.get(B738.lt.masterCaution), active(r).join(',')).toBe(0);
      expect(v.get('cas.warning_count')).toBe(0);
      // Descent preparation: MCP altitude to the first approach constraint (CEPIN 3,000 ft) before T/D.
      mcpKnob(r, 'alt', 3000);
      v.set(B738.landAltFt, 0); // KSFO 13 ft
      ck(r, 'DESCENT', 'before autobrake set');

      // ================================================================ 9. descent (VNAV at T/D) and approach set-up
      const ils = rw28r.ils!;
      const gw = () => v.get(FDM.mass);
      const vref30 = vref(gw(), 30);
      let desStart = NaN;
      let qnhSet = false;
      let maxIasBelow10kDes = 0;
      let maxVsDes = 0;
      let sbUsed = false;
      let intv = false;
      r.run(3600, () => {
        const alt = v.get(FDM.altMsl);
        if (Number.isNaN(desStart) && v.get(FDM.vs) < -500) desStart = distTo(r, rw28r.lat, rw28r.lon);
        if (!qnhSet && alt < 17500 && !Number.isNaN(desStart)) {
          r.events.emit('ac.efis1.baro_std');
          r.events.emit('ac.efis2.baro_std');
          qnhSet = true;
        }
        if (alt < 9800) maxIasBelow10kDes = Math.max(maxIasBelow10kDes, v.get(FDM.ias));
        maxVsDes = Math.min(maxVsDes, v.get(FDM.vs));
        // 250 kt below 10,000 ft: the crew intervenes at 12,000 ft (SPD INTV 240 kt, FCOM DES page SPD REST) if the
        // VNAV target is still higher, and uses the speedbrake when > 10 kt fast (FCTM "Descent", DRAG REQUIRED).
        if (alt < 12000 && !intv && v.get('fms.vnav_tgt_speed_kt', 999) > 250) {
          r.events.emit('ac.mcp.spd_intv');
          intv = true;
        }
        if (intv && v.get(AP.selSpeed) !== 240) {
          const d = 240 - Math.round(v.get(AP.selSpeed));
          r.events.emit(`ac.mcp.spd_${d > 0 ? 'inc' : 'dec'}`, Math.abs(d));
        }
        speedbrakeStep(r, intv ? v.get(AP.selSpeed) : v.get('fms.vnav_tgt_speed_kt', 999));
        if (v.get(B738.speedbrake) > 0.1) sbUsed = true;
        if (Math.round(r.t * 60) % 7200 === 0) log(r, `desc ${distTo(r, rw28r.lat, rw28r.lon).toFixed(0)} nm, VNAV tgt ${v.get('fms.vnav_tgt_speed_kt').toFixed(0)} kt, SB ${v.get(B738.speedbrake).toFixed(2)}`);
        return distTo(r, rw28r.lat, rw28r.lon) < 26;
      });
      log(r, `approach area: T/D at ${desStart.toFixed(0)} nm from 28R, max ${maxIasBelow10kDes.toFixed(0)} KIAS below 10,000 ft, max V/S ${maxVsDes.toFixed(0)}, speedbrake used ${sbUsed}`);
      expect(v.get('adc1.baro_std')).toBe(0);
      expect(desStart).toBeGreaterThan(80);
      expect(desStart).toBeLessThan(140);
      expect(maxIasBelow10kDes).toBeLessThan(262);
      // ILS 28R: NAV 1 / 2 standby, transfer; course on both MCP course selectors (FCOM NP.21 "Descent").
      const crsMag = Math.round(ils.courseTrue - v.get('gps.mag_var_deg'));
      for (const i of [1, 2] as const) {
        v.set(NAV.standbyFreq(i), ils.freqMhz);
        press(r, B738.navXfer(i));
        const c = v.get(AP.selCourse(i));
        const d = Math.round(wrap180(crsMag - c));
        if (d) r.events.emit(`ac.mcp.crs${i}_${d > 0 ? 'inc' : 'dec'}`, Math.abs(d));
      }
      v.set(B738.autobrake, 2);
      r.run(1);
      expect(v.get(NAV.activeFreq(1))).toBeCloseTo(ils.freqMhz, 2);
      ck(r, 'DESCENT', 'after autobrake'); ck(r, 'APPROACH', 'at 26nm');
      expect(v.get(AP.selCourse(1))).toBe(crsMag);
      // Speed intervention (SPD INTV) for the approach: the crew flies the flap schedule on the MCP speed.
      if (!intv) {
        r.events.emit('ac.mcp.spd_intv');
        r.run(0.3);
      }
      mcpKnob(r, 'spd', Math.round(flapManeuverSpeed(0, gw())));
      let appArmed = false;
      let gsCaptured = false;
      let cmdB = false;
      let maxAppIas = 0;
      r.run(2400, () => {
        const ias = v.get(FDM.ias);
        const lever = v.get(B738.flapLever);
        const dist = distTo(r, rw28r.lat, rw28r.lon);
        const spd = v.get(AP.selSpeed);
        const flapDeg = v.get('surf.flaps_deg');
        // Flap / speed schedule (FCTM "Flap extension schedule"): select the next flap at its maneuver speed.
        const stow = v.get(B738.gearLever) > 0.75 ? SPEEDBRAKE.armed : SPEEDBRAKE.down;
        if (v.get('ra1.alt_ft') > 1200 || v.get(B738.speedbrake) > 0.1) speedbrakeStep(r, v.get(AP.selSpeed), stow);
        if (v.get('ra1.alt_ft') < 1000 && v.get(B738.speedbrake) > SPEEDBRAKE.armed + 0.01) v.set(B738.speedbrake, SPEEDBRAKE.armed);
        if (lever < FLAP_LEVER.f1 && dist < 22 && ias < 245) {
          v.set(B738.flapLever, FLAP_LEVER.f1);
          mcpKnob(r, 'spd', Math.round(flapManeuverSpeed(1, gw())));
        } else if (lever === FLAP_LEVER.f1 && dist < 17 && flapDeg > 0.9 && ias < flapManeuverSpeed(0, gw())) {
          v.set(B738.flapLever, FLAP_LEVER.f5);
          mcpKnob(r, 'spd', Math.round(flapManeuverSpeed(5, gw())));
        } else if (lever === FLAP_LEVER.f5 && flapDeg > 4.9 && ias < 195 && (gsCaptured || (v.get(NAV.gsDev(1)) > -1.5 && dist < 13))) {
          v.set(B738.gearLever, GEAR_LEVER.down);
          v.set(B738.flapLever, FLAP_LEVER.f15);
          v.set(B738.speedbrake, SPEEDBRAKE.armed);
          mcpKnob(r, 'spd', Math.round(flapManeuverSpeed(15, gw())));
        }
        if (!appArmed && v.get('nav1.is_loc') === 1 && Math.abs(v.get(NAV.cdi(1))) < 1.9 && dist < 25) {
          r.events.emit('ac.mcp.app');
          appArmed = true;
        } else if (appArmed && !cmdB && v.getString('ac.fma.pitch_armed').includes('G/S')) {
          r.events.emit('ac.mcp.cmd_b');
          cmdB = true;
        }
        if (!gsCaptured && v.getString('ac.fma.pitch') === 'G/S') gsCaptured = true;
        if (gsCaptured && lever === FLAP_LEVER.f15 && flapDeg > 14.9 && ias < 170 && v.get('gear.down_locked') === 1) {
          v.set(B738.flapLever, FLAP_LEVER.f30);
          mcpKnob(r, 'spd', vref30 + 5);
          for (const i of [1, 2] as const) v.set(B738.landingRetract(i), 2);
        }
        if (dist < 12) maxAppIas = Math.max(maxAppIas, ias);
        void spd;
        if (Math.round(r.t * 60) % 3600 === 0) log(r, `app ${dist.toFixed(1)} nm LOC ${v.get(NAV.cdi(1)).toFixed(2)} GS ${v.get(NAV.gsDev(1)).toFixed(2)} flaps ${flapDeg.toFixed(0)} SB ${v.get(B738.speedbrake).toFixed(2)} surf ${v.get("surf.speedbrake").toFixed(2)} gear ${v.get("gear.down_locked")}`);
        return gsCaptured && v.get('ra1.alt_ft') < 1500;
      });
      log(r, `1,500 ft RA on the glideslope, VREF30 ${vref30}, CMD B ${cmdB}`);
      expect(appArmed).toBe(true);
      expect(gsCaptured).toBe(true);
      // ================================================================ 10. autoland (FCOM 4.20 "Autoland"), rollout
      let stab1000 = false;
      let land3 = false;
      let flare = false;
      let retard = false;
      let rollout = false;
      let tdVs = NaN;
      let tdKt = NaN;
      let tdDist = NaN;
      let maxLoc = 0;
      let maxGs = 0;
      let revDeployed = false;
      let autobrakeOn = false;
      let noAutolandInRollout = false;
      r.run(300, () => {
        const ra = v.get('ra1.alt_ft');
        if (!stab1000 && ra < 1000) {
          stab1000 = true;
          // Stabilized approach at 1,000 ft (FCTM): landing flaps, gear down, VREF + 5 +/- 10, sink < 1,000 fpm.
          expect(v.get('surf.flaps_deg')).toBeGreaterThan(29);
          expect(v.get('gear.down_locked')).toBe(1);
          expect(v.get(FDM.ias)).toBeLessThan(vref30 + 20);
          expect(v.get(FDM.ias)).toBeGreaterThan(vref30);
          expect(v.get(FDM.vs)).toBeGreaterThan(-1000);
          expect(v.get(B738.lt.speedbrakeArmed)).toBe(1);
          for (const g of [0, 1, 2] as const) expect(v.get(B738.lt.gearGreen(g))).toBe(1);
          log(r, '1,000 ft stabilized');
          ck(r, 'LANDING', '1000ft');
        }
        if (ra < 1400 && ra > 100 && v.get('gear.air_ground') === 0) {
          maxLoc = Math.max(maxLoc, Math.abs(v.get(NAV.cdi(1))) * 2);
          maxGs = Math.max(maxGs, Math.abs(v.get(NAV.gsDev(1))) * 2);
        }
        if (v.getString('ac.fma.status') === 'LAND 3') land3 = true;
        if (v.getString('ac.fma.pitch') === 'FLARE') flare = true;
        if (v.getString('ac.fma.at') === 'RETARD') retard = true;
        if (v.getString('ac.fma.roll') === 'ROLLOUT') rollout = true;
        // FCOM 4.20: LAND 3 stays through the flare and the rollout (the G/S is not used after FLARE).
        if (flare && v.getString('ac.fma.status') === 'NO AUTOLAND') noAutolandInRollout = true;
        if (Number.isNaN(tdVs) && v.get('gear.air_ground') === 1) {
          tdVs = v.get(FDM.vs);
          tdKt = v.get(FDM.ias);
          tdDist = distTo(r, rw28r.lat, rw28r.lon) * 1852;
        }
        if (!Number.isNaN(tdVs)) {
          if (v.get('brakes.autobrake_active') === 1 || v.get('gear.brake_left') > 0.05) autobrakeOn = true;
          // Reverse thrust: full reverse after touchdown, reverse idle at 60 kt, stowed by taxi speed (FCOM NP.21 landing roll).
          const gs = v.get(FDM.gs);
          const rev = gs > 60 ? 1 : gs > 30 ? 0.05 : 0;
          v.set(B738.revLever(1), rev);
          v.set(B738.revLever(2), rev);
          if (v.get('eng1.reverser_pos') > 0.9 && v.get('eng2.reverser_pos') > 0.9) revDeployed = true;
          if (gs < 25) return true;
        }
      });
      log(r, `touchdown ${tdVs.toFixed(0)} fpm at ${tdKt.toFixed(0)} KIAS, ${tdDist.toFixed(0)} m from the 28R threshold; max dev LOC ${maxLoc.toFixed(2)} / GS ${maxGs.toFixed(2)} dot`);
      expect(stab1000).toBe(true);
      expect(land3).toBe(true);
      expect(flare).toBe(true);
      expect(retard).toBe(true);
      expect(rollout).toBe(true);
      expect(noAutolandInRollout).toBe(false);
      expect(v.getString('ac.fma.status')).toBe('LAND 3');
      expect(tdVs).toBeLessThan(0);
      expect(tdVs).toBeGreaterThan(-600);
      expect(tdKt).toBeGreaterThan(vref30 - 10);
      expect(tdKt).toBeLessThan(vref30 + 10);
      expect(tdDist).toBeGreaterThan(150);
      expect(tdDist).toBeLessThan(900);
      expect(maxLoc).toBeLessThan(1);
      expect(maxGs).toBeLessThan(1);
      expect(revDeployed).toBe(true);
      expect(autobrakeOn).toBe(true);
      expect(v.get(B738.speedbrake)).toBeGreaterThan(0.9); // auto speedbrake: lever back-driven UP
      expect(v.get(FDM.crashed)).toBe(0);
      expect(Math.abs(wrap180(v.get(FDM.headingTrue) - rw28r.headingTrue))).toBeLessThan(3);

      // ================================================================ 11. after landing, taxi in, shutdown, secure
      v.set(INPUT.apDisconnect, 1);
      r.run(0.3);
      v.set(INPUT.apDisconnect, 0);
      r.run(0.5);
      press(r, INPUT.apDisconnect); // second push silences the warning / resets the A/P disengage light
      expect(v.get(AP.engaged)).toBe(0);
      r.events.emit('at.disc');
      r.run(0.5);
      v.set(B738.revLever(1), 0);
      v.set(B738.revLever(2), 0);
      // Manual braking takes over from the autobrake (DISARM light), then the after-landing flow.
      v.set(INPUT.brakeLeft, 0.5);
      v.set(INPUT.brakeRight, 0.5);
      r.run(1);
      expect(v.get(B738.lt.autoBrakeDisarm)).toBe(1);
      stopOnGround(r);
      v.set(B738.autobrake, 0);
      v.set(B738.speedbrake, SPEEDBRAKE.down);
      v.set(B738.flapLever, FLAP_LEVER.up);
      for (const i of [1, 2] as const) {
        v.set(B738.landingRetract(i), 0);
        v.set(B738.landingFixed(i), 0);
        v.set(B738.engStart(i), ENG_START.off);
      }
      v.set(B738.positionLt, -1);
      v.set(B738.taxiLt, 1);
      v.set(B738.xpdrModeSel, XPDR_SEL.stby);
      v.set(B738.probeHeat('a'), 0);
      v.set(B738.probeHeat('b'), 0);
      // APU start for the stand.
      v.set(B738.apuSw, APU_SW.start);
      r.run(0.5);
      v.set(B738.apuSw, APU_SW.on);
      // Taxi clear of the runway to a stand 300 m right of the centre line.
      const here = { lat: v.get(FDM.lat), lon: v.get(FDM.lon) };
      const exit = destinationPoint(here.lat, here.lon, rw28r.headingTrue + 45, 150 / 1852);
      const gate = destinationPoint(here.lat, here.lon, rw28r.headingTrue + 90, 300 / 1852);
      taxiTo(r, exit, 10, 25);
      taxiTo(r, gate, 12, 20);
      stopOnGround(r);
      v.set(B738.parkBrake, 1);
      r.run(90, () => v.get('apu.avail') === 1);
      r.run(2);
      expect(v.get('apu.avail')).toBe(1);
      expect(v.get('surf.flaps_deg')).toBeLessThan(0.1);
      log(r, 'on stand, APU running');
      // Shutdown (FCOM NP.21 "Shutdown procedure"): APU GENs on, start levers CUTOFF, pumps off, beacon off.
      press(r, B738.apuGenSw(1));
      press(r, B738.apuGenSw(2));
      r.run(1);
      expect(v.get(B738.xfrSrc(1))).toBe(2);
      expect(v.get(B738.xfrSrc(2))).toBe(2);
      v.set(B738.taxiLt, 0);
      v.set(B738.startLever(1), 0);
      v.set(B738.startLever(2), 0);
      r.run(60, () => v.get(ENG.n2(1)) < 5 && v.get(ENG.n2(2)) < 5);
      expect(v.get(ENG.running(1)) + v.get(ENG.running(2))).toBe(0);
      expect(v.get(B738.lt.engValveClosed(1))).toBe(1); // dim: valve closed (bright only in transit, FCOM 12.10)
      v.set(B738.antiColl, 0);
      v.set(B738.fastenBelts, 0);
      for (const p of FUEL_PUMPS) v.set(B738.fuelPump(p), 0);
      v.set(B738.hydPump('elec1'), 0);
      v.set(B738.hydPump('elec2'), 0);
      r.run(5);
      // Engines stopped on the ground: DRIVE lights, hydraulic ENG pump LOW PRESSURE; buses on the APU.
      expect(v.get(B738.lt.drive(1))).toBe(1);
      expect(v.get('elec.xfr1_powered') + v.get('elec.xfr2_powered')).toBe(2);
      log(r, 'engines shut down');
      ck(r, 'SHUTDOWN');
      // Secure (FCOM NP.21 "Secure procedure"): IRS OFF, emergency exit lights OFF, window heat OFF, packs OFF,
      // APU OFF (60 s cool-down), then BAT OFF.
      v.set('ac.irs1_mode', 0);
      v.set('ac.irs2_mode', 0);
      v.set(B738.emerExitLt, 0);
      for (const w of ['l_side', 'l_fwd', 'r_fwd', 'r_side'] as const) v.set(B738.windowHeat(w), 0);
      v.set(B738.pack(1), 0);
      v.set(B738.pack(2), 0);
      v.set(B738.apuSw, APU_SW.off);
      r.run(150, () => v.get('apu.running') === 0 && v.get('apu.n_pct') < 5);
      expect(v.get('apu.running')).toBe(0);
      expect(v.get('apu.fault')).toBe(0);
      v.set(B738.batSw, 0);
      r.run(5);
      expect(v.get('elec.batt_bus_powered')).toBe(0);
      expect(v.get('display.b737_du_capt_out.power')).toBe(0);
      const burn = 8000 - v.get('fuel.total_kg');
      log(r, `secured; block fuel ${burn.toFixed(0)} kg`);
      ck(r, 'SECURE');
      // Block fuel LAX-SFO (~300 nm air distance) for a 737-800: ~3,000-3,600 kg (EST line figure incl. taxi).
      expect(burn).toBeGreaterThan(2400);
      expect(burn).toBeLessThan(4200);
    } finally {
      console.log(LOG.join('\n'));
    }
  });
});
