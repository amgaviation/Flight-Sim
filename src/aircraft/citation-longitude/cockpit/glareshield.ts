/**
 * Longitude glareshield, two tiers (AOPA 2021 photographs c_gs21 / c_top21 / a21_004; Textron panel photograph):
 *
 *  GMC tier (glareshield face, GLARE_FACE), left to right: [bottle light] L ENG FIRE | GMC 710 | ENG FIRE R [bottle
 *  light] | APU FIRE. The GMC 710 is measured from c_gs21 (0.385 mm/px, 425 mm face); the fire switchlights sit
 *  0.237-0.24 m either side of its centre and APU FIRE right beside ENG FIRE R.
 *  Lower tier (UPPER_TIER, coplanar with the displays so it never shades them), measured from c_top21 (0.6 mm/px,
 *  140 mm controller): [MASTER CAUTION RESET][MASTER WARNING RESET] display controller | MAX AIRSPEED LIMITS placard
 *  | POWER RESERVE MANUAL / AUTO | standby display | knob | registration placard | display controller [MASTER
 *  WARNING RESET][MASTER CAUTION RESET]. CAUTION is outboard, WARNING inboard on each side (OG Fig 3-2-2).
 *
 * Unlit lenses are near black (layout audit L03/L05/L08: cold & dark shows no pastel legends).
 */
import { GuardedButton, PushButton, RotaryKnob } from '../../../cockpit/controls';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { LON_LIMITS } from '../data';
import { LON_VARS as V } from '../vars';
import { CK, lonMaterials, seg, type LonCockpitContext } from './context';
import { GLARE_FACE, UPPER_TIER } from './layout';
import { addDisplayController, addGmc710 } from './garmin';
import { LongitudeStandbyDisplay } from './standby';

/** Unlit lens tint for the glareshield switchlights (near black, L03). */
const DARK = 0.03;

export function buildGlareshield(c: LonCockpitContext): void {
  buildGmcTier(c);
  buildLowerTier(c);
}

function buildGmcTier(c: LonCockpitContext): void {
  const { b, env } = c;
  const face = b.panel({ name: 'glareshield_face', center_m: GLARE_FACE.center_m, facing: 'aft', tiltDeg: GLARE_FACE.tiltDeg, width: GLARE_FACE.width, height: GLARE_FACE.height, material: 'glareshield', screws: false, radius: 0.006 });
  addGmc710(c, face, 0, 0.0);
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'L' : 'R';
    const i = side < 0 ? 1 : 2;
    const fx = side * 0.238;
    // ENG FIRE switchlight (guarded, latching; c_gs21 "L ENG FIRE" / "ENG FIRE R" ~38 x 28 mm): closes the fuel /
    // hydraulic / bleed firewall valves and arms the bottles.
    face.add(
      new GuardedButton(env, {
        id: `lon.gs.fire_${s.toLowerCase()}`,
        label: `${s} ENG FIRE`,
        var: side < 0 ? V.fireEngL : V.fireEngR,
        mode: 'toggle',
        width: 0.036,
        height: 0.027,
        unlitTint: 0.03, // deep opaque red, legend barely visible unlit (L2-11: OEG p.12 / a21_004)
        segments: [{ text: side < 0 ? ['L ENG', 'FIRE'] : ['ENG R', 'FIRE'], color: 'red', var: `fire.eng${i}_warn`, style: 'field' }],
        guard: { color: 'clear', hinge: 'top', close: 'free' },
      }),
      fx,
      -0.012,
    );
    // Bottle switchlight directly above each ENG FIRE (c_gs21: dark square ~37 mm above the fire light). Momentary:
    // discharges that side's bottle into the armed engine. Legend EST (no legible source): ARMED / DISCH.
    const bn = i as 1 | 2;
    face.add(
      new PushButton(env, {
        id: `lon.gs.bottle${bn}`,
        label: `BOTTLE ${bn} ARMED / DISCH`,
        var: bn === 1 ? V.bottle1 : V.bottle2,
        mode: 'momentary',
        width: 0.03,
        height: 0.026,
        layout: 'stack',
        unlitTint: 0, // dark square until armed (c_gs21)
        segments: [seg.on('ARMED', 'green', CK.bottleArmed(bn)), seg.on('DISCH', 'amber', `fire.bottle${bn}_discharged`)],
      }),
      fx,
      0.023,
    );
  }
  // APU FIRE switchlight right of ENG FIRE R (c_gs21, AOPA 2021): APU shutdown, APU fuel shutoff and APU bottle
  // discharge (systems/environment.ts createApu / createFire, EST function).
  face.add(
    new GuardedButton(env, {
      id: 'lon.gs.fire_apu',
      label: 'APU FIRE',
      var: V.fireApu,
      mode: 'toggle',
      width: 0.034,
      height: 0.027,
      unlitTint: 0.03, // L2-11: matches the ENG FIRE lenses
      segments: [{ text: ['APU', 'FIRE'], color: 'red', var: 'fire.apu_warn', style: 'field' }],
      guard: { color: 'clear', hinge: 'top', close: 'free' },
    }),
    0.282,
    -0.012,
  );
}

function buildLowerTier(c: LonCockpitContext): void {
  const { b, env } = c;
  const M = lonMaterials(env);
  const T = UPPER_TIER;
  const p = b.panel({ name: 'upper_tier', center_m: T.center_m, facing: 'aft', tiltDeg: T.tiltDeg, width: T.width, height: T.height, material: M.deck, screws: false, radius: 0.004 });
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'L' : 'R';
    // Display controllers above each PFD (140 x 50 mm, c_top21 centres +-0.29 m).
    addDisplayController(c, p, side < 0 ? 1 : 2, side * 0.29, 0.002);
    // MASTER WARNING RESET (inboard, red) / MASTER CAUTION RESET (outboard, amber), ~30 x 24 mm (c_top21).
    p.add(
      new PushButton(env, {
        id: `lon.gs.mw_${s.toLowerCase()}`,
        label: `MASTER WARNING RESET (${s})`,
        mode: 'momentary',
        event: 'cas.ack_warning',
        width: 0.03,
        height: 0.024,
        unlitTint: DARK,
        segments: [{ text: ['MASTER', 'WARNING', 'RESET'], color: 'red', var: 'alert.master_warning', style: 'field' }],
      }),
      side * 0.384,
      0.004,
    );
    p.add(
      new PushButton(env, {
        id: `lon.gs.mc_${s.toLowerCase()}`,
        label: `MASTER CAUTION RESET (${s})`,
        mode: 'momentary',
        event: 'cas.ack_caution',
        width: 0.03,
        height: 0.024,
        unlitTint: DARK,
        segments: [{ text: ['MASTER', 'CAUTION', 'RESET'], color: 'amber', var: 'alert.master_caution', style: 'field' }],
      }),
      side * 0.423,
      0.004,
    );
  }
  airspeedPlacard(c, p, LON_LIMITS);
  powerReserve(c, p);
  // Standby flight display at the centre (c_top21 / Textron photograph; ~84 x 84 mm bezel), BARO knob at its lower right.
  const stby = c.headless ? null : new LongitudeStandbyDisplay({ vars: c.ctx.vars });
  const sub = p.subPanel({ name: 'stby', x: 0, y: -0.001, width: 0.086, height: 0.086, material: M.unit, screws: false, radius: 0.004 });
  // The DisplayManager reads `display.<id>.power` by default; point it at the standby bus load (dark with STBY PWR off).
  if (stby) sub.display(stby, 0, 0.004, 0.066, 0.066, { bezel: { border: 0.004, depth: 0.005 }, display: { powerVar: 'elec.stby_inst_powered' } });
  sub.add(
    new RotaryKnob(env, {
      id: 'lon.mp.stby_baro',
      label: 'STBY BARO',
      cap: 'knurled',
      diameter: 0.011,
      outer: { var: 'adc3.baro_inhg', min: 28.1, max: 31.0, step: 0.01, initial: 29.92, accel: { fastStep: 0.1 }, label: 'BARO', format: (v) => `${v.toFixed(2)} in` },
      push: { var: 'adc3.baro_std', mode: 'toggle', label: 'STD' },
    }),
    0.033,
    -0.034,
  );
  // Knob right of the standby (c_top21 x +0.069). EST function: standby display brightness.
  p.add(
    new RotaryKnob(env, {
      id: 'lon.mp.stby_dim',
      label: 'STBY DISPLAY BRIGHTNESS',
      cap: 'knurled',
      diameter: 0.012,
      outer: { var: V.ltStby, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label: 'STBY', format: (v) => `${Math.round(v * 100)} %` },
    }),
    0.069,
    0.013,
  );
  // Registration placard (c_top21: framed tail number right of the standby). EST registration.
  p.placard({ text: 'N700LG', height: 0.009, style: 'engraved', box: 0.08 }, 0.159, -0.004);
}

/** MAX AIRSPEED LIMITS placard left of the standby (c_top21 transcription; numbers from data.ts). */
function airspeedPlacard(c: LonCockpitContext, p: Panel, L: typeof LON_LIMITS): void {
  void c;
  const x = -0.165;
  p.label('MAX AIRSPEED LIMITS', x, 0.034, { height: 0.0026 });
  const rows: [string, string][] = [
    ['FLAP EXTENDED', ''],
    [`1: ${L.vfe1Kt} KIAS`, `GEAR EXT/OPERATING: ${L.vleKt} KIAS`],
    [`2: ${L.vfe2Kt} KIAS`, `TURBULENT AIR: ${L.vTurbKt} KIAS/${L.mTurb.toFixed(2).replace(/^0/, '')}M`],
    [`FULL: ${L.vfeFullKt} KIAS`, ''],
  ];
  rows.forEach(([a, bTxt], i) => {
    const y = 0.02 - i * 0.0085;
    if (a) p.label(a, x - 0.05, y, { height: 0.0021, align: 'left' });
    if (bTxt) p.label(bTxt, x - 0.008, y, { height: 0.0021, align: 'left' });
  });
}

/**
 * POWER RESERVE: bracket, MANUAL switchlight and the yellow-framed AUTO switchlight (c_top21, AOPA 2021). Logic in
 * systems/logic.ts (EST). Legends EST (not legible in the photographs): AUTO shows ARM (cyan) while armed and APR
 * (green) when the reserve is in force; MANUAL shows ON (white) when selected.
 */
function powerReserve(c: LonCockpitContext, p: Panel): void {
  const { env } = c;
  const xm = -0.107;
  const xa = -0.066;
  p.bracket('POWER RESERVE', (xm + xa) / 2, 0.031, 0.07);
  p.add(
    new PushButton(env, {
      id: 'lon.gs.apr_manual',
      label: 'POWER RESERVE MANUAL',
      var: V.aprManual,
      mode: 'toggle',
      style: 'korry',
      width: 0.022,
      height: 0.022,
      layout: 'stack',
      unlitTint: DARK,
      segments: [seg.eq('ON', 'white', V.aprManual, 1)],
    }),
    xm,
    0.004,
  );
  p.label('MANUAL', xm, 0.021, { height: 0.0022 });
  // Yellow frame round AUTO (c_top21).
  p.subPanel({ name: 'apr_auto_frame', x: xa, y: 0.004, width: 0.03, height: 0.03, material: 'guardYellow', screws: false, radius: 0.002, thickness: 0.002 });
  p.add(
    new PushButton(env, {
      id: 'lon.gs.apr_auto',
      label: 'POWER RESERVE AUTO',
      var: V.aprAuto,
      mode: 'toggle',
      style: 'korry',
      width: 0.022,
      height: 0.022,
      layout: 'stack',
      unlitTint: DARK,
      segments: [seg.eq('ARM', 'cyan', V.aprAuto, 1), seg.on('APR', 'green', V.aprActive)],
    }),
    xa,
    0.004,
    { z: 0.002 },
  );
  p.label('AUTO', xa, 0.021, { height: 0.0022 });
}
