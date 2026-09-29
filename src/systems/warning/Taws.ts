/**
 * TAWS / EGPWS: basic GPWS modes 1–6, forward-looking terrain alerting
 * (FLTA), premature descent alert (PDA), altitude/minimums callouts.
 *
 * Class A (EGPWS: G650/G800/Global/737 — Honeywell MK V/VII/VIII family):
 *   modes 1, 2A/2B, 3, 4A/4B/4C, 5, 6 (callouts, minimums, bank angle),
 *   FLTA, PDA. Envelopes in `egpwsEnvelopes.ts` (cited there).
 * Class B (TAWS-B: Garmin G1000/G3000 small aircraft/light jets,
 *   TSO-C151c §3.4): FLTA, PDA, mode 1 (excessive descent), mode 3
 *   (negative climb after takeoff) and the "FIVE HUNDRED" callout; heights
 *   from the radio altimeter when fitted, otherwise GPS altitude minus the
 *   terrain database.
 * FLTA (TSO-C151c §3.1.1): the flight path is projected along the GPS track
 *   at the current ground speed and vertical speed; any terrain sample
 *   closer than the required terrain clearance (Table 3.1.1: enroute
 *   700/500, terminal 350/300, approach 150/100, departure 100 ft; phase from
 *   the distance to the nearest airport) gives CAUTION TERRAIN within
 *   `cautionS` (60 s) and TERRAIN AHEAD PULL UP within `warningS` (30 s)
 *   (Honeywell EGPWS look-ahead: caution ~40–60 s, warning ~20–30 s).
 * PDA (EST implementation of the TSO requirement): within 10 nm of the
 *   nearest runway, descending, gear down or flaps extended, and more than
 *   50 % below a 3° path to the runway (and below 1000 ft above it):
 *   TOO LOW TERRAIN.
 *
 * Aural priority (high -> low; MK V/VII pilot's guide "Aural Message
 * Priority"): PULL UP, TERRAIN, MINIMUMS, CAUTION TERRAIN, TOO LOW
 * TERRAIN, altitude callouts, TOO LOW GEAR/FLAPS, SINK RATE, DON'T SINK,
 * GLIDESLOPE, BANK ANGLE — sent with decreasing `priority` to
 * AudioApi.callout (which serializes them).
 *
 * Inhibits: `inhibits.gpws` (GPWS/GND PROX INHIBIT: modes 1–5),
 * `inhibits.terrain` (TERR INHIBIT: FLTA/PDA), `inhibits.flapOverride`
 * (flaps treated as landing), `inhibits.gearOverride`, glideslope cancel
 * (event `taws.gs_cancel`, valid below 2000 ft RA), `inhibits.steepApproach`
 * (mode 1 biased).
 * Self test: event `taws.test` on the ground (both lamps 6 s + voices).
 *
 * Vars written: alert.taws_warning, alert.taws_caution, taws.mode1 (0/1 sink
 * rate/2 pull up), taws.mode2 (0/1 terrain/2 pull up), taws.mode3,
 * taws.mode4 (0/1 gear/2 flaps/3 terrain), taws.mode5 (0/1/2), taws.bank,
 * taws.flta (0/1 caution/2 warning), taws.pda, taws.gs_light (BELOW G/S),
 * taws.gs_cancel, string taws.alert (highest active alert text), string
 * taws.callout (last callout), taws.inop, taws.terr_inop, taws.test,
 * taws.height_ft (height used), taws.closure_fpm + MinimumsMonitor vars.
 * Failure: taws (computer fault: taws.inop, everything silent).
 */
import type { Subsystem } from '../../aircraft/types';
import type { FailureDef } from '../failures/FailureManager';
import type { SimVars } from '../../core/SimVars';
import type { AudioApi } from '../../core/SimContext';
import type { WorldQuery } from '../../world/types';
import type { NavDatabase, Airport } from '../../nav/types';
import { ADC, ALERT, AP, GPS, NAV } from '../../core/vars';
import { destinationPoint, distanceNm } from '../../core/geo';
import { compileCondition, type Binding } from '../util/binding';
import { failVar } from '../util/ids';
import { RateFilter, listen, type BlockEnv } from '../autopilot/lib';
import { SENSOR_VARS } from '../sensors/vars';
import { MinimumsMonitor, type MinimumsConfig } from './AltitudeAlert';
import {
  MODE4A_TURBOFAN,
  MODE4B_TURBOFAN,
  bankAngleLimit,
  fltaRequiredClearance,
  limitClosureRate,
  mode1GsBias,
  mode1PullUp,
  mode1SinkRate,
  mode2A,
  mode2B,
  mode3AllowedLoss,
  mode4,
  mode5,
  type Mode4Envelope,
} from './egpwsEnvelopes';

const M_TO_FT = 1 / 0.3048;

export interface TawsVoices {
  pullUp: string;
  sinkRate: string;
  terrain: string;
  dontSink: string;
  tooLowGear: string;
  tooLowFlaps: string;
  tooLowTerrain: string;
  glideslope: string;
  bankAngle: string;
  cautionTerrain: string;
  terrainAheadPullUp: string;
}

export const TAWS_VOICES_HONEYWELL: TawsVoices = {
  pullUp: 'PULL UP',
  sinkRate: 'SINK RATE',
  terrain: 'TERRAIN TERRAIN',
  dontSink: "DON'T SINK",
  tooLowGear: 'TOO LOW GEAR',
  tooLowFlaps: 'TOO LOW FLAPS',
  tooLowTerrain: 'TOO LOW TERRAIN',
  glideslope: 'GLIDESLOPE',
  bankAngle: 'BANK ANGLE',
  cautionTerrain: 'CAUTION TERRAIN',
  terrainAheadPullUp: 'TERRAIN AHEAD PULL UP',
};

/** Callout words by height. */
export const CALLOUT_WORDS: Record<number, string> = {
  2500: 'TWENTY FIVE HUNDRED',
  2000: 'TWO THOUSAND',
  1000: 'ONE THOUSAND',
  500: 'FIVE HUNDRED',
  400: 'FOUR HUNDRED',
  300: 'THREE HUNDRED',
  200: 'TWO HUNDRED',
  100: 'ONE HUNDRED',
  50: 'FIFTY',
  40: 'FORTY',
  30: 'THIRTY',
  20: 'TWENTY',
  10: 'TEN',
  5: 'FIVE',
};

/** Boeing 737NG / typical EGPWS callout option. */
export const CALLOUTS_737NG = [2500, 1000, 500, 100, 50, 40, 30, 20, 10];
/** Garmin TAWS-B: "FIVE HUNDRED" only. */
export const CALLOUTS_TAWS_B = [500];

export interface TawsConfig {
  class?: 'A' | 'B';
  power?: Binding;
  raVar?: string;
  raValid?: Binding;
  baroAltVar?: string;
  vsVar?: string;
  iasVar?: string;
  bankVar?: string;
  /** Glideslope deviation var (-1..1 full scale, + = fly up) and validity. */
  gsDevVar?: string;
  gsValid?: Binding;
  backCourse?: Binding;
  apEngaged?: Binding;
  gearDown?: Binding;
  flapsLanding?: Binding;
  flapsDown?: Binding;
  onGround?: Binding;
  mode2Airspeeds?: [number, number];
  mode4?: { a: Mode4Envelope; b: Mode4Envelope };
  callouts?: { heights: number[]; words?: Record<number, string>; smart500?: boolean } | false;
  minimums?: MinimumsConfig | false;
  bankAngle?: boolean;
  flta?: { enabled?: boolean; cautionS?: number; warningS?: number; samples?: number; terminalNm?: number; approachNm?: number } | false;
  pda?: boolean;
  inhibits?: { gpws?: Binding; terrain?: Binding; flapOverride?: Binding; gearOverride?: Binding; steepApproach?: Binding };
  voices?: Partial<TawsVoices>;
}

export class Taws implements Subsystem {
  readonly name = 'taws';
  readonly minimums: MinimumsMonitor | null;
  /** Current alert text (highest priority), '' when none. */
  alert = '';
  private readonly vars: SimVars;
  private readonly audio: AudioApi | undefined;
  private readonly world: WorldQuery | undefined;
  private readonly nav: NavDatabase | undefined;
  private readonly cfg: TawsConfig;
  private readonly classA: boolean;
  private readonly voices: TawsVoices;
  private readonly b: Record<'power' | 'raValid' | 'gsValid' | 'bc' | 'ap' | 'gear' | 'flapsLdg' | 'flapsDn' | 'ground' | 'inhGpws' | 'inhTerr' | 'flapOvr' | 'gearOvr' | 'steep', () => boolean>;
  private readonly raVar: string;
  private readonly baroVar: string;
  private readonly vsVar: string;
  private readonly iasVar: string;
  private readonly bankVar: string;
  private readonly gsDevVar: string;
  private readonly raRate = new RateFilter(1.0);
  private readonly callouts: number[];
  private readonly calloutDone: boolean[];
  private readonly calloutWords: Record<number, string>;
  private readonly offs: (() => void)[] = [];
  private readonly pt = { lat: 0, lon: 0 };
  private evalAcc = 0;
  private fltaAcc = 0;
  private airportAcc = 999;
  private nearestNm = 999;
  private nearestRwyNm = 999;
  private nearestElevFt = 0;
  private airborneT = 0;
  private wasGround = true;
  private takeoffPhase = false;
  private peakBaro = 0;
  private peakRa = 0;
  private gsCancelled = false;
  private testT = 0;
  private prevHeight = NaN;
  private readonly lastSpokenT = new Float64Array(12).fill(1e9);
  private readonly as1: number;
  private readonly as2: number;
  private readonly env4: { a: Mode4Envelope; b: Mode4Envelope };
  private readonly fltaCfg: { enabled?: boolean; cautionS?: number; warningS?: number; samples?: number; terminalNm?: number; approachNm?: number } | null;
  // latched results
  private m1 = 0;
  private m2 = 0;
  private m2Preface = 0;
  private m3 = false;
  private m4 = 0;
  private m5 = 0;
  private bank = false;
  private flta = 0;
  private pda = false;
  private closure = 0;
  private readonly fTaws = failVar('taws');

  constructor(env: BlockEnv, cfg: TawsConfig = {}) {
    const v = env.vars;
    this.vars = v;
    this.audio = env.audio;
    this.world = env.world;
    this.nav = env.nav;
    this.cfg = cfg;
    this.classA = (cfg.class ?? 'A') === 'A';
    this.voices = { ...TAWS_VOICES_HONEYWELL, ...cfg.voices };
    const c = (bnd: Binding | undefined, d: boolean | string): (() => boolean) => compileCondition(v, bnd ?? d, typeof d === 'boolean' ? d : false);
    const inh = cfg.inhibits ?? {};
    this.b = {
      power: c(cfg.power, true),
      raValid: c(cfg.raValid, SENSOR_VARS.raValid(1)),
      gsValid: c(cfg.gsValid, `${NAV.gsValid(1)} && ${NAV.isLoc(1)}`),
      bc: c(cfg.backCourse, NAV.backCourse(1)),
      ap: c(cfg.apEngaged, AP.engaged),
      gear: c(cfg.gearDown, 'gear.down_locked'),
      flapsLdg: c(cfg.flapsLanding, 'surf.flaps_deg >= 25'),
      flapsDn: c(cfg.flapsDown, 'surf.flaps_deg >= 1'),
      ground: c(cfg.onGround, 'gear.air_ground'),
      inhGpws: c(inh.gpws, false),
      inhTerr: c(inh.terrain, false),
      flapOvr: c(inh.flapOverride, false),
      gearOvr: c(inh.gearOverride, false),
      steep: c(inh.steepApproach, false),
    };
    this.as1 = cfg.mode2Airspeeds?.[0] ?? 220;
    this.as2 = cfg.mode2Airspeeds?.[1] ?? 310;
    this.env4 = cfg.mode4 ?? { a: MODE4A_TURBOFAN, b: MODE4B_TURBOFAN };
    this.fltaCfg = cfg.flta === false ? null : cfg.flta ?? {};
    this.raVar = cfg.raVar ?? SENSOR_VARS.raAlt(1);
    this.baroVar = cfg.baroAltVar ?? ADC.baroAlt(1);
    this.vsVar = cfg.vsVar ?? ADC.vs(1);
    this.iasVar = cfg.iasVar ?? ADC.ias(1);
    this.bankVar = cfg.bankVar ?? ADC.bank(1);
    this.gsDevVar = cfg.gsDevVar ?? NAV.gsDev(1);
    const co = cfg.callouts === false ? [] : cfg.callouts?.heights ?? (this.classA ? CALLOUTS_737NG : CALLOUTS_TAWS_B);
    this.callouts = [...co].sort((a, b) => b - a);
    this.calloutDone = this.callouts.map(() => true);
    this.calloutWords = { ...CALLOUT_WORDS, ...(cfg.callouts ? cfg.callouts.words : undefined) };
    this.minimums = cfg.minimums === false ? null : new MinimumsMonitor(env, cfg.minimums ?? {});
    this.wasGround = this.b.ground();
    listen(env.events, this.offs, 'taws.gs_cancel', () => {
      if (this.m5 > 0 || this.vars.get(this.raVar) < 2000) this.gsCancelled = true;
    });
    listen(env.events, this.offs, 'taws.test', () => {
      if (this.b.ground() && this.b.power()) {
        this.testT = 6;
        this.say(this.voices.glideslope, 3);
        this.say(this.voices.pullUp, 10);
      }
    });
  }

  failures(): FailureDef[] {
    return [{ id: 'taws', name: 'TAWS/EGPWS computer', category: 'warning', description: 'TAWS inoperative: no GPWS/terrain alerts or callouts (TAWS FAIL / GPWS INOP).' }];
  }

  reset(): void {
    this.raRate.reset();
    this.m1 = this.m2 = this.m2Preface = this.m4 = this.m5 = this.flta = 0;
    this.m3 = this.bank = this.pda = false;
    this.wasGround = this.b.ground();
    this.calloutDone.fill(true);
    this.minimums?.reset();
    this.prevHeight = NaN;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  update(dt: number): void {
    const v = this.vars;
    const b = this.b;
    const powered = b.power() && v.get(this.fTaws) === 0;
    if (!powered) {
      this.clear();
      v.set('taws.inop', 1);
      return;
    }
    const ground = b.ground();
    const raValid = b.raValid();
    let height = raValid ? v.get(this.raVar) : NaN;
    if (!raValid && this.world && v.get(GPS.valid) !== 0) {
      height = v.get(GPS.alt) - this.world.elevationAt(v.get(GPS.lat), v.get(GPS.lon)) * M_TO_FT;
    }
    const heightOk = Number.isFinite(height);
    const baro = v.get(this.baroVar);
    const vs = v.get(this.vsVar);
    const ias = v.get(this.iasVar);
    const gearDown = b.gear() || b.gearOvr();
    const flapsLdg = b.flapsLdg() || b.flapOvr();
    const flapsDn = b.flapsDn() || b.flapOvr();
    const gsValid = b.gsValid() && !b.bc();
    const dotsBelow = gsValid ? 2 * v.get(this.gsDevVar) : NaN;

    // ---- takeoff phase bookkeeping (modes 3, 4C, 2B timer)
    if (!ground && this.wasGround) {
      this.airborneT = 0;
      this.takeoffPhase = true;
      this.peakBaro = baro;
      this.peakRa = 0;
      this.calloutDone.fill(true);
      this.gsCancelled = false;
    }
    if (ground) {
      this.takeoffPhase = false;
      this.gsCancelled = false;
    } else this.airborneT += dt;
    this.wasGround = ground;
    if (this.takeoffPhase && heightOk && (height > 1500 || (gearDown && flapsLdg && this.airborneT > 60))) this.takeoffPhase = false;
    if (heightOk && height > 2000) this.gsCancelled = false;

    // ---- closure rate
    const raRate = heightOk ? this.raRate.update(height, dt) * 60 : 0;
    this.closure = limitClosureRate(-raRate, gsValid && Math.abs(dotsBelow) < 2, gearDown, flapsDn);

    // ---- mode 6 callouts (every update: 10 ft steps must not be missed)
    if (heightOk && !ground) this.altitudeCallouts(height, gsValid, dotsBelow);
    this.prevHeight = height;
    this.minimums?.update(dt);

    // ---- basic modes at 10 Hz
    this.evalAcc += dt;
    if (this.evalAcc >= 0.1) {
      this.evalAcc = 0;
      const gpwsOn = !b.inhGpws() && !ground && heightOk;
      // Mode 1
      let bias = 0;
      if (b.steep()) bias = 500;
      else if (b.flapOvr()) bias = 300;
      else if (Number.isFinite(dotsBelow)) bias = mode1GsBias(dotsBelow, height);
      this.m1 = gpwsOn ? (mode1PullUp(height, vs, b.steep() ? 200 : 0) ? 2 : mode1SinkRate(height, vs, bias) ? 1 : 0) : 0;
      // Mode 2 (class A)
      this.m2 = 0;
      if (gpwsOn && this.classA) {
        const bMode = flapsLdg || (gsValid && Math.abs(dotsBelow) < 2) || (this.takeoffPhase && this.airborneT < 60);
        const hit = bMode ? mode2B(height, this.closure, flapsLdg, vs) : mode2A(height, this.closure, ias, this.as1, this.as2);
        if (hit) {
          this.m2Preface += 0.1;
          // "TERRAIN TERRAIN" first, then PULL UP (gear up or not landing config) after ~1 s.
          const landing = gearDown && flapsLdg;
          this.m2 = this.m2Preface > 1.2 && !(bMode && landing) ? 2 : 1;
        } else this.m2Preface = 0;
      }
      // Mode 3
      this.m3 = false;
      if (gpwsOn && this.takeoffPhase) {
        if (baro > this.peakBaro) this.peakBaro = baro;
        const loss = this.peakBaro - baro;
        this.m3 = height > 30 && height < 1500 && vs < 0 && loss > mode3AllowedLoss(height) && !(gearDown && flapsLdg);
      }
      // Mode 4 (class A)
      this.m4 = 0;
      if (gpwsOn && this.classA) {
        if (this.takeoffPhase) {
          if (height > this.peakRa) this.peakRa = height;
          // 4C: terrain clearance floor = 75 % of the highest RA since takeoff (EST from the MK V "TCF" description).
          if (!(gearDown && flapsLdg) && height > 30 && height < 1000 && height < 0.75 * this.peakRa && vs < 0) this.m4 = 3;
        } else {
          const env4 = this.env4;
          if (!gearDown) {
            const r = mode4(height, ias, env4.a);
            this.m4 = r === 1 ? 1 : r === 2 ? 3 : 0;
          } else if (!flapsLdg) {
            const r = mode4(height, ias, env4.b);
            this.m4 = r === 1 ? 2 : r === 2 ? 3 : 0;
          }
        }
      }
      // Mode 5 (class A)
      this.m5 = 0;
      if (gpwsOn && this.classA && gearDown && gsValid && !this.gsCancelled) this.m5 = mode5(height, dotsBelow);
      // Bank angle
      this.bank = false;
      if ((this.cfg.bankAngle ?? this.classA) && !ground) {
        const lim = bankAngleLimit(height, b.ap(), raValid);
        this.bank = Math.abs(v.get(this.bankVar)) > lim;
      }
    }

    // ---- FLTA / PDA at 2 Hz
    this.fltaAcc += dt;
    this.airportAcc += dt;
    const terrOk = !!this.world && v.get(GPS.valid) !== 0 && !b.inhTerr();
    v.set('taws.terr_inop', terrOk || b.inhTerr() ? 0 : 1);
    if (this.fltaAcc >= 0.5) {
      this.fltaAcc = 0;
      if (terrOk && !ground) this.forwardLooking(vs);
      else {
        this.flta = 0;
        this.pda = false;
      }
    }

    // ---- outputs, voices
    this.voicesAndLamps(dt, height);
  }

  private altitudeCallouts(height: number, gsValid: boolean, dotsBelow: number): void {
    const prev = this.prevHeight;
    for (let i = 0; i < this.callouts.length; i++) {
      const h = this.callouts[i];
      // (Re-)arm once clearly above the callout height, except in the takeoff climb.
      if (this.calloutDone[i] && !this.takeoffPhase && height > h + Math.max(10, 0.1 * h)) this.calloutDone[i] = false;
      if (!Number.isFinite(prev)) continue;
      if (!this.calloutDone[i] && prev > h && height <= h) {
        this.calloutDone[i] = true;
        // Smart 500: suppressed on a precision approach within 2 dots.
        if (h === 500 && this.cfg.callouts && this.cfg.callouts.smart500 && gsValid && Math.abs(dotsBelow) <= 2) continue;
        const w = this.calloutWords[h];
        if (w) this.say(w, 5);
      }
    }
  }

  private forwardLooking(vs: number): void {
    const v = this.vars;
    const w = this.world!;
    const f = this.fltaCfg;
    const lat = v.get(GPS.lat);
    const lon = v.get(GPS.lon);
    const altFt = v.get(GPS.alt);
    const gs = v.get(GPS.gs);
    const trk = v.get(GPS.trackTrue);
    // Nearest airport every 5 s (the only allocating call, 0.2 Hz).
    if (this.airportAcc >= 5 && this.nav && this.nav.ready) {
      this.airportAcc = 0;
      const list = this.nav.airportsNear(lat, lon, 30, 1);
      this.nearestNm = 999;
      this.nearestRwyNm = 999;
      if (list.length > 0) this.nearestAirport(list[0], lat, lon);
    }
    // FLTA
    this.flta = 0;
    if (f && (f.enabled ?? true) && gs > 30) {
      const phase = this.airborneT < 120 && this.nearestNm < 5 && vs > 0 ? 'departure' : this.nearestNm < (f.approachNm ?? 5) ? 'approach' : this.nearestNm < (f.terminalNm ?? 15) ? 'terminal' : 'enroute';
      const descending = vs < -500;
      const rtc = fltaRequiredClearance(phase, descending);
      const cautionS = f.cautionS ?? 60;
      const warningS = f.warningS ?? 30;
      const n = f.samples ?? 12;
      // Landing: no FLTA within 1 nm of the runway below 400 ft (visual segment, TSO note 3).
      const landing = this.nearestRwyNm < 1.5 && altFt - this.nearestElevFt < 400;
      if (!landing) {
        const vsProj = vs < 0 ? vs : 0;
        for (let i = 1; i <= n; i++) {
          const t = (cautionS * i) / n;
          destinationPoint(lat, lon, trk, (gs * t) / 3600, this.pt);
          const terr = w.elevationAt(this.pt.lat, this.pt.lon) * M_TO_FT;
          const proj = altFt + (vsProj * t) / 60;
          if (proj - terr < rtc) {
            const lvl = t <= warningS && proj - terr < rtc * 0.5 ? 2 : 1;
            if (lvl > this.flta) this.flta = lvl;
          }
        }
      }
    }
    // PDA
    this.pda = false;
    if (this.cfg.pda ?? true) {
      const h = altFt - this.nearestElevFt;
      const d = this.nearestRwyNm;
      const cfgOk = this.b.gear() || this.b.flapsDn();
      if (d > 1 && d < 10 && vs < -300 && cfgOk && h < 1000 && h < 0.5 * d * 318.4) this.pda = true;
    }
  }

  private nearestAirport(a: Airport, lat: number, lon: number): void {
    this.nearestNm = distanceNm(lat, lon, a.lat, a.lon);
    this.nearestElevFt = a.elevationFt;
    for (const r of a.runways) {
      const d = distanceNm(lat, lon, r.thresholdLat ?? r.lat, r.thresholdLon ?? r.lon);
      if (d < this.nearestRwyNm) {
        this.nearestRwyNm = d;
        this.nearestElevFt = r.elevationFt;
      }
    }
  }

  private voicesAndLamps(dt: number, height: number): void {
    const v = this.vars;
    const vc = this.voices;
    const t = this.lastSpokenT;
    for (let i = 0; i < t.length; i++) t[i] += dt;
    let text = '';
    const warn = this.m1 === 2 || this.m2 === 2 || this.flta === 2;
    // Highest priority first; each alert repeats at its own interval.
    if (this.m1 === 2 || this.m2 === 2) {
      text = vc.pullUp;
      this.repeat(0, vc.pullUp, 10, 1.5);
    } else if (this.flta === 2) {
      text = vc.terrainAheadPullUp;
      this.repeat(1, vc.terrainAheadPullUp, 10, 2.5);
    } else if (this.m2 === 1) {
      text = vc.terrain;
      this.repeat(2, vc.terrain, 9, 3);
    } else if (this.flta === 1) {
      text = vc.cautionTerrain;
      this.repeat(3, vc.cautionTerrain, 7, 7);
    } else if (this.m4 === 3 || this.pda) {
      text = vc.tooLowTerrain;
      this.repeat(4, vc.tooLowTerrain, 6, 4);
    } else if (this.m4 === 1) {
      text = vc.tooLowGear;
      this.repeat(5, vc.tooLowGear, 5, 4);
    } else if (this.m4 === 2) {
      text = vc.tooLowFlaps;
      this.repeat(6, vc.tooLowFlaps, 5, 4);
    } else if (this.m1 === 1) {
      text = vc.sinkRate;
      this.repeat(7, vc.sinkRate, 4, 3);
    } else if (this.m3) {
      text = vc.dontSink;
      this.repeat(8, vc.dontSink, 4, 3);
    } else if (this.m5 > 0) {
      text = vc.glideslope;
      this.repeat(9, vc.glideslope, 3, this.m5 === 2 ? 1.5 : 3);
    } else if (this.bank) {
      text = vc.bankAngle;
      this.repeat(10, vc.bankAngle, 2, 3);
    }
    if (!text) for (let i = 0; i < t.length; i++) if (t[i] < 1e8) t[i] = 1e9; // allow the next alert to speak at once
    this.alert = text;
    if (this.testT > 0) this.testT = Math.max(0, this.testT - dt);
    const test = this.testT > 0;
    const caution = !warn && (text !== '' && text !== vc.glideslope && text !== vc.bankAngle);
    v.set(ALERT.tawsWarning, warn || test ? 1 : 0);
    v.set(ALERT.tawsCaution, caution || test ? 1 : 0);
    v.set('taws.mode1', this.m1);
    v.set('taws.mode2', this.m2);
    v.set('taws.mode3', this.m3 ? 1 : 0);
    v.set('taws.mode4', this.m4);
    v.set('taws.mode5', this.m5);
    v.set('taws.bank', this.bank ? 1 : 0);
    v.set('taws.flta', this.flta);
    v.set('taws.pda', this.pda ? 1 : 0);
    v.set('taws.gs_light', (this.m5 > 0 && !this.gsCancelled) || test ? 1 : 0);
    v.set('taws.gs_cancel', this.gsCancelled ? 1 : 0);
    v.setString('taws.alert', text);
    v.set('taws.inop', 0);
    v.set('taws.test', test ? 1 : 0);
    v.set('taws.height_ft', Number.isFinite(height) ? height : 0);
    v.set('taws.closure_fpm', this.closure);
  }

  private repeat(slot: number, text: string, priority: number, everyS: number): void {
    if (this.lastSpokenT[slot] >= everyS) {
      this.lastSpokenT[slot] = 0;
      this.say(text, priority);
    }
  }

  private say(text: string, priority: number): void {
    this.audio?.callout(text, priority);
    this.vars.setString('taws.callout', text);
  }

  private clear(): void {
    const v = this.vars;
    this.m1 = this.m2 = this.m4 = this.m5 = this.flta = 0;
    this.m3 = this.bank = this.pda = false;
    v.set(ALERT.tawsWarning, 0);
    v.set(ALERT.tawsCaution, 0);
    v.setString('taws.alert', '');
  }
}
