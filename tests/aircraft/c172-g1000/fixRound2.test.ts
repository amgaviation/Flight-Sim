/**
 * Cessna 172S G1000 NXi: audit fix round 2.
 *
 * N1: USP (Underspeed Protection) is an in-flight protection (NXi PG 190-02177-02 §7.5, like ESP
 * §8.11: in flight = GPS ground speed > 30 kt or TAS > 50 kt). During the POH autopilot preflight
 * check on the ground (172SPHBUS-02 Before Takeoff items 13-15: engage the AP, overpower it,
 * disconnect it with A/P TRIM DISC) the real airplane shows no MINSPD / USP ACTIVE, gives no
 * "AIRSPEED" aural and does not step the pitch reference nose down.
 */
import { describe, expect, it } from 'vitest';
import { makeG1k, cas } from './helpers';
import type { SimContext } from '../../../src/core/SimContext';
import { G1K, G1K_EVENTS } from '../../../src/avionics/garmin-g1000/vars';
import { AP } from '../../../src/core/vars';

describe('N1 USP is inhibited on the ground', () => {
  it('AP engaged in ready_to_taxi: no MINSPD, no USP ACTIVE, no aural, no pitch-reference stepping', () => {
    const calls: string[] = [];
    const noop = () => undefined;
    const audio: SimContext['audio'] = {
      play: noop,
      loop: () => ({ setGain: noop, setRate: noop, stop: noop }),
      callout: (n: string) => void calls.push(n),
      tone: noop,
    };
    const r = makeG1k({ state: 'ready_to_taxi', audio });
    r.run(2);
    r.events.emit(G1K_EVENTS.afcsKey('pfd', 'ap'));
    r.run(0.2);
    expect(r.vars.get(AP.engaged)).toBe(1);
    const vert = r.vars.getString(AP.verticalActive);
    const p0 = r.vars.get('ap.pitch_ref_deg');
    r.run(6);
    expect(r.vars.get(AP.engaged)).toBe(1);
    expect(r.vars.get(G1K.minSpd)).toBe(0);
    expect(r.vars.get(G1K.uspActive)).toBe(0);
    expect(cas(r)).not.toContain('USP ACTIVE');
    expect(calls).not.toContain('Airspeed');
    expect(r.vars.getString(AP.verticalActive)).toBe(vert);
    expect(r.vars.get('ap.pitch_ref_deg')).toBeCloseTo(p0, 3);
  });
});
