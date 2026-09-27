/**
 * G650 lower centre instrument panel (under the MFDs, above the pedestal) and the knee panels.
 *
 * Strip, left to right (G650ER photographs, Flickr jeffatchison 52948656184 / 52948654839 / 52948762561; LUC
 * fire-protection drawings of the red "L" / "R" DISCH handles):
 *  - L ENG FIRE handle (pull: fuel / hydraulic SOVs, bleed, IDG trip; rotate outboard = shot 1 RIGHT bottle,
 *    inboard = shot 2 LEFT bottle; the handle lights red with a fire, LUC);
 *  - BRAKE ACCUM PRESS gauge: INBD / OUTBD vertical scales, psi x 1000 (photograph);
 *  - AUTOBRAKE rotary RTO / OFF / LOW / MED / HIGH above the IRS MODE SELECT switchlights IRS 1 / 2 / 3
 *    (photograph; SmartCockpit G650 avionics quiz: amber ON BAT when an IRU runs on its battery);
 *  - landing gear panel: three greens (N above L / R), gear handle (red in-transit light), HORN SILENCE, LOCK
 *    RELEASE, placard "DO NOT OPERATE WITH L/G EXTENDED ABOVE 20,000 FT" (photograph; LIM: 20,000 ft max with
 *    the gear extended);
 *  - R ENG FIRE handle.
 * Knee panels: right, inboard: EMER LDG GEAR (red handle in a black box, photograph); left: NWS POWER (red
 * guard, LUC) and the CAS scroll switch (EST position, not identified in the photographs).
 * Positions inside the strip are scaled from the photographs (EST).
 */
import { AnnunciatorLight, GearHandle, GuardedSwitch, PushButton, SelectorKnob, TBarHandle } from '../../../cockpit/controls';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { CanvasDisplay } from '../../../avionics/common/CanvasDisplay';
import type { Ctx2D } from '../../../avionics/common/draw/context';
import type { DisplayCanvas } from '../../../avionics/common/CanvasDisplay';
import type { SimVars } from '../../../core/SimVars';
import { addCasScrollSwitch } from '../../../avionics/honeywell-epic/cockpit';
import { G650_VARS as V, G650_EVENTS } from '../vars';
import { CK, seg, type G650CockpitContext } from './context';
import { LOWER_CENTRE, MAIN_PANEL } from './layout';

/** Display-side lamp vars of the lower centre panel. */
export const LC = {
  /** IRU n selected ON and running on its battery (no main AC): amber ON BAT (SmartCockpit G650 quiz). */
  irsOnBat: (n: 1 | 2 | 3) => `ac.g650.ck.lc.irs${n}_on_bat`,
  gaugePower: 'ac.g650.ck.lc.brake_gauge_pwr',
};

/**
 * BRAKE ACCUM PRESS gauge: two vertical scales 0-3.5 (psi x 1000), INBD (left hydraulic) and OUTBD (right).
 * SCOPE: the brake model has one accumulator (`brakes.accum_psi`, charged from the higher system), shown on both
 * scales; the real aircraft has an inboard (L) and an outboard (R) accumulator (LUC).
 */
export class BrakeAccumGauge extends CanvasDisplay {
  private readonly v: SimVars;
  constructor(vars: SimVars, canvas?: DisplayCanvas) {
    super({ id: 'g650.lc.brake_accum', width: 128, height: 176, vars, refreshHz: 10, powerVar: LC.gaugePower, brightnessVar: null, canvas, background: '#0b0c0d' });
    this.v = vars;
    this.watch('brakes.accum_psi', 25);
  }

  protected draw(ctx: Ctx2D): void {
    const psi = Math.max(0, Math.min(3500, this.v.get('brakes.accum_psi')));
    const top = 22;
    const bot = 150;
    const yOf = (p: number) => bot - ((bot - top) * p) / 3500;
    ctx.fillStyle = '#e8e8e8';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BRAKE ACCUM', 64, 9);
    ctx.font = '11px sans-serif';
    for (let k = 0; k <= 3; k++) {
      const y = yOf(k * 1000);
      ctx.fillText(String(k), 64, y);
    }
    for (const [x, name] of [
      [34, 'INBD'],
      [94, 'OUTBD'],
    ] as const) {
      ctx.strokeStyle = '#c8c8c8';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 6, top, 12, bot - top);
      // Green pointer bar at the accumulator pressure; amber below 1,500 psi (LUC: inboard accumulator < 1,500 psi).
      ctx.fillStyle = psi < 1500 ? '#ffb000' : '#34e05a';
      ctx.fillRect(x - 5, yOf(psi) - 3, 10, 6);
      ctx.fillStyle = '#e8e8e8';
      ctx.fillText(name, x, 164);
    }
  }
}

/**
 * G650 engine fire handle: an upright red block with a large white "L" / "R" and "DISCH" on its top (LUC fire
 * drawings, G650ER photographs), lit red by a fire. The shared fire T-handle is horizontal: this turns it upright
 * and paints the letter on the moving part so it follows the pull and the discharge rotation.
 */
class G650FireHandle extends TBarHandle {
  constructor(env: G650CockpitContext['env'], o: ConstructorParameters<typeof TBarHandle>[1], letter: string) {
    super(env, o);
    const s = o.scale ?? 1;
    const slide = this.object.children.find((c) => c.type === 'Group');
    const turn = slide?.children.find((c) => c.type === 'Group');
    if (turn) {
      const z = 0.0312 * s + 0.0004;
      const l = this.engrave(letter, 0, 0, { height: 0.024 * s, weight: 800, color: '#ffffff' }, turn, true);
      l.position.z = z;
      l.rotation.z = -Math.PI / 2;
      const d = this.engrave('DISCH', 0.028 * s, 0, { height: 0.006 * s, weight: 700, color: '#ffffff' }, turn, true);
      d.position.z = z;
      d.rotation.z = -Math.PI / 2;
    }
  }
}

export function buildLowerCentre(c: G650CockpitContext): void {
  const { b, env, ctx } = c;
  const vars = ctx.vars;
  const L = LOWER_CENTRE;
  const p = b.panel({ name: 'g650.lower_centre', center_m: L.center_m, facing: 'aft', tiltDeg: L.tiltDeg, width: L.width, height: L.height, material: 'panel', radius: 0.006, screws: { kind: 'hex', diameter: 0.003, pitch: 0.2, inset: 0.006 } });

  // ---- engine fire handles (outboard ends of the strip)
  for (const i of [1, 2] as const) {
    const s = i === 1 ? 'L' : 'R';
    const u = (i === 1 ? -1 : 1) * 0.262;
    p.add(
      new G650FireHandle(
        env,
        {
          id: `g650.lc.fire_${s.toLowerCase()}`,
          var: i === 1 ? V.fireHandleL : V.fireHandleR,
          rotateVar: i === 1 ? V.fireDischL : V.fireDischR,
          label: `${s} ENG FIRE handle (pull; rotate: outboard = shot 1 RIGHT bottle, inboard = shot 2 LEFT bottle)`,
          style: 'fire',
          rotate: 'discharge',
          lightVar: `fire.eng${i}_warn`,
          legend: '',
          scale: 0.62,
        },
        s,
      ),
      u,
      -0.002,
      { rotDeg: 90 }, // upright (the letters are counter-rotated on the handle)
    );
  }

  // ---- BRAKE ACCUM PRESS gauge
  const gauge = new BrakeAccumGauge(vars, c.canvas?.(128, 176));
  // The DisplayManager's power var (default `display.<id>.power`, missing = powered) must match the gauge's own.
  p.display(gauge, -0.17, 0, 0.044, 0.062, { bezel: { border: 0.004, depth: 0.004, material: 'bezel' }, display: { glass: true, powerVar: LC.gaugePower } });

  // ---- AUTOBRAKE + IRS MODE SELECT
  p.add(
    new SelectorKnob(env, {
      id: 'g650.lc.autobrake',
      var: V.autobrake,
      label: 'AUTOBRAKE',
      cap: 'pointer',
      diameter: 0.017,
      labelHeight: 0.0019,
      // Photograph: RTO left, OFF at the top, LOW / MED / HIGH clockwise (LUC: Low, Medium, High, RTO).
      positions: [
        { value: -1, label: 'RTO', angle: -70 },
        { value: 0, label: 'OFF', angle: -20 },
        { value: 1, label: 'LOW', angle: 25 },
        { value: 2, label: 'MED', angle: 70 },
        { value: 3, label: 'HIGH', angle: 110 },
      ],
      initial: 1,
      title: 'AUTOBRAKE',
    }),
    -0.045,
    0.018,
  );
  p.label('AUTOBRAKE', -0.098, 0.006, { height: 0.0024 });
  ([1, 2, 3] as const).forEach((n, k) => {
    const u = -0.085 + k * 0.04;
    p.add(
      new PushButton(env, {
        id: `g650.lc.irs${n}`,
        label: `IRS MODE SELECT IRS ${n}`,
        var: V.irsMode(n),
        mode: 'toggle',
        values: [0, 2],
        stateNames: ['OFF', 'ON'],
        style: 'korry',
        width: 0.019,
        height: 0.019,
        layout: 'stack',
        segments: [seg.on('ON BAT', 'amber', LC.irsOnBat(n)), seg.eq('ON', 'cyan', V.irsMode(n), 2)],
      }),
      u,
      -0.021,
    );
    p.label(`IRS ${n}`, u, -0.0035, { height: 0.0019 });
  });
  p.label('IRS MODE SELECT', -0.045, -0.038, { height: 0.0022 });

  // ---- landing gear panel
  const gx = 0.145;
  const lamp = (id: string, label: string, i: number, x: number, y: number) =>
    p.add(new AnnunciatorLight(env, { id, label, width: 0.012, height: 0.009, layout: 'stack', segments: [seg.on('', 'green', `gear.green${i}`), seg.on('', 'red', `gear.red${i}`)] }), x, y);
  lamp('g650.lc.gear_lt_n', 'NOSE GEAR', 0, gx, 0.033);
  lamp('g650.lc.gear_lt_l', 'LEFT MAIN GEAR', 1, gx - 0.03, 0.022);
  lamp('g650.lc.gear_lt_r', 'RIGHT MAIN GEAR', 2, gx + 0.03, 0.022);
  p.label('N', gx, 0.0255, { height: 0.0017 });
  p.label('L', gx - 0.03, 0.0145, { height: 0.0017 });
  p.label('R', gx + 0.03, 0.0145, { height: 0.0017 });
  // LANDING GEAR handle: DN = 1 / UP = 0; the down-lock solenoid (gear.handle_lock, LandingGear) blocks UP on the
  // ground unless LOCK RELEASE is held (LandingGear handleLock.overrideVar clears the lock).
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
      length: 0.04,
      knobScale: 0.6,
    }),
    gx,
    -0.004,
  );
  p.add(
    new PushButton(env, {
      id: 'g650.lc.horn_silence',
      label: 'HORN SILENCE',
      mode: 'momentary',
      event: G650_EVENTS.hornSilence,
      width: 0.013,
      height: 0.011,
      capMaterial: 'paintYellow',
      segments: [{ text: ['HORN', 'SIL'], color: 'amber', var: 'gear.horn' }],
    }),
    gx - 0.036,
    -0.016,
  );
  p.label('HORN SILENCE', gx - 0.036, -0.0055, { height: 0.0016 });
  p.add(new PushButton(env, { id: 'g650.lc.lock_release', label: 'LOCK RELEASE', var: V.gearLockRelease, mode: 'momentary', style: 'round', width: 0.009, height: 0.009, capMaterial: 'knobRed' }), gx + 0.036, -0.006);
  p.label('LOCK', gx + 0.036, 0.0065, { height: 0.0017 });
  p.label('RELEASE', gx + 0.036, 0.0035, { height: 0.0017 });
  p.label('DO NOT OPERATE WITH L/G EXTENDED', gx, -0.033, { height: 0.0016 });
  p.label('ABOVE 20,000 FT', gx, -0.037, { height: 0.0016 });
  p.line(gx - 0.058, 0.04, gx - 0.058, -0.04, 0.0005);
  p.line(-0.2, 0.04, -0.2, -0.04, 0.0005);

  buildKneePanels(c);

  // ---- derived lamp states (display-side only)
  b.onUpdate(() => {
    const ac = vars.get('elec.l_main_ac_powered') !== 0 || vars.get('elec.r_main_ac_powered') !== 0;
    for (const n of [1, 2, 3] as const) vars.set(LC.irsOnBat(n), vars.get(V.irsMode(n)) !== 0 && vars.get(`elec.irs${n}_powered`) !== 0 && !ac ? 1 : 0);
    vars.set(LC.gaugePower, vars.get('elec.l_ess_dc_powered') !== 0 || vars.get('elec.r_ess_dc_powered') !== 0 || vars.get('elec.emer_dc_powered') !== 0 ? 1 : 0);
  });
}

/** Knee panels either side of the lower centre panel (below the MFD outer halves / PFD inner edges). */
function buildKneePanels(c: G650CockpitContext): void {
  const { b, env } = c;
  const kneeTop = MAIN_PANEL.center_m[2] + (MAIN_PANEL.height / 2) * Math.cos((MAIN_PANEL.tiltDeg * Math.PI) / 180);
  const kneeX = MAIN_PANEL.center_m[0] - (MAIN_PANEL.height / 2) * Math.sin((MAIN_PANEL.tiltDeg * Math.PI) / 180) + 0.02;
  const knee = (side: -1 | 1): Panel =>
    b.panel({ name: side < 0 ? 'g650.knee_l' : 'g650.knee_r', center_m: [kneeX + 0.024, side * 0.375, kneeTop + 0.085], facing: 'aft', width: 0.13, height: 0.085, material: 'panel', radius: 0.006, screws: { kind: 'hex', diameter: 0.003 } });
  // Left: NWS POWER (red guard, closed = ON, LUC) and the CAS scroll switch (EST position).
  const l = knee(-1);
  l.add(
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
    0.03,
    -0.004,
  );
  addCasScrollSwitch(b, l, -0.03, -0.004);
  l.label('SCROLL', -0.03, -0.036, { height: 0.0022 });
  // Right, inboard: EMER LDG GEAR (red T-handle in a black box, photograph; LUC: <= 175 KCAS, one shot).
  const r = knee(1);
  r.subPanel({ name: 'g650.emer_gear_box', x: -0.02, y: 0, width: 0.075, height: 0.05, material: 'panelDark', screws: false, radius: 0.006 });
  r.add(new TBarHandle(env, { id: 'g650.lc.gear_emer', var: V.gearEmer, label: 'EMER LDG GEAR', style: 'tbar', legend: 'EMER LDG GEAR', material: 'knobRed', scale: 0.85 }), -0.02, -0.005);
  r.label('EMER LDG GEAR', -0.02, 0.017, { height: 0.0026, color: '#ff6a5a' });
}
