/** Procedures audit probes, part 2 (read-only auditor): annunciator TEST / flash sampling, KLN 94 readiness. */
import { describe, it } from 'vitest';
import { ANN_SW, C172 } from '../../../../src/aircraft/c172s-common/vars';
import { KAP, KLN, ST } from '../../../../src/aircraft/c172-steam/vars';
import { makeSteamRig } from '../rig';

const log = (k: string, x: unknown): void => console.log(`[PROC2] ${k}: ${JSON.stringify(x)}`);
const L = ['oil_press', 'low_fuel_l', 'low_fuel_r', 'vac_l', 'vac_r', 'volts'];

describe('c172-steam procedures probes 2', () => {
  it('annunciator flash and TEST sampled over time', () => {
    const r = makeSteamRig({ state: 'cold_dark' });
    const v = r.vars;
    r.run(1);
    v.set(C172.masterBat, 1);
    v.set(C172.masterAlt, 1);
    const mx = L.map(() => 0);
    const mn = L.map(() => 1);
    r.run(8, () => void L.forEach((k, i) => { const x = v.get(`ac.c172.lamp.${k}`); mx[i] = Math.max(mx[i], x); mn[i] = Math.min(mn[i], x); }));
    log('first 8 s after MASTER ON max/min', [mx, mn]);
    r.run(6);
    v.set(C172.annSwitch, ANN_SW.test);
    const tmx = L.map(() => 0);
    const tmn = L.map(() => 1);
    let ptMax = 0;
    r.run(3, () => { L.forEach((k, i) => { const x = v.get(`ac.c172.lamp.${k}`); tmx[i] = Math.max(tmx[i], x); tmn[i] = Math.min(tmn[i], x); }); ptMax = Math.max(ptMax, v.get(KAP.pitchTrimLamp)); });
    log('TEST held 3 s max/min, pitch trim lamp max, annTest', [tmx, tmn, ptMax, v.get(ST.annTest)]);
    v.set(C172.annSwitch, ANN_SW.day);
    r.run(1);
    log('released', L.map((k) => v.get(`ac.c172.lamp.${k}`)));
    // NIGHT dim
    v.set(C172.annSwitch, ANN_SW.night);
    r.run(1);
    log('NIGHT', L.map((k) => v.get(`ac.c172.lamp.${k}`)));
  });
  it('KLN 94 turn-on to nav ready without key presses', () => {
    const r = makeSteamRig({ state: 'cold_dark' });
    const v = r.vars;
    v.set(C172.masterBat, 1);
    v.set(C172.masterAlt, 1);
    v.set(C172.avionicsBus1, 1);
    v.set(C172.avionicsBus2, 1);
    v.set(KLN.power, 1);
    let tReady = -1;
    r.run(240, (t) => { if (v.get(KLN.navReady) > 0.5 && tReady < 0) tReady = t; return tReady > 0; });
    log('KLN navReady time (no ENT presses)', tReady);
  });
});
