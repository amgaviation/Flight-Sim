/**
 * Cessna 172S G1000 NXi / GFC 700 glue between the variant's cockpit controls and the
 * systems (the shared 172S core, the G1000 suite and the shared Afcs):
 *
 * C172G1000Logic (early, before the AFCS and the pitch-trim axis):
 *  - GFC 700 manual electric trim (MET): the yoke switch (or the simulator's trim keys,
 *    which act as the MET) drives the TrimAxis electric channel `ac.c172g.met_cmd`.
 *    Operating the MET with the autopilot engaged disconnects it (PG §7 "Manual Electric
 *    Trim"; the shared Afcs already does so for the trim keys). When electric trim is not
 *    available (AUTOPILOT breaker, servos not through the preflight test, A/P TRIM DISC held)
 *    the trim keys roll the manual trim wheel instead, as the pilot would.
 *  - A/P TRIM DISC held interrupts all electric trim (POH Sec 3 "Autopilot or electric trim
 *    failure": "A/P TRIM DISC Button - PRESS and HOLD (throughout recovery)").
 *  - ELT remote rocker ON / ARM: ON transmits; returning from ON to ARM resets the ELT
 *    (POH Fig 7-2 item 11 "ON/ARM/TEST RESET"; Artex remote: press ON, wait 1 s, press ARM).
 *  - Ignition key tag: insert the key / remove it with the MAGNETOS switch OFF.
 *  - Throttle friction lock backed off: the throttle creeps toward idle with engine vibration.
 *  - Portable extinguisher trigger: discharges the Halon bottle (gage pressure).
 *
 * C172G1000LateLogic (after the shared lighting and late logic):
 *  - GDU / GMA backlighting: AVIONICS dimmer rotated off = display photocells (POH Sec 7
 *    "Interior lighting": "Positioning the dimmer control in the off position ... causes the
 *    avionics displays to use internal photocells"), otherwise the dimmer level.
 *  - Forward / aft avionics cooling fans on AVIONICS BUS 1 / BUS 2 (POH Sec 4 preflight "Forward
 *    avionics fan - CHECK (verify fan is heard)"), GDU temperature and the PFD1 / MFD1 COOLING
 *    advisories (POH Sec 3 "Display cooling advisory").
 *  - Standby attitude indicator low-vacuum GYRO flag (POH Sec 7 "Standby instrument cluster").
 */
import type { Subsystem } from '../../types';
import type { SimContext } from '../../../core/SimContext';
import type { FailureDef } from '../../../systems/failures';
import { ENG, INPUT } from '../../../core/vars';
import { G1K } from '../../../avionics/garmin-g1000/vars';
import { C172, ELT_SW, MAG } from '../../c172s-common/vars';
import { C172G, C172G_FAIL, ELT_ROCKER } from '../vars';
import { DISPLAY_COOLING, EXTINGUISHER, THROTTLE_CREEP, TRIM_RATES } from '../data';

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
}

export class C172G1000Logic implements Subsystem {
  readonly name = 'c172-g1000-logic';
  private prevMet = 0;
  private prevRocker = 0;
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
      { id: C172G_FAIL.aftFan, name: 'Aft avionics fan', category: 'avionics', description: 'Aft avionics cooling fan inoperative (no fan noise with AVIONICS BUS 2 on).' },
    ];
  }

  reset(): void {
    const v = this.vars;
    this.prevMet = Math.round(v.get(C172G.met));
    this.prevRocker = Math.round(v.get(C172G.eltRocker));
    this.prevKeyTag = v.get(C172G.keyTag);
    this.eltResetS = 0;
    this.extPsi = v.get(C172.extinguisher) > 0.5 ? 0 : EXTINGUISHER.chargedPsi;
    v.set(C172G.extPsi, this.extPsi);
  }

  update(dt: number): void {
    const v = this.vars;

    // ---------------------------------------------------------------- GFC 700 electric trim / A/P TRIM DISC
    const interrupt = v.get(C172G.apDisc) > 0.5;
    v.set(C172G.trimInterrupt, interrupt ? 1 : 0);
    const met = Math.round(clamp(v.get(C172G.met), -1, 1));
    const keys = clamp(v.get(INPUT.pitchTrimRate), -1, 1);
    const elecAvail = v.get(TRIM_ELEC_AVAIL) > 0.5 && !interrupt;
    let cmd = met;
    if (cmd === 0 && Math.abs(keys) > 0.05) {
      if (elecAvail) cmd = keys;
      // No electric trim: the pilot rolls the manual trim wheel (a cockpit write to the position var).
      else v.set(TRIM_POS, clamp(v.get(TRIM_POS) + keys * TRIM_RATES.manualHand * dt, -1, 1));
    }
    v.set(C172G.metCmd, cmd);
    if (met !== 0 && this.prevMet === 0 && v.get('ap.engaged') > 0.5) this.hooks.disengageAp();
    this.prevMet = met;

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

    // ---------------------------------------------------------------- portable extinguisher
    if (v.get(C172G.extTrigger) > 0.5 && this.extPsi > 0) {
      this.extPsi = Math.max(0, this.extPsi - (EXTINGUISHER.chargedPsi / EXTINGUISHER.dischargeS) * dt);
      v.set(C172.extinguisher, 1);
    } else if (v.get(C172.extinguisher) < 0.5) this.extPsi = EXTINGUISHER.chargedPsi; // serviced (state preset)
    v.set(C172G.extPsi, this.extPsi);
  }
}

/** Display / key backlighting, avionics cooling fans and the standby gyro flag. */
export class C172G1000LateLogic implements Subsystem {
  readonly name = 'c172-g1000-late';
  private pfdRise = 0;
  private mfdRise = 0;
  private flag = 1;
  private fan: { setGain(g: number): void; stop(): void } | null = null;
  private fanTried = false;

  constructor(private readonly ctx: Pick<SimContext, 'vars' | 'audio'>) {}

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

    // ---------------------------------------------------------------- avionics cooling fans
    const fwd = v.get('elec.avn1_powered') > 0.5 && v.get(`fail.${C172G_FAIL.fwdFan}`) === 0;
    const aft = v.get('elec.avn2_powered') > 0.5 && v.get(`fail.${C172G_FAIL.aftFan}`) === 0;
    v.set(C172G.fwdFan, fwd ? 1 : 0);
    v.set(C172G.aftFan, aft ? 1 : 0);
    const k = 1 - Math.exp(-dt / DISPLAY_COOLING.tauS);
    const tgt = (powered: boolean) => (powered ? (fwd ? DISPLAY_COOLING.riseFanC : DISPLAY_COOLING.riseNoFanC) : 0);
    this.pfdRise += (tgt(v.get('elec.pfd_powered') > 0.5) - this.pfdRise) * k;
    this.mfdRise += (tgt(v.get('elec.mfd_powered') > 0.5) - this.mfdRise) * k;
    const cabin = v.get(C172.cabinTempC, 20);
    v.set(C172G.pfdTempC, cabin + this.pfdRise);
    v.set(C172G.mfdTempC, cabin + this.mfdRise);
    v.set(C172G.pfdCooling, this.pfdRise > DISPLAY_COOLING.advisoryRiseC ? 1 : 0);
    v.set(C172G.mfdCooling, this.mfdRise > DISPLAY_COOLING.advisoryRiseC ? 1 : 0);
    if (!this.fanTried && this.ctx.audio) {
      this.fanTried = true;
      try {
        this.fan = this.ctx.audio.loop('fan.avionics');
      } catch {
        this.fan = null;
      }
    }
    this.fan?.setGain(0.05 * ((fwd ? 1 : 0) + (aft ? 0.7 : 0)));

    // ---------------------------------------------------------------- standby attitude indicator GYRO flag (EST: in view below 3.5 inHg)
    const target = v.get('ac.vac.suction_inhg') >= 3.5 ? 0 : 1;
    this.flag += (target - this.flag) * (1 - Math.exp(-dt / 0.3));
    v.set(C172G.gyroFlag, this.flag);
  }

  dispose(): void {
    this.fan?.stop();
    this.fan = null;
  }
}
