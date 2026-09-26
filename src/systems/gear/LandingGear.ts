/**
 * Landing gear: handle, actuation (hydraulic or electric), locks and
 * indications, gear warning horn, air/ground (squat) logic, emergency
 * extension. Also used for fixed-gear aircraft (`retractable: false`) to
 * provide the debounced air/ground signal every other block reads.
 *
 * Actuation: each leg travels 0 (up & locked) .. 1 (down & locked) in
 *   `extendS`/`retractS` at full power; the rate scales with the power
 *   binding (hydraulic pressure fraction / bus) above `minPower`. Optional
 *   doors open before and close after the legs travel. Without power a leg
 *   that is neither up-locked nor down-locked falls under gravity
 *   (`freefallS`), a leg in its uplock stays up.
 * Handle: `handleVar` (default `ac.gear_handle`): 1 = DN, 0 = UP, any other
 *   configured `handleOffValue` = OFF (737: pressure removed, gear stays
 *   locked). On the ground the handle lock solenoid holds it DOWN
 *   (`gear.handle_lock` = 1; the cockpit GearHandle `inhibit` reads it)
 *   unless `handleLock.overrideVar` is set. With `groundRetractInhibit`
 *   (squat-switch safety relay) the gear will not retract on the ground even
 *   if the handle gets up.
 * Emergency extension (`alternate`): 'freefall' (T-handle/manual extension
 *   handles release the uplocks: legs fall in `freefallS` — 737 manual
 *   extension), 'blowdown' (pneumatic bottle: legs extend in `blowdownS`,
 *   one shot: `gear.blowdown_used`, cannot retract afterwards — Citation),
 *   'handpump' (each `gear.hand_pump` event stroke extends by 1/strokes).
 * Indications (per leg i): gear.green{i} (down & locked), gear.red{i}
 *   (not locked in agreement with the handle, or not down & locked while
 *   the horn condition exists — 737 red lights), lamps need `lights.power`,
 *   lamp test shows all.
 * Horn: rules `{ when, silenceable }` evaluated while the gear is not all
 *   down & locked; a silenceable rule stays silent after `gear.horn_silence`
 *   until its condition goes false again (737 horn cutout). Output
 *   `gear.horn` and ALERT.gearWarning; tone `gear_horn` via audio.
 * Air/ground: `squat.legs` WOW switches (gear.wow{i} from the FDM) are
 *   debounced (`airToGroundS`, `groundToAirS`), combined with 'any'/'all'.
 * Disagree: handle and gear disagree longer than `disagreeS` -> gear.disagree.
 *
 * Vars written: gear.pos{i}, gear.green{i}, gear.red{i}, gear.squat{i},
 * gear.air_ground, gear.down_locked, gear.up_locked, gear.transit,
 * gear.moving (0..1 for hydraulic consumer demand), gear.doors,
 * gear.handle_down, gear.handle_lock, gear.disagree, gear.horn,
 * gear.unsafe, gear.blowdown_used, alert.gear_warning.
 * Events: gear.horn_silence, gear.hand_pump.
 * Failures: gear.leg{i}.jam (leg stuck in place), gear.leg{i}.uplock
 * (uplock will not release: leg stays up), gear.actuation (normal extension
 * and retraction inoperative), gear.squat{i} (squat switch stuck in air).
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import type { AudioApi } from '../../core/SimContext';
import { ALERT, GEAR } from '../../core/vars';
import { compileBinding, compileCondition, type Binding, type Evaluator } from '../util/binding';
import { failVar } from '../util/ids';
import { listen, type BlockEnv } from '../autopilot/lib';

export interface GearLegDef {
  /** GEAR.pos(i) index: 0 nose, 1 left main, 2 right main (FDM convention). */
  index: number;
  name?: string;
  extendS: number;
  retractS: number;
  /** Gravity free-fall time (s). Default 1.3 × extendS (EST). */
  freefallS?: number;
}

export interface GearHornRule {
  when: Binding;
  silenceable: boolean;
  label?: string;
}

export interface LandingGearConfig {
  retractable?: boolean;
  legs: GearLegDef[];
  handleVar?: string;
  handleOffValue?: number;
  actuation?: { power: Binding; minPower?: number };
  doors?: { openS: number; closeS: number };
  groundRetractInhibit?: boolean;
  handleLock?: { enabled?: boolean; overrideVar?: string };
  alternate?: {
    kind: 'freefall' | 'blowdown' | 'handpump';
    trigger: Binding;
    blowdownS?: number;
    strokes?: number;
  };
  squat?: { legs?: number[]; mode?: 'any' | 'all'; airToGroundS?: number; groundToAirS?: number };
  horn?: { rules: GearHornRule[]; tone?: string };
  lights?: { power?: Binding; test?: Binding };
  disagreeS?: number;
  /** Start state if gear.pos vars are unset: true = down. Default true. */
  initialDown?: boolean;
}

class Leg {
  pos: number;
  sqState = false;
  sqTimer = 0;
  readonly fJam: string;
  readonly fUplock: string;
  readonly fSquat: string;
  readonly posVar: string;
  readonly wowVar: string;
  readonly oGreen: string;
  readonly oRed: string;
  readonly oSquat: string;
  constructor(readonly def: GearLegDef, initial: number) {
    this.pos = initial;
    const i = def.index;
    this.fJam = failVar(`gear.leg${i}.jam`);
    this.fUplock = failVar(`gear.leg${i}.uplock`);
    this.fSquat = failVar(`gear.squat${i}`);
    this.posVar = GEAR.pos(i);
    this.wowVar = GEAR.weightOnWheels(i);
    this.oGreen = `gear.green${i}`;
    this.oRed = `gear.red${i}`;
    this.oSquat = `gear.squat${i}`;
  }
}

const EPS = 1e-4;

export class LandingGear implements Subsystem {
  readonly name = 'landing_gear';
  readonly legs: Leg[];
  /** Door position 0 closed .. 1 open. */
  doors = 0;
  /** Debounced air/ground (true = on ground). */
  onGround = true;
  blowdownUsed = false;
  private readonly vars: SimVars;
  private readonly audio: AudioApi | undefined;
  private readonly cfg: LandingGearConfig;
  private readonly retractable: boolean;
  private readonly handleVar: string;
  private readonly power: Evaluator;
  private readonly altTrigger: () => boolean;
  private readonly lightPower: () => boolean;
  private readonly lampTest: () => boolean;
  private readonly hornRules: { when: () => boolean; silenceable: boolean; silenced: boolean }[];
  private readonly squatLegs: Leg[];
  private pumpStrokes = 0;
  private readonly disagreeS: number;
  private disagreeT = 0;
  private hornOn = false;
  private readonly offs: (() => void)[] = [];
  private readonly fAct = failVar('gear.actuation');

  constructor(env: BlockEnv, cfg: LandingGearConfig) {
    const v = env.vars;
    this.vars = v;
    this.audio = env.audio;
    this.cfg = cfg;
    this.retractable = cfg.retractable ?? true;
    this.handleVar = cfg.handleVar ?? 'ac.gear_handle';
    const initDown = cfg.initialDown ?? true;
    this.legs = cfg.legs.map((d) => new Leg(d, v.has(GEAR.pos(d.index)) ? v.get(GEAR.pos(d.index)) : initDown ? 1 : 0));
    if (!v.has(this.handleVar)) v.set(this.handleVar, initDown ? 1 : 0);
    this.power = compileBinding(v, cfg.actuation?.power, 1);
    this.altTrigger = compileCondition(v, cfg.alternate?.trigger, false);
    this.lightPower = compileCondition(v, cfg.lights?.power, true);
    this.lampTest = compileCondition(v, cfg.lights?.test ?? ALERT.annunTest, false);
    this.hornRules = (cfg.horn?.rules ?? []).map((r) => ({ when: compileCondition(v, r.when), silenceable: r.silenceable, silenced: false }));
    const sq = cfg.squat?.legs;
    this.squatLegs = this.legs.filter((l) => (sq ? sq.includes(l.def.index) : true));
    for (const l of this.legs) {
      l.sqState = v.get(l.wowVar) !== 0;
    }
    this.onGround = this.combineSquat();
    let maxT = 0;
    for (const l of cfg.legs) maxT = Math.max(maxT, l.extendS, l.retractS);
    if (cfg.doors) maxT += cfg.doors.openS + cfg.doors.closeS;
    this.disagreeS = cfg.disagreeS ?? 1.5 * maxT + 1;
    listen(env.events, this.offs, 'gear.horn_silence', () => {
      for (const r of this.hornRules) if (r.silenceable && r.when()) r.silenced = true;
    });
    listen(env.events, this.offs, 'gear.hand_pump', () => {
      this.pumpStrokes += 1;
    });
    this.publish(0, false);
  }

  failures(): FailureDef[] {
    const c = 'gear';
    const f: FailureDef[] = [{ id: 'gear.actuation', name: 'Gear normal actuation', category: c, description: 'Normal extension/retraction inoperative: use the alternate extension.' }];
    for (const l of this.legs) {
      const n = l.def.name ?? `leg ${l.def.index}`;
      f.push({ id: `gear.leg${l.def.index}.jam`, name: `${n} gear jam`, category: c, description: 'Leg stuck where it is.' });
      f.push({ id: `gear.leg${l.def.index}.uplock`, name: `${n} uplock stuck`, category: c, description: 'Leg stays in the uplock.' });
      f.push({ id: `gear.squat${l.def.index}`, name: `${n} squat switch`, category: c, description: 'Squat switch stuck in AIR.' });
    }
    return f;
  }

  /** Sets all legs down/up immediately (applyState). */
  setDown(down: boolean): void {
    for (const l of this.legs) l.pos = down ? 1 : 0;
    this.doors = 0;
    this.vars.set(this.handleVar, down ? 1 : 0);
    this.publish(0, false);
  }

  reset(): void {
    const v = this.vars;
    for (const l of this.legs) {
      l.pos = v.get(l.posVar, l.pos);
      l.sqState = v.get(l.wowVar) !== 0 && v.get(l.fSquat) === 0;
      l.sqTimer = 0;
    }
    this.onGround = this.combineSquat();
    this.disagreeT = 0;
    this.pumpStrokes = 0;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  update(dt: number): void {
    const v = this.vars;
    const cfg = this.cfg;

    // ---- squat switches (debounced)
    const a2g = cfg.squat?.airToGroundS ?? 0.1;
    const g2a = cfg.squat?.groundToAirS ?? 0.5;
    for (const l of this.legs) {
      const raw = v.get(l.wowVar) !== 0 && v.get(l.fSquat) === 0;
      if (raw !== l.sqState) {
        l.sqTimer += dt;
        if (l.sqTimer >= (raw ? a2g : g2a)) {
          l.sqState = raw;
          l.sqTimer = 0;
        }
      } else l.sqTimer = 0;
    }
    this.onGround = this.combineSquat();

    if (!this.retractable) {
      this.publish(0, false);
      return;
    }

    // ---- handle
    let handle = v.get(this.handleVar);
    const lockEnabled = cfg.handleLock?.enabled ?? true;
    const override = cfg.handleLock?.overrideVar ? v.get(cfg.handleLock.overrideVar) !== 0 : false;
    const handleLock = lockEnabled && this.onGround && !override;
    if (handleLock && handle < 0.99 && handle !== cfg.handleOffValue) {
      // The solenoid holds the lever in DN: an UP selection does not stick.
      v.set(this.handleVar, 1);
      handle = 1;
    }
    const isOff = cfg.handleOffValue !== undefined && Math.abs(handle - cfg.handleOffValue) < 0.01;
    const wantDown = !isOff && handle >= 0.99;
    const wantUp = !isOff && handle <= 0.01 && !(cfg.groundRetractInhibit && this.onGround);

    // ---- alternate extension
    const alt = cfg.alternate;
    const altActive = !!alt && this.altTrigger();
    if (altActive && alt!.kind === 'blowdown') this.blowdownUsed = true;

    // ---- power
    let p = v.get(this.fAct) === 0 ? this.power() : 0;
    p = p < 0 ? 0 : p > 1 ? 1 : p;
    const minP = cfg.actuation?.minPower ?? 0.3;
    const powered = p >= minP && !isOff;
    const rateK = powered ? Math.min(1, p / 0.8) : 0;

    // ---- doors
    const doorCfg = cfg.doors;
    let travelPermit = true;
    let anyNeedsMove = false;
    for (const l of this.legs) if ((wantDown && l.pos < 1 - EPS) || (wantUp && l.pos > EPS)) anyNeedsMove = true;
    if (doorCfg && powered) {
      const target = anyNeedsMove ? 1 : 0;
      const tS = target > this.doors ? doorCfg.openS : doorCfg.closeS;
      this.doors += clampStep(target - this.doors, dt / Math.max(0.01, tS));
      travelPermit = this.doors >= 1 - EPS || !anyNeedsMove;
    } else if (doorCfg && altActive) {
      this.doors = 1; // doors are released with the uplocks
    }

    // ---- legs
    let moving = 0;
    for (const l of this.legs) {
      if (v.get(l.fJam) !== 0) continue;
      const p0 = l.pos;
      const upLocked = l.pos <= EPS;
      const downLocked = l.pos >= 1 - EPS;
      const uplockStuck = v.get(l.fUplock) !== 0;
      const ff = l.def.freefallS ?? l.def.extendS * 1.3;
      if (altActive && !(upLocked && uplockStuck)) {
        let rate = 0;
        if (alt!.kind === 'freefall') rate = 1 / ff;
        else if (alt!.kind === 'blowdown') rate = 1 / (alt!.blowdownS ?? l.def.extendS * 0.6);
        if (alt!.kind === 'handpump') {
          const target = Math.min(1, this.pumpStrokes / Math.max(1, alt!.strokes ?? 40));
          if (target > l.pos) l.pos = target;
        } else l.pos = Math.min(1, l.pos + rate * dt);
      } else if (powered && travelPermit && !this.blowdownUsed) {
        if (wantDown && !(upLocked && uplockStuck)) l.pos = Math.min(1, l.pos + (rateK / l.def.extendS) * dt);
        else if (wantUp) l.pos = Math.max(0, l.pos - (rateK / l.def.retractS) * dt);
      } else if (!upLocked && !downLocked) {
        l.pos = Math.min(1, l.pos + dt / ff); // unpressurised: gravity drops an unlocked leg
      }
      if (l.pos !== p0) moving = 1;
    }

    // ---- disagree
    let allDown = true;
    let allUp = true;
    for (const l of this.legs) {
      if (l.pos < 1 - EPS) allDown = false;
      if (l.pos > EPS) allUp = false;
    }
    const agree = isOff ? allDown || allUp : wantDown ? allDown : handle <= 0.01 ? allUp : true;
    this.disagreeT = agree ? 0 : this.disagreeT + dt;
    this.publish(moving, this.disagreeT > this.disagreeS, handleLock, wantDown);
  }

  private combineSquat(): boolean {
    const legs = this.squatLegs.length ? this.squatLegs : this.legs;
    const all = (this.cfg.squat?.mode ?? 'any') === 'all';
    for (const l of legs) {
      if (all && !l.sqState) return false;
      if (!all && l.sqState) return true;
    }
    return all;
  }

  private publish(moving: number, disagree: boolean, handleLock = false, handleDown = true): void {
    const v = this.vars;
    const lampsOn = this.lightPower();
    const test = lampsOn && this.lampTest();
    let allDown = true;
    let allUp = true;
    for (const l of this.legs) {
      if (l.pos < 1 - EPS) allDown = false;
      if (l.pos > EPS) allUp = false;
    }
    // ---- horn
    let horn = false;
    if (this.retractable && !allDown) {
      for (const r of this.hornRules) {
        const c = r.when();
        if (!c) r.silenced = false;
        else if (!(r.silenceable && r.silenced)) horn = true;
      }
    } else {
      for (const r of this.hornRules) r.silenced = false;
    }
    let hornCondition = false;
    if (this.retractable && !allDown) for (const r of this.hornRules) if (r.when()) hornCondition = true;
    let unsafe = false;
    for (const l of this.legs) {
      v.set(l.posVar, this.retractable ? l.pos : 1);
      v.set(l.oSquat, l.sqState ? 1 : 0);
      const downLocked = l.pos >= 1 - EPS;
      const upLocked = l.pos <= EPS;
      const inAgreement = handleDown ? downLocked : upLocked;
      const red = this.retractable && (!inAgreement || (hornCondition && !downLocked) || disagree);
      if (red) unsafe = true;
      v.set(l.oGreen, lampsOn && (test || (downLocked && this.retractable)) ? 1 : 0);
      v.set(l.oRed, lampsOn && (test || red) ? 1 : 0);
    }
    v.set('gear.air_ground', this.onGround ? 1 : 0);
    v.set('gear.down_locked', allDown ? 1 : 0);
    v.set('gear.up_locked', allUp ? 1 : 0);
    v.set('gear.transit', moving);
    v.set('gear.moving', moving);
    v.set('gear.doors', this.doors);
    v.set('gear.handle_down', handleDown ? 1 : 0);
    v.set('gear.handle_lock', handleLock ? 1 : 0);
    v.set('gear.disagree', disagree ? 1 : 0);
    v.set('gear.unsafe', unsafe ? 1 : 0);
    v.set('gear.blowdown_used', this.blowdownUsed ? 1 : 0);
    v.set('gear.horn', horn ? 1 : 0);
    v.set(ALERT.gearWarning, horn ? 1 : 0);
    if (horn !== this.hornOn) {
      this.hornOn = horn;
      this.audio?.tone(this.cfg.horn?.tone ?? 'gear_horn', horn);
    }
  }
}

function clampStep(d: number, s: number): number {
  return d > s ? s : d < -s ? -s : d;
}
