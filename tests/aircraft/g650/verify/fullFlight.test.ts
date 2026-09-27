/**
 * Gulfstream G650 check ride, headless: one continuous flight from cold & dark
 * at Savannah (KSAV, Gulfstream's home field) to Atlanta (KATL) and back to
 * cold & dark, flown only through the cockpit controls (G650_VARS), the
 * guidance-panel keys (epic.gp.*), the pedestal MCDU 1 (Mcdu.key) and the
 * yoke, pedals, tiller and toe brakes.
 *
 *   KSAV/10  ->  MCN  ->  HAINZ (I26R transition)  ->  ILS 26R KATL, cruise FL300
 *
 * Phases (dossier §6 normal procedures, checklists.ts): Before Starting Engines
 * (batteries, FLT CTRL BATTERIES, EMERGENCY POWER ARM, APU battery start) ->
 * Starting Engines (APU bleed, START MASTER, R then L auto start, FUEL CONTROL
 * RUN) -> After Start (GENs, BLEEDs, APU off) -> IRS alignment, FMS route and
 * PERF INIT on MCDU 1 -> taxi (tiller) -> takeoff (A/T TO, TO/TO FD, RTO
 * autobrake) -> AP, LNAV + FLCH, VNAV climb -> cruise FL300 -> VNAV descent ->
 * ILS 26R (APR: NAV SRC switches to LOC, LOC / GS capture) -> AP off at the 80 ft
 * ILS minimum disengage height (LIM; no autoland on the G650) -> hand flare ->
 * rollout (ground spoilers, reversers, autobrake MED) -> taxi clear -> shutdown.
 *
 * Every step asserts annunciations / CAS / FMA and physically sensible numbers.
 */
import { describe, expect, it } from 'vitest';
import { NavDatabaseImpl } from '../../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../../src/nav/data/nodeLoader';
import { alongTrackNm, crossTrackNm, destinationPoint, distanceNm } from '../../../../src/core/geo';
import { FDM, INPUT } from '../../../../src/core/vars';
import { G650_VARS as V } from '../../../../src/aircraft/g650/vars';
import { G650_LIMITS, TOFL_MTOW_SL_ISA_FT, takeoffSpeeds, vref } from '../../../../src/aircraft/g650/data';
import { makeFlightRig, casActive, fma, press, gp, type, settle, bearingTo, wrap180, type FlightRig } from './flightRig';

const LBKG = 0.45359237;
/** LIM: autopilot minimum disengage height on an ILS / LPV approach. */
const AP_MIN_DISENGAGE_ILS_FT = 80;
const LOG: string[] = [];
function log(r: FlightRig, what: string): void {
  const v = r.vars;
  LOG.push(
    `[${(r.t / 60).toFixed(1).padStart(5)} min] ${what} | ${v.get(FDM.altMsl).toFixed(0)} ft ${v.get(FDM.ias).toFixed(0)} KIAS M${v.get(FDM.mach).toFixed(2)} VS ${v.get(FDM.vs).toFixed(0)} | N1 ${v.get('eng1.n1_pct').toFixed(1)}/${v.get('eng2.n1_pct').toFixed(1)} | ${fma(r)} | CAS ${casActive(r).join(',')}`,
  );
}

/** Ground steering + speed controller (pilot on the tiller, toe brakes and thrust levers). */
function taxiStep(r: FlightRig, tgtLat: number, tgtLon: number, gsKt: number): void {
  const v = r.vars;
  const err = wrap180(bearingTo(r, tgtLat, tgtLon) - v.get(FDM.headingTrue));
  v.set(V.tiller3d, Math.max(-1, Math.min(1, err / 30)));
  const e = gsKt - v.get(FDM.gs);
  const lever = Math.max(0, Math.min(0.25, 0.04 + 0.02 * e));
  v.set(V.tla(1), lever);
  v.set(V.tla(2), lever);
  const brake = e < -2 ? Math.min(1, -0.1 * e) : 0;
  v.set(INPUT.brakeLeft, brake);
  v.set(INPUT.brakeRight, brake);
}

function stopOnGround(r: FlightRig): void {
  const v = r.vars;
  v.set(V.tla(1), 0);
  v.set(V.tla(2), 0);
  v.set(V.tiller3d, 0);
  r.run(40, () => {
    v.set(INPUT.brakeLeft, 0.6);
    v.set(INPUT.brakeRight, 0.6);
    return v.get(FDM.gs) < 0.3;
  });
}

/** Crew speed-brake technique in a descent: extend when > 15 kt fast, retract near the target. */
function speedbrakeStep(r: FlightRig): void {
  const v = r.vars;
  const fast = v.get(FDM.ias) - v.get('ap.sel_spd_kt');
  const sb = v.get(V.speedbrake);
  if (fast > 15 && v.get(FDM.vs) < -300 && v.get(FDM.altAgl) > 1500) v.set(V.speedbrake, 0.5);
  else if (sb > 0 && (fast < 5 || v.get(FDM.altAgl) < 1500)) v.set(V.speedbrake, 0);
}

describe('G650 check ride KSAV -> KATL (full normal procedure)', () => {
  it('flies cold & dark to cold & dark through the cockpit controls', { timeout: 1_800_000 }, async () => {
    const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
    await db.load();
    const ksav = db.airport('KSAV')!;
    const katl = db.airport('KATL')!;
    const rw10 = ksav.runways.find((x) => x.ident === '10')!;
    const rw26r = katl.runways.find((x) => x.ident === '26R')!;
    expect(rw10 && rw26r).toBeTruthy();
    expect(rw26r.ils).toBeTruthy();
    // Ramp spot: 200 m right of the 10 centre line, 300 m down the runway, facing the runway.
    const along = destinationPoint(rw10.lat, rw10.lon, rw10.headingTrue, 300 / 1852);
    const far = destinationPoint(rw10.lat, rw10.lon, rw10.headingTrue, 2);
    const ramp = destinationPoint(along.lat, along.lon, rw10.headingTrue + 90, 200 / 1852);
    // 2 crew in the BOW + 6 passengers and bags (1,600 lb), 16,000 lb fuel -> ~72,000 lb ramp weight.
    const fuelLb = 16000;
    const r = makeFlightRig({ db, origin: ksav, dest: katl, start: { lat: ramp.lat, lon: ramp.lon, headingTrue: rw10.headingTrue - 90 }, fuelLb, payloadLb: 1600 });
    const v = r.vars;
    const sys = r.sys;
    const suite = sys.suite!;
    const pilot = r.pilot;
    try {
      // ================================================================ 1. cold & dark
      let airFrames = 0;
      r.run(1, () => void (v.get('gear.air_ground') === 0 && airFrames++));
      expect(airFrames).toBe(0); // squat switches snapped to the ground placement (A/T touchdown logic)
      expect(v.get('elec.l_ess_dc_powered')).toBe(0);
      expect(v.get('eng1.running') + v.get('eng2.running')).toBe(0);
      expect(v.get('alert.master_warning')).toBe(0);
      expect(v.get('display.epic.du1.power')).toBe(0);
      log(r, 'cold & dark');

      // ================================================================ 2. Before Starting Engines: power-up
      v.set(V.parkBrake, 1);
      v.set(V.battL, 1);
      v.set(V.battR, 1);
      v.set(V.ebhaBatt, 1);
      v.set(V.upsBatt, 1);
      v.set(V.emerPwr, 1); // ARM
      v.set(V.ltEmer, 1); // ARM
      v.set(V.doorMain, 0);
      for (const k of [V.boostL, V.boostR, V.altL, V.altR]) v.set(k, 1);
      v.set(V.auxPump, 1);
      v.set(V.ptu, 1);
      v.set(V.crewOxy, 1);
      v.set(V.paxOxy, 1);
      r.run(3);
      expect(v.get('elec.l_ess_dc_v')).toBeGreaterThan(24.5);
      expect(v.get('elec.emer_dc_powered')).toBe(1);
      expect(v.get('elec.l_main_ac_powered')).toBe(0);
      expect(casActive(r)).toContain('Parking Brake On');
      expect(casActive(r, 'warning')).toEqual([]);
      log(r, 'batteries on');

      // ================================================================ 3. APU battery start (LUC apu: READY 10-16 s)
      v.set(V.apuMaster, 1);
      r.run(14);
      press(r, V.apuStart, 0.5);
      let minBatt = 99;
      let apuT = NaN;
      r.run(90, (t) => {
        minBatt = Math.min(minBatt, v.get('elec.l_batt_bus_v'));
        if (isNaN(apuT) && v.get('elec.apu_gen_online') === 1) apuT = t;
        return !isNaN(apuT) && t > apuT + 3;
      });
      expect(apuT).toBeLessThan(80);
      expect(minBatt).toBeGreaterThan(14); // starter dip, the relays hold
      expect(v.get('elec.l_main_ac_powered')).toBe(1);
      expect(v.get('elec.r_main_ac_powered')).toBe(1);
      expect(v.get('display.epic.du1.power')).toBe(1);
      expect(v.get('display.epic.mcdu1.power')).toBe(1);
      log(r, `APU on line (${apuT.toFixed(0)} s), min L batt bus ${minBatt.toFixed(1)} V`);

      // ================================================================ 4. Starting Engines, right first
      v.set(V.bleedApu, 1);
      v.set(V.ltBeacon, 1);
      v.set(V.ltNav, 1);
      r.run(62); // LUC: APU bleed available 60 s after the APU is on speed
      v.set(V.startMaster, 1);
      r.run(4);
      expect(v.get('pneu.iso_open')).toBe(1);
      expect(v.get('pneu.l_duct_psi')).toBeGreaterThan(30);
      for (const [i, fuelCtl, start] of [
        [2, V.fuelCtlR, V.startR],
        [1, V.fuelCtlL, V.startL],
      ] as const) {
        press(r, start, 0.5);
        r.run(3);
        v.set(fuelCtl, 1); // FUEL CONTROL RUN once the engine is motoring
        let peak = 0;
        const t0 = r.t;
        r.run(90, () => {
          peak = Math.max(peak, v.get(`eng${i}.itt_c`));
          return v.getString(`fadec.eng${i}.start_status`) === 'RUN';
        });
        expect(v.get(`eng${i}.running`)).toBe(1);
        expect(v.get(`fadec.eng${i}.abort`)).toBe(0);
        expect(peak).toBeLessThan(G650_LIMITS.tgtStartGroundC);
        expect(r.t - t0).toBeLessThan(60);
        log(r, `engine ${i} started in ${(r.t - t0).toFixed(0)} s, peak TGT ${peak.toFixed(0)}`);
      }
      v.set(V.startMaster, 0);
      v.set(V.bleedL, 1);
      v.set(V.bleedR, 1);
      v.set(V.bleedApu, 0);
      r.run(10);

      expect(v.get('elec.idg1_online')).toBe(1);
      expect(v.get('elec.idg2_online')).toBe(1);
      v.set(V.apuMaster, 0); // APU off after the start
      r.run(20);
      expect(v.get('hyd.left_psi')).toBeGreaterThan(2800);
      expect(v.get('hyd.right_psi')).toBeGreaterThan(2800);
      expect(v.get('elec.l_ess_dc_v')).toBeGreaterThan(27);
      expect(casActive(r, 'warning')).toEqual([]);
      for (const t of ['Generator', 'Autostart Abort', 'Oil Pressure Low', 'Hyd System Fail', 'AC Power Fail', 'Engine Fuel Pressure']) {
        expect(casActive(r).filter((p) => p.includes(t))).toEqual([]);
      }
      log(r, 'engines running, APU off');

      // ================================================================ 5. avionics: IRS alignment, FMS on MCDU 1
      r.run(900, () => v.get('ahrs1.valid') === 1 && v.get('ahrs2.valid') === 1 && v.get('ahrs3.valid') === 1 && v.get('adc1.valid') === 1);
      expect(v.get('ahrs1.valid')).toBe(1);
      expect(casActive(r)).not.toContain('IRS 1-2-3 Aligning');
      log(r, 'IRS aligned');
      const m = suite.mcdus[0];
      expect(m).toBeTruthy();
      m.key('FPL');
      r.run(0.2);
      type(m, 'KSAV');
      m.key('L1');
      type(m, 'KATL');
      m.key('R1');
      r.run(0.5);
      expect(m.screen.title).toBe('MOD FLT PLAN');
      // Departure runway 10 (NAV INDEX > DEP/ARR > DEPART).
      m.key('NAV');
      r.run(0.2);
      expect(m.page.id).toBe('NAV_INDEX');
      m.key('L5');
      r.run(0.2);
      expect(m.page.id).toBe('DEPARR');
      m.key('L1');
      await settle(r);
      const rwIdx = ksav.runways.findIndex((x) => x.ident === '10');
      for (let p = 0; p < Math.floor(rwIdx / 5); p++) m.key('NEXT');
      m.key(`L${(rwIdx % 5) + 1}` as 'L1');
      r.run(0.2);
      // Enroute: MCN (Macon VORTAC), inserted before the destination.
      m.key('FPL');
      r.run(0.2);
      const legs0 = sys.fms.plans.displayed.legs.length;
      type(m, 'MCN');
      m.key(`L${Math.min(5, 2 + legs0)}` as 'L2');
      r.run(0.5);
      if (m.screen.scratch.length) LOG.push(`scratch after MCN: ${m.screen.scratch}`);
      // Arrival: ILS 26R via HAINZ.
      m.key('NAV');
      r.run(0.2);
      m.key('L5');
      r.run(0.2);
      m.key('R1'); // ARRIVE>
      await settle(r, 400);
      const procs = suite.fmsShared.procedures('KATL');
      expect(procs).toBeTruthy();
      const aIdx = procs!.approaches.findIndex((a) => a.ident === 'I26R');
      expect(aIdx).toBeGreaterThanOrEqual(0);
      for (let p = 0; p < Math.floor(aIdx / 5); p++) m.key('NEXT');
      m.key(`L${(aIdx % 5) + 1}` as 'L1');
      r.run(0.2);
      const tIdx = procs!.approaches[aIdx].transitions.findIndex((t) => t.name === 'HAINZ');
      expect(tIdx).toBeGreaterThanOrEqual(0);
      m.key(`L${tIdx + 2}` as 'L1'); // row 1 is VECTORS
      r.run(0.2);
      expect(m.page.id).toBe('FPL');
      // Close the discontinuity after MCN (DELETE on the DISCO line).
      const dIdx = sys.fms.plans.displayed.legs.findIndex((l) => l.type === 'DISCO');
      if (dIdx >= 0) {
        const sub = dIdx < 4 ? 0 : 1 + Math.floor((dIdx - 4) / 5);
        const row = dIdx < 4 ? dIdx + 2 : ((dIdx - 4) % 5) + 1;
        for (let p = 0; p < sub; p++) m.key('NEXT');
        m.key('DEL');
        m.key(`L${row}` as 'L1');
        r.run(0.2);
        m.key('FPL');
      }
      expect(sys.fms.plans.displayed.legs.some((l) => l.type === 'DISCO')).toBe(false);
      m.key('R6'); // ACTIVATE>
      r.run(1);
      expect(suite.fmsShared.modPending).toBe(false);
      const legs = sys.fms.plans.active.legs.map((l) => l.fix?.ident ?? l.type);
      LOG.push('plan: ' + legs.join(' '));
      expect(legs).toContain('MCN');
      expect(legs).toContain('HAINZ');
      expect(sys.fms.plans.active.approach?.ident).toBe('I26R');
      // PERF INIT: cruise FL300, BOW, passengers / cargo, CONFIRM INIT.
      m.key('PERF');
      r.run(0.2);
      m.show('PERF_INIT');
      type(m, 'FL300');
      m.key('R3');
      m.key('NEXT');
      type(m, String(G650_LIMITS.bowLb));
      m.key('L1');
      type(m, '1600');
      m.key('L3');
      m.key('NEXT');
      m.key('R6');
      r.run(1);
      expect(v.get('epic.fms.perf_init')).toBe(1);
      if (suite.fmsShared.modPending) {
        m.key('FPL');
        m.key('R6');
        r.run(0.5);
      }
      expect(suite.fmsShared.modPending).toBe(false);
      r.run(3);
      LOG.push(`fms: next ${v.getString('fms.next_wpt')} dist ${v.get('fms.dist_to_dest_nm').toFixed(1)} crz ${v.get('fms.crz_alt_ft')}`);
      expect(v.get('fms.crz_alt_ft')).toBe(30000);
      const planNm = v.get('fms.dist_to_dest_nm');
      expect(planNm).toBeGreaterThan(180);
      expect(planNm).toBeLessThan(320);
      // Takeoff data: V-speeds for the actual weight, flaps 20.
      const grossLb = v.get('fdm.mass_kg') / LBKG;
      const sp = takeoffSpeeds(grossLb);
      v.set('epic.vspd.v1', sp.v1);
      v.set('epic.vspd.vr', sp.vr);
      v.set('epic.vspd.v2', sp.v2);
      v.set('ap.sel_alt_ft', 10000);
      v.set('ap.sel_hdg_deg', Math.round(rw10.headingTrue - v.get('fdm.mag_var_deg')));
      v.set('ap.sel_spd_kt', sp.v2 + 10);
      LOG.push(`gross ${grossLb.toFixed(0)} lb, V1/VR/V2 ${sp.v1}/${sp.vr}/${sp.v2}`);
      log(r, 'avionics set up');

      // ================================================================ 6. before taxi / taxi
      v.set(V.flapLever, 2);
      v.set(V.gndSpoiler, 1);
      v.set(V.ltTaxi, 1);
      v.set(V.seatBelt, 1);
      v.set(V.nwsPower, 1);
      r.run(15);
      expect(v.get('surf.flaps_deg')).toBeCloseTo(20, 0);
      expect(casActive(r)).not.toContain('Ground Spoiler Unarm');
      expect(casActive(r)).not.toContain('Pedal Steering Off');
      v.set(V.parkBrake, 0);
      r.run(2);
      expect(casActive(r)).not.toContain('Parking Brake On');
      const rwAlong = () => alongTrackNm(rw10.lat, rw10.lon, far.lat, far.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      const rwCross = () => crossTrackNm(rw10.lat, rw10.lon, far.lat, far.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      let taxiMaxGs = 0;
      r.run(300, () => {
        const p = destinationPoint(rw10.lat, rw10.lon, rw10.headingTrue, (rwAlong() + 70) / 1852);
        taxiStep(r, p.lat, p.lon, Math.abs(rwCross()) > 30 ? 12 : 7);
        taxiMaxGs = Math.max(taxiMaxGs, v.get(FDM.gs));
        return Math.abs(rwCross()) < 2 && Math.abs(wrap180(v.get(FDM.headingTrue) - rw10.headingTrue)) < 2;
      });
      stopOnGround(r);
      const xt = Math.abs(rwCross());
      LOG.push(`lined up ${xt.toFixed(1)} m off the centre line, hdg ${v.get(FDM.headingTrue).toFixed(1)}, max taxi GS ${taxiMaxGs.toFixed(0)}`);
      expect(taxiMaxGs).toBeLessThan(25);
      expect(xt).toBeLessThan(15);
      expect(v.get('fdm.crashed')).toBe(0);
      log(r, 'lined up 10');

      // ================================================================ 7. before takeoff / takeoff
      v.set(V.autobrake, -1); // RTO
      v.set(V.ltLdgL, 1);
      v.set(V.ltLdgR, 1);
      v.set(V.ltStrobe, 1);
      v.set(V.ltTaxi, 0);
      r.run(1);
      expect(casActive(r)).toContain('Autobrake - RTO');
      expect(casActive(r, 'warning')).toEqual([]);
      expect(casActive(r, 'caution')).toEqual([]);
      gp(r, 'at'); // A/T armed
      r.events.emit('ap.toga'); // TO/GA on the thrust levers
      r.run(0.5);
      gp(r, 'nav'); // LNAV armed for after takeoff
      LOG.push('takeoff FMA ' + fma(r));
      expect(v.getString('ap.vert_active')).toBe('TO');
      expect(v.getString('ap.lat_armed')).toContain('LNAV');
      expect(v.get('ap.at_engaged')).toBe(1);
      expect(v.getString('fadec.rating')).toBe('TO');
      v.set(INPUT.brakeLeft, 1);
      v.set(INPUT.brakeRight, 1);
      r.run(15, () => v.get('eng1.n1_pct') > 80 && v.get('eng2.n1_pct') > 80);
      v.set(INPUT.brakeLeft, 0);
      v.set(INPUT.brakeRight, 0);
      const brakeRelease = { lat: v.get(FDM.lat), lon: v.get(FDM.lon) };
      let liftoffFt = NaN;
      pilot.startTakeoff({ vrKt: sp.vr, courseTrueDeg: rw10.headingTrue, lat: rw10.lat, lon: rw10.lon, pitchDeg: 12, gearUp: false });
      let n1To = 0;
      let holdSeen = false;
      let gearUpAgl = NaN;
      let tocw = false;
      r.run(90, () => {
        if (isNaN(liftoffFt) && !isNaN(pilot.log.liftoffIasKt)) liftoffFt = distanceNm(brakeRelease.lat, brakeRelease.lon, v.get(FDM.lat), v.get(FDM.lon)) * 6076.1;
        if (v.getString('ap.at_mode') === 'HOLD') holdSeen = true;
        if (v.get('alert.takeoff_config')) tocw = true;
        n1To = Math.max(n1To, v.get('eng1.n1_pct'));
        const agl = v.get(FDM.altAgl);
        if (isNaN(gearUpAgl) && agl > 50 && v.get(FDM.vs) > 300) {
          gearUpAgl = agl;
          v.set(V.gearHandle, 0);
        }
        return agl > 500;
      });
      pilot.stop();
      LOG.push(`takeoff: rotate ${pilot.log.rotateIasKt.toFixed(0)} liftoff ${pilot.log.liftoffIasKt.toFixed(0)} KIAS at ${liftoffFt.toFixed(0)} ft, max N1 ${n1To.toFixed(1)}, max dev ${pilot.log.maxGroundDeviationM.toFixed(1)} m, max pitch ${pilot.log.maxPitchDeg.toFixed(1)}`);
      log(r, '500 ft AGL');
      expect(tocw).toBe(false);
      expect(holdSeen).toBe(true);
      expect(n1To).toBeGreaterThan(85);
      expect(n1To).toBeLessThanOrEqual(G650_LIMITS.n1TakeoffPct + 0.1);
      // ~72,000 lb: lift-off well inside the MTOW balanced field length, before V2 + 15.
      expect(liftoffFt).toBeLessThan(TOFL_MTOW_SL_ISA_FT * 0.6);
      expect(pilot.log.liftoffIasKt).toBeLessThan(sp.v2 + 15);
      expect(pilot.log.maxGroundDeviationM).toBeLessThan(5);
      expect(pilot.log.maxPitchDeg).toBeLessThan(18);

      // ================================================================ 8. after takeoff: AP on, LNAV, flaps up, FLCH, VNAV climb
      v.set(INPUT.pitch, 0);
      v.set(INPUT.roll, 0);
      v.set(INPUT.yaw, 0);
      gp(r, 'ap');
      expect(v.get('ap.engaged')).toBe(1);
      r.run(30, () => v.getString('ap.lat_active') === 'LNAV');
      log(r, 'AP on');
      expect(v.getString('ap.lat_active')).toBe('LNAV');
      v.set('ap.sel_spd_kt', sp.v2 + 20);
      gp(r, 'flch');
      r.run(15);
      expect(v.get('gear.up_locked')).toBe(1);
      r.run(90, () => v.get(FDM.ias) > sp.v2 + 15);
      v.set(V.flapLever, 0);
      v.set(V.autobrake, 0);
      v.set('ap.sel_spd_kt', 250);
      r.run(40);
      expect(v.getString('ap.vert_active')).toBe('FLCH');
      expect(v.getString('fadec.rating')).toBe('CLB');
      log(r, 'flaps up, FLCH');
      v.set('ap.sel_alt_ft', 30000); // cleared FL300
      gp(r, 'vnav');
      r.run(2);
      log(r, 'VNAV');
      expect(v.getString('ap.vert_active')).toMatch(/^V/);
      let maxBank = 0;
      let maxIas = 0;
      let ldgOff = false;
      let cabinMax = 0;
      const climbT0 = r.t;
      r.run(2400, () => {
        maxBank = Math.max(maxBank, Math.abs(v.get(FDM.bank)));
        maxIas = Math.max(maxIas, v.get(FDM.ias));
        cabinMax = Math.max(cabinMax, v.get('press.cabin_alt_ft'));
        if (!ldgOff && v.get(FDM.altMsl) > 10000) {
          ldgOff = true;
          v.set(V.ltLdgL, 0);
          v.set(V.ltLdgR, 0);
        }
        if (v.get(FDM.altMsl) > 18000 && v.get('adc1.baro_std') === 0) {
          r.events.emit('epic.gp.baro1_push');
          r.events.emit('epic.gp.baro2_push');
        }
        return Math.abs(v.get(FDM.altMsl) - 30000) < 60 && /ALT/.test(v.getString('ap.vert_active')) && !/S/.test(v.getString('ap.vert_active'));
      });
      log(r, `level FL300 after ${((r.t - climbT0) / 60).toFixed(1)} min, cabin max ${cabinMax.toFixed(0)} ft`);
      expect(Math.abs(v.get('adc1.alt_ft') - 30000)).toBeLessThan(150);
      expect(maxBank).toBeLessThan(30);
      expect(maxIas).toBeLessThan(G650_LIMITS.vmoKt);
      expect(Math.abs(v.get('fms.xtk_nm'))).toBeLessThan(1);
      expect(v.get('adc1.baro_std')).toBe(1);
      expect(casActive(r, 'warning')).toEqual([]);
      expect(casActive(r, 'caution')).toEqual([]);

      // ================================================================ 9. cruise FL300: M0.85 (GAC long-range cruise) on the SPD knob
      v.set('ap.sel_mach', 0.85);
      v.set('ap.spd_is_mach', 1);
      r.run(240);
      log(r, 'cruise');
      expect(v.getString('ap.lat_active')).toBe('LNAV');
      expect(Math.abs(v.get('adc1.alt_ft') - 30000)).toBeLessThan(60); // RVSM
      const crzMach = v.get(FDM.mach);
      expect(crzMach).toBeGreaterThan(0.7);
      expect(crzMach).toBeLessThan(G650_LIMITS.mmoLow);
      const ffCrz = v.get('eng1.ff_pph') + v.get('eng2.ff_pph');
      LOG.push(`cruise FL300 M${crzMach.toFixed(3)} ${v.get(FDM.tas).toFixed(0)} KTAS ${ffCrz.toFixed(0)} pph, cabin ${v.get('press.cabin_alt_ft').toFixed(0)} ft dP ${v.get('press.diff_psi').toFixed(2)}, rating ${v.getString('fadec.rating')}`);
      // AIN: 2,960 lb/h at FL450 M0.91 ~64,500 lb; FL300 costs more (EST band).
      expect(ffCrz).toBeGreaterThan(2400);
      expect(ffCrz).toBeLessThan(5000);
      expect(v.get('press.cabin_alt_ft')).toBeLessThan(2500);
      expect(v.get('press.diff_psi')).toBeGreaterThan(7);
      const fuel0 = v.get('fuel.total_kg');
      r.run(60);
      const burn = (fuel0 - v.get('fuel.total_kg')) / LBKG;
      expect(burn * 60).toBeGreaterThan(0.9 * ffCrz); // the tanks decrement at the engine flow
      expect(burn * 60).toBeLessThan(1.1 * ffCrz);

      // ================================================================ 10. descent: VNAV path
      v.set('ap.sel_alt_ft', 4000);
      v.set('ap.spd_is_mach', 0); // SPD knob back to IAS (FMS speed in the VNAV modes)
      v.set('ap.sel_spd_kt', 300);
      if (!/^V/.test(v.getString('ap.vert_active')) && !v.getString('ap.vert_armed').includes('VPATH')) gp(r, 'vnav');
      let pathSeen = false;
      let maxDesIas = 0;
      r.run(2400, () => {
        speedbrakeStep(r);
        if (v.getString('ap.vert_active') === 'VPATH') pathSeen = true;
        maxDesIas = Math.max(maxDesIas, v.get(FDM.ias));
        if (v.get(FDM.altMsl) < 17500 && v.get('adc1.baro_std') === 1) {
          r.events.emit('epic.gp.baro1_push');
          r.events.emit('epic.gp.baro2_push');
        }
        return pathSeen && v.get('fms.dist_to_dest_nm') < 40;
      });
      log(r, 'descending, 40 nm to go');
      expect(pathSeen).toBe(true);
      expect(maxDesIas).toBeLessThan(G650_LIMITS.vmoKt);
      expect(v.get('adc1.baro_std')).toBe(0);

      // ================================================================ 11. approach: ILS 26R
      const wLand = v.get('fdm.mass_kg') / LBKG;
      const vapp = vref(wLand) + 5;
      v.set('epic.vspd.vref', vref(wLand));
      v.set('epic.vspd.vapp', vapp);
      v.set(V.autobrake, 2); // MED
      v.set(V.ltLdgL, 1);
      v.set(V.ltLdgR, 1);
      v.set(V.fltLdg, 1); // CABIN PRESSURE: LANDING
      if (v.get('epic.gp.spd_man') === 0) gp(r, 'man'); // speed MAN
      v.set('ap.spd_is_mach', 0);
      v.set('ap.sel_spd_kt', 210);
      r.run(600, () => {
        speedbrakeStep(r);
        return v.get(FDM.ias) < 218;
      });
      v.set(V.flapLever, 1);
      log(r, 'flaps 10');
      r.run(900, () => {
        speedbrakeStep(r);
        return v.get('fms.dist_to_dest_nm') < 22;
      });
      v.set('ap.sel_spd_kt', 180);
      gp(r, 'apr');
      r.run(1);
      log(r, 'APR');
      expect(v.get('nav1.active_mhz')).toBeCloseTo(rw26r.ils!.freqMhz, 2); // auto-tuned (FMS source, ILS in the plan)
      expect(v.get('epic.s1.nav_src')).toBe(1); // NAV SRC switched to LOC1
      expect(v.getString('ap.lat_armed') + v.getString('ap.lat_active')).toContain('LOC');
      expect(v.getString('ap.vert_armed') + v.getString('ap.vert_active')).toContain('GS');
      let locT = NaN;
      let gsT = NaN;
      let maxLoc = 0;
      let maxGs = 0;
      let gearDn = false;
      let flaps39 = false;
      let maxFlapOverspeed = -Infinity;
      r.run(900, () => {
        speedbrakeStep(r);
        const lat = v.getString('ap.lat_active');
        const vfe = [340, G650_LIMITS.vfe10Kt, G650_LIMITS.vfe20Kt, G650_LIMITS.vfe39Kt][v.get(V.flapLever)];
        maxFlapOverspeed = Math.max(maxFlapOverspeed, v.get(FDM.ias) - vfe);
        if (isNaN(locT) && lat.startsWith('LOC')) {
          locT = r.t;
          v.set('ap.sel_spd_kt', 160);
        }
        if (!isNaN(locT) && v.get(V.flapLever) < 2 && v.get(FDM.ias) < G650_LIMITS.vfe20Kt - 10) v.set(V.flapLever, 2);
        if (!gearDn && !isNaN(locT) && v.get('nav1.gs_dev') < 0.6 && v.get(FDM.ias) < G650_LIMITS.vloKt - 10) {
          gearDn = true;
          v.set(V.gearHandle, 1);
        }
        if (isNaN(gsT) && v.getString('ap.vert_active') === 'GS') {
          gsT = r.t;
          v.set('ap.sel_alt_ft', 4000); // missed-approach altitude
        }
        // Before Landing: gear down, flaps 39 once below VFE 39, VREF + 5.
        if (!flaps39 && gearDn && !isNaN(gsT) && v.get(FDM.ias) < G650_LIMITS.vfe39Kt - 10) {
          flaps39 = true;
          v.set(V.flapLever, 3);
          v.set('ap.sel_spd_kt', vapp);
        }
        const ra = v.get('ra1.alt_ft');
        if (!isNaN(gsT) && ra > 250 && r.t > gsT + 20) {
          maxLoc = Math.max(maxLoc, Math.abs(v.get('nav1.cdi')));
          maxGs = Math.max(maxGs, Math.abs(v.get('nav1.gs_dev')));
        }
        return !isNaN(gsT) && ra < 1000 && ra > 0;
      });
      log(r, '1000 ft RA, stabilized');
      expect(isNaN(locT)).toBe(false);
      expect(isNaN(gsT)).toBe(false);
      expect(v.get('gear.down_locked')).toBe(1);
      expect(v.get('surf.flaps_deg')).toBeGreaterThan(38);
      expect(Math.abs(v.get(FDM.ias) - vapp)).toBeLessThan(8);
      expect(v.get(FDM.vs)).toBeLessThan(-450);
      expect(v.get(FDM.vs)).toBeGreaterThan(-1000);
      expect(maxLoc).toBeLessThan(0.5);
      expect(maxGs).toBeLessThan(0.5);
      expect(maxFlapOverspeed).toBeLessThan(0); // flaps / gear never above VFE / VLO
      expect(casActive(r, 'warning')).toEqual([]);
      expect(casActive(r)).toContain('Autobrake - Medium');

      // ================================================================ 12. AP off at 80 ft (LIM ILS minimum disengage height), hand flare
      r.run(120, () => v.get('ra1.alt_ft') < AP_MIN_DISENGAGE_ILS_FT);
      // Yoke AP / TRIM DISC (the 3D button writes its var and emits ap.disc, cockpit/flightControls.ts).
      r.events.emit('ap.disc');
      press(r, V.yokeDiscL, 0.2);
      r.run(0.2);
      expect(v.get('ap.engaged')).toBe(0);
      log(r, 'AP disconnected');
      let retardSeen = false;
      let tdVs = NaN;
      let tdIas = NaN;
      let tdDistFt = NaN;
      const thr = { lat: rw26r.lat, lon: rw26r.lon };
      const far2 = destinationPoint(rw26r.lat, rw26r.lon, rw26r.headingTrue, 2);
      const clAlong = () => alongTrackNm(thr.lat, thr.lon, far2.lat, far2.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      const clCross = () => crossTrackNm(thr.lat, thr.lon, far2.lat, far2.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      r.run(60, () => {
        const ra = v.get('ra1.alt_ft');
        if (v.getString('ap.at_mode') === 'RETARD') retardSeen = true;
        // FBW nz law: yoke = flight-path change demand. Hold the glide path, flare from 40 ft to ~150 fpm.
        const vsTgt = ra > 40 ? -720 : -Math.max(150, 720 * (ra / 40));
        v.set(INPUT.pitch, Math.max(-0.5, Math.min(0.8, 0.0015 * (vsTgt - v.get(FDM.vs)))));
        const bankCmd = Math.max(-5, Math.min(5, -0.05 * clCross() - 0.5 * wrap180(v.get(FDM.trackTrue) - rw26r.headingTrue)));
        v.set(INPUT.roll, Math.max(-1, Math.min(1, 0.08 * (bankCmd - v.get(FDM.bank)))));
        if (v.get('gear.air_ground') === 1) {
          tdVs = v.get(FDM.vs);
          tdIas = v.get(FDM.ias);
          tdDistFt = clAlong() / 0.3048;
          return true;
        }
      });
      log(r, 'touchdown');
      LOG.push(`touchdown ${tdVs.toFixed(0)} fpm, ${tdIas.toFixed(0)} KIAS (VAPP ${vapp}), ${tdDistFt.toFixed(0)} ft past the threshold, ${clCross().toFixed(1)} m off centre`);
      expect(retardSeen).toBe(true);
      expect(tdVs).toBeGreaterThan(-600);
      expect(tdIas).toBeGreaterThan(vapp - 20);
      expect(tdIas).toBeLessThan(vapp + 5);
      expect(tdDistFt).toBeGreaterThan(300);
      expect(tdDistFt).toBeLessThan(3000);
      expect(v.get('fdm.crashed')).toBe(0);

      // ================================================================ 13. rollout: ground spoilers, reversers, autobrake MED
      let maxGsp = 0;
      let maxRevN1 = 0;
      let abSeen = false;
      let stopDistFt = NaN;
      v.set(V.tla(1), 0);
      v.set(V.tla(2), 0);
      r.run(90, (t) => {
        maxGsp = Math.max(maxGsp, v.get('surf.ground_spoilers'));
        if (v.get('brakes.autobrake_active')) abSeen = true;
        v.set(INPUT.pitch, t < 3 ? -0.1 : 0);
        v.set(INPUT.roll, 0);
        const p = destinationPoint(thr.lat, thr.lon, rw26r.headingTrue, (clAlong() + 150) / 1852);
        const err = wrap180(bearingTo(r, p.lat, p.lon) - v.get(FDM.headingTrue));
        v.set(INPUT.yaw, Math.max(-0.2, Math.min(0.2, err / 10)));
        const ias = v.get(FDM.ias);
        // Integral reverse range of the thrust levers (-1 max .. 0): max reverse until 100 kt, idle reverse by
        // 60 KCAS (LIM), stowed by 40 kt.
        const rev = ias > 100 ? -1 : ias > 40 ? -0.05 : 0;
        v.set(V.tla(1), rev);
        v.set(V.tla(2), rev);
        if (rev < -0.5) maxRevN1 = Math.max(maxRevN1, v.get('eng1.n1_pct'));
        if (v.get(FDM.gs) < 25) {
          stopDistFt = clAlong() / 0.3048;
          return true;
        }
      });
      v.set(V.tla(1), 0);
      v.set(V.tla(2), 0);
      log(r, 'rollout 25 kt');
      LOG.push(`rollout: ground spoilers ${maxGsp.toFixed(2)}, max reverse N1 ${maxRevN1.toFixed(1)}, autobrake ${abSeen}, 25 kt at ${stopDistFt.toFixed(0)} ft past the threshold (runway ${rw26r.lengthFt} ft)`);
      expect(maxGsp).toBeGreaterThan(0.9);
      expect(maxRevN1).toBeGreaterThan(50);
      expect(maxRevN1).toBeLessThanOrEqual(G650_LIMITS.revMaxN1Pct + 0.5);
      expect(abSeen).toBe(true);
      // GAC G650 landing distance 3,000 ft class (from 50 ft, typical weight): the ground roll to 25 kt fits inside it.
      expect(stopDistFt).toBeLessThan(tdDistFt + 3200);
      expect(Math.abs(clCross())).toBeLessThan(10);
      r.run(3);
      expect(v.get('ap.at_engaged')).toBe(0);

      // ================================================================ 14. after landing, taxi clear, shutdown
      v.set(INPUT.yaw, 0);
      v.set(INPUT.brakeLeft, 0.3); // pedal braking disarms the autobrake
      v.set(INPUT.brakeRight, 0.3);
      r.run(1);
      v.set(V.autobrake, 0);
      v.set(V.flapLever, 0);
      v.set(V.gndSpoiler, 0);
      v.set(V.ltLdgL, 0);
      v.set(V.ltLdgR, 0);
      v.set(V.ltStrobe, 0);
      v.set(V.ltTaxi, 1);
      const exit = destinationPoint(thr.lat, thr.lon, rw26r.headingTrue, (clAlong() + 120) / 1852);
      const ramp2 = destinationPoint(exit.lat, exit.lon, rw26r.headingTrue + 90, 250 / 1852);
      const exitAlong = alongTrackNm(thr.lat, thr.lon, far2.lat, far2.lon, exit.lat, exit.lon) * 1852;
      r.run(300, () => {
        const tgt = clAlong() < exitAlong - 20 ? exit : ramp2;
        taxiStep(r, tgt.lat, tgt.lon, 12);
        return distanceNm(v.get(FDM.lat), v.get(FDM.lon), ramp2.lat, ramp2.lon) < 0.02;
      });
      stopOnGround(r);
      log(r, 'parked');
      expect(Math.abs(clCross())).toBeGreaterThan(150);
      v.set(V.parkBrake, 1);
      v.set(INPUT.brakeLeft, 0);
      v.set(INPUT.brakeRight, 0);
      v.set(V.ltTaxi, 0);
      r.run(180); // LUC: 3 min cool-down at idle
      v.set(V.fuelCtlL, 0);
      v.set(V.fuelCtlR, 0);
      r.run(60);
      log(r, 'engines stopped');
      expect(v.get('eng1.running') + v.get('eng2.running')).toBe(0);
      expect(casActive(r, 'warning')).toEqual([]);
      expect(casActive(r, 'caution')).toEqual([]); // normal shutdown on the batteries: no amber messages
      for (const k of [V.ltBeacon, V.ltNav, V.seatBelt, V.emerPwr, V.ltEmer, V.ebhaBatt, V.upsBatt, V.battL, V.battR]) v.set(k, 0);
      r.run(5);
      log(r, 'cold & dark');
      expect(v.get('elec.l_ess_dc_powered')).toBe(0);
      expect(v.get('elec.r_ess_dc_powered')).toBe(0);
      expect(v.get('elec.emer_dc_powered')).toBe(0);
      expect(v.get('display.epic.du1.power')).toBe(0);
      expect(v.get('fdm.crashed')).toBe(0);
    } finally {
      // eslint-disable-next-line no-console
      console.log(LOG.join('\n'));
    }
  });
});
