import { describe, expect, it } from 'vitest';
import { humidRegionWeight } from '../../src/world/terrain/biome';

// The terrain shader's subtropical "arid belt" (10-40 deg) painted Savannah and Atlanta as desert in the
// jets QA screenshots; humid eastern margins now cancel it (Koppen Cfa/Cwa, Beck et al. 2018).
describe('humidRegionWeight', () => {
  it('is 1 over humid subtropical airports', () => {
    for (const [lat, lon] of [
      [32.13, -81.2], // KSAV
      [33.64, -84.43], // KATL
      [29.98, -95.34], // KIAH
      [22.31, 113.91], // VHHH
      [-33.95, 151.18], // YSSY
      [-23.43, -46.47], // SBGR
    ])
      expect(humidRegionWeight(lat, lon)).toBe(1);
  });
  it('is 0 over deserts and Mediterranean climates', () => {
    for (const [lat, lon] of [
      [33.94, -118.41], // KLAX
      [36.08, -115.15], // KLAS
      [25.25, 55.36], // OMDB
      [30.12, 31.41], // HECA
      [-31.94, 115.97], // YPPH
    ])
      expect(humidRegionWeight(lat, lon)).toBe(0);
  });
  it('fades over about 3 degrees', () => {
    const w = humidRegionWeight(32, -99.5); // 1.5 deg west of the SE US box
    expect(w).toBeGreaterThan(0.4);
    expect(w).toBeLessThan(0.7);
  });
});
