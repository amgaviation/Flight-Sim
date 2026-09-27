/**
 * Map terrain colouring near airports (shared TerrainRaster / MovingMap):
 *
 *  - Garmin G3000/G5000 relative terrain legends (CRG 190-02047-01 Rev A p.99-100, G5000 CRG
 *    190-02538-02 Rev A p.142): on the ground only terrain more than 400 ft above the aircraft is red;
 *    in the air red above -100 ft, yellow -100..-1000 ft, green -1000..-2000 ft, black below. The G1000
 *    TAWS-B default (no green band, no on-ground legend) is unchanged.
 *  - Honeywell EGPWS (MK VI/VIII Pilot Guide 060-4314-000 Rev C p.32): terrain within 400 ft (vertical)
 *    of the nearest runway elevation is not displayed, so a jet taxiing at its departure airport sees a
 *    black map instead of a yellow dot field; MovingMap takes the nearest airport of its nav database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TerrainRaster, terrainBand } from '../../src/avionics/common/draw/TerrainRaster';
import { MovingMap, MAP_GARMIN } from '../../src/avionics/common/draw/MovingMap';
import type { Airport } from '../../src/nav/types';

/** Minimal OffscreenCanvas: the raster only needs createImageData / putImageData. */
class FakeCanvas {
  last: { data: Uint8ClampedArray; width: number; height: number } | null = null;
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(): unknown {
    return {
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: (img: { data: Uint8ClampedArray; width: number; height: number }) => {
        this.last = img;
      },
    };
  }
}

const g = globalThis as unknown as { OffscreenCanvas?: unknown };
let saved: unknown;
beforeAll(() => {
  saved = g.OffscreenCanvas;
  g.OffscreenCanvas = FakeCanvas;
});
afterAll(() => {
  g.OffscreenCanvas = saved;
});

const FT = 0.3048;

/** Colour census of the last raster image: counts of opaque red / yellow / green pixels and transparent ones. */
function census(r: TerrainRaster): { red: number; yellow: number; green: number; clear: number } {
  const img = (r.canvas as unknown as FakeCanvas).last!;
  const out = { red: 0, yellow: 0, green: 0, clear: 0 };
  for (let i = 0; i < img.data.length; i += 4) {
    const [R, G, B, A] = [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
    if (A === 0) out.clear++;
    else if (R > 200 && G > 200) out.yellow++;
    else if (R > 200) out.red++;
    else if (G > B) out.green++;
  }
  return out;
}

function flatRaster(fieldFt: number): TerrainRaster {
  const r = new TerrainRaster({ world: { elevationAt: () => fieldFt * FT }, size: 16, samplesPerUpdate: 10_000 });
  return r;
}

describe('terrain band classification', () => {
  it('Garmin relative: G1000 default, G3000/G5000 in-air green band and on-ground legend', () => {
    // G1000 TAWS-B (unchanged): red above -100, yellow to -1000, black below.
    expect(terrainBand('relative', -1500).band).toBe(0);
    // G3000/G5000 in-air: green -1000..-2000, black below -2000.
    expect(terrainBand('relative', -1500, false, { greenBand: true })).toEqual({ band: 3, density: 1 });
    expect(terrainBand('relative', -2100, false, { greenBand: true }).band).toBe(0);
    expect(terrainBand('relative', -50, false, { greenBand: true }).band).toBe(2);
    // On-ground legend: only terrain more than 400 ft above the aircraft is red.
    expect(terrainBand('relative', 0, false, { onGround: true }).band).toBe(0);
    expect(terrainBand('relative', 350, false, { onGround: true }).band).toBe(0);
    expect(terrainBand('relative', 400, false, { onGround: true }).band).toBe(2); // "400 feet or more" (G1000 NXi PG p.291)
    expect(terrainBand('relative', 450, false, { onGround: true }).band).toBe(2);
    expect(terrainBand('relative', -500, false, { onGround: true }).band).toBe(0);
  });

  it('EGPWS: terrain within 400 ft of the nearest runway elevation is black', () => {
    // Taxiing at a 9 ft field: flat terrain at 50 ft would be low-density yellow without the runway rule.
    expect(terrainBand('egpws', 40)).toEqual({ band: 1, density: 0.25 });
    expect(terrainBand('egpws', 40, false, { elevFt: 50, runwayElevFt: 9 })).toEqual({ band: 0, density: 0 });
    // A 900 ft ridge near the field is still shown.
    expect(terrainBand('egpws', 890, false, { elevFt: 900, runwayElevFt: 9 })).toEqual({ band: 1, density: 0.25 });
  });
});

describe('TerrainRaster near the departure airport', () => {
  it('G3000/G5000: on the ground the relative map stays black; airborne at field elevation it is red', () => {
    const r = flatRaster(1333);
    r.mode = 'relative';
    r.relativeGreenBand = true;
    r.onGround = true;
    r.update(37.65, -97.43, 10, 1340, 15);
    const ground = census(r);
    expect(ground.red + ground.yellow + ground.green).toBe(0);
    // Lifting off (in-air legend) at the same altitude: the field is within 100 ft -> red.
    r.onGround = false;
    r.update(37.65, -97.43, 10, 1340, 15);
    expect(census(r).red).toBeGreaterThan(0);
    // 1,500 ft above the field: green band.
    r.update(37.65, -97.43, 10, 1333 + 1500, 15);
    const c = census(r);
    expect(c.green).toBeGreaterThan(0);
    expect(c.red + c.yellow).toBe(0);
  });

  it('EGPWS: runway blanking removes the yellow dot field around the airport', () => {
    const r = flatRaster(9);
    r.mode = 'egpws';
    r.update(40.85, -74.06, 10, 15, 60);
    expect(census(r).yellow).toBeGreaterThan(0); // no runway known: -500..+1000 low-density yellow
    r.runwayElevFt = 9;
    r.update(40.85, -74.06, 10, 15, 60);
    const c = census(r);
    expect(c.yellow + c.red + c.green).toBe(0);
  });

  it('MovingMap fills the EGPWS nearest-runway elevation from its nav database', () => {
    const apt = (icao: string, lat: number, lon: number, elevationFt: number, type: Airport['type'] = 'medium_airport'): Airport =>
      ({ icao, name: icao, lat, lon, elevationFt, type, country: 'US', municipality: '', runways: type === 'heliport' ? [] : [{}], frequencies: [] }) as unknown as Airport;
    const airports = [apt('FAR', 41.5, -74.5, 1200), apt('KTEB', 40.85, -74.06, 9), apt('HELI', 40.851, -74.061, 300, 'heliport')];
    const nav = { airportsNear: () => airports, navaidsNear: () => [], fixesNear: () => [] };
    const map = new MovingMap({ rect: { x: 0, y: 0, w: 400, h: 400 }, style: MAP_GARMIN, nav, world: { elevationAt: () => 9 * FT }, terrainCells: 16 });
    Object.assign(map.state, { lat: 40.86, lon: -74.07, altFt: 15, terrain: 'egpws' });
    map.update(0.05);
    expect(map.terrain!.runwayElevFt).toBe(9);
    // Other modes do not blank; an explicit elevation overrides the database.
    map.state.runwayElevFt = 500;
    map.update(0.05);
    expect(map.terrain!.runwayElevFt).toBe(500);
    map.state.terrain = 'relative';
    map.update(0.05);
    expect(map.terrain!.runwayElevFt).toBeNaN();
  });
});
