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
import { PushButton } from '../../../cockpit/controls';
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

/** Per-clock state vars (cockpit-internal; s = 'l' | 'r'). SEL cycles the display, CTL runs the chrono. */
export const CLK = {
  sel: (s: 'l' | 'r') => `cockpit.g650.clk_${s}.sel_btn`, // momentary
  ctl: (s: 'l' | 'r') => `cockpit.g650.clk_${s}.ctl_btn`, // momentary
  mode: (s: 'l' | 'r') => `cockpit.g650.clk_${s}.mode`, // 0 UTC, 1 ET, 2 CHR
  run: (s: 'l' | 'r') => `cockpit.g650.clk_${s}.chr_run`, // chrono running
  accS: (s: 'l' | 'r') => `cockpit.g650.clk_${s}.chr_acc_s`, // chrono accumulated (s)
  startH: (s: 'l' | 'r') => `cockpit.g650.clk_${s}.chr_start_h`, // chrono start (env time, h)
  etBaseH: (s: 'l' | 'r') => `cockpit.g650.clk_${s}.et_base_h`, // elapsed-time base (env time, h)
} as const;

/**
 * Digital clock outboard of each PFD (G650ER photograph: a small LCD reading "16:34" at the outer edge of
 * each PFD) with SEL / CTL push buttons (standard Davtron-class digital clock controls, EST legends: the
 * buttons are not resolvable in the photographs): SEL cycles UTC -> ET (elapsed time, resettable with CTL)
 * -> CHR (chronograph, CTL = start / stop); the state lives in the CLK vars, driven by buildMainPanel.
 */
export class G650Clock extends CanvasDisplay {
  private readonly v: SimVars;
  private readonly s: 'l' | 'r';
  constructor(id: string, side: 'l' | 'r', vars: SimVars, canvas?: DisplayCanvas) {
    super({ id, width: 160, height: 64, vars, refreshHz: 2, powerVar: CLOCK_POWER, brightnessVar: null, canvas, background: '#060303' });
    this.v = vars;
    this.s = side;
    this.watch(ENV_TIME, 1 / 7200);
    this.watch(CLK.mode(side), 0);
    this.watch(CLK.run(side), 0);
    this.watch(CLK.accS(side), 0.5);
  }
  protected draw(ctx: Ctx2D): void {
    const v = this.v;
    const s = this.s;
    const mode = v.get(CLK.mode(s));
    const now = v.get(ENV_TIME);
    ctx.fillStyle = '#ff5a2a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let text: string;
    let tag: string;
    if (mode === 1) {
      const et = Math.max(0, (now - v.get(CLK.etBaseH(s))) * 3600);
      text = et < 3600 ? mmss(et) : hhmm(et / 3600);
      tag = 'ET';
    } else if (mode === 2) {
      const run = v.get(CLK.run(s)) !== 0;
      const chr = Math.max(0, v.get(CLK.accS(s)) + (run ? (now - v.get(CLK.startH(s))) * 3600 : 0));
      text = mmss(chr);
      tag = 'CHR';
    } else {
      const h = ((now % 24) + 24) % 24;
      text = hhmm(h);
      tag = 'UTC';
    }
    ctx.font = 'bold 40px monospace';
    ctx.fillText(text, 80, 36);
    ctx.font = 'bold 13px monospace';
    ctx.fillText(tag, 80, 9);
  }
}
const ENV_TIME = 'env.time_utc_h';
const hhmm = (h: number): string => {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm}`;
};
const mmss = (t: number): string => {
  const mm = Math.floor(t / 60) % 100;
  const ss = Math.floor(t % 60);
  return `${mm < 10 ? '0' : ''}${mm}:${ss < 10 ? '0' : ''}${ss}`;
};

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

  // Digital clocks outboard of the PFDs (photograph), above the placards, with SEL / CTL push buttons
  // (Davtron-class controls; EST legends / positions, the buttons are not resolvable in the photographs).
  const vars = c.ctx.vars;
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'l' : 'r';
    const clk = new G650Clock(`g650.mp.clock_${s}`, s, vars, c.canvas?.(160, 64));
    main.display(clk, side * wing, 0.095, 0.04, 0.016, { bezel: { border: 0.004, depth: 0.004, material: 'bezel' }, display: { glass: true, powerVar: CLOCK_POWER } });
    for (const [k, name, v, dx] of [
      ['sel', 'SEL', CLK.sel(s), -0.012],
      ['ctl', 'CTL', CLK.ctl(s), 0.012],
    ] as const) {
      main.add(new PushButton(c.env, { id: `g650.mp.clock_${s}_${k}`, label: `CLOCK ${name} (${s.toUpperCase()})`, var: v, mode: 'momentary', style: 'round', width: 0.006 }), side * wing + dx, 0.111);
      main.label(name, side * wing + dx, 0.118, { height: 0.0016 });
    }
  }
  // Clock logic (display-side): SEL cycles UTC -> ET -> CHR; CTL starts / stops the chrono (CHR) or resets
  // the elapsed time (ET). ET runs from power-up / last reset.
  const prev = { l: [0, 0], r: [0, 0] } as Record<'l' | 'r', [number, number]>;
  c.b.onUpdate(() => {
    const v = vars;
    v.set(CLOCK_POWER, v.get('elec.l_ess_dc_powered') !== 0 || v.get('elec.r_ess_dc_powered') !== 0 || v.get('elec.emer_dc_powered') !== 0 ? 1 : 0);
    const now = v.get('env.time_utc_h');
    for (const s of ['l', 'r'] as const) {
      const sel = v.get(CLK.sel(s));
      const ctl = v.get(CLK.ctl(s));
      if (sel !== 0 && prev[s][0] === 0) v.set(CLK.mode(s), (v.get(CLK.mode(s)) + 1) % 3);
      if (ctl !== 0 && prev[s][1] === 0) {
        const mode = v.get(CLK.mode(s));
        if (mode === 2) {
          // Chrono start / stop; a press while stopped at zero starts, stopping keeps the accumulated time,
          // a further press with the chrono stopped and non-zero resets it (start-stop-reset cycle).
          if (v.get(CLK.run(s)) !== 0) {
            v.set(CLK.accS(s), v.get(CLK.accS(s)) + (now - v.get(CLK.startH(s))) * 3600);
            v.set(CLK.run(s), 0);
          } else if (v.get(CLK.accS(s)) > 0) {
            v.set(CLK.accS(s), 0);
          } else {
            v.set(CLK.startH(s), now);
            v.set(CLK.run(s), 1);
          }
        } else if (mode === 1) {
          v.set(CLK.etBaseH(s), now); // ET reset
        }
      }
      prev[s][0] = sel;
      prev[s][1] = ctl;
    }
  });

  buildLowerCentre(c);
  return main;
}

