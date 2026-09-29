/**
 * G800 aircraft logic: the automatic functions that connect the cockpit
 * controls to the system blocks (source selection, start sequencing,
 * anti-ice automation, hydraulics ARM modes, reversers, ELDAC, flight-control
 * reset, HUD video selection ...). `G800Logic` runs before the power systems;
 * `G800PostLogic` after the alerting blocks (derived indications).
 *
 * Nothing allocates in update(); every var name is resolved at construction.
 * Sources: see data.ts abbreviations; behaviour notes per block below.
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import type { Subsystem } from '../../types';
import { ADC, AP, ENG, FMS, ICE } from '../../../core/vars';
import { interp1 } from '../../../core/math';
import { EPIC_VARS } from '../../../avionics/honeywell-epic/vars';
import { eprFromN1Br700 } from '../../../avionics/honeywell-epic/config';
import { G800_LIMITS, VMO_SCHEDULE } from '../data';
import { G800_VARS as V } from '../vars';
import { L_AC_SRC, R_AC_SRC } from './electrical';
import { FCC_AIR_OK, FCC_IRS_OK, FCC_SENSORS } from './sensorVote';
import { SUCTION_SL_PPH, SUCTION_ZERO_FT } from './fuel';

const FCC_PRESS_ALT = FCC_SENSORS.pressAlt;

/** Rising-edge helper without allocation. */
class Edge {
  private prev = false;
  rise(x: boolean): boolean {
    const r = x && !this.prev;
    this.prev = x;
    return r;
  }
  reset(x = false): void {
    this.prev = x;
  }
}

/** EST: confirmation time of valid FCC data before the automatic return to NORMAL law (no public figure). */
export const FCS_RECOVER_S = 2;
/** EST: LOCK RELEASE holds the handle lock solenoid released for this long after a press (mouse-operable handle). */
export const LOCK_REL_HOLD_S = 5;
/** Emergency Descent Mode (FSB GVIII-G700 Rev 1 App.: "EDM activation lowered from FL 400 to FL 250"; code450). */
export const EDM = { armAboveFt: 25000, speedKt: 340, altFt: 15000, slowKt: 250, turnDeg: -90 } as const;

export class G800Logic implements Subsystem {
  readonly name = 'g800.logic';
  /** Per-pair emergency-battery latches (fwd = L ESS, aft = R ESS; fix round 1 F08). */
  private ebattFwdLatched = false;
  private ebattAftLatched = false;
  private essWasUp = false;
  private ratLatched = false;
  private yawCentering = false;
  private readonly yawCenterEdge = new Edge();
  private readonly resetEdge = new Edge();
  private readonly hudUp = [new Edge(), new Edge()];
  private readonly hudDn = [new Edge(), new Edge()];
  private hudMode = [1, 1];
  /** Latched automatic FCS reversion (cleared automatically after FCS_RECOVER_S of valid data, or by FLT CTRL RESET). */
  private fcsLatched = false;
  private fcsOkT = 0;
  /** CRANK MASTER dry-motoring request per engine (latched by START, function fix round 1). */
  private readonly crankLatch = [false, false];
  private readonly startEdges = [new Edge(), new Edge()];
  private readonly reqEdges = [new Edge(), new Edge()];
  /** Start protection per engine: 0 none, 1 motoring (residual TGT / rotor bow), then a start pulse. */
  private readonly protect = [false, false];
  private readonly protectT = [0, 0];
  private readonly bowNeeded = [false, false];
  private readonly startPulse = [false, false];
  /** Seconds since each engine stopped running (rotor bow avoidance). */
  private readonly offS = [1e7, 1e7];
  /**
   * Pending AutoStart request per engine (fix round 1 P02): an ENGINE START / L-R START press with the FUEL
   * CONTROL still OFF is kept by the FADEC and executes when RUN is selected (EST: the real AutoStart always
   * answers a start request; C450S G700/G800 powerplant gives no discard behaviour). Cleared when the FADEC
   * auto start takes over, the engine runs, or CRANK MASTER is selected.
   */
  private readonly pendingStart = [false, false];
  private readonly engStartEdge = new Edge();
  /** APU START latched until the inlet door is open. */
  private apuStartLatch = false;
  private readonly apuStartEdge = new Edge();
  private readonly apuMasterEdge = new Edge();
  /** Suction-feed overdemand timers / latches (fuel.ts SUCTION_*). */
  private readonly suctionT = [0, 0];
  private readonly suctionFail = [false, false];
  /** Gear LOCK RELEASE hold timer. */
  private lockRelT = 0;
  /** Emergency Descent Mode. */
  private edm = false;
  private edmSlow = false;
  private readonly edmEdge = new Edge();
  private ptuLatch = false;
  private auxLatch = false;
  /** AC / DC RESET: one reset per flight (code450 G700/G800 electrical: "One time use"). */
  private readonly elecResetEdge = new Edge();
  private elecResetUsed = false;
  private elecResetT = 0;

  constructor(
    private readonly vars: SimVars,
    private readonly events?: EventBus,
  ) {}

  reset(): void {
    const v = this.vars;
    this.ebattFwdLatched = v.get(V.ebattFwdOn, v.get(V.ebattOn)) !== 0;
    this.ebattAftLatched = v.get(V.ebattAftOn, v.get(V.ebattOn)) !== 0;
    this.essWasUp = v.get('elec.l_ess_dc_v') > 22 || v.get('elec.r_ess_dc_v') > 22;
    this.ratLatched = v.get(V.ratDeployed) !== 0;
    this.yawCentering = false;
    this.fcsLatched = false;
    this.fcsOkT = 0;
    for (let i = 0; i < 2; i++) {
      const running = v.get(ENG.running(i + 1)) !== 0;
      this.crankLatch[i] = false;
      this.startEdges[i].reset(v.get(i === 0 ? V.startL : V.startR) !== 0);
      this.reqEdges[i].reset(false);
      this.protect[i] = false;
      this.protectT[i] = 0;
      this.bowNeeded[i] = false;
      this.startPulse[i] = false;
      this.pendingStart[i] = false;
      this.offS[i] = running ? 0 : 1e7; // presets: engines off for a long time (cold soak, no rotor bow)
    }
    this.engStartEdge.reset(v.get(V.engStartBtn) !== 0);
    this.apuStartLatch = false;
    this.apuStartEdge.reset(v.get(V.apuStart) !== 0);
    this.apuMasterEdge.reset(v.get(V.apuMaster) === 1);
    this.lockRelT = 0;
    this.suctionT[0] = this.suctionT[1] = 0;
    this.suctionFail[0] = this.suctionFail[1] = false;
    this.edm = false;
    this.edmSlow = false;
    this.edmEdge.reset(v.get('press.cabin_alt_warn') !== 0);
    this.ptuLatch = v.get(V.ptuOn) !== 0 && v.get(V.ptu) === 1;
    this.auxLatch = v.get(V.auxPumpOn) !== 0 && v.get(V.auxPump) === 1;
    this.yawCenterEdge.reset(v.get(V.yawTrimCenter) !== 0);
    this.resetEdge.reset(v.get(V.fltCtrlReset) !== 0);
    this.elecResetEdge.reset(v.get(V.elecReset) !== 0);
    this.elecResetUsed = false;
    this.elecResetT = 0;
    for (let s = 0; s < 2; s++) {
      const r = v.get(V.hudRocker(s === 0 ? 1 : 2));
      this.hudUp[s].reset(r > 0.5);
      this.hudDn[s].reset(r < -0.5);
      this.hudMode[s] = v.get(EPIC_VARS.evs(s + 1)) !== 0 ? (v.get(EPIC_VARS.svs(s + 1)) !== 0 ? 3 : 2) : v.get(EPIC_VARS.svs(s + 1)) !== 0 ? 1 : 0;
    }
  }

  private bleedAvail(i: 1 | 2): boolean {
    return this.vars.get(i === 1 ? V.bleedL : V.bleedR) === 1 && this.vars.get(ENG.running(i)) !== 0;
  }

  /** OFF / AUTO / ON switch: 1 when ON, or AUTO with the automatic condition. */
  private sw3(name: string, auto: boolean): number {
    const s = this.vars.get(name);
    return s === 2 || (s === 1 && auto) ? 1 : 0;
  }

  private startEdm(): void {
    const v = this.vars;
    const ev = this.events;
    this.edm = true;
    this.edmSlow = false;
    v.set(AP.selAltitude, EDM.altFt);
    v.set(AP.selHeading, (((v.get(ADC.heading(1)) + EDM.turnDeg) % 360) + 360) % 360);
    if (ev) {
      if (v.getString(AP.lateralActive) !== 'HDG') ev.emit('ap.hdg');
      if (v.getString(AP.verticalActive) !== 'FLC') ev.emit('ap.flc');
      if (v.get(AP.athr) === 0) ev.emit('at.engage');
    }
    v.set(EPIC_VARS.speedMan, 1);
    v.set(AP.speedIsMach, 0);
    v.set(AP.selSpeed, EDM.speedKt);
  }

  update(dt: number): void {
    const v = this.vars;
    const onGround = v.get('gear.air_ground') !== 0;
    const ias = v.get(ADC.ias(1));

    // ---------------- power levers / reversers (GVI: idle reverse by 60 KCAS)
    for (let i = 1; i <= 2; i++) {
      const tla = v.get(V.tla(i));
      const rev = v.get(V.rev(i));
      let eff = tla;
      if (rev > 0.02 && tla < 0.05) {
        const lim = ias > G800_LIMITS.reverseIdleByKt ? 1 : Math.max(0, (ias - 40) / 20);
        eff = -Math.max(0.001, Math.min(rev, lim)); // stays in the reverse range (sleeve deployed) at idle reverse
      }
      v.set(V.tlaEff(i), eff);
    }
    const idleBoth = v.get(V.tla(1)) < 0.05 && v.get(V.tla(2)) < 0.05;
    v.set(V.idleBoth, idleBoth ? 1 : 0);
    v.set(V.toThrust, v.get(V.tla(1)) > 0.85 && v.get(V.tla(2)) > 0.85 ? 1 : 0);

    // ---------------- AC source selection: onside IDG > APU > GPU (systems-power G650 recipe; SCQ)
    const idg1 = v.get('elec.idg1_online') !== 0;
    const idg2 = v.get('elec.idg2_online') !== 0;
    const apu = v.get('elec.apu_gen_online') !== 0;
    const gpu = v.get('elec.gpu_online') !== 0;
    const lsrc = idg1 ? 1 : apu ? 2 : gpu ? 3 : 0;
    const rsrc = idg2 ? 1 : apu ? 2 : gpu ? 3 : 0;
    v.set(L_AC_SRC, lsrc);
    v.set(R_AC_SRC, rsrc);
    // BUS TIE AUTO needs the OHPTS key and both L / R BUS TIE switchlights (G600 ELECTRICAL POWER CONTROL, blue AUTO) in AUTO.
    const tieAuto = v.get(V.busTie) === 1 && v.get(V.busTieL, 1) === 1 && v.get(V.busTieR, 1) === 1;
    v.set('ac.g800.bus_tie_auto', tieAuto ? 1 : 0);
    v.set(V.busTieCmd, tieAuto && (lsrc === 0) !== (rsrc === 0) ? 1 : 0);
    // AC / DC RESET (ELECTRICAL POWER CONTROL): resets tripped GCUs once when the fault has cleared ("one time use",
    // code450 G700/G800 electrical study sheets); re-armed on the ground (EST). The pulse feeds the IDG reset bindings.
    if (this.elecResetEdge.rise(v.get(V.elecReset) !== 0) && !this.elecResetUsed) {
      this.elecResetT = 0.5;
      if (!onGround) this.elecResetUsed = true;
    }
    if (onGround && v.get(V.elecReset) === 0) this.elecResetUsed = false;
    this.elecResetT = Math.max(0, this.elecResetT - dt);
    v.set('ac.g800.elec_reset_pulse', this.elecResetT > 0 ? 1 : 0);

    // ---------------- RAT: manual deployment only (SCQ); cannot be re-stowed in flight.
    if (v.get(V.ratDeploy) !== 0) this.ratLatched = true;
    else if (onGround) this.ratLatched = false;
    v.set(V.ratDeployed, this.ratLatched ? 1 : 0);
    v.set(V.ratSpeed, this.ratLatched ? v.get('fdm.ias_kt') : 0); // physical turbine speed from the airflow
    v.set('ac.g800.rat_mode', v.get(V.ratGen, 1) === 1 && v.get('elec.rat_online') !== 0 && v.get('elec.l_main_ac_powered') === 0 && v.get('elec.r_main_ac_powered') === 0 ? 1 : 0);

    // ---------------- emergency batteries: ARM connects a pair when its ESS DC bus drops below 20 V (SCQ).
    // Two independent pairs (code450 G700/G800 electrical: four 24 V 9 Ah batteries in a forward and an aft
    // pair, each with its own "Fwd/Aft Emer Battery On" advisory): the FWD pair backs the L ESS DC bus, the
    // AFT pair the R ESS DC bus (EST assignment), latched separately (fix round 1 F08).
    const essL = v.get('elec.l_ess_dc_v');
    const essR = v.get('elec.r_ess_dc_v');
    // EMERGENCY POWER ON / ARM / OFF switchlights (code450 G700/G800 electrical): ON forces the E-batts on.
    if (v.get(V.emerPwr) === 0) this.ebattFwdLatched = this.ebattAftLatched = false;
    else if (v.get(V.emerPwr) === 2) this.ebattFwdLatched = this.ebattAftLatched = true;
    else if (this.essWasUp) {
      if (essL < G800_LIMITS.emerBattArmV) this.ebattFwdLatched = true;
      if (essR < G800_LIMITS.emerBattArmV) this.ebattAftLatched = true;
    }
    if (essL > 22 && essR > 22) this.essWasUp = true;
    v.set(V.ebattFwdOn, this.ebattFwdLatched ? 1 : 0);
    v.set(V.ebattAftOn, this.ebattAftLatched ? 1 : 0);
    v.set(V.ebattOn, this.ebattFwdLatched || this.ebattAftLatched ? 1 : 0);

    // ---------------- engine start. G700/G800 AutoStart (code450 powerplant study sheets): "initiated by positioning the
    // fuel control switch to RUN and momentarily depressing the ENGINE START switch" (forward overhead strip). The OHPTS
    // ENGINE page START MASTER + L / R START keys (shared Epic page) request the same FADEC auto start; CRANK MASTER dry motoring.
    const engStart = v.get(V.engStartBtn) !== 0;
    const engStartRise = this.engStartEdge.rise(engStart);
    const crank = v.get(V.crankMaster) === 1;
    for (let i = 1; i <= 2; i++) {
      const k = i - 1;
      const btn = v.get(i === 1 ? V.startL : V.startR) !== 0;
      const btnRise = this.startEdges[k].rise(btn);
      const fuelRun = v.get(i === 1 ? V.runL : V.runR) === 1;
      const running = v.get(ENG.running(i)) !== 0;
      const n2 = v.get(ENG.n2(i));
      // Time since shutdown (rotor bow avoidance, C450S G700/G800 powerplant).
      this.offS[k] = running || n2 > 50 ? 0 : this.offS[k] + dt;

      // CRANK MASTER dry motoring (GV-family crank procedure; EST for the G800): with CRANK MASTER ON, a START press
      // latches the starter; the next press, CRANK MASTER OFF or the starter duty limit (G800_LIMITS.maxStarterS
      // equivalent, 180 s in the start controller) ends it. The engine is not fuelled (no start request).
      if (!crank || running) this.crankLatch[k] = false;
      else if (btnRise) this.crankLatch[k] = !this.crankLatch[k];
      v.set(V.crankReq(i as 1 | 2), this.crankLatch[k] ? 1 : 0);

      // Start request: OHPTS START MASTER + L/R START, or the forward-strip ENGINE START with FUEL CONTROL at RUN.
      // Fix round 1 P02: a press before RUN is latched pending (see pendingStart) so selecting RUN afterwards
      // completes the AutoStart instead of the 0.5 s press being discarded.
      if (((v.get(V.startMaster) === 1 && btnRise) || engStartRise) && !running && !crank) this.pendingStart[k] = true;
      if (running || crank || v.get(`fadec.eng${i}.auto_starter`) !== 0) this.pendingStart[k] = false;
      const rawReq = !crank && !running && fuelRun && (this.pendingStart[k] || (v.get(V.startMaster) === 1 && btn) || engStart);
      // Start protection (C450S G700/G800 powerplant: max TGT prior to start 120 C; rotor-bow avoidance 50 s dry crank
      // after a shutdown of 20 min .. 5 h, SVO displayed, CAS "Engine Start Protect"): a start request with the engine
      // hot or bowed motors it first; the start proceeds automatically once the protection is complete.
      if (this.reqEdges[k].rise(rawReq) && !running) {
        const off = this.offS[k];
        this.bowNeeded[k] = off > G800_LIMITS.rotorBowMinOffS && off < G800_LIMITS.rotorBowMaxOffS;
        if (this.bowNeeded[k] || v.get(ENG.itt(i)) > G800_LIMITS.maxResidualTgtStartC) {
          this.protect[k] = true;
          this.protectT[k] = 0;
        }
      }
      let req = rawReq;
      if (this.protect[k]) {
        req = false;
        this.protectT[k] += dt;
        const cool = v.get(ENG.itt(i)) <= G800_LIMITS.maxResidualTgtStartC;
        const bowDone = !this.bowNeeded[k] || this.protectT[k] >= G800_LIMITS.rotorBowMotorS;
        const cancelled = !fuelRun && v.get(V.startMaster) !== 1; // FUEL CONTROL OFF / START MASTER OFF cancel it
        if (cancelled || running) this.protect[k] = false;
        else if (cool && bowDone) {
          this.protect[k] = false;
          this.startPulse[k] = true; // hand the start to the FADEC auto start (rising edge next frame)
        }
      } else if (this.startPulse[k]) {
        req = true;
        this.startPulse[k] = false;
      }
      v.set(V.startProtect(i as 1 | 2), this.protect[k] ? 1 : 0);
      v.set(V.startReq(i), req ? 1 : 0);
      const auto = v.get(`fadec.eng${i}.auto_starter`) !== 0;
      const dry = (this.crankLatch[k] || this.protect[k]) && n2 < G800_LIMITS.starterCutoutN2Pct + 3;
      v.set(`fadec.eng${i}.starter_cmd`, auto || dry ? 1 : 0);
      // FSB App. 4: automatic engine bleed shutoff in certain abnormal conditions (EST: engine fire).
      v.set(`ac.g800.bleed_auto_off${i}`, v.get(`fire.eng${i}_warn`) !== 0 ? 1 : 0);
    }
    const autoAny = v.get('fadec.eng1.auto_starter') !== 0 || v.get('fadec.eng2.auto_starter') !== 0 || this.crankLatch[0] || this.crankLatch[1] || this.protect[0] || this.protect[1];
    const master = v.get(V.startMaster) === 1 || autoAny;

    // ---------------- bleed isolation valve and packs (SCQ: START MASTER opens the iso valve and shuts the packs)
    const iso = v.get(V.isoValve);
    const b1 = this.bleedAvail(1);
    const b2 = this.bleedAvail(2);
    const single = b1 !== b2;
    const isoAuto = master || (single && !onGround) || (single && v.get(V.waiOn(1)) + v.get(V.waiOn(2)) > 0) || (!b1 && !b2);
    v.set(V.isoOpen, iso === 2 || (iso === 1 && isoAuto) ? 1 : 0);
    const ram = v.get(V.ramAir) === 1;
    v.set(V.packOn(1), v.get(V.packL) === 1 && !master && !ram ? 1 : 0);
    v.set(V.packOn(2), v.get(V.packR) === 1 && !master && !ram ? 1 : 0);

    // ---------------- anti-ice automation (FSB App. 4: auto WAI inhibited on the ground and > FL350; auto CAI > FL350)
    const iced = v.get('ice.detected') !== 0;
    const below350 = v.get('adc1.press_alt_ft') < G800_LIMITS.autoWaiCaiInhibitFt;
    v.set(V.waiOn(1), this.sw3(V.waiL, iced && !onGround && below350));
    v.set(V.waiOn(2), this.sw3(V.waiR, iced && !onGround && below350));
    v.set(V.caiOn(1), this.sw3(V.caiL, iced && below350) * (v.get(ENG.running(1)) !== 0 ? 1 : 0));
    v.set(V.caiOn(2), this.sw3(V.caiR, iced && below350) * (v.get(ENG.running(2)) !== 0 ? 1 : 0));
    // Probe heat: AUTO heats in flight and with an engine running (EST; SCQ: TAT probe unheated on the ground at low speed/power).
    const probes = v.get(V.probeHeat);
    v.set(V.probeHeatOn, probes === 2 || (probes === 1 && (!onGround || v.get(ENG.running(1)) !== 0 || v.get(ENG.running(2)) !== 0)) ? 1 : 0);
    v.set('ac.g800.wshld_l_on', v.get(V.wshldL) === 1 ? 1 : 0);
    v.set('ac.g800.wshld_r_on', v.get(V.wshldR) === 1 ? 1 : 0);
    // Heated fuel return: AUTO at tank temperature <= -5 degC (SCQ); no altitude prerequisite on the G800 (FSB App. 4).
    const hfr = v.get(V.hfr);
    const cold = Math.min(v.get('fuel.left_temp_c'), v.get('fuel.right_temp_c')) <= -5;
    const engRun = v.get(ENG.running(1)) !== 0 || v.get(ENG.running(2)) !== 0;
    v.set(V.hfrActive, engRun && (hfr === 2 || (hfr === 1 && cold)) ? 1 : 0);

    // ---------------- suction feed limit (fuel.ts, EST): capacity falls with altitude; an engine demanding more than the
    // capacity for 2 s loses its suction feed until the capacity is back above an idle flow (EST 700 pph).
    const cap = SUCTION_SL_PPH * Math.max(0, 1 - v.get('fdm.press_alt_ft') / SUCTION_ZERO_FT);
    for (let k = 0; k < 2; k++) {
      const feeding = v.get(k === 0 ? 'fuel.eng1_suction' : 'fuel.eng2_suction') !== 0;
      const ff = v.get(ENG.fuelFlowPph(k + 1));
      this.suctionT[k] = feeding && ff > cap ? this.suctionT[k] + dt : 0;
      if (this.suctionT[k] > 2) this.suctionFail[k] = true;
      else if (this.suctionFail[k] && cap > 700) this.suctionFail[k] = false;
      v.set(k === 0 ? 'ac.g800.suction_fail1' : 'ac.g800.suction_fail2', this.suctionFail[k] ? 1 : 0);
    }

    // ---------------- hydraulics ARM modes (EST logic, SCQ functions)
    const lPsi = v.get('hyd.left_psi');
    const rPsi = v.get('hyd.right_psi');
    const ptu = v.get(V.ptu);
    const edpLLow = v.get('hyd.edp_l_lowpress') !== 0;
    // PTU ARM: starts below 1,800 psi left with the right system available and the left contained; keeps running
    // while the left EDP is not delivering (hysteresis, EST).
    const ptuSource = rPsi > 2200 && v.get('hyd.left_qty') > 0.1;
    if (ptu !== 1 || !ptuSource) this.ptuLatch = false;
    else if (lPsi < 1800) this.ptuLatch = true;
    else if (!edpLLow && lPsi > 2800) this.ptuLatch = false;
    const ptuOn = ptu === 2 || this.ptuLatch;
    v.set(V.ptuOn, ptuOn ? 1 : 0);
    // AUX ARM: in flight, starts below 1,500 psi left when the PTU cannot help, runs while the left EDP is low (EST);
    // on the ground it recharges the parking-brake accumulator (SCQ).
    const aux = v.get(V.auxPump);
    if (aux !== 1 || ptuOn) this.auxLatch = false;
    else if (onGround) this.auxLatch = v.get('brakes.accum_psi') < 1800 && v.get(V.parkBrake) !== 0;
    // Also on the left EDP low-pressure switch when the PTU cannot help (pressure-switch logic; function fix round 1).
    else if (lPsi < 1500 || (edpLLow && !ptuSource)) this.auxLatch = true;
    else if (!edpLLow) this.auxLatch = false;
    v.set(V.auxPumpOn, aux === 2 || this.auxLatch ? 1 : 0);

    // ---------------- steering: tiller priority (left seat, FSB 9.4 b), else hardware tiller axis
    const tiller = v.get(V.tiller);
    v.set(V.steerCmd, Math.abs(tiller) > 0.02 ? tiller : v.get('input.tiller'));
    // PEDAL STEER switchlight (BJT500: "the pedal steering switchlight and tiller ... on the left side ledge"): OFF removes
    // only the rudder-pedal steering authority (FSB App. 4: +/-7 deg); the tiller keeps working.
    // Failure 'steer.pedal' (G800, EST): the pedal-steering channel fails (CAS "Pedal Steering Fail"); tiller still steers.
    v.set(V.pedalSteerCmd, v.get(V.pedalSteer, 1) === 1 && v.get('fail.steer.pedal') === 0 ? v.get('input.yaw') : 0);

    // ---------------- pedestal PITCH TRIM split switch (G600 BL7C0705 p_trim; code450: "any pitch trim movement resulting from
    // an independent switch-half actuation indicates a system malfunction"): both halves in the same direction trim.
    const ta = v.get(V.altTrimA);
    const tb = v.get(V.altTrimB);
    v.set(V.altTrimCmd, ta !== 0 && ta === tb ? ta : 0);

    // ---------------- main door (DOORS panel, G600 BL7C0705 p_eng): electrically actuated airstair door, EST 10 s travel;
    // OPEN / close commands only on the ground, powered, with SAFETY off. SCOPE: no door-seal / handle logic.
    const dCmd = v.get(V.doorOpenCmd, -1);
    if (dCmd >= 0 && onGround && v.get(V.doorSafety) === 0 && v.get('elec.l_ess_dc_powered') !== 0) {
      const pos = v.get('ac.door.main');
      const tgt = dCmd >= 0.5 ? 1 : 0;
      const step = dt / 10;
      v.set('ac.door.main', pos + Math.max(-step, Math.min(step, tgt - pos)));
    }

    // ---------------- WARN INHIBIT (glareshield; code450 G700 taxi checklist "WARN INHIBIT . . . INHIBIT"): EST function -
    // holds nuisance cautions back from 80 KIAS on the takeoff roll to 400 ft RA (CAS 'when' clauses read the window).
    const ra = v.get('ra1.alt_ft', 9999);
    const toWindow = v.get(V.warnInhibit) !== 0 && v.get(V.toThrust) !== 0 && ((onGround && ias > 80) || (!onGround && ra < 400));
    v.set('ac.g800.warn_inh_active', toWindow ? 1 : 0);

    // ---------------- ELDAC (engine-loss directional assist, FSB App. 4): rudder against thrust asymmetry, airborne only.
    // EST: feed-forward 0.3 rudder equivalent per unit asymmetry (fraction of rated thrust), active above 15 %
    // asymmetry below 200 KIAS (FSB: engine failure at V1, single-engine approach and go-around); the FBW
    // NORMAL-law yaw channel (lateral-acceleration turn coordination) trims out the remaining sideslip.
    const t1 = v.get(ENG.thrustN(1));
    const t2 = v.get(ENG.thrustN(2));
    const asym = (t1 - t2) / (G800_LIMITS.thrustLbf * 4.448);
    const eldacOn = !onGround && ias < 200 && v.get('fbw.mode_code') === 0 && Math.abs(asym) > 0.15;
    v.set(V.eldac, eldacOn ? -0.3 * Math.max(-1, Math.min(1, asym)) : 0);

    // ---------------- FCS (two dual-channel FCCs + BFCU, SCQ; four modes normal / alternate / direct / backup, BJT500)
    // Power first (the latch reads it in the same frame).
    const fccPwr = v.get('elec.fcc_powered') !== 0;
    const bfcuPwr = v.get('elec.bfcu_powered') !== 0;
    v.set('fcc.power_ok', fccPwr || bfcuPwr ? 1 : 0);
    const fccFailed = v.get('fail.fbw.fcc') !== 0 || !fccPwr;
    // BACKUP: FCCs lost, the BFCU flies the aircraft with a direct-type law (EST law: the FBW DIRECT gearing).
    const backup = fccFailed && bfcuPwr;
    v.set(V.fcsBackup, backup ? 1 : 0);
    v.set(V.fccFault, fccFailed ? 1 : 0);
    // ALTERNATE: triplex air data / IRS voted 2-of-3 (systems/sensorVote.ts). BJT500: "If these conditions are fixed,
    // the FBW automatically returns to normal mode, or the pilot can push the flight-control reset switch." The
    // latch clears after FCS_RECOVER_S of valid data (EST 2 s confirmation) or at once with FLT CTRL RESET.
    const dataOk = v.get(FCC_AIR_OK) !== 0 && v.get(FCC_IRS_OK) !== 0 && v.get('fail.fbw.adc_data') === 0;
    if (!dataOk && !onGround && (fccPwr || bfcuPwr)) this.fcsLatched = true;
    this.fcsOkT = dataOk ? this.fcsOkT + dt : 0;
    if (this.fcsLatched && dataOk && (this.fcsOkT >= FCS_RECOVER_S || this.resetEdge.rise(v.get(V.fltCtrlReset) !== 0))) this.fcsLatched = false;
    else this.resetEdge.rise(v.get(V.fltCtrlReset) !== 0);
    v.set('ac.fcs_mode_sel', backup ? 2 : this.fcsLatched ? 1 : 0);

    // ---------------- rudder trim AUTO CENTER (SCQ: the FCCs neutralise the rudder trim at the standard rate)
    if (this.yawCenterEdge.rise(v.get(V.yawTrimCenter) !== 0)) this.yawCentering = true;
    const yawUnits = v.get('trim.yaw_units');
    if (this.yawCentering && (Math.abs(yawUnits) < 0.005 || v.get(V.yawTrimSw) !== 0)) this.yawCentering = false;
    v.set('ac.g800.yaw_trim_auto', this.yawCentering ? -Math.sign(yawUnits) : 0);

    // ---------------- HUD/EVS rocker on each sidestick (FSB App. 4: up cycles SVS/EVS/CVS video, down clears video)
    for (let s = 0; s < 2; s++) {
      const r = v.get(V.hudRocker(s === 0 ? 1 : 2));
      const up = this.hudUp[s].rise(r > 0.5);
      const dn = this.hudDn[s].rise(r < -0.5);
      if (up) this.hudMode[s] = this.hudMode[s] >= 3 ? 1 : this.hudMode[s] + 1;
      if (dn) this.hudMode[s] = 0;
      if (up || dn) {
        const m = this.hudMode[s];
        v.set(EPIC_VARS.svs(s + 1), m === 1 || m === 3 ? 1 : 0);
        v.set(EPIC_VARS.evs(s + 1), m === 2 || m === 3 ? 1 : 0);
      }
    }

    // ---------------- GP-700 speed source FMS (MAN key off): the speed target follows the FMS speed schedule in every
    // AFCS / autothrottle mode, not only in VNAV (G450/G650 AFCS: "FMS speed ... magenta speed target on the PFD";
    // code450). The suite's MAN key only changed the GP window and the PFD colour, so FLCH / A/T SPD kept flying the
    // last manual speed (found by tests/aircraft/g800/verify). EST: Mach when the FMS target is a Mach number.
    if (v.get(EPIC_VARS.speedMan, 1) === 0) {
      const kt = v.get(FMS.vnavTargetSpeedKt);
      const mach = v.get(FMS.vnavTargetMach);
      if (mach > 0.3) {
        if (Math.abs(v.get('ap.sel_mach') - mach) > 0.0005) v.set('ap.sel_mach', Math.round(mach * 1000) / 1000);
        v.set('ap.spd_is_mach', 1);
      } else if (kt > 60) {
        if (Math.abs(v.get('ap.sel_spd_kt') - kt) > 0.5) v.set('ap.sel_spd_kt', Math.round(kt));
        v.set('ap.spd_is_mach', 0);
      }
    }

    // ---------------- APU (function fix round 1)
    // START pressed before the inlet door is open is kept by the ECU and executed when the door is open (GVI-family
    // start sequence, EST); STOP / MASTER OFF clears it.
    const apuMaster = v.get(V.apuMaster) === 1;
    const apuState = v.get('apu.state');
    if (this.apuStartEdge.rise(v.get(V.apuStart) !== 0) && apuMaster && apuState <= 1) this.apuStartLatch = true;
    if (!apuMaster || apuState >= 2) this.apuStartLatch = false;
    v.set(V.apuStartCmd, v.get(V.apuStart) !== 0 || (this.apuStartLatch && v.get('apu.door_open') !== 0) ? 1 : 0);
    // DCN automation at APU MASTER ON (C450S G700/G800 APU: "When the MASTER switch is selected ON ... the DCN auto
    // selects: NAV lights ON, left main boost pump ON, the TROV to open"). EST: only on the ground; the boost pump is
    // set ON only from OFF (AUTO already runs it for the APU feed, fuel.ts). SCOPE: the TROV (thrust recovery outflow
    // valve) is fully open on the ground in AUTO anyway (Pressurization ground mode), so there is no separate command.
    if (this.apuMasterEdge.rise(apuMaster) && onGround) {
      v.set(V.ltNav, 1);
      if (v.get(V.boostL) === 0) v.set(V.boostL, 2);
    }

    // ---------------- gear handle LOCK RELEASE (GVI family: overrides the ground-lock solenoid while pressed and the
    // handle is moved). EST: the release holds LOCK_REL_HOLD_S after the press so the handle can be moved afterwards.
    // Failure 'gear.lock_solenoid' (G800): the solenoid stays locked in the air (WOW / solenoid fault after takeoff),
    // so the handle cannot be raised without LOCK RELEASE - the button's operational use.
    this.lockRelT = v.get(V.gearLockRel) !== 0 ? LOCK_REL_HOLD_S : Math.max(0, this.lockRelT - dt);
    const lockRel = this.lockRelT > 0;
    v.set(V.gearLockRelEff, lockRel ? 1 : 0);
    const stuckLock = !onGround && v.get('fail.gear.lock_solenoid') !== 0 && !lockRel;
    if (stuckLock && v.get(V.gearHandle) < 0.99 && v.get('gear.down_locked') !== 0) v.set(V.gearHandle, 1);
    v.set('ac.g800.gear_lock_air', stuckLock ? 1 : 0);

    // ---------------- VMO schedule for the autothrottle speed protection (TCDS / GVI: 340 KCAS, 300 below 8,000 ft)
    const pAlt = v.get(FCC_PRESS_ALT);
    v.set(V.vmoKt, interp1(VMO_SCHEDULE, pAlt));

    // ---------------- Emergency Descent Mode (FSB GVIII-G700 Rev 1 App. 3/4: "EDM activation lowered from FL 400 to
    // FL 250"; code450 Emergency Descent: with the AP ON and the red "Cabin Pressure Low", the SPEED target changes
    // to 340 KCAS in MANUAL, the ALTITUDE preselect is set to 15,000 ft, the AP turns 90 deg left in heading mode, the
    // A/T (engaging if needed) retards to idle and the aircraft descends at MMO / VMO; at 15,000 ft the speed target
    // becomes 250 KCAS; the pilot overrides EDM by disconnecting the AP). SCOPE: the speed brakes are not extended
    // automatically (code450: crew action; no verified G800 source for automatic extension).
    const apOn = v.get(AP.engaged) !== 0;
    const cabinWarn = v.get('press.cabin_alt_warn') !== 0;
    if (this.edmEdge.rise(cabinWarn) && apOn && pAlt > EDM.armAboveFt && !onGround) this.startEdm();
    if (this.edm) {
      if (!apOn) this.edm = false;
      else if (!this.edmSlow && pAlt < EDM.altFt + 300) {
        this.edmSlow = true;
        v.set(AP.speedIsMach, 0);
        v.set(AP.selSpeed, EDM.slowKt);
      } else if (!this.edmSlow) {
        v.set(EPIC_VARS.speedMan, 1);
        v.set(AP.speedIsMach, 0);
      }
    }
    v.set(V.edmActive, this.edm ? 1 : 0);

    // ---------------- emergency lights (Part 25.812: armed lights come on with the loss of normal power to their bus;
    // EST: the G800 cabin emergency lighting is armed from the essential DC buses) ARM = on when both ESS DC buses are
    // lost (the lights run on their own batteries), ON = on.
    const emer = v.get(V.ltEmer);
    v.set('ac.g800.emer_lts_on', emer === 2 || (emer === 1 && v.get('elec.l_ess_dc_powered') === 0 && v.get('elec.r_ess_dc_powered') === 0) ? 1 : 0);

    // ---------------- IRUs: no mode selectors on the G800; aligned to NAV automatically when powered.
    v.set('ac.g800.irs_mode', 2);

    // ---------------- radios / GPS power (aircraft-owned Radios)
    const r1 = v.get('elec.radio1_powered');
    const r2 = v.get('elec.radio2_powered');
    v.set('nav1.powered', r1);
    v.set('nav2.powered', r2);
    v.set('adf1.powered', r1);
    v.set('nav.marker_powered', r1);
    v.set('gps.powered', r1 || r2 ? 1 : 0);
    v.set(V.avionicsPowered, v.get('elec.du1_powered') || v.get('elec.du4_powered') ? 1 : 0);

    void dt;
  }
}

/** Derived indications written after the systems ran. */
export class G800PostLogic implements Subsystem {
  readonly name = 'g800.post';
  constructor(private readonly vars: SimVars) {}
  update(): void {
    const v = this.vars;
    // EPR (P50/P20) for the Epic engine window: SCOPE - derived from LP with the BR700-family relation.
    for (let i = 1; i <= 2; i++) {
      const n1 = v.get(ENG.n1(i));
      v.set(V.epr(i), n1 > 5 ? eprFromN1Br700(n1) : 1.0);
    }
    // Airframe ice = worst wing.
    v.set(ICE.airframe, Math.max(v.get('ice.wing_l'), v.get('ice.wing_r')));
    // Fire handle lock solenoids release with a real zone fire warning (code450 fire protection: "normally locked in the
    // stowed position by an electrical solenoid. When a fire signal activates, the solenoid opens"). The FIRE TEST lights
    // the handles (lamp = fire.eng{i}_warn) but does not release them (function fix round 1: no source that the test
    // releases the solenoids; a handle pulled during a routine test would shut the engine down).
    const test = v.get('fire.test') !== 0;
    v.set('ac.g800.fire_l_unlock', v.get('fire.eng1_warn') !== 0 && !test ? 1 : 0);
    v.set('ac.g800.fire_r_unlock', v.get('fire.eng2_warn') !== 0 && !test ? 1 : 0);
    v.set('ac.g800.fire_apu_unlock', v.get('fire.apu_warn') !== 0 && !test ? 1 : 0);
    // APU GEN amber OFF (dark cockpit, GV family): only with the APU available and its generator off line.
    v.set(V.apuGenOffLt, v.get('apu.avail') !== 0 && v.get('elec.apu_gen_online') === 0 ? 1 : 0);
    // Gear handle held by the solenoid: ground lock (LandingGear) or the stuck-solenoid failure in the air (logic).
    v.set(V.gearHandleLocked, v.get('gear.handle_lock') !== 0 || v.get('ac.g800.gear_lock_air') !== 0 ? 1 : 0);
  }
}
