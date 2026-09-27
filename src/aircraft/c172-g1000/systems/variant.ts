/**
 * Cessna 172S G1000 NXi / GFC 700 glue between the variant's cockpit controls and the
 * systems (the shared 172S core, the G1000 suite and the shared Afcs):
 *
 * C172G1000Logic (early, before the AFCS and the pitch-trim axis):
 *  - GFC 700 manual electric trim (MET), split switch (CRG 190-00384-12 §6.1): the left half is
 *    the ARM contact, the right half the DN / UP contacts; trim runs only with both operated
 *    together (the simulator's trim keys act as both). Closing ARM disengages an engaged
 *    autopilot, or acknowledges a disconnect alert when it is already off. Either half alone for
 *    more than 3 s disables MET and shows PTRM until both are released. The result drives the
 *    TrimAxis electric channel `ac.c172g.met_cmd`. When electric trim is not available
 *    (AUTOPILOT breaker, servos not through the preflight test, A/P TRIM DISC held) the trim keys
 *    roll the manual trim wheel instead, as the pilot would.
 *  - A/P TRIM DISC held interrupts all electric trim (POH Sec 3 "Autopilot or electric trim
 *    failure": "A/P TRIM DISC Button - PRESS and HOLD (throughout recovery)"); its release ends the
 *    ESP interrupt (G1K apDiscHold, PG §8.11: ESP is interrupted only while the switch is held).
 *  - ELT remote rocker ON / ARM: ON transmits; returning from ON to ARM resets the ELT
 *    (POH Fig 7-2 item 11 "ON/ARM/TEST RESET"; Artex remote: press ON, wait 1 s, press ARM).
 *  - Ignition key tag: insert the key / remove it with the MAGNETOS switch OFF.
 *  - Throttle friction lock backed off: the throttle creeps toward idle with engine vibration.
 *  - Portable extinguisher: ring pin, then the trigger discharges the Halon bottle (POH 7-79).
 *  - Cabin door handles: OPEN unlatches the door and springs back to CLOSE; the door pull shuts
 *    and latches it; LOCK over-centre (POH 7-27).
 *  - External power: ground-crew GPU connect / disconnect (on the ground, engine stopped).
 *
 * C172G1000LateLogic (after the shared lighting and late logic):
 *  - GDU / GMA backlighting: AVIONICS dimmer rotated off = display photocells (POH Sec 7
 *    "Interior lighting": "Positioning the dimmer control in the off position ... causes the
 *    avionics displays to use internal photocells"), otherwise the dimmer level.
 *  - Avionics cooling fans (POH 7-73: tailcone, forward/deckskin, PFD and MFD fans; electrical
 *    loads fan_* in c172s-common), GDU temperature and the PFD1 COOLING / MFD1 COOLING system
 *    messages (CRG 190-00384-12 Appendix: Alerts window, not CAS; POH Sec 3 "Display cooling").
 *  - ELT: remote light flashing, aural warning and the 121.5 MHz sweep on a COM receiver
 *    (NXi Supplement 1, Artex ELT 1000).
 *  - CO detector system messages CO DET SRVC / CO DET FAIL (POH 7-80).
 *  - Door-ajar wind noise.
 *  - Standby attitude indicator low-vacuum GYRO flag (POH Sec 7 "Standby instrument cluster").
 */
import type { Subsystem } from '../../types';
import type { SimContext } from '../../../core/SimContext';
import type { FailureDef } from '../../../systems/failures';
import { ENG, INPUT, NAV } from '../../../core/vars';
import { G1K, G1K_EVENTS } from '../../../avionics/garmin-g1000/vars';
import { C172, C172_FAIL, DOOR, ELT_SW, MAG } from '../../c172s-common/vars';
import { C172G, C172G_FAIL, ELT_ROCKER } from '../vars';
import { DISPLAY_COOLING, DOOR_HANDLE, EXTINGUISHER, MET_DATA, THROTTLE_CREEP, TRIM_RATES } from '../data';

type Loop = { setGain(g: number): void; stop(): void };

/** CRG 190-00384-12 Appendix A system message texts. */
const MSG = {
  pfdCooling: 'PFD1 COOLING – PFD1 has poor cooling. Reducing power usage.',
  mfdCooling: 'MFD1 COOLING – MFD1 has poor cooling. Reducing power usage.',
  coDetSrvc: 'CO DET SRVC – CO detector needs service.',
  coDetFail: 'CO DET FAIL – CO detector has lost communication with the G1000.',
} as const;

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Trim position var of the shared TrimAxis (c172s-common C172.trimPosition). */
const TRIM_POS = C172.trimPosition;
/** TrimAxis output: electric trim available (power && enable). */
const TRIM_ELEC_AVAIL = 'trim.pitch_elec_avail';

export interface VariantLogicHooks {
  /** Disengage the autopilot (pilot disconnect: MET operated with the AP engaged). */
  disengageAp(): void;
  /** Emits a momentary event (A/P TRIM DISC release to the G1000, MET ARM disconnect acknowledge to the Afcs). */
  emit?(name: string, payload?: unknown): void;
}

/** GFC 700 event names used by the MET ARM acknowledge and the A/P TRIM DISC release. */
const EV_DISC_RESET = 'ap.disc_reset';
const EV_AP_DISC_HOLD = G1K_EVENTS.apDiscHold;

export class C172G1000Logic implements Subsystem {
  readonly name = 'c172-g1000-logic';
  private prevArm = false;
  private prevApDisc = false;
  private armOnlyS = 0;
  private dirOnlyS = 0;
  private metFault = false;
  private prevRocker = 0;
  private readonly handleS = [0, 0];
  private readonly prevHandle = [1, 1];
  private readonly prevPull = [0, 0];
  private readonly lastDoor = [-1, -1];
  private prevGpu = 0;
  private eltResetS = 0;
  private prevKeyTag = 0;
  private extPsi: number = EXTINGUISHER.chargedPsi;

  constructor(
    private readonly vars: SimContext['vars'],
    private readonly hooks: VariantLogicHooks,
  ) {
    this.reset();
  }

  failures(): FailureDef[] {
    return [
      { id: C172G_FAIL.fwdFan, name: 'Forward avionics fan', category: 'avionics', description: 'Forward avionics cooling fan inoperative: PFD1 / MFD1 COOLING advisories after a few minutes.' },
      { id: C172G_FAIL.aftFan, name: 'Aft avionics fan', category: 'avionics', description: 'Aft (tailcone) avionics cooling fan inoperative.' },
      { id: C172G_FAIL.pfdFan, name: 'PFD cooling fan', category: 'avionics', description: 'PFD fan inoperative: PFD1 COOLING after several minutes (with the deckskin fan also failed, sooner).' },
      { id: C172G_FAIL.mfdFan, name: 'MFD cooling fan', category: 'avionics', description: 'MFD fan inoperative: MFD1 COOLING after a few minutes.' },
    ];
  }

  reset(): void {
    const v = this.vars;
    this.prevArm = Math.round(v.get(C172G.met)) !== 0 && Math.round(v.get(C172G.metHalf)) !== 2;
    this.prevApDisc = v.get(C172G.apDisc) > 0.5;
    this.armOnlyS = this.dirOnlyS = 0;
    this.metFault = false;
    this.prevGpu = v.get(C172G.gpuRequest);
    for (const i of [0, 1]) {
      this.handleS[i] = 0;
      this.prevHandle[i] = Math.round(v.get(i === 0 ? C172G.doorHandleLeft : C172G.doorHandleRight, DOOR.closed));
      this.prevPull[i] = 0;
      this.lastDoor[i] = -1;
    }
    this.prevRocker = Math.round(v.get(C172G.eltRocker));
    this.prevKeyTag = v.get(C172G.keyTag);
    this.eltResetS = 0;
    this.extPsi = v.get(C172.extinguisher) > 0.5 ? 0 : EXTINGUISHER.chargedPsi;
    v.set(C172G.extPsi, this.extPsi);
  }

  update(dt: number): void {
    const v = this.vars;

    // ---------------------------------------------------------------- GFC 700 electric trim / A/P TRIM DISC
    const apDisc = v.get(C172G.apDisc) > 0.5;
    // Release of A/P TRIM DISC ends the ESP interrupt (the cockpit button also sends it; keyboard / scripted users
    // that only write the var get it here).
    if (!apDisc && this.prevApDisc) this.hooks.emit?.(EV_AP_DISC_HOLD, { pressed: false });
    this.prevApDisc = apDisc;
    const interrupt = apDisc;
    v.set(C172G.trimInterrupt, interrupt ? 1 : 0);
    // MET split switch: thumb position and which halves it is on.
    const met = Math.round(clamp(v.get(C172G.met), -1, 1));
    const half = Math.round(v.get(C172G.metHalf));
    const keys = clamp(v.get(INPUT.pitchTrimRate), -1, 1);
    const keyDir = Math.abs(keys) > 0.05 ? keys : 0;
    const arm = (met !== 0 && half !== 2) || keyDir !== 0;
    const dir = met !== 0 && half !== 1 ? met : keyDir;
    // Stuck / single half for more than 3 s disables MET and shows PTRM until both halves are released.
    this.armOnlyS = arm && dir === 0 ? this.armOnlyS + dt : 0;
    this.dirOnlyS = dir !== 0 && !arm ? this.dirOnlyS + dt : 0;
    if (this.armOnlyS > MET_DATA.singleHalfFaultS || this.dirOnlyS > MET_DATA.singleHalfFaultS) this.metFault = true;
    if (!arm && dir === 0) this.metFault = false;
    v.set(C172G.metArm, arm ? 1 : 0);
    v.set(C172G.metDir, dir);
    v.set(C172G.metFault, this.metFault ? 1 : 0);
    v.set(G1K.metFault, this.metFault ? 1 : 0);
    const elecAvail = v.get(TRIM_ELEC_AVAIL) > 0.5 && !interrupt;
    let cmd = arm && dir !== 0 && !this.metFault ? dir : 0;
    if (met === 0 && keyDir !== 0 && !elecAvail) {
      // No electric trim: the pilot rolls the manual trim wheel (a cockpit write to the position var).
      cmd = 0;
      v.set(TRIM_POS, clamp(v.get(TRIM_POS) + keys * TRIM_RATES.manualHand * dt, -1, 1));
    }
    v.set(C172G.metCmd, cmd);
    // MET ARM: disengages the autopilot, or acknowledges a disconnect alert (CRG §6.1 / §6.4).
    if (arm && !this.prevArm) {
      if (v.get('ap.engaged') > 0.5) this.hooks.disengageAp();
      else this.hooks.emit?.(EV_DISC_RESET);
    }
    this.prevArm = arm;

    // ---------------------------------------------------------------- ELT remote switch (ON / ARM, reset = ON then ARM)
    const rocker = Math.round(v.get(C172G.eltRocker));
    if (rocker !== ELT_ROCKER.on && this.prevRocker === ELT_ROCKER.on) this.eltResetS = 1;
    this.prevRocker = rocker;
    if (this.eltResetS > 0) this.eltResetS = Math.max(0, this.eltResetS - dt);
    v.set(C172.elt, rocker === ELT_ROCKER.on ? ELT_SW.on : this.eltResetS > 0 ? ELT_SW.reset : ELT_SW.arm);

    // ---------------------------------------------------------------- ignition key (tag)
    const tag = v.get(C172G.keyTag);
    if (tag > 0.5 && this.prevKeyTag <= 0.5) {
      if (v.get(C172.keyIn, 1) < 0.5) v.set(C172.keyIn, 1);
      else if (Math.round(v.get(C172.magneto)) === MAG.off) v.set(C172.keyIn, 0);
    }
    this.prevKeyTag = tag;

    // ---------------------------------------------------------------- throttle friction lock
    if (v.get(ENG.running(1)) > 0.5 && v.get(C172.throttleFriction) < THROTTLE_CREEP.frictionBelow && v.get(INPUT.throttleBound) === 0) {
      const t = v.get(C172.throttle);
      if (t > 0) v.set(C172.throttle, Math.max(0, t - THROTTLE_CREEP.ratePerS * dt));
    }

    // ---------------------------------------------------------------- portable extinguisher (POH 7-79: pull the ring pin, press the lever)
    const pinPulled = v.get(C172G.extPin) > 0.5;
    const squeezed = v.get(C172G.extTrigger) > 0.5;
    const discharging = pinPulled && squeezed && this.extPsi > 0;
    if (discharging) {
      this.extPsi = Math.max(0, this.extPsi - (EXTINGUISHER.chargedPsi / EXTINGUISHER.dischargeS) * dt);
      v.set(C172.extinguisher, 1);
    } else if (v.get(C172.extinguisher) < 0.5) this.extPsi = EXTINGUISHER.chargedPsi; // serviced (state preset)
    v.set(C172G.extPsi, this.extPsi);
    v.set(C172G.extDischarging, discharging ? 1 : 0);

    // ---------------------------------------------------------------- cabin doors (POH 7-27)
    this.updateDoors(dt);

    // ---------------------------------------------------------------- external power (ground crew; POH 7-58)
    const gpu = v.get(C172G.gpuRequest);
    if (gpu !== this.prevGpu) {
      const onGround = v.get('fdm.on_ground', 1) > 0.5 || v.get('fdm.ias_kt') < 30;
      const stopped = v.get(ENG.running(1)) < 0.5 && v.get(ENG.rpm(1)) < 100;
      if (gpu > 0.5 && !(onGround && stopped)) v.set(C172G.gpuRequest, 0); // the cart is only plugged in with the engine stopped
      else v.set(C172.extPower, gpu > 0.5 ? 1 : 0);
    }
    // Disconnected when the airplane moves off (ground crew unplugs before taxi); the cart cannot follow in flight.
    if (v.get(C172.extPower) > 0.5 && v.get('fdm.gs_kt') > 3) {
      v.set(C172.extPower, 0);
      v.set(C172G.gpuRequest, 0);
    }
    this.prevGpu = v.get(C172G.gpuRequest);

    // ---------------------------------------------------------------- AUX AUDIO IN (POH Sec 7 "Auxiliary audio input jack")
    const keyed = v.get(C172G.pttPilot) > 0.5 || v.get(C172G.pttCopilot) > 0.5 || v.get(C172G.pttHandMic) > 0.5;
    v.set(C172G.auxAudioActive, v.get(C172G.auxAudioCable) > 0.5 && v.get('elec.audio_powered') > 0.5 && !keyed ? 1 : 0);
  }

  private updateDoors(dt: number): void {
    const v = this.vars;
    for (let i = 0; i < 2; i++) {
      const n = doorVars(i);
      let door = Math.round(v.get(n.door, DOOR.closed));
      // External write (state preset / other code): re-seat the handle.
      if (this.lastDoor[i] >= 0 && door !== this.lastDoor[i]) {
        v.set(n.handle, door === DOOR.locked ? DOOR.locked : DOOR.closed);
        this.prevHandle[i] = Math.round(v.get(n.handle));
      } else if (this.lastDoor[i] < 0) {
        v.set(n.handle, door === DOOR.locked ? DOOR.locked : DOOR.closed);
        this.prevHandle[i] = Math.round(v.get(n.handle));
      }
      const h = Math.round(v.get(n.handle, DOOR.closed));
      if (h === DOOR.open) {
        door = DOOR.open;
        this.handleS[i] += dt;
        if (this.handleS[i] >= DOOR_HANDLE.springReturnS) v.set(n.handle, DOOR.closed); // spring-loaded to CLOSE
      } else this.handleS[i] = 0;
      if (h === DOOR.locked && this.prevHandle[i] !== DOOR.locked) {
        if (door === DOOR.closed) door = DOOR.locked;
        else if (door === DOOR.open) v.set(n.handle, DOOR.closed); // an open door cannot be locked
      }
      if (h === DOOR.closed && this.prevHandle[i] === DOOR.locked && door === DOOR.locked) door = DOOR.closed;
      const pull = v.get(n.pull);
      if (pull > 0.5 && this.prevPull[i] <= 0.5 && door === DOOR.open) door = DOOR.closed;
      this.prevPull[i] = pull;
      this.prevHandle[i] = Math.round(v.get(n.handle));
      v.set(n.door, door);
      this.lastDoor[i] = door;
    }
  }
}

/**
 * Door handles: OPEN unlatches the door (C172.door* = OPEN) and springs back to CLOSE; the door pull shuts and
 * latches the door (the shared late logic re-opens it above ~85 KIAS); LOCK / CLOSE lock and unlock a latched
 * door. A door state written from elsewhere (state presets) re-seats the handle.
 */
function doorVars(i: number): { door: string; handle: string; pull: string } {
  return i === 0
    ? { door: C172.doorLeft, handle: C172G.doorHandleLeft, pull: C172G.doorPullLeft }
    : { door: C172.doorRight, handle: C172G.doorHandleRight, pull: C172G.doorPullRight };
}

/** Display / key backlighting, avionics cooling fans and the standby gyro flag. */
export class C172G1000LateLogic implements Subsystem {
  readonly name = 'c172-g1000-late';
  private pfdRise = 0;
  private mfdRise = 0;
  private flag = 1;
  private fan: Loop | null = null;
  private wind: Loop | null = null;
  private eltBuzz: Loop | null = null;
  private eltSweep: Loop | null = null;
  private loopsTried = false;
  private t = 0;
  private msgT = 0;

  constructor(
    private readonly ctx: Pick<SimContext, 'vars' | 'audio'>,
    /** G1000 Alerts-window system message sink (suite.system.alerts.message). */
    private readonly message: (id: string, text: string, on: boolean) => void = () => undefined,
  ) {}

  reset(): void {
    const v = this.ctx.vars;
    this.pfdRise = v.get('elec.pfd_powered') > 0.5 ? DISPLAY_COOLING.riseFanC : 0;
    this.mfdRise = v.get('elec.mfd_powered') > 0.5 ? DISPLAY_COOLING.riseFanC : 0;
    this.flag = v.get('ac.vac.suction_inhg') >= 3.5 ? 0 : 1;
  }

  update(dt: number): void {
    const v = this.ctx.vars;

    // ---------------------------------------------------------------- backlighting (POH Sec 7 "Interior lighting")
    const ambient = v.get('env.ambient_light', 1);
    const dimmer = v.get('ac.light.avionics'); // AVIONICS dimmer x its supply (c172s-common lighting)
    const photocell = dimmer < 0.02;
    // EST photocell law: full brightness in daylight, ~30 % at night.
    const displayAuto = 0.3 + 0.7 * smoothstep(0.1, 0.8, ambient);
    const displayLevel = photocell ? displayAuto : Math.max(0.05, dimmer);
    v.set('display.pfd.brt', displayLevel);
    v.set('display.mfd.brt', displayLevel);
    // Bezel / GMA key lighting: photocell dims it out in daylight (EST), the dimmer sets it at night.
    const keyAuto = 0.7 * (1 - smoothstep(0.3, 0.85, ambient));
    const keyLevel = photocell ? keyAuto : dimmer;
    for (const g of ['pfd', 'mfd'] as const) {
      const manual = v.get(G1K.keyBrtManual(g)) > 0.5;
      const lvl = manual ? clamp(v.get(G1K.keyBrtPct(g), 100) / 100, 0, 1) : keyLevel;
      v.set(G1K.keyLight(g), v.get(G1K.unitPowered(g)) > 0.5 ? lvl : 0);
    }
    v.set(C172G.keyLight, v.get('elec.audio_powered') > 0.5 ? keyLevel : 0);

    // ---------------------------------------------------------------- avionics cooling fans (POH 7-73, Fig 7-7 sheet 2)
    const fan = (load: string, failId: string) => v.get(`elec.${load}_powered`) > 0.5 && v.get(`fail.${failId}`) === 0;
    const fwd = fan('fan_deck', C172G_FAIL.fwdFan);
    const pfdF = fan('fan_pfd', C172G_FAIL.pfdFan);
    const mfdF = fan('fan_mfd', C172G_FAIL.mfdFan);
    const aft = fan('fan_aft', C172G_FAIL.aftFan);
    v.set(C172G.fwdFan, fwd ? 1 : 0);
    v.set(C172G.pfdFan, pfdF ? 1 : 0);
    v.set(C172G.mfdFan, mfdF ? 1 : 0);
    v.set(C172G.aftFan, aft ? 1 : 0);
    const k = 1 - Math.exp(-dt / DISPLAY_COOLING.tauS);
    // PFD: its own fan and the deckskin fan; MFD: its fan (EST rises, data.ts).
    const pfdFans = (pfdF ? 1 : 0) + (fwd ? 1 : 0);
    const pfdTgt = v.get('elec.pfd_powered') > 0.5 ? (pfdFans === 2 ? DISPLAY_COOLING.riseFanC : pfdFans === 1 ? DISPLAY_COOLING.riseOneFanC : DISPLAY_COOLING.riseNoFanC) : 0;
    const mfdTgt = v.get('elec.mfd_powered') > 0.5 ? (mfdF ? DISPLAY_COOLING.riseFanC : DISPLAY_COOLING.riseNoFanC) : 0;
    this.pfdRise += (pfdTgt - this.pfdRise) * k;
    this.mfdRise += (mfdTgt - this.mfdRise) * k;
    const cabin = v.get(C172.cabinTempC, 20);
    v.set(C172G.pfdTempC, cabin + this.pfdRise);
    v.set(C172G.mfdTempC, cabin + this.mfdRise);
    const pfdCool = this.pfdRise > DISPLAY_COOLING.advisoryRiseC;
    const mfdCool = this.mfdRise > DISPLAY_COOLING.advisoryRiseC;
    v.set(C172G.pfdCooling, pfdCool ? 1 : 0);
    v.set(C172G.mfdCooling, mfdCool ? 1 : 0);

    // ---------------------------------------------------------------- ELT (NXi Supplement 1: light flashes, aural warning; 121.5 MHz on a COM)
    this.t += dt;
    const elt = v.get(C172.eltTx) > 0.5;
    v.set(C172G.eltLight, elt && Math.floor(this.t * 2) % 2 === 0 ? 1 : 0); // EST ~1 Hz flash
    v.set(C172G.eltAural, elt ? 1 : 0);
    let heard = false;
    if (elt) {
      const gmaUp = v.get(G1K.unitUp('gma')) > 0.5;
      for (const r of [1, 2]) {
        if (v.get(G1K.unitUp(`com${r}`)) < 0.5 || Math.abs(v.get(NAV.comActive(r)) - 121.5) > 0.004) continue;
        // Received audio: the GMA receive selection (or the transmit selection); GMA off = fail-safe COM1 to the pilot.
        const sel = gmaUp ? v.get(G1K.gmaSel(`com${r}`)) > 0.5 || Math.round(v.get(G1K.gmaMic)) === r : r === 1;
        if (sel) heard = true;
      }
    }
    v.set(C172G.eltComAudio, heard ? 1 : 0);

    // ---------------------------------------------------------------- system messages (2 Hz)
    this.msgT -= dt;
    if (this.msgT <= 0) {
      this.msgT = 0.5;
      this.message('pfd1_cooling', MSG.pfdCooling, pfdCool && v.get(G1K.unitUp('pfd')) > 0.5);
      this.message('mfd1_cooling', MSG.mfdCooling, mfdCool && v.get(G1K.unitUp('mfd')) > 0.5);
      // CO detector (POH 7-80): needs service / lost communication (failed or unpowered) with the G1000 up.
      const g1kUp = v.get(G1K.unitUp('gia1')) > 0.5;
      this.message('co_det_srvc', MSG.coDetSrvc, g1kUp && v.get(`fail.${C172_FAIL.coDetSrvc}`) !== 0);
      this.message('co_det_fail', MSG.coDetFail, g1kUp && v.get(C172.coDetOk) < 0.5);
    }

    // ---------------------------------------------------------------- sounds
    if (!this.loopsTried && this.ctx.audio) {
      this.loopsTried = true;
      const mk = (id: string): Loop | null => {
        try {
          return this.ctx.audio!.loop(id);
        } catch {
          return null;
        }
      };
      this.fan = mk('fan.avionics');
      this.wind = mk('noise.pink');
      this.eltBuzz = mk('elt.buzzer');
      this.eltSweep = mk('elt.sweep');
    }
    this.fan?.setGain(0.05 * ((fwd ? 0.6 : 0) + (pfdF ? 0.3 : 0) + (mfdF ? 0.3 : 0) + (aft ? 0.4 : 0)));
    // Door ajar: wind roar grows with the gap and the airspeed (EST gain).
    const gap = Math.max(v.get(C172.doorLeftPos), v.get(C172.doorRightPos));
    const ias = v.get('fdm.ias_kt');
    this.wind?.setGain(gap > 0.01 && ias > 30 ? Math.min(0.5, 2.5 * Math.min(gap, 0.1) * (ias / 100)) : 0);
    this.eltBuzz?.setGain(elt ? 0.15 : 0);
    this.eltSweep?.setGain(heard ? 0.25 : 0);

    // ---------------------------------------------------------------- standby attitude indicator GYRO flag (EST: in view below 3.5 inHg)
    const target = v.get('ac.vac.suction_inhg') >= 3.5 ? 0 : 1;
    this.flag += (target - this.flag) * (1 - Math.exp(-dt / 0.3));
    v.set(C172G.gyroFlag, this.flag);
  }

  dispose(): void {
    for (const l of [this.fan, this.wind, this.eltBuzz, this.eltSweep]) l?.stop();
    this.fan = this.wind = this.eltBuzz = this.eltSweep = null;
  }
}
