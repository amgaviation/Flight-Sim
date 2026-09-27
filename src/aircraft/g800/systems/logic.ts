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
import type { Subsystem } from '../../types';
import { ADC, ENG, FMS, ICE } from '../../../core/vars';
import { EPIC_VARS } from '../../../avionics/honeywell-epic/vars';
import { eprFromN1Br700 } from '../../../avionics/honeywell-epic/config';
import { G800_LIMITS } from '../data';
import { G800_VARS as V } from '../vars';
import { L_AC_SRC, R_AC_SRC } from './electrical';

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

export class G800Logic implements Subsystem {
  readonly name = 'g800.logic';
  private ebattLatched = false;
  private essWasUp = false;
  private ratLatched = false;
  private yawCentering = false;
  private readonly yawCenterEdge = new Edge();
  private readonly resetEdge = new Edge();
  private readonly hudUp = [new Edge(), new Edge()];
  private readonly hudDn = [new Edge(), new Edge()];
  private hudMode = [1, 1];
  /** Latched automatic FCS reversion (cleared by FLT CTRL RESET when the data are valid). */
  private fcsLatched = false;
  private ptuLatch = false;
  private auxLatch = false;

  constructor(private readonly vars: SimVars) {}

  reset(): void {
    const v = this.vars;
    this.ebattLatched = v.get(V.ebattOn) !== 0;
    this.essWasUp = v.get('elec.l_ess_dc_v') > 22 || v.get('elec.r_ess_dc_v') > 22;
    this.ratLatched = v.get(V.ratDeployed) !== 0;
    this.yawCentering = false;
    this.fcsLatched = false;
    this.ptuLatch = v.get(V.ptuOn) !== 0 && v.get(V.ptu) === 1;
    this.auxLatch = v.get(V.auxPumpOn) !== 0 && v.get(V.auxPump) === 1;
    this.yawCenterEdge.reset(v.get(V.yawTrimCenter) !== 0);
    this.resetEdge.reset(v.get(V.fltCtrlReset) !== 0);
    for (let s = 0; s < 2; s++) {
      const r = v.get(V.hudRocker(s === 0 ? 1 : 2));
      this.hudUp[s].reset(r > 0.5);
      this.hudDn[s].reset(r < -0.5);
      this.hudMode[s] = v.get(EPIC_VARS.evs(s + 1)) !== 0 ? (v.get(EPIC_VARS.svs(s + 1)) !== 0 ? 3 : 2) : v.get(EPIC_VARS.svs(s + 1)) !== 0 ? 1 : 0;
    }
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
    v.set(V.busTieCmd, v.get(V.busTie) === 1 && (lsrc === 0) !== (rsrc === 0) ? 1 : 0);

    // ---------------- RAT: manual deployment only (SCQ); cannot be re-stowed in flight.
    if (v.get(V.ratDeploy) !== 0) this.ratLatched = true;
    else if (onGround) this.ratLatched = false;
    v.set(V.ratDeployed, this.ratLatched ? 1 : 0);
    v.set(V.ratSpeed, this.ratLatched ? v.get('fdm.ias_kt') : 0); // physical turbine speed from the airflow
    v.set('ac.g800.rat_mode', v.get('elec.rat_online') !== 0 && v.get('elec.l_main_ac_powered') === 0 && v.get('elec.r_main_ac_powered') === 0 ? 1 : 0);

    // ---------------- emergency batteries: ARM connects them when an ESS DC bus drops below 20 V (SCQ)
    const essL = v.get('elec.l_ess_dc_v');
    const essR = v.get('elec.r_ess_dc_v');
    if (v.get(V.emerPwr) === 0) this.ebattLatched = false;
    else if (this.essWasUp && (essL < G800_LIMITS.emerBattArmV || essR < G800_LIMITS.emerBattArmV)) this.ebattLatched = true;
    if (essL > 22 && essR > 22) this.essWasUp = true;
    v.set(V.ebattOn, this.ebattLatched ? 1 : 0);

    // ---------------- engine start: START MASTER + START button (FADEC auto start); CRANK MASTER dry motoring
    const master = v.get(V.startMaster) === 1;
    const crank = v.get(V.crankMaster) === 1;
    for (let i = 1; i <= 2; i++) {
      const btn = v.get(i === 1 ? V.startL : V.startR) !== 0;
      v.set(V.startReq(i), master && btn ? 1 : 0);
      const auto = v.get(`fadec.eng${i}.auto_starter`) !== 0;
      const dry = crank && btn && v.get(ENG.n2(i)) < G800_LIMITS.starterCutoutN2Pct;
      v.set(`fadec.eng${i}.starter_cmd`, auto || dry ? 1 : 0);
      // FSB App. 4: automatic engine bleed shutoff in certain abnormal conditions (EST: engine fire).
      v.set(`ac.g800.bleed_auto_off${i}`, v.get(`fire.eng${i}_warn`) !== 0 ? 1 : 0);
    }

    // ---------------- bleed isolation valve and packs (SCQ: START MASTER opens the iso valve and shuts the packs)
    const iso = v.get(V.isoValve);
    const bleedAvail = (i: 1 | 2): boolean => v.get(i === 1 ? V.bleedL : V.bleedR) === 1 && v.get(ENG.running(i)) !== 0;
    const single = bleedAvail(1) !== bleedAvail(2);
    const isoAuto = master || (single && !onGround) || (single && v.get(V.waiOn(1)) + v.get(V.waiOn(2)) > 0) || (!bleedAvail(1) && !bleedAvail(2));
    v.set(V.isoOpen, iso === 2 || (iso === 1 && isoAuto) ? 1 : 0);
    const ram = v.get(V.ramAir) === 1;
    v.set(V.packOn(1), v.get(V.packL) === 1 && !master && !ram ? 1 : 0);
    v.set(V.packOn(2), v.get(V.packR) === 1 && !master && !ram ? 1 : 0);

    // ---------------- anti-ice automation (FSB App. 4: auto WAI inhibited on the ground and > FL350; auto CAI > FL350)
    const iced = v.get('ice.detected') !== 0;
    const below350 = v.get('adc1.press_alt_ft') < G800_LIMITS.autoWaiCaiInhibitFt;
    const sw3 = (name: string, auto: boolean): number => {
      const s = v.get(name);
      return s === 2 || (s === 1 && auto) ? 1 : 0;
    };
    v.set(V.waiOn(1), sw3(V.waiL, iced && !onGround && below350));
    v.set(V.waiOn(2), sw3(V.waiR, iced && !onGround && below350));
    v.set(V.caiOn(1), sw3(V.caiL, iced && below350) * (v.get(ENG.running(1)) !== 0 ? 1 : 0));
    v.set(V.caiOn(2), sw3(V.caiR, iced && below350) * (v.get(ENG.running(2)) !== 0 ? 1 : 0));
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
    else if (lPsi < 1500) this.auxLatch = true;
    else if (!edpLLow) this.auxLatch = false;
    v.set(V.auxPumpOn, aux === 2 || this.auxLatch ? 1 : 0);

    // ---------------- steering: tiller priority (left seat, FSB 9.4 b), else hardware tiller axis
    const tiller = v.get(V.tiller);
    v.set(V.steerCmd, Math.abs(tiller) > 0.02 ? tiller : v.get('input.tiller'));

    // ---------------- ELDAC (engine-loss directional assist, FSB App. 4): rudder against thrust asymmetry, airborne only.
    // EST: feed-forward 0.3 rudder equivalent per unit asymmetry (fraction of rated thrust), active above 15 %
    // asymmetry below 200 KIAS (FSB: engine failure at V1, single-engine approach and go-around); the FBW
    // NORMAL-law yaw channel (lateral-acceleration turn coordination) trims out the remaining sideslip.
    const t1 = v.get(ENG.thrustN(1));
    const t2 = v.get(ENG.thrustN(2));
    const asym = (t1 - t2) / (G800_LIMITS.thrustLbf * 4.448);
    const eldacOn = !onGround && ias < 200 && v.get('fbw.mode_code') === 0 && Math.abs(asym) > 0.15;
    v.set(V.eldac, eldacOn ? -0.3 * Math.max(-1, Math.min(1, asym)) : 0);

    // ---------------- FCS: latched automatic ALTERNATE; FLT CTRL RESET (FSB 9.2.1 e: only when directed)
    const dataOk = v.get('adc1.valid') !== 0 && v.get('ahrs1.att_valid') !== 0 && v.get('fail.fbw.adc_data') === 0;
    if (!dataOk && !onGround && v.get('fcc.power_ok') !== 0) this.fcsLatched = true;
    if (this.resetEdge.rise(v.get(V.fltCtrlReset) !== 0) && dataOk) this.fcsLatched = false;
    v.set('ac.fcs_mode_sel', this.fcsLatched ? 1 : 0);
    v.set('fcc.power_ok', v.get('elec.fcc_powered') !== 0 || v.get('elec.bfcu_powered') !== 0 ? 1 : 0);
    v.set(V.fccFault, v.get('fail.fbw.fcc') !== 0 || v.get('fcc.power_ok') === 0 ? 1 : 0);

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

    // ---------------- emergency lights: ARM = on when the main DC buses fail (EST), ON = on
    const emer = v.get(V.ltEmer);
    v.set('ac.g800.emer_lts_on', emer === 2 || (emer === 1 && v.get('elec.l_main_dc_powered') === 0 && v.get('elec.r_main_dc_powered') === 0 && v.get('elec.l_ess_dc_powered') !== 0) ? 1 : 0);
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
    // Fire handle lock solenoids release with a fire warning (SCQ: 28 VDC solenoid, manual override).
    v.set('ac.g800.fire_l_unlock', v.get('fire.eng1_warn') !== 0 || v.get('fire.test') !== 0 ? 1 : 0);
    v.set('ac.g800.fire_r_unlock', v.get('fire.eng2_warn') !== 0 || v.get('fire.test') !== 0 ? 1 : 0);
    v.set('ac.g800.fire_apu_unlock', v.get('fire.apu_warn') !== 0 || v.get('fire.test') !== 0 ? 1 : 0);
  }
}
