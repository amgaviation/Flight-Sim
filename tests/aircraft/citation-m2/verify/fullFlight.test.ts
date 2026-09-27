/**
 * Citation M2 check ride, headless: one continuous single-pilot flight from
 * cold & dark at Wichita Eisenhower (KICT, the aircraft's home factory) to
 * Oklahoma City Will Rogers (KOKC) and back to cold & dark, flown only
 * through the cockpit control vars, the GMC 710 keys, the G3000 flight-plan /
 * TOLD logic (the GTC pages' back end) and the pilot's yoke, pedals and toe
 * brakes.
 *
 *   KICT/19R  PER  FILUM (transition) -> ILS 17R KOKC, cruise FL230
 *
 * Phases (dossier §10, CJ-family single-pilot flow, EST): cockpit preparation
 * and SYSTEM TEST -> battery start of both engines (R then L; the M2 has no
 * APU) -> avionics, FMS route, W&F, TOLD -> taxi -> takeoff (TO/GA, TO
 * detent) -> AP on, FMS + FLC climb, VNAV armed -> cruise (CRU detent) ->
 * VNAV descent (VPTH) -> ILS 17R (LOC / GS) -> AP off at the 200 ft DA,
 * hand-flown flare -> rollout (ground flaps 60 deploy the speed brakes,
 * anti-skid brakes; the M2 has no reversers and no autobrake) -> taxi clear
 * -> shutdown.
 *
 * No autothrottle on 525-0800..1399 (TCDS): the crew flies the levers (a
 * simple speed loop below, holding the FADEC detents where the procedure
 * says so).
 */
import { describe, expect, it } from 'vitest';
import { NavDatabaseImpl } from '../../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../../src/nav/data/nodeLoader';
import { alongTrackNm, crossTrackNm, destinationPoint, distanceNm } from '../../../../src/core/geo';
import { FDM, INPUT } from '../../../../src/core/vars';
import { M2, TLA, TEST_SEL } from '../../../../src/aircraft/citation-m2/vars';
import { M2_LIMITS } from '../../../../src/aircraft/citation-m2/data';
import { ScriptedPilot } from '../../../../src/input/ScriptedPilot';
import { makeFlightRig, casActive, fma, press, gmc, bearingTo, wrap180, type FlightRig } from './flightRig';

const LOG: string[] = [];
function log(r: FlightRig, what: string): void {
  const v = r.vars;
  LOG.push(
    `[${(r.t / 60).toFixed(1).padStart(5)} min] ${what} | ${v.get(FDM.altMsl).toFixed(0)} ft ${v.get(FDM.ias).toFixed(0)} KIAS M${v.get(FDM.mach).toFixed(2)} VS ${v.get(FDM.vs).toFixed(0)} | N1 ${v.get('eng1.n1_pct').toFixed(1)}/${v.get('eng2.n1_pct').toFixed(1)} TLA ${v.get(M2.tla(1)).toFixed(2)} | ${fma(r)} | CAS ${casActive(r).join(',')}`,
  );
}

/** The single pilot's hand on the throttles (no autothrottle): PI speed loop between `lo` and `hi` lever. */
class ThrottleHand {
  private integ = 0;
  constructor(private readonly r: FlightRig) {}
  reset(lever: number): void {
    this.integ = lever;
  }
  step(targetKt: number, lo: number = TLA.idle, hi: number = TLA.clb): number {
    const v = this.r.vars;
    const err = targetKt - v.get('adc1.ias_kt');
    const trend = v.get('adc1.ias_rate_kts');
    this.integ = Math.max(lo, Math.min(hi, this.integ + (0.004 * err) / 60));
    const tla = Math.max(lo, Math.min(hi, this.integ + 0.03 * err - 0.08 * trend));
    v.set(M2.tla(1), tla);
    v.set(M2.tla(2), tla);
    return tla;
  }
}

/** Ground steering (rudder pedals, +/-20 deg nose wheel) + speed (levers, toe brakes). */
function taxiStep(r: FlightRig, tgtLat: number, tgtLon: number, gsKt: number): void {
  const v = r.vars;
  const err = wrap180(bearingTo(r, tgtLat, tgtLon) - v.get(FDM.headingTrue));
  v.set(INPUT.yaw, Math.max(-1, Math.min(1, err / 20)));
  const e = gsKt - v.get(FDM.gs);
  const lever = Math.max(0, Math.min(0.35, 0.08 + 0.03 * e));
  v.set(M2.tla(1), lever);
  v.set(M2.tla(2), lever);
  const brake = e < -2 ? Math.min(1, -0.1 * e) : 0;
  v.set(INPUT.brakeLeft, brake);
  v.set(INPUT.brakeRight, brake);
}

function stopOnGround(r: FlightRig): void {
  const v = r.vars;
  v.set(M2.tla(1), TLA.idle);
  v.set(M2.tla(2), TLA.idle);
  v.set(INPUT.yaw, 0);
  r.run(60, () => {
    v.set(INPUT.brakeLeft, 0.6);
    v.set(INPUT.brakeRight, 0.6);
    return v.get(FDM.gs) < 0.3;
  });
}

/** Speed brake technique in the descent: extend when > 15 kt fast with the levers at idle, retract near the target. */
function speedbrakeStep(r: FlightRig, targetKt: number): void {
  const v = r.vars;
  const fast = v.get('adc1.ias_kt') - targetKt;
  const sb = v.get(M2.speedbrake);
  if (fast > 15 && v.get(M2.tla(1)) < 0.05 && v.get(FDM.altAgl) > 1500) v.set(M2.speedbrake, 1);
  else if (sb > 0 && (fast < 3 || v.get(FDM.altAgl) < 1500)) v.set(M2.speedbrake, 0);
}

describe('Citation M2 check ride KICT -> KOKC (full normal procedure)', () => {
  it('flies cold & dark to cold & dark through the cockpit controls', { timeout: 900000 }, async () => {
    const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
    await db.load();
    const kict = db.airport('KICT')!;
    const kokc = db.airport('KOKC')!;
    await db.loadProcedures(kict.icao);
    await db.loadProcedures(kokc.icao);
    const rw19r = kict.runways.find((x) => x.ident === '19R')!;
    const rw17r = kokc.runways.find((x) => x.ident === '17R')!;
    expect(rw19r && rw17r && rw17r.ils).toBeTruthy();
    // Ramp spot: 180 m right of the 19R centre line, 300 m down the runway, facing the runway.
    const along = destinationPoint(rw19r.lat, rw19r.lon, rw19r.headingTrue, 300 / 1852);
    const far = destinationPoint(rw19r.lat, rw19r.lon, rw19r.headingTrue, 1.5);
    const ramp = destinationPoint(along.lat, along.lon, rw19r.headingTrue + 90, 180 / 1852);
    // Single pilot + 2 passengers and bags (450 lb), 2,400 lb fuel: ~9,630 lb ramp weight.
    const r = makeFlightRig({ db, origin: kict, dest: kokc, start: { lat: ramp.lat, lon: ramp.lon, headingTrue: rw19r.headingTrue - 90 }, fuelLb: 2400, payloadLb: 450 });
    const v = r.vars;
    const sys = r.sys;
    const g = sys.suite.system;
    const hand = new ThrottleHand(r);
    try {
      // ================================================================ 1. cold & dark
      r.run(1);
      expect(v.get('elec.batt_bus_powered')).toBe(0);
      expect(v.get('elec.emer_powered')).toBe(0);
      expect(v.get('eng1.running') + v.get('eng2.running')).toBe(0);
      expect(v.get('display.pfd1.power')).toBe(0);
      expect(v.get(M2.controlLock)).toBe(1);
      expect(v.get(M2.parkBrake)).toBe(1);
      expect(v.get(M2.tla(1))).toBe(TLA.cutoff);
      log(r, 'cold & dark');

      // ================================================================ 2. cockpit preparation (dossier §10 step 1)
      v.set(M2.controlLock, 0);
      v.set(M2.battSw, 1);
      r.run(2);
      expect(v.get('elec.batt_v')).toBeGreaterThan(24);
      expect(v.get('elec.emer_powered')).toBe(1);
      // SYSTEM TEST: FIRE WARN lights both ENG FIRE switches and the fire warning; ANNU lights every lamp.
      v.set(M2.testSel, TEST_SEL.fire);
      r.run(2);
      expect(v.get(M2.engFireLight(1))).toBe(1);
      expect(v.get(M2.engFireLight(2))).toBe(1);
      v.set(M2.testSel, TEST_SEL.annu);
      r.run(1);
      expect(v.get(M2.startLight(1))).toBe(1);
      expect(v.get(M2.bottleLight(2))).toBe(1);
      expect(v.get('gear.green0')).toBe(1);
      v.set(M2.testSel, TEST_SEL.off);
      r.run(1);
      expect(v.get(M2.engFireLight(1))).toBe(0);
      expect(v.get(M2.startLight(1))).toBe(0);
      expect(v.get('gear.green0')).toBe(1); // gear down and locked
      expect(v.get('gear.red0')).toBe(0);
      // Battery discharging with no generator (BATT DISCHARGE after 10 s would be normal before start).
      log(r, 'battery on, tests done');

      // ================================================================ 3. before start (dossier §10 step 2)
      v.set(M2.avionicsSw, 1);
      v.set(M2.genSw(1), 1);
      v.set(M2.genSw(2), 1);
      v.set(M2.antiColl, 1); // BEACON
      v.set(M2.navLt, 1);
      v.set(M2.paxSafety, 2);
      r.run(3);
      expect(v.get('elec.avn1_powered')).toBe(1);
      expect(v.get('elec.avn2_powered')).toBe(1);
      expect(v.get('display.pfd1.power')).toBe(1);

      // ================================================================ 4. engine starts on the battery, right first (dossier §10 step 3)
      for (const side of [2, 1] as const) {
        press(r, M2.startBtn(side));
        expect(v.get(M2.startLight(side))).toBe(1);
        expect(casActive(r, 'advisory')).toContain(`START ${side === 1 ? 'L' : 'R'}`);
        let peak = 0;
        let minBus = 99;
        const t0 = r.t;
        r.run(90, () => {
          peak = Math.max(peak, v.get(`eng${side}.itt_c`));
          minBus = Math.min(minBus, v.get('elec.batt_bus_v'));
          if (v.get(`eng${side}.n2_pct`) >= 9 && v.get(M2.tla(side)) < 0) v.set(M2.tla(side), TLA.idle); // IDLE at 8-10 % N2
          return v.get(`eng${side}.running`) === 1 && v.get(`fadec.eng${side}.start_state`) === 4 && r.t > t0 + 5;
        });
        expect(v.get(`eng${side}.running`)).toBe(1);
        expect(peak).toBeLessThan(M2_LIMITS.ittStartTransientC);
        expect(peak).toBeGreaterThan(500);
        expect(minBus).toBeGreaterThan(12); // start relay stays in (pull-in 15 V / drop-out 7 V)
        expect(r.t - t0).toBeLessThan(60);
        r.run(5);
        expect(v.get(`elec.sg${side}_online`)).toBe(1);
        expect(v.get(M2.startLight(side))).toBe(0);
        log(r, `engine ${side} started, peak ITT ${peak.toFixed(0)} C, min bus ${minBus.toFixed(1)} V`);
      }
      r.run(20);
      for (const i of [1, 2]) {
        expect(v.get(`eng${i}.n2_pct`)).toBeGreaterThan(50);
        expect(v.get(`eng${i}.oil_press_psi`)).toBeGreaterThan(M2_LIMITS.oilPressMinPsi);
      }
      expect(v.get('elec.l_main_v')).toBeGreaterThan(27.5);
      expect(casActive(r, 'warning')).toEqual([]);
      for (const c of ['GEN OFF L', 'GEN OFF R', 'BATT DISCHARGE', 'MAIN BUS VOLTS LOW', 'FUEL PRESS LOW L', 'FUEL PRESS LOW R', 'OIL PRESS LOW L']) expect(casActive(r)).not.toContain(c);

      // ================================================================ 5. avionics: G3000 up, AHRS aligned, FMS / W&F / TOLD
      r.run(90, () => v.get('ahrs1.valid') === 1 && v.get('ahrs2.valid') === 1 && v.get('adc1.valid') === 1 && v.get('gps.valid') === 1);
      expect(v.get('ahrs1.valid')).toBe(1);
      expect(v.get('gps.valid')).toBe(1);
      expect(v.get('display.mfd.power')).toBe(1);
      expect(v.get('g3k.pfd1.booting')).toBe(0);
      v.set('g3k.mfd.splash_ack', 1); // MFD database page: Continue
      const fpl = g.fpl!;
      expect(fpl.setOrigin('KICT', '19R')).toBe(true);
      expect(fpl.setDestination('KOKC')).toBe(true);
      const nearVor = (ident: string, lat: number, lon: number) => {
        const w = fpl.resolve(ident).filter((x) => x.kind === 'vor');
        w.sort((a, b) => distanceNm(a.lat, a.lon, lat, lon) - distanceNm(b.lat, b.lon, lat, lon));
        return w[0];
      };
      const per = nearVor('PER', kict.lat, kict.lon);
      expect(per, 'PER VOR').toBeTruthy();
      fpl.appendEnroute(per);
      fpl.setCruiseAltitude(23000);
      const procs = await fpl.loadProcedures('KOKC');
      const i17r = procs!.approaches.find((x) => x.ident === 'I17R')!;
      LOG.push('I17R transitions: ' + (i17r.transitions ?? []).map((t) => t.name).join(' '));
      expect(fpl.loadApproach('KOKC', 'I17R', 'FILUM', 'load')).toBe(true);
      r.run(1);
      // Arriving from PER the FILUM feeder is aligned with the final course: "straight-in", so the crew
      // removes the hold-in-lieu-of-procedure-turn (HF) at FILUM on the GTC (Waypoint Options > Remove).
      const hfIdx = sys.suite.fms.plans.active.legs.findIndex((l) => l.type === 'HF');
      if (hfIdx >= 0) {
        expect(fpl.deleteLeg(hfIdx)).toBe(true);
        // The editor drops the fix with its HF leg: put FILUM (the IAF) back in front of ROHAA as a TF.
        const legsNow = sys.suite.fms.plans.active.legs;
        const rohaa = legsNow.findIndex((l) => l.fix?.ident === 'ROHAA');
        const filum = fpl.resolve('FILUM')[0];
        if (rohaa > 0 && !legsNow.some((l) => l.fix?.ident === 'FILUM')) expect(fpl.insertWaypoint(rohaa, filum)).toBeTruthy();
      }
      r.run(1);
      if (v.getString('fms.next_wpt') !== 'PER') expect(fpl.activateLeg(1)).toBe(true);
      r.run(3);
      const legs = sys.suite.fms.plans.active.legs.map((l) => l.fix?.ident ?? l.type);
      LOG.push('plan: ' + sys.suite.fms.plans.active.legs.map((l) => `${l.fix?.ident ?? l.type}(${l.type} ${l.fix ? l.fix.lat.toFixed(2) + ',' + l.fix.lon.toFixed(2) : ''} ${l.geom.lengthNm.toFixed(1)})`).join(' '));
      LOG.push(`fms: next ${v.getString('fms.next_wpt')} dist ${v.get('fms.dist_to_dest_nm').toFixed(1)} crz ${v.get('fms.crz_alt_ft')} tod ${v.get('fms.tod_dist_nm')}`);
      expect(legs).toContain('PER');
      expect(legs).toContain('FILUM');
      expect(v.get('fms.lnav_valid')).toBe(1);
      const planNm = v.get('fms.dist_to_dest_nm');
      expect(planNm).toBeGreaterThan(120);
      expect(planNm).toBeLessThan(220);
      expect(v.get('nav1.active_mhz')).toBeCloseTo(rw17r.ils!.freqMhz, 2); // G3000 auto-tunes the loaded ILS
      // Weight & fuel (GTC): 2 passengers, 110 lb bags (pilot in the BOW).
      g.wf.pax = 2;
      g.wf.cargoLb = 110;
      r.run(1);
      const gross = g.wf.grossLb;
      const fdmW = v.get('fdm.mass_kg') / 0.45359237;
      LOG.push(`W&F gross ${gross.toFixed(0)} lb, FDM ${fdmW.toFixed(0)} lb`);
      expect(Math.abs(gross - fdmW)).toBeLessThan(300);
      expect(fdmW).toBeLessThan(M2_LIMITS.maxRampLb);
      // TOLD (PERF > Takeoff Data): Calculate, Send to PFD.
      const inp = g.told.inputs.takeoff;
      inp.airport = 'KICT';
      inp.runway = '19R';
      inp.runwayLengthFt = rw19r.lengthFt;
      inp.runwayElevFt = rw19r.elevationFt;
      inp.runwayHeadingMag = Math.round(rw19r.headingTrue - (kict.magVar ?? 0));
      inp.oatC = Math.round(v.get('adc1.sat_c'));
      inp.weightLb = Math.round(gross);
      inp.flaps = '15';
      const to = g.told.computeTakeoff()!;
      expect(to).toBeTruthy();
      g.vspeeds.applyTold(to.vspeeds);
      LOG.push(`TOLD ${JSON.stringify(to)}`);
      const vr = to.vspeeds.VR;
      const v2 = to.vspeeds.V2;
      expect(vr).toBeGreaterThanOrEqual(98);
      expect(vr).toBeLessThanOrEqual(105);
      expect(to.fieldLengthFt!).toBeLessThan(rw19r.lengthFt);
      expect(v.get('g3k.vspd.VR.kt')).toBe(vr);
      // Clearance: runway heading, climb 10,000 ft.
      v.set('ap.sel_alt_ft', 10000);
      v.set('ap.sel_hdg_deg', Math.round(rw19r.headingTrue - (kict.magVar ?? 0)));
      log(r, 'avionics set up');

      // ================================================================ 6. before taxi / taxi (dossier §10 steps 4-5)
      v.set(M2.flapHandle, 1);
      v.set(M2.taxiLt, 1);
      r.run(8);
      expect(v.get('surf.flaps_deg')).toBeCloseTo(15, 0);
      expect(v.get('trim.pitch_to_ok')).toBe(1);
      v.set(M2.parkBrake, 0);
      r.run(2);
      expect(casActive(r, 'advisory')).not.toContain('PARKING BRAKE');
      const rwAlong = () => alongTrackNm(rw19r.lat, rw19r.lon, far.lat, far.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      const rwCross = () => crossTrackNm(rw19r.lat, rw19r.lon, far.lat, far.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      let taxiMaxGs = 0;
      r.run(300, () => {
        const p = destinationPoint(rw19r.lat, rw19r.lon, rw19r.headingTrue, (rwAlong() + 60) / 1852);
        taxiStep(r, p.lat, p.lon, Math.abs(rwCross()) > 30 ? 12 : 6);
        taxiMaxGs = Math.max(taxiMaxGs, v.get(FDM.gs));
        return Math.abs(rwCross()) < 2 && Math.abs(wrap180(v.get(FDM.headingTrue) - rw19r.headingTrue)) < 2;
      });
      expect(taxiMaxGs).toBeLessThan(20);
      stopOnGround(r);
      const xt = Math.abs(rwCross());
      LOG.push(`lined up ${xt.toFixed(1)} m off the centre line, hdg ${v.get(FDM.headingTrue).toFixed(1)}`);
      expect(xt).toBeLessThan(15);
      expect(v.get('fdm.crashed')).toBe(0);
      // Unpressurised on the ground (outflow + safety valve open through the squat switch), LFE = destination (FMS).
      expect(Math.abs(v.get('press.diff_psi'))).toBeLessThan(0.08);
      expect(Math.abs(v.get('press.ldg_elev_ft') - kokc.elevationFt)).toBeLessThan(5);
      log(r, 'lined up 19R');

      // ================================================================ 7. before takeoff / takeoff (dossier §10 steps 6-7)
      v.set(M2.pitotStaticSw, 1);
      v.set(M2.landingLt, 2);
      v.set(M2.antiColl, 2);
      r.run(2);
      expect(casActive(r, 'warning')).toEqual([]);
      expect(casActive(r, 'caution')).toEqual([]);
      r.events.emit('ap.toga'); // TO/GA button on the LH throttle
      r.run(0.3);
      expect(v.getString('ap.lat_active')).toBe('TO');
      expect(v.getString('ap.vert_active')).toBe('TO');
      expect(v.get('ap.fd1_on')).toBe(1);
      log(r, 'TO/GA');
      v.set(INPUT.brakeLeft, 1);
      v.set(INPUT.brakeRight, 1);
      v.set(M2.tla(1), TLA.to);
      v.set(M2.tla(2), TLA.to);
      r.run(10, () => v.get('eng1.n1_pct') > 90 && v.get('eng2.n1_pct') > 90);
      expect(v.get('alert.takeoff_config')).toBe(0);
      v.set(INPUT.brakeLeft, 0);
      v.set(INPUT.brakeRight, 0);
      const brakeRelease = { lat: v.get(FDM.lat), lon: v.get(FDM.lon) };
      const pilot = new ScriptedPilot(v, r.events);
      pilot.startTakeoff({ vrKt: vr, courseTrueDeg: rw19r.headingTrue, lat: rw19r.lat, lon: rw19r.lon, pitchDeg: 10, gearUp: false });
      let liftoffFt = NaN;
      let n1To = 0;
      let gearUpAt = NaN;
      r.run(90, () => {
        pilot.update(1 / 60);
        if (isNaN(liftoffFt) && !isNaN(pilot.log.liftoffIasKt)) liftoffFt = distanceNm(brakeRelease.lat, brakeRelease.lon, v.get(FDM.lat), v.get(FDM.lon)) * 6076.1;
        n1To = Math.max(n1To, v.get('eng1.n1_pct'));
        const agl = v.get(FDM.altAgl);
        if (isNaN(gearUpAt) && agl > 50 && v.get(FDM.vs) > 300) {
          gearUpAt = agl;
          v.set(M2.gearHandle, 0); // positive rate, gear up
        }
        return agl > 450;
      });
      LOG.push(`takeoff: rotate ${pilot.log.rotateIasKt.toFixed(0)} liftoff ${pilot.log.liftoffIasKt.toFixed(0)} KIAS ${liftoffFt.toFixed(0)} ft from brake release, max dev ${pilot.log.maxGroundDeviationM.toFixed(1)} m, max N1 ${n1To.toFixed(1)}`);
      log(r, '450 ft AGL');
      expect(n1To).toBeGreaterThan(95);
      expect(n1To).toBeLessThanOrEqual(M2_LIMITS.n1RedlinePct);
      expect(v.get('eng1.itt_c')).toBeLessThan(M2_LIMITS.ittTakeoffC);
      expect(liftoffFt).toBeLessThan(to.fieldLengthFt! / 1.15);
      expect(pilot.log.liftoffIasKt).toBeLessThan(v2 + 10);
      expect(pilot.log.maxGroundDeviationM).toBeLessThan(5);
      expect(pilot.log.maxPitchDeg).toBeLessThan(13);

      // ================================================================ 8. after takeoff: AP on, FMS, FLC climb, VNAV (dossier §10 steps 7-8)
      pilot.stop();
      v.set(INPUT.pitch, 0);
      v.set(INPUT.roll, 0);
      v.set(INPUT.yaw, 0);
      gmc(r, 'ap');
      expect(v.get('ap.engaged')).toBe(1);
      expect(v.get('ap.yd_engaged')).toBe(1); // YD engages with the AP (GFC 700)
      r.run(5);
      expect(v.get('gear.up_locked')).toBe(1);
      log(r, 'AP on');
      expect(v.getString('ap.vert_active')).toBe('PIT');
      gmc(r, 'nav'); // LNAV (FMS) on the departure track
      r.run(40, () => v.getString('ap.lat_active') === 'FMS');
      expect(v.getString('ap.lat_active')).toBe('FMS');
      // Flaps UP at V2 + 10, CLB detent, FLC 200 KIAS then 220 (dossier §10: 220 KIAS / M0.60 cruise climb).
      r.run(60, () => v.get(FDM.ias) > v2 + 10);
      v.set(M2.flapHandle, 0);
      v.set(M2.tla(1), TLA.clb);
      v.set(M2.tla(2), TLA.clb);
      v.set(M2.taxiLt, 0);
      gmc(r, 'flc');
      v.set('ap.sel_spd_kt', 200);
      r.run(20);
      log(r, 'flaps up, FLC, CLB detent');
      expect(v.getString('ap.vert_active')).toMatch(/FLC/);
      expect(v.get('surf.flaps_deg')).toBeLessThan(1);
      expect(v.getString('fadec.eng1.detent')).toBe('CLB');
      // Cleared FL230: VNAV armed (the GFC 700 climbs in FLC; VNAV provides the descent path).
      v.set('ap.sel_alt_ft', 23000);
      v.set('ap.sel_spd_kt', 220);
      gmc(r, 'vnav');
      r.run(2);
      log(r, 'cleared FL230, VNAV');
      let maxBank = 0;
      let maxIas = 0;
      let machSwitched = false;
      const climbT0 = r.t;
      r.run(1500, () => {
        maxBank = Math.max(maxBank, Math.abs(v.get(FDM.bank)));
        maxIas = Math.max(maxIas, v.get(FDM.ias));
        if (!machSwitched && v.get('adc1.mach') >= 0.6) {
          gmc(r, 'spd'); // SPD knob: IAS -> Mach
          v.set('ap.sel_mach', 0.6);
          machSwitched = true;
        }
        if (v.get(FDM.altMsl) > 18000 && v.get('adc1.baro_std') === 0) r.events.emit('g3k.baro1.push'); // transition altitude: STD
        return Math.abs(v.get(FDM.altMsl) - 23000) < 50 && v.getString('ap.vert_active').startsWith('ALT') && r.t > climbT0 + 60;
      });
      log(r, 'level FL230');
      const climbMin = (r.t - climbT0) / 60;
      LOG.push(`climb to FL230 ${climbMin.toFixed(1)} min`);
      expect(Math.abs(v.get('adc1.alt_ft') - 23000)).toBeLessThan(150);
      expect(climbMin).toBeLessThan(12); // FPG: FL250 in 9 min from SL at MTOW
      expect(maxBank).toBeLessThan(28);
      expect(maxIas).toBeLessThan(M2_LIMITS.vmoKt);
      expect(Math.abs(v.get('fms.xtk_nm'))).toBeLessThan(1);
      expect(v.get('adc1.baro_std')).toBe(1);
      expect(casActive(r, 'warning')).toEqual([]);
      expect(casActive(r, 'caution')).toEqual([]);
      // Auto schedule (dossier §6.4, EST): cabin 0 ft at SL -> 8,000 ft at FL410, linear; max 8.5 psid.
      expect(Math.abs(v.get('press.cabin_alt_ft') - (23000 * 8000) / 41000)).toBeLessThan(700);
      expect(v.get('press.diff_psi')).toBeLessThan(M2_LIMITS.cabinDiffPsi + 0.1);

      // ================================================================ 9. cruise FL230, CRU detent (dossier §10 step 9)
      v.set(M2.tla(1), TLA.cru);
      v.set(M2.tla(2), TLA.cru);
      // Max cruise thrust at FL230 is close to Vmo: once near it the pilot trims the levers back to hold 255 KIAS.
      let handOn = false;
      hand.reset(TLA.cru);
      r.run(180, () => {
        handOn ||= v.get('adc1.ias_kt') > 255;
        if (handOn) hand.step(255, TLA.idle, TLA.cru);
      });
      log(r, 'cruise');
      expect(v.getString('ap.vert_active')).toBe('ALT');
      expect(v.getString('ap.lat_active')).toBe('FMS');
      expect(Math.abs(v.get('adc1.alt_ft') - 23000)).toBeLessThan(60);
      const crzTas = v.get('adc1.tas_kt');
      const ffCrz = v.get('eng1.ff_pph') + v.get('eng2.ff_pph');
      LOG.push(`cruise FL230 ${crzTas.toFixed(0)} KTAS M${v.get(FDM.mach).toFixed(3)} ${ffCrz.toFixed(0)} pph, cabin ${v.get('press.cabin_alt_ft').toFixed(0)} ft dP ${v.get('press.diff_psi').toFixed(2)}`);
      expect(crzTas).toBeGreaterThan(340); // FPG high speed cruise FL250: 377 KTAS / 1,122 pph
      expect(ffCrz).toBeGreaterThan(900);
      expect(ffCrz).toBeLessThan(1500);
      expect(v.get(FDM.ias)).toBeLessThan(M2_LIMITS.vmoKt);
      const fuel0 = v.get('fuel.total_kg');
      r.run(60, () => void (handOn && hand.step(255, TLA.idle, TLA.cru)));
      const burn = (fuel0 - v.get('fuel.total_kg')) / 0.45359237;
      expect(burn * 60).toBeGreaterThan(0.85 * ffCrz);
      expect(burn * 60).toBeLessThan(1.15 * ffCrz);

      // ================================================================ 10. descent: landing elevation, altimeters, VNAV path (dossier §10 step 10)
      v.set('ap.sel_alt_ft', 3000);
      if (!(sys.afcs.vertArmed & 16)) gmc(r, 'vnav');
      let pathSeen = false;
      let maxDesIas = 0;
      hand.reset(v.get(M2.tla(1)));
      r.run(1800, () => {
        const vert = v.getString('ap.vert_active');
        if (vert === 'VPTH' || vert === 'VPATH') pathSeen = true;
        const desTgt = v.get(FDM.altMsl) > 11000 ? 250 : 220;
        if (pathSeen || v.get(FDM.vs) < -500) {
          hand.step(desTgt, TLA.idle, TLA.cru);
          speedbrakeStep(r, desTgt);
        }
        maxDesIas = Math.max(maxDesIas, v.get(FDM.ias));
        if (v.get(FDM.altMsl) < 17500 && v.get('adc1.baro_std') === 1) r.events.emit('g3k.baro1.push');
        return pathSeen && v.get('fms.dist_to_dest_nm') < 30;
      });
      log(r, 'descending, 30 nm to go');
      expect(pathSeen).toBe(true);
      expect(maxDesIas).toBeLessThan(M2_LIMITS.vmoKt);
      expect(v.get('adc1.baro_std')).toBe(0);
      expect(v.get(M2.paxSafety)).toBe(2);

      // ================================================================ 11. ILS 17R (dossier §10 steps 11-12)
      const lin = g.told.inputs.landing;
      lin.airport = 'KOKC';
      lin.runway = '17R';
      lin.runwayLengthFt = rw17r.lengthFt;
      lin.runwayElevFt = rw17r.elevationFt;
      lin.runwayHeadingMag = Math.round(rw17r.headingTrue - (kokc.magVar ?? 0));
      lin.oatC = 15;
      lin.weightLb = Math.round(v.get('fdm.mass_kg') / 0.45359237);
      const ldg = g.told.computeLanding()!;
      g.vspeeds.applyTold(ldg.vspeeds);
      const vref = ldg.vspeeds.VREF;
      LOG.push(`landing TOLD ${JSON.stringify(ldg)}`);
      expect(vref).toBeGreaterThanOrEqual(95);
      expect(vref).toBeLessThanOrEqual(109);
      v.set('g3k.mins.mode', 1); // BARO minimums
      v.set('g3k.mins.ft', Math.round(rw17r.elevationFt + 200));
      let spd = 190;
      let sbUsed = false;
      r.run(900, () => {
        hand.step(spd, TLA.idle, TLA.clb);
        speedbrakeStep(r, spd);
        sbUsed ||= v.get('surf.speedbrake') > 0.5;
        if (v.get('adc1.ias_kt') < 198 && v.get(M2.flapHandle) === 0) v.set(M2.flapHandle, 1); // flaps 15 below 200 (VFE)
        return v.get('fms.dist_to_dest_nm') < 18;
      });
      log(r, '18 nm, flaps 15');
      expect(v.get('surf.flaps_deg')).toBeGreaterThan(14);
      gmc(r, 'apr');
      r.run(1);
      log(r, 'APR');
      expect(v.getString('ap.lat_armed') + v.getString('ap.lat_active')).toContain('LOC');
      expect(v.getString('ap.vert_armed')).toContain('GS');
      let locT = NaN;
      let gsT = NaN;
      let maxLoc = 0;
      let maxGs = 0;
      let gearDown = false;
      spd = 160;
      r.run(900, () => {
        hand.step(spd, TLA.idle, TLA.clb);
        const lat = v.getString('ap.lat_active');
        const vert = v.getString('ap.vert_active');
        if (isNaN(locT) && lat.startsWith('LOC')) locT = r.t;
        if (!gearDown && !isNaN(locT) && v.get('nav1.gs_dev') < 0.7 && v.get(FDM.ias) < M2_LIMITS.vloExtendKt) {
          gearDown = true;
          v.set(M2.gearHandle, 1); // gear down approaching the glideslope
        }
        if (isNaN(gsT) && vert === 'GS') {
          gsT = r.t;
          v.set(M2.flapHandle, 2); // flaps 35 at GS capture (below VFE 161)
          spd = vref + 5;
          v.set('ap.sel_alt_ft', 4000); // missed-approach altitude
        }
        const ra = v.get('ra1.alt_ft');
        if (!isNaN(gsT) && ra > 250 && r.t > gsT + 25) {
          maxLoc = Math.max(maxLoc, Math.abs(v.get('nav1.cdi')));
          maxGs = Math.max(maxGs, Math.abs(v.get('nav1.gs_dev')));
        }
        return !isNaN(gsT) && v.get('ra1.valid') === 1 && ra < 1000;
      });
      log(r, '1000 ft RA, stabilized');
      expect(isNaN(locT)).toBe(false);
      expect(isNaN(gsT)).toBe(false);
      expect(v.get('gear.down_locked')).toBe(1);
      expect(v.get('gear.green1')).toBe(1);
      expect(v.get('surf.flaps_deg')).toBeGreaterThan(34);
      expect(Math.abs(v.get(FDM.ias) - (vref + 5))).toBeLessThan(8);
      expect(v.get(FDM.vs)).toBeLessThan(-400);
      expect(v.get(FDM.vs)).toBeGreaterThan(-1000);
      expect(maxLoc).toBeLessThan(0.5);
      expect(maxGs).toBeLessThan(0.5);
      expect(casActive(r, 'warning')).toEqual([]);
      expect(v.get('gear.horn')).toBe(0);

      // ================================================================ 12. minimums: AP/TRIM DISC at 200 ft, hand-flown flare (dossier §10 step 12)
      // AP minimum use height on a GS approach: 160 ft above the runway (M2 study notes); the crew disconnects at the 200 ft DA.
      r.run(120, () => {
        hand.step(vref + 5, TLA.idle, TLA.clb);
        return v.get('ra1.alt_ft') < 200;
      });
      v.set(INPUT.apDisconnect, 1);
      r.run(0.2);
      v.set(INPUT.apDisconnect, 0);
      expect(v.get('ap.engaged')).toBe(0);
      // AFM limitation: autopilot and yaw damper disengaged for landing (M2 study notes): YD key on the GMC 710.
      if (v.get('ap.yd_engaged')) gmc(r, 'yd');
      expect(v.get('ap.yd_engaged')).toBe(0);
      log(r, 'AP / YD disconnected at DA');
      const thetaRef = v.get(FDM.pitch);
      let pInt = 0;
      let tdVs = NaN;
      let tdIas = NaN;
      let tdDistFt = NaN;
      const thr = { lat: rw17r.lat, lon: rw17r.lon };
      const far2 = destinationPoint(rw17r.lat, rw17r.lon, rw17r.headingTrue, 2);
      const clAlong = () => alongTrackNm(thr.lat, thr.lon, far2.lat, far2.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      const clCross = () => crossTrackNm(thr.lat, thr.lon, far2.lat, far2.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      r.run(60, () => {
        const ra = v.get('ra1.alt_ft');
        const vsTgt = ra > 40 ? -650 : -Math.max(120, 650 * (ra / 40) * 0.9);
        const thetaCmd = thetaRef + Math.max(-3, Math.min(6, 0.004 * (vsTgt - v.get(FDM.vs)) + (ra < 40 ? 2.5 * (1 - ra / 40) : 0)));
        const e = thetaCmd - v.get(FDM.pitch);
        pInt = Math.max(-0.5, Math.min(0.5, pInt + (e * 0.02) / 60));
        v.set(INPUT.pitch, Math.max(-1, Math.min(1, 0.12 * e + pInt - 0.05 * v.get(FDM.q))));
        const bankCmd = Math.max(-5, Math.min(5, -0.05 * clCross() - 0.5 * wrap180(v.get(FDM.trackTrue) - rw17r.headingTrue)));
        v.set(INPUT.roll, Math.max(-1, Math.min(1, 0.05 * (bankCmd - v.get(FDM.bank)))));
        if (ra > 50) hand.step(vref + 5, TLA.idle, TLA.clb);
        else {
          v.set(M2.tla(1), TLA.idle); // throttles IDLE at 50 ft
          v.set(M2.tla(2), TLA.idle);
        }
        if (v.get('gear.air_ground') === 1) {
          tdVs = v.get(FDM.vs);
          tdIas = v.get(FDM.ias);
          tdDistFt = clAlong() / 0.3048;
          return true;
        }
      });
      log(r, 'touchdown');
      LOG.push(`touchdown ${tdVs.toFixed(0)} fpm, ${tdIas.toFixed(0)} KIAS, ${tdDistFt.toFixed(0)} ft past the threshold, ${clCross().toFixed(1)} m off centre`);
      expect(tdVs).toBeGreaterThan(-600);
      expect(tdIas).toBeGreaterThan(vref - 15);
      expect(tdIas).toBeLessThan(vref + 8);
      expect(tdDistFt).toBeGreaterThan(400);
      expect(tdDistFt).toBeLessThan(3000);
      expect(v.get('fdm.crashed')).toBe(0);

      // ================================================================ 13. rollout: ground flaps -> speed brakes, anti-skid brakes
      v.set(M2.flapHandle, 3); // GND (60 deg): lift dump, speed brakes deploy automatically
      let maxSb = 0;
      let stopDistFt = NaN;
      let maxBrakePsi = 0;
      r.run(90, (t) => {
        maxSb = Math.max(maxSb, v.get('surf.speedbrake'));
        maxBrakePsi = Math.max(maxBrakePsi, v.get('brakes.psi_left'));
        v.set(INPUT.pitch, t < 3 ? -0.1 : 0);
        v.set(INPUT.roll, 0);
        const p = destinationPoint(thr.lat, thr.lon, rw17r.headingTrue, (clAlong() + 150) / 1852);
        const err = wrap180(bearingTo(r, p.lat, p.lon) - v.get(FDM.headingTrue));
        v.set(INPUT.yaw, Math.max(-1, Math.min(1, err / 10)));
        const b = t > 2 ? 0.6 : 0;
        v.set(INPUT.brakeLeft, b);
        v.set(INPUT.brakeRight, b);
        if (v.get(FDM.gs) < 25) {
          stopDistFt = clAlong() / 0.3048;
          return true;
        }
      });
      log(r, 'rollout 25 kt');
      LOG.push(`rollout: speed brakes ${maxSb.toFixed(2)}, flaps ${v.get('surf.flaps_deg').toFixed(0)} deg, 25 kt at ${stopDistFt.toFixed(0)} ft past the threshold (runway ${rw17r.lengthFt} ft; FPG landing distance ${ldg.fieldLengthFt} ft)`);
      expect(maxSb).toBeGreaterThan(0.9);
      expect(v.get('surf.flaps_deg')).toBeGreaterThan(45);
      expect(stopDistFt - tdDistFt).toBeLessThan(ldg.fieldLengthFt!); // ground roll inside the FPG distance from 50 ft
      expect(Math.abs(clCross())).toBeLessThan(10);

      // ================================================================ 14. after landing, taxi clear, shutdown (dossier §10 step 13)
      v.set(INPUT.yaw, 0);
      v.set(M2.flapHandle, 0);
      v.set(M2.pitotStaticSw, 0);
      v.set(M2.landingLt, 0);
      v.set(M2.taxiLt, 1);
      v.set(M2.antiColl, 1);
      r.run(3);
      expect(v.get('surf.speedbrake')).toBeLessThan(0.5); // speed brakes retract with the flaps out of GND
      const exit = destinationPoint(thr.lat, thr.lon, rw17r.headingTrue, (clAlong() + 150) / 1852);
      const ramp2 = destinationPoint(exit.lat, exit.lon, rw17r.headingTrue + 90, 250 / 1852);
      const exitAlong = alongTrackNm(thr.lat, thr.lon, far2.lat, far2.lon, exit.lat, exit.lon) * 1852;
      r.run(300, () => {
        const tgt = clAlong() < exitAlong - 5 ? exit : ramp2;
        taxiStep(r, tgt.lat, tgt.lon, 10);
        return distanceNm(v.get(FDM.lat), v.get(FDM.lon), ramp2.lat, ramp2.lon) < 0.02;
      });
      stopOnGround(r);
      log(r, 'parked');
      expect(Math.abs(clCross())).toBeGreaterThan(150); // clear of the runway
      expect(Math.abs(v.get('press.diff_psi'))).toBeLessThan(0.08); // cabin depressurised after landing
      v.set(M2.parkBrake, 1);
      v.set(INPUT.brakeLeft, 0);
      v.set(INPUT.brakeRight, 0);
      v.set(M2.taxiLt, 0);
      r.run(2);
      expect(casActive(r, 'advisory')).toContain('PARKING BRAKE');
      r.run(60); // engine cool-down at idle (EST 1 min)
      v.set(M2.avionicsSw, 0);
      v.set(M2.tla(1), TLA.cutoff);
      v.set(M2.tla(2), TLA.cutoff);
      r.run(45);
      log(r, 'engines stopped');
      expect(v.get('eng1.running') + v.get('eng2.running')).toBe(0);
      expect(casActive(r, 'warning')).toEqual([]); // OIL PRESS LOW inhibited on the ground
      expect(v.get('display.pfd1.power')).toBe(0);
      v.set(M2.antiColl, 0);
      v.set(M2.navLt, 0);
      v.set(M2.paxSafety, 0);
      v.set(M2.genSw(1), 0);
      v.set(M2.genSw(2), 0);
      v.set(M2.battSw, 0);
      v.set(M2.controlLock, 1);
      r.run(5);
      log(r, 'cold & dark');
      expect(v.get('elec.batt_bus_powered')).toBe(0);
      expect(v.get('elec.emer_powered')).toBe(0);
      expect(v.get('fdm.crashed')).toBe(0);
      const fuelUsed = 2400 - v.get('fuel.total_kg') / 0.45359237;
      LOG.push(`fuel used ${fuelUsed.toFixed(0)} lb, block time ${(r.t / 60).toFixed(0)} min`);
      expect(fuelUsed).toBeGreaterThan(400);
      expect(fuelUsed).toBeLessThan(1200);
    } finally {
      // eslint-disable-next-line no-console
      console.log(LOG.join('\n'));
    }
  });
});
