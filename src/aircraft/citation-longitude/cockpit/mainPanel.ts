/**
 * Longitude main instrument panel, outboard GTC wedges and the lower sub-panels.
 *
 * Display band (dossier §7.2, OG 2-2, BCA): L PFD, MFD, R PFD (three 14 in GDU 1400W, landscape), PFD centres
 * +-0.41 m (Textron panel photograph). Gaspers (eyeball outlets) at the upper outboard corner of each PFD (L14,
 * Textron photograph / a21_004). The standby display, display controllers and MASTER lights are on the second tier
 * above the displays (glareshield.ts).
 *
 * Outboard PFD GTCs (L13): each on an angled wedge below and outboard of its PFD, turned toward its pilot (OG 4-2:
 * "the outboard PFD GTC, located to the left (pilot) or right (co-pilot) of the main PFD screen"; Textron / c_lcon).
 *
 * Lower band (L21): black knee-pod face with a compact system sub-panel under the inboard half of each PFD and an
 * outboard dimmer strip beside the yoke column.
 *  - Pilot: ELECTRICAL (c_lowL21 measured at 0.275 mm/px on a 250 mm panel; OG Fig 5-3-1, 5-4..5-6):
 *      row 1  L MAIN, L ELEC, INTERIOR, R ELEC, R MAIN
 *      row 2  STBY PWR toggle (ON / OFF / TEST, LED to its left), L GEN toggle, BUS TIE, R GEN toggle
 *      row 3  APU GEN toggle, L BATT, R BATT, EXT PWR
 *    joined by the white bus mimic of the photograph.
 *  - Copilot: LANDING GEAR (wheel handle, GEAR UP / GEAR DOWN arrow; gear position is on the EIS, OG 14-4) and ICE
 *    PROTECTION (ENGINE L / R, WING, STAB, PITOT/STATIC; c_lowR21, OG Fig 12-3-1).
 *  - Outboard strips: "L/R PFD GTC DIM" (OFF arc) and "MAP LIGHT" (MIN arc) knobs (OG Fig 16-2-2, 16-3-1).
 * EMER/PARK BRAKE moved to the pedestal (L22, pedestal.ts).
 */
import * as THREE from 'three';
import { AnnunciatorLight, GearHandle, PushButton, RotaryKnob, TBarHandle, ToggleSwitch, type LegendSegment } from '../../../cockpit/controls';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { trimBoxGeometry } from '../../../cockpit/geometry/structure';
import { cylinderZ, merge, torusZ, transform } from '../../../cockpit/geometry/primitives';
import { LON_VARS as V } from '../vars';
import { lonMaterials, seg, type LonCockpitContext } from './context';
import { FLOOR_Z, GTC, GTC_WEDGE, LOWER_PANEL, MAIN_PANEL, PFD_U, GDU } from './layout';
import { addGdu, addGtc } from './garmin';
import { Gasper } from './controls';

/** Switchlight size of the Longitude sub-panels (c_lowL21 / c_lowR21: ~30 x 25 mm caps). */
const SL = { w: 0.028, h: 0.023 };

/** Longitude switchlight with the legend convention (normal state cyan in the upper half, off-normal lower half). */
function pb(c: LonCockpitContext, panel: Panel, id: string, label: string, v: string, x: number, y: number, legends: (Parameters<typeof seg.eq> | LegendSegment)[], name?: string | null): PushButton {
  const segments = legends.map((l) => (Array.isArray(l) ? seg.eq(...(l as Parameters<typeof seg.eq>)) : l));
  const btn = panel.add(new PushButton(c.env, { id, label, var: v, mode: 'toggle', style: 'korry', width: SL.w, height: SL.h, layout: 'stack', unlitTint: 0.05, segments }), x, y);
  if (name !== null) panel.label(name ?? label, x, y - SL.h / 2 - 0.006, { height: 0.0029 });
  return btn;
}

/** Vertical engraved word (the lower sub-panels engrave the toggles' OFF position vertically, c_lowL21). */
function vertical(panel: Panel, text: string, x: number, y: number, h = 0.0026): void {
  for (let i = 0; i < text.length; i++) panel.label(text[i], x, y - (i - (text.length - 1) / 2) * h * 1.35, { height: h });
}

/** Dimmer knob with its engraved range arc end label (OFF / MIN). */
function dimmer(c: LonCockpitContext, panel: Panel, id: string, label: string, knobVar: string, x: number, y: number, title: string[], endLabel: string, innerVar?: string): void {
  panel.add(
    new RotaryKnob(c.env, {
      id,
      label,
      cap: 'dimmer',
      innerCap: 'dimmer',
      diameter: innerVar ? 0.02 : 0.016,
      outer: { var: knobVar, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label: innerVar ? 'PFD' : title.join(' '), format: (v) => (v >= 0.999 ? 'BRT' : `${Math.round(v * 100)} %`) },
      inner: innerVar ? { var: innerVar, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label: 'GTC', format: (v) => (v >= 0.999 ? 'BRT' : `${Math.round(v * 100)} %`) } : undefined,
    }),
    x,
    y,
  );
  title.forEach((t, i) => panel.label(t, x, y + 0.03 - i * 0.0045 + (title.length - 1) * 0.0045, { height: 0.0026 }));
  panel.label(endLabel, x - 0.015, y - 0.014, { height: 0.0019 });
  // Range arc (engraved, 7 segments from the end stop clockwise).
  for (let k = 0; k < 7; k++) {
    const a0 = THREE.MathUtils.degToRad(230 - k * 40);
    const a1 = THREE.MathUtils.degToRad(230 - (k + 1) * 40 + 8);
    const r = 0.0135;
    panel.line(x + r * Math.cos(a0), y + r * Math.sin(a0), x + r * Math.cos(a1), y + r * Math.sin(a1), 0.0005 + k * 0.00012);
  }
}

export function buildMainPanel(c: LonCockpitContext): void {
  const { b, env, suite } = c;
  const M = lonMaterials(env);
  const main = b.panel({ name: 'main', center_m: MAIN_PANEL.center_m, facing: 'aft', tiltDeg: MAIN_PANEL.tiltDeg, width: MAIN_PANEL.width, height: MAIN_PANEL.height, material: M.deck, radius: 0.012, screws: false });
  const gdus = c.headless ? null : suite;
  addGdu(c, main, 'pfd1', gdus?.pfd1, -PFD_U, 0);
  addGdu(c, main, 'mfd', gdus?.mfd, 0, 0);
  addGdu(c, main, 'pfd2', gdus?.pfd2, PFD_U, 0);
  // Gaspers at the upper outboard PFD corners (L14). SCOPE: cockpit airflow state (systems/crewControls.ts).
  for (const side of [-1, 1] as const) {
    main.add(
      new Gasper(env, { id: `lon.mp.gasper_${side < 0 ? 'l' : 'r'}`, label: `${side < 0 ? 'PILOT' : 'COPILOT'} GASPER`, var: side < 0 ? V.gasperL : V.gasperR, diameter: 0.058 }),
      side * (PFD_U + GDU.bezelW / 2 + 0.042),
      GDU.bezelH / 2 - 0.03,
    );
  }
  buildGtcWedges(c);
  buildLowerLeft(c);
  buildLowerRight(c);
}

/** Outboard PFD GTC wedges (L13). */
function buildGtcWedges(c: LonCockpitContext): void {
  const { b, env, suite } = c;
  const M = lonMaterials(env);
  const W = GTC_WEDGE;
  const gdus = c.headless ? null : suite;
  for (const side of [-1, 1] as const) {
    const p = b.panel({
      name: side < 0 ? 'gtc_wedge_l' : 'gtc_wedge_r',
      center_m: [W.x, side * W.y, W.z],
      facing: 'aft',
      tiltDeg: W.tiltDeg,
      yawDeg: -side * W.yawDeg,
      width: W.width,
      height: W.height,
      material: M.deck,
      radius: 0.01,
      screws: false,
    });
    // Wedge body back to the panel / sidewall (dark trim).
    const body = new THREE.Mesh(trimBoxGeometry(W.width + 0.01, W.height + 0.01, 0.14, 0.01), M.trim);
    b.trackGeometry(body.geometry);
    body.userData.cockpitStatic = true;
    body.name = `gtc_wedge_body_${side < 0 ? 'l' : 'r'}`;
    p.addObject(body, 0, 0, { z: -0.072 });
    addGtc(c, p, side < 0 ? 'gtc1' : 'gtc4', gdus?.gtc(side < 0 ? 'gtc1' : 'gtc4'), 0, (W.height - GTC.faceH) / 2 - 0.012);
  }
}

/** Lower band: full-width black knee-pod face (backing) and the column wells. */
function lowerBand(c: LonCockpitContext, side: -1 | 1): Panel {
  const { b, env } = c;
  const M = lonMaterials(env);
  const L = LOWER_PANEL;
  const w = L.yOut - L.yIn;
  const h = L.zBottom - L.zTop;
  const p = b.panel({ name: side < 0 ? 'lower_l' : 'lower_r', center_m: [L.x + 0.004, side * (L.yIn + w / 2), (L.zTop + L.zBottom) / 2], facing: 'aft', tiltDeg: 3, width: w, height: h, material: M.trim, radius: 0.01, screws: false });
  // Yoke column well under the band (knee pods either side of the column), dark trim, down to the floor.
  const wellH = FLOOR_Z - L.zBottom;
  b.structureMesh(trimBoxGeometry(0.13, wellH, 0.2, 0.012), M.trim, [L.x - 0.11, side * 0.45, L.zBottom + wellH / 2]).name = `column_well_${side < 0 ? 'l' : 'r'}`;
  return p;
}

/** Sub-panel (black deck plate) on a lower band at |y| = yc (m), local centre. */
function subAt(c: LonCockpitContext, band: Panel, side: -1 | 1, name: string, yc: number, w: number): Panel {
  const L = LOWER_PANEL;
  const bandCentre = side * (L.yIn + (L.yOut - L.yIn) / 2);
  return band.subPanel({ name, x: side * yc - bandCentre, y: 0, width: w, height: L.zBottom - L.zTop - 0.004, material: lonMaterials(c.env).deck, screws: { kind: 'hex', diameter: 0.003, inset: 0.006 }, origin: 'top-left', z: 0.003, radius: 0.008 });
}

function buildLowerLeft(c: LonCockpitContext): void {
  const { env } = c;
  const L = LOWER_PANEL;
  const band = lowerBand(c, -1);
  const p = subAt(c, band, -1, 'elec_panel', L.sysY, L.sysW);
  // ---- ELECTRICAL (positions: c_lowL21, x from the left edge / y down from the top of a 260 x 180 mm plate)
  p.label('ELECTRICAL', 0.126, 0.009, { height: 0.0034 });
  p.line(0.015, 0.009, 0.098, 0.009, 0.0008);
  p.line(0.154, 0.009, 0.245, 0.009, 0.0008);
  const r1 = 0.036;
  pb(c, p, 'lon.lp.main_l', 'L MAIN', V.mainL, 0.037, r1, [['ON', 'cyan', V.mainL, 1], ['OFF', 'white', V.mainL, 0]]);
  pb(c, p, 'lon.lp.elec_l', 'L ELEC', V.elecL, 0.07, r1, [['NORM', 'cyan', V.elecL, 1], ['EMER', 'amber', V.elecL, 0]]);
  pb(c, p, 'lon.lp.interior', 'INTERIOR', V.interior, 0.126, r1, [['NORM', 'cyan', V.interior, 1], ['OFF', 'white', V.interior, 0]]);
  pb(c, p, 'lon.lp.elec_r', 'R ELEC', V.elecR, 0.182, r1, [['NORM', 'cyan', V.elecR, 1], ['EMER', 'amber', V.elecR, 0]]);
  pb(c, p, 'lon.lp.main_r', 'R MAIN', V.mainR, 0.215, r1, [['ON', 'cyan', V.mainR, 1], ['OFF', 'white', V.mainR, 0]]);
  // Row 2: STBY PWR (ON up / OFF centre / TEST down momentary; amber / green LED to its left, OG 5-5), L GEN, BUS TIE, R GEN.
  const r2 = 0.09;
  const toggle = (id: string, v: string, name: string, x: number, y: number, positions: string[], values: number[], springs: Partial<Record<number, number>>, initial: number, offSide: -1 | 1, bottom: string) => {
    p.add(new ToggleSwitch(env, { id, var: v, label: name, positions, values, initial, springs, labels: { name: false, positions: false } }), x, y);
    p.label(name, x, y - 0.024, { height: 0.0027 });
    p.label('ON', x, y - 0.018, { height: 0.0026 });
    // L2-15 / LON4-11: the vertical OFF sits 13.5 mm out so it clears the switch nut / bushing (c_lowL21 engraves
    // OFF beside the lever; the lever itself still crowds ON in the photo, so only the OFF offset is widened).
    vertical(p, 'OFF', x + offSide * 0.0135, y);
    p.label(bottom, x, y + 0.019, { height: 0.0026 });
  };
  toggle('lon.lp.stby_pwr', V.stbyPwr, 'STBY PWR', 0.026, r2, ['TEST', 'OFF', 'ON'], [2, 0, 1], { 0: 1 }, 1, -1, 'TEST');
  p.add(
    new AnnunciatorLight(env, {
      id: 'lon.lp.stby_led',
      label: 'STBY PWR LED',
      width: 0.005,
      height: 0.005,
      unlitTint: 0.05,
      segments: [seg.eq('', 'amber', V.stbyBattLed, 1), seg.eq('', 'green', V.stbyBattLed, 2)],
      layout: 'split',
    }),
    0.008,
    r2 - 0.012,
  );
  // GEN L / APU / R: RESET (momentary, down) / OFF / ON (up). OFF engraved outboard: left of L GEN / APU GEN, right of R GEN.
  toggle('lon.lp.gen_l', V.genL, 'L GEN', 0.068, r2 + 0.002, ['RESET', 'OFF', 'ON'], [2, 0, 1], { 0: 1 }, 2, -1, 'RESET');
  pb(c, p, 'lon.lp.bus_tie', 'BUS TIE', V.busTieBtn, 0.115, r2 + 0.006, [['OPEN', 'cyan', V.busTieClosed, 0], seg.on('CLOSED', 'amber', V.busTieClosed)]);
  toggle('lon.lp.gen_r', V.genR, 'R GEN', 0.161, r2 + 0.002, ['RESET', 'OFF', 'ON'], [2, 0, 1], { 0: 1 }, 2, 1, 'RESET');
  // Row 3: APU GEN, L BATT, R BATT, EXT PWR.
  const r3 = 0.15;
  toggle('lon.lp.gen_apu', V.genApu, 'APU GEN', 0.045, r3, ['RESET', 'OFF', 'ON'], [2, 0, 1], { 0: 1 }, 2, -1, 'RESET');
  pb(c, p, 'lon.lp.batt_l', 'L BATT', V.battL, 0.093, r3 + 0.006, [['ON', 'cyan', V.battL, 1], ['OFF', 'amber', V.battL, 0]]);
  pb(c, p, 'lon.lp.batt_r', 'R BATT', V.battR, 0.127, r3 + 0.006, [['ON', 'cyan', V.battR, 1], ['OFF', 'amber', V.battR, 0]]);
  pb(c, p, 'lon.lp.ext_pwr', 'EXT PWR', V.extPwr, 0.184, r3 + 0.006, [seg.on('AVAIL', 'white', 'elec.gpu_avail'), seg.on('ON', 'cyan', V.extPwr)]);
  // White bus mimic (c_lowL21): L bus under L MAIN / L ELEC down to the batteries, R bus mirrored to EXT PWR, BUS TIE stubs.
  const lw = 0.0009;
  p.line(0.028, 0.055, 0.079, 0.055, lw);
  p.line(0.028, 0.055, 0.028, 0.059, lw);
  p.line(0.086, 0.055, 0.092, 0.055, lw);
  p.line(0.092, 0.055, 0.092, 0.122, lw);
  p.line(0.092, 0.1, 0.1, 0.1, lw);
  p.line(0.092, 0.122, 0.072, 0.122, lw);
  p.line(0.072, 0.122, 0.072, 0.16, lw);
  p.line(0.066, 0.16, 0.078, 0.16, lw);
  p.line(0.17, 0.055, 0.224, 0.055, lw);
  p.line(0.224, 0.055, 0.224, 0.059, lw);
  p.line(0.164, 0.055, 0.14, 0.055, lw);
  p.line(0.14, 0.055, 0.14, 0.122, lw);
  p.line(0.13, 0.1, 0.14, 0.1, lw);
  p.line(0.14, 0.122, 0.158, 0.122, lw);
  p.line(0.158, 0.122, 0.158, 0.16, lw);
  p.line(0.152, 0.16, 0.164, 0.16, lw);
  // ---- outboard dimmer strip: L PFD GTC DIM (outer PFD / inner GTC) and MAP LIGHT.
  const d = subAt(c, band, -1, 'dim_l', L.dimY, L.dimW);
  dimmer(c, d, 'lon.lp.dim_pfd', 'L PFD GTC DIM', V.ltPfdL, L.dimW / 2 - 0.03, 0.06, ['L PFD', 'GTC DIM'], 'OFF', V.ltGtcL);
  dimmer(c, d, 'lon.lp.map', 'MAP LIGHT (L)', V.ltMapL, L.dimW / 2 + 0.03, 0.06, ['MAP', 'LIGHT'], 'MIN');
}

function buildLowerRight(c: LonCockpitContext): void {
  const { env } = c;
  const L = LOWER_PANEL;
  const band = lowerBand(c, 1);
  const p = subAt(c, band, 1, 'gear_ice_panel', L.sysY, L.sysW);
  // ---- LANDING GEAR (c_lowR21 at 0.252 mm/px): wheel handle in its slot, GEAR UP / GEAR DOWN arrow, bracket title.
  const gx = 0.05;
  p.bracket('LANDING GEAR', gx, 0.03, 0.066);
  p.add(
    new GearHandle(env, {
      id: 'lon.lp.gear',
      var: V.gearHandle,
      label: 'LANDING GEAR',
      positions: ['DN', 'UP'],
      values: [1, 0],
      // Down-lock solenoid: UP blocked on the ground (LandingGear gear.handle_lock).
      inhibit: (to, _from, v) => !(to === 1 && v.get('gear.handle_lock') !== 0),
      length: 0.065,
      // L2-07 (a21_004 / c_lowR21): the lever ends in a chunky wheel-profile knob, a flattened white disc ~30 mm
      // across, not the small default wheel. Additive GearHandle.knobGeometry override.
      knobGeometry: {
        key: 'lon.gear.knob',
        build: () => {
          const tyre = torusZ(0.0095, 0.0055, 12, 36);
          tyre.scale(1, 1, 0.75); // flattened disc profile
          transform(tyre, 0, 0, 0.009);
          const hub = cylinderZ(0.0078, 0.0082, 0.003, 0.0145, 24);
          const g = merge([tyre, hub]);
          tyre.dispose();
          hub.dispose();
          return g;
        },
      },
    }),
    gx,
    0.105,
  );
  p.label('GEAR', 0.072, 0.058, { height: 0.0027 });
  p.label('UP', 0.072, 0.063, { height: 0.0027 });
  p.line(0.073, 0.068, 0.073, 0.132, 0.0006);
  p.line(0.071, 0.07, 0.073, 0.068, 0.0006);
  p.line(0.075, 0.07, 0.073, 0.068, 0.0006);
  p.line(0.071, 0.13, 0.073, 0.132, 0.0006);
  p.line(0.075, 0.13, 0.073, 0.132, 0.0006);
  p.label('GEAR', 0.074, 0.138, { height: 0.0027 });
  p.label('DOWN', 0.074, 0.143, { height: 0.0027 });
  // ---- ICE PROTECTION: ENGINE L / R, WING / STAB, PITOT/STATIC (2-2-1 block; OFF cyan in the lower half).
  const ix = 0.186;
  p.bracket('ICE PROTECTION', ix, 0.012, 0.085);
  p.bracket('ENGINE', ix, 0.02, 0.07);
  p.label('L', ix - 0.015, 0.028, { height: 0.0027 });
  p.label('R', ix + 0.015, 0.028, { height: 0.0027 });
  const ai = (v: string): (Parameters<typeof seg.eq> | LegendSegment)[] => [['ON', 'white', v, 1], ['OFF', 'cyan', v, 0]];
  pb(c, p, 'lon.lp.ai_eng_l', 'ENGINE L ANTI-ICE', V.aiEngL, ix - 0.015, 0.047, ai(V.aiEngL), null);
  pb(c, p, 'lon.lp.ai_eng_r', 'ENGINE R ANTI-ICE', V.aiEngR, ix + 0.015, 0.047, ai(V.aiEngR), null);
  pb(c, p, 'lon.lp.ai_wing', 'WING ANTI-ICE', V.aiWing, ix - 0.015, 0.098, ai(V.aiWing), 'WING');
  pb(c, p, 'lon.lp.ai_stab', 'STAB DE-ICE', V.aiStab, ix + 0.015, 0.098, ai(V.aiStab), 'STAB');
  pb(c, p, 'lon.lp.pitot', 'PITOT / STATIC', V.pitotStatic, ix - 0.01, 0.15, [['NORM', 'cyan', V.pitotStatic, 0], ['ON', 'amber', V.pitotStatic, 1]], 'PITOT/STATIC');
  // ---- outboard dimmer strip: R PFD GTC DIM and MAP LIGHT.
  const d = subAt(c, band, 1, 'dim_r', L.dimY, L.dimW);
  dimmer(c, d, 'lon.lp.map_r', 'MAP LIGHT (R)', V.ltMapR, L.dimW / 2 - 0.03, 0.06, ['MAP', 'LIGHT'], 'MIN');
  dimmer(c, d, 'lon.lp.dim_pfd_r', 'R PFD GTC DIM', V.ltPfdR, L.dimW / 2 + 0.03, 0.06, ['R PFD', 'GTC DIM'], 'OFF', V.ltGtcR);
  // EMER GEAR EXTENSION T-handle. EST: not visible on the copilot sub-panel in the AOPA 2021 photograph (c_lowR21),
  // so it is placed below that sub-panel on the copilot knee-pod face (Citation-family location under the copilot
  // panel); real location not in the reference set.
  const knee = c.b.panel({ name: 'emer_gear_mount', center_m: [L.x - 0.005, L.sysY + 0.02, L.zBottom + 0.035], facing: 'aft', tiltDeg: 3, width: 0.09, height: 0.05, material: lonMaterials(env).trim, screws: false, radius: 0.006 });
  knee.add(new TBarHandle(env, { id: 'lon.lp.gear_emer', var: V.gearEmer, label: 'EMER GEAR EXTENSION', style: 'tbar', legend: 'EMER GEAR', material: 'knobRed', scale: 0.9 }), 0, -0.004);
  knee.label('EMER GEAR', 0, 0.018, { height: 0.0026 });
}
