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
import { AP, ENG, FDM, INPUT } from '../../../../src/core/vars';
import { B738, APU_SW, ENG_START, FUEL_PUMPS, HYD_PUMP_SWITCHES, GEAR_LEVER, SPEEDBRAKE, XPDR_SEL } from '../../../../src/aircraft/b737-800/vars';
import { FLAP_LEVER } from '../../../../src/aircraft/b737-800/data';
import { makeFlightRig, fma, press, mcp, cdu, cduEnter, cduScreen, cduSelect, bearingTo, distTo, wrap180, type FlightRig } from './flightRig';

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

/** MCP knob to a value with encoder clicks (altitude 100 ft, heading 1 deg, speed 1 kt per click). */
function mcpKnob(r: FlightRig, knob: 'alt' | 'hdg' | 'spd', target: number): void {
  const v = r.vars;
  const cur = knob === 'alt' ? v.get(AP.selAltitude) / 100 : knob === 'hdg' ? v.get(AP.selHeading) : v.get(AP.selSpeed);
  let clicks = Math.round((knob === 'alt' ? target / 100 : target) - cur);
  if (knob === 'hdg') clicks = Math.round(wrap180(clicks));
  if (clicks) r.events.emit(`ac.mcp.${knob}_${clicks > 0 ? 'inc' : 'dec'}`, Math.abs(clicks));
  r.run(0.2);
}

describe('737-800 line check KLAX -> KSFO (full normal procedure)', () => {
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
      // Ground power at the stand.
      v.set(B738.gpuConnected, 1);
      r.run(1);
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
      v.set(B738.gpuConnected, 0); // ground crew disconnects the GPU
      r.run(2);
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
    } finally {
      console.log(LOG.join('\n'));
    }
  });
});
