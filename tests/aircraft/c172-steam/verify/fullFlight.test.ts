/**
 * Cessna 172S Skyhawk SP (steam gauges, Bendix/King NAV II, KAP 140) check ride, headless, behind
 * AMG_LONG_TESTS=1: one continuous flight from cold & dark at Wichita Eisenhower (KICT) to a full
 * stop, flown only through the cockpit control vars, the Bendix/King knobs and buttons (events and
 * momentary vars), the control-wheel switches, the pilot's yoke, pedals and toe brakes.
 *
 *   ramp -> POH start -> avionics set-up (KX 155A NAV 1 = ILS 19R, KT 76C code, KAP 140 PFT) ->
 *   taxi -> run-up (magneto check, KAP 140 preflight test) -> RWY 01L takeoff, flaps 10 ->
 *   AP (ROL / VS) at 800 ft AGL, HDG, ALT preselect 3500 -> north 12 nm -> HDG vectors ->
 *   APR ARM -> KAP 140 coupled ILS 19R (NAV / APR, GS) at 90 KIAS, flaps 10 ->
 *   A/P DISC at 250 ft above the runway -> hand-flown flare and landing -> stop.
 *
 * Procedures: POH 172SPHUS Rev 5 Sec 4 (Before Starting Engine; Starting Engine (With Battery); Before
 * Takeoff with the magneto check 1800 RPM, drop <= 150 RPM, difference <= 50 RPM; Normal Takeoff:
 * flaps 0-10, rotate 55 KIAS; Enroute climb 75-85 KIAS; Normal Landing: flaps 10-30 below 85 KIAS,
 * 60-70 KIAS flaps down); Supplement 15 (KAP 140): Sec 2 limitations (AP off for takeoff and
 * landing, not engaged below 800 ft AGL after takeoff, disengaged by 200 ft AGL on approaches,
 * flaps 10 max with the AP engaged, 70-140 KIAS), Sec 4 A preflight test (PFT, P lamp, MET split
 * switch, A/P DISC), coupled approach (APR with HDG as the intercept, GS arms after the LOC
 * capture, 90 KIAS recommended); Supplement 1 (KX 155A tuning), Supplement 2 (KT 76C SBY / ALT).
 */
import { describe, expect, it } from 'vitest';
import { alongTrackNm, crossTrackNm, destinationPoint, distanceNm, initialBearing } from '../../../../src/core/geo';
import { AP, ENG, FDM, INPUT, NAV, SURF } from '../../../../src/core/vars';
import { ANN, C172, MAG } from '../../../../src/aircraft/c172s-common/vars';
import { EV, KAP, KLN, KMA, KT, KX, ST } from '../../../../src/aircraft/c172-steam/vars';
import { CDI1_RECEIVER } from '../../../../src/aircraft/c172-steam/systems';
import { NavDatabaseImpl } from '../../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../../src/nav/data/nodeLoader';
import { FlatWorld } from '../../../physics/helpers';
import { makeSteamRig, press, type SteamRig } from '../rig';

const LONG = process.env.AMG_LONG_TESTS === '1';
const FT = 0.3048;
const wrap180 = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;

const LOG: string[] = [];
function log(r: SteamRig, what: string): void {
  const v = r.vars;
  const a = r.sys.afcs;
  LOG.push(
    `[${(r.t() / 60).toFixed(1).padStart(5)} min] ${what} | ${v.get(FDM.altMsl).toFixed(0)} ft (${v.get(FDM.altAgl).toFixed(0)} AGL) ${v.get(FDM.ias).toFixed(0)} KIAS VS ${v.get(FDM.vs).toFixed(0)} hdg ${v.get(FDM.headingMag).toFixed(0)} DG ${v.get(ST.dgHeading).toFixed(0)} | ${v.get(ENG.rpm(1)).toFixed(0)} rpm thr ${v.get(C172.throttle).toFixed(2)} | AP ${v.get(AP.engaged)} ${a.lat}/${a.vert} arm ${v.getString(AP.lateralArmed)}/${v.getString(AP.verticalArmed)} VS ref ${v.get(AP.selVs).toFixed(0)} | flaps ${v.get(SURF.flapsDeg).toFixed(0)} trim ${v.get(C172.trimPosition).toFixed(2)}`,
  );
}

/** The pilot's hand on the throttle: PI speed loop on the airspeed indicator. */
class ThrottleHand {
  private integ = 0.6;
  constructor(private readonly r: SteamRig) {}
  reset(t: number): void {
    this.integ = t;
  }
  step(targetKt: number, lo = 0, hi = 1): void {
    const v = this.r.vars;
    const err = targetKt - v.get('adc1.ias_kt');
    this.integ = Math.max(lo, Math.min(hi, this.integ + (0.006 * err) / 60));
    v.set(C172.throttle, Math.max(lo, Math.min(hi, this.integ + 0.02 * err)));
  }
}

/** Hand flying: pitch attitude and bank holds through the yoke (INPUT.pitch / roll). */
class Yoke {
  private pInt = 0;
  private rInt = 0;
  constructor(private readonly r: SteamRig) {}
  pitch(thetaCmd: number): void {
    const v = this.r.vars;
    const e = thetaCmd - v.get(FDM.pitch);
    this.pInt = Math.max(-0.6, Math.min(0.6, this.pInt + (e * 0.03) / 60));
    v.set(INPUT.pitch, Math.max(-1, Math.min(1, 0.09 * e + this.pInt - 0.03 * v.get(FDM.q))));
  }
  bank(phiCmd: number): void {
    const v = this.r.vars;
    const e = phiCmd - v.get(FDM.bank);
    this.rInt = Math.max(-0.3, Math.min(0.3, this.rInt + (e * 0.01) / 60));
    v.set(INPUT.roll, Math.max(-1, Math.min(1, 0.04 * e + this.rInt)));
  }
  release(): void {
    this.r.vars.set(INPUT.pitch, 0);
    this.r.vars.set(INPUT.roll, 0);
    this.pInt = 0;
    this.rInt = 0;
  }
}

function bearingTo(r: SteamRig, lat: number, lon: number): number {
  return initialBearing(r.vars.get(FDM.lat), r.vars.get(FDM.lon), lat, lon);
}

/** Ground steering (rudder pedals / nosewheel), speed with throttle and toe brakes. */
function taxiStep(r: SteamRig, tgt: { lat: number; lon: number }, gsKt: number): void {
  const v = r.vars;
  const err = wrap180(bearingTo(r, tgt.lat, tgt.lon) - v.get(FDM.headingTrue));
  v.set(INPUT.yaw, Math.max(-1, Math.min(1, err / 15)));
  const e = gsKt - v.get(FDM.gs);
  v.set(C172.throttle, Math.max(0, Math.min(0.35, 0.12 + 0.03 * e)));
  const brake = e < -2 ? Math.min(1, -0.12 * e) : 0;
  v.set(INPUT.brakeLeft, brake);
  v.set(INPUT.brakeRight, brake);
}

/** Turns an encoder (`base.inc` / `base.dec` with a click count) until `get()` equals `target`. */
function knobTo(r: SteamRig, base: string, get: () => number, target: number, step: number, wrap = 0): void {
  for (let i = 0; i < 400; i++) {
    let d = target - get();
    if (wrap) d = ((((d + wrap / 2) % wrap) + wrap) % wrap) - wrap / 2;
    const n = Math.round(d / step);
    if (n === 0) return;
    r.events.emit(`${base}.${n > 0 ? 'inc' : 'dec'}`, Math.min(20, Math.abs(n)));
    r.run(1 / 30);
  }
}

/** KX 155A #1: frequency into the NAV standby window with the concentric knobs, then the transfer button. */
function tuneNav1(r: SteamRig, mhz: number): void {
  const v = r.vars;
  const target = Math.round(mhz * 1000);
  const stby = () => Math.round(v.get(NAV.standbyFreq(1)) * 1000);
  knobTo(r, EV.kxNavMhz(1), () => Math.floor(stby() / 1000), Math.floor(target / 1000), 1);
  knobTo(r, EV.kxNavKhz(1), () => stby() % 1000, target % 1000, 50);
  expect(stby()).toBe(target);
  press(r, KX(1).navXfr, 0.2);
}

/** KT 76C: four digit keys enter a new code (Supplement 2 item 3). */
function squawk(r: SteamRig, code: string): void {
  for (const c of code) {
    r.events.emit(EV.ktKey(Number(c)));
    r.run(0.3);
  }
  r.run(1);
}

describe.runIf(LONG)('Cessna 172S steam (NAV II, KAP 140) check ride (KICT 01L -> ILS 19R)', () => {
  it('cold & dark -> POH start -> taxi -> takeoff -> KAP 140 coupled ILS -> landing', { timeout: 1_800_000 }, async () => {
    const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
    await db.load();
    const kict = db.airport('KICT')!;
    const rw01 = kict.runways.find((x) => x.ident === '01L')!;
    const rw19 = kict.runways.find((x) => x.ident === '19R')!;
    expect(rw19.ils).toBeTruthy();
    const elevFt = (rw01.elevationFt + rw19.elevationFt) / 2;
    const along = destinationPoint(rw01.lat, rw01.lon, rw01.headingTrue, 250 / 1852);
    const ramp = destinationPoint(along.lat, along.lon, rw01.headingTrue - 90, 110 / 1852);
    const r = makeSteamRig({
      state: 'cold_dark',
      db,
      world: new FlatWorld(elevFt * FT, 'asphalt', 0, kict.lat),
      field: { lat: kict.lat, lon: kict.lon, elevFt, courseTrue: rw01.headingTrue },
      start: { lat: ramp.lat, lon: ramp.lon, headingTrue: rw01.headingTrue + 90 },
      fuelGalPerTank: 20,
    });
    const v = r.vars;
    const hand = new ThrottleHand(r);
    const yoke = new Yoke(r);
    const magVar = kict.magVar ?? 0;
    const kap = (b: Parameters<typeof EV.kap>[0]): void => {
      r.events.emit(EV.kap(b));
      r.run(0.2);
    };
    try {
      // ================================================================ 1. cold & dark, preflight (POH Sec 4)
      r.run(1);
      expect(v.get(ENG.running(1))).toBe(0);
      expect(v.get(C172.controlLock)).toBe(1);
      expect(v.get(C172.keyIn)).toBe(0);
      expect(v.get(KAP.on)).toBe(0);
      log(r, 'cold & dark');
      v.set(C172.controlLock, 0); // Control wheel lock - REMOVE
      v.set(C172.keyIn, 1); // ignition key in (OFF)
      expect(v.get(C172.fuelSelector)).toBe(1); // BOTH
      expect(v.get(C172.fuelShutoff)).toBe(1); // ON (push full in)
      expect(v.get(C172.parkingBrake)).toBe(1);
      expect(v.get(C172.avionicsBus1)).toBe(0); // AVIONICS switch OFF for the start
      expect(v.get(C172.avionicsBus2)).toBe(0);

      // ================================================================ 2. starting engine (with battery)
      v.set(C172.throttle, 0.08); // open 1/4 inch
      v.set(C172.mixture, 0); // idle cutoff
      v.set(C172.masterBat, 1);
      v.set(C172.masterAlt, 1);
      v.set(C172.beacon, 1);
      r.run(1);
      expect(v.get(ANN.vacL)).toBe(1); // L VAC R annunciator lit with the engine (pumps) stopped
      expect(v.get(ANN.vacR)).toBe(1);
      v.set(C172.fuelPump, 1); // prime: pump ON, mixture rich 3-5 s, then cutoff, pump OFF
      v.set(C172.mixture, 1);
      r.run(4);
      v.set(C172.mixture, 0);
      v.set(C172.fuelPump, 0);
      v.set(C172.magneto, MAG.start);
      let started = false;
      r.run(10, () => {
        if (v.get(ENG.rpm(1)) > 450) v.set(C172.mixture, 1);
        started = v.get(ENG.running(1)) > 0.5 && v.get(ENG.rpm(1)) > 700;
        return started;
      });
      v.set(C172.magneto, MAG.both); // spring back to BOTH
      v.set(C172.mixture, 1);
      expect(started).toBe(true);
      v.set(C172.throttle, 0.17);
      r.run(20);
      expect(v.get(ENG.oilPressPsi(1))).toBeGreaterThan(20);
      expect(v.get('elec.alt_online')).toBe(1);
      log(r, 'engine running');

      // ================================================================ 3. after start: avionics ON, units on, KAP 140 PFT
      v.set(C172.nav, 1);
      v.set(C172.avionicsBus1, 1);
      v.set(C172.avionicsBus2, 1);
      v.set(KMA.power, 1); // audio panel ON
      v.set(KMA.sel('nav1'), 1); // NAV 1 audio for the ILS ident
      v.set(KX(1).comVol, 0.6); // KX 155A #1 / #2 ON (COMM volume out of the OFF detent)
      v.set(KX(2).comVol, 0.6);
      v.set(KX(1).navVol, 0.5);
      v.set(KT.mode, 1); // KT 76C SBY
      v.set(KLN.power, 1); // KLN 94 ON
      let sawPft = false;
      r.run(4, () => {
        if (v.get(KAP.pft) > 0) sawPft = true;
      });
      expect(sawPft).toBe(true); // Supplement 15 Sec 4 A.2: PFT on power application
      expect(v.get(KX(1).on)).toBe(1);
      expect(v.get(KMA.on)).toBe(1);
      expect(v.get(KT.on)).toBe(1);
      expect(v.get(KLN.on)).toBe(1);
      // Red P for about 30 s after the test; the servos are not available until it goes out.
      r.run(90, () => v.get('ac.kap140.servo_ok') === 1);
      expect(v.get(KAP.pLamp)).toBe(0);
      expect(v.get(KAP.baroFlash)).toBe(1);
      press(r, KAP.baro); // BARO checked / set (Supplement 15 Sec 4 A.4)
      expect(v.get(KAP.baroFlash)).toBe(0);
      // Directional gyro: let the rotor come up to speed, then set it to the magnetic compass.
      r.run(120, () => v.get('ac.vac.suction_inhg') > 4.5 && r.t() > 150);
      r.sys.dg.gyro.adjust(wrap180(v.get(FDM.headingMag) - v.get(ST.dgHeading)));
      r.run(1);
      expect(Math.abs(wrap180(v.get(ST.dgHeading) - v.get(FDM.headingMag)))).toBeLessThan(2);
      log(r, 'avionics up, DG set');

      // ================================================================ 4. avionics set-up: NAV 1 = ILS 19R, OBS, bug, ALT, squawk
      const ils = rw19.ils!.freqMhz;
      tuneNav1(r, ils);
      expect(v.get(NAV.activeFreq(1))).toBeCloseTo(ils, 2);
      expect(v.get(ST.cdiSource)).toBe(0); // NAV/GPS switch on NAV: the KI 209A shows NAV 1, the KAP 140 couples it
      const locCrs = Math.round(rw19.ils!.courseTrue - magVar);
      v.set(NAV.obs(CDI1_RECEIVER), locCrs); // KI 209A OBS to the localizer course
      v.set(AP.selHeading, Math.round(rw01.headingTrue - magVar)); // heading bug to the runway heading
      knobTo(r, EV.kapAltOuter, () => Math.floor(v.get(AP.selAltitude) / 1000), 3, 1);
      knobTo(r, EV.kapAltInner, () => v.get(AP.selAltitude), 3500, 100);
      expect(v.get(AP.selAltitude)).toBe(3500);
      squawk(r, '4521');
      expect(v.get(KT.display)).toBe(4521);
      r.run(1);
      expect(v.get(NAV.obs(1))).toBe(locCrs);
      log(r, `NAV1 ${ils.toFixed(2)} tuned, LOC course ${locCrs}, ALT 3500, squawk 4521`);

      // ================================================================ 5. taxi to runway 01L, run-up and KAP 140 preflight test
      v.set(C172.parkingBrake, 0);
      const onCl = destinationPoint(rw01.lat, rw01.lon, rw01.headingTrue, 330 / 1852);
      const far = destinationPoint(rw01.lat, rw01.lon, rw01.headingTrue, 1.5);
      r.run(240, () => {
        taxiStep(r, onCl, 8);
        return distanceNm(v.get(FDM.lat), v.get(FDM.lon), onCl.lat, onCl.lon) < 0.012;
      });
      r.run(60, () => {
        taxiStep(r, far, 4);
        return Math.abs(wrap180(v.get(FDM.headingTrue) - rw01.headingTrue)) < 4;
      });
      v.set(C172.throttle, 0);
      v.set(INPUT.brakeLeft, 1);
      v.set(INPUT.brakeRight, 1);
      r.run(8);
      log(r, 'lined up (brakes held)');
      // Run-up 1800 RPM, magneto check.
      v.set(C172.throttle, 0.5);
      r.run(15, () => {
        const e = 1800 - v.get(ENG.rpm(1));
        v.set(C172.throttle, Math.max(0.1, Math.min(0.8, v.get(C172.throttle) + 0.00004 * e)));
      });
      const rpmBoth = v.get(ENG.rpm(1));
      v.set(C172.magneto, MAG.right);
      r.run(4);
      const dropR = rpmBoth - v.get(ENG.rpm(1));
      v.set(C172.magneto, MAG.both);
      r.run(4);
      v.set(C172.magneto, MAG.left);
      r.run(4);
      const dropL = rpmBoth - v.get(ENG.rpm(1));
      v.set(C172.magneto, MAG.both);
      r.run(3);
      LOG.push(`run-up ${rpmBoth.toFixed(0)} rpm, mag drop R ${dropR.toFixed(0)} L ${dropL.toFixed(0)}, suction ${v.get('ac.vac.suction_inhg').toFixed(1)} inHg`);
      expect(dropR).toBeGreaterThan(0);
      expect(dropR).toBeLessThan(150);
      expect(dropL).toBeLessThan(150);
      expect(Math.abs(dropR - dropL)).toBeLessThan(50);
      expect(v.get('ac.vac.suction_inhg')).toBeGreaterThan(4.5);
      v.set(C172.throttle, 0.1);
      // KAP 140 preflight (Supplement 15 Sec 4 A.3): MET split switch - one half alone does not
      // move the trim, both halves do; AP engages; A/P DISC disengages it with the tone.
      const trimTo = v.get(C172.trimPosition);
      v.set(ST.metLeft, 1);
      r.run(1.5);
      v.set(ST.metLeft, 0);
      expect(Math.abs(v.get(C172.trimPosition) - trimTo)).toBeLessThan(0.005);
      v.set(ST.metLeft, 1);
      v.set(ST.metRight, 1);
      r.run(1.5);
      v.set(ST.metLeft, 0);
      v.set(ST.metRight, 0);
      r.run(0.2);
      expect(v.get(C172.trimPosition)).toBeGreaterThan(trimTo + 0.03);
      kap('ap');
      expect(v.get(AP.engaged)).toBe(1);
      r.run(2);
      const tones0 = r.log.toneOn.length;
      press(r, ST.apDisc, 0.3);
      expect(v.get(AP.engaged)).toBe(0);
      expect(r.log.toneOn.slice(tones0)).toContain('ap_disconnect');
      // Elevator trim back to TAKEOFF with the MET (both halves DN).
      v.set(ST.metLeft, -1);
      v.set(ST.metRight, -1);
      r.run(6, () => v.get(C172.trimPosition) <= trimTo + 0.005);
      v.set(ST.metLeft, 0);
      v.set(ST.metRight, 0);
      r.run(0.5);
      expect(Math.abs(v.get(C172.trimPosition) - trimTo)).toBeLessThan(0.03);
      // Before takeoff: flaps 10, transponder ALT, lights.
      v.set(C172.throttle, 0);
      v.set(C172.flapLever, 1);
      v.set(C172.land, 1);
      v.set(C172.strobe, 1);
      v.set(KT.mode, 4);
      r.run(8);
      expect(v.get(NAV.xpdrMode)).toBe(3);
      expect(v.get(SURF.flapsDeg)).toBeGreaterThan(8);

      // ================================================================ 6. normal takeoff (flaps 10), climb 75-85 KIAS
      v.set(INPUT.brakeLeft, 0);
      v.set(INPUT.brakeRight, 0);
      v.set(C172.throttle, 1);
      const thr = { lat: rw01.lat, lon: rw01.lon };
      const cross = () => crossTrackNm(thr.lat, thr.lon, far.lat, far.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      let rotT = NaN;
      let liftT = NaN;
      r.run(120, () => {
        const hdgErr = wrap180(rw01.headingTrue - v.get(FDM.headingTrue));
        v.set(INPUT.yaw, Math.max(-1, Math.min(1, 0.08 * hdgErr - 0.03 * cross())));
        if (isNaN(rotT) && v.get('adc1.ias_kt') >= 55) rotT = r.t(); // rotate at 55 KIAS
        if (isNaN(rotT)) {
          v.set(INPUT.pitch, 0);
          yoke.bank(0);
        } else {
          const ias = v.get('adc1.ias_kt');
          yoke.pitch(Math.max(2, Math.min(10, 8 + 0.4 * (ias - 72))));
          yoke.bank(Math.max(-10, Math.min(10, 1.5 * hdgErr)));
        }
        if (isNaN(liftT) && v.get(FDM.onGround) === 0) liftT = r.t();
        // Flaps up above 300 ft AGL at a safe airspeed (POH Normal Takeoff: "Wing Flaps RETRACT").
        if (v.get(FDM.altAgl) > 300 && v.get('adc1.ias_kt') > 65 && v.get(C172.flapLever) > 0) v.set(C172.flapLever, 0);
        return v.get(FDM.altAgl) > 800;
      });
      v.set(INPUT.yaw, 0);
      log(r, '800 ft AGL');
      expect(isNaN(liftT)).toBe(false);
      expect(v.get(FDM.crashed)).toBe(0);
      expect(v.get(FDM.vs)).toBeGreaterThan(400);
      expect(v.get(C172.flapLever)).toBe(0);

      // ================================================================ 7. KAP 140: AP (ROL / VS) above 800 ft AGL, HDG, ARM, VS for 80 KIAS
      yoke.release();
      kap('ap');
      expect(v.get(AP.engaged)).toBe(1);
      expect(r.sys.afcs.lat).toBe('ROL');
      expect(r.sys.afcs.vert).toBe('VS');
      kap('hdg');
      expect(r.sys.afcs.lat).toBe('HDG');
      if (v.get(KAP.armAnn) < 0.5) kap('arm');
      expect(v.get(KAP.armAnn)).toBe(1);
      v.set(C172.land, 0);
      log(r, 'AP HDG / VS, ARM');
      // Full power climb; the pilot trims the VS reference with UP / DN for 75-85 KIAS.
      let lastAdj = r.t();
      r.run(600, () => {
        if (r.t() - lastAdj > 6) {
          lastAdj = r.t();
          const ias = v.get('adc1.ias_kt');
          if (ias < 77) press(r, KAP.dn, 0.15);
          else if (ias > 86 && v.get(AP.selVs) < 900) press(r, KAP.up, 0.15);
        }
        return r.sys.afcs.vert === 'ALT' && Math.abs(v.get(FDM.altMsl) - 3500) < 60;
      });
      log(r, 'level 3500 ALT');
      expect(r.sys.afcs.vert).toBe('ALT');
      // Cruise ~2300 RPM (POH Sec 5), fly north.
      const thr19 = { lat: rw19.lat, lon: rw19.lon };
      r.run(1200, () => {
        const e = 2300 - v.get(ENG.rpm(1));
        v.set(C172.throttle, Math.max(0.05, Math.min(1, v.get(C172.throttle) + 0.00001 * e)));
        return distanceNm(v.get(FDM.lat), v.get(FDM.lon), thr19.lat, thr19.lon) > 12 && Math.abs(wrap180(bearingTo(r, thr19.lat, thr19.lon) - rw19.headingTrue)) < 30;
      });
      log(r, '12 nm north of RWY 19R');
      expect(Math.abs(v.get(ENG.rpm(1)) - 2300)).toBeLessThan(80);
      expect(Math.abs(v.get(FDM.altMsl) - 3500)).toBeLessThan(80);

      // ================================================================ 8. vectors: HDG west, then 30 deg intercept; APR ARM
      const west = Math.round(rw19.headingTrue - magVar + 90);
      v.set(AP.selHeading, ((west % 360) + 360) % 360);
      r.run(150, () => {
        hand.step(95, 0.1, 0.9);
        return Math.abs(wrap180(v.get(ST.dgHeading) - west)) < 3;
      });
      r.run(40, () => hand.step(95, 0.1, 0.9));
      const intercept = Math.round(rw19.headingTrue - magVar - 30);
      v.set(AP.selHeading, ((intercept % 360) + 360) % 360);
      r.run(90, () => {
        hand.step(95, 0.1, 0.9);
        return Math.abs(wrap180(v.get(ST.dgHeading) - intercept)) < 3;
      });
      expect(v.get(NAV.received(1))).toBe(1);
      expect(v.get(NAV.isLoc(1))).toBe(1);
      kap('apr');
      log(r, 'APR');
      expect(r.sys.afcs.lat).toBe('HDG'); // HDG flies the intercept while APR is armed
      expect(r.sys.afcs.latArmed).toBe('LOC');
      expect(v.getString(AP.lateralArmed)).toBe('APR ARM'); // KAP 140 display: APR with ARM (Supplement 15 Fig 1)

      // ================================================================ 9. coupled ILS: APR (LOC), GS; flaps 10, 90 KIAS
      let locT = NaN;
      let gsT = NaN;
      let maxLoc = 0;
      let maxGs = 0;
      let flaps10 = false;
      const agl = () => v.get(FDM.altMsl) - rw19.elevationFt;
      r.run(900, () => {
        hand.step(90, 0.05, 0.9);
        const lat = r.sys.afcs.lat;
        const vert = r.sys.afcs.vert;
        if (isNaN(locT) && lat === 'LOC') {
          locT = r.t();
          // Supplement 15 Fig 2 item 15: the heading bug is the course datum in APR; set it to the course.
          v.set(AP.selHeading, locCrs);
        }
        if (!flaps10 && !isNaN(locT) && v.get(NAV.gsDev(1)) < 0.6) {
          v.set(C172.flapLever, 1); // flaps 10 approaching the glideslope (10 deg max with the AP engaged)
          flaps10 = true;
        }
        if (isNaN(gsT) && vert === 'GS') {
          gsT = r.t();
          knobTo(r, EV.kapAltOuter, () => Math.floor(v.get(AP.selAltitude) / 1000), 3, 1); // missed approach altitude
        }
        if (!isNaN(gsT) && agl() > 400 && r.t() > gsT + 30) {
          maxLoc = Math.max(maxLoc, Math.abs(v.get(NAV.cdi(1))));
          maxGs = Math.max(maxGs, Math.abs(v.get(NAV.gsDev(1))));
        }
        return !isNaN(gsT) && agl() < 250;
      });
      log(r, '250 ft above the runway');
      LOG.push(`LOC captured ${(locT / 60).toFixed(1)} min, GS ${(gsT / 60).toFixed(1)} min, max |LOC| ${maxLoc.toFixed(2)} max |GS| ${maxGs.toFixed(2)} (full scale 1)`);
      expect(isNaN(locT)).toBe(false);
      expect(isNaN(gsT)).toBe(false);
      expect(maxLoc).toBeLessThan(0.5);
      expect(maxGs).toBeLessThan(0.6);
      expect(v.get(SURF.flapsDeg)).toBeLessThan(10.5);
      expect(v.get('adc1.ias_kt')).toBeGreaterThan(80);

      // ================================================================ 10. A/P DISC (not below 200 ft AGL); hand-flown landing
      press(r, ST.apDisc, 0.3);
      expect(v.get(AP.engaged)).toBe(0);
      const thetaRef = v.get(FDM.pitch);
      const far19 = destinationPoint(rw19.lat, rw19.lon, rw19.headingTrue, 2);
      const along19 = () => alongTrackNm(rw19.lat, rw19.lon, far19.lat, far19.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      const cross19 = () => crossTrackNm(rw19.lat, rw19.lon, far19.lat, far19.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      let tdVs = NaN;
      let tdIas = NaN;
      let tdFt = NaN;
      r.run(120, () => {
        const h = v.get(FDM.altAgl);
        // Flaps 20 once below 85 KIAS (POH flap limit 10-30 deg: 85 KIAS).
        if (v.get('adc1.ias_kt') < 84 && v.get(C172.flapLever) < 2) v.set(C172.flapLever, 2);
        const vsTgt = h > 30 ? -450 : -Math.max(80, 450 * (h / 30));
        const theta = thetaRef + Math.max(-4, Math.min(8, 0.006 * (vsTgt - v.get(FDM.vs)) + (h < 25 ? 3 * (1 - h / 25) : 0)));
        yoke.pitch(theta);
        yoke.bank(Math.max(-8, Math.min(8, -0.08 * cross19() - 0.8 * wrap180(v.get(FDM.trackTrue) - rw19.headingTrue))));
        if (h > 40) hand.step(68, 0, 0.8);
        else v.set(C172.throttle, 0); // power idle over the threshold
        if (v.get(FDM.onGround) === 1) {
          tdVs = v.get(FDM.vs);
          tdIas = v.get('adc1.ias_kt');
          tdFt = along19() / FT;
          return true;
        }
        return false;
      });
      log(r, 'touchdown');
      LOG.push(`touchdown ${tdVs.toFixed(0)} fpm, ${tdIas.toFixed(0)} KIAS, ${tdFt.toFixed(0)} ft past the threshold, ${cross19().toFixed(1)} m off the centre line`);
      expect(v.get(FDM.crashed)).toBe(0);
      expect(tdVs).toBeGreaterThan(-500);
      expect(tdIas).toBeLessThan(75);
      expect(tdFt).toBeGreaterThan(0);
      expect(tdFt).toBeLessThan(4000);
      expect(Math.abs(cross19())).toBeLessThan(12);

      // ================================================================ 11. rollout: brakes, flaps UP, stop; after landing
      yoke.release();
      v.set(INPUT.pitch, 0.3);
      r.run(60, () => {
        v.set(INPUT.yaw, Math.max(-1, Math.min(1, 0.08 * wrap180(rw19.headingTrue - v.get(FDM.headingTrue)) + 0.03 * cross19())));
        const gs = v.get(FDM.gs);
        v.set(INPUT.brakeLeft, gs > 3 ? 0.7 : 0.3);
        v.set(INPUT.brakeRight, gs > 3 ? 0.7 : 0.3);
        return gs < 1;
      });
      v.set(C172.flapLever, 0);
      v.set(C172.strobe, 0);
      v.set(KT.mode, 1); // transponder SBY after landing
      r.run(5);
      log(r, 'stopped');
      LOG.push(`stopped ${(along19() / FT).toFixed(0)} ft past the threshold (runway ${rw19.lengthFt} ft)`);
      expect(v.get(FDM.gs)).toBeLessThan(1.5);
      expect(v.get(ENG.running(1))).toBe(1);
      expect(v.get(NAV.xpdrMode)).toBe(1);
    } finally {
      console.log(LOG.join('\n'));
    }
  });
});
