/**
 * Layout-audit fix round 1 (AOPA 2021 / Textron photographs): geometry and the functions of the controls the audit
 * found missing or wrong. Each block names the audit item it guards.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { CockpitControl, ControlPointer } from '../../../src/cockpit/types';
import { makeRig, type Rig } from './helpers';
import { buildLongitudeCockpit } from '../../../src/aircraft/citation-longitude/cockpit';
import { EYE_L, EYE_R, GDU, MAIN_PANEL, PFD_U } from '../../../src/aircraft/citation-longitude/cockpit/layout';
import { LON_VARS as V } from '../../../src/aircraft/citation-longitude/vars';
import { thrustModeFor } from '../../../src/aircraft/citation-longitude/systems/crewControls';
import { TLA } from '../../../src/aircraft/citation-longitude/systems/logic';
import { LONGITUDE_EIS } from '../../../src/avionics/garmin-g3000';
import { G3K, G3K_EVENTS } from '../../../src/avionics/garmin-g3000/vars';
import { PushButton, Lever } from '../../../src/cockpit/controls';
import { bl, placePanel } from '../../../src/cockpit/frame';
import { INPUT } from '../../../src/core/vars';
import type { InitialState } from '../../../src/aircraft/types';

function cockpit(state: InitialState, avionics = true) {
  const r = makeRig(state, { avionics });
  const { build } = buildLongitudeCockpit(r.ctx, r.sys, r.sys.suite, { headless: true });
  build.root.updateMatrixWorld(true);
  const byId = new Map(build.controls.map((c) => [c.id, c]));
  const ctl = <T extends CockpitControl = CockpitControl>(id: string): T => {
    const c = byId.get(id);
    if (!c) throw new Error(`no control ${id}`);
    return c as T;
  };
  const step = (s: number) => {
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) {
      for (const c of build.controls) c.update?.(1 / 60);
      build.update?.(1 / 60);
      r.run(1 / 60);
    }
  };
  return { r, build, byId, ctl, step };
}

function ptr(c: CockpitControl, button: 0 | 1 | 2 = 0, target = c.hitTargets[0] ?? c.object, local?: THREE.Vector3, mods: Partial<ControlPointer> = {}): ControlPointer {
  const point = local ? target.localToWorld(local.clone()) : target.getWorldPosition(new THREE.Vector3());
  return { button, shift: false, ctrl: false, alt: false, point, object: target, ...mods };
}
const click = (c: CockpitControl, button: 0 | 1 | 2 = 0, target?: THREE.Object3D) => {
  c.onPointerDown?.(ptr(c, button, target));
  c.onPointerUp?.(ptr(c, button, target));
};

describe('L01: the whole PFD / MFD is visible from the design eyes', () => {
  it('no cockpit surface lies on the sight line from EYE_L / EYE_R to the top corners and top centre of every GDU screen', { timeout: 60_000 }, () => {
    const { build } = cockpit('ready_to_taxi', false);
    const blockers: THREE.Object3D[] = [];
    build.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible) return;
      const mat = m.material as THREE.Material;
      if (mat.transparent || m.name.startsWith('display:') || m.name.startsWith('hitbox') || (mat as { name?: string }).name === 'cockpit.hitbox') return;
      blockers.push(m);
    });
    // Screen top corners and top centre in the panel frame (addGdu: screen offset 12 mm below the bezel top).
    const panel = new THREE.Group();
    placePanel(panel, { center_m: MAIN_PANEL.center_m, facing: 'aft', tiltDeg: MAIN_PANEL.tiltDeg });
    build.root.add(panel);
    build.root.updateMatrixWorld(true);
    const topV = GDU.bezelH / 2 - 0.012 - 0.004; // 4 mm inside the active area (FMA row)
    const rc = new THREE.Raycaster();
    const hidden: string[] = [];
    for (const [ename, eye] of [
      ['EYE_L', EYE_L],
      ['EYE_R', EYE_R],
    ] as const) {
      const e = bl(eye[0], eye[1], eye[2]).applyMatrix4(build.root.matrixWorld);
      for (const cx of [-PFD_U, 0, PFD_U]) {
        // 15 mm in from the side edges: seen obliquely, a unit's own 10 mm bezel lip hides the outermost few mm.
        for (const du of [-GDU.screenW / 2 + 0.015, 0, GDU.screenW / 2 - 0.015]) {
          const target = panel.localToWorld(new THREE.Vector3(cx + du, topV, 0.002));
          const dir = target.clone().sub(e);
          const dist = dir.length();
          rc.set(e, dir.normalize());
          rc.far = dist - 0.01;
          const hit = rc.intersectObjects(blockers, false)[0];
          if (hit) hidden.push(`${ename} -> screen @${(cx + du).toFixed(3)} blocked by ${hit.object.name || (hit.object.parent?.name ?? '?')} at ${hit.distance.toFixed(3)} m`);
        }
      }
    }
    expect(hidden).toEqual([]);
  });
});

describe('Glareshield tiers (L02-L05, L08, L10, L11)', () => {
  it('MASTER CAUTION RESET is outboard of MASTER WARNING RESET, both on the tier above the PFD; standby at the centre', () => {
    const { ctl } = cockpit('ready_to_taxi', false);
    const y = (id: string) => ctl(id).object.getWorldPosition(new THREE.Vector3()).x; // cockpit-local x = body y (right)
    expect(y('lon.gs.mc_l')).toBeLessThan(y('lon.gs.mw_l'));
    expect(y('lon.gs.mc_r')).toBeGreaterThan(y('lon.gs.mw_r'));
    expect(ctl('lon.gs.mw_l').tooltip()).toContain('MASTER WARNING RESET');
    expect(Math.abs(y('lon.mp.stby_baro'))).toBeLessThan(0.06); // standby at x = 0 (knob at its lower right)
    // The display controllers carry the GCU keys and no MINS knob.
    for (const k of ['range', 'clr', 'ent', 'pfd', 'dto', 'fpl', 'proc', 'comnav']) expect(() => ctl(`lon.g5k.dc1.${k}`)).not.toThrow();
    expect(() => ctl('lon.g5k.mins1')).toThrow();
  });

  it('cold & dark: GMC key bars and the bottle / MASTER lenses are near black', () => {
    const { ctl } = cockpit('cold_dark', false);
    const bar = (ctl<PushButton>('lon.g5k.gmc.ap') as unknown as { barMat: THREE.MeshStandardMaterial }).barMat;
    expect(bar.emissiveIntensity).toBe(0);
    const hsl = { h: 0, s: 0, l: 0 };
    bar.color.getHSL(hsl);
    expect(hsl.l).toBeLessThan(0.03);
    for (const id of ['lon.gs.bottle1', 'lon.gs.mw_l', 'lon.gs.mc_l']) {
      const face = ctl<PushButton>(id).face as unknown as { segs: { mat: THREE.MeshStandardMaterial }[] };
      face.segs[0].mat.color.getHSL(hsl);
      expect(hsl.l, id).toBeLessThan(0.03);
    }
  });

  it('APU FIRE switchlight shuts the APU down and discharges the APU bottle (L04)', { timeout: 120_000 }, () => {
    const { r, ctl, step } = cockpit('ready_to_taxi', false);
    const v = r.vars;
    v.set(V.apuKnob, 1);
    step(12);
    v.set(V.apuKnob, 2);
    step(0.5);
    v.set(V.apuKnob, 1);
    step(60);
    expect(v.get('apu.running')).toBe(1);
    const apuFire = ctl('lon.gs.fire_apu') as unknown as CockpitControl & { inner: CockpitControl };
    click(apuFire); // guard
    click(apuFire, 0, apuFire.inner.hitTargets[0]); // push
    step(1);
    expect(v.get(V.fireApu)).toBe(1);
    expect(v.get('fire.apu_armed')).toBe(1);
    step(20);
    expect(v.get('fire.apu_bottle_discharged')).toBe(1);
    expect(v.get('apu.running')).toBe(0);
  });

  it('POWER RESERVE: AUTO arms APR on an engine failure at takeoff thrust, MANUAL commands it (L10)', { timeout: 60_000 }, () => {
    const { r, ctl, step } = cockpit('takeoff', false);
    const v = r.vars;
    expect(v.get(V.aprAuto)).toBe(1);
    v.set(V.tla(1), TLA.clb);
    v.set(V.tla(2), TLA.clb);
    step(1);
    expect(v.get(V.aprActive)).toBe(0);
    expect(v.get('ac.lon.tla_eff1')).toBeCloseTo(TLA.clb, 3);
    click(ctl('lon.gs.apr_manual'));
    step(0.5);
    expect(v.get(V.aprManual)).toBe(1);
    expect(v.get(V.aprActive)).toBe(1);
    expect(v.get('ac.lon.tla_eff1')).toBe(TLA.to); // APR = TO/APR rating (OG 1-3)
    expect(v.getString(V.thrustMode(1))).toBe('APR');
    click(ctl('lon.gs.apr_manual'));
    // AUTO: takeoff thrust and an engine failure latch APR.
    v.set(V.tla(1), 1);
    v.set(V.tla(2), 1);
    step(0.5);
    expect(v.get(V.aprActive)).toBe(0);
    v.set(V.engFail(2), 1);
    r.sys.logic.update(1 / 60);
    expect(v.get(V.aprActive)).toBe(1);
    // Disarming AUTO removes it.
    click(ctl('lon.gs.apr_auto'));
    step(0.1);
    expect(v.get(V.aprAuto)).toBe(0);
    expect(v.get(V.aprActive)).toBe(0);
  });
});

describe('GMC 710 (L06 / L07)', () => {
  it('key set: no A/T or SPD key; CPL key; SPD knob push = IAS / MACH, FMS / MAN ring; NOSE wheel DN at the top', () => {
    const { r, byId, ctl, step } = cockpit('ready_to_taxi', true);
    expect(byId.has('lon.g5k.gmc.at')).toBe(false);
    expect(byId.has('lon.g5k.gmc.spd')).toBe(false);
    expect(ctl('lon.g5k.gmc.xfr').tooltip()).toContain('CPL');
    const events: string[] = [];
    const off = r.events.onAny((n) => events.push(n));
    // Rolling the wheel's top upward (toward the DN engraving) commands nose down.
    ctl('lon.g5k.gmc.nose').onWheel?.(1, ptr(ctl('lon.g5k.gmc.nose')));
    expect(events).toContain(`${G3K_EVENTS.noseWheel}_dec`);
    events.length = 0;
    const spd = ctl('lon.g5k.gmc.spd_knob');
    spd.onPointerDown?.(ptr(spd, 1));
    spd.onPointerUp?.(ptr(spd, 1));
    expect(events).toContain(G3K_EVENTS.gmcKey('SPD'));
    const fms0 = r.vars.get(G3K.speedFms);
    click(ctl('lon.g5k.gmc.spd_ring'));
    step(0.1);
    expect(r.vars.get(G3K.speedFms)).not.toBe(fms0);
    off();
  });

  it('ALT knob PUSH FINE switches 1,000 ft / 100 ft steps', () => {
    const { r, ctl, step } = cockpit('ready_to_taxi', true);
    const v = r.vars;
    const alt = ctl('lon.g5k.gmc.alt_knob');
    const a0 = v.get('ap.sel_alt_ft');
    alt.onWheel?.(1, ptr(alt));
    step(0.1);
    expect(v.get('ap.sel_alt_ft') - a0).toBe(1000);
    alt.onPointerDown?.(ptr(alt, 1));
    alt.onPointerUp?.(ptr(alt, 1));
    expect(v.get(V.altFine)).toBe(1);
    alt.onWheel?.(1, ptr(alt));
    step(0.1);
    expect(v.get('ap.sel_alt_ft') - a0).toBe(1100);
  });

  it('display controller FPL key opens the PFD flight-plan window (GCU logic)', () => {
    const { r, ctl, step } = cockpit('ready_to_taxi', true);
    click(ctl('lon.g5k.dc1.fpl'));
    step(0.1);
    expect(r.vars.get(G3K.gcuWindow(1))).toBe(1); // GCU_WINDOW.fpl
  });
});

describe('Pedestal functions (L22, L36, L39, L41-L44)', () => {
  it('STAB PRI TRIM CHANNEL SELECT swaps the powered channel; SECONDARY TRIM engaged disables primary trim and enables the rocker', { timeout: 60_000 }, () => {
    const { r, ctl, step } = cockpit('ready_to_taxi', false);
    const v = r.vars;
    const trimRate = () => {
      const u0 = v.get('trim.pitch_units');
      step(1);
      return v.get('trim.pitch_units') - u0;
    };
    // Channel 1 failed: primary trim dead until channel 2 is selected.
    r.sys.failures.trigger('trim.stab_ch1');
    v.set(V.yokeTrimL, 1);
    expect(Math.abs(trimRate())).toBeLessThan(1e-3);
    click(ctl('lon.ped.stab_chan'));
    step(0.1);
    expect(v.get(V.stabChan)).toBe(2);
    expect(Math.abs(trimRate())).toBeGreaterThan(0.05);
    v.set(V.yokeTrimL, 0);
    // SECONDARY TRIM: wheel trim inhibited, the pedestal rocker trims.
    click(ctl('lon.ped.stab_sec_arm'));
    step(0.1);
    expect(v.get(V.stabSecArm)).toBe(1);
    v.set(V.yokeTrimL, 1);
    expect(Math.abs(trimRate())).toBeLessThan(1e-3);
    v.set(V.yokeTrimL, 0);
    v.set(V.stabSecSw, -1);
    expect(Math.abs(trimRate())).toBeGreaterThan(0.05);
    v.set(V.stabSecSw, 0);
  });

  it('AUTO GROUND SPOILERS off disarms the ground spoilers; STANDBY YAW DAMP restores yaw damping after a YD failure', { timeout: 60_000 }, () => {
    const { r, ctl, step } = cockpit('ready_to_taxi', false);
    step(1);
    expect(r.vars.get(V.gsArmed)).toBe(1);
    click(ctl('lon.ped.auto_gnd_splr'));
    step(0.2);
    expect(r.vars.get(V.autoGndSplr)).toBe(0);
    expect(r.vars.get(V.gsArmed)).toBe(0);
    const a = makeRig('cruise', { avionics: false, weightLb: 32000, air: { altFtMsl: 20000, iasKt: 250 } });
    a.run(1);
    expect(a.vars.get('ap.yd_engaged')).toBe(1);
    a.sys.failures.trigger('yd.normal');
    a.run(1);
    expect(a.vars.get('ap.yd_engaged')).toBe(0);
    a.vars.set(V.stbyYd, 1);
    a.run(1);
    expect(a.vars.get('ap.yd_engaged')).toBe(1);
  });

  it('FLAP RESET clears a latched flap fault once the cause is gone (L39)', { timeout: 60_000 }, () => {
    const r: Rig = makeRig('ready_to_taxi', { avionics: false });
    const v = r.vars;
    r.sys.failures.trigger('flaps.drive');
    v.set(V.flapLever, 3);
    r.run(6);
    expect(v.get(V.flapFault)).toBe(1);
    expect(r.sys.cas.list.filter((e) => e.active).map((e) => e.text)).toContain('FLAP FAIL');
    r.sys.failures.clear('flaps.drive');
    r.run(1);
    const f0 = v.get('surf.flaps_deg');
    r.run(2);
    expect(v.get('surf.flaps_deg')).toBeCloseTo(f0, 3); // still held off by the latch
    v.set(V.flapReset, 1);
    r.run(0.2);
    v.set(V.flapReset, 0);
    r.run(10);
    expect(v.get(V.flapFault)).toBe(0);
    expect(v.get('surf.flaps_deg')).toBeGreaterThan(30);
  });

  it('CONTROL LOCK holds the surfaces, keeps the thrust at idle, posts NO TAKEOFF; it cannot engage with a lever advanced (L42)', { timeout: 60_000 }, () => {
    const { r, ctl, step } = cockpit('ready_to_taxi', false);
    const v = r.vars;
    const lock = ctl<Lever>('lon.ped.control_lock');
    click(lock); // next detent toward LOCK
    step(0.5);
    expect(v.get(V.controlLock)).toBe(1);
    v.set(INPUT.pitch, 0.8);
    v.set(INPUT.roll, 0.8);
    step(0.5);
    expect(v.get('surf.elevator')).toBe(0);
    expect(v.get('surf.aileron')).toBe(0);
    // The thrust-lever interlock keeps the lever at idle and the logic keeps the effective lever at idle.
    const tl = ctl<Lever>('lon.ped.tl1');
    for (let i = 0; i < 10; i++) tl.onWheel?.(1, ptr(tl));
    step(0.5);
    expect(v.get(V.tla(1))).toBeLessThanOrEqual(TLA.idle + 1e-6);
    v.set(V.tla(1), 1); // keyboard / hardware throttle
    step(0.2);
    expect(v.get('ac.lon.tla_eff1')).toBeLessThanOrEqual(TLA.idle + 1e-6);
    expect(v.get(V.noTakeoff)).toBe(1);
    // Unlock; with a lever advanced the lock cannot be engaged again.
    v.set(INPUT.pitch, 0);
    v.set(INPUT.roll, 0);
    lock.onPointerDown?.(ptr(lock, 2));
    lock.onPointerUp?.(ptr(lock, 2));
    step(0.5);
    expect(v.get(V.controlLock)).toBe(0);
    v.set(V.tla(1), 0.5);
    step(0.2);
    click(lock);
    step(0.5);
    expect(v.get(V.controlLock)).toBe(0);
  });

  it('EMER / PARK BRAKE lever is on the pedestal and sets the parking brake (L22)', () => {
    const { r, byId, ctl, step } = cockpit('ready_to_taxi', false);
    expect(byId.has('lon.lp.park_brake')).toBe(false);
    const pk = ctl<Lever>('lon.ped.park_brake');
    r.vars.set(V.parkBrake, 0);
    step(0.3);
    expect(r.vars.get('brakes.parking_set')).toBe(0);
    click(pk);
    step(1);
    expect(r.vars.get(V.parkBrake)).toBe(1);
    expect(r.vars.get('brakes.parking_set')).toBe(1);
  });

  it('CVR TEST lights the status light after 5 s; ERASE only on the ground with the parking brake set; EVENT MARKER counts (L43/L44)', { timeout: 60_000 }, () => {
    const { r, ctl, step } = cockpit('ready_to_taxi', false);
    const v = r.vars;
    const test = ctl('lon.ped.cvr_test');
    test.onPointerDown?.(ptr(test));
    step(3);
    expect(v.get(V.cvrTestOk)).toBe(0);
    step(2.5);
    expect(v.get(V.cvrTestOk)).toBe(1);
    test.onPointerUp?.(ptr(test));
    step(0.2);
    expect(v.get(V.cvrTestOk)).toBe(0);
    v.set(V.parkBrake, 1);
    step(1);
    const erase = ctl('lon.ped.cvr_erase');
    erase.onPointerDown?.(ptr(erase));
    step(0.2);
    erase.onPointerUp?.(ptr(erase));
    expect(v.get(V.cvrErased)).toBe(1);
    const ev = ctl('lon.ped.event_marker');
    ev.onPointerDown?.(ptr(ev));
    step(0.1);
    ev.onPointerUp?.(ptr(ev));
    step(0.1);
    expect(v.get(V.eventCount)).toBe(1);
  });

  it('PITCH/ROLL DISCONNECT handle: pull, PITCH RECONNECT (wheel up), ROLL RECONNECT (wheel down), push reset (L41)', { timeout: 60_000 }, () => {
    const { r, ctl, step } = cockpit('ready_to_taxi', false);
    const v = r.vars;
    const h = ctl('lon.ped.pitch_roll_disc');
    click(h);
    step(0.1);
    expect(v.get(V.pitchRollDisc)).toBe(1);
    h.onWheel?.(1, ptr(h));
    step(0.1);
    expect(v.get(V.pitchRollDisc)).toBe(2);
    h.onWheel?.(-1, ptr(h));
    step(0.1);
    expect(v.get(V.pitchRollDisc)).toBe(3);
    h.onPointerDown?.(ptr(h, 2));
    step(0.1);
    expect(v.get(V.pitchRollDisc)).toBe(0);
  });

  it('PITCH RECONNECT re-joins the elevator runs while roll stays split', { timeout: 120_000 }, () => {
    const r = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 20000, iasKt: 250 } });
    const v = r.vars;
    r.run(2);
    r.sys.failures.trigger('fcs.pitch.jam');
    r.sys.failures.trigger('fcs.roll.jam');
    r.run(0.5);
    const jamE = v.get('surf.elevator');
    const jamA = v.get('surf.aileron');
    v.set(V.pitchRollDisc, 2); // PITCH RECONNECT: pitch runs joined (so still jammed), roll still split
    v.set(INPUT.pitch, 0.5);
    v.set(INPUT.roll, 0.5);
    r.run(1);
    expect(v.get('surf.elevator')).toBeCloseTo(jamE, 2);
    expect(v.get('surf.aileron')).toBeCloseTo(0.5 * v.get('fcs.roll_column') + 0.5 * jamA, 2);
    v.set(V.pitchRollDisc, 3); // ROLL RECONNECT: roll joined (jammed), pitch split
    r.run(1);
    expect(v.get('surf.aileron')).toBeCloseTo(jamA, 2);
    expect(v.get('surf.elevator')).toBeCloseTo(0.5 * v.get('fcs.pitch_column') + 0.5 * jamE, 2);
  });
});

describe('EIS (LON-PROC-06 / LON-PROC-27)', () => {
  it('flap scale 0 / 7 / 15 / 35 with the selected-position bug from the flap lever', () => {
    const flaps = LONGITUDE_EIS.sections.find((s) => s.kind === 'flaps');
    expect(flaps && flaps.kind === 'flaps' ? flaps.detents.map((d) => d.deg) : []).toEqual([0, 7, 15, 35]);
    expect(flaps && flaps.kind === 'flaps' ? [flaps.selectedVar, flaps.selectedDeg] : []).toEqual([V.flapLever, [0, 7, 15, 35]]);
  });

  it('thrust mode shows the governing rating between detents and is magenta under the A/T', () => {
    expect(thrustModeFor(0.3, false, 0)).toBe('CRU');
    expect(thrustModeFor(TLA.cru, false, 0)).toBe('CRU');
    expect(thrustModeFor(0.7, false, 0)).toBe('CRU');
    expect(thrustModeFor(0.9, false, 0)).toBe('CLB');
    expect(thrustModeFor(1, false, 0)).toBe('TO');
    expect(thrustModeFor(0.9, true, 0)).toBe('APR');
    expect(thrustModeFor(0, false, 0)).toBe('');
    expect(thrustModeFor(-0.5, false, 1)).toBe('T/R');
    const n1 = LONGITUDE_EIS.sections.find((s) => s.kind === 'n1');
    expect(n1 && n1.kind === 'n1' ? [n1.detentVar?.(1), n1.modeColorByAt] : []).toEqual([V.thrustMode(1), true]);
    const r = makeRig('cruise', { avionics: false, weightLb: 32000, air: { altFtMsl: 30000, iasKt: 250 } });
    r.run(1);
    expect(['CRU', 'CLB']).toContain(r.vars.getString(V.thrustMode(1)));
  });
});

describe('Lower sub-panels (L17-L20, L23)', () => {
  it('STBY PWR positions TEST / OFF / ON bottom to top (TEST momentary); no gear position lights on the panel', () => {
    const { r, byId, ctl, step } = cockpit('ready_to_taxi', false);
    expect(byId.has('lon.lp.gear_lt_l')).toBe(false);
    const sw = ctl('lon.lp.stby_pwr') as unknown as { positions: string[] } & CockpitControl;
    expect(sw.positions).toEqual(['TEST', 'OFF', 'ON']);
    // Hold the lower half: TEST while held, back to OFF.
    r.vars.set(V.stbyPwr, 0);
    step(0.1);
    sw.onPointerDown?.(ptr(sw, 2));
    step(0.1);
    expect(r.vars.get(V.stbyPwr)).toBe(2);
    sw.onPointerUp?.(ptr(sw, 2));
    step(0.5);
    expect(r.vars.get(V.stbyPwr)).toBe(0);
  });
});
