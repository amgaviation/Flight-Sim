import { describe, expect, it } from 'vitest';
import { LOOPS, ONE_SHOTS, TONE_IDS, pinkNoise, transient } from '../../src/audio/synth';
import { CalloutQueue, VoiceCallouts } from '../../src/audio/Callouts';
import { AudioEngine, profileFromFdm } from '../../src/audio/AudioEngine';
import { COCKPIT_SOUNDS } from '../../src/cockpit/types';
import { TEST_JET } from '../../src/physics/testAircraft';
import { TEST_PISTON } from '../../src/physics/testPiston';
import { SimVars } from '../../src/core/SimVars';

const SR = 22050;

describe('procedural synthesis', () => {
  it('renders every cockpit sound id and alert tone as finite, bounded audio', () => {
    for (const id of Object.values(COCKPIT_SOUNDS)) expect(ONE_SHOTS[id], `missing one-shot ${id}`).toBeTypeOf('function');
    for (const id of TONE_IDS) expect(LOOPS[id], `missing tone ${id}`).toBeTypeOf('function');
    for (const [id, r] of [...Object.entries(ONE_SHOTS), ...Object.entries(LOOPS)]) {
      const b = r(SR);
      expect(b.length, id).toBeGreaterThan(10);
      // One assertion per buffer: an expect() per sample makes this test take
      // tens of seconds on CI runners.
      let peak = 0;
      let energy = 0;
      let finite = true;
      for (const x of b) {
        if (!Number.isFinite(x)) finite = false;
        peak = Math.max(peak, Math.abs(x));
        energy += x * x;
      }
      expect(finite, id).toBe(true);
      expect(peak, id).toBeLessThanOrEqual(1.0001);
      expect(energy, id).toBeGreaterThan(0);
    }
  });

  it('is deterministic and puts marker tones on the AIM 1-1-9 frequencies', () => {
    expect(pinkNoise(SR, 0.1, 5)).toEqual(pinkNoise(SR, 0.1, 5));
    const zc = (b: Float32Array) => {
      let n = 0;
      for (let i = 1; i < b.length; i++) if (b[i - 1] <= 0 && b[i] > 0) n++;
      return n;
    };
    // Outer marker: 400 Hz for 0.375 s of each 0.5 s.
    expect(zc(LOOPS.marker_outer(SR))).toBeGreaterThan(0.375 * 400 - 5);
    expect(zc(LOOPS.marker_outer(SR))).toBeLessThan(0.375 * 400 + 5);
    const t = transient(SR, { length: 0.05, modes: [{ f: 1000, a: 1, tau: 0.02 }] });
    expect(Math.abs(t[t.length - 1])).toBeLessThan(0.01);
  });
});

describe('callouts', () => {
  it('orders by priority, drops duplicates and stale items, interrupts lower priority', () => {
    const q = new CalloutQueue();
    expect(q.push('FIVE HUNDRED', 5, 0)).toBe('queued');
    expect(q.push('FIVE HUNDRED', 5, 0)).toBe('duplicate');
    expect(q.next(0)?.text).toBe('FIVE HUNDRED');
    expect(q.push('MINIMUMS', 6, 0.1)).toBe('interrupt');
    q.finish();
    q.push('TRAFFIC, TRAFFIC', 6, 0.2);
    q.push('PULL UP', 9, 0.3);
    expect(q.next(0.3)?.text).toBe('PULL UP');
    q.finish();
    expect(q.next(0.3)?.text).toBe('MINIMUMS');
    q.finish();
    expect(q.next(20)).toBeNull(); // TRAFFIC went stale
  });

  it('falls back to a caption when speech is unavailable', () => {
    const c = new VoiceCallouts(null);
    const said: string[] = [];
    c.onSpeak = (t) => said.push(t);
    let fb = 0;
    c.onFallback = () => fb++;
    c.say('GLIDESLOPE', 5);
    c.say('SINK RATE', 7);
    expect(said).toEqual(['GLIDESLOPE']);
    for (let i = 0; i < 60; i++) c.update(1 / 60);
    expect(said).toEqual(['GLIDESLOPE', 'SINK RATE']);
    expect(fb).toBe(2);
  });
});

describe('AudioEngine', () => {
  it('derives sound profiles from FDM configs', () => {
    const j = profileFromFdm(TEST_JET, { apu: true });
    expect(j.engines.map((e) => e.kind)).toEqual(['turbofan', 'turbofan']);
    expect(j.apu).not.toBeNull();
    expect(j.gear?.length).toBeGreaterThan(0);
    const p = profileFromFdm(TEST_PISTON);
    expect(p.engines[0].kind).toBe('piston');
    expect(p.engines[0].piston?.cylinders).toBe(4);
    expect(p.cockpitCutoffHz).toBeGreaterThan(j.cockpitCutoffHz);
  });

  it('is inert but safe without an AudioContext', () => {
    const a = new AudioEngine({ vars: new SimVars(), speech: null });
    a.configure(profileFromFdm(TEST_JET));
    expect(() => {
      a.play('switch.toggle', { position: [1, 0, 0] });
      a.tone('stall_horn', true);
      a.callout('MINIMUMS', 6);
      a.loop('noise.pink').setGain(1);
      a.update(1 / 60, { view: 'cockpit', paused: false, listener: { position_m: [0, 0, 0], forward: [1, 0, 0], up: [0, 0, -1] } });
    }).not.toThrow();
    expect(a.activeTones()).toEqual(['stall_horn']);
    a.dispose();
  });
});
