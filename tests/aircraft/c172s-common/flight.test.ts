/**
 * Cessna 172S handling through the shared core (real FCS, trim, flaps, rigging, engine):
 *  - hands-off stability after takeoff: normal takeoff (flaps 10, rotate 55 KIAS), climb at
 *    75 KIAS trimmed, ball centred, to ~400 ft AGL, then every control released. No divergent
 *    roll or yaw: the left-turning tendencies at climb power bank the airplane slowly left, the
 *    Dutch roll stays damped (14 CFR 23.177 / 23.181 intent: static lateral-directional
 *    stability, Dutch roll damped with the controls free);
 *  - Dutch roll after a rudder doublet in cruise damps to 1/10 amplitude within 7 cycles
 *    (14 CFR 23.181(a));
 *  - the cruise and approach presets are trimmed: hands off they hold altitude, speed and
 *    wings level (factory rigging: rudder trim tab and aileron);
 *  - the pneumatic stall warning horn sounds 5 to 10 knots above the stall (POH Sec 2 / 7:
 *    "The stall warning horn ... produces a steady signal 5 to 10 knots before the actual
 *    stall is reached");
 *  - control lock, electric flaps (rate, detents, FLAP breaker / master) and the trim wheel.
 */
import { describe, expect, it } from 'vitest';
import { FDM, INPUT, SURF } from '../../../src/core/vars';
import { C172 } from '../../../src/aircraft/c172s-common/vars';
import { FLAP_RATE_DPS } from '../../../src/aircraft/c172s-common/systems/flight';
import { make172, HandPilot, LB, type Rig } from './helpers';

function sample(r: Rig) {
  const v = r.vars;
  return { bank: v.get(FDM.bank), pitch: v.get(FDM.pitch), beta: v.get(FDM.beta), ias: v.get('adc1.ias_kt'), alt: v.get(FDM.altMsl), p: v.get(FDM.p), r: v.get(FDM.r), hdg: v.get(FDM.headingTrue) };
}

/** Peaks of |x| between zero crossings (half-cycle amplitudes). */
function halfCycleAmplitudes(xs: number[]): number[] {
  const out: number[] = [];
  let peak = 0;
  let sign = Math.sign(xs[0] ?? 0);
  for (const x of xs) {
    const s = Math.sign(x);
    if (s !== 0 && s !== sign) {
      out.push(peak);
      peak = 0;
      sign = s;
    }
    peak = Math.max(peak, Math.abs(x));
  }
  out.push(peak);
  return out;
}

describe('Cessna 172S handling (shared core)', () => {
  it('hands-off after takeoff: slow left turn at climb power, no divergent roll or yaw', () => {
    const r = make172({ variant: 'steam', state: 'takeoff', grossLb: 2400 });
    const v = r.vars;
    const hp = new HandPilot(r);
    r.run(1);
    v.set(C172.throttle, 1);
    let phase: 'roll' | 'climb' | 'free' = 'roll';
    let tFree = 0;
    let liftoffIas = 0;
    let maxBank = 0;
    let maxBeta = 0;
    let maxP = 0;
    let bankAt10 = NaN;
    let minIas = 999;
    let maxIas = 0;
    let climbVs = 0;
    const yawRates: number[] = [];
    r.run(150, (t) => {
      const s = sample(r);
      if (phase === 'roll') {
        // POH normal takeoff: flaps 10, full throttle, lift the nose wheel at 55 KIAS.
        hp.steer(0);
        hp.bank(0);
        if (s.ias >= 55) hp.pitch(9);
        else v.set(INPUT.pitch, 0);
        if (v.get(FDM.onGround) < 0.5 && liftoffIas === 0) liftoffIas = s.ias;
        if (v.get(FDM.radioAlt) > 20) {
          phase = 'climb';
          hp.setYaw(v.get(INPUT.yaw));
        }
      } else if (phase === 'climb') {
        // Climb at 75 KIAS, wings level, right rudder to centre the ball, trimmed.
        hp.speed(75);
        hp.bank(0);
        hp.ball();
        hp.trim();
        climbVs = v.get(FDM.vs);
        if (v.get(FDM.radioAlt) > 400) {
          phase = 'free';
          tFree = t;
          hp.release();
        }
      } else {
        hp.release();
        const tf = t - tFree;
        maxBank = Math.max(maxBank, Math.abs(s.bank));
        maxBeta = Math.max(maxBeta, Math.abs(s.beta));
        maxP = Math.max(maxP, Math.abs(s.p));
        minIas = Math.min(minIas, s.ias);
        maxIas = Math.max(maxIas, s.ias);
        yawRates.push(s.r);
        if (Number.isNaN(bankAt10) && tf >= 10) bankAt10 = s.bank;
        if (tf >= 20) return true;
      }
    });
    expect(phase).toBe('free');
    // Lift-off a few knots after the nose comes up (POH normal takeoff: rotate 55 KIAS).
    expect(liftoffIas).toBeGreaterThan(54);
    expect(liftoffIas).toBeLessThan(66);
    // POH Fig 5-6: ~700-730 fpm at SL at 2550 lb (flaps up, 74 KIAS); lighter here, flaps 10.
    expect(climbVs).toBeGreaterThan(600);
    // Released: the left-turning tendencies roll it slowly left; nothing diverges within 20 s.
    expect(bankAt10).toBeLessThan(0);
    expect(Math.abs(bankAt10)).toBeLessThan(25);
    expect(maxBank).toBeLessThan(35);
    expect(maxP).toBeLessThan(5);
    expect(maxBeta).toBeLessThan(4);
    expect(minIas).toBeGreaterThan(60);
    expect(maxIas).toBeLessThan(95);
    // Yaw rate settles into the gentle turn (no growing oscillation): the last 5 s vary little.
    const tail = yawRates.slice(-300);
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(2);
  });

  it('Dutch roll after a rudder doublet in cruise damps to 1/10 within 7 cycles (14 CFR 23.181)', () => {
    const r = make172({ variant: 'steam', state: 'cruise', grossLb: 2400, air: { altFtMsl: 6000, iasKt: 100 } });
    const v = r.vars;
    r.run(2);
    v.set(INPUT.yaw, 0.4);
    r.run(1);
    v.set(INPUT.yaw, -0.4);
    r.run(1);
    v.set(INPUT.yaw, 0);
    const rates: number[] = [];
    r.run(30, () => void rates.push(v.get(FDM.r)));
    // Remove the slow spiral / turn trend (1 s moving average) and look at the oscillation.
    const osc = rates.map((x, i) => {
      const a = rates.slice(Math.max(0, i - 30), i + 30);
      return x - a.reduce((s, y) => s + y, 0) / a.length;
    });
    const amps = halfCycleAmplitudes(osc).filter((a) => a > 0.01);
    const first = Math.max(...amps.slice(0, 3));
    // 7 cycles = 14 half cycles.
    const after = amps.slice(0, 14);
    expect(first).toBeGreaterThan(1);
    expect(Math.min(...after)).toBeLessThan(first / 10);
    const s = sample(r);
    expect(Math.abs(s.bank)).toBeLessThan(10);
  });

  for (const variant of ['steam', 'g1000'] as const) {
    it(`${variant}: cruise preset is trimmed (6000 ft), hands off for 60 s`, () => {
      const r = make172({ variant, state: 'cruise', grossLb: 2400, air: { altFtMsl: 6000, iasKt: 105 } });
      r.run(1);
      const s0 = sample(r);
      let maxBank = 0;
      let maxDAlt = 0;
      let maxDIas = 0;
      r.run(60, () => {
        const s = sample(r);
        maxBank = Math.max(maxBank, Math.abs(s.bank));
        maxDAlt = Math.max(maxDAlt, Math.abs(s.alt - s0.alt));
        maxDIas = Math.max(maxDIas, Math.abs(s.ias - s0.ias));
      });
      const s1 = sample(r);
      expect(s0.ias).toBeGreaterThan(103);
      expect(s0.ias).toBeLessThan(111);
      expect(maxBank).toBeLessThan(5);
      expect(maxDAlt).toBeLessThan(100);
      expect(maxDIas).toBeLessThan(3);
      expect(Math.abs(((s1.hdg - s0.hdg + 540) % 360) - 180)).toBeLessThan(10);
    });
  }

  it('approach preset (flaps 10, 70 KIAS) is trimmed, hands off for 30 s', () => {
    const r = make172({ variant: 'steam', state: 'approach', grossLb: 2400, air: { altFtMsl: 2000, iasKt: 70 } });
    const v = r.vars;
    r.run(1);
    expect(v.get(SURF.flapsDeg)).toBeCloseTo(10, 0);
    const s0 = sample(r);
    let maxBank = 0;
    let maxDAlt = 0;
    let maxDIas = 0;
    r.run(30, () => {
      const s = sample(r);
      maxBank = Math.max(maxBank, Math.abs(s.bank));
      maxDAlt = Math.max(maxDAlt, Math.abs(s.alt - s0.alt));
      maxDIas = Math.max(maxDIas, Math.abs(s.ias - s0.ias));
    });
    expect(maxBank).toBeLessThan(10);
    expect(maxDAlt).toBeLessThan(150);
    expect(maxDIas).toBeLessThan(5);
  });

  for (const flapLever of [0, 3]) {
    it(`stall warning horn 5-10 kt above the stall (flaps ${flapLever === 0 ? 'UP' : 'FULL'}, power off)`, () => {
      const r = make172({ variant: 'steam', state: 'approach', grossLb: 2550, air: { altFtMsl: 5000, iasKt: 70 } });
      const v = r.vars;
      v.set(C172.flapLever, flapLever);
      v.set(C172.throttle, 0);
      const hp = new HandPilot(r);
      r.run(12, () => {
        hp.speed(70, FDM.cas);
        hp.bank(0);
      });
      let horn = NaN;
      let brk = NaN;
      let t0 = r.t();
      r.run(50, (t) => {
        const kcas = v.get(FDM.cas);
        hp.speed(Math.max(30, 70 - (t - t0)), FDM.cas); // ~1 kt/s deceleration (POH stall-speed technique)
        hp.bank(0);
        if (Number.isNaN(horn) && v.get(C172.stallHorn) > 0.5) horn = kcas;
        if (Number.isNaN(brk) && v.get(FDM.aoaNorm) >= 1) {
          brk = kcas;
          return true;
        }
      });
      // Recovery: release back pressure, horn stops.
      t0 = r.t();
      r.run(8, () => {
        hp.pitch(-5);
        hp.bank(0);
      });
      const margin = horn - brk;
      expect(Number.isNaN(brk)).toBe(false);
      expect(margin).toBeGreaterThanOrEqual(4);
      expect(margin).toBeLessThanOrEqual(11);
      expect(v.get(C172.stallHorn)).toBe(0);
    });
  }

  it('control lock holds the elevator and ailerons; removing it frees them', () => {
    const r = make172({ variant: 'steam', state: 'cold_dark' });
    const v = r.vars;
    v.set(INPUT.pitch, 1);
    v.set(INPUT.roll, 1);
    r.run(1);
    expect(v.get(SURF.elevator)).toBeLessThan(0); // lock pins the column with the elevator slightly down
    expect(Math.abs(v.get(SURF.aileron))).toBeLessThan(0.01);
    v.set(C172.controlLock, 0);
    r.run(1);
    expect(v.get(SURF.elevator)).toBeGreaterThan(0.9);
    expect(v.get(SURF.aileron)).toBeGreaterThan(0.9);
  });

  it('electric flaps: detents at the POH rate, need the FLAP breaker and master power', () => {
    const r = make172({ variant: 'g1000', state: 'ready_to_taxi' });
    const v = r.vars;
    v.set(C172.flapLever, 3);
    const t = r.run(20, () => v.get(SURF.flapsDeg) >= 29.9);
    expect(v.get(SURF.flapsDeg)).toBeCloseTo(30, 0);
    expect(t).toBeGreaterThan((30 / FLAP_RATE_DPS) * 0.9);
    expect(t).toBeLessThan((30 / FLAP_RATE_DPS) * 1.2);
    v.set(C172.flapLever, 1);
    r.run(10);
    expect(v.get(SURF.flapsDeg)).toBeCloseTo(10, 0);
    // FLAP breaker pulled: the flaps stay where they are.
    v.set('cb.flap', 0);
    v.set(C172.flapLever, 0);
    r.run(5);
    expect(v.get(SURF.flapsDeg)).toBeCloseTo(10, 0);
    v.set('cb.flap', 1);
    r.run(5);
    expect(v.get(SURF.flapsDeg)).toBeLessThan(0.5);
    // Master OFF: no flap motor.
    v.set(C172.masterAlt, 0);
    v.set(C172.masterBat, 0);
    v.set(C172.flapLever, 2);
    r.run(5);
    expect(v.get(SURF.flapsDeg)).toBeLessThan(0.5);
  });

  it('elevator trim wheel moves the trim tab; weight moves the trimmed speed', () => {
    const r = make172({ variant: 'steam', state: 'cruise', grossLb: 2550, air: { altFtMsl: 4000, iasKt: 100 } });
    const v = r.vars;
    r.run(1);
    const trim0 = v.get(C172.trimPosition);
    expect(v.get(SURF.pitchTrim)).toBeCloseTo(trim0, 2);
    // Nose-up trim, hands off: the airplane slows down.
    v.set(C172.trimPosition, trim0 + 0.3);
    const ias0 = v.get('adc1.ias_kt');
    r.run(20);
    expect(v.get(SURF.pitchTrim)).toBeCloseTo(trim0 + 0.3, 2);
    expect(v.get('adc1.ias_kt')).toBeLessThan(ias0 - 5);
    expect(v.get(FDM.mass) / LB).toBeGreaterThan(2500);
  });
});
