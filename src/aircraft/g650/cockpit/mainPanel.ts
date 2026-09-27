/**
 * G650 main instrument panel: the display band (FlightGlobal 2008 "four large 14in LCDs"; Honeywell / GAC
 * PlaneView II): DU1 pilot PFD, DU2 / DU3 MFDs, DU4 copilot PFD, built with the Epic `addDisplayUnits` helper
 * (bezel sizes EPIC_HW), limitations placards on the outboard panel wings (numbers from LIM / TCDS, dossier §3),
 * and the digital clocks outboard of each PFD (G650ER photograph).
 * The lower centre panel (fire handles, brake accumulator, AUTOBRAKE / IRS MODE SELECT, landing gear) and the
 * knee panels are built by lowerCentre.ts. The MFD DISPLAY SWITCHING / DISPLAY SYSTEM CONTROL switches are on
 * the overhead (G650ER overhead photograph; cockpit/overhead).
 */
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { addDisplayUnits } from '../../../avionics/honeywell-epic/cockpit';
import { G650_LIMITS } from '../data';
import type { G650CockpitContext } from './context';
import { DU_U, MAIN_PANEL } from './layout';
import { buildLowerCentre } from './lowerCentre';
import { CanvasDisplay, type DisplayCanvas } from '../../../avionics/common/CanvasDisplay';
import type { Ctx2D } from '../../../avionics/common/draw/context';
import type { SimVars } from '../../../core/SimVars';

/** Clock readout power (either ESS DC bus or the emergency bus; EST), written by the cockpit. */
export const CLOCK_POWER = 'ac.g650.ck.clock_pwr';

/**
 * Digital clock outboard of each PFD (G650ER photograph: a small LCD reading "16:34" at the outer edge of
 * each PFD). Shows UTC hours:minutes from the simulation time. SCOPE: the clock's own set / chronograph
 * buttons are not modelled (not identifiable in the photographs); the PFD / MFD timers are on the displays.
 */
export class G650Clock extends CanvasDisplay {
  private readonly v: SimVars;
  constructor(id: string, vars: SimVars, canvas?: DisplayCanvas) {
    super({ id, width: 160, height: 64, vars, refreshHz: 1, powerVar: CLOCK_POWER, brightnessVar: null, canvas, background: '#060303' });
    this.v = vars;
    this.watch(ENV_TIME, 1 / 120);
  }
  protected draw(ctx: Ctx2D): void {
    const h = ((this.v.get(ENV_TIME) % 24) + 24) % 24;
    const hh = Math.floor(h);
    const mm = Math.floor((h - hh) * 60);
    ctx.fillStyle = '#ff5a2a';
    ctx.font = 'bold 44px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}`, 80, 34);
  }
}
const ENV_TIME = 'env.time_utc_h';

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

  // Digital clocks outboard of the PFDs (photograph), above the placards.
  for (const side of [-1, 1] as const) {
    const clk = new G650Clock(side < 0 ? 'g650.mp.clock_l' : 'g650.mp.clock_r', c.ctx.vars, c.canvas?.(160, 64));
    main.display(clk, side * wing, 0.095, 0.04, 0.016, { bezel: { border: 0.004, depth: 0.004, material: 'bezel' }, display: { glass: true, powerVar: CLOCK_POWER } });
  }
  c.b.onUpdate(() => {
    const v = c.ctx.vars;
    v.set(CLOCK_POWER, v.get('elec.l_ess_dc_powered') !== 0 || v.get('elec.r_ess_dc_powered') !== 0 || v.get('elec.emer_dc_powered') !== 0 ? 1 : 0);
  });

  buildLowerCentre(c);
  return main;
}

