/**
 * Citation Longitude side consoles (loaded by cockpit/index.ts through
 * import.meta.glob; contract in cockpit/context.ts).
 *
 * Each console runs along the sidewall beside the seat (MOUNTS.sideLeft /
 * sideRight, layout.ts; EST geometry) and carries, forward to aft:
 *   - the crew oxygen: quick-donning mask stowage box (dossier §4.8 / §7.8,
 *     `ac.lon.oxy.mask_l/_r`), the mask regulator selector NORM / 100 % /
 *     EMER (`ac.lon.oxy.mode` / `mode_r`), PRESS TO TEST (`ac.lon.oxy.test_l/_r`)
 *     and the flow indicator (`oxy.pilot_flowing` / `oxy.copilot_flowing`);
 *   - the circuit-breaker panel for that side's buses (breakers.ts), on the
 *     lower sidewall between the console and the side-window sill beside the
 *     seat (EST: kept clear of the seat's outboard armrest, which covers the
 *     console top aft of the seat front).
 * The left console's forward end is the nosewheel tiller (built by the main
 * cockpit, TILLER in layout.ts); this builder stops the console top short of it.
 *
 * Audio: the G5000 audio panel is the GTC "Audio & Radios" page (OG 4), so
 * the consoles carry no audio control panel. SCOPE: no headset / hand-mic
 * jacks or PTT (no radio-transmit model).
 * Cockpit door: SCOPE, no door-lock control (the OG and FPG describe none).
 */
import * as THREE from 'three';
import { AnnunciatorLight, CircuitBreaker, PushButton, SelectorKnob } from '../../../../cockpit/controls';
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import { trimBoxGeometry } from '../../../../cockpit/geometry/structure';
import { LON_VARS as V } from '../../vars';
import { seg, type LonCockpitContext } from '../context';
import { FLOOR_Z, MOUNTS, TILLER } from '../layout';
import { cbGroupsFor, ratingText } from './breakers';
import { MaskStowage } from './oxygenMask';

/**
 * Console extent (EST): aft end x 7.10 (seat back), forward end at the panel knee (right) or the tiller (left).
 * Moved 60 mm outboard of MOUNTS.side* (y 0.90, 0.16 m wide) so the seat armrests clear it; the outer edge stays
 * inside the sidewall at floor level (interior half-width ~0.94 m at z 0.62, shell.ts interiorHalfWidth).
 */
export const SIDE_CONSOLE = {
  xAft: 7.1,
  xFwdRight: 8.0,
  /** Left console top stops aft of the tiller mount (TILLER centre 7.90, mount 0.13 long). */
  xFwdLeft: TILLER.center_m[0] - 0.07,
  topZ: MOUNTS.sideLeft.center_m[2],
  y: Math.abs(MOUNTS.sideLeft.center_m[1]) + 0.06,
  width: 0.16,
};

/** Sidewall circuit-breaker panel (EST): below the side-window sill (z -0.32), beside the seat, face tilted 8 deg up. */
export const CB_PANEL = { x: 7.43, y: 1.045, z: -0.08, length: 0.56, height: 0.25, tiltDeg: 8 };

/** CB layout inside a CB sub-panel. */
const CB = { cols: 16, pitch: 0.029, rowPitch: 0.032, titleH: 0.018, diameter: 0.0095 };

export function buildSideConsoles(c: LonCockpitContext): void {
  buildConsole(c, 'left');
  buildConsole(c, 'right');
}

function buildConsole(c: LonCockpitContext, side: 'left' | 'right'): void {
  const { b, env } = c;
  const S = SIDE_CONSOLE;
  const sgn = side === 'left' ? -1 : 1;
  const xFwd = side === 'left' ? S.xFwdLeft : S.xFwdRight;
  const len = xFwd - S.xAft;
  const xc = (xFwd + S.xAft) / 2;
  const y = sgn * S.y;

  // Console body down to the floor (dark), top panel flush on it.
  const bodyH = FLOOR_Z - S.topZ - 0.0035;
  b.structureMesh(trimBoxGeometry(S.width, bodyH, len, 0.01), 'panelDark', [xc, y, S.topZ + 0.0035 + bodyH / 2]).name = `console_${side}`;
  const p = b.panel({ name: `side_${side}`, center_m: [xc, y, S.topZ], facing: 'up', width: S.width, height: len, material: 'panel', radius: 0.008, screws: { kind: 'dzus', diameter: 0.007, inset: 0.008, pitch: 0.25 } });

  // ---- crew oxygen (forward end)
  const who = side === 'left' ? 'PILOT' : 'COPILOT';
  const s = side === 'left' ? 'l' : 'r';
  const vFwd = len / 2;
  const vBox = vFwd - 0.085;
  p.label(`${who} OXYGEN`, 0, vFwd - 0.014, { height: 0.0028 });
  p.add(new MaskStowage(env, { id: `lon.sc.mask_${s}`, label: `${who} O2 MASK`, var: side === 'left' ? V.oxyMaskL : V.oxyMaskR, inboard: side === 'left' ? 1 : -1 }), 0, vBox);
  const vCtl = vBox - 0.11;
  // Regulator: NORM (diluter) / 100 % / EMER (positive pressure), OxygenSystem crew mask `mode`.
  p.add(
    new SelectorKnob(env, {
      id: `lon.sc.oxy_mode_${s}`,
      label: `${who} O2 REGULATOR`,
      var: side === 'left' ? V.oxyMode : V.oxyModeR,
      positions: [
        { value: 0, label: 'NORM', angle: -40 },
        { value: 1, label: '100%', angle: 0 },
        { value: 2, label: 'EMER', angle: 40 },
      ],
      diameter: 0.016,
      labelRadius: 0.019,
    }),
    -0.05,
    vCtl,
  );
  // PRESS TO TEST (momentary) and the flow indicator (blinker lit while oxygen flows to the mask).
  p.add(
    new PushButton(env, {
      id: `lon.sc.oxy_test_${s}`,
      label: `${who} O2 PRESS TO TEST`,
      var: side === 'left' ? V.oxyTestL : V.oxyTestR,
      mode: 'momentary',
      style: 'round',
    }),
    0.022,
    vCtl,
  );
  p.label('PRESS TO TEST', 0.022, vCtl + 0.014, { height: 0.0021 });
  p.add(
    new AnnunciatorLight(env, {
      id: `lon.sc.oxy_flow_${s}`,
      label: `${who} O2 FLOW`,
      width: 0.014,
      height: 0.01,
      segments: [seg.on('FLOW', 'amber', side === 'left' ? 'oxy.pilot_flowing' : 'oxy.copilot_flowing')],
    }),
    0.062,
    vCtl,
  );

  // ---- circuit breakers: sidewall panel beside the seat, in a trim housing reaching back to the wall.
  // Height fits the breaker rows (the fixed 0.25 m left ~40 % of the panel empty); the top edge stays under the sill.
  const C = CB_PANEL;
  const groups = cbGroupsFor(side, c.sys.elec.breakerNames());
  const h = Math.min(C.height, cbPanelHeight(groups.map((g) => g.items.length)));
  const zc = C.z - C.height / 2 + h / 2;
  const cbp = b.panel({ name: `cb_${side}`, center_m: [C.x, sgn * C.y, zc], facing: side === 'left' ? 'right' : 'left', tiltDeg: C.tiltDeg, width: C.length, height: h, material: 'panel', radius: 0.008, screws: { kind: 'dzus', diameter: 0.007, inset: 0.008, pitch: 0.28 } });
  const housing = new THREE.Mesh(new THREE.BoxGeometry(C.length + 0.02, h + 0.02, 0.07), env.materials.get('interior'));
  b.trackGeometry(housing.geometry);
  housing.userData.cockpitStatic = true;
  housing.name = `cb_housing_${side}`;
  cbp.addObject(housing, 0, 0, { z: -0.036 });
  cbp.label(`${side === 'left' ? 'LEFT' : 'RIGHT'} CIRCUIT BREAKERS`, 0, h / 2 - 0.012, { height: 0.0034 });
  buildBreakers(c, cbp, groups, h / 2 - 0.032);
}

/** Panel height (m) that fits the header and the breaker groups (item counts per group). */
export function cbPanelHeight(groupSizes: number[]): number {
  let h = 0.032;
  for (const n of groupSizes) h += CB.titleH + Math.ceil(n / CB.cols) * CB.rowPitch + 0.008;
  return h + 0.006;
}

function buildBreakers(c: LonCockpitContext, p: Panel, groups: ReturnType<typeof cbGroupsFor>, yTop: number): void {
  let yy = yTop;
  const x0 = (-(CB.cols - 1) * CB.pitch) / 2;
  for (const g of groups) {
    p.label(g.title, 0, yy, { height: 0.0028 });
    p.line(x0 - 0.008, yy - 0.004, -x0 + 0.008, yy - 0.004, 0.0004);
    yy -= CB.titleH;
    g.items.forEach((it, i) => {
      const col = i % CB.cols;
      const row = Math.floor(i / CB.cols);
      // Rows centred on the panel.
      const inRow = Math.min(CB.cols, g.items.length - row * CB.cols);
      const xs = (-(inRow - 1) * CB.pitch) / 2;
      p.add(
        new CircuitBreaker(c.env, {
          id: `lon.cb.${it.name}`,
          label: `CB ${it.label}`,
          var: `cb.${it.name}`,
          trippedVar: `cb.${it.name}_tripped`,
          rating: ratingText(it.ratingA),
          name: it.label,
          diameter: CB.diameter,
        }),
        xs + col * CB.pitch,
        yy - row * CB.rowPitch,
      );
    });
    yy -= Math.ceil(g.items.length / CB.cols) * CB.rowPitch + 0.008;
  }
}
