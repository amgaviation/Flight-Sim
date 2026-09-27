/**
 * Gulfstream G650 automatic logic that the generic system blocks do not
 * cover (LUC system notes, LIM). Two subsystems:
 *
 *  - `G650Logic` (runs before the electrical network): thrust-lever state and
 *    the reverse speed schedule, AC bus power control (bus-tie relays, EXT /
 *    APU priority, RAT and EMER AC transfer, AUX TRU substitution), emergency
 *    batteries, AUX pump and PTU automation, bleed isolation valve, APU bleed
 *    delay, pack shut-off during starts, auto anti-ice (ice detectors), probe
 *    and windshield heat, crank latches, speed brake auto-retract, ground
 *    spoiler arming, FCC ALTERNATE latch / FLT CTRL RESET, heated fuel return,
 *    takeoff configuration.
 *  - `G650PostLogic` (runs after the engines and flight controls): engine
 *    failure latch, BACKUP PITCH trim and rudder AUTO CENTER (they act on the
 *    FBW stabilizer and the rudder trim directly), flight-control battery
 *    discharge.
 *
 * No per-step allocation: all var names are precomputed strings.
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import type { FlyByWire, TrimAxis } from '../../../systems/flightcontrols';
import { G650_LIMITS, LB } from '../data';
import { G650_VARS as V } from '../vars';
import { TLA } from './engines';

const N = {
  tla: ['', V.tla(1), V.tla(2)],
  tlaEff: ['', V.tlaEff(1), V.tlaEff(2)],
  running: ['', 'eng1.running', 'eng2.running'],
  n2: ['', 'eng1.n2_pct', 'eng2.n2_pct'],
  startBtn: ['', V.startL, V.startR],
  crank: ['', V.crankLatch(1), V.crankLatch(2)],
  starter: ['', 'fadec.eng1.starter_cmd', 'fadec.eng2.starter_cmd'],
  fuelCtl: ['', V.fuelCtlL, V.fuelCtlR],
  engFail: ['', V.engFail(1), V.engFail(2)],
  hfrs: ['', V.hfrsOn(1), V.hfrsOn(2)],
  tankTemp: ['', 'fuel.left_temp_c', 'fuel.right_temp_c'],
  tankKg: ['', 'fuel.tank0_kg', 'fuel.tank1_kg'],
  fireHandle: ['', V.fireHandleL, V.fireHandleR],
  probeSw: ['', V.probe(1), V.probe(2), V.probe(3), V.probe(4)],
  probeOn: ['', V.probeHeatOn(1), V.probeHeatOn(2), V.probeHeatOn(3), V.probeHeatOn(4)],
  waiL: V.waiCmd('l'),
  waiR: V.waiCmd('r'),
  caiL: V.caiCmd('l'),
  caiR: V.caiCmd('r'),
  wshldL: V.wshldOn('l'),
  wshldR: V.wshldOn('r'),
};

/** Normalized stabilizer rates: EST full travel 10 deg over the -1..1 range -> 0.2 per degree. */
export const STAB_PER_DEG = 0.2;

export class G650Logic implements Subsystem {
  readonly name = 'g650.logic';
  private readonly v: SimVars;
  // ebatt
  private ebattLatch = false;
  private ebattRecoverT = 0;
  // aux pump / PTU
  private auxManT = 0;
  private prevAuxSw = 0;
  private auxGroundLatch = false;
  private ptuOn = false;
  private ptuLowT = 0;
  private ptuHighT = 0;
  // bleed / APU
  private apuAvailT = 0;
  // ice auto
  private iceClearT = 1e6;
  // crank latches
  private readonly prevBtn = [0, 0, 0];
  private readonly crank = [false, false, false];
  private readonly crankT = [0, 0, 0];
  // speed brake
  private sbRetracted = false;
  // FCC alternate latch
  private altLatch = false;
  private prevReset = 0;
  // HFRS
  private readonly hfrs = [false, false, false];

  constructor(vars: SimVars) {
    this.v = vars;
  }

  update(dt: number): void {
    const v = this.v;
    const ground = v.get('gear.air_ground') !== 0;
    const tla1 = v.get(N.tla[1]);
    const tla2 = v.get(N.tla[2]);
    const ias = v.get('adc1.ias_kt');

    // ---------------- thrust levers
    v.set(V.toThrust, tla1 >= TLA.toRange || tla2 >= TLA.toRange ? 1 : 0);
    // "At idle" includes the integral reverse range aft of the idle stop: selecting reverse after touchdown must
    // not stow the ground spoilers or disarm the autobrake (found by tests/aircraft/g650/verify: both dropped out
    // the moment the reversers were raised, and the rollout ran on reverse thrust alone).
    v.set(V.idleBoth, tla1 <= TLA.idle && tla2 <= TLA.idle ? 1 : 0);
    v.set(V.idleAny, tla1 <= TLA.idle || tla2 <= TLA.idle ? 1 : 0);
    // LIM: "Idle reverse position by 60 KCAS": the FADEC fades reverse thrust to idle from 100 to 60 KCAS (EST onset).
    const revFrac = ias >= 100 ? 1 : ias <= 60 ? 0 : (ias - 60) / 40;
    v.set(N.tlaEff[1], tla1 >= 0 ? tla1 : Math.min(-0.03, tla1 * revFrac));
    v.set(N.tlaEff[2], tla2 >= 0 ? tla2 : Math.min(-0.03, tla2 * revFrac));

    // ---------------- AC bus power control (LUC electrical)
    const idg1 = v.get('elec.idg1_online') !== 0;
    const idg2 = v.get('elec.idg2_online') !== 0;
    const apuG = v.get('elec.apu_gen_online') !== 0;
    const gpuAvail = v.get(V.gpuAvail) !== 0;
    const extSel = v.get(V.extPwr) === 1 && gpuAvail;
    // EXT AC and the APU generator share the tie bus: the APU generator takes priority (EST).
    const ext = extSel && !apuG && v.get('elec.gpu_avail') !== 0;
    v.set(V.extCmd, ext ? 1 : 0);
    const tieSrc = apuG || ext;
    const lAuto = v.get(V.busTieL) === 1;
    const rAuto = v.get(V.busTieR) === 1;
    const lBtb = lAuto && ((!idg1 && (tieSrc || (idg2 && rAuto))) || (!tieSrc && idg1 && !idg2 && rAuto));
    const rBtb = rAuto && ((!idg2 && (tieSrc || (idg1 && lAuto))) || (!tieSrc && idg2 && !idg1 && lAuto));
    v.set(V.lBtbCmd, lBtb && v.get('fail.elec.l_btb') === 0 ? 1 : 0);
    v.set(V.rBtbCmd, rBtb && v.get('fail.elec.r_btb') === 0 ? 1 : 0);
    // RAT: generator drive = airspeed while deployed (physical coupling, not an avionics reading).
    const ratDeployed = v.get(V.ratDeploy) !== 0;
    v.set(V.ratDrive, ratDeployed ? v.get('fdm.cas_kt') : 0);
    const ratOn = v.get('elec.rat_online') !== 0;
    v.set(V.ratMode, ratOn ? 1 : 0);
    v.set(V.emerFeedCmd, ratOn ? 0 : 1);
    // AUX TRU substitution: ESS before MAIN, L before R (LUC); the AUX DC bus is shed meanwhile.
    let subst = 0;
    if (v.get('elec.aux_tru_online') !== 0) {
      if (v.get('elec.l_ess_tru_online') === 0) subst = 1;
      else if (v.get('elec.r_ess_tru_online') === 0) subst = 2;
      else if (v.get('elec.l_main_tru_online') === 0 && v.get('elec.l_main_tru_x_online') === 0) subst = 3;
      else if (v.get('elec.r_main_tru_online') === 0 && v.get('elec.r_main_tru_x_online') === 0) subst = 4;
    }
    v.set(V.auxSubst, subst);
    // Emergency batteries (LUC): ON, or ARM and L and/or R ESS DC < 20 V "even momentarily"; EST: released once
    // both ESS DC buses are back above 24 V for 10 s, and not armed by the APU start dip of the left battery.
    const emer = v.get(V.emerPwr);
    const essLow = v.get('elec.l_ess_dc_v') < 20 || v.get('elec.r_ess_dc_v') < 20;
    const essGood = v.get('elec.l_ess_dc_v') > 24 && v.get('elec.r_ess_dc_v') > 24;
    if (emer === 1 && essLow && v.get('apu.starting') === 0) this.ebattLatch = true;
    this.ebattRecoverT = essGood ? this.ebattRecoverT + dt : 0;
    if (emer !== 1 || this.ebattRecoverT > 10) this.ebattLatch = false;
    v.set(V.ebattOn, emer === 2 || (emer === 1 && this.ebattLatch) ? 1 : 0);

    // ---------------- hydraulics: AUX pump and PTU (LUC hydraulics)
    const lPsi = v.get('hyd.left_psi');
    const rPsi = v.get('hyd.right_psi');
    const auxSw = v.get(V.auxPump);
    if (auxSw === 2 && this.prevAuxSw !== 2) this.auxManT = 0;
    this.prevAuxSw = auxSw;
    let aux = false;
    if (auxSw === 2) {
      // Manual ON: continuous on the ground, 2 min timer in flight (LUC).
      this.auxManT += dt;
      aux = ground || this.auxManT < 120;
    } else if (auxSw === 1) {
      const pedals = Math.max(v.get('input.brake_left'), v.get('input.brake_right')) > 0.1 || v.get(V.parkBrake) > 0.1;
      // Ground: auto latch with low L pressure, WOW and a brake pedal (LUC); released when L pressure recovers.
      if (ground && lPsi < G650_LIMITS.hydLowPsi && pedals) this.auxGroundLatch = true;
      if (!ground || lPsi > 2900) this.auxGroundLatch = false;
      // Flight: gear / flaps not matching the handle with low L pressure, above 100 KCAS (LUC).
      const disagree = v.get('gear.transit') !== 0 || v.get('gear.disagree') !== 0 || Math.abs(v.get('flaps.cmd_deg') - v.get('surf.flaps_deg')) > 0.5;
      aux = this.auxGroundLatch || (!ground && lPsi < G650_LIMITS.hydLowPsi && disagree && ias > 100);
    }
    if (v.get('hyd.left_qty') < 0.08) aux = false; // LUC: inhibited below 0.36 gal of L fluid
    v.set(V.auxPumpCmd, aux ? 1 : 0);
    // PTU: ARM -> auto ON when L < 2,400 psi for 7 s, OFF 7 s after L >= 2,750 psi (LUC); inhibited with low L
    // quantity or a failed right system (EST 1,500 psi).
    const ptuSw = v.get(V.ptu);
    const ptuInhibit = v.get('hyd.left_lowqty') !== 0 || rPsi < G650_LIMITS.hydLowPsi;
    this.ptuLowT = lPsi < G650_LIMITS.ptuOnPsi ? this.ptuLowT + dt : 0;
    this.ptuHighT = lPsi >= G650_LIMITS.ptuOffPsi ? this.ptuHighT + dt : 0;
    if (ptuSw === 1) {
      if (!this.ptuOn && this.ptuLowT >= 7 && (v.get('eng2.running') !== 0 || !ground)) this.ptuOn = true;
      if (this.ptuOn && this.ptuHighT >= 7) this.ptuOn = false;
    } else this.ptuOn = ptuSw === 2;
    v.set(V.ptuCmd, this.ptuOn && !ptuInhibit ? 1 : 0);

    // ---------------- bleed air / packs (LUC pneumatics, air conditioning)
    const startMaster = v.get(V.startMaster) === 1;
    const crankMaster = v.get(V.crankMaster) === 1;
    this.apuAvailT = v.get('apu.avail') !== 0 ? this.apuAvailT + dt : 0;
    const apuBleedReady = this.apuAvailT >= 60; // LUC: APU bleed (LCV) after 60 s
    v.set(V.apuBleedReady, apuBleedReady ? 1 : 0);
    const isoSw = v.get(V.isolation);
    const apuBleedOn = v.get(V.bleedApu) === 1 && apuBleedReady && ground;
    v.set(V.isoCmd, isoSw === 2 || (isoSw === 1 && (startMaster || crankMaster || apuBleedOn)) ? 1 : 0);
    const ram = v.get(V.ramAir) === 1;
    const starting = v.get(N.starter[1]) !== 0 || v.get(N.starter[2]) !== 0;
    v.set(V.packLCmd, v.get(V.packL) === 1 && !ram && !starting && v.get('elec.r_ess_dc_powered') !== 0 ? 1 : 0);
    v.set(V.packRCmd, v.get(V.packR) === 1 && !ram && !(startMaster || crankMaster) && v.get('elec.l_ess_dc_powered') !== 0 ? 1 : 0);

    // ---------------- ice protection (LUC ice)
    const detected = v.get('ice.detected') !== 0;
    const autoInhibit = v.get('adc1.press_alt_ft') > 35000; // LIM: auto anti-ice inhibited above 35,000 ft
    v.set(V.iceAutoInhibit, autoInhibit ? 1 : 0);
    this.iceClearT = detected && !autoInhibit ? 0 : this.iceClearT + dt;
    const cowlAuto = this.iceClearT < 180; // cowl valves close 3 min after the last ice (LUC)
    const wingAuto = this.iceClearT < 300 && !ground; // wing valves 5 min (LUC); wing anti-ice is not auto on the ground (EST)
    v.set(N.waiL, this.knob(V.wingL, wingAuto));
    v.set(N.waiR, this.knob(V.wingR, wingAuto));
    v.set(N.caiL, this.knob(V.cowlL, cowlAuto));
    v.set(N.caiR, this.knob(V.cowlR, cowlAuto));
    v.set(N.wshldL, v.get(V.wshldL) === 1 ? 1 : 0);
    v.set(N.wshldR, v.get(V.wshldR) === 1 ? 1 : 0);
    // Air data probes heated after engine start (LUC) or in flight.
    const engRun = v.get(N.running[1]) !== 0 || v.get(N.running[2]) !== 0;
    for (let n = 1; n <= 4; n++) v.set(N.probeOn[n], v.get(N.probeSw[n]) === 1 && (engRun || !ground) ? 1 : 0);

    // ---------------- engine start: CRANK MASTER latches the L/R ENG switchlights (push on / push off, LUC)
    for (let i = 1; i <= 2; i++) {
      const b = v.get(N.startBtn[i]);
      if (crankMaster && b !== 0 && this.prevBtn[i] === 0) this.crank[i] = !this.crank[i];
      this.prevBtn[i] = b;
      if (!crankMaster) this.crank[i] = false;
      this.crankT[i] = this.crank[i] ? this.crankT[i] + dt : 0;
      if (this.crankT[i] > 180) this.crank[i] = false; // LIM starter duty: 3 minutes
      v.set(N.crank[i], this.crank[i] ? 1 : 0);
    }

    // ---------------- speed brake: 30 deg in flight (LUC); auto-retract at 95 % TRA or high AOA (panels, handle stays)
    const lever = v.get(V.speedbrake);
    if (lever < 0.02) this.sbRetracted = false;
    else if (!ground && (tla1 > TLA.sbRetract || tla2 > TLA.sbRetract || v.get('fbw.aoa_limit') !== 0 || v.get('alert.stick_shaker') !== 0)) this.sbRetracted = true;
    v.set(V.sbAutoRetract, this.sbRetracted ? 1 : 0);
    const fbwMode = v.get('fbw.mode_code');
    v.set(V.sbCmd, this.sbRetracted || fbwMode >= 2 ? 0 : Math.min(1, Math.max(0, lever))); // no speed brake in DIRECT/BACKUP (LUC)
    v.set(V.aircraftConfig, !ground && v.get('spoilers.sb_ext') > 0.05 && (v.get('surf.flaps_deg') > 30 || v.get('gear.down_locked') !== 0) ? 1 : 0);
    // Ground spoilers: GND SPOILER ARMED, not in DIRECT (LUC: no ground spoilers in Direct / BFCU).
    v.set(V.gsArmed, v.get(V.gndSpoiler) === 1 && fbwMode < 2 ? 1 : 0);

    // ---------------- FCC ALTERNATE latch (LUC): lost air data (< 2 ADS) or inertial data; FLT CTRL RESET returns
    // to NORMAL once the data are valid again.
    const ads = (v.get('adc1.valid') !== 0 ? 1 : 0) + (v.get('adc2.valid') !== 0 ? 1 : 0) + (v.get('adc3.valid') !== 0 ? 1 : 0);
    const irs = v.get('ahrs1.att_valid') !== 0 || v.get('ahrs2.att_valid') !== 0 || v.get('ahrs3.att_valid') !== 0;
    const dataBad = !ground && (ads < 2 || !irs || v.get('fail.fbw.adc_data') !== 0);
    if (dataBad) this.altLatch = true;
    const reset = v.get(V.fltCtrlReset);
    if (reset !== 0 && this.prevReset === 0 && !dataBad) this.altLatch = false;
    this.prevReset = reset;
    if (ground && !dataBad && v.get('fdm.gs_kt') < 1 && !engRun) this.altLatch = false; // power-up on the ground
    v.set(V.fcModeSel, this.altLatch ? 1 : 0);

    // ---------------- heated fuel return (LUC fuel): AUTO on at 0 degC tank temperature, off at 10 degC; inhibited
    // with the crossflow open, a pulled fire handle or < 600 lb in the tank.
    const hfr = v.get(V.fuelReturn);
    for (let i = 1; i <= 2; i++) {
      const t = v.get(N.tankTemp[i]);
      if (t <= 0) this.hfrs[i] = true;
      else if (t >= 10) this.hfrs[i] = false;
      const inhibit = hfr === 0 || v.get(V.xflow) === 1 || v.get(N.fireHandle[i]) !== 0 || v.get(N.tankKg[i]) < 600 * LB || v.get(N.running[i]) === 0;
      v.set(N.hfrs[i], this.hfrs[i] && !inhibit ? 1 : 0);
    }

    // ---------------- FMS cruise phase for the automatic thrust rating (engines.ts: TO -> CLB -> CRZ).
    v.set(V.fmsCruise, !ground && v.getString('fms.vnav_phase') === 'CRZ' ? 1 : 0);

    // ---------------- RAAS INHIBIT (pedestal). SCOPE: the EGPWS runway awareness (RAAS) callouts are not modelled;
    // the switch sets the RAAS availability state (switchlight legend) only.
    v.set(V.raasActive, v.get('elec.taws_powered') !== 0 && v.get(V.raasInhibit) === 0 ? 1 : 0);

    // ---------------- takeoff configuration (LIM: takeoff prohibited outside Normal law; flaps 10/20)
    const flaps = v.get('surf.flaps_deg');
    const flapsTo = flaps > 8 && flaps < 22;
    const trimOk = v.get('trim.pitch_units') >= -0.2 && v.get('trim.pitch_units') <= 0.35; // G650 display green band (Epic G650_AIRFRAME)
    const sbOk = v.get(V.speedbrake) < 0.05;
    const park = v.get('brakes.parking_set') !== 0;
    v.set(V.noTakeoff, ground && (!flapsTo || !trimOk || !sbOk || park || fbwMode !== 0) ? 1 : 0);
  }

  /** Anti-ice rotary knob: OFF 0 / AUTO 1 / ON 2. */
  private knob(name: string, auto: boolean): number {
    const k = this.v.get(name);
    return k === 2 || (k === 1 && auto) ? 1 : 0;
  }

  reset(): void {
    const v = this.v;
    this.ebattLatch = false;
    this.ebattRecoverT = 0;
    this.auxManT = 0;
    this.prevAuxSw = v.get(V.auxPump);
    this.auxGroundLatch = false;
    this.ptuOn = v.get(V.ptu) === 2;
    this.ptuLowT = 0;
    this.ptuHighT = 0;
    this.apuAvailT = v.get('apu.avail') !== 0 ? 120 : 0;
    this.iceClearT = 1e6;
    for (let i = 1; i <= 2; i++) {
      this.prevBtn[i] = v.get(N.startBtn[i]);
      this.crank[i] = false;
      this.crankT[i] = 0;
      this.hfrs[i] = false;
    }
    this.sbRetracted = false;
    this.altLatch = false;
    this.prevReset = v.get(V.fltCtrlReset);
  }
}

/** After the engines / flight controls: engine-fail latch, BACKUP PITCH, AUTO CENTER, FCS battery discharge. */
export class G650PostLogic implements Subsystem {
  readonly name = 'g650.post_logic';
  private readonly v: SimVars;
  private readonly wasRunning = [false, false, false];
  private readonly failed = [false, false, false];
  private centering = false;

  constructor(
    vars: SimVars,
    private readonly fbw: FlyByWire,
    private readonly rudTrim: TrimAxis,
  ) {
    this.v = vars;
  }

  update(dt: number): void {
    const v = this.v;
    // FADEC engine failure: the engine stopped with its FUEL CONTROL switch at RUN.
    for (let i = 1; i <= 2; i++) {
      const running = v.get(N.running[i]) !== 0;
      const run = v.get(N.fuelCtl[i]) === 1;
      if (this.wasRunning[i] && !running && run) this.failed[i] = true;
      if (running || !run) this.failed[i] = false;
      this.wasRunning[i] = running;
      v.set(N.engFail[i], this.failed[i] ? 1 : 0);
    }
    // BACKUP PITCH trim (LUC): drives the stabilizer through the HSCU backup channel at 0.15 deg/s in every law.
    const bp = v.get(V.backupPitch);
    if (bp !== 0 && (v.get('elec.hscu1_powered') !== 0 || v.get('elec.hscu2_powered') !== 0)) {
      const s = this.fbw.stab + Math.sign(bp) * 0.15 * STAB_PER_DEG * dt;
      this.fbw.stab = s > 1 ? 1 : s < -1 ? -1 : s;
    }
    // AUTO CENTER: rudder trim back to neutral at the trim rate (EST 0.12 /s).
    if (v.get(V.autoCenter) !== 0) this.centering = true;
    if (v.get(V.rudTrimSw) !== 0) this.centering = false;
    if (this.centering) {
      const p = this.rudTrim.position;
      const step = 0.12 * dt;
      if (Math.abs(p) <= step) {
        this.rudTrim.setPosition(0);
        this.centering = false;
      } else this.rudTrim.setPosition(p - Math.sign(p) * step);
    }
    // ROLL MOTOR CONTROL (LUC): ON = the roll trim motor back-drives the yokes; OFF = trim straight to the FCCs.
    v.set(V.yokeRollTrim, v.get(V.rollMotor) === 1 ? v.get('surf.aileron_trim') : 0);
    // Flight-control batteries discharging ("ON" legend, LUC).
    v.set(V.fcsBatt, v.get('elec.ebha_batt_amps') < -1 || v.get('elec.ups_batt_amps') < -1 ? 1 : 0);
  }

  reset(): void {
    const v = this.v;
    for (let i = 1; i <= 2; i++) {
      this.wasRunning[i] = v.get(N.running[i]) !== 0;
      this.failed[i] = false;
    }
    this.centering = false;
  }
}
