import { describe, expect, it } from 'vitest';
import type { Airport, Runway } from '../../src/nav/types';
import { buildAirportLayout } from '../../src/world/airports/runwayModel';
import {
  LIGHT_COLORS,
  LightKind,
  approachLights,
  papiAimingAngles,
  papiWhiteCount,
  papiWhiteness,
  runwayLights,
} from '../../src/world/airports/lightLayout';
import { aimingPointGeometry, runwayMarkingLayout, tdzGroupCount, thresholdStripes } from '../../src/world/airports/markings';
import { FT_TO_M } from '../../src/world/geo';

function end(over: Partial<Runway>): Runway {
  return {
    ident: '09',
    oppositeIdent: '27',
    lat: 40,
    lon: -100,
    elevationFt: 1000,
    headingTrue: 90,
    lengthFt: 10000,
    widthFt: 150,
    displacedFt: 0,
    surface: 'asphalt',
    lighted: true,
    ...over,
  };
}

function airport(type: Airport['type'], runways: Runway[]): Airport {
  return { icao: 'KTST', name: 'Test', lat: 40, lon: -99.98, elevationFt: 1000, type, country: 'US', municipality: 'T', runways, frequencies: [] };
}

const east = (ftAlong: number) => -100 + (ftAlong * FT_TO_M) / (111_320 * Math.cos((40 * Math.PI) / 180));
const ils = { ident: 'ITST', freqMhz: 110.3, courseTrue: 90, locLat: 40, locLon: -99.95, gsAngleDeg: 3.0 };

describe('PAPI (AC 150/5340-30J Table 7-2)', () => {
  it('aiming angles for a 3 deg path are 3deg30, 3deg10, 2deg50, 2deg30 from the runway outward', () => {
    const a = papiAimingAngles(3);
    expect(a[0]).toBeCloseTo(3.5, 9);
    expect(a[1]).toBeCloseTo(3 + 10 / 60, 9);
    expect(a[2]).toBeCloseTo(3 - 10 / 60, 9);
    expect(a[3]).toBeCloseTo(2.5, 9);
  });

  it('shows the standard indications', () => {
    expect(papiWhiteCount(3.0, 3)).toBe(2); // on path: 2 white (outer), 2 red (inner)
    expect(papiWhiteCount(2.7, 3)).toBe(1); // slightly low
    expect(papiWhiteCount(2.3, 3)).toBe(0); // low: all red
    expect(papiWhiteCount(3.3, 3)).toBe(3); // slightly high
    expect(papiWhiteCount(3.8, 3)).toBe(4); // high
  });

  it('transitions red to white within a few arc minutes of each aiming angle', () => {
    expect(papiWhiteness(3.5 - 3 / 60, 3.5)).toBe(0);
    expect(papiWhiteness(3.5 + 3 / 60, 3.5)).toBe(1);
    expect(papiWhiteness(3.5, 3.5)).toBeCloseTo(0.5, 9);
  });
});

describe('runway lights (AC 150/5340-30J)', () => {
  const ap = airport('large_airport', [
    end({ ils }),
    end({ ident: '27', oppositeIdent: '09', lon: east(10000), headingTrue: 270, ils: { ...ils, courseTrue: 270 } }),
  ]);
  const layout = buildAirportLayout(ap)!;
  const rw = layout.runways[0];
  const lights = runwayLights(rw);

  it('spaces edge lights at <= 200 ft with yellow caution zones facing each instrument approach', () => {
    const edges = lights.filter((l) => l.kind === LightKind.Steady && Math.abs(Math.abs(l.t) - (rw.widthM / 2 + 10 * FT_TO_M)) < 0.01 && l.h === 0.3);
    const ss = [...new Set(edges.map((l) => +l.s.toFixed(3)))].sort((a, b) => a - b);
    for (let i = 1; i < ss.length; i++) expect(ss[i] - ss[i - 1]).toBeLessThanOrEqual(200 * FT_TO_M + 1e-6);
    // A light 1,000 ft from end B: pilots landing on 09 (looking from -s: the back face) see yellow.
    const nearB = edges.find((l) => rw.lengthM - l.s < 1000 * FT_TO_M && rw.lengthM - l.s > 800 * FT_TO_M)!;
    expect(nearB.back).toEqual(LIGHT_COLORS.yellow);
    expect(nearB.front).toEqual(LIGHT_COLORS.white);
    // Mid-runway lights are white both ways.
    const mid = edges.find((l) => Math.abs(l.s - rw.lengthM / 2) < 40)!;
    expect(mid.front).toEqual(LIGHT_COLORS.white);
    expect(mid.back).toEqual(LIGHT_COLORS.white);
  });

  it('threshold lights are green toward the approach and red toward the runway', () => {
    const thr = lights.filter((l) => l.front === LIGHT_COLORS.green);
    expect(thr.length).toBeGreaterThan(8);
    for (const l of thr) {
      expect(l.back).toEqual(LIGHT_COLORS.red);
      // End A: faces -s (approach side).
      if (l.s < rw.lengthM / 2) expect(l.dirS).toBe(-1);
      else expect(l.dirS).toBe(1);
    }
  });

  it('centreline lights are colour-coded for the last 3,000 ft', () => {
    const cl = lights.filter((l) => l.t === 0 && l.h === 0.05);
    expect(cl.length).toBeGreaterThan(150);
    // Rolling toward B (back face): last 1,000 ft red; 3,000-1,000 alternating; before that white.
    for (const l of cl) {
      const remainingFt = (rw.lengthM - l.s) / FT_TO_M;
      if (remainingFt < 990) expect(l.back).toEqual(LIGHT_COLORS.red);
      if (remainingFt > 3010) expect(l.back).toEqual(LIGHT_COLORS.white);
    }
    const alt = cl.filter((l) => {
      const r = (rw.lengthM - l.s) / FT_TO_M;
      return r > 1100 && r < 2900;
    });
    const reds = alt.filter((l) => l.back === LIGHT_COLORS.red).length;
    expect(Math.abs(reds - alt.length / 2)).toBeLessThanOrEqual(1);
  });

  it('ALSF-2 on the ILS end of a large airport with 15 sequenced flashers twice a second', () => {
    expect(rw.ends[0].approachLights).toBe('ALSF2');
    const als = approachLights(rw, 0);
    const flash = als.filter((l) => l.kind === LightKind.Flash);
    expect(flash.length).toBe(15);
    expect(flash.every((l) => l.period === 0.5)).toBe(true);
    // Outermost flasher fires first (phase 0) and the sequence runs toward the threshold.
    const byPhase = [...flash].sort((a, b) => a.phase - b.phase);
    expect(byPhase[0].s).toBeLessThan(byPhase[byPhase.length - 1].s);
    // 2,400 ft long.
    expect(Math.min(...als.map((l) => l.s))).toBeCloseTo(-2400 * FT_TO_M, 3);
  });

  it('MALSR on an ILS end at a medium airport, nothing at small airports', () => {
    const med = buildAirportLayout(airport('medium_airport', [end({ ils }), end({ ident: '27', oppositeIdent: '09', lon: east(10000), headingTrue: 270 })]))!;
    expect(med.runways[0].ends[0].approachLights).toBe('MALSR');
    const flash = approachLights(med.runways[0], 0).filter((l) => l.kind === LightKind.Flash);
    expect(flash.length).toBe(5);
    const sm = buildAirportLayout(airport('small_airport', [end({ widthFt: 60, lengthFt: 4000 }), end({ ident: '27', oppositeIdent: '09', lon: east(4000), headingTrue: 270, widthFt: 60, lengthFt: 4000 })]))!;
    expect(sm.runways[0].ends[0].approachLights).toBe('NONE');
    expect(approachLights(sm.runways[0], 0).length).toBe(0);
  });

  it('PAPI sits on the left of the landing direction', () => {
    const papi = lights.filter((l) => l.kind === LightKind.Papi);
    expect(papi.length).toBe(8);
    for (const l of papi) {
      // End A lands toward +s: left is -t. End B lands toward -s: left is +t.
      if (l.dirS === -1) expect(l.t).toBeLessThan(0);
      else expect(l.t).toBeGreaterThan(0);
    }
  });
});

describe('markings (AC 150/5340-1M)', () => {
  it('threshold stripe counts follow Table 2-2', () => {
    expect(thresholdStripes(60).perSide * 2).toBe(4);
    expect(thresholdStripes(75).perSide * 2).toBe(6);
    expect(thresholdStripes(100).perSide * 2).toBe(8);
    expect(thresholdStripes(150).perSide * 2).toBe(12);
    expect(thresholdStripes(200).perSide * 2).toBe(16);
    // 125 ft non-standard: 10 stripes (2.5.5 item 3 example).
    expect(thresholdStripes(125).perSide * 2).toBe(10);
  });

  it('aiming point width and spacing by runway width', () => {
    expect(aimingPointGeometry(150)).toEqual({ widthFt: 30, innerHalfFt: 36 });
    const w100 = aimingPointGeometry(100);
    expect(w100.widthFt).toBeCloseTo(20, 9);
    expect(w100.innerHalfFt * 2).toBeCloseTo(48, 9);
    expect(aimingPointGeometry(60).innerHalfFt * 2).toBeCloseTo(28.8, 9);
  });

  it('TDZ groupings follow Tables 2-3 and 2-4', () => {
    expect(tdzGroupCount(8000, true)).toBe(5);
    expect(tdzGroupCount(7500, true)).toBe(4);
    expect(tdzGroupCount(6500, true)).toBe(3);
    expect(tdzGroupCount(5500, true)).toBe(2);
    expect(tdzGroupCount(6100, false)).toBe(5);
    expect(tdzGroupCount(5600, false)).toBe(4);
    expect(tdzGroupCount(4600, false)).toBe(2);
  });

  it('designators are stacked letter-near-threshold and centred', () => {
    const ap = airport('large_airport', [
      end({ ident: '09L', oppositeIdent: '27R', ils }),
      end({ ident: '27R', oppositeIdent: '09L', lon: east(10000), headingTrue: 270 }),
    ]);
    const layout = runwayMarkingLayout(buildAirportLayout(ap)!.runways[0]);
    const g = layout.ends[0].glyphs;
    expect(g.map((x) => x.char)).toEqual(['L', '9']);
    // Letter box starts 40 ft after the 150 ft stripes that start 20 ft from the threshold.
    expect(g[0].s0 + 3).toBeCloseTo(210, 9);
    expect(g[1].s0 + 3).toBeCloseTo(290, 9);
    // A single '9' is centred: its 20 ft glyph spans -10..10 ft.
    expect(g[1].t0 + 2).toBeCloseTo(-10, 9);
    // Centreline starts 40 ft after the numerals and runs in 120/80-ish stripes.
    expect(layout.clStartFt).toBeCloseTo(390, 9);
    expect(layout.clPeriodFt).toBeGreaterThan(190);
    expect(layout.clPeriodFt).toBeLessThan(210);
    expect(layout.clWidthFt).toBe(3); // precision: 36 in
  });
});
