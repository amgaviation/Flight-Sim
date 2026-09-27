/**
 * G800 side consoles and sidewall circuit-breaker panels (mount contract in ../context.ts).
 *
 * Outboard consoles, aft of the sidestick pods built by the main cockpit (layout.ts STICK_POD):
 *  - left : nosewheel steering TILLER (FSB GVIII-G700 §9.4 b: tiller on the left side only;
 *           BJT500: "the pedal steering switchlight and tiller are in the normal place on the left
 *           side ledge, aft of the sidestick"), crew oxygen mask stowage box with the mask
 *           regulator selector (NORM / 100 % / EMER) and the mask flow indicator;
 *  - right: copilot oxygen mask box, regulator and flow indicator.
 *  The NOSEWHEEL STEERING switch and the CCDs are built by the main cockpit (not here).
 *
 * Sidewalls aft of the seats: pilot and copilot circuit-breaker panels (breakers.ts).
 *
 * Not fitted / not built (see docs/aircraft/g800.md §10.2): windshield wipers (the Gulfstream
 * GVI/GVIII family uses heated, coated windshields without wipers, EST), hardware audio control
 * panels (Symmetry audio is on the touch-screen controllers' RADIOS app), a flight-deck door
 * control (no G800 door-lock system data).
 *
 * Positions EST from G500/G600/G700 flight-deck photographs.
 */
import * as THREE from 'three';
import { AnnunciatorLight, SelectorKnob } from '../../../../cockpit/controls';
import { trimBoxGeometry } from '../../../../cockpit/geometry/structure';
import { G800_LIMITS } from '../../data';
import { G800_VARS as V } from '../../vars';
import type { G800CockpitContext } from '../context';
import { halfWidth } from '../glazing';
import { MOUNTS, SHELL_INSET } from '../layout';
import { CB_PANEL_LEFT, CB_PANEL_RIGHT, cbPanelSize, fillCbPanel } from './breakers';
import { MaskStowage, Tiller } from './controls';

/** Sidewall CB panels: centre x / z (body), EST behind each seat below the aft side window (sill z -0.52). */
const CB_PANEL = { x: 11.76, z: -0.2 };

export function buildSideConsoles(c: G800CockpitContext): void {
  const { b, env, sys } = c;

  // =============================================================== outboard consoles
  for (const side of [1, 2] as const) {
    const m = side === 1 ? MOUNTS.sideLeft : MOUNTS.sideRight;
    const s = side === 1 ? 'L' : 'R';
    const outb = side === 1 ? -1 : 1; // panel u toward the sidewall
    const con = b.panel({ name: `g800.side_${s.toLowerCase()}`, ...m, material: 'panelDark', screws: { kind: 'dzus', diameter: 0.006, inset: 0.008 }, radius: 0.01 });
    // Oxygen mask stowage box (aft), regulator and flow indicator (dossier §9.4).
    const maskV = -0.12;
    con.add(new MaskStowage(env, { id: `g800.side.mask${side}`, label: `${s} CREW O2 MASK`, var: V.oxyMask(side) }), 0.02 * -outb, maskV);
    con.add(
      new SelectorKnob(env, {
        id: `g800.side.oxy_mode${side}`,
        label: `${s} MASK REGULATOR`,
        var: V.oxyMode(side),
        positions: [
          { value: 0, label: 'NORM', angle: -40 },
          { value: 1, label: '100%', angle: 0 },
          { value: 2, label: 'EMER', angle: 40 },
        ],
        initial: 0,
        diameter: 0.016,
        labelHeight: 0.0022,
        title: 'O2 MASK',
      }),
      outb * 0.1,
      maskV + 0.02,
    );
    const who = side === 1 ? 'pilot' : 'copilot';
    con.add(
      new AnnunciatorLight(env, {
        id: `g800.side.oxy_flow${side}`,
        label: `${s} O2 FLOW`,
        segments: [{ text: 'O2 FLOW', color: 'green', var: `oxy.${who}_flow_lpm`, test: (f) => f > 0.1 }],
        width: 0.02,
        height: 0.011,
      }),
      outb * 0.1,
      maskV - 0.045,
    );
    con.label('PULL MASK - SQUEEZE RED TABS', 0.02 * -outb, maskV - 0.085, { height: 0.0021 });

    if (side === 1) {
      // Tiller (forward end of the mount, just aft of the sidestick pod).
      con.add(new Tiller(env, { id: 'g800.side.tiller', label: 'NOSEWHEEL TILLER', var: V.tiller, maxDeg: G800_LIMITS.tillerSteerDeg }), 0, 0.14);
      con.label('STEER', 0, 0.075, { height: 0.0026 });
    }
  }

  // =============================================================== sidewall CB panels
  // CB panel paint: mid grey with white legends (EST, GVI-family CB panels) so the legends read in daylight.
  const cbPaint = env.materials.custom('paint', '#676b71', 0.6);
  const ratings = new Map(sys.elec.breakerNames().map((x) => [x.name, x.ratingA] as [string, number]));
  for (const side of [1, 2] as const) {
    const groups = side === 1 ? CB_PANEL_LEFT : CB_PANEL_RIGHT;
    const [w, h] = cbPanelSize(groups);
    const sgn = side === 1 ? -1 : 1;
    // Flat panel standing off the curved sidewall at its closest point (upper edge), with a backing box.
    const yWall = Math.min(halfWidth(CB_PANEL.x, CB_PANEL.z - h / 2, SHELL_INSET), halfWidth(CB_PANEL.x, CB_PANEL.z + h / 2, SHELL_INSET));
    const y = sgn * (yWall - 0.03);
    const box = trimBoxGeometry(w + 0.02, h + 0.02, 0.06, 0.006);
    const bm = b.structureMesh(box, 'panelDark', [CB_PANEL.x, y + sgn * 0.03, CB_PANEL.z]);
    bm.rotation.y = Math.PI / 2;
    bm.name = `cb_panel_box_${side}`;
    const p = b.panel({
      name: `g800.cb_${side === 1 ? 'l' : 'r'}`,
      center_m: [CB_PANEL.x, y, CB_PANEL.z],
      facing: side === 1 ? 'right' : 'left',
      width: w,
      height: h,
      origin: 'top-left',
      material: cbPaint,
      screws: { kind: 'dzus', diameter: 0.006, inset: 0.007, pitch: 0.15 },
      radius: 0.006,
    });
    fillCbPanel(env, p, groups, ratings);
  }
  void THREE;
}
