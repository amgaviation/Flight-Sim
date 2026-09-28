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
 * the consoles carry no audio control panel; each carries the MIC SEL
 * (MASK / BOOM) switchlight the DGAC CABIN ALTITUDE procedure calls for (EST
 * position). SCOPE: no headset / hand-mic jacks (no radio-transmit model).
 * Cockpit door: SCOPE, no door-lock control (the OG and FPG describe none).
 */
import * as THREE from 'three';
import { AnnunciatorLight, CircuitBreaker, PushButton, SelectorKnob } from '../../../../cockpit/controls';
import { trimBoxGeometry } from '../../../../cockpit/geometry/structure';
import { LON_VARS as V } from '../../vars';
import { lonMaterials, seg, type LonCockpitContext } from '../context';
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
  /** L50: the consoles run forward under the PFD GTC wedges (c_lcon); the tiller knob sits in the left console top. */
  xFwdRight: 8.2,
  xFwdLeft: 8.2,
  topZ: MOUNTS.sideLeft.center_m[2],
  y: Math.abs(MOUNTS.sideLeft.center_m[1]) + 0.06,
  width: 0.16,
};

/**
 * Circuit-breaker panels (L51, c_lcon / Textron photograph): on the forward sidewall beside the console, below the GTC
 * wedge and ahead of the seat, turned ~30 deg toward the pilot; breakers on a lettered-column / numbered-row grid
 * (left columns N.. / right AA.. in the photographs), the breaker name engraved under each. Position EST.
 */
export const CB_PANEL = { x: 7.76, y: 0.93, z: -0.03, yawDeg: 30, tiltDeg: 10 };

/** CB grid: rows of breakers at `pitch`, `rowPitch` (name under each). */
const CB = { rows: 5, pitch: 0.032, rowPitch: 0.036, diameter: 0.0095, margin: 0.024 };
/** Column letters (photographs: left panel N, O, P, ...; right panel AA, BB, CC, ...). */
const CB_LETTERS = {
  left: ['N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y'],
  right: ['AA', 'BB', 'CC', 'DD', 'EE', 'FF', 'GG', 'HH', 'JJ', 'KK', 'LL', 'MM'],
};

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
  const M = lonMaterials(env);
  b.structureMesh(trimBoxGeometry(S.width, bodyH, len, 0.01), M.trim, [xc, y, S.topZ + 0.0035 + bodyH / 2]).name = `console_${side}`;
  const p = b.panel({ name: `side_${side}`, center_m: [xc, y, S.topZ], facing: 'up', width: S.width, height: len, material: M.deck, radius: 0.008, screws: { kind: 'hex', diameter: 0.004, inset: 0.008, pitch: 0.3 } });

  // ---- crew oxygen (forward end)
  const who = side === 'left' ? 'PILOT' : 'COPILOT';
  const s = side === 'left' ? 'l' : 'r';
  // Mask cup aft of the tiller knob (c_lcon), same station on both consoles.
  const vBox = TILLER.center_m[0] - 0.17 - xc;
  p.label(`${who} OXYGEN`, 0, vBox + 0.065, { height: 0.0028 });
  p.add(new MaskStowage(env, { id: `lon.sc.mask_${s}`, label: `${who} O2 MASK`, var: side === 'left' ? V.oxyMaskL : V.oxyMaskR, inboard: side === 'left' ? 1 : -1 }), 0, vBox);
  const vCtl = vBox - 0.085;
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

  // MIC SEL (DGAC CABIN ALTITUDE / EMERGENCY DESCENT step 2 "MIC SEL Buttons (both) - Mask"): selects the crew
  // mask microphone instead of the headset boom mic. EST position (no public photograph of the control): aft of the
  // regulator row beside the mask cup. SCOPE: no audio model; the state gates the mask-mic / intercom flags
  // (systems/logic.ts) and is shown on the switchlight (MASK green / BOOM white).
  const vMic = vCtl - 0.036;
  p.add(
    new PushButton(env, {
      id: `lon.sc.mic_sel_${s}`,
      label: `${who} MIC SEL`,
      var: side === 'left' ? V.micSelL : V.micSelR,
      mode: 'toggle',
      stateNames: ['BOOM', 'MASK'],
      style: 'korry',
      width: 0.018,
      height: 0.014,
      segments: [seg.eq('MASK', 'green', side === 'left' ? V.micSelL : V.micSelR, 1), seg.eq('BOOM', 'white', side === 'left' ? V.micSelL : V.micSelR, 0)],
    }),
    0,
    vMic,
  );
  p.label('MIC SEL', 0, vMic + 0.013, { height: 0.0022 });

  // ---- circuit breakers: forward sidewall grid panel turned toward the pilot (L51), in a black trim housing.
  const C = CB_PANEL;
  const groups = cbGroupsFor(side, c.sys.elec.breakerNames());
  const items = groups.flatMap((g) => g.items.map((it) => ({ ...it, bus: g.title })));
  const cols = Math.ceil(items.length / CB.rows);
  const w = CB.margin * 2 + (cols - 1) * CB.pitch + 0.01;
  const h = CB.margin + 0.012 + (CB.rows - 1) * CB.rowPitch + 0.02;
  const cbp = b.panel({
    name: `cb_${side}`,
    center_m: [C.x, sgn * C.y, C.z],
    facing: side === 'left' ? 'right' : 'left',
    // Turned toward the pilot (aft): facing 'right' has +u forward, so a negative yaw turns the left panel aft.
    yawDeg: side === 'left' ? -C.yawDeg : C.yawDeg,
    tiltDeg: C.tiltDeg,
    width: w,
    height: h,
    origin: 'top-left',
    material: M.deck,
    radius: 0.008,
    screws: { kind: 'hex', diameter: 0.004, inset: 0.007 },
  });
  const housing = new THREE.Mesh(new THREE.BoxGeometry(w + 0.02, h + 0.02, 0.09), M.trim);
  b.trackGeometry(housing.geometry);
  housing.userData.cockpitStatic = true;
  housing.name = `cb_housing_${side}`;
  cbp.addObject(housing, w / 2, h / 2, { z: -0.046 });
  const letters = CB_LETTERS[side];
  // The forward end is the panel's +u side on the left wall (-u on the right): column letters run from the forward end.
  const colX = (col: number) => (side === 'left' ? w - CB.margin - col * CB.pitch : CB.margin + col * CB.pitch);
  for (let col = 0; col < cols; col++) cbp.label(letters[col] ?? String(col + 1), colX(col), 0.011, { height: 0.0042 });
  for (let row = 0; row < CB.rows; row++) cbp.label(String(row + 1), side === 'left' ? 0.008 : w - 0.008, CB.margin + 0.004 + row * CB.rowPitch, { height: 0.004 });
  items.forEach((it, i) => {
    const col = Math.floor(i / CB.rows);
    const row = i % CB.rows;
    cbp.add(
      new CircuitBreaker(c.env, {
        id: `lon.cb.${it.name}`,
        label: `CB ${letters[col] ?? col + 1}${row + 1} ${it.bus}: ${it.label}`,
        var: `cb.${it.name}`,
        trippedVar: `cb.${it.name}_tripped`,
        rating: ratingText(it.ratingA),
        name: it.label,
        diameter: CB.diameter,
      }),
      colX(col),
      CB.margin + 0.004 + row * CB.rowPitch,
    );
  });
}

/** CB panel height (m) for `n` breakers on the 5-row grid (kept for the breaker tests). */
export function cbPanelHeight(groupSizes: number[]): number {
  void groupSizes;
  return CB.margin + 0.012 + (CB.rows - 1) * CB.rowPitch + 0.02;
}
