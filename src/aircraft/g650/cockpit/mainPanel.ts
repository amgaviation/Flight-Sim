/**
 * G650 main instrument panel and the lower centre panels.
 *
 * Display band (FlightGlobal 2008 "four large 14in LCDs"; Honeywell / GAC
 * PlaneView II): DU1 pilot PFD, DU2 / DU3 MFDs, DU4 copilot PFD, built with
 * the Epic `addDisplayUnits` helper (bezel sizes EPIC_HW). Limitations
 * placards on the outboard panel wings (numbers from LIM / TCDS, dossier §3).
 *
 * Lower centre panels either side of the pedestal forward face:
 *  - right (copilot side; code450 landing gear: "the landing gear lever on the
 *    copilot side of the center instrument panel"): LANDING GEAR handle with
 *    the red in-transit light in the wheel, three green down-and-locked
 *    lights (LUC landing gear: triangle of three greens), HORN SILENCE
 *    (yellow square, LUC), DN LOCK REL (overrides the down-lock solenoid),
 *    EMER LDG GEAR T-handle (red, LUC: "Pull EMER LDG GEAR handle", N2
 *    blowdown, one shot).
 *  - left: MFD DISPLAY SWITCHING / DISPLAY SYSTEM CONTROL (Epic helper, G550
 *    OM 2A-31), CAS scroll switch, NWS POWER (LUC: "NWS = red guarded
 *    switch"). EST positions (no public panel drawing).
 */
import { AnnunciatorLight, GearHandle, GuardedSwitch, PushButton, TBarHandle } from '../../../cockpit/controls';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { addCasScrollSwitch, addDisplaySwitching, addDisplayUnits } from '../../../avionics/honeywell-epic/cockpit';
import { G650_VARS as V, G650_EVENTS } from '../vars';
import { G650_LIMITS } from '../data';
import { CK, seg, type G650CockpitContext } from './context';
import { DU_U, LOWER_CENTRE, MAIN_PANEL } from './layout';

export function buildMainPanel(c: G650CockpitContext): Panel {
  const { b, suite } = c;
  const main = b.panel({ name: 'g650.main', center_m: MAIN_PANEL.center_m, facing: 'aft', tiltDeg: MAIN_PANEL.tiltDeg, width: MAIN_PANEL.width, height: MAIN_PANEL.height, material: 'panel', radius: 0.012, screws: { kind: 'hex', diameter: 0.0034, pitch: 0.32, inset: 0.008 } });
  if (suite) addDisplayUnits(main, suite, DU_U.map((u) => [u, -0.002] as const));

  // Limitations placards on the panel wings (LIM / TCDS IM.A.169 numbers, dossier §3).
  const wing = (MAIN_PANEL.width / 2 + DU_U[3] + 0.157) / 2;
  main.placard({ text: `VMO ${G650_LIMITS.vmoKt} KCAS\nMMO ${G650_LIMITS.mmo.toFixed(3).replace(/^0/, '')}\nVA 206 KCAS`, height: 0.0034, style: 'engraved' }, -wing, 0.03);
  main.placard({ text: 'MAX OPERATING ALT\n51,000 FT', height: 0.0026, style: 'engraved' }, -wing, -0.04);
  main.placard({ text: `VLO ${G650_LIMITS.vloKt}  VLE ${G650_LIMITS.vleKt}\nVFE 10° ${G650_LIMITS.vfe10Kt}\nVFE 20° ${G650_LIMITS.vfe20Kt}\nVFE 39° ${G650_LIMITS.vfe39Kt}`, height: 0.0032, style: 'engraved' }, wing, 0.02);
  main.placard({ text: 'KCAS', height: 0.0026, style: 'engraved' }, wing, -0.06);

  buildLowerLeft(c);
  buildLowerRight(c);
  return main;
}

function lowerPanel(c: G650CockpitContext, side: -1 | 1): Panel {
  const L = LOWER_CENTRE;
  const w = L.yOut - L.yIn;
  const h = L.zBottom - L.zTop;
  return c.b.panel({ name: side < 0 ? 'g650.lower_l' : 'g650.lower_r', center_m: [L.x, side * (L.yIn + w / 2), (L.zTop + L.zBottom) / 2], facing: 'aft', tiltDeg: L.tiltDeg, width: w, height: h, material: 'panel', radius: 0.008, screws: { kind: 'hex', diameter: 0.0032 } });
}

function buildLowerLeft(c: G650CockpitContext): void {
  const { b, env } = c;
  const p = lowerPanel(c, -1);
  p.label('DISPLAY SYSTEM CONTROL', 0.015, 0.098, { height: 0.0026 });
  addDisplaySwitching(b, p, -0.083, 0.062, 0.031);
  p.line(-0.1, 0.02, 0.1, 0.02, 0.0005);
  // CAS scroll (spring UP / DN) and NWS POWER (red guard, closed = ON).
  addCasScrollSwitch(b, p, -0.06, -0.035);
  p.label('SCROLL', -0.06, -0.075, { height: 0.0024 });
  p.add(
    new GuardedSwitch(env, {
      id: 'g650.lc.nws',
      label: 'NWS POWER',
      var: V.nwsPower,
      positions: ['OFF', 'ON'],
      values: [0, 1],
      initial: 1,
      labels: { name: 'NWS', positions: true, height: 0.0024 },
      guard: { color: 'red', guardedPosition: 1, close: 'returns' },
    }),
    0.045,
    -0.04,
  );
}

function buildLowerRight(c: G650CockpitContext): void {
  const { env } = c;
  const p = lowerPanel(c, 1);
  const gx = -0.045;
  // LANDING GEAR handle: DN = 1 / UP = 0; the down-lock solenoid (gear.handle_lock, LandingGear) blocks UP on the
  // ground unless DN LOCK REL is held (LandingGear handleLock.overrideVar clears the lock).
  p.add(
    new GearHandle(env, {
      id: 'g650.lc.gear',
      var: V.gearHandle,
      label: 'LANDING GEAR',
      positions: ['DN', 'UP'],
      values: [1, 0],
      // SwitchLogic.inhibit returns true when the move is permitted.
      inhibit: (to, _from, v) => !(to === 1 && v.get('gear.handle_lock') !== 0 && v.get(V.gearLockRelease) === 0),
      lights: [{ var: CK.gearRed, color: 'red' }],
      length: 0.085,
    }),
    gx,
    0.01,
  );
  p.label('UP', gx, 0.1, { height: 0.0026 });
  p.label('DN', gx, -0.085, { height: 0.0026 });
  p.label('LDG GEAR', gx - 0.05, 0.01, { height: 0.0024, anchor: 'middle' }).rotation.z = Math.PI / 2;
  // Three greens (nose on top, left / right below) with the red disagree segment in each lamp.
  const lamp = (id: string, label: string, i: number, x: number, y: number) =>
    p.add(
      new AnnunciatorLight(env, {
        id,
        label,
        width: 0.013,
        height: 0.013,
        layout: 'stack',
        segments: [seg.on(label, 'green', `gear.green${i}`), seg.on('', 'red', `gear.red${i}`)],
      }),
      x,
      y,
    );
  const lx = 0.045;
  lamp('g650.lc.gear_lt_n', 'NOSE', 0, lx, 0.078);
  lamp('g650.lc.gear_lt_l', 'LEFT', 1, lx - 0.018, 0.058);
  lamp('g650.lc.gear_lt_r', 'RIGHT', 2, lx + 0.018, 0.058);
  // HORN SILENCE (yellow square button, LUC) lit while the horn sounds; DN LOCK REL (momentary).
  p.add(
    new PushButton(env, {
      id: 'g650.lc.horn_silence',
      label: 'HORN SILENCE',
      mode: 'momentary',
      event: G650_EVENTS.hornSilence,
      width: 0.016,
      height: 0.016,
      capMaterial: 'paintYellow',
      segments: [{ text: ['HORN', 'SIL'], color: 'amber', var: 'gear.horn' }],
    }),
    lx - 0.013,
    0.022,
  );
  p.add(
    new PushButton(env, {
      id: 'g650.lc.lock_release',
      label: 'DN LOCK REL',
      var: V.gearLockRelease,
      mode: 'momentary',
      style: 'round',
      width: 0.011,
      height: 0.011,
      engraved: 'REL',
      engravedHeight: 0.0022,
    }),
    lx + 0.017,
    0.022,
  );
  p.label('HORN', lx - 0.013, 0.004, { height: 0.0021 });
  p.label('DN LOCK', lx + 0.017, 0.004, { height: 0.0021 });
  // EMER LDG GEAR T-handle (red; LUC: pulled below 175 KCAS, one extension only).
  p.add(new TBarHandle(env, { id: 'g650.lc.gear_emer', var: V.gearEmer, label: 'EMER LDG GEAR', style: 'tbar', legend: 'EMER LDG GEAR', material: 'knobRed', scale: 0.9 }), lx, -0.06);
  p.label('EMER LDG GEAR', lx, -0.03, { height: 0.0022, color: '#ff6a5a' });
}
