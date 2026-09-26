import { it } from 'vitest';
import { Atmosphere, createAirState, pressureAltitude } from '../../src/physics/atmosphere';
import { seaLevelTemperature } from '../../src/ui/weather/weather';
it('x', () => {
  for (const [elev, t] of [[5434, 35], [5434, -20], [0, 35], [8000, 25]]) {
    const qnh = 30.10;
    const a = new Atmosphere(qnh, seaLevelTemperature(t, elev));
    const s = a.sample(elev * 0.3048, createAirState());
    const ind = (s.pressureAltitude_m - pressureAltitude(qnh * 3386.389)) / 0.3048;
    console.log(elev, t, 'indicated on ground', ind.toFixed(0), 'err', (ind - elev).toFixed(0));
  }
});
