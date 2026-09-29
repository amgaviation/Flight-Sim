/**
 * G5000 synoptic pages and the GTC "Aircraft Systems" touch controls of the
 * Longitude: every page compiles, every GTC-only control var in the inventory
 * (docs §7.9) is reachable from a GTC control, and operating those controls
 * (through the same GTC button logic the touchscreen uses) changes the systems.
 */
import { describe, expect, it } from 'vitest';
import { makeRig } from '../helpers';
import { SynopticPage, type SynopticControl } from '../../../../src/avionics/garmin-g3000';
import { controlButton } from '../../../../src/avionics/garmin-g3000/gtc/pages/mfd';
import type { GtcController } from '../../../../src/avionics/garmin-g3000/gtc/GtcController';
import { LONGITUDE_SYNOPTICS } from '../../../../src/aircraft/citation-longitude/systems/synoptics';
import { LON_VARS as V } from '../../../../src/aircraft/citation-longitude/vars';

const GTC_ONLY = [V.ltNav, V.ltBeaconMode, V.ltAutoPulse, V.cabinSetC, V.ckptSetC, V.recircFan, V.pressSelMode, V.pressLdgElevFt, V.pressSelCabinFt];

describe('Citation Longitude G5000 synoptics and GTC system controls', () => {
  it('pages compile and every GTC-only control var has a GTC control', () => {
    const r = makeRig('ready_to_taxi', { avionics: true });
    for (const def of LONGITUDE_SYNOPTICS) expect(() => new SynopticPage(r.vars, def)).not.toThrow();
    const controlled = new Set(LONGITUDE_SYNOPTICS.flatMap((p) => (p.controls ?? []).map((c) => c.var)));
    for (const k of GTC_ONLY) expect(controlled.has(k), k).toBe(true);
    expect(r.sys.suite!.cfg.synoptics.length).toBe(LONGITUDE_SYNOPTICS.length);
  });

  it('GTC controls drive the lights, temperature and pressurization', { timeout: 120000 }, () => {
    const r = makeRig('ready_to_taxi', { avionics: true });
    const v = r.vars;
    const gtc = { sys: r.sys.suite!.system } as unknown as GtcController;
    const ctl = (label: string): SynopticControl => LONGITUDE_SYNOPTICS.flatMap((p) => p.controls ?? []).find((c) => c.label === label)!;
    const pressBtn = (label: string) => controlButton(gtc, ctl(label)).onPress?.();
    r.run(2);
    // NAV lights: toggle off / on (OG 16-3).
    expect(v.get('light.nav')).toBeGreaterThan(0);
    pressBtn('NAV');
    r.run(0.5);
    expect(v.get('light.nav')).toBe(0);
    pressBtn('NAV');
    r.run(0.5);
    expect(v.get('light.nav')).toBeGreaterThan(0);
    // BEACON NORM -> ON -> OFF: with OFF the beacon stays dark although the engines run.
    expect(v.get(V.ltBeaconMode)).toBe(1);
    pressBtn('BEACON');
    pressBtn('BEACON');
    expect(v.get(V.ltBeaconMode)).toBe(0);
    let lit = 0;
    r.run(3, () => void (lit = Math.max(lit, v.get('light.beacon'))));
    expect(lit).toBe(0);
    pressBtn('BEACON');
    r.run(3, () => void (lit = Math.max(lit, v.get('light.beacon'))));
    expect(lit).toBeGreaterThan(0);
    // Cabin temperature target: 28 degC warms the cabin (ECS zone control).
    const t0 = v.get('pneu.cabin_temp_c');
    r.sys.suite!.system.setVar(ctl('CABIN TEMP').var!, 28);
    r.run(120);
    expect(v.get('pneu.cabin_temp_c')).toBeGreaterThan(t0 + 2);
    // Recirculation fan cycles AUTO -> LOW -> HIGH.
    pressBtn('RECIRC FAN');
    expect(v.get(V.recircFan)).toBe(1);
    // Cabin pressure: manual landing elevation, then back to the FMS destination.
    r.sys.suite!.system.setVar(ctl('LDG ELEV').var!, 5000);
    r.run(1);
    expect(v.get('press.ldg_elev_ft')).toBeCloseTo(5000, -1);
    pressBtn('LDG ELEV SRC');
    expect(v.get(V.pressLdgElevFt)).toBe(-9999);
    pressBtn('PRESS MODE');
    expect(v.get(V.pressSelMode)).toBe(1);
  });
});
