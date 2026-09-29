/**
 * Altitude alerting (preselect alerter) and minimums alerting.
 *
 * AltitudeAlert state (`alt.alert`): 0 idle, 1 approaching (inside
 * `approachFt`, outside `captureFt`), 2 captured (inside `captureFt`),
 * 3 deviation (left `deviationFt` after having captured).
 *   Garmin (G1000/G3000 PG): 1000 ft approach tone + 5 s flash, 200 ft
 *     capture flash, ±200 ft deviation: tone + flashing yellow.
 *   KAP 140 (Pilot's Guide 006-18034): ALERT lamp on 1000 ft before, off
 *     200 ft before, momentary on reaching; flashing after leaving the 200 ft
 *     band (until 1000 ft away); 5 short tones at 1000 ft approaching and at
 *     200 ft departing.
 *   737NG (SmartCockpit 737 Systems Review "Altitude alerting"): white box
 *     within 750 ft, removed at 200 ft; deviation > 200 ft: momentary tone
 *     and flashing amber box; inhibited with flaps ≥ 25 or G/S captured.
 * Selecting a new altitude silently re-initialises (idle).
 * Aural: `tone` (C-chord, played through AudioApi.play) on the events
 * listed in `toneOn`; optional `voice` callouts ("ALTITUDE",
 * "LEAVING ALTITUDE").
 *
 * Vars written: alt.alert, alt.alert_flash (1 while the visual alert should
 * flash), alt.alert_light (lamp state incl. flashing phase for
 * incandescent ALERT lamps).
 *
 * MinimumsMonitor: baro (MDA) or radio (DH) minimums from
 * `ap.mins{side}_ft` / `ap.mins{side}_is_ra`. Arms when more than
 * `armAboveFt` above the minimums, "APPROACHING MINIMUMS" (optional) at
 * minimums + `approachingFt`, "MINIMUMS" at minimums; re-arms when
 * climbing `resetAboveFt` above. Vars: alert.minimums (1 at/below),
 * alert.mins_approaching.
 */
import type { Subsystem } from '../../aircraft/types';
import type { SimVars } from '../../core/SimVars';
import type { AudioApi } from '../../core/SimContext';
import { ADC, AP } from '../../core/vars';
import { compileCondition, type Binding } from '../util/binding';
import type { BlockEnv } from '../autopilot/lib';
import { SENSOR_VARS } from '../sensors/vars';

export interface AltitudeAlertConfig {
  approachFt?: number;
  captureFt?: number;
  deviationFt?: number;
  selectedVar?: string;
  altVar?: string;
  power?: Binding;
  inhibit?: Binding;
  /** Events that sound the tone. Default ['approach', 'deviation']. */
  toneOn?: ('approach' | 'capture' | 'deviation')[];
  tone?: string;
  voice?: { approach?: string; deviation?: string };
  flashS?: number;
}

/** Garmin G1000/G3000/G5000 alerter. */
export const ALT_ALERT_GFC700: AltitudeAlertConfig = { approachFt: 1000, captureFt: 200, deviationFt: 200, toneOn: ['approach', 'deviation'] };
/** Bendix/King KAP 140 alerter. */
export const ALT_ALERT_KAP140: AltitudeAlertConfig = { approachFt: 1000, captureFt: 200, deviationFt: 200, toneOn: ['approach', 'deviation'] };
/** Boeing 737NG alerter (tone on deviation only). */
export const ALT_ALERT_737NG: AltitudeAlertConfig = { approachFt: 750, captureFt: 200, deviationFt: 200, toneOn: ['deviation'] };

export class AltitudeAlert implements Subsystem {
  readonly name = 'altitude_alert';
  state = 0;
  private readonly vars: SimVars;
  private readonly audio: AudioApi | undefined;
  private readonly cfg: AltitudeAlertConfig;
  private readonly power: () => boolean;
  private readonly inhibit: () => boolean;
  private readonly selVar: string;
  private readonly altVar: string;
  private prevSel = NaN;
  private captured = false;
  private flashT = 0;
  private blink = 0;
  private readonly tones: { approach: boolean; capture: boolean; deviation: boolean };

  constructor(env: BlockEnv, cfg: AltitudeAlertConfig = ALT_ALERT_GFC700) {
    this.vars = env.vars;
    this.audio = env.audio;
    this.cfg = cfg;
    this.power = compileCondition(env.vars, cfg.power, true);
    this.inhibit = compileCondition(env.vars, cfg.inhibit, false);
    this.selVar = cfg.selectedVar ?? AP.selAltitude;
    this.altVar = cfg.altVar ?? ADC.baroAlt(1);
    const t = cfg.toneOn ?? ['approach', 'deviation'];
    this.tones = { approach: t.includes('approach'), capture: t.includes('capture'), deviation: t.includes('deviation') };
  }

  reset(): void {
    this.prevSel = NaN;
    this.captured = false;
    this.state = 0;
  }

  update(dt: number): void {
    const v = this.vars;
    const c = this.cfg;
    const sel = v.get(this.selVar);
    const alt = v.get(this.altVar);
    const err = Math.abs(alt - sel);
    const approachFt = c.approachFt ?? 1000;
    const captureFt = c.captureFt ?? 200;
    const devFt = c.deviationFt ?? 200;
    if (sel !== this.prevSel) {
      // New selection: re-initialise silently (already inside the band counts as captured).
      this.prevSel = sel;
      this.captured = err <= captureFt;
      this.state = this.captured ? 2 : 0;
      this.flashT = 0;
    }
    if (!this.power() || this.inhibit()) {
      this.state = 0;
      this.flashT = 0;
      this.out(dt);
      return;
    }
    let s = this.state;
    if (this.captured) {
      if (err > devFt) {
        if (s !== 3) this.event('deviation');
        s = 3;
        if (err > approachFt) {
          // Far away again: back to idle (KAP: flashing ends 1000 ft away).
          this.captured = false;
          s = 0;
        }
      } else s = 2;
    } else if (err <= captureFt) {
      this.captured = true;
      if (s !== 2) this.event('capture');
      s = 2;
    } else if (err <= approachFt) {
      if (s !== 1) this.event('approach');
      s = 1;
    } else s = 0;
    this.state = s;
    this.out(dt);
  }

  private event(kind: 'approach' | 'capture' | 'deviation'): void {
    this.flashT = kind === 'deviation' ? Infinity : this.cfg.flashS ?? 5;
    if (this.tones[kind]) this.audio?.play(this.cfg.tone ?? 'alt_alert');
    const voice = kind === 'approach' ? this.cfg.voice?.approach : kind === 'deviation' ? this.cfg.voice?.deviation : undefined;
    if (voice) this.audio?.callout(voice, 3);
  }

  private out(dt: number): void {
    const v = this.vars;
    if (this.flashT > 0 && this.state !== 3) this.flashT = Math.max(0, this.flashT - dt);
    if (this.state !== 3 && this.flashT === Infinity) this.flashT = 0;
    const flashing = this.state !== 0 && this.flashT > 0;
    this.blink = (this.blink + dt) % 1;
    v.set('alt.alert', this.state);
    v.set('alt.alert_flash', flashing ? 1 : 0);
    const lamp = this.state === 1 ? 1 : this.state === 3 ? (this.blink < 0.5 ? 1 : 0) : 0;
    v.set('alt.alert_light', lamp);
  }
}

export interface MinimumsConfig {
  side?: number;
  raVar?: string;
  baroVar?: string;
  armAboveFt?: number;
  approachingFt?: number;
  resetAboveFt?: number;
  /** Callout texts; '' disables. Defaults 'MINIMUMS' / '' (approaching off). */
  minimumsCallout?: string;
  approachingCallout?: string;
  power?: Binding;
}

export class MinimumsMonitor implements Subsystem {
  readonly name = 'minimums';
  reached = false;
  private armed = false;
  private approachedDone = false;
  private readonly vars: SimVars;
  private readonly audio: AudioApi | undefined;
  private readonly cfg: MinimumsConfig;
  private readonly power: () => boolean;
  private readonly minVar: string;
  private readonly isRaVar: string;
  private readonly raVar: string;
  private readonly baroVar: string;

  constructor(env: BlockEnv, cfg: MinimumsConfig = {}) {
    this.vars = env.vars;
    this.audio = env.audio;
    this.cfg = cfg;
    this.power = compileCondition(env.vars, cfg.power, true);
    const side = cfg.side ?? 1;
    this.minVar = AP.minimums(side);
    this.isRaVar = AP.minimumsIsRadio(side);
    this.raVar = cfg.raVar ?? SENSOR_VARS.raAlt(side);
    this.baroVar = cfg.baroVar ?? ADC.baroAlt(side);
  }

  reset(): void {
    this.armed = false;
    this.reached = false;
    this.approachedDone = false;
  }

  /** Height above the minimums (ft) with the configured reference. */
  heightAbove(): number {
    const v = this.vars;
    const mins = v.get(this.minVar);
    const h = v.get(this.isRaVar) !== 0 ? v.get(this.raVar) : v.get(this.baroVar);
    return h - mins;
  }

  update(_dt: number): void {
    const v = this.vars;
    const c = this.cfg;
    const mins = v.get(this.minVar);
    if (!this.power() || !(mins > 0)) {
      this.armed = false;
      this.reached = false;
      v.set('alert.minimums', 0);
      v.set('alert.mins_approaching', 0);
      return;
    }
    const above = this.heightAbove();
    if (above > (c.resetAboveFt ?? 50) && this.reached) {
      this.reached = false;
    }
    if (above > (c.armAboveFt ?? 150)) {
      this.armed = true;
      this.approachedDone = false;
    }
    const appFt = c.approachingFt ?? 100;
    let approaching = false;
    if (this.armed && !this.reached && above <= appFt && above > 0) {
      approaching = true;
      if (!this.approachedDone) {
        this.approachedDone = true;
        const t = c.approachingCallout ?? '';
        if (t) this.audio?.callout(t, 6);
      }
    }
    if (this.armed && above <= 0) {
      this.armed = false;
      this.reached = true;
      const t = c.minimumsCallout ?? 'MINIMUMS';
      if (t) this.audio?.callout(t, 7);
    }
    v.set('alert.minimums', this.reached ? 1 : 0);
    v.set('alert.mins_approaching', approaching ? 1 : 0);
  }
}
