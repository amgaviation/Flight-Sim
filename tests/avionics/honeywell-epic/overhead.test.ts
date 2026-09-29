import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { CockpitBuilder } from '../../../src/cockpit/CockpitBuilder';
import type { CockpitControl, ControlPointer } from '../../../src/cockpit/types';
import { TouchScreenLogic } from '../../../src/avionics/honeywell-epic/logic/touch';
import { SystemReadouts } from '../../../src/avionics/honeywell-epic/logic/bindings';
import { GULFSTREAM_OVERHEAD_VARS, buildOverheadPages, initOverheadVars, overheadPanels, overheadVar } from '../../../src/avionics/honeywell-epic/logic/overhead';
import { G650_AIRFRAME, G800_AIRFRAME } from '../../../src/avionics/honeywell-epic/config';
import { addOverheadSwitches } from '../../../src/avionics/honeywell-epic/cockpit';

function click(c: CockpitControl): void {
  c.object.updateWorldMatrix(true, true);
  const p: ControlPointer = { button: 0, shift: false, ctrl: false, alt: false, point: c.object.localToWorld(new THREE.Vector3(0, 0.004, 0.01)), object: c.hitTargets[0] };
  c.onPointerDown?.(p);
  c.onPointerUp?.(p);
}

describe('Overhead controls: Symmetry touch pages and PlaneView hardware write the same vars', () => {
  it('every touch control writes the var of the GULFSTREAM_OVERHEAD_VARS map', () => {
    const vars = new SimVars();
    const panels = overheadPanels(G800_AIRFRAME);
    initOverheadVars(vars, panels);
    let logic: TouchScreenLogic | null = null;
    const pages = buildOverheadPages(vars, panels, new SystemReadouts(vars), 800, 480, (id) => logic?.show(id));
    logic = new TouchScreenLogic(pages);
    let checked = 0;
    for (const p of panels) {
      logic.show(p.id);
      for (const g of p.groups) {
        for (const c of g.controls) {
          const name = overheadVar(c.key)!;
          expect(name, c.key).toBe(GULFSTREAM_OVERHEAD_VARS[c.key]);
          const before = vars.get(name);
          if (c.stepper) {
            expect(logic.tapId(`ctl.${c.key}.inc`)).toBe(true);
            expect(vars.get(name)).toBeCloseTo(Math.min(c.stepper.max, before + c.stepper.step), 6);
          } else if (c.momentary) {
            const w = logic.current.widgets.find((q) => q.id === `ctl.${c.key}`)!;
            logic.down(w.x + 2, w.y + 2);
            expect(vars.get(name)).toBe(c.positions?.[1].value ?? 1);
            logic.up(w.x + 2, w.y + 2);
            expect(vars.get(name)).toBe(c.positions?.[0].value ?? 0);
          } else {
            expect(logic.tapId(`ctl.${c.key}`)).toBe(true);
            if (c.guarded) {
              expect(vars.get(name)).toBe(before); // first tap arms
              logic.tapId(`ctl.${c.key}`);
            }
            expect(vars.get(name), c.key).not.toBe(before);
          }
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('G800 has split wing / cowl anti-ice and four ECS zones; the G650 does not', () => {
    const keys = (af: typeof G650_AIRFRAME) => overheadPanels(af).flatMap((p) => p.groups.flatMap((g) => g.controls.map((c) => c.key)));
    const g8 = keys(G800_AIRFRAME);
    const g6 = keys(G650_AIRFRAME);
    expect(g8).toContain('ecs.zone4');
    expect(g6).not.toContain('ecs.zone4');
    expect(g8).toContain('ice.wing_r');
  });

  it('G650 single WING / COWL switches drive both sides (touch page and hardware)', () => {
    const vars = new SimVars();
    const panels = overheadPanels(G650_AIRFRAME);
    initOverheadVars(vars, panels);
    const wl = GULFSTREAM_OVERHEAD_VARS['ice.wing_l'];
    const wr = GULFSTREAM_OVERHEAD_VARS['ice.wing_r'];
    expect(vars.get(wr)).toBe(vars.get(wl));
    let logic: TouchScreenLogic | null = null;
    logic = new TouchScreenLogic(buildOverheadPages(vars, panels, new SystemReadouts(vars), 800, 480, (id) => logic?.show(id), undefined, false));
    logic.show('ICE');
    logic.tapId('ctl.ice.cowl_l');
    expect(vars.get(GULFSTREAM_OVERHEAD_VARS['ice.cowl_r'])).toBe(vars.get(GULFSTREAM_OVERHEAD_VARS['ice.cowl_l']));
    const events = new EventBus();
    const b = new CockpitBuilder({ vars, events }, { palette: 'gulfstream', eyePosition_m: [0, -0.36, -1.05] });
    const panel = b.panel({ name: 'ovhd', center_m: [0.3, 0, -1.4], facing: 'down', width: 0.6, height: 0.5, origin: 'top-left' });
    const controls = addOverheadSwitches(b, panel, 0.05, 0.05, panels.find((p) => p.id === 'ICE')!);
    const wing = controls.find((c) => c.id === 'epic.ovhd.ice.wing_l')!;
    const before = vars.get(wl);
    click(wing);
    expect(vars.get(wl)).not.toBe(before);
    expect(vars.get(wr)).toBe(vars.get(wl));
  });

  it('the PlaneView hardware overhead switches write the same vars as the touch keys', () => {
    const vars = new SimVars();
    const events = new EventBus();
    const b = new CockpitBuilder({ vars, events }, { palette: 'gulfstream', eyePosition_m: [0, -0.36, -1.05] });
    const panel = b.panel({ name: 'ovhd', center_m: [0.3, 0, -1.4], facing: 'down', width: 0.6, height: 0.5, origin: 'top-left' });
    const def = overheadPanels(G650_AIRFRAME).find((p) => p.id === 'FUEL')!;
    const controls = addOverheadSwitches(b, panel, 0.05, 0.05, def);
    expect(controls.length).toBe(def.groups.reduce((n, g) => n + g.controls.length, 0));
    // L BOOST toggle (OFF / AUTO / ON): clicking moves it off its initial position and writes the shared var.
    const boost = controls.find((c) => c.id === 'epic.ovhd.fuel.boost_l')!;
    const name = GULFSTREAM_OVERHEAD_VARS['fuel.boost_l'];
    const before = vars.get(name);
    click(boost);
    expect(vars.get(name)).not.toBe(before);
    b.build();
  });
});
