import { describe, it, expect, beforeAll } from 'vitest';
import {
  radioLineOfSightNm,
  vorCdi,
  vorRadial,
  locDeviation,
  locCourseWidthDeg,
  glideslope,
  slantRangeNm,
  inMarkerCone,
  isLocalizerFrequency,
  glidePathAbeamAlongNm,
  glidePathAzimuthDeg,
  FT_PER_NM,
  type VorCdi,
  type LocDeviation,
  type GsSignal,
} from '../../src/nav/radios/geometry';
import { morse } from '../../src/nav/radios/morse';
import { Radios } from '../../src/nav/Radios';
import { NavDatabaseImpl } from '../../src/nav/NavDatabase';
import { createFileLoader } from '../../src/nav/data/nodeLoader';
import { SimVars } from '../../src/core/SimVars';
import { FDM, NAV, GPS } from '../../src/core/vars';
import { destinationPoint, distanceNm, initialBearing } from '../../src/core/geo';

const cdiOut = (): VorCdi => ({ devDeg: 0, cdi: 0, toFrom: 0 });
const locOut = (): LocDeviation => ({ devDeg: 0, offCourseDeg: 0, backCourse: false, distNm: 0 });
const gsOut = (): GsSignal => ({ elevationDeg: 0, dev: 0, devDeg: 0, carrier: 0, azimuthOffDeg: 0, distNm: 0 });

describe('radio geometry', () => {
  it('radio line of sight', () => {
    expect(radioLineOfSightNm(10000, 0)).toBeCloseTo(123, 6);
    expect(radioLineOfSightNm(10000, 100)).toBeCloseTo(123 + 12.3, 6);
    expect(radioLineOfSightNm(-50, 0)).toBe(0);
  });

  it('VOR CDI: FROM side, signs and full-scale 10 deg', () => {
    const o = cdiOut();
    vorCdi(10, 360, o); // outbound on R-360, aircraft on R-010 (right of course) -> fly left
    expect(o.toFrom).toBe(-1);
    expect(o.cdi).toBeCloseTo(-1, 9);
    vorCdi(5, 0, o);
    expect(o.cdi).toBeCloseTo(-0.5, 9);
    vorCdi(355, 0, o);
    expect(o.cdi).toBeCloseTo(0.5, 9);
    vorCdi(40, 0, o); // saturates
    expect(o.cdi).toBe(-1);
  });

  it('VOR CDI: TO side and ambiguity abeam', () => {
    const o = cdiOut();
    // Inbound on course 360: aircraft south of the station on R-190 is west = left of course -> fly right.
    vorCdi(190, 360, o);
    expect(o.toFrom).toBe(1);
    expect(o.cdi).toBeCloseTo(1, 9);
    vorCdi(175, 360, o);
    expect(o.cdi).toBeCloseTo(-0.5, 9);
    vorCdi(89, 0, o);
    expect(o.toFrom).toBe(0);
    vorCdi(91, 0, o);
    expect(o.toFrom).toBe(0);
    vorCdi(80, 0, o);
    expect(o.toFrom).toBe(-1);
  });

  it('radials use the station declination', () => {
    // Aircraft 20 nm true-north of a station with 13 deg W declination: magnetic radial 013.
    const p = destinationPoint(40, -74, 0, 20);
    expect(vorRadial(40, -74, -13, p.lat, p.lon)).toBeCloseTo(13, 6);
    expect(vorRadial(40, -74, 10, p.lat, p.lon)).toBeCloseTo(350, 6);
  });

  it('localizer deviation: front course and back course (reverse sensing)', () => {
    const o = locOut();
    // Course 090 (landing east), antenna at the origin; final approach lies to the west.
    locDeviation(0, 0, 90, 0.01, -0.1, o); // north of centreline = left of course -> fly right
    expect(o.backCourse).toBe(false);
    expect(o.devDeg).toBeGreaterThan(5);
    expect(o.devDeg).toBeLessThan(6.5);
    locDeviation(0, 0, 90, -0.001, -0.1, o);
    expect(o.devDeg).toBeLessThan(0);
    // Beyond the antenna (back course), north of centreline: same front-course sense (+).
    locDeviation(0, 0, 90, 0.001, 0.1, o);
    expect(o.backCourse).toBe(true);
    expect(o.devDeg).toBeGreaterThan(0);
    expect(o.offCourseDeg).toBeLessThan(1);
  });

  it('localizer course width: 700 ft at threshold, 3..6 deg', () => {
    expect(locCourseWidthDeg(10000 / FT_PER_NM)).toBeCloseTo((2 * Math.atan(350 / 10000) * 180) / Math.PI, 6);
    expect(locCourseWidthDeg(0.5)).toBe(6);
    expect(locCourseWidthDeg(5)).toBe(3);
    expect(locCourseWidthDeg(2, 3.28)).toBe(3.28);
  });

  it('glideslope: on path, full scale, curvature, false path, carrier null', () => {
    const o = gsOut();
    const d = 5; // nm west of a GS antenna at the origin, course 090
    const p = destinationPoint(0, 0, 270, d);
    const dFt = d * FT_PER_NM;
    const curvature = (dFt * dFt) / (2 * (4 / 3) * 6371000 * 3.28084);
    const onPath = Math.tan((3 * Math.PI) / 180) * dFt + curvature;
    glideslope(0, 0, 0, 3, 90, p.lat, p.lon, onPath, o);
    expect(Math.abs(o.dev)).toBeLessThan(0.01);
    expect(o.azimuthOffDeg).toBeLessThan(0.01);
    // 0.72 deg (0.24 x theta) below the path is exactly full-scale fly up.
    const low = Math.tan(((3 - 0.72) * Math.PI) / 180) * dFt + curvature;
    glideslope(0, 0, 0, 3, 90, p.lat, p.lon, low, o);
    expect(o.dev).toBeCloseTo(1, 3);
    const high = Math.tan(((3 + 0.36) * Math.PI) / 180) * dFt + curvature;
    glideslope(0, 0, 0, 3, 90, p.lat, p.lon, high, o);
    expect(o.dev).toBeLessThan(-0.45);
    expect(o.dev).toBeGreaterThan(-0.55);
    // Carrier null (flag) near 2 x theta.
    glideslope(0, 0, 0, 3, 90, p.lat, p.lon, Math.tan((6 * Math.PI) / 180) * dFt + curvature, o);
    expect(o.carrier).toBeLessThan(0.05);
    // False glidepath at 3 x theta with reversed sensing: slightly below it the needle says fly DOWN.
    glideslope(0, 0, 0, 3, 90, p.lat, p.lon, Math.tan((8.7 * Math.PI) / 180) * dFt + curvature, o);
    expect(o.dev).toBeLessThan(0);
    expect(o.carrier).toBeGreaterThan(0.5);
  });

  it('DME slant range', () => {
    expect(slantRangeNm(40, -74, 6076.12, 40, -74, 0)).toBeCloseTo(1, 6);
    const p = destinationPoint(40, -74, 45, 3);
    expect(slantRangeNm(p.lat, p.lon, 4 * 6076.12, 40, -74, 0)).toBeCloseTo(5, 3);
  });

  it('marker beacon ellipse', () => {
    expect(inMarkerCone(0, 0, 0, 90, 0, 0, 1000)).toBe(true);
    const along = destinationPoint(0, 0, 90, 2000 / FT_PER_NM);
    expect(inMarkerCone(0, 0, 0, 90, along.lat, along.lon, 1000)).toBe(true);
    const across = destinationPoint(0, 0, 0, 1500 / FT_PER_NM);
    expect(inMarkerCone(0, 0, 0, 90, across.lat, across.lon, 1000)).toBe(false);
    expect(inMarkerCone(0, 0, 0, 90, across.lat, across.lon, 1000, 1.6)).toBe(true);
    expect(inMarkerCone(0, 0, 0, 90, 0, 0, -10)).toBe(false);
  });

  it('glide path coverage azimuth is measured about the centre line, not from the offset GS antenna', () => {
    // LOC antenna at the origin, course 090 (approach from the west); GS antenna 1.6 nm west, 450 ft south.
    const course = 90;
    const gs = destinationPoint(0, 0, 270, 1.6);
    const gsOff = destinationPoint(gs.lat, gs.lon, 180, 450 / FT_PER_NM);
    const abeam = glidePathAbeamAlongNm(0, 0, course, gsOff.lat, gsOff.lon);
    expect(abeam).toBeCloseTo(1.6, 3);
    // On the centre line 0.1 nm before the abeam point (~30 ft on a 3 deg path): 0 deg off the centre line.
    const loc = locOut();
    const p = destinationPoint(0, 0, 270, 1.7);
    locDeviation(0, 0, course, p.lat, p.lon, loc);
    expect(glidePathAzimuthDeg(loc.devDeg, loc.distNm, abeam)).toBeLessThan(0.01);
    // Seen from the antenna itself the same point is ~37 deg off (the old coverage test flagged it).
    const o = gsOut();
    glideslope(gsOff.lat, gsOff.lon, 0, 3, course, p.lat, p.lon, 30, o);
    expect(o.azimuthOffDeg).toBeGreaterThan(30);
    // 8 deg sector: 0.5 nm before the abeam point, 0.07 nm (7.97 deg) vs 0.071 nm (8.1 deg) beside the course.
    expect(glidePathAzimuthDeg(Math.atan2(0.07, 2.1) * (180 / Math.PI), Math.hypot(0.07, 2.1), 1.6)).toBeLessThan(8);
    expect(glidePathAzimuthDeg(Math.atan2(0.071, 2.1) * (180 / Math.PI), Math.hypot(0.071, 2.1), 1.6)).toBeGreaterThan(8);
    // Past the abeam point (over the runway) there is no coverage.
    expect(glidePathAzimuthDeg(0, 1.5, 1.6)).toBe(180);
  });

  it('ILS channel detection and morse idents', () => {
    expect(isLocalizerFrequency(110.9)).toBe(true);
    expect(isLocalizerFrequency(108.15)).toBe(true);
    expect(isLocalizerFrequency(110.2)).toBe(false);
    expect(isLocalizerFrequency(112.1)).toBe(false);
    expect(morse('SAX')).toBe('... .- -..-');
    expect(morse('ITEB')).toBe('.. - . -...');
  });
});

describe('Radios subsystem with the real database', () => {
  const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
  beforeAll(async () => {
    await db.load();
  }, 60000);

  function setup() {
    const vars = new SimVars();
    const radios = new Radios({ vars, nav: db }, { navCount: 2, adfCount: 1 });
    return { vars, radios };
  }
  const run = (radios: Radios, seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) radios.update(0.05);
  };

  it('ILS: localizer centred, glideslope captured, DME slant range', () => {
    const { vars, radios } = setup();
    const rw = db.runway('KJFK', '04L')!;
    const ils = rw.ils!;
    // 6 nm from the localizer antenna on the approach side, on the extended course.
    const p = destinationPoint(ils.locLat, ils.locLon, ils.courseTrue + 180, 6);
    const dGs = distanceNm(ils.gsLat!, ils.gsLon!, p.lat, p.lon) * 6076.12;
    const alt = (ils.gsElevFt ?? 13) + Math.tan((ils.gsAngleDeg! * Math.PI) / 180) * dGs + (dGs * dGs) / (2 * (4 / 3) * 6371000 * 3.28084);
    vars.set(FDM.lat, p.lat);
    vars.set(FDM.lon, p.lon);
    vars.set(FDM.altMsl, alt);
    vars.set(NAV.powered(1), 1);
    vars.set(NAV.activeFreq(1), ils.freqMhz);
    radios.update(0.05);
    expect(vars.get(NAV.received(1))).toBe(0); // settling right after tuning
    run(radios, 2);
    expect(vars.get(NAV.received(1))).toBe(1);
    expect(vars.get(NAV.isLoc(1))).toBe(1);
    expect(vars.getString(NAV.ident(1))).toBe(ils.ident);
    expect(Math.abs(vars.get(NAV.cdi(1)))).toBeLessThan(0.05);
    expect(vars.get(NAV.gsValid(1))).toBe(1);
    expect(Math.abs(vars.get(NAV.gsDev(1)))).toBeLessThan(0.1);
    expect(vars.get(NAV.dmeValid(1))).toBe(1);
    const dme = vars.get(NAV.dmeNm(1));
    const expected = distanceNm(ils.dmeLat!, ils.dmeLon!, p.lat, p.lon);
    expect(dme).toBeGreaterThan(expected);
    expect(dme).toBeLessThan(expected + 0.1);
    expect(vars.get(NAV.bearingValid(1))).toBe(0);
    // Move 0.3 deg right of the course (seen from the approach): needle left (fly left).
    const q = destinationPoint(ils.locLat, ils.locLon, ils.courseTrue + 180 - 0.5, 6);
    vars.set(FDM.lat, q.lat);
    vars.set(FDM.lon, q.lon);
    run(radios, 0.2);
    expect(vars.get(NAV.cdi(1))).toBeLessThan(-0.2);
    // Power off -> flags.
    vars.set(NAV.powered(1), 0);
    run(radios, 0.1);
    expect(vars.get(NAV.received(1))).toBe(0);
    expect(vars.get(NAV.gsValid(1))).toBe(0);
    expect(vars.getString(NAV.ident(1))).toBe('');
  });

  it('VOR: radial, RMI bearing, CDI, DME, out-of-range flag, DME hold', () => {
    const { vars, radios } = setup();
    const vor = db.navaidsByIdent('SAX').find((n) => n.type === 'VORTAC' || n.type === 'VORDME')!;
    const p = destinationPoint(vor.lat, vor.lon, 90, 20); // 20 nm true east
    vars.set(FDM.lat, p.lat);
    vars.set(FDM.lon, p.lon);
    vars.set(FDM.altMsl, 6000);
    vars.set(NAV.powered(2), 1);
    vars.set(NAV.activeFreq(2), vor.freq);
    const radial = vorRadial(vor.lat, vor.lon, vor.magVar, p.lat, p.lon);
    vars.set(NAV.obs(2), radial + 5); // aircraft 5 deg counter-clockwise of the selected radial (FROM) -> fly right
    run(radios, 2);
    expect(vars.get(NAV.received(2))).toBe(1);
    expect(vars.get(NAV.radial(2))).toBeCloseTo(radial, 3);
    expect(vars.get(NAV.bearing(2))).toBeCloseTo((radial + 180) % 360, 3);
    expect(vars.get(NAV.toFrom(2))).toBe(-1);
    expect(vars.get(NAV.cdi(2))).toBeCloseTo(0.5, 3);
    expect(vars.get(NAV.dmeValid(2))).toBe(1);
    expect(vars.get(NAV.dmeNm(2))).toBeCloseTo(Math.hypot(20, (6000 - vor.elevationFt) / 6076.12), 1);
    // DME hold keeps the SAX DME after retuning.
    vars.set(NAV.dmeHold(2), 1);
    vars.set(NAV.activeFreq(2), 117.95);
    run(radios, 2);
    expect(vars.get(NAV.dmeValid(2))).toBe(1);
    expect(vars.getString(NAV.dmeIdent(2))).toBe(vor.ident);
    vars.set(NAV.dmeHold(2), 0);
    vars.set(NAV.activeFreq(2), vor.freq);
    // Far outside the service volume at low altitude: flag.
    const far = destinationPoint(vor.lat, vor.lon, 90, 150);
    vars.set(FDM.lat, far.lat);
    vars.set(FDM.lon, far.lon);
    vars.set(FDM.altMsl, 3000);
    run(radios, 6);
    expect(vars.get(NAV.received(2))).toBe(0);
  });

  it('VOR cone of confusion flags the azimuth but keeps DME', () => {
    const { vars, radios } = setup();
    const vor = db.navaidsByIdent('SAX').find((n) => n.type === 'VORTAC' || n.type === 'VORDME')!;
    const p = destinationPoint(vor.lat, vor.lon, 45, 0.3);
    vars.set(FDM.lat, p.lat);
    vars.set(FDM.lon, p.lon);
    vars.set(FDM.altMsl, vor.elevationFt + 10000);
    vars.set(NAV.powered(1), 1);
    vars.set(NAV.activeFreq(1), vor.freq);
    run(radios, 2);
    expect(vars.get(NAV.received(1))).toBe(0);
    expect(vars.get(NAV.toFrom(1))).toBe(0);
    expect(vars.get(NAV.dmeValid(1))).toBe(1);
  });

  it('ADF relative bearing from FDM heading', () => {
    const { vars, radios } = setup();
    const ndb = db.navaidsNear(40.8, -74.1, 80, ['NDB'])[0];
    expect(ndb).toBeDefined();
    const p = destinationPoint(ndb.lat, ndb.lon, 180, 5); // 5 nm south of the NDB
    vars.set(FDM.lat, p.lat);
    vars.set(FDM.lon, p.lon);
    vars.set(FDM.altMsl, 3000);
    vars.set(FDM.headingTrue, 90);
    vars.set(NAV.adfPowered(1), 1);
    vars.set(NAV.adfActive(1), ndb.freq);
    run(radios, 2);
    expect(vars.get(NAV.adfValid(1))).toBe(1);
    const brg = initialBearing(p.lat, p.lon, ndb.lat, ndb.lon);
    expect(vars.get(NAV.adfBearing(1))).toBeCloseTo((brg - 90 + 360) % 360, 3);
    expect(vars.getString(NAV.adfIdent(1))).toBe(ndb.ident);
    vars.set(NAV.adfMode(1), 0); // ANT: needle parks at 90
    run(radios, 0.1);
    expect(vars.get(NAV.adfValid(1))).toBe(0);
    expect(vars.get(NAV.adfBearing(1))).toBe(90);
  });

  it('marker beacons light over the outer marker', () => {
    const { vars, radios } = setup();
    const om = db.navaidsNear(40.69, -73.87, 2, ['OM'])[0];
    expect(om).toBeDefined();
    vars.set(FDM.lat, om.lat);
    vars.set(FDM.lon, om.lon);
    vars.set(FDM.altMsl, om.elevationFt + 1500);
    vars.set(NAV.markerPowered, 1);
    run(radios, 0.2);
    expect(vars.get(NAV.markerOuter)).toBe(1);
    expect(vars.get(NAV.markerMiddle)).toBe(0);
    const away = destinationPoint(om.lat, om.lon, (om.courseTrue ?? 0) + 90, 1);
    vars.set(FDM.lat, away.lat);
    vars.set(FDM.lon, away.lon);
    run(radios, 0.2);
    expect(vars.get(NAV.markerOuter)).toBe(0);
  });

  /** Point `dNm` before the GS abeam point on the extended centre line, on the glide path (ft MSL). */
  function onFinal(icao: string, rwy: string, dNm: number) {
    const ils = db.runway(icao, rwy)!.ils!;
    const abeam = glidePathAbeamAlongNm(ils.locLat, ils.locLon, ils.courseTrue, ils.gsLat!, ils.gsLon!);
    const p = destinationPoint(ils.locLat, ils.locLon, ils.courseTrue + 180, abeam + dNm);
    const dGs = distanceNm(ils.gsLat!, ils.gsLon!, p.lat, p.lon) * FT_PER_NM;
    const alt = (ils.gsElevFt ?? 0) + Math.tan(((ils.gsAngleDeg ?? 3) * Math.PI) / 180) * dGs;
    return { ils, lat: p.lat, lon: p.lon, alt };
  }

  it.each([
    ['KSFO', '28R'],
    ['EGLL', '27L'],
    ['KDEN', '16R'],
  ])('%s %s: glideslope stays valid on the centre line down to ~50 ft (antenna 400-480 ft beside the runway)', (icao, rwy) => {
    const { vars, radios } = setup();
    vars.set(NAV.powered(1), 1);
    const f0 = onFinal(icao, rwy, 3);
    vars.set(NAV.activeFreq(1), f0.ils.freqMhz);
    vars.set(FDM.lat, f0.lat);
    vars.set(FDM.lon, f0.lon);
    vars.set(FDM.altMsl, f0.alt);
    run(radios, 2);
    for (const d of [2, 1, 0.5, 0.3, 0.2, 0.15]) {
      const f = onFinal(icao, rwy, d);
      vars.set(FDM.lat, f.lat);
      vars.set(FDM.lon, f.lon);
      vars.set(FDM.altMsl, f.alt);
      run(radios, 0.2);
      expect(vars.get(NAV.gsValid(1)), `${d} nm (${Math.round(f.alt - (f.ils.gsElevFt ?? 0))} ft)`).toBe(1);
      expect(Math.abs(vars.get(NAV.gsDev(1)))).toBeLessThan(0.15);
    }
  });

  it.each([
    ['KJFK', '04R', '22R'], // IJFK / IJOC both 109.50
    ['EGLL', '27L', '09R'], // ILL / IBB both 109.50, same runway
    ['KDEN', '16R', '34L'], // IDQQ / IDXU both 111.90, same runway
  ])('%s %s: stays on the front-course localizer, never the same-frequency %s localizer (AIM 1-1-9 interlock)', (icao, rwy, other) => {
    const { vars, radios } = setup();
    const opp = db.runway(icao, other)!.ils!;
    vars.set(NAV.powered(1), 1);
    const first = onFinal(icao, rwy, 10);
    expect(opp.freqMhz).toBe(first.ils.freqMhz);
    vars.set(NAV.activeFreq(1), first.ils.freqMhz);
    for (const d of [10, 6, 3, 2, 1, 0.6, 0.3, 0.1]) {
      const f = onFinal(icao, rwy, d);
      vars.set(FDM.lat, f.lat);
      vars.set(FDM.lon, f.lon);
      vars.set(FDM.altMsl, f.alt);
      run(radios, d === 10 ? 2 : 0.5);
      expect(vars.getString(NAV.ident(1)), `${d} nm`).toBe(f.ils.ident);
      expect(Math.abs(vars.get(NAV.cdi(1)))).toBeLessThan(0.05);
    }
    // A cold tune on short final (no hysteresis to help) also picks the front course.
    const { vars: v2, radios: r2 } = setup();
    const f = onFinal(icao, rwy, 0.3);
    v2.set(NAV.powered(1), 1);
    v2.set(FDM.lat, f.lat);
    v2.set(FDM.lon, f.lon);
    v2.set(FDM.altMsl, f.alt);
    v2.set(NAV.activeFreq(1), f.ils.freqMhz);
    run(r2, 2);
    expect(v2.getString(NAV.ident(1))).toBe(f.ils.ident);
    // The station declination the course is referenced to is published for the autopilot.
    // true course = magnetic loc course + station declination
    const mv = v2.get(NAV.stationMagVar(1));
    expect(Math.abs(mv)).toBeLessThan(30);
    const d = (((f.ils.courseTrue - v2.get(NAV.locCourse(1)) - mv) % 360) + 540) % 360 - 180;
    expect(Math.abs(d)).toBeLessThan(1e-6);
  });

  it('GPS acquires after the power-up delay', () => {
    const { vars, radios } = setup();
    vars.set(FDM.lat, 40);
    vars.set(FDM.lon, -74);
    vars.set(FDM.gs, 120);
    vars.set(FDM.trackTrue, 45);
    vars.set(GPS.powered, 1);
    run(radios, 10);
    expect(vars.get(GPS.valid)).toBe(0);
    expect(vars.get(GPS.acquireS)).toBeGreaterThan(30);
    run(radios, 40);
    expect(vars.get(GPS.valid)).toBe(1);
    expect(vars.get(GPS.lat)).toBe(40);
    expect(vars.get(GPS.trackTrue)).toBe(45);
    expect(vars.get(GPS.magVar)).toBeLessThan(-10);
    expect(vars.get(GPS.trackMag)).toBeGreaterThan(55);
    vars.set(GPS.fail, 1);
    run(radios, 0.1);
    expect(vars.get(GPS.valid)).toBe(0);
  });
});
