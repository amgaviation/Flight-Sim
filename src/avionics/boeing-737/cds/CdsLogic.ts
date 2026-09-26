/**
 * Common Display System logic (FCOM 10.10 "Display System"; b737.org.uk
 * "Flight Instruments - NG"): which format each of the six display units
 * shows, display electronics unit (DEU) sourcing, automatic switching after
 * DU failures, the MFD ENG / SYS formats with the secondary-engine automatic
 * display, the instrument transfer switches and the centre-panel N1 SET /
 * SPD REF / FUEL FLOW selectors.
 *
 * Routing (per side s: outboard DU O, inboard DU I; centre upper U / lower L):
 *   MAIN PANEL DUs  OUTBD PFD  O = PFD, I = blank
 *                   NORM       O = PFD, I = ND (O failed: PFD moves to I automatically)
 *                   INBD ENG PRI  I = primary engines, U blank
 *                   INBD PFD   I = PFD, O = blank
 *                   INBD MFD   I = MFD format (secondary engines / systems), L blank
 *   LOWER DU        ENG PRI    L = primary engines (compact with MFD ENG), U blank
 *                   NORM       L = MFD format
 *                   ND         L = the side's ND
 *   (when both LOWER DU selectors are off NORM, the one moved last wins.)
 *   Automatic: upper DU failed -> compact engines on the lower DU; lower DU
 *   failed (or used for something else) while the secondary engine display
 *   is requested -> compact engines on the upper DU.
 *   Secondary engine display is requested by MFD ENG, and automatically on
 *   initial power-up, a secondary-parameter exceedance, or an engine
 *   shut down / failed in flight (FCOM 7.10 "Engine Display Automatic
 *   Display").
 * DEUs: DEU 1 drives the Captain's DUs and the upper DU, DEU 2 the F/O's
 *   DUs and the lower DU (b737.org.uk). A failed DEU is replaced by the
 *   other automatically; in the air the PFDs show DSPLY SOURCE, on the
 *   ground (before the second engine start) CDS FAULT. The DISPLAYS SOURCE
 *   switch ALL ON 1 / ALL ON 2 forces one DEU (DSPLY SOURCE 1 / 2).
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { compileBinding, compileCondition, type Evaluator } from '../../../systems/util/binding';
import { listen, payloadNumber } from '../../../systems/autopilot/lib';
import { failVar } from '../../../systems/util/ids';
import type { FailureDef } from '../../../systems/failures/FailureManager';
import { ENG, FUEL } from '../../../core/vars';
import type { ResolvedB737Config } from '../config';
import {
  B737_EVENTS,
  B737_VARS,
  DU_DISPLAY_VARS,
  DU_IDS,
  DuFormat,
  LowerDuSel,
  MainPanelDuSel,
  MfdFormat,
  type DuId,
  type Side,
} from '../vars';
import { CFM56_N2, CFM56_OIL_PRESS, CFM56_OIL_TEMP, CFM56_VIB } from '../data/cfm56';

const LB_PER_KG = 2.2046226;

export class CdsLogic {
  readonly name = 'b737_cds';
  private readonly vars: SimVars;
  private readonly cfg: ResolvedB737Config;
  private readonly offs: (() => void)[] = [];
  private readonly duPower: Evaluator[];
  private readonly deuPower: [() => boolean, () => boolean];
  private readonly engRunning: [() => boolean, () => boolean];
  private readonly startIdle: [() => boolean, () => boolean];
  private readonly vib: [Evaluator, Evaluator];
  private readonly onGround: () => boolean;
  private readonly duFail: string[];
  private readonly deuFail: [string, string];
  /** Current formats (index = DU_IDS order). */
  readonly format = new Int32Array(6);
  readonly side = new Int32Array(6);
  private lowerChangedT: [number, number] = [0, 0];
  private prevLower: [number, number] = [-1, -1];
  private time = 0;
  private wasPowered = false;
  /** Secondary engine auto display latched (power-up / exceedance / engine out). */
  private autoSecondary = false;
  private prevRunning: [boolean, boolean] = [false, false];
  private exceedT = 0;

  constructor(env: { vars: SimVars; events?: EventBus }, cfg: ResolvedB737Config) {
    const v = env.vars;
    this.vars = v;
    this.cfg = cfg;
    const p = cfg.power;
    this.duPower = DU_IDS.map((d) => compileBinding(v, p.du?.[d], 1));
    this.deuPower = [compileCondition(v, p.deu1, true), compileCondition(v, p.deu2, true)];
    const dv = cfg.vars;
    this.engRunning = [compileCondition(v, dv.engineRunning(1), false), compileCondition(v, dv.engineRunning(2), false)];
    this.startIdle = [compileCondition(v, dv.startLeverIdle(1), true), compileCondition(v, dv.startLeverIdle(2), true)];
    this.vib = [compileBinding(v, dv.vibration(1), 0), compileBinding(v, dv.vibration(2), 0)];
    this.onGround = compileCondition(v, dv.onGround, true);
    this.duFail = DU_IDS.map((d) => failVar(`b737.du_${d}`));
    this.deuFail = [failVar('b737.deu1'), failVar('b737.deu2')];
    const init = (n: string, x: number): void => {
      if (!v.has(n)) v.set(n, x);
    };
    for (const s of [1, 2] as Side[]) {
      init(B737_VARS.mainPanelDus(s), MainPanelDuSel.Norm);
      init(B737_VARS.lowerDu(s), LowerDuSel.Norm);
    }
    init(B737_VARS.mfdFormat, MfdFormat.None);
    init(B737_VARS.displaysSource, 0);
    init(B737_VARS.controlPanelSel, 0);
    init(B737_VARS.vhfNavSel, 0);
    init(B737_VARS.irsSel, 0);
    init(B737_VARS.fmcSel, 0);
    init(B737_VARS.n1SetSel, 0);
    init(B737_VARS.spdRefSel, 0);
    init(B737_VARS.ffSwitch, 0);
    const e = env.events;
    listen(e, this.offs, B737_EVENTS.mfdEng, () => this.pressMfd(MfdFormat.Eng));
    listen(e, this.offs, B737_EVENTS.mfdSys, () => this.pressMfd(MfdFormat.Sys));
    listen(e, this.offs, B737_EVENTS.mfdCr, () => v.set('ac.cds.cr_count', v.get('ac.cds.cr_count') + 1));
    listen(e, this.offs, B737_EVENTS.n1SetInc, (q) => this.n1Set(payloadNumber(q, 1)));
    listen(e, this.offs, B737_EVENTS.n1SetDec, (q) => this.n1Set(-payloadNumber(q, 1)));
    listen(e, this.offs, B737_EVENTS.spdRefInc, (q) => this.spdRef(payloadNumber(q, 1)));
    listen(e, this.offs, B737_EVENTS.spdRefDec, (q) => this.spdRef(-payloadNumber(q, 1)));
  }

  failures(): FailureDef[] {
    const out: FailureDef[] = DU_IDS.map((d) => ({ id: `b737.du_${d}`, name: `Display unit ${d.replace('_', ' ').toUpperCase()}`, category: 'avionics', description: 'DU blank; the CDS moves its format to another DU where the logic allows.' }));
    out.push({ id: 'b737.deu1', name: 'DEU 1', category: 'avionics', description: 'Display electronics unit 1 failed: DEU 2 drives all DUs (DSPLY SOURCE).' });
    out.push({ id: 'b737.deu2', name: 'DEU 2', category: 'avionics', description: 'Display electronics unit 2 failed: DEU 1 drives all DUs (DSPLY SOURCE).' });
    return out;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  /** MFD ENG / SYS switch: selects the format, pushing it again removes it (FCOM "MFD switches"). */
  pressMfd(f: MfdFormat): void {
    const v = this.vars;
    const cur = v.get(B737_VARS.mfdFormat) as MfdFormat;
    const showingEng = cur === MfdFormat.Eng || this.autoSecondary;
    if (f === MfdFormat.Eng) {
      if (showingEng) {
        v.set(B737_VARS.mfdFormat, MfdFormat.None);
        this.autoSecondary = false;
      } else v.set(B737_VARS.mfdFormat, MfdFormat.Eng);
    } else {
      v.set(B737_VARS.mfdFormat, cur === MfdFormat.Sys ? MfdFormat.None : MfdFormat.Sys);
      this.autoSecondary = false;
    }
  }

  /** N1 SET inner knob: 0.1 % per click on the selected engine(s) (EST step). */
  private n1Set(clicks: number): void {
    const v = this.vars;
    const sel = v.get(B737_VARS.n1SetSel);
    if (sel === 0) return;
    for (const e of [1, 2] as const) {
      if (sel === 1 || sel === e + 1) {
        const n = B737_VARS.n1SetManual(e);
        const cur = v.has(n) ? v.get(n) : v.get(ENG.n1(e));
        v.set(n, Math.max(20, Math.min(110, Math.round((cur + clicks * 0.1) * 10) / 10)));
      }
    }
  }

  /** SPD REF inner knob: 1 kt per click (V1, VR, VREF, B) or 500 kg / 1,000 lb per click (WT). */
  private spdRef(clicks: number): void {
    const v = this.vars;
    const sel = v.get(B737_VARS.spdRefSel);
    const adj = (n: string, step: number, lo: number, hi: number, start: number): void => {
      const cur = v.get(n) > 0 ? v.get(n) : start;
      v.set(n, Math.max(lo, Math.min(hi, cur + clicks * step)));
    };
    switch (sel) {
      case 1:
        adj(B737_VARS.spdRefV1, 1, 80, 200, 130);
        break;
      case 2:
        adj(B737_VARS.spdRefVr, 1, 80, 200, 135);
        break;
      case 3:
        adj(B737_VARS.spdRefWtKg, this.cfg.weightUnit === 'lb' ? 1000 / LB_PER_KG : 500, 35000, 80000, 60000);
        break;
      case 4:
        adj(B737_VARS.spdRefVref, 1, 90, 200, 140);
        break;
      case 5:
        adj(B737_VARS.spdRefBug, 1, 60, 340, 160);
        break;
      default:
        break;
    }
  }

  private duOk(i: number, deuOk: boolean): boolean {
    return deuOk && this.duPower[i]() >= 0.5 && this.vars.get(this.duFail[i]) === 0;
  }

  /** Secondary engine exceedance (N2, oil pressure/temperature, vibration) for the automatic display. */
  private secondaryExceedance(): boolean {
    const v = this.vars;
    for (const e of [1, 2] as const) {
      if (!this.engRunning[e - 1]()) continue;
      if (v.get(ENG.n2(e)) >= CFM56_N2.red) return true;
      if (v.get(ENG.oilPressPsi(e)) <= CFM56_OIL_PRESS.red) return true;
      if (v.get(ENG.oilTempC(e)) >= CFM56_OIL_TEMP.amber) return true;
      if (this.vib[e - 1]() >= CFM56_VIB.amber) return true;
    }
    return false;
  }

  update(dt: number): void {
    const v = this.vars;
    this.time += dt;
    // ---- DEUs
    const deu1 = this.deuPower[0]() && v.get(this.deuFail[0]) === 0;
    const deu2 = this.deuPower[1]() && v.get(this.deuFail[1]) === 0;
    v.set(B737_VARS.deuOk(1), deu1 ? 1 : 0);
    v.set(B737_VARS.deuOk(2), deu2 ? 1 : 0);
    const srcSel = v.get(B737_VARS.displaysSource);
    let src1 = deu1 ? 1 : deu2 ? 2 : 0; // source for DEU-1 DUs (captain, upper)
    let src2 = deu2 ? 2 : deu1 ? 1 : 0; // source for DEU-2 DUs (F/O, lower)
    if (srcSel < 0 && deu1) src1 = src2 = 1;
    else if (srcSel > 0 && deu2) src1 = src2 = 2;
    const single = src1 !== 0 && src1 === src2;
    const bothRunning = this.engRunning[0]() && this.engRunning[1]();
    const ground = this.onGround();
    // CDS FAULT on the ground before both engines run; DSPLY SOURCE otherwise (b737.org.uk).
    const deuFault = !deu1 || !deu2;
    v.set(B737_VARS.cdsFault, deuFault && ground && !bothRunning ? 1 : 0);
    v.set(B737_VARS.dsplySource, single && (srcSel !== 0 || !(ground && !bothRunning)) ? 1 : 0);
    v.set(B737_VARS.dsplySourceN, srcSel !== 0 ? src1 : 0);

    // ---- DU availability
    const ok = [false, false, false, false, false, false];
    const deuOf = [src1, src1, src1, src2, src2, src2];
    for (let i = 0; i < 6; i++) {
      ok[i] = this.duOk(i, deuOf[i] !== 0);
      v.set(B737_VARS.duFailed(DU_IDS[i]), ok[i] ? 0 : 1);
      v.set(B737_VARS.deuFor(DU_IDS[i]), deuOf[i]);
    }
    const anyPowered = ok.some((x) => x);
    // Initial power-up: secondary engine indications displayed automatically.
    if (anyPowered && !this.wasPowered) this.autoSecondary = true;
    this.wasPowered = anyPowered;
    // In-flight engine failure / shutdown: automatic secondary display.
    for (const e of [0, 1]) {
      const run = this.engRunning[e]();
      if (!ground && this.prevRunning[e] && !run) this.autoSecondary = true;
      if (!ground && !run && !this.startIdle[e]()) this.autoSecondary = true;
      this.prevRunning[e] = run;
    }
    this.exceedT = this.secondaryExceedance() ? this.exceedT + dt : 0;
    if (this.exceedT > 1) this.autoSecondary = true;
    v.set(B737_VARS.engSecondaryAuto, this.autoSecondary ? 1 : 0);

    // ---- selectors
    for (const s of [0, 1]) {
      const l = v.get(B737_VARS.lowerDu((s + 1) as Side));
      if (l !== this.prevLower[s]) {
        this.prevLower[s] = l;
        this.lowerChangedT[s] = this.time;
      }
    }
    const mfd = v.get(B737_VARS.mfdFormat) as MfdFormat;
    const secondaryWanted = mfd === MfdFormat.Eng || this.autoSecondary;
    const mfdFormat: DuFormat = secondaryWanted ? DuFormat.EngSecondary : mfd === MfdFormat.Sys ? DuFormat.Sys : DuFormat.Blank;

    const f = this.format;
    const sd = this.side;
    f.fill(DuFormat.Blank);
    sd.fill(0);
    // Outboard / inboard per side.
    let upperBlank = false;
    let lowerBlank = false;
    let mfdOnInboard = false;
    for (const s of [1, 2] as Side[]) {
      const o = s === 1 ? 0 : 5;
      const i = s === 1 ? 1 : 4;
      const sel = v.get(B737_VARS.mainPanelDus(s)) as MainPanelDuSel;
      switch (sel) {
        case MainPanelDuSel.OutbdPfd:
          f[o] = DuFormat.Pfd;
          break;
        case MainPanelDuSel.InbdEngPri:
          f[o] = DuFormat.Pfd;
          f[i] = DuFormat.EngPrimary;
          upperBlank = true;
          break;
        case MainPanelDuSel.InbdPfd:
          f[i] = DuFormat.Pfd;
          break;
        case MainPanelDuSel.InbdMfd:
          f[o] = DuFormat.Pfd;
          f[i] = mfdFormat;
          if (mfdFormat !== DuFormat.Blank) mfdOnInboard = true;
          break;
        default:
          // NORM: PFD outboard, ND inboard; outboard failure -> PFD on the inboard DU.
          if (ok[o]) {
            f[o] = DuFormat.Pfd;
            f[i] = DuFormat.Nd;
          } else f[i] = DuFormat.Pfd;
          break;
      }
      sd[o] = s;
      sd[i] = s;
    }
    // Lower DU selector (the one moved last wins when both are off NORM).
    const l1 = v.get(B737_VARS.lowerDu(1)) as LowerDuSel;
    const l2 = v.get(B737_VARS.lowerDu(2)) as LowerDuSel;
    let lowerSel = LowerDuSel.Norm;
    let lowerSide: Side = 1;
    if (l1 !== LowerDuSel.Norm && (l2 === LowerDuSel.Norm || this.lowerChangedT[0] >= this.lowerChangedT[1])) {
      lowerSel = l1;
      lowerSide = 1;
    } else if (l2 !== LowerDuSel.Norm) {
      lowerSel = l2;
      lowerSide = 2;
    }
    let primaryOnLower = false;
    if (lowerSel === LowerDuSel.EngPri) {
      primaryOnLower = true;
      upperBlank = true;
    } else if (lowerSel === LowerDuSel.Nd) {
      f[3] = DuFormat.Nd;
      sd[3] = lowerSide;
      lowerBlank = true;
    }
    if (mfdOnInboard) lowerBlank = true;
    // Upper DU failed: primary engines move to the lower DU automatically.
    if (!ok[2] && !upperBlank) primaryOnLower = true;
    if (primaryOnLower && ok[3]) {
      f[3] = secondaryWanted ? DuFormat.EngCompact : DuFormat.EngPrimary;
    } else {
      if (!upperBlank) {
        // Secondary requested but the lower DU cannot show it: compact format on the upper DU.
        const lowerAvail = ok[3] && !lowerBlank && f[3] === DuFormat.Blank;
        f[2] = secondaryWanted && !lowerAvail ? DuFormat.EngCompact : DuFormat.EngPrimary;
        if (lowerAvail) f[3] = mfdFormat;
      } else if (!lowerBlank && f[3] === DuFormat.Blank && ok[3]) f[3] = mfdFormat;
    }
    // Publish.
    for (let k = 0; k < 6; k++) {
      const du = DU_IDS[k];
      const shown = ok[k] ? f[k] : DuFormat.Blank;
      v.set(B737_VARS.duFormat(du), shown);
      v.set(B737_VARS.duSide(du), sd[k]);
      v.set(DU_DISPLAY_VARS.power(du), ok[k] ? 1 : 0);
    }

    // ---- transfer switches: EFIS panel, air data / IRS and VHF NAV per side
    const cp = v.get(B737_VARS.controlPanelSel);
    const irs = v.get(B737_VARS.irsSel);
    const nav = v.get(B737_VARS.vhfNavSel);
    for (const s of [1, 2] as Side[]) {
      v.set(B737_VARS.efisSourceFor(s), cp < 0 ? 1 : cp > 0 ? 2 : s);
      const adiru = irs < 0 ? this.cfg.adiru[0] : irs > 0 ? this.cfg.adiru[1] : this.cfg.adiru[s - 1];
      v.set(B737_VARS.airDataFor(s), adiru);
      v.set(B737_VARS.navRxFor(s), nav < 0 ? 1 : nav > 0 ? 2 : s);
    }

    // ---- fuel used (FUEL FLOW switch: RESET zeroes, integrates fuel flow)
    const ff = v.get(B737_VARS.ffSwitch);
    for (const e of [1, 2] as const) {
      const n = B737_VARS.fuelUsedKg(e);
      if (ff < 0) v.set(n, 0);
      else v.set(n, v.get(n) + (v.get(ENG.fuelFlowPph(e)) / LB_PER_KG) * (dt / 3600));
    }
    // Total fuel var kept for displays that only know the tanks.
    if (!v.has(FUEL.totalKg)) v.set(FUEL.totalKg, 0);
  }

  reset(): void {
    this.prevLower = [-1, -1];
    this.exceedT = 0;
  }

  /** Forces the power-up state (state presets): secondary auto display cleared. */
  applyState(state: string): void {
    this.autoSecondary = state === 'cold_dark';
    this.wasPowered = state !== 'cold_dark';
    this.prevRunning = [this.engRunning[0](), this.engRunning[1]()];
    if (state !== 'cold_dark') this.vars.set(B737_VARS.mfdFormat, MfdFormat.None);
  }
}
