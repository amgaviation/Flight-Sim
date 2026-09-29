/**
 * Bombardier Global 6000 automatic logic that the generic system blocks do
 * not cover (ACPC / DCPC bus logic, FMQGC fuel management, IAMS bleed and
 * anti-ice, FCU spoiler / ground-lift-dumping logic, LGECU / BCU details,
 * SPC configuration), from the Global Express training manuals (data.ts
 * source list). Two subsystems:
 *
 *  - `G6kLogic` (runs before the electrical network): thrust-lever state,
 *    single-generator / single-TRU shedding flags, RAT automatic deployment,
 *    battery emergency flag, hydraulic SOVs and ACMP AUTO logic, FMQGC pump
 *    and transfer commands, bleed / crossbleed / pack / anti-ice commands,
 *    flight spoiler lever schedule, ground lift dumping arm, stall protection
 *    configuration, park / emergency brake, AFCS low-bank transition, gear
 *    horn mute, BTMS, takeoff configuration.
 *  - `G6kPostLogic` (after the engines): engine failure latch, YD automatic
 *    engagement at power-up, event bridge for momentary switches that the
 *    library blocks consume as events (G/S WARN MUTED).
 *
 * No per-step allocation: all var names are precomputed strings.
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { G6K_LIMITS, LB } from '../data';
import { GLOBAL6000_FDM } from '../fdm';
import { G6K_VARS as V } from '../vars';
import { TLA } from './engines';

const S2 = ['l', 'r'] as const;
const N = {
  tla: ['', V.tla(1), V.tla(2)],
  tlaEff: ['', V.tlaEff(1), V.tlaEff(2)],
  rev: ['', V.revLever(1), V.revLever(2)],
  revEff: ['', `${V.revLever(1)}_eff`, `${V.revLever(2)}_eff`],
  running: ['', 'eng1.running', 'eng2.running'],
  n2: ['', 'eng1.n2_pct', 'eng2.n2_pct'],
  fuelCmd: ['', 'fadec.eng1.fuel_cmd', 'fadec.eng2.fuel_cmd'],
  starter: ['', 'fadec.eng1.starter_cmd', 'fadec.eng2.starter_cmd'],
  run: ['', V.engRun(1), V.engRun(2)],
  engFail: ['', V.engFail(1), V.engFail(2)],
  fireHandle: { l: V.fireHandle('l'), r: V.fireHandle('r') },
  priSw: { l: V.priPumps('l'), r: V.priPumps('r') },
  auxSw: { l: V.auxPump('l'), r: V.auxPump('r') },
  priCmd1: { l: V.priCmd('l1'), r: V.priCmd('r1') },
  priCmd2: { l: V.priCmd('l2'), r: V.priCmd('r2') },
  priLow1: { l: 'fuel.pri_l1_lowpress', r: 'fuel.pri_r1_lowpress' },
  priLow2: { l: 'fuel.pri_l2_lowpress', r: 'fuel.pri_r2_lowpress' },
  auxCmd: { l: V.auxCmd('l'), r: V.auxCmd('r') },
  ctrCmd: { l: V.ctrXferCmd('l'), r: V.ctrXferCmd('r') },
  aftCmd: { l: V.aftXferCmd('l'), r: V.aftXferCmd('r') },
  wingKg: { l: 'fuel.tank0_kg', r: 'fuel.tank2_kg' },
  bleedSw: { l: V.engBleed('l'), r: V.engBleed('r') },
  bleedCmd: { l: V.engBleedCmd('l'), r: V.engBleedCmd('r') },
  packSw: { l: V.pack('l'), r: V.pack('r') },
  packCmd: { l: V.packCmd('l'), r: V.packCmd('r') },
  cowlSw: { l: V.cowlAi('l'), r: V.cowlAi('r') },
  caiCmd: { l: V.caiCmd('l'), r: V.caiCmd('r') },
  waiCmd: { l: V.waiCmd('l'), r: V.waiCmd('r') },
  prvOpen: { l: V.prvOpen('l'), r: V.prvOpen('r') },
  sov: ['', V.sovOpen(1), V.sovOpen(2)],
  sovSw: ['', V.hydSovL, V.hydSovR],
  hydPsi: ['', 'hyd.sys1_psi', 'hyd.sys2_psi', 'hyd.sys3_psi'],
  hydTemp: ['', 'hyd.sys1_temp_c', 'hyd.sys2_temp_c', 'hyd.sys3_temp_c'],
};

/** Per-side fuel recirculation active (FCOC return to that wing tank), read by the fuel temperature bias (fuel.ts). */
export const RECIRC_L = `${V.recircOn}_l`;
export const RECIRC_R = `${V.recircOn}_r`;

/** FLIGHT SPOILER lever FULL position (0 .. FULL = inboard MFS proportional; MAX = 1.0 above the FULL -> MAX gate). */
export const FSL_FULL = 0.9;

/** Fire handle zones: handle, rotation, solenoid unlock and bottle discharge vars (precomputed). */
const FIRE_Z = (['l', 'apu', 'r'] as const).map((z) => ({
  z,
  warn: z === 'l' ? 'fire.eng1_warn' : z === 'r' ? 'fire.eng2_warn' : 'fire.apu_warn',
  handle: V.fireHandle(z),
  rot: V.fireRot(z),
  ovrd: V.fireOvrd(z),
  unlock: V.fireUnlock(z),
  d1: V.fireDisch(z, 1),
  d2: V.fireDisch(z, 2),
}));
/** Engine fuel SOV position (1 open) per engine, written by G6kLogic, read by the fuel consumers (fuel.ts) and the CAS. */
export const FUEL_SOV_OPEN = ['', 'ac.g6k.fuel.eng_sov1_open', 'ac.g6k.fuel.eng_sov2_open'];
/** Latched SFCU slat / flap faults (SLAT FAIL / FLAP FAIL; reset from the EMS CDU SLAT/FLAP RESET). */
export const SLAT_FAULT = 'ac.g6k.sfcu.slat_fault';
export const FLAP_FAULT = 'ac.g6k.sfcu.flap_fault';
/** SET LDG ELEV advisory condition. */
export const SET_LDG_ELEV = 'ac.g6k.press.set_ldg_elev';

/** Gear horn secondary-mode take-off inhibit (2 min after lift-off, GX_14_015). */
export const HORN_TO_INHIBIT = 'ac.g6k.gear.horn_to_inhibit';

/** Wing tank capacity (kg, usable) for the FMQGC percentage logic. */
const WING_CAP_KG = G6K_LIMITS.mainTankLb * LB;
const WING_UNUSABLE_KG = GLOBAL6000_FDM.mass.tanks[0].unusable_kg;

/** ACMP ids and their switch / primary pump. */
const ACMPS = [
  { p: '1b' as const, sys: 1, primaryLow: 'hyd.pump1a_lowpress', cmd: V.acmpCmd('1b'), sw: V.hydPump('1b') },
  { p: '2b' as const, sys: 2, primaryLow: 'hyd.pump2a_lowpress', cmd: V.acmpCmd('2b'), sw: V.hydPump('2b') },
  { p: '3b' as const, sys: 3, primaryLow: 'hyd.pump3a_lowpress', cmd: V.acmpCmd('3b'), sw: V.hydPump('3b') },
];
/** ACMP indices (ACMPS 0..2 = 1B / 2B / 3B, 3 = 3A) in the APU-single-source priority order 3A, 3B, 2B, 1B (GX PTG 12-25). */
const ACMP_PRIORITY = [3, 2, 1, 0] as const;

export class G6kLogic implements Subsystem {
  readonly name = 'g6k.logic';
  private readonly v: SimVars;
  // RAT
  private ratTimer = 0;
  private ratLatched = false;
  // ACMP minimum run (GXHY: 5 min after a low-pressure start)
  private readonly acmpHoldT = [0, 0, 0];
  private readonly acmpWant = [false, false, false, false];
  // fuel
  private readonly ctrOn = { l: false, r: false };
  private aftOn = false;
  private wingDir = 0; // 0 none, 1 L->R, -1 R->L
  private recirc = false;
  private readonly auxBackup = { l: false, r: false };
  // GLD
  private gldArmLatch = false;
  private gldToLatch = false;
  private gndT = 0;
  private slowT = 0;
  // AFCS bank
  private lowBank = false;
  // BTMS
  private btmsLatch = false;
  // take-off thrust phase
  private toPhase = false;
  // hydraulic temperatures (EST first-order warm-up)
  private readonly hydT = [0, 20, 20, 20];
  // fix round 2 (function lens)
  private prevBattSel = NaN;
  private prevBattMaster = NaN;
  private readonly fireRotT = { l: 0, apu: 0, r: 0 };
  private apuPinUsed = false;
  private apuFireT = 0;
  private hydPwrT = 0;
  private splrTestT = 0;
  private skipSelfTest = false;
  private rollDiscT = 0;
  private rollPri = 0;
  private readonly prevRollSw = [0, 0, 0];
  private prevAutobrake = 0;
  private abArmedSeen = false;
  private ditchDumped = false;
  private rateLimT = 0;
  private slatFaultT = 0;
  private flapFaultT = 0;
  private depFieldFt = 0;
  private slatLatch = false;
  private flapLatch = false;
  private prevSfReset = false;
  private readonly fuelSov = [true, true, true];
  private liftoffT = 0;
  private discT = 0;
  private hornMuteLatched = false;
  private readonly sovFailT = [0, 0, 0];

  constructor(vars: SimVars) {
    this.v = vars;
  }

  update(dt: number): void {
    const v = this.v;
    const ground = v.get('gear.air_ground') !== 0;
    const tla1 = v.get(N.tla[1]);
    const tla2 = v.get(N.tla[2]);
    const flapLever = v.get(V.flapLever);

    // ---------------- BATT MASTER OFF / EMS / ON (GX PTG 6-8 "BATT MASTER Switch: OFF isolates the battery bus from
    // the batteries; EMS: Electrical Management System is in maintenance mode, batteries supply power to EMS only;
    // ON: battery bus is powered by battery"). The 3-position switch (V.battMasterSel 0 / 1 / 2) and V.battMaster
    // (1 = ON, the var every system reads) are kept in step both ways: a change of the switch sets V.battMaster, a
    // direct write of V.battMaster (states, scripted tests) moves the switch.
    {
      const sel = v.get(V.battMasterSel);
      const bm = v.get(V.battMaster);
      if (sel !== this.prevBattSel) v.set(V.battMaster, sel === 2 ? 1 : 0);
      else if (bm !== this.prevBattMaster) v.set(V.battMasterSel, bm === 1 ? 2 : sel === 1 ? 1 : 0);
      this.prevBattSel = v.get(V.battMasterSel);
      this.prevBattMaster = v.get(V.battMaster);
    }
    // ---------------- GND LIFT DUMPING switch (GX PTG 10-50, GX_10_049): MANUAL ARM / AUTO / OFF, one 3-position
    // switch; the legacy MAN ARM / OFF vars follow it (append-only aliases read by the CAS and checklists).
    {
      const g = v.get(V.gldSw);
      v.set(V.gldManArm, g === 1 ? 1 : 0);
      v.set(V.gldOff, g === 2 ? 1 : 0);
    }

    // ---------------- thrust levers / reversers
    v.set(V.toThrust, tla1 >= TLA.toMin || tla2 >= TLA.toMin ? 1 : 0);
    v.set(V.idleBoth, tla1 <= TLA.idle && tla2 <= TLA.idle ? 1 : 0);
    v.set(V.idleAny, tla1 <= TLA.idle || tla2 <= TLA.idle ? 1 : 0);
    for (let i = 1; i <= 2; i++) {
      const rev = v.get(N.rev[i]);
      // Piggy-back reverse levers can only be lifted with the thrust lever at idle (mechanical interlock).
      const t = i === 1 ? tla1 : tla2;
      v.set(N.revEff[i], t <= TLA.idle + 0.02 ? Math.max(0, Math.min(1, rev)) : 0);
      v.set(N.tlaEff[i], rev > 0.02 ? 0 : Math.max(0, Math.min(1, t)));
    }

    // ---------------- electrical (GXEL)
    const gens =
      (v.get('elec.gen1_online') !== 0 ? 1 : 0) +
      (v.get('elec.gen2_online') !== 0 ? 1 : 0) +
      (v.get('elec.gen3_online') !== 0 ? 1 : 0) +
      (v.get('elec.gen4_online') !== 0 ? 1 : 0) +
      (v.get('elec.apu_gen_online') !== 0 ? 1 : 0);
    // GXEL / GXHY: AC BUS 2 and 3 are shed during single VFG operation (the APU generator on the ground powers all buses).
    const vfgOnline = gens - (v.get('elec.apu_gen_online') !== 0 ? 1 : 0);
    v.set(V.singleGen, vfgOnline === 1 && v.get('elec.apu_gen_online') === 0 && v.get('elec.ext_ac_online') === 0 ? 1 : 0);
    const trus =
      (v.get('elec.tru1_online') !== 0 ? 1 : 0) +
      (v.get('elec.tru2_online') !== 0 ? 1 : 0) +
      (v.get('elec.ess_tru1_online') !== 0 ? 1 : 0) +
      (v.get('elec.ess_tru2_online') !== 0 ? 1 : 0);
    v.set(V.singleTru, trus === 1 ? 1 : 0);
    v.set(V.dcpcFail, v.get('fail.elec.dcpc') !== 0 ? 1 : 0);
    // RAT (GXEL): in flight, loss of all AC with the engines running -> deploy after 14 s with the slat/flap lever at
    // 0 IN, at once otherwise; dual engine failure -> at once; manual deploy handle. Stowed only on the ground.
    const allAcLost =
      v.get('elec.ac_bus1_powered') === 0 && v.get('elec.ac_bus2_powered') === 0 && v.get('elec.ac_bus3_powered') === 0 && v.get('elec.ac_bus4_powered') === 0 && v.get('elec.ac_ess_powered') === 0;
    const bothEngOut = v.get(N.running[1]) === 0 && v.get(N.running[2]) === 0;
    const ias = v.get('adc1.ias_kt');
    const airborneFast = !ground && ias > 100;
    if (airborneFast && (allAcLost || bothEngOut)) this.ratTimer += dt;
    else this.ratTimer = 0;
    const delay = bothEngOut || flapLever > 0.5 ? 0 : G6K_LIMITS.ratDeployDelayS;
    if (this.ratTimer > delay + 0.01 && airborneFast) this.ratLatched = true;
    if (v.get(V.ratDeploy) !== 0) this.ratLatched = true;
    if (ground && v.get(V.ratDeploy) === 0 && v.get('fdm.gs_kt') < 30) this.ratLatched = false; // stowed by maintenance (EST)
    v.set(V.ratDeployed, this.ratLatched ? 1 : 0);
    v.set(V.ratLatchT, this.ratTimer);
    // RAT turbine: physical coupling to the airspeed (not an avionics reading).
    v.set(V.ratDrive, this.ratLatched ? v.get('fdm.cas_kt') : 0);
    // Batteries feeding the essential buses (BATT EMER PWR ON): no TRU on DC ESS and BATT BUS, BATT MASTER ON.
    v.set(V.battEmer, v.get('elec.dcess_src') === 0 && v.get('elec.battbus_src') === 0 && v.get(V.dcEmerOvrd) !== 1 && v.get(V.battMaster) === 1 ? 1 : 0);

    // ---------------- hydraulics (GXHY)
    for (let i = 1; i <= 2; i++) {
      const handle = v.get(i === 1 ? N.fireHandle.l : N.fireHandle.r) !== 0;
      v.set(N.sov[i], v.get(N.sovSw[i]) === 1 || handle ? 0 : 1);
    }
    const anyEng = v.get(N.running[1]) !== 0 || v.get(N.running[2]) !== 0;
    const vfgs = vfgOnline;
    // "All B pumps commanded on (AUTO) when flaps/slats selected out of 0 and slat motion has stopped, and a minimum of two
    // VFGs are operating."
    const configAuto = flapLever > 0.5 && v.get('slats.transit') === 0 && vfgs >= 2;
    const apuOnly = v.get('elec.apu_gen_online') !== 0 && vfgs === 0 && v.get('elec.ext_ac_online') === 0;
    const want = this.acmpWant;
    for (let k = 0; k < ACMPS.length; k++) {
      const a = ACMPS[k];
      const sw = v.get(a.sw);
      let on = false;
      if (sw === 2) on = true;
      else if (sw === 1 && anyEng) {
        // In support of a failed primary pump in flight (not on the ground), held >= 5 min.
        const primaryLow = v.get(a.primaryLow) !== 0 || (a.sys === 3 && v.get(V.hydPump('3a')) !== 2);
        if (!ground && primaryLow) this.acmpHoldT[k] = G6K_LIMITS.acmpMinOnS;
        else this.acmpHoldT[k] = Math.max(0, this.acmpHoldT[k] - dt);
        on = configAuto || this.acmpHoldT[k] > 0;
      } else this.acmpHoldT[k] = 0;
      want[k] = on;
    }
    want[3] = v.get(V.hydPump('3a')) === 2;
    // APU generator as the single source (GX PTG 12-23 / 12-25): on the ground only one ACMP runs at a time, priority
    // 3A, 3B, 2B, 1B ("If a lower priority ACMP is running and a higher priority ACMP is activated, the lowest
    // priority ACMP will shut off and the higher priority ACMP will turn on"); in flight only 3A / 3B.
    if (apuOnly) {
      if (ground) {
        let slot = false;
        for (let j = 0; j < ACMP_PRIORITY.length; j++) {
          const k = ACMP_PRIORITY[j];
          if (want[k] && !slot) slot = true;
          else want[k] = false;
        }
      } else {
        want[0] = false;
        want[1] = false;
      }
    }
    for (let k = 0; k < ACMPS.length; k++) v.set(ACMPS[k].cmd, want[k] ? 1 : 0);
    v.set(V.acmpCmd('3a'), want[3] ? 1 : 0);
    v.set(V.pumpRatCmd, this.ratLatched ? 1 : 0);
    // Fluid temperature (EST: warms toward 45 C + 20 C with pumps delivering, cools to ambient, tau 20 min).
    for (let i = 1; i <= 3; i++) {
      const pressurised = v.get(N.hydPsi[i]) > 1000;
      const target = pressurised ? 50 : Math.min(30, v.get('fdm.sat_c', 15));
      this.hydT[i] += ((target - this.hydT[i]) * dt) / 1200;
      v.set(N.hydTemp[i], this.hydT[i]);
    }

    // ---------------- fuel (FMQGC, GXFU)
    const flapsOut = flapLever > 0.5;
    const gearDownAir = !ground && v.get('gear.down_locked') !== 0;
    const lowWing = v.get(N.wingKg.l) < G6K_LIMITS.lowFuelLb * LB + WING_UNUSABLE_KG || v.get(N.wingKg.r) < G6K_LIMITS.lowFuelLb * LB + WING_UNUSABLE_KG;
    const apuRunning = v.get('apu.state') >= 1 && v.get('apu.state') <= 4;
    const acPowered = v.get('elec.ac_bus1_powered') !== 0 || v.get('elec.ac_bus4_powered') !== 0;
    for (const s of S2) {
      const i = s === 'l' ? 1 : 2;
      const priEnabled = v.get(N.priSw[s]) === 1;
      // Primary pumps: on whenever the engine runs / is being started (fuel command); the right pumps also feed the
      // APU once it is on speed (GXFU).
      const engFeed = v.get(N.fuelCmd[i]) !== 0 || v.get(N.running[i]) !== 0;
      const pri = priEnabled && (engFeed || (s === 'r' && apuRunning && v.get('apu.avail') !== 0 && acPowered));
      v.set(N.priCmd1[s], pri ? 1 : 0);
      v.set(N.priCmd2[s], pri ? 1 : 0);
      // AUX pump: AC pump failure, take-off / landing (flaps > 0, gear down in flight, low wing fuel), APU start without
      // AC pumps (right, or left with the crossfeed), wing transfer (logic below).
      const priLow = pri && (v.get(N.priLow1[s]) !== 0 || v.get(N.priLow2[s]) !== 0);
      const priOff = !pri && engFeed;
      const apuStartFeed = apuRunning && !(v.get('fuel.pri_r1_on') !== 0 || v.get('fuel.pri_r2_on') !== 0) && (s === 'r' || v.get(V.xfeed) === 1);
      const xferNeed = (s === 'l' && this.wingDir === 1) || (s === 'r' && this.wingDir === -1);
      const aux = v.get(N.auxSw[s]) === 1 && (priLow || priOff || ((flapsOut || gearDownAir || lowWing) && engFeed) || apuStartFeed || xferNeed);
      v.set(N.auxCmd[s], aux ? 1 : 0);
      // GX PTG 11: engine feed has priority over wing transfer: while the AUX pump backs up failed / inhibited PRI
      // pumps, that side does not transfer (the wing transfer command below is dropped).
      this.auxBackup[s] = priLow || priOff;
      // Centre transfer: start below ~93 % of the wing capacity, stop above 97 % (per side).
      const pct = ((v.get(N.wingKg[s]) - WING_UNUSABLE_KG) / WING_CAP_KG) * 100;
      if (pct < G6K_LIMITS.ctrXferStartPct) this.ctrOn[s] = true;
      if (pct > G6K_LIMITS.ctrXferStopPct) this.ctrOn[s] = false;
      const ctrHasFuel = v.get('fuel.ctr_usable_kg') > 1;
      v.set(N.ctrCmd[s], this.ctrOn[s] && ctrHasFuel && anyEng ? 1 : 0);
    }
    // Aft transfer (AUTO: either wing <= 5,500 lb, continues until the aft tank is empty; ON: manual; OFF inhibits).
    const aftSw = v.get(V.aftXfer);
    const wingLowForAft = v.get(N.wingKg.l) - WING_UNUSABLE_KG <= G6K_LIMITS.aftXferWingLb * LB || v.get(N.wingKg.r) - WING_UNUSABLE_KG <= G6K_LIMITS.aftXferWingLb * LB;
    if (aftSw === 1 && wingLowForAft && anyEng) this.aftOn = true;
    const aftHasFuel = v.get('fuel.aft_usable_kg') > 1;
    if (!aftHasFuel || aftSw === 0) this.aftOn = false;
    const aft = aftHasFuel && (aftSw === 2 || (aftSw === 1 && this.aftOn));
    v.set(N.aftCmd.l, aft ? 1 : 0);
    v.set(N.aftCmd.r, aft ? 1 : 0);
    // Wing transfer: AUTO corrects a 400 lb imbalance with the slat/flap lever at 0 IN (until balanced); L->R / R->L manual.
    const wingSw = v.get(V.wingXfer);
    const imb = v.get(N.wingKg.l) - v.get(N.wingKg.r);
    if (wingSw === 1 && !flapsOut && anyEng) {
      if (this.wingDir === 0 && Math.abs(imb) > G6K_LIMITS.wingXferAutoLb * LB) this.wingDir = imb > 0 ? 1 : -1;
      if ((this.wingDir === 1 && imb <= 0) || (this.wingDir === -1 && imb >= 0)) this.wingDir = 0;
    } else if (wingSw === 2) this.wingDir = 1;
    else if (wingSw === 3) this.wingDir = -1;
    else this.wingDir = 0;
    v.set(V.wingXferCmd('lr'), this.wingDir === 1 && !this.auxBackup.l ? 1 : 0);
    v.set(V.wingXferCmd('rl'), this.wingDir === -1 && !this.auxBackup.r ? 1 : 0);
    // Recirculation (-9 FMQGC automatic): > 34,000 ft and bulk < -20 C; off at +5 C, < 33,800 ft or an engine off.
    // GX PTG 11-10 / 11-28: L / R RECIRC are per-side inhibit switches (FUEL RECIRC OFF status per side); each side's
    // FCOC return warms its own wing tank (fuel.ts temperature bias).
    const alt = v.get('adc1.press_alt_ft');
    const bulk = Math.min(v.get('fuel.l_main_temp_c', 15), v.get('fuel.r_main_temp_c', 15));
    if (alt > 34000 && bulk < -20) this.recirc = true;
    if (bulk >= 5 || alt < 33800 || v.get(N.running[1]) === 0 || v.get(N.running[2]) === 0) this.recirc = false;
    const rl = this.recirc && v.get(V.recirc('l')) === 1;
    const rr = this.recirc && v.get(V.recirc('r')) === 1;
    v.set(RECIRC_L, rl ? 1 : 0);
    v.set(RECIRC_R, rr ? 1 : 0);
    v.set(V.recircOn, rl || rr ? 1 : 0);

    // ---------------- bleed / packs / crossbleed (IAMS; GX PTG 13-5 / 13-12, GX PTG 4-13)
    // L / R ENG BLEED: OFF closes the PRV / HPV; AUTO leaves the PRV to the BMC; ON forces it open ("MAN has priority
    // over AUTO"). XBLEED: CLSD / AUTO (BMC) / OPEN ("selects crossbleed valve open and the affected side PRV is
    // commanded to close"). APU BLEED: OFF / AUTO / ON; "Engine bleed has priority over APU bleed ... If both PRVs are
    // open (engines running) the BMC will automatically close the LCV and the CBV (APU BLEED and XBLEED in AUTO)". The
    // LCV "will not open when manually selected ON if anti-ice is active, the left engine PRV is manually opened, or the
    // right engine PRV and the crossbleed valve are manually opened" (GX PTG 4-13).
    const starting = v.get(N.starter[1]) !== 0 || v.get(N.starter[2]) !== 0;
    const bmc = v.get('elec.bmc1_powered') !== 0 || v.get('elec.bmc2_powered') !== 0;
    const swL = v.get(N.bleedSw.l);
    const swR = v.get(N.bleedSw.r);
    const run1 = v.get(N.running[1]) !== 0;
    const run2 = v.get(N.running[2]) !== 0;
    const xbSw = v.get(V.xbleed);
    const apuSw = v.get(V.apuBleed);
    const apuAvail = v.get('apu.avail') !== 0 && v.get(V.fireHandle('apu')) === 0;
    const aiActive = v.get(N.waiCmd.l) !== 0 || v.get(N.waiCmd.r) !== 0 || v.get(N.caiCmd.l) !== 0 || v.get(N.caiCmd.r) !== 0;
    // APU BLEED ON (manual) interlocks.
    const lcvRefused = apuSw === 2 && (aiActive || swL === 2 || (swR === 2 && xbSw === 2));
    // AUTO PRVs: open with the engine running; a starting engine's own PRV stays closed (its starter is fed through the
    // duct from the APU / cross bleed, EST).
    let prvL = bmc && swL !== 0 && (swL === 2 || (run1 && v.get(N.starter[1]) === 0));
    let prvR = bmc && swR !== 0 && (swR === 2 || (run2 && v.get(N.starter[2]) === 0));
    // XBLEED OPEN selected with both engines supplying: the BMC closes one PRV (EST: the right one, the left one when the
    // right is manually ON); both manually ON with XBLEED OPEN is a bleed misconfiguration (both stay open).
    let misconfig = false;
    if (bmc && xbSw === 2 && prvL && prvR) {
      if (swL === 2 && swR === 2) misconfig = true;
      else if (swR === 2) prvL = false;
      else prvR = false;
    }
    // APU BLEED ON accepted: the BMC reconfigures the left PRV (AUTO) closed so the LCV feeds the left duct.
    const apuManual = apuSw === 2 && !lcvRefused;
    if (bmc && apuManual && apuAvail && swL === 1) prvL = false;
    if (apuSw === 2 && lcvRefused) misconfig = true;
    const fireL = v.get(N.fireHandle.l) !== 0;
    const fireR = v.get(N.fireHandle.r) !== 0;
    if (fireL) prvL = false;
    if (fireR) prvR = false;
    v.set(N.bleedCmd.l, prvL ? 1 : 0);
    v.set(N.bleedCmd.r, prvR ? 1 : 0);
    v.set(N.prvOpen.l, prvL ? 1 : 0);
    v.set(N.prvOpen.r, prvR ? 1 : 0);
    v.set(V.bleedMisconfig, misconfig ? 1 : 0);
    const engBleeds = (prvL && run1 ? 1 : 0) + (prvR && run2 ? 1 : 0);
    // AUTO: APU bleed while it is available and the engines do not supply both ducts (or a start is in progress), below
    // the 30,000 ft APU bleed limit (GXAPU).
    const apuBleed = bmc && apuAvail && alt < G6K_LIMITS.apuBleedCeilingFt && (apuManual || (apuSw === 1 && (engBleeds < 2 || starting)));
    v.set(V.apuBleedCmd, apuBleed ? 1 : 0);
    v.set(V.xbleedCmd, bmc && (xbSw === 2 || (xbSw === 1 && (starting || engBleeds === 1 || (apuBleed && engBleeds < 2)))) ? 1 : 0);
    // Packs (GX PTG 13-36: RAM AIR does NOT shut the packs; ram air only enters with both packs off below 15,000 ft).
    // DITCHING (GX PTG 13-59) shuts both packs below 15,000 ft (the AUTO sequence is inhibited above).
    const ditchOn = v.get(V.ditching) === 1;
    const ditchActive = ditchOn && alt < 15000;
    for (const s of S2) {
      // EST: packs pause while an engine start draws the duct (air to the starter first).
      v.set(N.packCmd[s], bmc && v.get(N.packSw[s]) === 1 && !ditchActive && !starting ? 1 : 0);
    }
    const packsOff = v.get(N.packCmd.l) === 0 && v.get(N.packCmd.r) === 0;
    v.set(V.ramValveOpen, v.get(V.ramAir) === 1 && packsOff && alt < 15000 && !ground ? 1 : 0);

    // ---------------- PRESSURIZATION LDG ELEV UP / DN toggle (FCOM 01-10-41): slewing selects MAN landing elevation.
    // EST rate 500 ft/s (the FCOM gives no rate), range -1,000 .. 14,000 ft (dossier section 12.1).
    const slew = v.get(V.ldgElevSlew);
    if (slew !== 0) {
      if (v.get(V.ldgElevFms) !== 0) v.set(V.ldgElevFms, 0);
      const e = v.get(V.ldgElevFt) + Math.sign(slew) * 500 * dt;
      v.set(V.ldgElevFt, Math.max(-1000, Math.min(14000, e)));
    }

    // ---------------- cabin pressure control safeties (GX PTG 13-58 .. 13-62; FCOM CSP 700-6 02-10-49 with SB 700-21-034)
    // Cabin altitude limiters: override AUTO and MAN and close the OFVs at 14,500 +/- 500 ft (EST 14,500 with a 5 s
    // rate anticipation, as the EMER DEPRESS dump limiter in environment.ts); the 3,000 fpm cabin rate limiter closes
    // the OFVs except in EMER DEPRESS and DITCHING. Output V.pressLimiter (environment.ts forces the OFVs closed).
    {
      const cab = v.get('press.cabin_alt_ft');
      const rate = v.get('press.cabin_rate_fpm');
      const dumpOrDitch = v.get(V.emerDepress) === 1 || v.get(V.ditching) === 1;
      const altLim = cab + Math.max(0, rate) * (5 / 60) >= G6K_LIMITS.cabinLimiterFt;
      // EST: the rate limiter acts in MAN only (0.2 s confirmation). In AUTO the controller's own schedule (500 fpm up /
      // 300 or 800 fpm down) already governs, and a transient after a state load or reposition must not shut the OFVs.
      const rateHigh = !dumpOrDitch && v.get(V.pressAutoMan) === 2 && rate > G6K_LIMITS.cabinRateLimiterFpm;
      this.rateLimT = rateHigh ? this.rateLimT + dt : 0;
      const rateLim = this.rateLimT >= 0.2;
      v.set(V.pressLimiter, !ground && (altLim || rateLim) ? 1 : 0);
      // DITCHING (GX PTG 13-59): "PACKS flow shutoff, cabin is depressurized, OFVs are driven to the closed position.
      // The AUTO ditching sequence is inhibited above 15,000 feet." Stage 1 dumps until < 0.1 psid, stage 2 closes.
      let seq = 0;
      if (v.get(V.ditching) === 1) {
        if (alt >= 15000) seq = -1;
        else {
          if (Math.abs(v.get('press.diff_psi')) < 0.1) this.ditchDumped = true;
          seq = this.ditchDumped ? 2 : 1;
        }
      } else this.ditchDumped = false;
      v.set(V.ditchSeq, seq);
      // CABIN ALT caution 8,200 ft / warning 9,000 ft; with a landing (or take-off) field at or above 7,230 ft the levels
      // rise in proportion to the airplane altitude below 41,000 ft to field + 1,000 / + 1,800 ft, limited to 14,500 ft
      // (CAB ALT LEVEL HI advisory).
      const onGroundOrClimb = ground || v.get('press.phase') <= 1;
      if (ground) this.depFieldFt = v.get('adc1.alt_ft');
      const field = onGroundOrClimb ? this.depFieldFt : v.get('press.ldg_elev_ft');
      let caut: number = G6K_LIMITS.cabAltCautionFt;
      let warn: number = G6K_LIMITS.cabAltWarnFt;
      if (field >= 7230 && alt < 41000) {
        const f = Math.max(0, Math.min(1, (41000 - alt) / Math.max(1, 41000 - field)));
        caut = Math.min(14500, caut + (field + 1000 - caut) * f);
        warn = Math.min(14500, warn + (field + 1800 - warn) * f);
        caut = Math.max(G6K_LIMITS.cabAltCautionFt, caut);
        warn = Math.max(G6K_LIMITS.cabAltWarnFt, warn);
      }
      v.set(V.cabAltCautionFt, caut);
      v.set(V.cabAltWarnFt, warn);
    }

    // ---------------- ice protection (IAMS, EST architecture)
    const iceDet = v.get('ice.detected') !== 0;
    const autoInhibit = ground && v.get('fdm.gs_kt') < 40; // EST: wing anti-ice AUTO inhibited while taxiing
    v.set(V.iceAutoInhibit, autoInhibit ? 1 : 0);
    const wingSwA = v.get(V.wingAi);
    const wai = wingSwA === 2 || (wingSwA === 1 && iceDet && !autoInhibit);
    // WING XBLEED rotary (FCOM 01-10-41): FROM L (1) / FROM R (2) feeds both wings from that engine; AUTO (0) opens the
    // wing crossbleed automatically when only one engine bleed is available (EST logic).
    const xbSel = v.get(V.wingXbleed);
    const oneEng = (v.get(N.running[1]) !== 0) !== (v.get(N.running[2]) !== 0);
    for (const s of S2) {
      const i = s === 'l' ? 1 : 2;
      const other = s === 'l' ? 2 : 1;
      const xb = xbSel === other || (xbSel === 0 && oneEng);
      const supplied = v.get(N.running[i]) !== 0 || (xb && v.get(N.running[other]) !== 0) || !ground;
      v.set(N.waiCmd[s], wai && supplied ? 1 : 0);
      const cs = v.get(N.cowlSw[s]);
      v.set(N.caiCmd[s], cs === 2 || (cs === 1 && iceDet) ? 1 : 0);
    }
    // HBMU: probes and AOA vanes heated with an engine running or in flight.
    v.set(V.probeHeat, anyEng || !ground ? 1 : 0);
    v.set(V.wshldOn('l'), v.get(V.wshldL) === 1 ? 1 : 0);
    v.set(V.wshldOn('r'), v.get(V.wshldR) === 1 ? 1 : 0);
    v.set(V.wshldOn('s'), v.get(V.wshldL) === 1 || v.get(V.wshldR) === 1 ? 1 : 0);

    // ---------------- flight spoilers (GX PTG 10-44): 0 .. FULL = inboard MFS pairs (0 .. 0.5 of full lift dumping),
    // deflection proportional to the lever; MAX = all four pairs with the flaps retracted, inboard pairs only with flaps
    // extended. Global 6000 lever scale 0 / 1/4 / 1/2 / 3/4 / FULL / MAX (photo EB190582 e_ped_mid): FSL_FULL = 0.9.
    // SPLRS/STAB IN TEST (GX PTG 10-41): the spoilers are inoperative for ~20 s of self test after hydraulic power-up.
    const fsl = Math.max(0, Math.min(1, v.get(V.flightSpoiler)));
    const flapsExt = v.get('surf.flaps_deg') > 0.5 || v.get('surf.slats') > 0.5;
    const hydUp = v.get('hyd.sys1_psi') > 1800 || v.get('hyd.sys2_psi') > 1800;
    if (hydUp) this.hydPwrT += dt;
    else this.hydPwrT = 0;
    if (hydUp && this.hydPwrT <= dt + 1e-9 && !this.skipSelfTest) this.splrTestT = G6K_LIMITS.splrStabTestS;
    this.skipSelfTest = false;
    this.splrTestT = Math.max(0, this.splrTestT - dt);
    v.set(V.splrStabTest, this.splrTestT > 0 ? 1 : 0);
    const sb = this.splrTestT > 0 ? 0 : fsl <= FSL_FULL ? (fsl / FSL_FULL) * 0.5 : flapsExt ? 0.5 : 0.5 + ((fsl - FSL_FULL) / (1 - FSL_FULL)) * 0.5;
    v.set(V.sbCmd, sb);

    // ---------------- take-off thrust phase (EST): the FADEC keeps the TO rating (EICAS target, A/T limit) from the
    // take-off roll until the thrust reduction altitude (1,500 ft RA, the usual thrust-reduction / acceleration
    // altitude) or until both levers come back below the take-off position; the generic automatic selection switched
    // to CLB (or GA with the gear still down) at lift-off, which let the A/T pull take-off thrust back to the climb
    // rating at 400 ft (found in the OEI take-off check, tests/aircraft/global6000/verify/abnormal.test.ts).
    {
      const bothBelow = tla1 < TLA.toMin && tla2 < TLA.toMin;
      if (ground) this.toPhase = v.get(V.toThrust) !== 0;
      else if (bothBelow || v.get('ra1.valid') === 0 || v.get('ra1.alt_ft') > 1500) this.toPhase = false; // RA invalid: above its range
      v.set(V.toPhase, this.toPhase ? 1 : 0);
    }

    // ---------------- ground lift dumping (GXFC): auto-arm with the thrust levers at the minimum take-off position,
    // latched at 45 kt; MAN ARM arms; OFF disarms; auto-disarm 40 s after touchdown with wheel speed < 45 kt for 30 s.
    const wheelKt = Math.max(v.get('gear.wheel_speed1_kt'), v.get('gear.wheel_speed2_kt'));
    const toThrust = v.get(V.toThrust) !== 0;
    if (ground && toThrust) {
      this.gldArmLatch = true;
      if (wheelKt > G6K_LIMITS.gldLatchKt) this.gldToLatch = true;
    }
    if (ground && !toThrust && !this.gldToLatch) this.gldArmLatch = false; // taxi: not latched below 45 kt
    if (!ground) {
      this.gndT = 0;
      this.slowT = 0;
      if (this.gldToLatch) this.gldArmLatch = true;
    } else {
      this.gndT += dt;
      this.slowT = wheelKt < G6K_LIMITS.gldLatchKt ? this.slowT + dt : 0;
      if (this.gndT > G6K_LIMITS.gldDisarmS && this.slowT > 30 && !toThrust) {
        this.gldArmLatch = false;
        this.gldToLatch = false;
      }
    }
    v.set(V.gldAutoArm, this.gldArmLatch ? 1 : 0);
    const gldOff = v.get(V.gldOff) === 1;
    v.set(V.gldArmed, !gldOff && (this.gldArmLatch || v.get(V.gldManArm) === 1) && v.get('fail.spoilers.auto') === 0 ? 1 : 0);

    // ---------------- stall protection configuration (flaps deg + 100 x slats) and pusher enable (GXFC)
    v.set(V.stallCfg, v.get('surf.flaps_deg') + 100 * v.get('surf.slats'));
    v.set(V.pusherEnabled, v.get(V.pusher(1)) === 1 && v.get(V.pusher(2)) === 1 && v.get('input.ap_disc') === 0 && v.get(V.discHeld) === 0 ? 1 : 0);

    // ---------------- park / emergency brake (GXLG): pulled fully = locked (parking); partial = proportional emergency.
    const pb = v.get(V.parkBrake);
    v.set(V.parkSet, pb >= 0.95 ? 1 : 0);
    v.set(V.emerBrake, pb > 0.05 && pb < 0.95 ? pb : 0);

    // ---------------- AFCS bank limit (GXAF): low bank 17 deg above 35,050 ft (bank <= 6 deg), back to 27 below 34,950.
    const bank = Math.abs(v.get('ahrs1.bank_deg'));
    if (!this.lowBank && alt > 35050 && bank <= 6) this.lowBank = true;
    if (this.lowBank && alt < 34950 && bank <= 6) this.lowBank = false;
    v.set(V.bankLow, this.lowBank ? 1 : 0);

    // ---------------- gear horn MUTED (GX PTG 14-18): the switch works only with both radio altimeters invalid; the
    // mute is cancelled (the switchlight pops out) when both throttles are advanced above idle, all gear is down and
    // locked, or flaps 30 is commanded. The secondary-mode horn rules (createSystems.ts) use V.hornMuteEff.
    {
      const raInvalid = v.get('ra1.valid') === 0 && v.get('ra2.valid') === 0;
      const restore = (tla1 > TLA.idle && tla2 > TLA.idle) || v.get('gear.down_locked') !== 0 || flapLever > 3.5;
      v.set(V.hornMuteReset, restore ? 1 : 0);
      const pressed = v.get(V.hornMute) === 1;
      if (pressed && raInvalid && !restore) this.hornMuteLatched = true;
      if (!pressed || restore || !raInvalid) this.hornMuteLatched = false;
      if (pressed && restore) v.set(V.hornMute, 0);
      v.set(V.hornMuteEff, this.hornMuteLatched ? 1 : 0);
      // Secondary-mode 2 min take-off inhibit (GX_14_015).
      if (ground) this.liftoffT = 0;
      else this.liftoffT += dt;
      v.set(HORN_TO_INHIBIT, !ground && this.liftoffT < 120 ? 1 : 0);
    }

    // ---------------- FIRE handles (GX PTG 9-12 .. 9-14): solenoid-locked, unlocked by the DAU on a fire warning or by
    // the manual override button behind the handle; pulled, the handle is turned and held >= 1 s: counter-clockwise =
    // bottle 1, clockwise = bottle 2. The APU handle needs its lockout release pin slid for the second (clockwise) shot.
    for (let k = 0; k < FIRE_Z.length; k++) {
      const f = FIRE_Z[k];
      const warn = v.get(f.warn) !== 0;
      v.set(f.unlock, warn || v.get(f.ovrd) !== 0 ? 1 : 0);
      const pulled = v.get(f.handle) !== 0;
      const rot = v.get(f.rot);
      const pin = v.get(V.fireApuPin) !== 0;
      const dirOk = rot < -0.5 || (rot > 0.5 && (f.z !== 'apu' || pin));
      const t = pulled && dirOk ? this.fireRotT[f.z] + dt : 0;
      this.fireRotT[f.z] = t;
      const fire = t >= G6K_LIMITS.fireHandleHoldS;
      v.set(f.d1, fire && rot < 0 ? 1 : 0);
      v.set(f.d2, fire && rot > 0 ? 1 : 0);
    }
    // APU FADEC immediate shutdown (no cooldown): on the ground a fire signal for >= 5 s with the handle not pulled
    // (GX PTG 9-20), the APU fire handle pulled (GX PTG 4-16 "immediate APU shut down"), or BATT MASTER OFF with no AC
    // power on (GX PTG 4-18). In flight a fire gives only the warning: the crew shuts the APU down with the handle.
    {
      const apuFire = v.get('fire.apu_warn') !== 0;
      this.apuFireT = apuFire && ground ? this.apuFireT + dt : 0;
      const acOn = gens > 0 || v.get('elec.ext_ac_online') !== 0;
      const cmd = this.apuFireT >= G6K_LIMITS.apuFireAutoShutdownS || v.get(V.fireHandle('apu')) !== 0 || (v.get(V.battMaster) === 0 && !acOn);
      v.set(V.apuFireShutdown, cmd ? 1 : 0);
    }

    // ---------------- stall protection computer (GX PTG 10-61 .. 10-63)
    // STALL WARN ADVANCE: the shaker / pusher angles are advanced (EST: the SPC angle of attack scaled by 1 / 0.9, i.e.
    // the trips at 90 % of the normal angles) for a slat or flap malfunction, icing with the wing anti-ice off or failed,
    // or the pilot's EMS CDU SWITCH CONTROL selection REV (cancelled only by the pilot).
    {
      const ice = v.get('ice.detected') !== 0 && (v.get(N.waiCmd.l) === 0 || v.get(N.waiCmd.r) === 0 || v.get('pneu.wai_l_ok') < 0.5 || v.get('pneu.wai_r_ok') < 0.5);
      const hl = v.get('fail.slats.drive') !== 0 || v.get('fail.flaps.drive') !== 0 || v.get('flaps.asym') !== 0 || v.get('flaps.disagree') !== 0;
      const adv = v.get(V.stallAdvSel) === 1 || ice || hl;
      v.set(V.stallAdvance, adv ? 1 : 0);
      v.set(V.aoaEff, v.get('adc1.aoa_deg') / (adv ? G6K_LIMITS.stallAdvanceFactor : 1));
      // "As a high angle of attack is approached: ignition is activated" (before the shakers; EST 0.75 of the stall
      // angle, the shaker being at 0.8); cancelled when the stall is corrected.
      const n = v.get('stall.aoa_norm');
      v.set(V.spcIgn, !ground && v.get('elec.spc_powered') !== 0 && (n >= G6K_LIMITS.spcIgnNorm || v.get('stall.warning') !== 0) ? 1 : 0);
      // AP/SP DISC (MASTER DISC) hold time: > 5 s STAB TRIM caution, ~12 s STALL PROTECT FAIL (GX PTG 10-57 / 10-65).
      const held = v.get(V.yokeDisc(1)) !== 0 || v.get(V.yokeDisc(2)) !== 0 || v.get('input.ap_disc') !== 0;
      this.discT = held ? this.discT + dt : 0;
      v.set(V.discHeldT, this.discT);
    }

    // ---------------- AUTOBRAKE solenoid-held selector (GX PTG 14-31): landing only; the switch holds in LO / MED / HI
    // only while armed (in flight, wheel speed zero, pedals < 20 %, no ground-spoiler deploy command, no fault) and
    // springs / rotates back to OFF otherwise, and on a disarm (pedals > 20 %, fault, spoilers stowed after deploying).
    {
      const sel = v.get(V.autobrake);
      const pedals = Math.max(v.get('input.brake_left'), v.get('input.brake_right'));
      const armOk = !ground && wheelKt < 1 && pedals < 0.2 && v.get('fail.autobrake') === 0 && v.get('surf.ground_spoilers') < 0.05;
      v.set(V.autobrakeArmOk, armOk ? 1 : 0);
      const engaged = v.get('brakes.autobrake_armed') !== 0 || v.get('brakes.autobrake_active') !== 0;
      if (sel > 0) {
        if (armOk || engaged) this.abArmedSeen = true;
        if (!armOk && !engaged && (this.abArmedSeen || ground || sel !== this.prevAutobrake)) {
          v.set(V.autobrake, 0);
          this.abArmedSeen = false;
        }
      } else this.abArmedSeen = false;
      this.prevAutobrake = v.get(V.autobrake);
    }

    // ---------------- engine fuel SOVs (GX PTG 11; DC EMER motor-driven valves): closed by the fire handle; without
    // power the valve stays where it is. L (R) ENG FUEL SOV caution = the valve not in its commanded state (cas.ts).
    for (let i = 1; i <= 2; i++) {
      const cmdOpen = v.get(i === 1 ? N.fireHandle.l : N.fireHandle.r) === 0;
      if (v.get(i === 1 ? 'elec.eng_sov1_powered' : 'elec.eng_sov2_powered') !== 0) this.fuelSov[i] = cmdOpen;
      v.set(FUEL_SOV_OPEN[i], this.fuelSov[i] ? 1 : 0);
    }
    // SET LDG ELEV (GX PTG 13-65): landing elevation not received from the FMS (no destination) with LDG ELEV at FMS.
    v.set(SET_LDG_ELEV, v.get(V.ldgElevFms) === 1 && v.getString('fms.dest') === '' && !ground ? 1 : 0);

    // ---------------- SFCU fault latch (EST): a slat / flap drive fault (FLAP FAIL / SLAT FAIL) stays latched in the SFCUs
    // until the EMS CDU SWITCH CONTROL SLAT/FLAP RESET is selected with the fault cleared (GX PTG 10-62 control page 1/2).
    {
      // Detected only by a powered SFCU channel with its slat/flap drive power (an unpowered system cannot monitor).
      const sfcuOn =
        (v.get('elec.sfcu1_powered') !== 0 && v.get('elec.slat_flap_pwr1_powered') !== 0) ||
        (v.get('elec.sfcu2_powered') !== 0 && v.get('elec.slat_flap_pwr2_powered') !== 0);
      const slatF = sfcuOn && v.get('fail.slats.drive') !== 0 && Math.abs(v.get('surf.slats') - (flapLever > 0.5 ? 1 : 0)) > 0.1;
      // The flaps wait for the slats (sequenced drive, createSystems.ts): no flap disagree while the slats run.
      const flapF =
        sfcuOn &&
        ((v.get('flaps.disagree') !== 0 && v.get('slats.transit') === 0) || v.get('flaps.asym') !== 0 || v.get('fail.flaps.drive') !== 0);
      // Latched after the fault persists 2 s (EST: the CAS confirmation delay; a momentary disagree while the drive
      // starts or powers up is not a fault).
      this.slatFaultT = slatF ? this.slatFaultT + dt : 0;
      this.flapFaultT = flapF ? this.flapFaultT + dt : 0;
      if (this.slatFaultT >= 2) this.slatLatch = true;
      if (this.flapFaultT >= 2) this.flapLatch = true;
      const rst = v.get(V.slatFlapReset) !== 0;
      if (rst && !this.prevSfReset) {
        if (!slatF) this.slatLatch = false;
        if (!flapF) this.flapLatch = false;
      }
      this.prevSfReset = rst;
      v.set(SLAT_FAULT, this.slatLatch ? 1 : 0);
      v.set(FLAP_FAULT, this.flapLatch ? 1 : 0);
    }

    // ---------------- L / R HYD SOV FAIL (GX PTG 12-28): SOV not in its commanded position (EST 3 s travel margin); the
    // SOV follows its command unless `fail.hyd.sov<n>` jams it.
    for (let i = 1; i <= 2; i++) {
      const jam = v.get(i === 1 ? 'fail.hyd.sov1' : 'fail.hyd.sov2') !== 0;
      this.sovFailT[i] = jam ? this.sovFailT[i] + dt : 0;
      v.set(i === 1 ? V.hydSovFail('l') : V.hydSovFail('r'), this.sovFailT[i] > 3 ? 1 : 0);
    }

    // ---------------- BTMS (GXLG): red at fuse-plug release range (EST 700 C), latched until OVHT WARN RESET with the
    // condition gone.
    const hot = Math.max(v.get('brakes.temp_left_c'), v.get('brakes.temp_right_c')) > 700;
    if (hot) this.btmsLatch = true;
    if (!hot && v.get(V.btmsReset) === 1) this.btmsLatch = false;
    v.set(V.btmsWarn, this.btmsLatch ? 1 : 0);

    // ---------------- takeoff configuration (GXFC / GXLG: CONFIG ... "NO TAKEOFF" during the take-off roll)
    const stab = v.get('trim.pitch_units');
    const flapsTo = flapLever >= 1.5 && flapLever <= 3.5; // flaps 6 or 16 (EST: the Global takes off with 6 or 16)
    const trimOk = stab >= G6K_LIMITS.stabGreenBand[0] && stab <= G6K_LIMITS.stabGreenBand[1];
    v.set(V.noTakeoff, ground && (!flapsTo || !trimOk || fsl > 0.05 || pb > 0.05) ? 1 : 0);
    // NO TAKEOFF advisory (GX PTG 10-67): during taxi (engines running, below the take-off thrust) while the take-off
    // configuration is not set; the red CONFIG warnings take over at take-off thrust.
    v.set(V.noTakeoffAdv, ground && anyEng && !toThrust && v.get('fdm.gs_kt') > 3 && (!flapsTo || !trimOk || fsl > 0.05) ? 1 : 0);
  }

  reset(): void {
    const v = this.v;
    this.ratLatched = v.get(V.ratDeployed) !== 0;
    this.ratTimer = 0;
    this.acmpHoldT.fill(0);
    this.ctrOn.l = false;
    this.ctrOn.r = false;
    this.aftOn = false;
    this.wingDir = 0;
    this.recirc = false;
    this.gldArmLatch = false;
    this.gldToLatch = false;
    this.gndT = 0;
    this.slowT = 0;
    this.lowBank = v.get('fdm.press_alt_ft') > 35050;
    this.btmsLatch = false;
    this.toPhase = false;
    this.prevBattSel = v.get(V.battMasterSel);
    this.prevBattMaster = v.get(V.battMaster);
    this.fireRotT.l = 0;
    this.fireRotT.apu = 0;
    this.fireRotT.r = 0;
    this.apuFireT = 0;
    const hydUp = v.get('hyd.sys1_psi') > 1800 || v.get('hyd.sys2_psi') > 1800;
    this.hydPwrT = hydUp ? 100 : 0;
    this.splrTestT = 0;
    this.skipSelfTest = hydUp;
    this.prevAutobrake = v.get(V.autobrake);
    this.abArmedSeen = v.get(V.autobrake) > 0 && v.get('gear.air_ground') === 0;
    this.ditchDumped = false;
    this.rateLimT = 0;
    this.slatFaultT = 0;
    this.flapFaultT = 0;
    this.hornMuteLatched = false;
    this.sovFailT.fill(0);
    this.slatLatch = false;
    this.flapLatch = false;
    this.liftoffT = v.get('gear.air_ground') !== 0 ? 0 : 1000;
    this.discT = 0;
    this.depFieldFt = v.get('adc1.alt_ft');
    this.fuelSov[1] = v.get(V.fireHandle('l')) === 0;
    this.fuelSov[2] = v.get(V.fireHandle('r')) === 0;
    const warm = v.get('eng1.running') !== 0 || v.get('eng2.running') !== 0;
    for (let i = 1; i <= 3; i++) this.hydT[i] = warm ? 45 : Math.min(30, v.get('fdm.sat_c', 15));
  }
}

/** After the engines / AFCS: engine-fail latch, YD auto-engage at power-up, momentary-switch event bridge. */
export class G6kPostLogic implements Subsystem {
  readonly name = 'g6k.post_logic';
  private readonly v: SimVars;
  private readonly wasRunning = [false, false, false];
  private readonly failed = [false, false, false];
  private afcsPowered = false;
  private ydT = 0;
  private prevGsMute = 0;
  private apuFuelT = 0;

  constructor(
    vars: SimVars,
    private readonly events: EventBus | null,
  ) {
    this.v = vars;
  }

  update(dt: number): void {
    const v = this.v;
    // FADEC engine failure: the engine stopped with its ENG RUN switch at RUN.
    for (let i = 1; i <= 2; i++) {
      const running = v.get(N.running[i]) !== 0;
      const run = v.get(N.run[i]) === 1;
      if (this.wasRunning[i] && !running && run) this.failed[i] = true;
      if (running || !run) this.failed[i] = false;
      this.wasRunning[i] = running;
      v.set(N.engFail[i], this.failed[i] ? 1 : 0);
    }
    // GXFC: "Initial yaw damper engagement is controlled by the flight guidance computer at IAC power up" (within 3 s).
    // EST: the engagement waits for a valid IRS attitude / rate source (the yaw damper drops out without it, so an
    // engagement at a cold-start power-up, before the IRS alignment, would be lost and YD OFF would show on the
    // take-off; found by tests/aircraft/global6000/verify/fullFlight.test.ts).
    const pwr = v.get('elec.afcs1_powered') !== 0 || v.get('elec.afcs2_powered') !== 0;
    if (pwr && !this.afcsPowered) this.ydT = 3;
    if (!pwr) this.ydT = 0;
    if (this.ydT > 0 && v.get('ahrs1.valid') !== 0) {
      this.ydT -= dt;
      if (this.ydT <= 0) v.set('ap.yd_engaged', 1);
    }
    this.afcsPowered = pwr;
    // G/S WARN MUTED -> EGPWS glideslope cancel.
    const gs = v.get(V.gsMute);
    if (gs !== 0 && this.prevGsMute === 0) this.events?.emit('taws.gs_cancel');
    this.prevGsMute = gs;
    // APU fuel supply ride-through (EST 2 s): the RE220's own fuel control pump and the line fuel carry the APU while
    // the boost source changes over (AC PRI pumps lost -> DC AUX pump commanded), e.g. APU GEN selected OFF with the
    // APU generator as the only AC source. Without it a one-step pressure gap flamed the APU out.
    if (v.get('fuel.apu_on') !== 0) this.apuFuelT = 2;
    else this.apuFuelT = Math.max(0, this.apuFuelT - dt);
    v.set(V.apuFuelOk, this.apuFuelT > 0 ? 1 : 0);
  }

  reset(): void {
    const v = this.v;
    for (let i = 1; i <= 2; i++) {
      this.wasRunning[i] = v.get(N.running[i]) !== 0;
      this.failed[i] = false;
    }
    this.afcsPowered = v.get('elec.afcs1_powered') !== 0 || v.get('elec.afcs2_powered') !== 0;
    this.ydT = 0;
    this.prevGsMute = v.get(V.gsMute);
    this.apuFuelT = v.get('fuel.apu_on') !== 0 ? 2 : 0;
  }
}
