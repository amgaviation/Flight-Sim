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
  sov: ['', V.sovOpen(1), V.sovOpen(2)],
  sovSw: ['', V.hydSovL, V.hydSovR],
  hydPsi: ['', 'hyd.sys1_psi', 'hyd.sys2_psi', 'hyd.sys3_psi'],
  hydTemp: ['', 'hyd.sys1_temp_c', 'hyd.sys2_temp_c', 'hyd.sys3_temp_c'],
};

/** Wing tank capacity (kg, usable) for the FMQGC percentage logic. */
const WING_CAP_KG = G6K_LIMITS.mainTankLb * LB;
const WING_UNUSABLE_KG = GLOBAL6000_FDM.mass.tanks[0].unusable_kg;

/** ACMP ids and their switch / primary pump. */
const ACMPS = [
  { p: '1b' as const, sys: 1, primaryLow: 'hyd.pump1a_lowpress', cmd: V.acmpCmd('1b'), sw: V.hydPump('1b') },
  { p: '2b' as const, sys: 2, primaryLow: 'hyd.pump2a_lowpress', cmd: V.acmpCmd('2b'), sw: V.hydPump('2b') },
  { p: '3b' as const, sys: 3, primaryLow: 'hyd.pump3a_lowpress', cmd: V.acmpCmd('3b'), sw: V.hydPump('3b') },
];

export class G6kLogic implements Subsystem {
  readonly name = 'g6k.logic';
  private readonly v: SimVars;
  // RAT
  private ratTimer = 0;
  private ratLatched = false;
  // ACMP minimum run (GXHY: 5 min after a low-pressure start)
  private readonly acmpHoldT = [0, 0, 0];
  // fuel
  private readonly ctrOn = { l: false, r: false };
  private aftOn = false;
  private wingDir = 0; // 0 none, 1 L->R, -1 R->L
  private recirc = false;
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

  constructor(vars: SimVars) {
    this.v = vars;
  }

  update(dt: number): void {
    const v = this.v;
    const ground = v.get('gear.air_ground') !== 0;
    const tla1 = v.get(N.tla[1]);
    const tla2 = v.get(N.tla[2]);
    const flapLever = v.get(V.flapLever);

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
    let apuSlotUsed = false;
    for (let k = 0; k < ACMPS.length; k++) {
      const a = ACMPS[k];
      const sw = v.get(a.sw);
      let on = false;
      if (sw === 2) on = true;
      else if (sw === 1 && anyEng) {
        // In support of a failed primary pump in flight (not on the ground), held >= 5 min.
        const primaryLow = v.get(a.primaryLow) !== 0 || (a.sys === 3 && v.get(V.acmpCmd('3a')) === 0);
        if (!ground && primaryLow) this.acmpHoldT[k] = G6K_LIMITS.acmpMinOnS;
        else this.acmpHoldT[k] = Math.max(0, this.acmpHoldT[k] - dt);
        on = configAuto || this.acmpHoldT[k] > 0;
      } else this.acmpHoldT[k] = 0;
      // APU single source: on the ground one pump at a time, in flight only 3A / 3B (GXHY).
      if (on && apuOnly) {
        if (ground) {
          on = !apuSlotUsed;
          apuSlotUsed = apuSlotUsed || on;
        } else on = a.sys === 3;
      }
      v.set(a.cmd, on ? 1 : 0);
    }
    let on3a = v.get(V.hydPump('3a')) === 2;
    if (on3a && apuOnly && ground) on3a = !apuSlotUsed;
    v.set(V.acmpCmd('3a'), on3a ? 1 : 0);
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
    v.set(V.wingXferCmd('lr'), this.wingDir === 1 ? 1 : 0);
    v.set(V.wingXferCmd('rl'), this.wingDir === -1 ? 1 : 0);
    // Recirculation (-9 FMQGC automatic): > 34,000 ft and bulk < -20 C; off at +5 C, < 33,800 ft or an engine off.
    const alt = v.get('adc1.press_alt_ft');
    const bulk = Math.min(v.get('fuel.l_main_temp_c', 15), v.get('fuel.r_main_temp_c', 15));
    const recircEnabled = v.get(V.recirc('l')) === 1 && v.get(V.recirc('r')) === 1;
    if (alt > 34000 && bulk < -20) this.recirc = true;
    if (bulk >= 5 || alt < 33800 || v.get(N.running[1]) === 0 || v.get(N.running[2]) === 0) this.recirc = false;
    v.set(V.recircOn, this.recirc && recircEnabled ? 1 : 0);

    // ---------------- bleed / packs / crossbleed (IAMS, EST architecture)
    const starting = v.get(N.starter[1]) !== 0 || v.get(N.starter[2]) !== 0;
    const bmc = v.get('elec.bmc1_powered') !== 0 || v.get('elec.bmc2_powered') !== 0;
    for (const s of S2) {
      const sw = v.get(N.bleedSw[s]);
      v.set(N.bleedCmd[s], bmc && sw >= 1 && v.get(N.fireHandle[s]) === 0 ? 1 : 0);
    }
    const apuSw = v.get(V.apuBleed);
    const apuAvail = v.get('apu.avail') !== 0 && v.get(V.fireHandle('apu')) === 0;
    const engBleeds = (v.get('pneu.eng1_valve_open') !== 0 && v.get(N.running[1]) !== 0 ? 1 : 0) + (v.get('pneu.eng2_valve_open') !== 0 && v.get(N.running[2]) !== 0 ? 1 : 0);
    // AUTO: APU bleed while it is available and the engines do not supply the ducts (or a start is in progress), below the
    // 30,000 ft APU bleed limit (GXAPU).
    const apuBleed = bmc && apuAvail && alt < G6K_LIMITS.apuBleedCeilingFt && (apuSw === 2 || (apuSw === 1 && (engBleeds < 2 || starting)));
    v.set(V.apuBleedCmd, apuBleed ? 1 : 0);
    const xbSw = v.get(V.xbleed);
    v.set(V.xbleedCmd, bmc && (xbSw === 2 || (xbSw === 1 && (starting || engBleeds === 1 || (apuBleed && engBleeds < 2)))) ? 1 : 0);
    const ram = v.get(V.ramAir) === 1;
    for (const s of S2) {
      // EST: packs pause while an engine start draws the duct (air to the starter first).
      v.set(N.packCmd[s], bmc && v.get(N.packSw[s]) === 1 && !ram && !starting ? 1 : 0);
    }

    // ---------------- PRESSURIZATION LDG ELEV UP / DN toggle (FCOM 01-10-41): slewing selects MAN landing elevation.
    // EST rate 500 ft/s (the FCOM gives no rate), range -1,000 .. 14,000 ft (dossier section 12.1).
    const slew = v.get(V.ldgElevSlew);
    if (slew !== 0) {
      if (v.get(V.ldgElevFms) !== 0) v.set(V.ldgElevFms, 0);
      const e = v.get(V.ldgElevFt) + Math.sign(slew) * 500 * dt;
      v.set(V.ldgElevFt, Math.max(-1000, Math.min(14000, e)));
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

    // ---------------- flight spoilers (GXFC): 0 .. FULL = inboard MFS pairs (0 .. 0.5 of full lift dumping); MAX = all
    // four pairs with the flaps retracted, inboard pairs only with flaps extended.
    const fsl = Math.max(0, Math.min(1, v.get(V.flightSpoiler)));
    const flapsExt = v.get('surf.flaps_deg') > 0.5 || v.get('surf.slats') > 0.5;
    const sb = fsl <= 0.8 ? (fsl / 0.8) * 0.5 : flapsExt ? 0.5 : 0.5 + ((fsl - 0.8) / 0.2) * 0.5;
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

    // ---------------- gear horn mute (GXLG): effective only with both radio altimeters invalid.
    v.set(V.hornMuteEff, v.get(V.hornMute) === 1 && v.get('ra1.valid') === 0 && v.get('ra2.valid') === 0 ? 1 : 0);

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
