import { describe, expect, it } from 'vitest';
import {
  A0,
  Atmosphere,
  DrydenTurbulence,
  P0,
  RHO0,
  WindModel,
  casFromMach,
  casFromTas,
  createAirState,
  createTurbulenceSample,
  densityAltitude,
  geometricToGeopotential,
  highAltitudeSigmaFps,
  impactPressureFromCas,
  isaDensity,
  isaPressure,
  isaTemperature,
  machFromCas,
  pressureAltitude,
  tasFromCas,
  totalTemperature,
  windFromVector,
} from '../../src/physics/atmosphere';
import { FT_TO_M, INHG_TO_PA, KT_TO_MS, MS_TO_KT } from '../../src/core/units';
import { Vec3 } from '../../src/core/linalg';

describe('ISA 1976 spot values (USSA-1976 Table 1, geopotential altitude)', () => {
  const cases: [number, number, number, number][] = [
    // H (m), T (K), p (Pa), rho (kg/m^3)
    [0, 288.15, 101325, 1.225],
    [1000, 281.65, 89874.6, 1.11164],
    [5000, 255.65, 54019.9, 0.736116],
    [11000, 216.65, 22632.1, 0.363918],
    [20000, 216.65, 5474.89, 0.0880349],
    [32000, 228.65, 868.019, 0.013225],
    [47000, 270.65, 110.906, 0.00142753],
  ];
  it.each(cases)('H=%d m', (H, T, p, rho) => {
    expect(isaTemperature(H)).toBeCloseTo(T, 2);
    expect(isaPressure(H) / p).toBeCloseTo(1, 4);
    expect(isaDensity(H) / rho).toBeCloseTo(1, 4);
  });

  it('standard altimetry table (inHg vs pressure altitude)', () => {
    // FAA-H-8083-25 standard atmosphere table: 5,000 ft 24.89, 10,000 ft 20.58, 18,000 ft 14.94, 30,000 ft 8.88 inHg
    const table: [number, number][] = [
      [5000, 24.89],
      [10000, 20.58],
      [18000, 14.94],
      [30000, 8.88],
    ];
    for (const [ft, inhg] of table) expect(isaPressure(ft * FT_TO_M) / INHG_TO_PA).toBeCloseTo(inhg, 1);
    expect(pressureAltitude(isaPressure(12345))).toBeCloseTo(12345, 6);
    expect(pressureAltitude(isaPressure(40000))).toBeCloseTo(40000, 5);
    expect(densityAltitude(isaDensity(3000))).toBeCloseTo(3000, 4);
    expect(densityAltitude(isaDensity(15000))).toBeCloseTo(15000, 3);
  });
});

describe('non-standard atmosphere', () => {
  it('standard day reproduces ISA at geometric altitude', () => {
    const atm = new Atmosphere(29.92126, 15);
    const s = atm.sample(3048, createAirState());
    expect(s.pressureAltitude_m).toBeCloseTo(geometricToGeopotential(3048), 1);
    expect(s.isaDeviation_K).toBeCloseTo(0, 3);
  });

  it('QNH shifts pressure altitude (1 inHg ~ 1000 ft near sea level)', () => {
    const atm = new Atmosphere(30.92, 15);
    const s = atm.sample(0, createAirState());
    expect(s.pressure_Pa).toBeCloseTo(30.92 * INHG_TO_PA, 3);
    expect(s.pressureAltitude_m / FT_TO_M).toBeGreaterThan(-1000);
    expect(s.pressureAltitude_m / FT_TO_M).toBeLessThan(-900);
  });

  it('warm day: true altitude above indicated (ISA+20: ~+4% of height above station)', () => {
    const atm = new Atmosphere(29.92126, 35);
    const trueAlt = atm.trueAltitudeForIndicated(10000, 29.92126) / FT_TO_M;
    // ICAO rule of thumb: 4% per 10 degC -> +8% of 10,000 ft = ~800 ft (exact integral gives ~740 ft)
    expect(trueAlt).toBeGreaterThan(10600);
    expect(trueAlt).toBeLessThan(10900);
    const s = atm.sample(0, createAirState());
    expect(s.temperature_K - 273.15).toBeCloseTo(35, 6);
    expect(s.densityAltitude_m / FT_TO_M).toBeGreaterThan(2000); // hot day density altitude at SL
  });
});

describe('QNH altimetry anchored at the reporting station', () => {
  // An altimeter set to QNH must read field elevation on the ground whatever the
  // temperature (QNH definition; FAA-H-8083-15B ch. 5: within 75 ft of field elevation).
  const indicatedFt = (atm: Atmosphere, altM: number, baroInHg: number): number =>
    (atm.sample(altM, createAirState()).pressureAltitude_m - pressureAltitude(baroInHg * INHG_TO_PA)) / FT_TO_M;
  const slTemp = (stationC: number, elevFt: number): number => stationC + 0.0019812 * elevFt;

  it.each([
    ['Denver hot', 5434, 35, 30.1],
    ['Denver cold', 5434, -25, 30.45],
    ['Leadville ISA+20', 9934, 13, 30.02],
    ['sea level hot', 0, 38, 29.8],
  ] as const)('%s: altimeter reads field elevation on the ground, station temperature exact', (_n, elevFt, stationC, qnh) => {
    const atm = new Atmosphere(qnh, slTemp(stationC, elevFt), elevFt);
    const fieldM = elevFt * FT_TO_M;
    // Residual = geometric vs geopotential height (h^2 / R: 4.7 ft at 10,000 ft), far inside the 75 ft check.
    const geopotentialFt = (elevFt * elevFt * FT_TO_M) / 6356766;
    expect(Math.abs(indicatedFt(atm, fieldM, qnh) - elevFt)).toBeLessThan(1 + geopotentialFt);
    expect(atm.sample(fieldM, createAirState()).temperature_K - 273.15).toBeCloseTo(stationC, 1);
  });

  it('temperature error grows with height above the station (ICAO: ~4 % per 10 degC of height above the source)', () => {
    const elevFt = 5434;
    const atm = new Atmosphere(30.1, slTemp(-15.8, elevFt), elevFt); // ISA-20 at the field
    // 3000 ft above the field indicated: the aircraft is lower than indicated by roughly 8 % of 3000 ft.
    const trueAboveField = atm.trueAltitudeForIndicated(elevFt + 3000, 30.1) / FT_TO_M - elevFt;
    expect(trueAboveField).toBeGreaterThan(3000 * 0.9);
    expect(trueAboveField).toBeLessThan(3000 * 0.95);
  });

  it('a sea-level reference reproduces the previous MSL-anchored model', () => {
    const a = new Atmosphere(29.5, 30);
    const b = new Atmosphere(29.5, 30, 0);
    expect(a.sample(3000, createAirState()).pressure_Pa).toBe(b.sample(3000, createAirState()).pressure_Pa);
    expect(indicatedFt(a, 0, 29.5)).toBeCloseTo(0, 3);
  });
});

describe('airspeed relations', () => {
  it('CAS == TAS at sea level ISA; round trips at altitude', () => {
    for (const kt of [60, 150, 350, 600, 800]) {
      const v = kt * KT_TO_MS;
      expect(tasFromCas(v, P0, 288.15)).toBeCloseTo(v, 6);
      const p = isaPressure(10000);
      const T = isaTemperature(10000);
      expect(casFromTas(tasFromCas(v, p, T), p, T)).toBeCloseTo(v, 6);
    }
  });

  it('M0.80 at FL350 is ~272 KCAS; 250 KCAS at 10,000 ft is ~288 KTAS', () => {
    const p = isaPressure(35000 * FT_TO_M);
    expect(casFromMach(0.8, p) * MS_TO_KT).toBeCloseTo(271.9, 0);
    expect(machFromCas(271.9 * KT_TO_MS, p)).toBeCloseTo(0.8, 3);
    const H = 10000 * FT_TO_M;
    const tas = tasFromCas(250 * KT_TO_MS, isaPressure(H), isaTemperature(H)) * MS_TO_KT;
    expect(tas).toBeGreaterThan(286);
    expect(tas).toBeLessThan(290);
  });

  it('supersonic Rayleigh branch is continuous at M1 and invertible', () => {
    expect(impactPressureFromCas(A0 * 0.9999)).toBeCloseTo(impactPressureFromCas(A0 * 1.0001), -2);
    const p = isaPressure(12000);
    expect(machFromCas(casFromMach(1.6, p), p)).toBeCloseTo(1.6, 6);
  });

  it('total air temperature', () => {
    expect(totalTemperature(216.65, 0.8)).toBeCloseTo(216.65 * 1.128, 6);
    expect(totalTemperature(216.65, 0.8, 0.98)).toBeLessThan(totalTemperature(216.65, 0.8));
  });

  it('RHO0 is 1.225', () => {
    expect(RHO0).toBeCloseTo(1.225, 4);
  });
});

describe('wind model', () => {
  it('10 m wind equals the reported surface wind; shear below, veer/gradient above', () => {
    const w = new WindModel();
    w.setSurfaceWind(270, 20);
    const v = new Vec3();
    const o = { dir: 0, kt: 0 };
    w.steadyWind(110, 10, 45, v);
    windFromVector(v.x, v.y, o);
    expect(o.dir).toBeCloseTo(270, 6);
    expect(o.kt).toBeCloseTo(20, 6);
    w.steadyWind(102, 2, 45, v);
    expect(windFromVector(v.x, v.y, o).kt).toBeLessThan(15);
    w.steadyWind(100 + 900, 900, 45, v);
    windFromVector(v.x, v.y, o);
    expect(o.kt).toBeCloseTo(30, 6); // x1.5 gradient
    expect(o.dir).toBeCloseTo(290, 6); // veered 20 deg (NH)
  });

  it('winds aloft layers interpolate and blend through the boundary layer', () => {
    const w = new WindModel();
    w.setSurfaceWind(180, 10);
    w.setWindsAloft([
      { altitudeFt: 12000, directionDeg: 270, speedKt: 60 },
      { altitudeFt: 6000, directionDeg: 270, speedKt: 40 },
    ]);
    const v = new Vec3();
    const o = { dir: 0, kt: 0 };
    windFromVector(...(w.steadyWind(9000 * FT_TO_M, 8000 * FT_TO_M, 45, v), [v.x, v.y] as [number, number]), o);
    expect(o.dir).toBeCloseTo(270, 6);
    expect(o.kt).toBeCloseTo(50, 6);
  });

  it('gusts are deterministic and bounded', () => {
    const a = new WindModel(7);
    const b = new WindModel(7);
    a.setSurfaceWind(360, 15, 10);
    b.setSurfaceWind(360, 15, 10);
    const va = new Vec3();
    const vb = new Vec3();
    let maxG = 0;
    for (let i = 0; i < 12000; i++) {
      va.set(0, 0, 0);
      vb.set(0, 0, 0);
      a.applyGust(1 / 120, 50, va);
      b.applyGust(1 / 120, 50, vb);
      expect(va.x).toBe(vb.x);
      maxG = Math.max(maxG, a.gustValue);
    }
    expect(maxG).toBeGreaterThan(5 * KT_TO_MS);
    expect(maxG).toBeLessThanOrEqual(10 * KT_TO_MS + 1e-9);
  });
});

describe('Dryden turbulence', () => {
  it('is zero when disabled and deterministic per seed', () => {
    const d1 = new DrydenTurbulence(99);
    const d2 = new DrydenTurbulence(99);
    const s1 = createTurbulenceSample();
    const s2 = createTurbulenceSample();
    d1.step(1 / 120, 100, 3000, 0, 15, s1);
    expect(s1.u).toBe(0);
    for (let i = 0; i < 1000; i++) {
      d1.step(1 / 120, 100, 3000, 0.66, 15, s1);
      d2.step(1 / 120, 100, 3000, 0.66, 15, s2);
    }
    expect(s1.w).toBe(s2.w);
    expect(s1.p).toBe(s2.p);
  });

  it('RMS intensities match MIL-F-8785C (moderate, 10,000 ft) within 15%', () => {
    const d = new DrydenTurbulence(1);
    const s = createTurbulenceSample();
    const n = 120 * 1200;
    let su = 0;
    let sv = 0;
    let sw = 0;
    const alt = 10000 * FT_TO_M;
    for (let i = 0; i < n; i++) {
      d.step(1 / 120, 150, alt, 2 / 3, 15, s);
      su += s.u * s.u;
      sv += s.v * s.v;
      sw += s.w * s.w;
    }
    const expected = highAltitudeSigmaFps(10000, 2 / 3) * FT_TO_M;
    expect(expected).toBeGreaterThan(2.5);
    for (const ms of [su, sv, sw]) {
      const rms = Math.sqrt(ms / n);
      expect(rms / expected).toBeGreaterThan(0.85);
      expect(rms / expected).toBeLessThan(1.15);
    }
  });
});
