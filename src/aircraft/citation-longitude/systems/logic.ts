/**
 * Citation Longitude automatic logic that the generic system blocks do not
 * cover. Everything here is aircraft automation described in the OG / BCA,
 * implemented as two subsystems:
 *
 *  - `LongitudeLogic` (runs before the electrical network): bus-tie
 *    automation, PTCU mode logic, rudder standby, automatic yaw damper,
 *    speedbrake flap limit and auto-stow, reverse-thrust speed schedule,
 *    bleed isolation / wing crossflow valves, APU bleed delay, dry-motor
 *    starter, windshield / pitot heat automation, ground-spoiler
 *    accumulators, fuel recirculation and temperatures, hydraulic fluid
 *    temperatures, NO TAKEOFF conditions.
 *  - `LongitudePostLogic` (runs after the engines/elec): start-pressure
 *    readout, dry-motor tracking, standby battery LEDs.
 *
 * No per-step allocation: all var names are precomputed strings.
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import { ENG, INPUT, SURF } from '../../../core/vars';
import { LON_LIMITS } from '../data';
import { LON_VARS as V } from '../vars';
import { FUEL_LOW_KG } from './fuel';

/** Var names precomputed once (the systems step must not allocate strings). Index 0 unused, 1 = left, 2 = right. */
const N = {
  running: ['', ENG.running(1), ENG.running(2)],
  n2: ['', ENG.n2(1), ENG.n2(2)],
  tla: ['', V.tla(1), V.tla(2)],
  autoStarter: ['', 'fadec.eng1.auto_starter', 'fadec.eng2.auto_starter'],
  starterCmd: ['', 'fadec.eng1.starter_cmd', 'fadec.eng2.starter_cmd'],
  boostOn: ['', 'fuel.boost_l_on', 'fuel.boost_r_on'],
  missionPowered: ['', 'elec.mission_l_powered', 'elec.mission_r_powered'],
  recircFail: ['', 'fail.fuel.recirc_l', 'fail.fuel.recirc_r'],
  tankKg: ['', 'fuel.tank0_kg', 'fuel.tank1_kg'],
  tankTemp: ['', 'fuel.left_temp_c', 'fuel.right_temp_c'],
  recircOn: ['', V.recircOn(1), V.recircOn(2)],
  inletC: ['', V.fuelInletC(1), V.fuelInletC(2)],
  dryMotorReq: ['', V.dryMotorReq(1), V.dryMotorReq(2)],
  lastShutdown: ['', V.lastShutdown(1), V.lastShutdown(2)],
  gsAccFail: ['fail.hyd.gs_accum1', 'fail.hyd.gs_accum2', 'fail.hyd.gs_accum3', 'fail.hyd.gs_accum4'],
  n1: ['', ENG.n1(1), ENG.n1(2)],
  genLoad: [V.genLoadPct('l'), V.genLoadPct('r'), V.genLoadPct('apu')],
  scavenge: ['', V.scavengeOn(1), V.scavengeOn(2)],
  engFail: ['', V.engFail(1), V.engFail(2)],
  hydTempA: V.hydTempC('a'),
  hydTempB: V.hydTempC('b'),
};

/** Thrust-lever positions (0..1 forward range; EST from OG 7-3/15-4: CRU ~ 30 deg TLA). */
export const TLA = {
  cru: 0.62,
  clb: 0.8,
  to: 1.0,
  /** T/O range threshold (throttles "advanced to takeoff" for CAS/cabin pre-pressurisation). */
  toRange: 0.9,
  /** Speedbrake auto-stow above ~30 deg TLA (OG 15-4: "around CRU power"). */
  sbStow: 0.6,
  idle: 0.03,
};

export class LongitudeLogic implements Subsystem {
  readonly name = 'lon.logic';
  private readonly v: SimVars;
  // bus tie
  private tieManual = false;
  private tieOverride = false;
  private prevAutoTie = false;
  private prevTieBtn = 0;
  private singleBattLatch = false;
  private prevBattCount = 0;
  // PTCU
  private ptcuPrev = 2;
  /** Time (s) since the knob last left HYD GEN; sentinel 1e9 when it has not left it since power-up. */
  private ptcuAwayT = 1e9;
  private genSrcB = true;
  private powerUpT = -1;
  // speedbrake
  private sbStowed = false;
  // APU bleed delay
  private apuAvailT = 0;
  private xflowT = 0;
  // ground spoiler accumulators (psi) x4: 1,2 on A; 3,4 on B (EST split)
  private readonly gsAcc = new Float64Array([3000, 3000, 3000, 3000]);
  private gsPrevDeployed = false;
  // hydraulic temps
  private hydTa = 20;
  private hydTb = 20;
  private readonly gsAccVars = [V.gsAccum(1), V.gsAccum(2), V.gsAccum(3), V.gsAccum(4)];
  private readonly tlaEff = ['ac.lon.tla_eff1', 'ac.lon.tla_eff2'];
  // POWER RESERVE auto trigger latch, flap fault latch
  private aprAutoLatch = false;
  private flapFault = false;
  private prevFlapReset = false;
  // G5000 power-up defaults (NAV lights ON, beacon NORM: OG 16-3)
  private prevG5000 = false;
  // wing A/I valve delay (OG 12-3), high-altitude airport mode latch (OG 11-3)
  private waiT = 0;
  private depElevFt = 0;
  private wasAir = false;

  constructor(vars: SimVars) {
    this.v = vars;
  }

  update(dt: number): void {
    const v = this.v;
    const ground = v.get('gear.air_ground') !== 0;
    const tla1 = v.get(N.tla[1]);
    const tla2 = v.get(N.tla[2]);

    // ---------------- throttle positions
    v.set(V.toThrust, tla1 >= TLA.toRange || tla2 >= TLA.toRange ? 1 : 0);
    v.set(V.idleBoth, Math.abs(tla1) <= TLA.idle && Math.abs(tla2) <= TLA.idle ? 1 : 0);

    // ---------------- reverse thrust: FADEC reduces reverse from 85 KIAS to idle at 45 KIAS (BCA)
    const ias = v.get('adc1.ias_kt');
    const revFrac = ias >= 85 ? 1 : ias <= 45 ? 0 : (ias - 45) / 40;
    v.set(V.revMaxFrac, revFrac);
    // ---------------- POWER RESERVE (glareshield lower tier, AOPA 2021 / Textron photographs: MANUAL and AUTO switchlights).
    // EST (AFM text not public; HTF7000-family APR practice): AUTO armed + takeoff thrust + one engine failing (N1 split
    // > 15 % or the FADEC engine-failure latch) triggers APR on the operating engine; MANUAL commands it on both. APR =
    // the TO/APR N1 rating (OG 1-3: TO/APR limit 96.79 %), applied to any lever in the CLB..TO range. Latched until
    // both levers come back below CRU or AUTO is disarmed.
    const n1a = v.get(N.n1[1]);
    const n1b = v.get(N.n1[2]);
    const toBoth = tla1 >= TLA.toRange || tla2 >= TLA.toRange;
    const engOut = v.get(N.engFail[1]) !== 0 || v.get(N.engFail[2]) !== 0 || (n1a > 40 || n1b > 40 ? Math.abs(n1a - n1b) > 15 : false);
    if (v.get(V.aprAuto) === 0) this.aprAutoLatch = false;
    else if (toBoth && engOut) this.aprAutoLatch = true;
    if (tla1 < TLA.cru && tla2 < TLA.cru) this.aprAutoLatch = false;
    const apr = this.aprAutoLatch || v.get(V.aprManual) !== 0;
    v.set(V.aprActive, apr ? 1 : 0);
    // CONTROL LOCK (pedestal aft left): the gust-lock linkage keeps the thrust levers at idle (EST interlock, Citation-
    // family practice); the logic clamps the effective lever too so keyboard / hardware throttles obey it.
    const locked = v.get(V.controlLock) !== 0;
    for (let i = 0; i < 2; i++) {
      let t = i === 0 ? tla1 : tla2;
      if (locked && t > TLA.idle) t = TLA.idle;
      if (apr && t >= TLA.clb - 0.02) t = TLA.to;
      // Keep a small reverse command so the doors stay deployed at reverse idle below 45 kt.
      v.set(this.tlaEff[i], t >= 0 ? t : Math.min(-0.03, t * revFrac));
    }

    // ---------------- electrical: bus tie automation (OG 5-5/5-6)
    const genL = v.get('elec.gen_l_online') !== 0;
    const genR = v.get('elec.gen_r_online') !== 0;
    const apuG = v.get('elec.apu_gen_online') !== 0;
    const gpu = v.get('elec.gpu_online') !== 0;
    const ptcuG = v.get('elec.ptcu_gen_online') !== 0;
    const primL = genL || apuG || gpu;
    const primR = genR || ptcuG;
    const bL = v.get(V.battL) !== 0;
    const bR = v.get(V.battR) !== 0;
    const battCount = (bL ? 1 : 0) + (bR ? 1 : 0);
    if (this.prevBattCount === 0 && battCount === 1) this.singleBattLatch = true;
    if (battCount !== 1) this.singleBattLatch = false;
    this.prevBattCount = battCount;
    const apuStarting = v.get('apu.starting') !== 0 || (v.get(V.apuKnob) === 2);
    const btn = v.get(V.busTieBtn);
    const oneSided = primL !== primR;
    const autoTie = oneSided || this.singleBattLatch || apuStarting;
    // OG 5-5/5-6: on the ground the button does nothing (fully automatic); in the air "pressing the button toggles
    // between the two available states". A press makes the crew selection authoritative (it masks the automatic
    // terms) until the next automatic trigger (a new one-sided / single-battery / APU-start event) or landing.
    if (autoTie && !this.prevAutoTie) this.tieOverride = false;
    this.prevAutoTie = autoTie;
    if (!ground && btn !== this.prevTieBtn) {
      this.tieManual = v.get(V.busTieCmd) === 0;
      this.tieOverride = true;
    }
    if (ground) {
      this.tieManual = false;
      this.tieOverride = false;
    }
    this.prevTieBtn = btn;
    const tie = this.tieOverride ? this.tieManual : autoTie;
    v.set(V.busTieOverride, this.tieOverride ? 1 : 0);
    v.set(V.busTieCmd, tie && v.get('fail.elec.bus_tie') === 0 ? 1 : 0);
    v.set(V.busTieClosed, v.get('elec.bus_tie_closed'));

    // ---------------- G5000 power-up defaults (OG 16-3): "Navigation lights are automatically selected on when the
    // Garmin G5000 is powered up"; the beacon "default power on is the Normal mode". Rising edge of GDU power only,
    // so the GTC Exterior Lights toggles keep working afterwards.
    const g5000 = v.get('elec.pfd1_powered') !== 0 || v.get('elec.mfd_powered') !== 0 || v.get('elec.pfd2_powered') !== 0;
    if (g5000 && !this.prevG5000) {
      v.set(V.ltNav, 1);
      v.set(V.ltBeaconMode, 1);
    }
    this.prevG5000 = g5000;
    v.set(V.g5000Up, g5000 ? 1 : 0);

    // ---------------- generator load vs the air / ground rating (OG 5-3: engine gens 400 A ground / 500 A in flight,
    // APU gen 500 A ground / 400 A in flight; GEN LOAD at 75 % of the available capacity). Previous-step amps.
    v.set(N.genLoad[0], (100 * v.get('elec.gen_l_amps')) / (ground ? LON_LIMITS.genGroundA : LON_LIMITS.genFlightA));
    v.set(N.genLoad[1], (100 * v.get('elec.gen_r_amps')) / (ground ? LON_LIMITS.genGroundA : LON_LIMITS.genFlightA));
    v.set(N.genLoad[2], (100 * v.get('elec.apu_gen_amps')) / (ground ? LON_LIMITS.apuGenGroundA : LON_LIMITS.apuGenFlightA));

    // ---------------- brakes (OG 14-2/14-3, DGAC card): the toe brakes are brake-by-wire (no demand without the
    // brake control unit); the EMER/PARK BRAKE handle meters the emergency pressure from the accumulator through its
    // own lines (createSystems.ts Brakes `emergency`), and sets the parking brake at full travel (PARK latch).
    const bbw = v.get('elec.brake_ctl_powered') !== 0;
    v.set(V.brakePedalL, bbw ? v.get(INPUT.brakeLeft) : 0);
    v.set(V.brakePedalR, bbw ? v.get(INPUT.brakeRight) : 0);
    v.set(V.parkSet, v.get(V.parkBrake) >= 0.95 ? 1 : 0);

    // ---------------- high-altitude airport mode (OG 11-3): departure OR destination field above 8,000 ft. The
    // departure elevation is latched at lift-off (baro altitude), cleared at touchdown.
    if (!ground && !this.wasAir) this.depElevFt = v.get('adc1.alt_ft') - Math.max(0, v.get('ra1.alt_ft'));
    if (ground) this.depElevFt = 0;
    this.wasAir = !ground;
    v.set(V.highAltLatched, this.depElevFt > 8000 || v.get('press.ldg_elev_ft') > 8000 ? 1 : 0);

    // ---------------- wing anti-ice valve delay (OG 12-3): "engines will spool slightly for 4 seconds before the wing
    // anti-ice bleed valves are opened"; the idle bump is the FADEC approach-idle schedule (engines.ts approachWhen).
    this.waiT = v.get(V.aiWing) !== 0 ? this.waiT + dt : 0;
    v.set(V.waiValvesOpen, this.waiT >= 4 ? 1 : 0);

    // ---------------- ECS pack mode (OG 10-3/10-4). ACM ONLY: heat exchangers bypassed; HEAT EXCHG ONLY (or the
    // automatic switch after an ACM fault, `fail.ecs.acm`): ACM bypassed, the pack cannot cool below the RAT.
    // APU-only bleed: 60 % of the ACS capacity in FLOW NORM, 100 % in HIGH (OG 10-4).
    const ecs = v.get(V.ecsMode);
    const acmFail = v.get('fail.ecs.acm') !== 0;
    const hx = ecs === 2 || (acmFail && ecs !== 1);
    v.set(V.ecsAutoHx, acmFail && ecs !== 2 ? 1 : 0);
    const rat = v.get('fdm.tat_c');
    // EST: ACM ONLY without the primary/secondary heat-exchanger pre-cooling: coldest outlet 10 degC, hottest 40 degC.
    v.set(V.ecsMinOutletC, hx ? Math.max(2, rat) : ecs === 1 ? 10 : 2);
    v.set(V.ecsMaxOutletC, ecs === 1 ? 40 : 70);
    const engBleed = v.get('pneu.eng1_valve_open') !== 0 || v.get('pneu.eng2_valve_open') !== 0;
    const apuOnly = !engBleed && v.get('pneu.apu_valve_open') !== 0;
    // Pack flow (EST NORM 0.42 kg/s, HIGH 0.55 kg/s = full ACS capacity): APU-only bleed gives 60 % of the capacity in
    // NORM and 100 % in HIGH (OG 10-4); ACM ONLY x 0.8 (EST: reduced performance, OG 10-3).
    const high = v.get(V.flow) !== 0;
    const flow = (high ? 0.55 : apuOnly ? 0.6 * 0.55 : 0.42) * (ecs === 1 ? 0.8 : 1);
    v.set(V.ecsPackFlowKgs, flow);

    // ---------------- windshield heat (automatic, needs generator power: BCA) and pitot/static heat (OG 12-4)
    v.set(V.wshldHeatOn, (genL || genR || apuG || gpu) && v.get('fail.ice.wshld_ctl') === 0 ? 1 : 0);
    const engFailAir = !ground && (v.get(N.running[1]) === 0 || v.get(N.running[2]) === 0);
    const pitotAuto = !ground || ias > 40 || engFailAir;
    v.set(V.pitotHeatOn, v.get(V.pitotStatic) !== 0 || pitotAuto ? 1 : 0);

    // ---------------- PTCU (OG 13-3/13-4, 5-6)
    const ptcu = v.get(V.ptcu);
    const aPsi = v.get('hyd.a_psi');
    const bPsi = v.get('hyd.b_psi');
    const motorPwr = v.get('elec.mission_l_v') > 18;
    // OG 13-4: HYD GEN "normally sources from System B, but may be switched to sourcing from System A if the switch
    // is moved away from HYD GEN for 1 second, then returned" (OG 5-7 states the reverse order; the Section 13 system
    // description is followed, see the dossier). The timer starts only on the exit edge from HYD GEN; a return
    // within 1..30 s toggles the source (EST 30 s window for a deliberate toggle), a later selection starts again
    // from the System B default. Every power-up resets the source to B.
    if (ptcu !== 4 && this.ptcuPrev === 4) this.ptcuAwayT = 0;
    else if (ptcu !== 4 && this.ptcuAwayT < 1e9) this.ptcuAwayT += dt;
    if (ptcu === 4 && this.ptcuPrev !== 4) {
      if (this.ptcuAwayT >= 1 && this.ptcuAwayT < 30) this.genSrcB = !this.genSrcB;
      else if (this.ptcuAwayT >= 30) this.genSrcB = true;
      this.ptcuAwayT = 1e9;
    }
    this.ptcuPrev = ptcu;
    // Power-up accumulator charge: B then A, EST 15 s each, once per power-up with engines stopped.
    if (motorPwr && this.powerUpT < 0) {
      this.powerUpT = 0;
      this.genSrcB = true;
      this.ptcuAwayT = 1e9;
    }
    if (!motorPwr) this.powerUpT = -1;
    else this.powerUpT += dt;
    const enginesOff = v.get(N.running[1]) === 0 && v.get(N.running[2]) === 0;
    let aCmd = false;
    let bCmd = false;
    let xfer = false;
    let gen = false;
    let mode = 'OFF';
    // PTCU inhibited with a low reservoir on either side (EST: protects the unit / avoids pumping the good
    // system's fluid overboard through a leak).
    const qtyLow = v.get('hyd.a_lowqty') !== 0 || v.get('hyd.b_lowqty') !== 0;
    if (v.get('fail.hyd.ptcu') === 0 && !(qtyLow && ptcu !== 4)) {
      if (ptcu === 2) {
        const start1 = v.get('fadec.eng1.start_state') >= 1 && v.get('fadec.eng1.start_state') <= 3;
        const start2 = v.get('fadec.eng2.start_state') >= 1 && v.get('fadec.eng2.start_state') <= 3;
        if (enginesOff && this.powerUpT >= 0 && this.powerUpT < 15) { bCmd = true; mode = 'PRIME B'; }
        else if (enginesOff && this.powerUpT >= 15 && this.powerUpT < 30) { aCmd = true; mode = 'PRIME A'; }
        else if (start1 && aPsi < 2800) { aCmd = true; mode = 'PRIME A'; }
        else if (start2 && bPsi < 2800) { bCmd = true; mode = 'PRIME B'; }
        else { xfer = true; mode = 'XFER'; }
      } else if (ptcu === 1) {
        if (aPsi < 2800) { aCmd = true; mode = 'AUX A'; } else { xfer = true; mode = 'XFER'; }
      } else if (ptcu === 3) {
        if (bPsi < 2800) { bCmd = true; mode = 'AUX B'; } else { xfer = true; mode = 'XFER'; }
      } else if (ptcu === 4) {
        gen = true;
        mode = this.genSrcB ? 'GEN B' : 'GEN A';
      }
    }
    v.set('hyd.ptcu_a_cmd', aCmd && motorPwr ? 1 : 0);
    v.set('hyd.ptcu_b_cmd', bCmd && motorPwr ? 1 : 0);
    v.set('hyd.ptcu_xfer_cmd', xfer ? 1 : 0);
    v.set('hyd.ptcu_gen_cmd', gen ? 1 : 0);
    v.set(V.ptcuGenSrcB, this.genSrcB ? 1 : 0);
    const srcPsi = this.genSrcB ? bPsi : aPsi;
    v.set('hyd.ptcu_gen_drive', gen ? 100 * Math.min(1, Math.max(0, srcPsi / 2600)) : 0);
    v.setString(V.ptcuMode, mode);

    // ---------------- rudder standby system (OG 13-3/13-5) and automatic yaw damper (OG 15-3)
    const aLow = v.get('hyd.a_lowpress') !== 0;
    const rssOn = v.get(V.rudderStby) !== 0 && aLow && (!ground || !enginesOff) && v.get('fail.hyd.rss_pump') === 0;
    v.set(V.rssActive, rssOn ? 1 : 0);
    const rudderAvail = aPsi > 1500 || v.get('hyd.rss_psi') > 1500;
    // STANDBY YAW DAMP switchlight (pedestal forward left, Textron photograph): EST, a standby yaw-damper channel in the
    // rudder control unit on the R emergency bus that engages with the button when the normal channel has failed
    // (fail.yd.normal) or lost its power; it needs rudder hydraulics like the normal channel. fail.yd (the YawDamper
    // block's own failure) takes out yaw damping altogether.
    const ydDead = v.get('fail.yd') !== 0;
    const stbyYd = v.get(V.stbyYd) !== 0 && v.get('elec.emer_r_powered') !== 0 && !ydDead;
    const normYd = v.get('elec.rudder_ctl_powered') !== 0 && v.get('fail.yd.normal') === 0 && !ydDead;
    const yd = !ground && rudderAvail && (normYd || stbyYd);
    v.set(V.ydAuto, yd ? 1 : 0);
    v.set('ap.yd_engaged', yd ? 1 : 0);

    // ---------------- speedbrake: 35 deg in flight, 17.5 deg beyond flaps 2; auto-stow (OG 15-4)
    const lever = v.get(V.speedbrake);
    const flaps = v.get('surf.flaps_deg');
    const shaker = v.get('alert.stick_shaker') !== 0;
    if (lever < 0.02) this.sbStowed = false;
    // BCA: with the A/T MIN SPD protection active "if the speedbrakes are deployed, they will automatically stow".
    else if (!ground && (tla1 > TLA.sbStow || tla2 > TLA.sbStow || shaker || v.get(V.atProt) === 1)) this.sbStowed = true;
    v.set(V.sbAutoStow, this.sbStowed ? 1 : 0);
    const limit = flaps > 16 ? 0.5 : 1;
    v.set(V.sbCmd, this.sbStowed ? 0 : Math.min(1, lever) * limit);

    // ---------------- ground-spoiler accumulators (OG 15-4/15-5): charged from A (1,2) and B (3,4); a deployment
    // without system pressure uses ~35 % of the stored charge (EST).
    const deployed = v.get('spoilers.deployed') !== 0;
    for (let k = 0; k < 4; k++) {
      const sys = k < 2 ? aPsi : bPsi;
      let p = this.gsAcc[k];
      if (sys > p) p = Math.min(3000, p + (sys - p) * Math.min(1, dt / 2));
      if (deployed && !this.gsPrevDeployed && sys < 1500) p *= 0.65;
      if (v.get(N.gsAccFail[k]) !== 0) p = 0;
      this.gsAcc[k] = p;
      v.set(this.gsAccVars[k], p);
    }
    this.gsPrevDeployed = deployed;
    let accOk = 0;
    for (let k = 0; k < 4; k++) if (this.gsAcc[k] > 1500) accOk++;
    v.set('ac.lon.gs_accum_ok', accOk);
    // AUTO GROUND SPOILERS switchlight (pedestal forward left, Textron photograph): OFF disarms the automatic ground
    // spoilers (EST: OG 15-4 describes the fully automatic system; the button removes the arming).
    v.set(V.gsArmed, accOk >= 3 && v.get(V.autoGndSplr) !== 0 ? 1 : 0);

    // ---------------- bleed isolation / wing crossflow (OG 9-3/9-4)
    const xflow = v.get(V.bleedIsolate) !== 0;
    const wingAi = v.get(V.aiWing) !== 0;
    const st1 = v.get('fadec.eng1.starter_cmd') !== 0;
    const st2 = v.get('fadec.eng2.starter_cmd') !== 0;
    const e1 = v.get(N.running[1]) !== 0;
    const e2 = v.get(N.running[2]) !== 0;
    this.apuAvailT = v.get('apu.avail') !== 0 ? this.apuAvailT + dt : 0;
    const apuBleed = this.apuAvailT >= 90 && v.get(V.bleedApu) !== 0;
    v.set(V.apuBleedReady, this.apuAvailT >= 90 ? 1 : 0);
    // Cross-bleed for starts: right start from the APU / left engine; left start from the right engine when no APU.
    const startXbleed = (st2 && !e2 && (apuBleed || e1)) || (st1 && !e1 && !apuBleed && e2);
    v.set(V.isoOpen, (xflow && !wingAi) || startXbleed ? 1 : 0);
    v.set(V.wingXflowOpen, xflow && wingAi ? 1 : 0);
    this.xflowT = xflow ? this.xflowT + dt : 0;
    v.set('ac.lon.bleed.xflow_5min', this.xflowT >= 300 ? 1 : 0);

    // ---------------- dry motor: START held with RUN/STOP at STOP (OG 7-5)
    for (let i = 1; i <= 2; i++) {
      const run = v.get(i === 1 ? V.runL : V.runR) !== 0;
      const btnS = v.get(i === 1 ? V.startL : V.startR) !== 0;
      const running = i === 1 ? e1 : e2;
      const auto = v.get(N.autoStarter[i]) !== 0;
      v.set(N.starterCmd[i], auto || (!run && btnS && !running) ? 1 : 0);
    }

    // ---------------- fuel recirculation (OG 6-2/6-5) and inlet temperatures
    for (let i = 1; i <= 2; i++) {
      const tankKg = v.get(N.tankKg[i]);
      const boostOn = v.get(N.boostOn[i]) !== 0;
      // OG 6-2: "Recirc pumps are always on during normal operations unless the on-side fuel pump is also running or
      // the fuel level is too low" (EST threshold: the 500 lb FUEL LEVEL LOW level).
      const on = v.get(V.fuelRecirc) !== 0 && !boostOn && tankKg > FUEL_LOW_KG && v.get(N.missionPowered[i]) !== 0 && v.get(N.recircFail[i]) === 0;
      v.set(N.recircOn[i], on ? 1 : 0);
      // OG 6-2 scavenge ejectors: "primarily run when fuel quantity is low ... may also run when the fuel temperature
      // is very low" (EST: FUEL LEVEL LOW level, or tank fuel below -30 degC); motive flow needs the engine running.
      const tankC0 = v.get(N.tankTemp[i]);
      v.set(N.scavenge[i], v.get(N.running[i]) !== 0 && (tankKg < FUEL_LOW_KG || tankC0 < -30) ? 1 : 0);
      // Inlet temperature: tank fuel warmed by the engine fuel/oil heat exchanger return (EST +12 degC running).
      const tankC = v.get(N.tankTemp[i]);
      v.set(N.inletC[i], tankC + (v.get(N.running[i]) !== 0 ? 12 : 0));
    }

    // ---------------- hydraulic fluid temperature (EST: 25 degC + pump work, overheat failure -> 140 degC)
    const ambient = v.get('fdm.sat_c');
    const tgtA = v.get('fail.hyd.a.overheat') !== 0 ? 145 : Math.max(ambient, 20) + 25 * Math.min(1, aPsi / 3000);
    const tgtB = v.get('fail.hyd.b.overheat') !== 0 ? 145 : Math.max(ambient, 20) + 25 * Math.min(1, bPsi / 3000);
    this.hydTa += (tgtA - this.hydTa) * Math.min(1, dt / 120);
    this.hydTb += (tgtB - this.hydTb) * Math.min(1, dt / 120);
    v.set(N.hydTempA, this.hydTa);
    v.set(N.hydTempB, this.hydTb);

    // ---------------- flap fault / FLAP RESET (pedestal aft right, Textron photograph "FLAP RESET" under the flap
    // lever). EST (AFM text not public; Citation-family flap control unit practice): a flap disagree (the drive stops
    // short of the command for 3 s: drive failure, power loss) or asymmetry latches a fault that holds the flap drive
    // off (createSystems.ts Flaps power); FLAP RESET clears the latch, and the fault latches again if the cause remains.
    const flapReset = v.get(V.flapReset) !== 0;
    if (flapReset && !this.prevFlapReset) this.flapFault = false;
    else if (v.get('flaps.asym') !== 0 || v.get('flaps.disagree') !== 0) this.flapFault = true;
    this.prevFlapReset = flapReset;
    v.set(V.flapFault, this.flapFault ? 1 : 0);

    // ---------------- NO TAKEOFF (OG 3-5, 14-3, 15-2/15-3): pre-flight conditions not met
    const flapsTo = flaps > 5 && flaps < 17; // flaps 1 or 2
    const trimOk = v.get('trim.pitch_to_ok') !== 0 && v.get('trim.roll_to_ok') !== 0 && v.get('trim.yaw_to_ok') !== 0;
    const sbOk = v.get('surf.spoiler_left') < 0.05 && v.get('surf.spoiler_right') < 0.05;
    const park = v.get('brakes.parking_set') !== 0;
    // CONTROL LOCK engaged and a latched flap fault are no-takeoff conditions too (EST).
    const bad = !flapsTo || !trimOk || !sbOk || park || v.get(V.bleedIsolate) !== 0 || locked || v.get(V.flapFault) !== 0;
    v.set(V.noTakeoff, ground && bad ? 1 : 0);
  }

  reset(): void {
    const v = this.v;
    this.sbStowed = false;
    this.prevG5000 = v.get('elec.pfd1_powered') !== 0 || v.get('elec.mfd_powered') !== 0 || v.get('elec.pfd2_powered') !== 0;
    this.tieOverride = false;
    this.prevAutoTie = false;
    this.ptcuAwayT = 1e9;
    this.genSrcB = true;
    this.waiT = v.get(V.aiWing) !== 0 ? 10 : 0;
    this.wasAir = v.get('gear.air_ground') === 0;
    this.depElevFt = 0;
    this.aprAutoLatch = false;
    this.flapFault = false;
    this.prevFlapReset = v.get(V.flapReset) !== 0;
    this.tieManual = false;
    this.prevTieBtn = v.get(V.busTieBtn);
    this.prevBattCount = (v.get(V.battL) ? 1 : 0) + (v.get(V.battR) ? 1 : 0);
    this.singleBattLatch = false;
    this.ptcuPrev = v.get(V.ptcu);
    this.powerUpT = v.get('elec.mission_l_v') > 18 ? 60 : -1;
    this.apuAvailT = v.get('apu.avail') !== 0 ? 120 : 0;
    const a = v.get('hyd.a_psi');
    const b = v.get('hyd.b_psi');
    const init = Math.max(2800, a, b);
    for (let k = 0; k < 4; k++) this.gsAcc[k] = init;
    this.hydTa = 20 + 25 * Math.min(1, a / 3000);
    this.hydTb = 20 + 25 * Math.min(1, b / 3000);
  }
}

/** After the engines/pneumatics: start PSI readout, dry-motor recommendation, standby-battery LEDs. */
export class LongitudePostLogic implements Subsystem {
  readonly name = 'lon.post_logic';
  private readonly v: SimVars;
  private readonly shutdownT = new Float64Array([1e6, 1e6]);
  private readonly motorT = new Float64Array([0, 0]);
  private readonly dryMotored = new Float64Array([0, 0]);
  private readonly wasRunning = [false, false];
  private readonly failed = [false, false];
  private readonly failVars = [V.engFail(1), V.engFail(2)];
  // ENG EXCEEDANCE latch (OG 3-5: noted for maintenance; cleared only by the state reset)
  private readonly exceedT = new Float64Array([0, 0]);
  private readonly exceeded = [false, false];
  private readonly exceedVars = [V.engExceed(1), V.engExceed(2)];
  private readonly n1Vars = [ENG.n1(1), ENG.n1(2)];
  private readonly ittVars = [ENG.itt(1), ENG.itt(2)];
  private readonly startStateVars = ['fadec.eng1.start_state', 'fadec.eng2.start_state'];
  private readonly abortVars = ['fadec.eng1.abort', 'fadec.eng2.abort'];
  private readonly startFailVars = [V.startFail(1), V.startFail(2)];
  private readonly fadecFailVars = ['fail.fadec.eng1', 'fail.fadec.eng2'];
  private readonly fadecFaultVars = [V.fadecFault(1), V.fadecFault(2)];
  constructor(vars: SimVars) {
    this.v = vars;
  }
  update(dt: number): void {
    const v = this.v;
    // Start PSI (EIS box between the ITT gauges, OG 7-7): duct pressure at the next engine to start.
    const e1 = v.get(N.running[1]) !== 0;
    const e2 = v.get(N.running[2]) !== 0;
    const lPsi = v.get('pneu.l_man_psi');
    const rPsi = v.get('pneu.r_man_psi');
    const iso = v.get('pneu.iso_open') !== 0;
    const avail = (side: number) => (side === 1 ? (iso ? Math.max(lPsi, rPsi) : lPsi) : iso ? Math.max(lPsi, rPsi) : rPsi);
    v.set(V.startPsi, !e1 ? avail(1) : !e2 ? Math.max(avail(2), v.get('pneu.apu_psi') > 0 && v.get(V.apuBleedReady) ? v.get('pneu.apu_psi') : 0) : 0);
    // Dry motor recommended 15..180 min after shutdown unless motored >= 15 s or to 19 % N2 (OG 7-6, 17-11).
    for (let i = 0; i < 2; i++) {
      const running = i === 0 ? e1 : e2;
      const runSw = v.get(i === 0 ? V.runL : V.runR) !== 0;
      if (this.wasRunning[i] && !running) {
        this.shutdownT[i] = 0;
        this.dryMotored[i] = 0;
        // FADEC engine-failure detection (OG CAS ENGINE FAIL): the engine stopped while RUN is selected.
        if (runSw) this.failed[i] = true;
      }
      if (running || !runSw) this.failed[i] = false;
      v.set(this.failVars[i], this.failed[i] ? 1 : 0);
      this.wasRunning[i] = running;
      if (!running) this.shutdownT[i] += dt;
      const motoring = v.get(N.starterCmd[i + 1]) !== 0 && v.get(i === 0 ? V.runL : V.runR) === 0;
      this.motorT[i] = motoring ? this.motorT[i] + dt : 0;
      if (this.motorT[i] >= 15 || (motoring && v.get(N.n2[i + 1]) >= 20)) this.dryMotored[i] = this.shutdownT[i] + 1e-3; // OG 7-6: 15 s or 20 % N2
      // ENG EXCEEDANCE (OG 1-3 limits, OG 3-5: logged for maintenance): > 1 s beyond a limit latches until reset.
      const ss = v.get(this.startStateVars[i]);
      const over =
        v.get(this.n1Vars[i]) > LON_LIMITS.n1TakeoffPct + 0.1 ||
        v.get(N.n2[i + 1]) > LON_LIMITS.n2TransientPct ||
        v.get(this.ittVars[i]) > LON_LIMITS.ittTakeoffC ||
        (ss >= 2 && ss <= 3 && v.get(this.ittVars[i]) > LON_LIMITS.ittStartC);
      this.exceedT[i] = over ? this.exceedT[i] + dt : 0;
      if (this.exceedT[i] >= 1) this.exceeded[i] = true;
      v.set(this.exceedVars[i], this.exceeded[i] ? 1 : 0);
      // FADEC start abort (hot / hung / no light / no rotation) and FADEC channel fault, for the CAS.
      v.set(this.startFailVars[i], v.get(this.abortVars[i]));
      v.set(this.fadecFaultVars[i], v.get(this.fadecFailVars[i]) !== 0 ? 1 : 0);
      const minutes = this.shutdownT[i] / 60;
      // After a dry motor the message clears 3 minutes later (OG 7-6).
      const clearedByMotor = this.dryMotored[i] > 0 && this.shutdownT[i] - this.dryMotored[i] >= 180;
      v.set(N.dryMotorReq[i + 1], !running && minutes >= 15 && minutes <= 180 && !clearedByMotor ? 1 : 0);
      v.set(N.lastShutdown[i + 1], this.shutdownT[i]);
    }
    // Standby power LEDs (OG 5-5): amber = ON and not charging; green = TEST held with a good battery. The standby
    // battery charges from the L MISSION bus (OG 5-3) when a primary source (generator, APU generator, external
    // power, or the right side through the bus tie) powers it; on the batteries alone it is not being charged.
    const sw = v.get(V.stbyPwr);
    const primL = v.get('elec.gen_l_online') !== 0 || v.get('elec.apu_gen_online') !== 0 || v.get('elec.gpu_online') !== 0;
    const primR = v.get('elec.gen_r_online') !== 0 || v.get('elec.ptcu_gen_online') !== 0;
    const charging = v.get('elec.mission_l_powered') !== 0 && (primL || (primR && v.get('elec.bus_tie_closed') !== 0));
    const soc = v.get('elec.stby_batt_soc');
    v.set(V.stbyBattLed, sw === 2 ? (soc > 0.5 ? 2 : 0) : sw === 1 && !charging ? 1 : 0);
    v.set(V.stbyPowered, v.get('elec.stby_powered'));
    // EIS SPOILERS indication (OG 15-5): speedbrake and ground-spoiler panel extension, not the roll spoilers.
    v.set(V.spoilerInd, Math.max(v.get('spoilers.sb_ext'), v.get(SURF.groundSpoilers)));
    // Crew audio (DGAC CABIN ALTITUDE / EMERGENCY DESCENT steps 2-3). SCOPE: no audio model; the MIC SEL and MIC/INPH
    // states gate the crew-mask microphone and the hot intercom flags (shown on the side-console MIC SEL legend).
    const mL = v.get(V.micSelL) !== 0 && v.get(V.oxyMaskL) !== 0;
    const mR = v.get(V.micSelR) !== 0 && v.get(V.oxyMaskR) !== 0;
    v.set(V.maskMicLiveL, mL ? 1 : 0);
    v.set(V.maskMicLiveR, mR ? 1 : 0);
    const micL = v.get(V.micSelL) !== 0 ? mL : v.get(V.oxyMaskL) === 0; // boom mic unusable with the mask on
    const micR = v.get(V.micSelR) !== 0 ? mR : v.get(V.oxyMaskR) === 0;
    v.set(V.intercomHotL, v.get(V.micInphL) !== 0 && micL && v.get('elec.emer_l_powered') !== 0 ? 1 : 0);
    v.set(V.intercomHotR, v.get(V.micInphR) !== 0 && micR && v.get('elec.emer_r_powered') !== 0 ? 1 : 0);
  }
  reset(): void {
    const v = this.v;
    for (let i = 0; i < 2; i++) {
      this.wasRunning[i] = v.get(N.running[i + 1]) !== 0;
      this.failed[i] = false;
      this.shutdownT[i] = 1e6;
      this.motorT[i] = 0;
      this.dryMotored[i] = 0;
      this.exceedT[i] = 0;
      this.exceeded[i] = false;
    }
  }
}
