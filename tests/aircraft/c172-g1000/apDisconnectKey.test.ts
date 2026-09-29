/**
 * The simulator's AP-disconnect key / hardware button (INPUT.apDisconnect, default Shift+Z) acts as the
 * pilot's thumb on the yoke disconnect switch in both 172S variants: G1000 A/P TRIM DISC (POH NAV III
 * Fig 7-2 Detail A) and steam KAP 140 A/P DISC / TRIM INT (Supplement 15 Fig 2 item 12).
 */
import { describe, expect, it } from 'vitest';
import { INPUT } from '../../../src/core/vars';
import { C172G } from '../../../src/aircraft/c172-g1000/vars';
import { EV, ST } from '../../../src/aircraft/c172-steam/vars';
import { G1K_EVENTS } from '../../../src/avionics/garmin-g1000/vars';
import { makeG1k } from './helpers';
import { makeSteamRig } from '../c172-steam/rig';

const CRUISE = { altFtMsl: 6000, iasKt: 105 } as const;

describe('AP disconnect key (Shift+Z)', () => {
  it('G1000: disconnects the GFC 700 and holds the trim interrupt while held', () => {
    const r = makeG1k({ state: 'cruise', air: CRUISE });
    r.run(4);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(1);
    expect(r.vars.get('ap.engaged')).toBe(1);
    r.vars.set(INPUT.apDisconnect, 1);
    r.run(0.3);
    expect(r.vars.get('ap.engaged')).toBe(0);
    expect(r.vars.get(C172G.apDisc)).toBe(1);
    expect(r.vars.get(C172G.trimInterrupt)).toBe(1);
    r.vars.set(INPUT.apDisconnect, 0);
    r.run(0.3);
    expect(r.vars.get(C172G.apDisc)).toBe(0);
    expect(r.vars.get(C172G.trimInterrupt)).toBe(0);
  });

  it('steam: disconnects the KAP 140', () => {
    const r = makeSteamRig({ state: 'cruise', air: CRUISE });
    r.run(2);
    r.events.emit(EV.kap('ap'));
    r.run(0.2);
    expect(r.vars.get('ap.engaged')).toBe(1);
    r.vars.set(INPUT.apDisconnect, 1);
    r.run(0.3);
    expect(r.vars.get(ST.apDisc)).toBe(1);
    expect(r.vars.get('ap.engaged')).toBe(0);
    r.vars.set(INPUT.apDisconnect, 0);
    r.run(0.3);
    expect(r.vars.get(ST.apDisc)).toBe(0);
  });
});
