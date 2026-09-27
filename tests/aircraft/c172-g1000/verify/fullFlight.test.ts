/**
 * Cessna 172S G1000 NXi check ride, headless, behind AMG_LONG_TESTS=1: one continuous flight from
 * cold & dark at Wichita Eisenhower (KICT) to a full stop, flown only through the cockpit control vars,
 * the G1000 bezel keys / knobs (events), the yoke switches, the pilot's yoke, pedals and toe brakes.
 *
 *   ramp -> taxi -> RWY 01L takeoff -> climb on HDG / FLC to 3,500 ft -> north 12 nm ->
 *   HDG 290 / HDG 170 (30 deg intercept) -> APR: GFC 700 coupled ILS 19R (LOC, GS) ->
 *   A/P TRIM DISC at 200 ft above the runway -> hand-flown flare and landing -> stop.
 *
 * Procedures: POH 172SPHBUS-00 Sec 4 (Before Starting Engine, Starting Engine (With Battery), Before
 * Takeoff with the magneto check, Normal Takeoff: flaps 0-10, rotate 55 KIAS, climb 70-85 KIAS;
 * Normal Landing: 65-75 KIAS flaps UP, 60-70 KIAS flaps FULL), Sec 7 GFC 700 (AP engages in PIT / ROL,
 * FLC, ALTS capture, APR arms LOC and GS with the CDI on LOC1), Sec 2 (autopilot minimum use height
 * 200 ft AGL on approach, EST from the GFC 700 AFM supplement practice).
 */
import { describe, expect, it } from 'vitest';
import { alongTrackNm, crossTrackNm, destinationPoint, distanceNm, initialBearing } from '../../../../src/core/geo';
import { ENG, FDM, INPUT } from '../../../../src/core/vars';
import { C172, MAG, STBY_BATT } from '../../../../src/aircraft/c172s-common/vars';
import { C172G } from '../../../../src/aircraft/c172-g1000/vars';
import { G1K, G1K_EVENTS, CDI_SOURCE } from '../../../../src/avionics/garmin-g1000/vars';
import { FlatWorld } from '../../../physics/helpers';
import { makeG1k, loadNav, hold, cas, type G1kRig } from '../helpers';

const LONG = process.env.AMG_LONG_TESTS === '1';
const FT = 0.3048;
const wrap180 = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;

const LOG: string[] = [];
function log(r: G1kRig, what: string): void {
  const v = r.vars;
  LOG.push(
    `[${(r.t() / 60).toFixed(1).padStart(5)} min] ${what} | ${v.get(FDM.altMsl).toFixed(0)} ft (${v.get(FDM.altAgl).toFixed(0)} AGL) ${v.get(FDM.ias).toFixed(0)} KIAS VS ${v.get(FDM.vs).toFixed(0)} hdg ${v.get(FDM.headingMag).toFixed(0)} | ${v.get(ENG.rpm(1)).toFixed(0)} rpm thr ${v.get(C172.throttle).toFixed(2)} | AP ${v.get('ap.engaged')} ${v.getString('ap.lat_active')}/${v.getString('ap.vert_active')} arm ${v.getString('ap.lat_armed')}/${v.getString('ap.vert_armed')} | flaps ${v.get('surf.flaps_deg').toFixed(0)} | CAS ${cas(r).join(',')}`,
  );
}

/** The pilot's hand on the throttle: PI speed loop. */
class ThrottleHand {
  private integ = 0.6;
  constructor(private readonly r: G1kRig) {}
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

/** Hand flying: pitch attitude and bank holds through the yoke (INPUT.pitch / roll), rudder for the ball. */
class Yoke {
  private pInt = 0;
  private rInt = 0;
  constructor(private readonly r: G1kRig) {}
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

function bearingTo(r: G1kRig, lat: number, lon: number): number {
  return initialBearing(r.vars.get(FDM.lat), r.vars.get(FDM.lon), lat, lon);
}

/** Ground steering (rudder pedals / nosewheel), speed with throttle and toe brakes. */
function taxiStep(r: G1kRig, tgt: { lat: number; lon: number }, gsKt: number): void {
  const v = r.vars;
  const err = wrap180(bearingTo(r, tgt.lat, tgt.lon) - v.get(FDM.headingTrue));
  v.set(INPUT.yaw, Math.max(-1, Math.min(1, err / 15)));
  const e = gsKt - v.get(FDM.gs);
  v.set(C172.throttle, Math.max(0, Math.min(0.35, 0.12 + 0.03 * e)));
  const brake = e < -2 ? Math.min(1, -0.12 * e) : 0;
  v.set(INPUT.brakeLeft, brake);
  v.set(INPUT.brakeRight, brake);
}

/** Emits bezel knob clicks until `get()` equals `target` (knob events carry signed clicks). */
function knobTo(r: G1kRig, event: string, get: () => number, target: number, step: number, wrap = 0): void {
  for (let i = 0; i < 400; i++) {
    let d = target - get();
    if (wrap) d = ((((d + wrap / 2) % wrap) + wrap) % wrap) - wrap / 2;
    const n = Math.round(d / step);
    if (n === 0) return;
    r.events.emit(event, Math.max(-20, Math.min(20, n)));
    r.run(1 / 30);
  }
}

function key(r: G1kRig, k: string): void {
  r.events.emit(G1K_EVENTS.afcsKey('pfd', k));
  r.run(0.2);
}

describe.runIf(LONG)('Cessna 172S G1000 NXi check ride (KICT 01L -> ILS 19R)', () => {
  it('cold & dark -> start -> taxi -> takeoff -> GFC 700 coupled ILS -> landing', { timeout: 1_800_000 }, async () => {
    const db = await loadNav();
    const kict = db.airport('KICT')!;
    const rw01 = kict.runways.find((x) => x.ident === '01L')!;
    const rw19 = kict.runways.find((x) => x.ident === '19R')!;
    expect(rw19.ils).toBeTruthy();
    const elevFt = (rw01.elevationFt + rw19.elevationFt) / 2;
    const along = destinationPoint(rw01.lat, rw01.lon, rw01.headingTrue, 250 / 1852);
    const ramp = destinationPoint(along.lat, along.lon, rw01.headingTrue - 90, 110 / 1852);
    const r = makeG1k({
      state: 'cold_dark',
      nav: db,
      world: new FlatWorld(elevFt * FT, 'asphalt', 0, kict.lat),
      field: { lat: kict.lat, lon: kict.lon, elevFt, courseTrue: rw01.headingTrue },
      start: { lat: ramp.lat, lon: ramp.lon, headingTrue: rw01.headingTrue + 90 },
      fuelGalPerTank: 20,
    });
    const v = r.vars;
    const hand = new ThrottleHand(r);
    const yoke = new Yoke(r);
    try {
      // ================================================================ 1. cold & dark, preflight (POH Sec 4)
      r.run(1);
      expect(v.get(ENG.running(1))).toBe(0);
      expect(v.get(C172.controlLock)).toBe(1);
      expect(v.get(C172.keyIn)).toBe(0);
      log(r, 'cold & dark');
      v.set(C172.controlLock, 0); // Pitot tube cover / control wheel lock - REMOVE
      hold(r, C172G.keyTag, 1, 0.2, 0); // ignition key in
      expect(v.get(C172.keyIn)).toBe(1);
      expect(v.get(C172.fuelSelector)).toBe(1); // BOTH
      expect(v.get(C172.fuelShutoff)).toBe(1); // ON (push full in)
      expect(v.get(C172.parkingBrake)).toBe(1);
      // Before starting engine: STBY BATT TEST 10 s (TEST light stays on), then ARM.
      v.set(C172.stbyBatt, STBY_BATT.test);
      r.run(10);
      expect(v.get(C172.stbyTestLamp)).toBe(1);
      v.set(C172.stbyBatt, STBY_BATT.arm);
      r.run(2);
      expect(v.get('elec.pfd_powered')).toBe(1);

      // ================================================================ 2. starting engine (with battery)
      v.set(C172.throttle, 0.08); // open 1/4 inch
      v.set(C172.mixture, 0); // idle cutoff
      v.set(C172.masterBat, 1);
      v.set(C172.masterAlt, 1);
      v.set(C172.beacon, 1);
      r.run(1);
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
      r.run(20);
      expect(v.get(ENG.oilPressPsi(1))).toBeGreaterThan(20);
      log(r, 'engine running');
      // After start: NAV lights, AVIONICS BUS 1 and 2 ON; G1000 and GRS 79 align.
      v.set(C172.nav, 1);
      v.set(C172.avionicsBus1, 1);
      v.set(C172.avionicsBus2, 1);
      v.set(C172.throttle, 0.17);
      r.run(120, () => v.get(G1K.unitUp('mfd')) === 1 && v.get(G1K.unitUp('servos')) === 1 && v.get('ahrs1.valid') === 1 && r.t() > 90);
      expect(v.get(G1K.unitUp('pfd'))).toBe(1);
      expect(v.get('ahrs1.valid')).toBe(1);
      expect(v.get('elec.alt_online')).toBe(1);
      log(r, 'avionics up');

      // ================================================================ 3. avionics set-up: NAV1 = ILS 19R, CRS, ALT, HDG
      const ils = rw19.ils!.freqMhz;
      const mhz = Math.floor(ils + 1e-6);
      knobTo(r, G1K_EVENTS.navOuter('pfd'), () => Math.floor(v.get('nav1.stby_mhz') + 1e-6), mhz, 1);
      knobTo(r, G1K_EVENTS.navInner('pfd'), () => Math.round((v.get('nav1.stby_mhz') - mhz) * 1000), Math.round((ils - mhz) * 1000), 50);
      expect(v.get('nav1.stby_mhz')).toBeCloseTo(ils, 2);
      r.events.emit(G1K_EVENTS.navXfer('pfd'));
      r.run(0.2);
      expect(v.get('nav1.active_mhz')).toBeCloseTo(ils, 2);
      const locCrs = Math.round(rw19.ils!.courseTrue - (kict.magVar ?? 0));
      knobTo(r, G1K_EVENTS.hdg('pfd'), () => v.get('ap.sel_hdg_deg'), Math.round(rw01.headingTrue - (kict.magVar ?? 0)), 1, 360);
      knobTo(r, G1K_EVENTS.altOuter('pfd'), () => Math.round(v.get('ap.sel_alt_ft') / 1000), 3, 1);
      knobTo(r, G1K_EVENTS.altInner('pfd'), () => Math.round((v.get('ap.sel_alt_ft') % 1000) / 100), 5, 1);
      expect(v.get('ap.sel_alt_ft')).toBe(3500);
      log(r, `NAV1 ${ils} tuned, ALT 3500, LOC course ${locCrs}`);

      // ================================================================ 4. taxi to runway 01L, run-up
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
      // Before takeoff: run-up 1800 RPM, magneto check (drop <= 150, difference <= 50 RPM).
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
      LOG.push(`run-up ${rpmBoth.toFixed(0)} rpm, mag drop R ${dropR.toFixed(0)} L ${dropL.toFixed(0)}`);
      expect(dropR).toBeGreaterThan(0);
      expect(dropR).toBeLessThan(150);
      expect(dropL).toBeLessThan(150);
      expect(Math.abs(dropR - dropL)).toBeLessThan(50);
      expect(v.get('ac.vac.suction_inhg')).toBeGreaterThan(4.5);
      expect(Math.abs(v.get(C172.trimPosition) - 0.1)).toBeLessThan(0.12); // trim TAKEOFF
      v.set(C172.throttle, 0);
      v.set(C172.land, 1);
      v.set(C172.strobe, 1);
      v.set('xpdr.mode', 3);
      r.run(2);

      // ================================================================ 5. normal takeoff (flaps 0), climb 74 KIAS
      v.set(INPUT.brakeLeft, 0);
      v.set(INPUT.brakeRight, 0);
      v.set(C172.throttle, 1);
      const thr = { lat: rw01.lat, lon: rw01.lon };
      const cross = () => crossTrackNm(thr.lat, thr.lon, far.lat, far.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      let rotT = NaN;
      let liftT = NaN;
      r.run(90, () => {
        const hdgErr = wrap180(rw01.headingTrue - v.get(FDM.headingTrue));
        v.set(INPUT.yaw, Math.max(-1, Math.min(1, 0.08 * hdgErr - 0.03 * cross())));
        if (isNaN(rotT) && v.get('adc1.ias_kt') >= 55) rotT = r.t(); // rotate at 55 KIAS
        if (isNaN(rotT)) {
          v.set(INPUT.pitch, 0);
          yoke.bank(0);
        } else {
          const ias = v.get('adc1.ias_kt');
          yoke.pitch(Math.max(2, Math.min(10, 8 + 0.4 * (ias - 74))));
          yoke.bank(Math.max(-10, Math.min(10, 1.5 * hdgErr)));
        }
        if (isNaN(liftT) && v.get(FDM.onGround) === 0) liftT = r.t();
        return v.get(FDM.altAgl) > 800;
      });
      v.set(INPUT.yaw, 0);
      log(r, '800 ft AGL');
      expect(isNaN(liftT)).toBe(false);
      expect(v.get('fdm.crashed')).toBe(0);
      expect(v.get(FDM.vs)).toBeGreaterThan(400);

      // ================================================================ 6. GFC 700: AP (PIT/ROL), HDG, FLC 75 KIAS, ALTS 3500
      yoke.release();
      key(r, 'ap');
      expect(v.get('ap.engaged')).toBe(1);
      key(r, 'hdg');
      key(r, 'flc');
      // FLC speed reference 75 KIAS: NOSE UP = slower, NOSE DN = faster (1 kt per press).
      for (let i = 0; i < 40 && Math.round(v.get('ap.sel_spd_kt')) !== 75; i++) key(r, v.get('ap.sel_spd_kt') > 75 ? 'nose_up' : 'nose_dn');
      expect(Math.round(v.get('ap.sel_spd_kt'))).toBe(75);
      log(r, 'AP HDG / FLC');
      expect(v.getString('ap.lat_active')).toBe('HDG');
      expect(v.getString('ap.vert_active')).toBe('FLC');
      v.set(C172.land, 0);
      r.run(600, () => v.getString('ap.vert_active') === 'ALT' && Math.abs(v.get(FDM.altMsl) - 3500) < 60);
      log(r, 'level 3500 ALT');
      expect(v.getString('ap.vert_active')).toBe('ALT');
      // Cruise power ~2300 RPM (POH Sec 5 cruise performance), fly north.
      const thr19 = { lat: rw19.lat, lon: rw19.lon };
      r.run(900, () => {
        const e = 2300 - v.get(ENG.rpm(1));
        v.set(C172.throttle, Math.max(0.05, Math.min(1, v.get(C172.throttle) + 0.00001 * e)));
        return distanceNm(v.get(FDM.lat), v.get(FDM.lon), thr19.lat, thr19.lon) > 12 && Math.abs(wrap180(bearingTo(r, thr19.lat, thr19.lon) - rw19.headingTrue)) < 30;
      });
      log(r, '12 nm north of RWY 19R');
      expect(Math.abs(v.get(ENG.rpm(1)) - 2300)).toBeLessThan(80);
      expect(Math.abs(v.get(FDM.altMsl) - 3500)).toBeLessThan(80);

      // ================================================================ 7. intercept: HDG 290, then HDG 170 (30 deg to the LOC)
      const magVar = kict.magVar ?? 0;
      knobTo(r, G1K_EVENTS.hdg('pfd'), () => v.get('ap.sel_hdg_deg'), Math.round(rw19.headingTrue - magVar + 90), 1, 360);
      r.run(150, () => {
        hand.step(90, 0.1, 0.9);
        return Math.abs(wrap180(v.get(FDM.headingMag) - (rw19.headingTrue - magVar + 90))) < 3 && r.t() > 0;
      });
      r.run(40, () => hand.step(90, 0.1, 0.9));
      knobTo(r, G1K_EVENTS.hdg('pfd'), () => v.get('ap.sel_hdg_deg'), Math.round(rw19.headingTrue - magVar - 30), 1, 360);
      // CDI to LOC1 (CDI softkey), course to the localizer (CRS knob), then APR.
      for (let i = 0; i < 3 && v.get(G1K.cdiSource) !== CDI_SOURCE.nav1; i++) {
        r.events.emit(G1K_EVENTS.softkey('pfd', 6));
        r.run(0.2);
      }
      expect(v.get(G1K.cdiSource)).toBe(CDI_SOURCE.nav1);
      knobTo(r, G1K_EVENTS.crs('pfd'), () => v.get('nav1.obs_deg'), locCrs, 1, 360);
      r.run(60, () => {
        hand.step(90, 0.1, 0.9);
        return Math.abs(wrap180(v.get(FDM.headingMag) - (rw19.headingTrue - magVar - 30))) < 3;
      });
      key(r, 'apr');
      log(r, 'APR');
      expect(v.getString('ap.lat_armed') + v.getString('ap.lat_active')).toContain('LOC');
      expect(v.getString('ap.vert_armed')).toContain('GS');

      // ================================================================ 8. coupled approach: LOC, GS; flaps 10 -> 20 -> FULL
      let locT = NaN;
      let gsT = NaN;
      let maxLoc = 0;
      let maxGs = 0;
      let spd = 90;
      const agl = () => v.get(FDM.altMsl) - rw19.elevationFt;
      r.run(900, () => {
        hand.step(spd, 0.1, 0.9);
        const lat = v.getString('ap.lat_active');
        const vert = v.getString('ap.vert_active');
        if (isNaN(locT) && lat.startsWith('LOC')) locT = r.t();
        if (isNaN(gsT) && !isNaN(locT) && v.get('nav1.gs_dev') < 0.6 && v.get(C172.flapLever) < 1) {
          v.set(C172.flapLever, 1); // flaps 10 approaching the glideslope (< 110 KIAS)
          spd = 80;
        }
        if (isNaN(gsT) && vert === 'GS') {
          gsT = r.t();
          v.set(C172.flapLever, 2); // flaps 20 at GS capture (< 85 KIAS)
          spd = 75;
          knobTo(r, G1K_EVENTS.altOuter('pfd'), () => Math.round(v.get('ap.sel_alt_ft') / 1000), 3, 1); // missed approach altitude
        }
        if (!isNaN(gsT) && agl() > 300 && r.t() > gsT + 30) {
          maxLoc = Math.max(maxLoc, Math.abs(v.get('nav1.cdi')));
          maxGs = Math.max(maxGs, Math.abs(v.get('nav1.gs_dev')));
        }
        if (!isNaN(gsT) && agl() < 600 && v.get(C172.flapLever) < 3) {
          v.set(C172.flapLever, 3); // flaps FULL, 65 KIAS
          spd = 66;
        }
        return !isNaN(gsT) && agl() < 200;
      });
      log(r, '200 ft above the runway (DA)');
      LOG.push(`LOC captured ${((locT - 0) / 60).toFixed(1)} min, GS ${((gsT - 0) / 60).toFixed(1)} min, max |LOC| ${maxLoc.toFixed(2)} max |GS| ${maxGs.toFixed(2)} (full scale 1)`);
      expect(isNaN(locT)).toBe(false);
      expect(isNaN(gsT)).toBe(false);
      expect(maxLoc).toBeLessThan(0.5);
      expect(maxGs).toBeLessThan(0.6);
      expect(v.get('surf.flaps_deg')).toBeGreaterThan(25);
      expect(Math.abs(v.get('adc1.ias_kt') - 66)).toBeLessThan(10);

      // ================================================================ 9. A/P TRIM DISC at the DA; hand-flown flare
      v.set(C172G.apDisc, 1);
      r.events.emit('ap.disc');
      r.run(0.3);
      v.set(C172G.apDisc, 0);
      r.events.emit('ap.disc'); // second press silences the disconnect tone
      expect(v.get('ap.engaged')).toBe(0);
      const thetaRef = v.get(FDM.pitch);
      const far19 = destinationPoint(rw19.lat, rw19.lon, rw19.headingTrue, 2);
      const along19 = () => alongTrackNm(rw19.lat, rw19.lon, far19.lat, far19.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      const cross19 = () => crossTrackNm(rw19.lat, rw19.lon, far19.lat, far19.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      let tdVs = NaN;
      let tdIas = NaN;
      let tdFt = NaN;
      r.run(90, () => {
        const h = v.get(FDM.altAgl);
        const vsTgt = h > 30 ? -450 : -Math.max(80, 450 * (h / 30));
        const theta = thetaRef + Math.max(-4, Math.min(8, 0.006 * (vsTgt - v.get(FDM.vs)) + (h < 25 ? 3 * (1 - h / 25) : 0)));
        yoke.pitch(theta);
        yoke.bank(Math.max(-8, Math.min(8, -0.08 * cross19() - 0.8 * wrap180(v.get(FDM.trackTrue) - rw19.headingTrue))));
        if (h > 40) hand.step(65, 0, 0.8);
        else v.set(C172.throttle, 0); // power idle over the threshold
        if (v.get(FDM.onGround) === 1 || v.get('gear.air_ground') === 1) {
          tdVs = v.get(FDM.vs);
          tdIas = v.get('adc1.ias_kt');
          tdFt = along19() / FT;
          return true;
        }
        return false;
      });
      log(r, 'touchdown');
      LOG.push(`touchdown ${tdVs.toFixed(0)} fpm, ${tdIas.toFixed(0)} KIAS, ${tdFt.toFixed(0)} ft past the threshold, ${cross19().toFixed(1)} m off the centre line`);
      expect(v.get('fdm.crashed')).toBe(0);
      expect(tdVs).toBeGreaterThan(-500);
      expect(tdIas).toBeLessThan(70);
      expect(tdFt).toBeGreaterThan(0);
      expect(tdFt).toBeLessThan(3500);
      expect(Math.abs(cross19())).toBeLessThan(12);

      // ================================================================ 10. rollout: brakes, flaps UP, stop
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
      r.run(5);
      log(r, 'stopped');
      LOG.push(`stopped ${(along19() / FT).toFixed(0)} ft past the threshold (runway ${rw19.lengthFt} ft)`);
      expect(v.get(FDM.gs)).toBeLessThan(1.5);
      expect(v.get(ENG.running(1))).toBe(1);
    } finally {
      console.log(LOG.join('\n'));
    }
  });
});
