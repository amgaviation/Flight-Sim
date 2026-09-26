/**
 * Thrust rating computer: N1 limits for each rating (TO, GA, CLB, CRZ, MCT,
 * derates such as TO-1/TO-2/CLB-1/CLB-2) from per-aircraft tables of
 * pressure altitude × temperature, plus assumed-temperature (flex)
 * takeoff reduction.
 *
 * Tables are `Table2D` with x = pressure altitude (ft), y = temperature
 * (°C, OAT/SAT by default) and z[i][j] = N1 (%). The aircraft supplies them
 * from its engine data (AFM/FCOM N1 tables, e.g. 737NG "Takeoff %N1" and
 * "Max Climb %N1" tables in the QRH Performance Inflight chapter).
 *
 * Flex / assumed temperature (FAA AC 25-13 "Reduced and Derated Takeoff
 * Thrust"): when `fadec.assumed_temp_c` is above the current temperature,
 * flex ratings are looked up at the assumed temperature, never below
 * `maxFlexN1Drop` percentage points under the full rating (AC 25-13 limits
 * the reduction to 25 % of thrust; the N1 equivalent depends on the engine,
 * EST default 6 points).
 *
 * Selection: `select(id)`, event `fadec.rating` (payload rating id), or
 * automatic (`auto`): takeoff rating on the ground, climb rating once
 * `auto.climbWhen` is true in the air, go-around rating while
 * `auto.goAroundWhen` is true (approach configuration), cruise when
 * `auto.cruiseWhen` is true.
 *
 * Vars written: string fadec.rating, fadec.n1_limit_pct (selected rating),
 * fadec.n1_<id>_pct for every rating (id lower-cased, non-alphanumerics ->
 * '_': 'TO-1' -> fadec.n1_to_1_pct), fadec.flex_active.
 * Initialised if missing: fadec.assumed_temp_c (-99 = no flex).
 * Events: fadec.rating (string), fadec.assumed_temp (number °C).
 */
import type { Subsystem } from '../../aircraft/types';
import type { SimVars } from '../../core/SimVars';
import type { Table2D } from '../../physics/types';
import { ADC } from '../../core/vars';
import { interp2 } from '../../core/math';
import { compileCondition, type Binding } from '../util/binding';
import { listen, payloadNumber, type BlockEnv } from '../autopilot/lib';
import { SENSOR_VARS } from '../sensors/vars';

export interface ThrustRatingConfig {
  ratings: Record<string, Table2D>;
  /** Initial/manual selection. Default the first rating key. */
  initial?: string;
  altVar?: string;
  tempVar?: string;
  /** Ratings to which the assumed temperature applies. Default every id starting with 'TO'. */
  flexRatings?: string[];
  maxFlexN1Drop?: number;
  auto?: {
    takeoff: string;
    climb: string;
    cruise?: string;
    goAround?: string;
    onGround?: Binding;
    climbWhen?: Binding;
    cruiseWhen?: Binding;
    goAroundWhen?: Binding;
  };
}

/** SimVar-safe key for a rating id: 'TO-1' -> 'to_1'. */
export function ratingKey(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

/** N1-limit var of a rating. */
export function ratingVar(id: string): string {
  return `fadec.n1_${ratingKey(id)}_pct`;
}

export class ThrustRatingComputer implements Subsystem {
  readonly name = 'thrust_rating';
  selected: string;
  private readonly vars: SimVars;
  private readonly cfg: ThrustRatingConfig;
  private readonly ids: string[];
  private readonly outVars: string[];
  private readonly flex: boolean[];
  private readonly altVar: string;
  private readonly tempVar: string;
  private readonly onGround: () => boolean;
  private readonly climbWhen: () => boolean;
  private readonly cruiseWhen: () => boolean;
  private readonly gaWhen: () => boolean;
  private readonly offs: (() => void)[] = [];
  private wasGround = true;

  constructor(env: BlockEnv, cfg: ThrustRatingConfig) {
    const v = env.vars;
    this.vars = v;
    this.cfg = cfg;
    this.ids = Object.keys(cfg.ratings);
    if (this.ids.length === 0) throw new Error('ThrustRatingComputer: no ratings');
    this.outVars = this.ids.map(ratingVar);
    this.flex = this.ids.map((id) => (cfg.flexRatings ? cfg.flexRatings.includes(id) : id.startsWith('TO')));
    this.selected = cfg.initial ?? this.ids[0];
    this.altVar = cfg.altVar ?? SENSOR_VARS.pressAlt(1);
    this.tempVar = cfg.tempVar ?? ADC.sat(1);
    const a = cfg.auto;
    this.onGround = compileCondition(v, a?.onGround ?? 'gear.air_ground', true);
    this.climbWhen = compileCondition(v, a?.climbWhen, false);
    this.cruiseWhen = compileCondition(v, a?.cruiseWhen, false);
    this.gaWhen = compileCondition(v, a?.goAroundWhen, false);
    if (!v.has('fadec.assumed_temp_c')) v.set('fadec.assumed_temp_c', -99);
    listen(env.events, this.offs, 'fadec.rating', (p) => {
      if (typeof p === 'string') this.select(p);
    });
    listen(env.events, this.offs, 'fadec.assumed_temp', (p) => v.set('fadec.assumed_temp_c', payloadNumber(p, -99)));
    v.setString('fadec.rating', this.selected);
  }

  /** Selects a rating by id (ignored if unknown). */
  select(id: string): void {
    if (this.cfg.ratings[id]) {
      this.selected = id;
      this.vars.setString('fadec.rating', id);
    }
  }

  /** N1 limit (%) of a rating at a pressure altitude / temperature (assumed temperature applied to flex ratings when given). */
  n1For(id: string, altFt: number, tempC: number, assumedC = -99): number {
    const t = this.cfg.ratings[id];
    if (!t) return NaN;
    const full = interp2(t, altFt, tempC);
    const i = this.ids.indexOf(id);
    if (i >= 0 && this.flex[i] && assumedC > tempC) {
      const reduced = interp2(t, altFt, assumedC);
      return Math.max(reduced, full - (this.cfg.maxFlexN1Drop ?? 6));
    }
    return full;
  }

  /** Current N1 limit of a rating (from the last update). */
  limit(id: string): number {
    return this.vars.get(ratingVar(id), NaN);
  }

  reset(): void {
    this.wasGround = this.onGround();
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }

  update(_dt: number): void {
    const v = this.vars;
    const a = this.cfg.auto;
    const ground = this.onGround();
    if (a) {
      if (ground) this.select(a.takeoff);
      else if (a.goAround && this.gaWhen()) this.select(a.goAround);
      else if (a.cruise && this.cruiseWhen()) this.select(a.cruise);
      else if (this.climbWhen() || (this.selected === a.takeoff && !this.wasGround && !this.cfg.auto?.climbWhen)) this.select(a.climb);
      else if (a.goAround && this.selected === a.goAround) this.select(a.climb);
    }
    this.wasGround = ground;
    const alt = v.get(this.altVar);
    const temp = v.get(this.tempVar);
    const assumed = v.get('fadec.assumed_temp_c', -99);
    let sel = NaN;
    for (let i = 0; i < this.ids.length; i++) {
      const t = this.cfg.ratings[this.ids[i]];
      let n1 = interp2(t, alt, temp);
      if (this.flex[i] && assumed > temp) n1 = Math.max(interp2(t, alt, assumed), n1 - (this.cfg.maxFlexN1Drop ?? 6));
      v.set(this.outVars[i], n1);
      if (this.ids[i] === this.selected) sel = n1;
    }
    v.set('fadec.n1_limit_pct', sel);
    const selIdx = this.ids.indexOf(this.selected);
    v.set('fadec.flex_active', selIdx >= 0 && this.flex[selIdx] && assumed > temp ? 1 : 0);
  }
}
