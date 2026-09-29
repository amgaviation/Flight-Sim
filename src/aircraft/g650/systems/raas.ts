/**
 * Gulfstream G650 SmartRunway / RAAS (Honeywell EGPWS Runway Awareness and
 * Advisory System; the G650 EGPWS class A fit includes RAAS and the pedestal
 * RAAS INHIBIT key suppresses its callouts - FAA FSB GVI, dossier §4.12/§9.8).
 *
 * Modelled advisories (Honeywell SmartRunway/SmartLanding pilot guide wording):
 *  - "Approaching runway <XX>" - taxiing toward a runway, within ~90 m of the
 *    runway edge and closing (ground only; the airborne approaching-runway
 *    call is SCOPE, not modelled).
 *  - "On runway <XX>" - entering a runway aligned within 45° of an end.
 *  - "On runway <XX>, <n> hundred remaining" - EST insufficient-runway-length
 *    form of the on-runway advisory when the distance to the far end is below
 *    6,000 ft (the class of the G650 MTOW BFL 5,858 ft, GAC).
 *
 * Position/track come from GPS (the EGPWS position source; GPS position and
 * ground speed are the permitted avionics exceptions). The nearest-airport
 * lookup allocates, so it runs at 0.5 Hz like the shared Taws block's.
 * Gated by `V.raasActive` (logic.ts: TAWS powered and RAAS INHIBIT out).
 * Outputs: `V.raasCallout` (string, last advisory), `V.raasOnRunway`.
 */
import type { Subsystem } from '../../types';
import type { SimContext } from '../../../core/SimContext';
import { GPS } from '../../../core/vars';
import { distanceNm, initialBearing } from '../../../core/geo';
import type { Airport, Runway } from '../../../nav/types';
import { G650_VARS as V } from '../vars';

const FT_PER_NM = 6076.12;

/** Spoken form of a runway ident: "09L" -> "zero nine left" (Honeywell RAAS phraseology). */
export function spokenRunway(ident: string): string {
  const digits: Record<string, string> = { '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine' };
  const out: string[] = [];
  for (const c of ident) {
    if (digits[c] !== undefined) out.push(digits[c]);
    else if (c === 'L') out.push('left');
    else if (c === 'R') out.push('right');
    else if (c === 'C') out.push('center');
  }
  return out.join(' ');
}

export class G650Raas implements Subsystem {
  readonly name = 'g650.raas';
  private acc = 5;
  private airport: Airport | null = null;
  private onRunway = false;
  private approachArmed = true;
  private lastIdent = '';

  constructor(private readonly ctx: Pick<SimContext, 'vars' | 'nav' | 'audio'>) {}

  update(dt: number): void {
    const v = this.ctx.vars;
    const active = v.get(V.raasActive) !== 0;
    const ground = v.get('gear.air_ground') !== 0;
    const gpsOk = v.get(GPS.valid) !== 0;
    if (!active || !ground || !gpsOk) {
      this.onRunway = false;
      v.set(V.raasOnRunway, 0);
      if (!active) v.setString(V.raasCallout, '');
      return;
    }
    this.acc += dt;
    if (this.acc < 2) return; // 0.5 Hz: the airport lookup and runway geometry allocate
    this.acc = 0;
    const lat = v.get(GPS.lat);
    const lon = v.get(GPS.lon);
    const nav = this.ctx.nav;
    if (nav && typeof nav.airportsNear === 'function' && (nav.ready ?? true)) {
      const list = nav.airportsNear(lat, lon, 5, 1);
      this.airport = list.length > 0 ? list[0] : null;
    }
    const a = this.airport;
    if (!a) return;
    const gs = v.get(GPS.gs);
    const trk = v.get(GPS.trackTrue);

    // Runway geometry: along/cross position relative to each end's centreline.
    let on: Runway | null = null;
    let remainingFt = 0;
    let nearest: Runway | null = null;
    let nearestEdgeFt = 1e9;
    for (const r of a.runways) {
      const dNm = distanceNm(r.lat, r.lon, lat, lon);
      const brg = initialBearing(r.lat, r.lon, lat, lon);
      const rel = ((brg - r.headingTrue + 540) % 360) - 180;
      const alongFt = dNm * FT_PER_NM * Math.cos((rel * Math.PI) / 180);
      const crossFt = dNm * FT_PER_NM * Math.sin((rel * Math.PI) / 180);
      const halfW = Math.max(50, r.widthFt / 2 + 15);
      const inside = Math.abs(crossFt) <= halfW && alongFt >= -100 && alongFt <= r.lengthFt + 100;
      const hdgDiff = Math.abs(((trk - r.headingTrue + 540) % 360) - 180);
      if (inside && hdgDiff <= 45 && gs > 2) {
        // Prefer the aligned end (each physical runway lists both ends).
        if (!on || hdgDiff < 45) {
          on = r;
          remainingFt = Math.max(0, r.lengthFt - alongFt);
        }
      }
      // Distance to the runway edge (for the approaching advisory), only for ends roughly ahead.
      if (!inside) {
        const edgeFt = Math.max(Math.abs(crossFt) - halfW, alongFt < 0 ? -alongFt : alongFt > r.lengthFt ? alongFt - r.lengthFt : 0);
        if (edgeFt < nearestEdgeFt) {
          nearestEdgeFt = edgeFt;
          nearest = r;
        }
      }
    }

    if (on) {
      if (!this.onRunway || on.ident !== this.lastIdent) {
        // EST: insufficient-runway-length form below 6,000 ft remaining (MTOW BFL class, GAC 5,858 ft).
        const spoken = spokenRunway(on.ident);
        const text = remainingFt < 6000 ? `On runway ${spoken}, ${Math.max(1, Math.round(remainingFt / 100))} hundred remaining` : `On runway ${spoken}`;
        this.callout(text);
        this.lastIdent = on.ident;
      }
      this.onRunway = true;
      this.approachArmed = false;
    } else {
      this.onRunway = false;
      if (nearestEdgeFt > 500) {
        this.approachArmed = true;
        this.lastIdent = '';
      }
      // Approaching: within ~300 ft of a runway edge, taxiing (4-40 kt).
      if (this.approachArmed && nearest && nearestEdgeFt < 300 && gs > 4 && gs < 40) {
        this.callout(`Approaching runway ${spokenRunway(nearest.ident)}`);
        this.approachArmed = false;
      }
    }
    v.set(V.raasOnRunway, this.onRunway ? 1 : 0);
  }

  private callout(text: string): void {
    this.ctx.vars.setString(V.raasCallout, text);
    this.ctx.audio?.callout(text, 3);
  }

  reset(): void {
    this.acc = 5;
    this.airport = null;
    this.onRunway = false;
    this.approachArmed = true;
    this.lastIdent = '';
    this.ctx.vars.setString(V.raasCallout, '');
  }
}
