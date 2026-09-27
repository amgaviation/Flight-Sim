/**
 * Citation Longitude check ride, headless: one continuous flight from cold &
 * dark at Wichita (KICT) to Kansas City (KMCI) and back to cold & dark,
 * flown only through the cockpit controls, the GMC 710 keys, the G5000
 * flight-plan / TOLD logic (the GTC pages' back end) and the pilot's yoke,
 * pedals, tiller and toe brakes.
 *
 *   KICT/01R  ICT  EMP  CYPRE (transition) -> ILS 01L KMCI, cruise FL280
 *
 * Phases (OG Section 17 normal procedures): cockpit inspection / power-up ->
 * APU start -> engine starts (R then L) -> avionics, FMS route, W&F, TOLD ->
 * taxi -> takeoff (A/T TO, HOLD) -> AP on above 400 ft, FMS + FLC/VNAV climb
 * -> cruise -> VNAV descent (VPTH) -> ILS approach (LOC/GS) -> AP off at the
 * 160 ft minimum, hand-flown flare -> rollout (ground spoilers, reversers,
 * brakes; the Longitude has no autobrake) -> taxi clear -> shutdown.
 *
 * Every step asserts annunciations / CAS / FMA and physically sensible numbers.
 */
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NavDatabaseImpl } from '../../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../../src/nav/data/nodeLoader';
import { alongTrackNm, crossTrackNm, destinationPoint, distanceNm } from '../../../../src/core/geo';
import { FDM, INPUT } from '../../../../src/core/vars';
import { LON_VARS as V } from '../../../../src/aircraft/citation-longitude/vars';
import { LON_LIMITS } from '../../../../src/aircraft/citation-longitude/data';
import { TLA } from '../../../../src/aircraft/citation-longitude/systems/logic';
import { ScriptedPilot } from '../../../../src/input/ScriptedPilot';
import { makeFlightRig, casActive, fma, press, gmc, bearingTo, wrap180, type FlightRig } from './flightRig';

const LOG: string[] = [];
function log(r: FlightRig, what: string): void {
  const v = r.vars;
  LOG.push(
    `[${(r.t / 60).toFixed(1).padStart(5)} min] ${what} | ${v.get(FDM.altMsl).toFixed(0)} ft ${v.get(FDM.ias).toFixed(0)} KIAS M${v.get(FDM.mach).toFixed(2)} VS ${v.get(FDM.vs).toFixed(0)} | N1 ${v.get('eng1.n1_pct').toFixed(1)}/${v.get('eng2.n1_pct').toFixed(1)} | ${fma(r)} | CAS ${casActive(r)
      .filter((t) => t)
      .join(',')}`,
  );
}

/** Simple ground steering + speed controller (pilot on tiller, toe brakes and levers). */
function taxiStep(r: FlightRig, tgtLat: number, tgtLon: number, gsKt: number): void {
  const v = r.vars;
  const brg = bearingTo(r, tgtLat, tgtLon);
  const err = wrap180(brg - v.get(FDM.headingTrue));
  v.set(INPUT.tiller, Math.max(-1, Math.min(1, err / 25)));
  const gs = v.get(FDM.gs);
  const e = gsKt - gs;
  const lever = Math.max(0, Math.min(0.3, 0.05 + 0.03 * e));
  v.set(V.tla(1), lever);
  v.set(V.tla(2), lever);
  const brake = e < -2 ? Math.min(1, -0.1 * e) : 0;
  v.set(INPUT.brakeLeft, brake);
  v.set(INPUT.brakeRight, brake);
}

/** Crew speedbrake technique on the approach: extend when > 15 kt fast in a descent, retract near the target. */
function speedbrakeStep(r: FlightRig): void {
  const v = r.vars;
  const fast = v.get(FDM.ias) - v.get('ap.sel_spd_kt');
  const sb = v.get(V.speedbrake);
  if (fast > 15 && v.get(FDM.vs) < -300 && v.get(FDM.altAgl) > 1000) v.set(V.speedbrake, 0.6);
  else if (sb > 0 && (fast < 5 || v.get(FDM.altAgl) < 1000)) v.set(V.speedbrake, 0);
}

function stopOnGround(r: FlightRig): void {
  const v = r.vars;
  v.set(V.tla(1), 0);
  v.set(V.tla(2), 0);
  v.set(INPUT.tiller, 0);
  r.run(40, () => {
    v.set(INPUT.brakeLeft, 0.6);
    v.set(INPUT.brakeRight, 0.6);
    return v.get(FDM.gs) < 0.3;
  });
}

describe('Citation Longitude check ride KICT -> KMCI (full normal procedure)', () => {
  it('flies cold & dark to cold & dark through the cockpit controls', { timeout: 900000 }, async () => {
    const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
    await db.load();
    const kict = db.airport('KICT')!;
    const kmci = db.airport('KMCI')!;
    await db.loadProcedures(kict.icao);
    await db.loadProcedures(kmci.icao);
    const rw01r = kict.runways.find((x) => x.ident === '01R')!;
    const rw01l = kmci.runways.find((x) => x.ident === '01L')!;
    expect(rw01r && rw01l).toBeTruthy();
    // Ramp spot: 200 m right of the 01R centre line, 250 m up the runway, facing the runway (west-ish).
    const along = destinationPoint(rw01r.lat, rw01r.lon, rw01r.headingTrue, 250 / 1852);
    const far = destinationPoint(rw01r.lat, rw01r.lon, rw01r.headingTrue, 1.5);
    const ramp = destinationPoint(along.lat, along.lon, rw01r.headingTrue + 90, 200 / 1852);
    // 2 crew + 4 passengers + bags (1,000 lb payload), 7,000 lb fuel -> ~31,600 lb ramp weight.
    const r = makeFlightRig({ db, origin: kict, dest: kmci, start: { lat: ramp.lat, lon: ramp.lon, headingTrue: rw01r.headingTrue - 90 }, fuelLb: 7000, payloadLb: 1000 });
    const v = r.vars;
    const sys = r.sys;
    const suite = sys.suite!;
    const g = suite.system;
    try {
      // ================================================================ 1. cold & dark
      r.run(1);
      expect(v.get('elec.emer_l_powered')).toBe(0);
      expect(v.get('eng1.running') + v.get('eng2.running')).toBe(0);
      expect(v.get('alert.master_warning')).toBe(0);
      expect(Math.abs(v.get('press.diff_psi'))).toBeLessThan(0.05); // unpressurized on the ramp
      expect(Math.abs(v.get('press.cabin_rate_fpm'))).toBeLessThan(200);
      log(r, 'cold & dark');

      // ================================================================ 2. cockpit inspection (OG 17-2)
      // CONTROL LOCK (pedestal aft left): engaged while parked; released first (checklists.ts Cockpit Inspection, EST).
      expect(v.get(V.controlLock)).toBe(1);
      v.set(V.controlLock, 0);
      v.set(V.stbyPwr, 2); // TEST
      r.run(11);
      expect(v.get(V.stbyBattLed)).toBe(2); // green: standby battery test OK
      v.set(V.stbyPwr, 1);
      v.set(V.ltEmer, 1); // ARM
      expect(v.get(V.gearHandle)).toBe(1);
      v.set(V.battL, 1);
      v.set(V.battR, 1);
      r.run(5);
      expect(v.get('elec.emer_l_v')).toBeGreaterThan(24.5);
      expect(v.get('elec.emer_r_v')).toBeGreaterThan(24.5);
      expect(v.get('elec.mission_l_powered')).toBe(1);
      log(r, 'batteries on');
      // Park brake set (before start); beacon NORM (GTC exterior lights) already.
      v.set(V.parkBrake, 1);

      // ================================================================ 3. APU start (OG 8-2 / 17-11)
      v.set(V.apuKnob, 1);
      r.run(12);
      v.set(V.apuKnob, 2);
      r.run(0.5);
      v.set(V.apuKnob, 1);
      let apuT = NaN;
      let minBus = 99;
      r.run(90, (t) => {
        minBus = Math.min(minBus, v.get('elec.emer_l_v'));
        if (isNaN(apuT) && v.get('apu.avail')) apuT = t;
        return v.get('apu.avail') === 1 && t > apuT + 5;
      });
      expect(apuT).toBeLessThan(60);
      expect(minBus).toBeGreaterThan(16);
      expect(v.get('elec.apu_gen_online')).toBe(1);
      expect(v.get('elec.emer_l_v')).toBeGreaterThan(27.5);
      log(r, 'APU on line');
      r.run(90); // APU bleed available 90 s after start (OG 8-2)
      expect(v.get(V.apuBleedReady)).toBe(1);
      expect(v.get(V.startPsi)).toBeGreaterThanOrEqual(LON_LIMITS.minStartPsi);

      // ================================================================ 4. engine starts, right first (OG 17-4)
      for (const side of [2, 1] as const) {
        v.set(side === 1 ? V.runL : V.runR, 1);
        r.run(1);
        press(r, side === 1 ? V.startL : V.startR);
        let peak = 0;
        const t0 = r.t;
        r.run(60, () => {
          peak = Math.max(peak, v.get(`eng${side}.itt_c`));
          return v.get(`eng${side}.running`) === 1 && r.t > t0 + 5;
        });
        expect(v.get(`eng${side}.running`)).toBe(1);
        expect(peak).toBeLessThan(LON_LIMITS.ittStartC);
        expect(r.t - t0).toBeLessThan(35);
        log(r, `engine ${side} started, peak ITT ${peak.toFixed(0)}`);
      }
      r.run(30);
      expect(v.get('elec.gen_l_online')).toBe(1);
      expect(v.get('elec.gen_r_online')).toBe(1);
      expect(v.get('hyd.a_psi')).toBeGreaterThan(2800);
      expect(v.get('hyd.b_psi')).toBeGreaterThan(2800);
      // APU OFF after the start (quiet ramp; OG 17-6 allows it to run until FL350).
      v.set(V.apuKnob, 0);
      r.run(5);

      // ================================================================ 5. avionics: G5000 up, AHRS aligned, FMS / W&F / TOLD
      r.run(60, () => v.get('ahrs1.valid') === 1 && v.get('ahrs2.valid') === 1 && v.get('adc1.valid') === 1);
      expect(v.get('display.pfd1.power')).toBe(1);
      expect(v.get('display.mfd.power')).toBe(1);
      expect(v.get('ahrs1.valid')).toBe(1);
      expect(v.get('gps.valid')).toBe(1);
      const fpl = g.fpl!;
      expect(fpl.setOrigin('KICT', '01R')).toBe(true);
      expect(fpl.setDestination('KMCI')).toBe(true);
      const near = (ident: string, lat: number, lon: number) => {
        const w = fpl.resolve(ident).filter((x) => x.kind === 'vor');
        w.sort((a, b) => distanceNm(a.lat, a.lon, lat, lon) - distanceNm(b.lat, b.lon, lat, lon));
        return w[0];
      };
      for (const id of ['ICT', 'EMP']) {
        const w = near(id, kict.lat, kict.lon);
        expect(w, id).toBeTruthy();
        fpl.appendEnroute(w);
      }
      fpl.setCruiseAltitude(28000);
      const procs = await fpl.loadProcedures('KMCI');
      const i01l = procs!.approaches.find((x) => x.ident === 'I01L')!;
      LOG.push('I01L transitions: ' + (i01l.transitions ?? []).map((t) => t.name).join(' '));
      expect(fpl.loadApproach('KMCI', 'I01L', 'CYPRE', 'load')).toBe(true);
      r.run(1);
      // GTC Flight Plan > ICT > "Activate Leg": the editor leaves the originally active destination leg active
      // after enroute waypoints are inserted before it (see the doc's open issues), so the crew activates ICT.
      if (v.getString('fms.next_wpt') !== 'ICT') expect(fpl.activateLeg(1)).toBe(true);
      r.run(3);
      LOG.push(`fms: active ${v.get('fms.active_leg')} next ${v.getString('fms.next_wpt')} dist ${v.get('fms.dist_to_dest_nm').toFixed(1)} crz ${v.get('fms.crz_alt_ft')} tod ${v.get('fms.tod_dist_nm')}`);
      const legs = suite.fms.plans.active.legs.map((l) => l.fix?.ident ?? l.type);
      LOG.push('plan: ' + legs.join(' '));
      expect(legs).toContain('EMP');
      expect(v.get('fms.lnav_valid')).toBe(1);
      const planNm = v.get('fms.dist_to_dest_nm');
      expect(planNm).toBeGreaterThan(150);
      expect(planNm).toBeLessThan(300);
      // Weight & fuel: 4 passengers, 200 lb bags (crew in the BOW).
      g.wf.pax = 4;
      g.wf.cargoLb = 200;
      r.run(1);
      const gross = g.wf.grossLb;
      const fdmW = v.get('fdm.mass_kg') / 0.45359237;
      LOG.push(`W&F gross ${gross.toFixed(0)} lb, FDM ${fdmW.toFixed(0)} lb`);
      expect(Math.abs(gross - fdmW)).toBeLessThan(400);
      // TOLD (PERF > Takeoff Data): auto-filled from the plan runway and sensors, Calculate, Send to PFD.
      const inp = g.told.inputs.takeoff;
      inp.airport = 'KICT';
      inp.runway = '01R';
      inp.runwayLengthFt = rw01r.lengthFt;
      inp.runwayElevFt = rw01r.elevationFt;
      inp.runwayHeadingMag = Math.round(rw01r.headingTrue - (kict.magVar ?? 0));
      inp.oatC = Math.round(v.get('adc1.sat_c'));
      inp.weightLb = Math.round(gross);
      inp.flaps = '2';
      const to = g.told.computeTakeoff()!;
      expect(to).toBeTruthy();
      g.vspeeds.applyTold(to.vspeeds);
      v.set('g3k.n1_target', to.n1Pct!); // Send to PFD also sets the N1 reference bug
      LOG.push(`TOLD ${JSON.stringify(to)}`);
      const vr = to.vspeeds.VR;
      const v2 = to.vspeeds.V2;
      expect(to.fieldLengthFt!).toBeLessThan(rw01r.lengthFt);
      // Altitude preselect 10,000 ft (departure clearance), FDs on, heading bug on the runway.
      v.set('ap.sel_alt_ft', 10000);
      v.set('ap.sel_hdg_deg', Math.round(rw01r.headingTrue - (kict.magVar ?? 0)));
      log(r, 'avionics set up');

      // ================================================================ 6. before taxi / taxi (OG 17-5, 17-6)
      v.set(V.flapLever, 2);
      v.set(V.ltTaxi, 1);
      v.set(V.ltAntiColl, 1);
      v.set(V.ltSeatBelts, 1); // overhead SEAT BELTS switchlight
      r.run(15);
      expect(v.get('surf.flaps_deg')).toBeCloseTo(15, 0);
      v.set(V.parkBrake, 0);
      r.run(2);
      // Taxi onto the runway: pure pursuit of the 01R centre line, 60 m look-ahead.
      const rwAlong = () => alongTrackNm(rw01r.lat, rw01r.lon, far.lat, far.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      const rwCross = () => crossTrackNm(rw01r.lat, rw01r.lon, far.lat, far.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      let taxiMaxGs = 0;
      r.run(240, () => {
        const p = destinationPoint(rw01r.lat, rw01r.lon, rw01r.headingTrue, (rwAlong() + 60) / 1852);
        taxiStep(r, p.lat, p.lon, Math.abs(rwCross()) > 30 ? 12 : 8);
        taxiMaxGs = Math.max(taxiMaxGs, v.get(FDM.gs));
        return Math.abs(rwCross()) < 2 && Math.abs(wrap180(v.get(FDM.headingTrue) - rw01r.headingTrue)) < 2;
      });
      expect(taxiMaxGs).toBeLessThan(20);
      stopOnGround(r);
      v.set(INPUT.tiller, 0);
      const xt = Math.abs(rwCross());
      LOG.push(`lined up ${xt.toFixed(1)} m off the centre line, hdg ${v.get(FDM.headingTrue).toFixed(1)}`);
      expect(xt).toBeLessThan(15);
      expect(v.get('fdm.crashed')).toBe(0);
      log(r, 'lined up 01R');

      // ================================================================ 7. before takeoff / takeoff (OG 17-7, 17-8)
      v.set(V.ltLdgL, 1);
      v.set(V.ltLdgR, 1);
      v.set(V.ltTaxi, 0);
      expect(casActive(r, 'warning')).toEqual([]);
      expect(casActive(r)).not.toContain('NO TAKEOFF');
      r.events.emit('g3k.gmc.spd_push'); // SPD knob FMS (OG 17-7)
      r.run(0.2);
      expect(v.get('g3k.spd_fms')).toBe(1);
      r.events.emit('at.engage');
      r.run(0.5);
      r.events.emit('ap.toga');
      r.run(0.5);
      gmc(r, 'nav'); // FMS armed for after takeoff
      expect(v.getString('ap.lat_armed')).toBe('FMS');
      expect(v.getString('ap.lat_active')).toBe('TO');
      expect(v.getString('ap.vert_active')).toBe('TO');
      expect(v.get('ap.at_engaged')).toBe(1);
      log(r, 'TOGA');
      // Brakes on until the A/T sets takeoff thrust, then release.
      v.set(INPUT.brakeLeft, 1);
      v.set(INPUT.brakeRight, 1);
      r.run(10, () => v.get('eng1.n1_pct') > 85 && v.get('eng2.n1_pct') > 85);
      v.set(INPUT.brakeLeft, 0);
      v.set(INPUT.brakeRight, 0);
      const brakeRelease = { lat: v.get(FDM.lat), lon: v.get(FDM.lon) };
      let liftoffFt = NaN;
      const pilot = new ScriptedPilot(v, r.events);
      const pilotTick = () => pilot.update(1 / 60);
      pilot.startTakeoff({ vrKt: vr, courseTrueDeg: rw01r.headingTrue, lat: rw01r.lat, lon: rw01r.lon, pitchDeg: 10, gearUp: false });
      let holdSeen = false;
      let n1To = 0;
      let gearUpAt = NaN;
      r.run(90, () => {
        pilotTick();
        if (isNaN(liftoffFt) && !isNaN(pilot.log.liftoffIasKt)) liftoffFt = distanceNm(brakeRelease.lat, brakeRelease.lon, v.get(FDM.lat), v.get(FDM.lon)) * 6076.1;
        if (v.getString('ap.at_mode') === 'HOLD') holdSeen = true;
        n1To = Math.max(n1To, v.get('eng1.n1_pct'));
        const agl = v.get(FDM.altAgl);
        if (isNaN(gearUpAt) && agl > 50 && v.get(FDM.vs) > 300) {
          gearUpAt = agl;
          v.set(V.gearHandle, 0);
        }
        return agl > 450;
      });
      LOG.push(`takeoff: rotate ${pilot.log.rotateIasKt.toFixed(0)} liftoff ${pilot.log.liftoffIasKt.toFixed(0)} KIAS ${liftoffFt.toFixed(0)} ft from brake release, max dev ${pilot.log.maxGroundDeviationM.toFixed(1)} m`);
      log(r, '450 ft AGL');
      expect(holdSeen).toBe(true);
      expect(n1To).toBeGreaterThan(90);
      expect(n1To).toBeLessThanOrEqual(LON_LIMITS.n1TakeoffPct + 0.1);
      expect(Math.abs(n1To - to.n1Pct!)).toBeLessThan(1); // the A/T sets the TOLD takeoff N1
      // All-engine liftoff well inside the factored TOLD field length; liftoff before V2 + 8 (FPG p.4).
      expect(liftoffFt).toBeLessThan(0.85 * to.fieldLengthFt!);
      expect(pilot.log.liftoffIasKt).toBeLessThan(v2 + 8);
      expect(pilot.log.maxGroundDeviationM).toBeLessThan(5);
      expect(v.get(FDM.altAgl)).toBeGreaterThan(400);

      // ================================================================ 8. after takeoff: AP on, FMS, climb
      pilot.stop();
      v.set(INPUT.pitch, 0);
      v.set(INPUT.roll, 0);
      v.set(INPUT.yaw, 0);
      gmc(r, 'ap');
      expect(v.get('ap.engaged')).toBe(1);
      r.run(5);
      expect(v.get('gear.up_locked') || v.get('gear.down_locked') === 0 ? 1 : 0).toBe(1);
      log(r, 'AP on');
      // GFC: the AP cannot fly TO; it engages into PIT with the FD's lateral mode (FMS captured or ROL + FMS armed).
      expect(v.getString('ap.vert_active')).toBe('PIT');
      r.run(30, () => v.getString('ap.lat_active') === 'FMS');
      expect(v.getString('ap.lat_active')).toBe('FMS');
      // Accelerate: flaps UP at V2+20 (OG 17-9), FLC climb at the FMS climb speed.
      r.run(60, () => v.get(FDM.ias) > v2 + 20);
      v.set(V.flapLever, 0);
      gmc(r, 'flc');
      v.set(V.ltTaxi, 0);
      r.run(20);
      log(r, 'flaps up, FLC');
      expect(v.getString('ap.vert_active')).toMatch(/FLC/);
      expect(v.getString('ap.at_mode')).toBe('CLIMB');
      // Cleared to FL280: VNAV (the G5000 climbs in VFLC to the FMS cruise altitude).
      v.set('ap.sel_alt_ft', 28000);
      gmc(r, 'vnav');
      r.run(5);
      log(r, 'VNAV climb');
      let maxBank = 0;
      let maxIas = 0;
      let maxIasBelow10k = 0;
      r.run(1500, () => {
        maxBank = Math.max(maxBank, Math.abs(v.get(FDM.bank)));
        maxIas = Math.max(maxIas, v.get(FDM.ias));
        if (v.get(FDM.altMsl) < 9800) maxIasBelow10k = Math.max(maxIasBelow10k, v.get(FDM.ias));
        if (v.get(FDM.altMsl) > 18000 && v.get('adc1.baro_std') === 0) {
          r.events.emit('g3k.baro1.push'); // baro sync ON: both sides follow
        }
        return Math.abs(v.get(FDM.altMsl) - 28000) < 50 && v.getString('ap.vert_active').startsWith('ALT');
      });
      log(r, 'level FL280');
      expect(Math.abs(v.get('adc1.alt_ft') - 28000)).toBeLessThan(150);
      expect(maxBank).toBeLessThan(30);
      expect(maxIas).toBeLessThan(LON_LIMITS.vmoKt);
      expect(maxIasBelow10k).toBeLessThan(256); // 14 CFR 91.117: the FMS climb speed is capped at 250 KIAS
      expect(Math.abs(v.get('fms.xtk_nm'))).toBeLessThan(1);
      expect(v.get('adc1.baro_std')).toBe(1);
      // Climb checks: pressurization scheduled, no cautions.
      expect(casActive(r, 'warning')).toEqual([]);
      expect(casActive(r, 'caution')).toEqual([]);

      // ================================================================ 9. cruise FL280 (OG 17-10)
      r.run(120);
      log(r, 'cruise');
      expect(v.getString('ap.vert_active')).toBe('ALT');
      expect(v.getString('ap.lat_active')).toBe('FMS');
      expect(Math.abs(v.get('adc1.alt_ft') - 28000)).toBeLessThan(60); // RVSM: +/- 200 ft
      const crzMach = v.get(FDM.mach);
      expect(crzMach).toBeGreaterThan(0.7);
      expect(crzMach).toBeLessThan(LON_LIMITS.mmo);
      const ffCrz = v.get('eng1.ff_pph') + v.get('eng2.ff_pph');
      LOG.push(`cruise FL280 M${crzMach.toFixed(3)} ${v.get(FDM.tas).toFixed(0)} KTAS ${ffCrz.toFixed(0)} pph, cabin ${v.get('press.cabin_alt_ft').toFixed(0)} ft dP ${v.get('press.diff_psi').toFixed(2)}`);
      expect(ffCrz).toBeGreaterThan(1500); // EST sanity: FPG FL310 M0.80 2,363 pph at 34,000 lb; FL280 a bit higher
      expect(ffCrz).toBeLessThan(3200);
      expect(v.get('press.cabin_alt_ft')).toBeLessThan(3000); // 9.66 psid: cabin ~SL..2,000 ft at FL280 (FPG p.2)
      const fuel0 = v.get('fuel.total_kg');
      r.run(60);
      const burn = (fuel0 - v.get('fuel.total_kg')) / 0.45359237;
      expect(burn * 60).toBeGreaterThan(0.9 * ffCrz); // the tanks decrement at the engine flow
      expect(burn * 60).toBeLessThan(1.1 * ffCrz);

      // ================================================================ 10. descent: preselect, VNAV PATH (OG 17-11)
      v.set('ap.sel_alt_ft', 3000);
      if (!(sys.afcs.vertArmed & 16)) gmc(r, 'vnav');
      let pathSeen = false;
      let maxDesIas = 0;
      let decelTgt = NaN;
      r.run(1800, () => {
        const vert = v.getString('ap.vert_active');
        if (vert === 'PATH') pathSeen = true;
        maxDesIas = Math.max(maxDesIas, v.get(FDM.ias));
        if (v.get(FDM.altMsl) < 17500 && v.get('adc1.baro_std') === 1) {
          r.events.emit('g3k.baro1.push'); // baro sync ON: both sides follow
        }
        return pathSeen && v.get('fms.dist_to_dest_nm') < 40;
      });
      log(r, 'descending, 40 nm to go');
      expect(pathSeen).toBe(true);
      expect(maxDesIas).toBeLessThan(LON_LIMITS.vmoKt);
      expect(v.get('adc1.baro_std')).toBe(0);

      // ================================================================ 11. approach ILS 01L (OG 17-12, 17-13)
      // Landing TOLD, minimums 200 ft DA (baro), MAN speed.
      const lin = g.told.inputs.landing;
      lin.airport = 'KMCI';
      lin.runway = '01L';
      lin.runwayLengthFt = rw01l.lengthFt;
      lin.runwayElevFt = rw01l.elevationFt;
      lin.runwayHeadingMag = Math.round(rw01l.headingTrue - (kmci.magVar ?? 0));
      lin.weightLb = Math.round(v.get('fdm.mass_kg') / 0.45359237);
      const ldg = g.told.computeLanding()!;
      g.vspeeds.applyTold(ldg.vspeeds);
      const vapp = ldg.vspeeds.VAPP;
      LOG.push(`landing TOLD ${JSON.stringify(ldg)}`);
      // ~35 nm out: MAN speed 210 kt, flaps 1 below 220 kt (VFE 250), landing lights; APR near CYPRE.
      r.run(900, () => {
        // FMS deceleration segment: the 250 KIAS limit already applies 3,000 ft above 10,000 ft (createSystems).
        if (isNaN(decelTgt) && v.get(FDM.altMsl) < 12800) decelTgt = v.get('fms.vnav_tgt_speed_kt');
        return v.get('fms.dist_to_dest_nm') < 35;
      });
      log(r, '35 nm');
      LOG.push(`FMS target speed at 12,800 ft: ${decelTgt}`);
      expect(decelTgt).toBeLessThanOrEqual(250);
      r.events.emit('g3k.gmc.spd_push'); // MAN speed
      r.run(0.2);
      expect(v.get('g3k.spd_fms')).toBe(0);
      v.set('ap.sel_spd_kt', 210);
      v.set(V.ltLdgL, 1);
      v.set(V.ltLdgR, 1);
      let sbUsed = false;
      r.run(600, () => {
        speedbrakeStep(r);
        sbUsed ||= v.get('surf.speedbrake') > 0.3;
        return v.get(FDM.ias) < 220;
      });
      v.set(V.flapLever, 1);
      log(r, 'flaps 1');
      expect(v.get('nav1.active_mhz')).toBeCloseTo(rw01l.ils!.freqMhz, 2); // auto-tuned by the approach load
      r.run(900, () => {
        speedbrakeStep(r);
        return v.get('fms.dist_to_dest_nm') < 20;
      });
      v.set('ap.sel_spd_kt', 180);
      gmc(r, 'apr');
      r.run(1);
      log(r, 'APR');
      expect(v.getString('ap.lat_armed') + v.getString('ap.lat_active')).toContain('LOC');
      expect(v.getString('ap.vert_armed')).toContain('GS');
      expect(v.getString('ap.vert_armed') + v.getString('ap.vert_active')).toMatch(/PATH|ALTV|ALT/);
      let locT = NaN;
      let gsT = NaN;
      let maxLoc = 0;
      let maxGs = 0;
      let gearDown = false;
      r.run(900, () => {
        speedbrakeStep(r);
        const lat = v.getString('ap.lat_active');
        const vert = v.getString('ap.vert_active');
        if (isNaN(locT) && lat.startsWith('LOC')) {
          locT = r.t;
          v.set(V.flapLever, 2);
          v.set('ap.sel_spd_kt', 150);
        }
        if (!gearDown && v.get('nav1.gs_dev') < 0.6 && !isNaN(locT)) {
          gearDown = true;
          v.set(V.gearHandle, 1); // gear down one dot above the glideslope
        }
        if (isNaN(gsT) && vert === 'GS') {
          gsT = r.t;
          v.set(V.flapLever, 3); // flaps FULL, VAPP (OG 17-13)
          v.set('ap.sel_spd_kt', vapp);
          v.set('ap.sel_alt_ft', 4000); // missed-approach altitude
        }
        const ra = v.get('ra1.alt_ft');
        if (!isNaN(gsT) && ra > 250 && r.t > gsT + 20) {
          maxLoc = Math.max(maxLoc, Math.abs(v.get('nav1.cdi')));
          maxGs = Math.max(maxGs, Math.abs(v.get('nav1.gs_dev')));
        }
        return !isNaN(gsT) && ra < 1000;
      });
      log(r, '1000 ft RA, stabilized');
      expect(isNaN(locT)).toBe(false);
      expect(isNaN(gsT)).toBe(false);
      expect(v.get('gear.down_locked')).toBe(1);
      expect(v.get('surf.flaps_deg')).toBeGreaterThan(34);
      expect(Math.abs(v.get(FDM.ias) - vapp)).toBeLessThan(8);
      expect(v.get(FDM.vs)).toBeLessThan(-450);
      expect(v.get(FDM.vs)).toBeGreaterThan(-1000);
      expect(maxLoc).toBeLessThan(0.5);
      expect(maxGs).toBeLessThan(0.5);
      expect(casActive(r, 'warning')).toEqual([]);

      // ================================================================ 12. minimums: AP off at 160 ft (OG 1-7), hand-flown flare
      r.run(120, () => v.get('ra1.alt_ft') < 160);
      v.set(INPUT.apDisconnect, 1);
      r.run(0.2);
      v.set(INPUT.apDisconnect, 0);
      expect(v.get('ap.engaged')).toBe(0);
      log(r, 'AP disconnected 160 ft');
      const thetaRef = v.get(FDM.pitch);
      let pInt = 0;
      let retardSeen = false;
      let tdVs = NaN;
      let tdIas = NaN;
      let tdDistFt = NaN;
      const thr = { lat: rw01l.lat, lon: rw01l.lon };
      const far2 = destinationPoint(rw01l.lat, rw01l.lon, rw01l.headingTrue, 2);
      const clAlong = () => alongTrackNm(thr.lat, thr.lon, far2.lat, far2.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      const clCross = () => crossTrackNm(thr.lat, thr.lon, far2.lat, far2.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      r.run(60, () => {
        const ra = v.get('ra1.alt_ft');
        if (v.getString('ap.at_mode') === 'RETARD') retardSeen = true;
        // Glideslope path to 50 ft, then a flare to ~150 fpm (pilot: pitch on attitude + sink rate).
        const vsTgt = ra > 50 ? -700 + 0 * ra : -Math.max(120, 700 * (ra / 50) * 0.9);
        const thetaCmd = thetaRef + Math.max(-3, Math.min(6, 0.004 * (vsTgt - v.get(FDM.vs)) + (ra < 50 ? 2.5 * (1 - ra / 50) : 0)));
        const e = thetaCmd - v.get(FDM.pitch);
        pInt = Math.max(-0.5, Math.min(0.5, pInt + e * 0.02 / 60));
        v.set(INPUT.pitch, Math.max(-1, Math.min(1, 0.12 * e + pInt - 0.05 * v.get(FDM.q))));
        // Localizer: bank toward the centre line.
        const bankCmd = Math.max(-5, Math.min(5, -0.05 * clCross() - 0.5 * wrap180(v.get(FDM.trackTrue) - rw01l.headingTrue)));
        v.set(INPUT.roll, Math.max(-1, Math.min(1, 0.05 * (bankCmd - v.get(FDM.bank)))));
        if (ra < 45) {
          v.set(V.tla(1), 0);
          v.set(V.tla(2), 0);
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
      expect(retardSeen).toBe(true); // A/T RETARD below 40 ft (OG 7-5)
      expect(tdVs).toBeGreaterThan(-LON_LIMITS.maxLandingSinkFpm);
      expect(tdIas).toBeGreaterThan(vapp - 20);
      expect(tdIas).toBeLessThan(vapp + 5);
      expect(tdDistFt).toBeGreaterThan(500);
      expect(tdDistFt).toBeLessThan(3000);
      expect(v.get('fdm.crashed')).toBe(0);

      // ================================================================ 13. rollout: ground spoilers, reversers, brakes (OG 17-14)
      let maxGsp = 0;
      let maxRevN1 = 0;
      let stopDistFt = NaN;
      r.run(90, (t) => {
        maxGsp = Math.max(maxGsp, v.get('surf.ground_spoilers'));
        v.set(INPUT.pitch, t < 3 ? -0.1 : 0);
        v.set(INPUT.roll, 0);
        const p = destinationPoint(thr.lat, thr.lon, rw01l.headingTrue, (clAlong() + 150) / 1852);
        const err = wrap180(bearingTo(r, p.lat, p.lon) - v.get(FDM.headingTrue));
        v.set(INPUT.yaw, Math.max(-1, Math.min(1, err / 10)));
        const ias = v.get(FDM.ias);
        // Reversers (lift the levers into reverse) until 60 kt, reverse idle, stow by 45 kt; brakes after nosewheel.
        const rev = ias > 60 ? -1 : ias > 45 ? -0.05 : 0;
        v.set(V.tla(1), rev);
        v.set(V.tla(2), rev);
        maxRevN1 = Math.max(maxRevN1, v.get('eng1.n1_pct') * (rev < -0.5 ? 1 : 0));
        const b = t > 2 ? 0.45 : 0;
        v.set(INPUT.brakeLeft, b);
        v.set(INPUT.brakeRight, b);
        if (v.get(FDM.gs) < 25) {
          stopDistFt = clAlong() / 0.3048;
          return true;
        }
      });
      log(r, 'rollout 25 kt');
      LOG.push(`rollout: ground spoilers ${maxGsp.toFixed(2)}, max reverse N1 ${maxRevN1.toFixed(1)}, 25 kt at ${stopDistFt.toFixed(0)} ft past the threshold (runway ${rw01l.lengthFt} ft)`);
      expect(maxGsp).toBeGreaterThan(0.9);
      expect(maxRevN1).toBeGreaterThan(50);
      expect(stopDistFt).toBeLessThan(rw01l.lengthFt - 1000);
      r.run(2);
      expect(v.get('surf.ground_spoilers')).toBeLessThan(0.1); // stowed below 30 kt (OG 15-5)
      expect(v.get('ap.at_engaged')).toBe(0);
      expect(Math.abs(clCross())).toBeLessThan(10);
      expect(v.get(V.revMaxFrac)).toBeLessThan(0.05);

      // ================================================================ 14. after landing, taxi clear, shutdown (OG 17-15, 17-16)
      v.set(INPUT.yaw, 0);
      v.set(V.flapLever, 0);
      v.set(V.ltLdgL, 0);
      v.set(V.ltLdgR, 0);
      v.set(V.ltTaxi, 1);
      const exit = destinationPoint(thr.lat, thr.lon, rw01l.headingTrue, (clAlong() + 150) / 1852);
      const ramp2 = destinationPoint(exit.lat, exit.lon, rw01l.headingTrue + 90, 250 / 1852);
      r.run(240, () => {
        const tgt = distanceNm(v.get(FDM.lat), v.get(FDM.lon), exit.lat, exit.lon) > 0.02 && clAlong() < (alongTrackNm(thr.lat, thr.lon, far2.lat, far2.lon, exit.lat, exit.lon) * 1852) ? exit : ramp2;
        taxiStep(r, tgt.lat, tgt.lon, 12);
        return distanceNm(v.get(FDM.lat), v.get(FDM.lon), ramp2.lat, ramp2.lon) < 0.02;
      });
      stopOnGround(r);
      log(r, 'parked');
      expect(Math.abs(clCross())).toBeGreaterThan(150); // clear of the runway
      v.set(V.parkBrake, 1);
      v.set(INPUT.brakeLeft, 0);
      v.set(INPUT.brakeRight, 0);
      v.set(V.ltTaxi, 0);
      r.run(60); // engine cool-down at idle (EST 1 min)
      v.set(V.runR, 0);
      r.run(30);
      expect(v.get('eng2.running')).toBe(0);
      expect(casActive(r)).toContain('ENGINE SHUTDOWN R'); // white while the other engine runs
      expect(casActive(r, 'warning')).not.toContain('ENGINE FAIL R');
      v.set(V.runL, 0);
      r.run(60);
      log(r, 'engines stopped');
      expect(v.get('eng1.running') + v.get('eng2.running')).toBe(0);
      expect(v.get('hyd.a_psi')).toBeLessThan(1000);
      expect(casActive(r, 'warning')).toEqual([]);
      v.set(V.ltEmer, 0);
      v.set(V.stbyPwr, 0);
      v.set(V.ltAntiColl, 0);
      v.set(V.ltSeatBelts, 0);
      v.set(V.battL, 0);
      v.set(V.battR, 0);
      r.run(5);
      log(r, 'cold & dark');
      expect(v.get('elec.emer_l_powered')).toBe(0);
      expect(v.get('elec.emer_r_powered')).toBe(0);
      expect(v.get('display.pfd1.power')).toBe(0);
      expect(v.get('fdm.crashed')).toBe(0);
    } finally {
      // eslint-disable-next-line no-console
      console.log(LOG.join('\n'));
      // Vitest hides console output of passing tests: AMG_FLIGHT_LOG=<file> keeps the log for review.
      if (process.env.AMG_FLIGHT_LOG) writeFileSync(process.env.AMG_FLIGHT_LOG, LOG.join('\n') + '\n');
    }
  });
});
