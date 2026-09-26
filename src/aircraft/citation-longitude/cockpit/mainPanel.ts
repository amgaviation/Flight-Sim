/**
 * Longitude main instrument panel and the two lower sub-panels.
 *
 * Display band (dossier §7.2, OG 2-2, BCA): L PFD, MFD, R PFD (three 14 in
 * GDU 1400W, landscape) with the outboard PFD GTC 570s (OG 4-2: "the outboard
 * PFD GTC, located to the left (pilot) or right (co-pilot) of the main PFD
 * screen") and the standby flight display between the L PFD and the MFD
 * (EST position).
 *
 * Pilot lower sub-panel (OG 2-3: "Electrical system controls are contained on
 * the pilot side lower subpanel underneath the PFD, on the right side of the
 * panel"; dossier §7.3): electrical group, PFD/GTC dimmer + MAP LIGHT
 * outboard (OG 2-5 "knobs on the outboard side of each lower pilot/copilot
 * panel"), EMER/PARK BRAKE handle.
 * Copilot lower sub-panel (OG 2-4: ice protection "on the co-pilot lower
 * panel under the PFD, on the left side of the panel"; dossier §7.4):
 * landing gear handle with the gear lights at the inboard edge, EMER GEAR
 * handle, ice-protection buttons, PFD/GTC dimmer + MAP LIGHT outboard.
 */
import { AnnunciatorLight, GearHandle, PushButton, RotaryKnob, TBarHandle, ToggleSwitch, type LegendSegment } from '../../../cockpit/controls';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { LON_VARS as V } from '../vars';
import { CK, seg, type LonCockpitContext } from './context';
import { GTC_U, LOWER_PANEL, MAIN_PANEL, PFD_U } from './layout';
import { addGdu, addGtc } from './garmin';
import { LongitudeStandbyDisplay } from './standby';

/** Korry-style pushbutton with the Longitude legend convention (normal state cyan / white, off-normal amber). */
function pb(c: LonCockpitContext, panel: Panel, id: string, label: string, v: string, x: number, y: number, legends: (Parameters<typeof seg.eq> | LegendSegment)[], name?: string): PushButton {
  const segments = legends.map((l) => (Array.isArray(l) ? seg.eq(...(l as Parameters<typeof seg.eq>)) : l));
  const btn = panel.add(new PushButton(c.env, { id, label, var: v, mode: 'toggle', style: 'korry', width: 0.0175, height: 0.0175, layout: 'stack', segments }), x, y);
  panel.label(name ?? label, x, y + 0.0155, { height: 0.0029 });
  return btn;
}

/** Dual concentric dimmer (outer / inner), 0..1 with pointer. */
function dimmer(c: LonCockpitContext, panel: Panel, id: string, label: string, outerVar: string, innerVar: string | null, x: number, y: number, outerName: string, innerName?: string): void {
  panel.add(
    new RotaryKnob(c.env, {
      id,
      label,
      cap: 'dimmer',
      innerCap: 'dimmer',
      diameter: innerVar ? 0.022 : 0.015,
      outer: { var: outerVar, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label: outerName, format: (v) => (v >= 0.999 ? 'BRT' : `${Math.round(v * 100)} %`) },
      inner: innerVar ? { var: innerVar, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label: innerName, format: (v) => (v >= 0.999 ? 'BRT' : `${Math.round(v * 100)} %`) } : undefined,
    }),
    x,
    y,
  );
}

export function buildMainPanel(c: LonCockpitContext): void {
  const { b, env, suite } = c;
  const main = b.panel({ name: 'main', center_m: MAIN_PANEL.center_m, facing: 'aft', tiltDeg: MAIN_PANEL.tiltDeg, width: MAIN_PANEL.width, height: MAIN_PANEL.height, material: 'panel', radius: 0.012, screws: { kind: 'hex', diameter: 0.0035, pitch: 0.3 } });
  const gdus = c.headless ? null : suite;
  addGtc(c, main, 'gtc1', gdus?.gtc('gtc1'), -GTC_U, 0);
  addGdu(c, main, 'pfd1', gdus?.pfd1, -PFD_U, 0);
  addGdu(c, main, 'mfd', gdus?.mfd, 0, 0);
  addGdu(c, main, 'pfd2', gdus?.pfd2, PFD_U, 0);
  addGtc(c, main, 'gtc4', gdus?.gtc('gtc4'), GTC_U, 0);

  // Standby flight display between the L PFD and the MFD (EST position), bezel BARO knob.
  // Centre of the gap between the L PFD bezel and the MFD bezel.
  const stbyX = -PFD_U / 2;
  const stby = c.headless ? null : new LongitudeStandbyDisplay({ vars: c.ctx.vars });
  const sub = main.subPanel({ name: 'stby', x: stbyX, y: 0.005, width: 0.098, height: 0.128, material: 'bezel', screws: false });
  if (stby) sub.display(stby, 0, 0.012, 0.078, 0.078, { bezel: { border: 0.006, depth: 0.006 } });
  sub.add(
    new RotaryKnob(env, {
      id: 'lon.mp.stby_baro',
      label: 'STBY BARO',
      cap: 'knurled',
      diameter: 0.013,
      outer: { var: 'adc3.baro_inhg', min: 28.1, max: 31.0, step: 0.01, initial: 29.92, accel: { fastStep: 0.1 }, label: 'BARO', format: (v) => `${v.toFixed(2)} in` },
      push: { var: 'adc3.baro_std', mode: 'toggle', label: 'STD' },
    }),
    0.03,
    -0.047,
  );
  sub.label('BARO', 0.0, -0.047, { height: 0.0026 });

  // Clearance label plate in the right gap (EST placard: "OPERATE IN COMPLIANCE WITH AFM").
  main.placard({ text: 'THIS AIRPLANE MUST BE OPERATED IN\nCOMPLIANCE WITH THE AIRPLANE FLIGHT MANUAL', height: 0.0020, style: 'engraved' }, -stbyX, -0.09);

  buildLowerLeft(c);
  buildLowerRight(c);
}

function lowerPanel(c: LonCockpitContext, side: -1 | 1): Panel {
  const L = LOWER_PANEL;
  const w = L.yOut - L.yIn;
  const h = L.zBottom - L.zTop;
  return c.b.panel({ name: side < 0 ? 'lower_l' : 'lower_r', center_m: [L.x, side * (L.yIn + w / 2), (L.zTop + L.zBottom) / 2], facing: 'aft', tiltDeg: 3, width: w, height: h, material: 'panel', radius: 0.01, screws: { kind: 'hex', diameter: 0.0035 } });
}

function buildLowerLeft(c: LonCockpitContext): void {
  const { env } = c;
  const p = lowerPanel(c, -1);
  // ---- ELECTRICAL (right side of the pilot sub-panel)
  const ex = 0.07;
  p.label('ELECTRICAL', ex + 0.11, 0.085, { height: 0.0032 });
  p.line(ex - 0.02, 0.078, ex + 0.25, 0.078, 0.0006);
  pb(c, p, 'lon.lp.batt_l', 'BATT L', V.battL, ex, 0.05, [['OFF', 'amber', V.battL, 0]], 'BATT L');
  pb(c, p, 'lon.lp.bus_tie', 'BUS TIE', V.busTieBtn, ex + 0.045, 0.05, [seg.on('CLOSED', 'amber', V.busTieClosed), ['OPEN', 'cyan', V.busTieClosed, 0]], 'BUS TIE');
  pb(c, p, 'lon.lp.batt_r', 'BATT R', V.battR, ex + 0.09, 0.05, [['OFF', 'amber', V.battR, 0]], 'BATT R');
  pb(c, p, 'lon.lp.ext_pwr', 'EXT PWR', V.extPwr, ex + 0.15, 0.05, [seg.on('AVAIL', 'white', 'elec.gpu_avail'), seg.on('ON', 'cyan', V.extPwr)], 'EXT PWR');
  // STBY PWR: OFF / ON / TEST (momentary) with the charge / test LED (dossier §7.3).
  p.add(
    new ToggleSwitch(env, {
      id: 'lon.lp.stby_pwr',
      var: V.stbyPwr,
      label: 'STBY PWR',
      positions: ['OFF', 'ON', 'TEST'],
      values: [0, 1, 2],
      springs: { 2: 1 },
      labels: { name: 'STBY PWR', positions: true, height: 0.0026 },
    }),
    ex + 0.21,
    0.042,
  );
  p.add(
    new AnnunciatorLight(env, {
      id: 'lon.lp.stby_led',
      label: 'STBY PWR LED',
      width: 0.006,
      height: 0.006,
      segments: [seg.eq('', 'amber', V.stbyBattLed, 1), seg.eq('', 'green', V.stbyBattLed, 2)],
      layout: 'split',
    }),
    ex + 0.235,
    0.05,
  );
  // GEN L / APU / R: ON / OFF / RESET (momentary) toggles.
  const gen = (id: string, v: string, name: string, x: number) =>
    p.add(
      new ToggleSwitch(env, {
        id,
        var: v,
        label: name,
        positions: ['RESET', 'OFF', 'ON'],
        values: [2, 0, 1],
        initial: 2,
        springs: { 0: 1 },
        labels: { name, positions: true, height: 0.0026 },
      }),
      x,
      -0.005,
    );
  gen('lon.lp.gen_l', V.genL, 'L GEN', ex);
  gen('lon.lp.gen_apu', V.genApu, 'APU GEN', ex + 0.045);
  gen('lon.lp.gen_r', V.genR, 'R GEN', ex + 0.09);
  // MAIN / ELEC / INTERIOR pushbuttons (bottom row).
  pb(c, p, 'lon.lp.main_l', 'L MAIN', V.mainL, ex, -0.058, [['OFF', 'white', V.mainL, 0]], 'MAIN L');
  pb(c, p, 'lon.lp.elec_l', 'L ELEC', V.elecL, ex + 0.045, -0.058, [['EMER', 'amber', V.elecL, 0]], 'ELEC L');
  pb(c, p, 'lon.lp.interior', 'INTERIOR', V.interior, ex + 0.09, -0.058, [['OFF', 'white', V.interior, 0]], 'INTERIOR');
  pb(c, p, 'lon.lp.elec_r', 'R ELEC', V.elecR, ex + 0.135, -0.058, [['EMER', 'amber', V.elecR, 0]], 'ELEC R');
  pb(c, p, 'lon.lp.main_r', 'R MAIN', V.mainR, ex + 0.18, -0.058, [['OFF', 'white', V.mainR, 0]], 'MAIN R');
  // ---- outboard: PFD/GTC dimmer, MAP LIGHT, EMER/PARK BRAKE
  const ox = -0.3;
  dimmer(c, p, 'lon.lp.dim_pfd', 'PFD / GTC DIM (L)', V.ltPfdL, V.ltGtcL, ox, 0.045, 'PFD', 'GTC');
  p.label('PFD', ox - 0.018, 0.068, { height: 0.0026 });
  p.label('GTC', ox + 0.018, 0.068, { height: 0.0026 });
  dimmer(c, p, 'lon.lp.map', 'MAP LIGHT (L)', V.ltMapL, null, ox, -0.012, 'MAP');
  p.label('MAP LIGHT', ox, 0.005, { height: 0.0026 });
  p.add(
    new TBarHandle(env, {
      id: 'lon.lp.park_brake',
      var: V.parkBrake,
      label: 'EMER / PARK BRAKE',
      style: 'tbar',
      rotate: 'lock',
      springIn: true,
      legend: 'PARK BRAKE',
      scale: 1.1,
    }),
    ox + 0.08,
    -0.05,
  );
  p.label('EMER / PARK BRAKE', ox + 0.08, -0.02, { height: 0.0029 });
}

function buildLowerRight(c: LonCockpitContext): void {
  const { env } = c;
  const p = lowerPanel(c, 1);
  // ---- landing gear handle (inboard edge) with the gear position lights (dossier §7.4, OG 14).
  const gx = -0.315;
  p.add(
    new GearHandle(env, {
      id: 'lon.lp.gear',
      var: V.gearHandle,
      label: 'LANDING GEAR',
      positions: ['DN', 'UP'],
      values: [1, 0],
      // Down-lock solenoid: UP blocked on the ground (LandingGear gear.handle_lock).
      inhibit: (to, _from, v) => !(to === 1 && v.get('gear.handle_lock') !== 0),
      lights: [{ var: CK.gearRed, color: 'red' }],
      length: 0.075,
    }),
    gx,
    0.0,
  );
  const lt = (id: string, label: string, i: number, x: number) =>
    p.add(
      new AnnunciatorLight(env, {
        id,
        label,
        width: 0.014,
        height: 0.012,
        layout: 'stack',
        segments: [seg.on(label, 'green', `gear.green${i}`), seg.on('', 'red', `gear.red${i}`)],
      }),
      x,
      0.066,
    );
  lt('lon.lp.gear_lt_l', 'LH', 1, gx - 0.02);
  lt('lon.lp.gear_lt_n', 'NOSE', 0, gx);
  lt('lon.lp.gear_lt_r', 'RH', 2, gx + 0.02);
  p.label('LANDING GEAR', gx + 0.045, -0.04, { height: 0.0026 });
  p.add(new TBarHandle(env, { id: 'lon.lp.gear_emer', var: V.gearEmer, label: 'EMER GEAR EXTENSION', style: 'tbar', legend: 'EMER GEAR', material: 'knobRed' }), gx + 0.05, -0.068);
  p.label('EMER GEAR', gx + 0.05, -0.04 - 0.012, { height: 0.0023 });
  // ---- ICE PROTECTION (left side of the copilot sub-panel)
  const ix = -0.2;
  p.label('ICE PROTECTION', ix + 0.07, 0.085, { height: 0.0032 });
  p.line(ix - 0.02, 0.078, ix + 0.16, 0.078, 0.0006);
  pb(c, p, 'lon.lp.ai_eng_l', 'ENGINE L ANTI-ICE', V.aiEngL, ix, 0.05, [['ON', 'white', V.aiEngL, 1], ['OFF', 'cyan', V.aiEngL, 0]], 'ENGINE L');
  pb(c, p, 'lon.lp.ai_eng_r', 'ENGINE R ANTI-ICE', V.aiEngR, ix + 0.045, 0.05, [['ON', 'white', V.aiEngR, 1], ['OFF', 'cyan', V.aiEngR, 0]], 'ENGINE R');
  pb(c, p, 'lon.lp.ai_wing', 'WING ANTI-ICE', V.aiWing, ix + 0.09, 0.05, [['ON', 'white', V.aiWing, 1], ['OFF', 'cyan', V.aiWing, 0]], 'WING');
  pb(c, p, 'lon.lp.ai_stab', 'STAB DE-ICE', V.aiStab, ix + 0.135, 0.05, [['ON', 'white', V.aiStab, 1], ['OFF', 'cyan', V.aiStab, 0]], 'STAB');
  pb(c, p, 'lon.lp.pitot', 'PITOT / STATIC', V.pitotStatic, ix + 0.045, -0.01, [['ON', 'amber', V.pitotStatic, 1], ['NORM', 'cyan', V.pitotStatic, 0]], 'PITOT/STATIC');
  // ---- outboard: PFD/GTC dimmer and MAP LIGHT
  const ox = 0.3;
  dimmer(c, p, 'lon.lp.dim_pfd_r', 'PFD / GTC DIM (R)', V.ltPfdR, V.ltGtcR, ox, 0.045, 'PFD', 'GTC');
  p.label('PFD', ox - 0.018, 0.068, { height: 0.0026 });
  p.label('GTC', ox + 0.018, 0.068, { height: 0.0026 });
  dimmer(c, p, 'lon.lp.map_r', 'MAP LIGHT (R)', V.ltMapR, null, ox, -0.012, 'MAP');
  p.label('MAP LIGHT', ox, 0.005, { height: 0.0026 });
}
