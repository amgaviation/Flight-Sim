/**
 * Airport light layout (pure data).
 *
 * Positions are in a runway's (s, t) frame (metres along A->B, metres right of
 * the centreline) plus a height above the runway surface plane. Each light has
 * a facing direction in the (s, t) plane: the `front` colour is seen by an
 * observer on the +dir side of the light, the `back` colour from the -dir side
 * (null = not visible from behind). Omnidirectional lights have dir (0, 0).
 *
 * Sources:
 *  - Edge lights: AC 150/5340-30J 2.3.1 (<= 200 ft spacing, 2-10 ft outside
 *    the pavement edge, white; yellow in the caution zone = last 2,000 ft or
 *    half the runway, facing the instrument approach end).
 *  - Threshold/end lights: 2.3.2 (green outward, red toward the runway; 3 per
 *    side visual, 4 per side instrument, 10 ft centres, 2-10 ft before the
 *    threshold; displaced thresholds outboard).
 *  - Centreline: 3.3.1 (50 ft spacing; last 3,000 ft alternating red/white
 *    starting with red, last 1,000 ft red).
 *  - TDZ: 3.3.2 and Figure A-35 (two rows of 3-light bars, 5 ft spacing,
 *    inner light 36 ft from the centreline, 100 ft intervals from 100 ft to
 *    3,000 ft or half the runway).
 *  - PAPI: chapter 7 (left side, inboard unit 50 ft from the edge (30 ft for
 *    small GA runways), 20-30 ft between units, aiming per Table 7-2).
 *  - ALSF-2 / MALSR: FAA AIM 2-1-1 and FIG 2-1-1; flashers "twice a second".
 *  - Taxiway edge lights: blue, <= 200 ft spacing (Figure A-13 notes).
 *  - Beacon: AIM 2-1-9, white/green, 24-30 flashes per minute.
 */
import { FT_TO_M } from '../geo';
import type { AirportLayout, RunwayEndModel, RunwayModel, TaxiwayPlan } from './runwayModel';

export type Rgb = [number, number, number];

/** Aviation signal colours (linear RGB, relative). EST: tuned to read correctly after tone mapping. */
export const LIGHT_COLORS = {
  white: [1.0, 0.93, 0.8] as Rgb, // incandescent/halogen aviation white
  yellow: [1.0, 0.72, 0.12] as Rgb,
  green: [0.15, 1.0, 0.42] as Rgb,
  red: [1.0, 0.07, 0.04] as Rgb,
  blue: [0.12, 0.28, 1.0] as Rgb,
  flasher: [0.85, 0.9, 1.0] as Rgb, // xenon strobe
};

export const enum LightKind {
  Steady = 0,
  /** Sequenced/synchronised flasher: phase = fraction of the period at which it fires. */
  Flash = 1,
  /** Rotating beacon: period = rotation period (s). */
  Beacon = 2,
  /** PAPI unit: phase = aiming angle (deg); colour set per frame. */
  Papi = 3,
}

export const enum LightGroup {
  /** Runway edge/threshold/centreline/TDZ/approach/REIL: on at night or in low visibility. */
  Runway = 0,
  /** PAPI: energised at all times (AC 150/5340-30J 7.5.6: continuous power). */
  Papi = 1,
  Beacon = 2,
  Taxiway = 3,
}

export interface LightDef {
  /** Runway frame position (m) and height above the runway plane (m). */
  s: number;
  t: number;
  h: number;
  /** Facing direction in the (s, t) plane; (0, 0) = omnidirectional. */
  dirS: number;
  dirT: number;
  front: Rgb;
  back: Rgb | null;
  /** Relative intensity (1 = HIRL edge light). */
  intensity: number;
  kind: LightKind;
  /** Flash: phase 0..1; Papi: aiming angle (deg); otherwise 0. */
  phase: number;
  /** Flash period / beacon rotation period (s). */
  period: number;
  group: LightGroup;
  /**
   * Height mode: 'surface' = h above the runway plane at s;
   * 'threshold' = h above the owning end's threshold elevation (approach light plane).
   */
  heightRef: 'surface' | 'threshold';
  /** Owning runway end (0 = A, 1 = B) for 'threshold' heights; -1 otherwise. */
  end: number;
}

/** Sequenced flasher cycle (s): AIM 2-1-1 "twice a second". */
export const SEQ_FLASH_PERIOD_S = 0.5;
/** REIL flash period (s). EST: 120 flashes/min typical of L-849 REIL units. */
export const REIL_PERIOD_S = 0.5;
/** Beacon rotation (s): 12 rpm with one white and one green beam = 24 flashes/min (AIM 2-1-9: 24-30/min). */
export const BEACON_ROTATION_S = 5;
/** PAPI red/white transition sector (deg). EST: ~3 arcmin per AC 150/5345-28 colour transition limits. */
export const PAPI_TRANSITION_DEG = 3 / 60;

/**
 * PAPI unit whiteness at an observer elevation angle (0 = red, 1 = white),
 * with a narrow smooth transition centred on the aiming angle.
 */
export function papiWhiteness(elevationDeg: number, aimingDeg: number, transitionDeg = PAPI_TRANSITION_DEG): number {
  const x = (elevationDeg - (aimingDeg - transitionDeg / 2)) / transitionDeg;
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/**
 * Aiming angles of a 4-box PAPI from the unit nearest the runway outward
 * (AC 150/5340-30J Table 7-2, standard installation: +30', +10', -10', -30').
 */
export function papiAimingAngles(glidePathDeg: number): [number, number, number, number] {
  return [glidePathDeg + 30 / 60, glidePathDeg + 10 / 60, glidePathDeg - 10 / 60, glidePathDeg - 30 / 60];
}

/** Number of white units seen at an elevation angle (for tests / debug). */
export function papiWhiteCount(elevationDeg: number, glidePathDeg: number): number {
  let n = 0;
  for (const a of papiAimingAngles(glidePathDeg)) if (papiWhiteness(elevationDeg, a) > 0.5) n++;
  return n;
}

interface EndFrame {
  /** Map end-local (u along landing direction from the pavement end, v right of it) to (s, t). */
  toS(u: number): number;
  toT(v: number): number;
  /** Landing direction in the (s, t) frame. */
  dS: number;
}

function endFrame(rw: RunwayModel, i: number): EndFrame {
  if (i === 0) return { toS: (u) => u, toT: (v) => v, dS: 1 };
  const L = rw.lengthM;
  return { toS: (u) => L - u, toT: (v) => -v, dS: -1 };
}

function caution(end: RunwayEndModel): Rgb {
  return end.instrument ? LIGHT_COLORS.yellow : LIGHT_COLORS.white;
}

/** Edge light lateral offset from the pavement edge (AC 150/5340-30J 2.3.1.2.1: 10 ft for jets, 2 ft otherwise). */
function edgeOffsetM(rw: RunwayModel): number {
  return (rw.airportType === 'small_airport' ? 2 : 10) * FT_TO_M;
}

export function runwayLights(rw: RunwayModel): LightDef[] {
  const out: LightDef[] = [];
  if (!rw.lighted) return out;
  const L = rw.lengthM;
  const W = rw.widthM;
  const tEdge = W / 2 + edgeOffsetM(rw);
  const edgeI = rw.hirl ? 1.0 : 0.6;
  const [endA, endB] = rw.ends;
  const cautionM = Math.min(2000 * FT_TO_M, L / 2);
  const base = (over: Partial<LightDef>): LightDef => ({
    s: 0,
    t: 0,
    h: 0.3,
    dirS: 1,
    dirT: 0,
    front: LIGHT_COLORS.white,
    back: LIGHT_COLORS.white,
    intensity: edgeI,
    kind: LightKind.Steady,
    phase: 0,
    period: 0,
    group: LightGroup.Runway,
    heightRef: 'surface',
    end: -1,
    ...over,
  });

  // --- Edge lights (uniform spacing <= 200 ft between the runway ends).
  const n = Math.max(1, Math.ceil(L / (200 * FT_TO_M)));
  const ds = L / n;
  for (let k = 1; k < n; k++) {
    const s = k * ds;
    // Seen by pilots landing on B (observer on the +s side): caution near A's pavement end.
    let front = s < cautionM ? caution(endB) : LIGHT_COLORS.white;
    // Seen by pilots landing on A (observer on the -s side): caution near B's end.
    let back = L - s < cautionM ? caution(endA) : LIGHT_COLORS.white;
    // Displaced areas: red toward the approach (2.3.2.1.2).
    if (s < endA.displacedM) back = LIGHT_COLORS.red;
    if (L - s < endB.displacedM) front = LIGHT_COLORS.red;
    for (const side of [-1, 1]) out.push(base({ s, t: side * tEdge, front, back }));
  }

  // --- Threshold and end lights per end.
  for (let i = 0; i < 2; i++) {
    const end = rw.ends[i];
    const f = endFrame(rw, i);
    const perSide = end.instrument ? 4 : 3;
    const pitch = 10 * FT_TO_M;
    const hasAls = end.approachLights !== 'NONE';
    const uThr = end.displacedM - 1.5 * FT_TO_M * 2; // 3 ft before the landing threshold (2-10 ft)
    if (end.displacedM <= 0) {
      // Combined green (outward) / red (toward runway) fixtures.
      const tPositions: number[] = [];
      if (hasAls) {
        // Full-width threshold bar with an ALS (AC 150/5340-30J 2.3.2.2.1 item 3).
        const nBar = Math.max(2, Math.floor((2 * tEdge) / pitch));
        for (let k = 0; k <= nBar; k++) tPositions.push(-tEdge + (2 * tEdge * k) / nBar);
      } else {
        for (let k = 0; k < perSide; k++) tPositions.push(tEdge - k * pitch, -(tEdge - k * pitch));
      }
      for (const v of tPositions) {
        // Facing -landing direction (toward the approach) shows green; toward the runway red.
        out.push(base({ s: f.toS(uThr), t: f.toT(v), dirS: -f.dS, front: LIGHT_COLORS.green, back: LIGHT_COLORS.red, intensity: 1.2 }));
      }
    } else {
      // Displaced threshold: green bars outboard of the edge lines, unidirectional.
      for (let k = 0; k < perSide; k++) {
        const v = tEdge + k * pitch;
        for (const side of [-1, 1]) {
          out.push(base({ s: f.toS(uThr), t: f.toT(side * v), dirS: -f.dS, front: LIGHT_COLORS.green, back: null, intensity: 1.2 }));
        }
      }
      // Runway end lights at the pavement end, red toward the runway only.
      for (let k = 0; k < perSide; k++) {
        for (const side of [-1, 1]) {
          out.push(base({ s: f.toS(-1), t: f.toT(side * (tEdge - k * pitch)), dirS: f.dS, front: LIGHT_COLORS.red, back: null, intensity: 1.0 }));
        }
      }
    }
  }

  // --- Centreline lights: 50 ft spacing, colour-coded for the last 3,000 ft in each direction.
  if (rw.centerlineLights) {
    const pitch = 50 * FT_TO_M;
    const nC = Math.floor((L - 2 * 25 * FT_TO_M) / pitch);
    const s0 = (L - nC * pitch) / 2;
    const code = (remainingM: number, idx: number): Rgb => {
      const ft = remainingM / FT_TO_M;
      if (ft <= 1000) return LIGHT_COLORS.red;
      if (ft <= 3000) return idx % 2 === 0 ? LIGHT_COLORS.red : LIGHT_COLORS.white;
      return LIGHT_COLORS.white;
    };
    for (let k = 0; k <= nC; k++) {
      const s = s0 + k * pitch;
      // Observer rolling toward B (on the -s side) sees the back face; remaining = L - s.
      const idxToB = Math.round((L - s) / pitch);
      const idxToA = Math.round(s / pitch);
      out.push(base({ s, t: 0, h: 0.05, front: code(s, idxToA), back: code(L - s, idxToB), intensity: 0.7 }));
    }
  }

  // --- Touchdown zone lights (unidirectional white toward the approach).
  for (let i = 0; i < 2; i++) {
    const end = rw.ends[i];
    if (!end.tdzLights) continue;
    const f = endFrame(rw, i);
    const lenFt = Math.min(3000, (L / FT_TO_M) / 2);
    for (let d = 100; d <= lenFt; d += 100) {
      const u = end.displacedM + d * FT_TO_M;
      for (let k = 0; k < 3; k++) {
        const v = (36 + k * 5) * FT_TO_M;
        for (const side of [-1, 1]) {
          out.push(base({ s: f.toS(u), t: f.toT(side * v), h: 0.05, dirS: -f.dS, front: LIGHT_COLORS.white, back: null, intensity: 0.8 }));
        }
      }
    }
  }

  // --- Approach lights, PAPI, REIL.
  for (let i = 0; i < 2; i++) out.push(...approachLights(rw, i), ...papiLights(rw, i), ...reilLights(rw, i));
  return out;
}

/** Approach lighting system for runway end `i` (in front of the landing threshold). */
export function approachLights(rw: RunwayModel, i: number): LightDef[] {
  const end = rw.ends[i];
  const out: LightDef[] = [];
  if (end.approachLights === 'NONE') return out;
  const f = endFrame(rw, i);
  const thrU = end.displacedM;
  const ft = FT_TO_M;
  const light = (dFt: number, vFt: number, color: Rgb, intensity: number, kind = LightKind.Steady, phase = 0, period = 0): LightDef => ({
    s: f.toS(thrU - dFt * ft),
    t: f.toT(vFt * ft),
    h: 1.0, // EST: light plane ~1 m above the threshold elevation on frangible stands
    dirS: -f.dS,
    dirT: 0,
    front: color,
    back: null,
    intensity,
    kind,
    phase,
    period,
    group: LightGroup.Runway,
    heightRef: 'threshold',
    end: i,
  });
  const barrette = (dFt: number, color: Rgb, intensity: number, n = 5, pitchFt = 3.5) => {
    for (let k = 0; k < n; k++) out.push(light(dFt, (k - (n - 1) / 2) * pitchFt, color, intensity));
  };
  const crossbar = (dFt: number, innerFt: number, nEach: number, color: Rgb, intensity: number) => {
    for (let k = 0; k < nEach; k++) for (const side of [-1, 1]) out.push(light(dFt, side * (innerFt + k * 5), color, intensity));
  };
  if (end.approachLights === 'ALSF2') {
    // Centreline barrettes every 100 ft to 2,400 ft.
    for (let d = 100; d <= 2400; d += 100) barrette(d, LIGHT_COLORS.white, 2.0);
    // Sequenced flashers 1,000-2,400 ft, firing from the outer end toward the runway.
    const flashers: number[] = [];
    for (let d = 2400; d >= 1000; d -= 100) flashers.push(d);
    flashers.forEach((d, k) => out.push(light(d, 0, LIGHT_COLORS.flasher, 6.0, LightKind.Flash, k / flashers.length, SEQ_FLASH_PERIOD_S)));
    // 1,000 ft and 500 ft crossbars (EST geometry: 4 lights each side, 5 ft pitch, inner 15 ft).
    crossbar(1000, 15, 4, LIGHT_COLORS.white, 2.0);
    crossbar(500, 15, 4, LIGHT_COLORS.white, 2.0);
    // Red side-row barrettes 100-900 ft, in line with the TDZ lights (inner light 36 ft).
    for (let d = 100; d <= 900; d += 100) crossbar(d, 36, 3, LIGHT_COLORS.red, 1.6);
  } else {
    // MALSR: MALS 200-1,400 ft barrettes every 200 ft, 1,000 ft crossbar, RAIL flashers 1,600-2,400 ft.
    for (let d = 200; d <= 1400; d += 200) barrette(d, LIGHT_COLORS.white, 1.6);
    crossbar(1000, 15, 3, LIGHT_COLORS.white, 1.6); // EST crossbar geometry
    const rail = [2400, 2200, 2000, 1800, 1600];
    rail.forEach((d, k) => out.push(light(d, 0, LIGHT_COLORS.flasher, 6.0, LightKind.Flash, k / rail.length, SEQ_FLASH_PERIOD_S)));
  }
  return out;
}

/** PAPI (4 units, left of the landing direction). Unit order: nearest the runway first. */
export function papiLights(rw: RunwayModel, i: number): LightDef[] {
  const end = rw.ends[i];
  if (!end.papi) return [];
  const f = endFrame(rw, i);
  const small = rw.airportType === 'small_airport';
  const edgeGap = (small ? 30 : 50) * FT_TO_M; // AC 150/5340-30J 7.5.4.7.1
  const pitch = (rw.widthM / FT_TO_M >= 100 ? 30 : 20) * FT_TO_M; // 7.5.4.7.2: 20-30 ft
  const u = end.displacedM + end.papiDistM;
  const angles = papiAimingAngles(end.papiAngleDeg);
  return angles.map((a, k) => ({
    s: f.toS(u),
    t: f.toT(-(rw.widthM / 2 + edgeGap + k * pitch)),
    h: 0.9, // EST: lens centre height of an L-880 light housing
    dirS: -f.dS,
    dirT: 0,
    front: LIGHT_COLORS.red,
    back: null,
    intensity: 3.0,
    kind: LightKind.Papi,
    phase: a,
    period: 0,
    group: LightGroup.Papi,
    heightRef: 'surface' as const,
    end: i,
  }));
}

/** Runway end identifier lights: two synchronised white flashers 40 ft outside the edges (AC 150/5340-30J Fig. A-91 note 6). */
export function reilLights(rw: RunwayModel, i: number): LightDef[] {
  const end = rw.ends[i];
  if (!end.reil) return [];
  const f = endFrame(rw, i);
  const v = rw.widthM / 2 + 40 * FT_TO_M;
  return [-1, 1].map((side) => ({
    s: f.toS(end.displacedM),
    t: f.toT(side * v),
    h: 0.8,
    dirS: -f.dS,
    dirT: 0,
    front: LIGHT_COLORS.flasher,
    back: null,
    intensity: 5.0,
    kind: LightKind.Flash,
    phase: 0,
    period: REIL_PERIOD_S,
    group: LightGroup.Runway,
    heightRef: 'surface' as const,
    end: i,
  }));
}

/** Blue taxiway edge lights along the parallel taxiway and connectors. */
export function taxiwayLights(tw: TaxiwayPlan): LightDef[] {
  const out: LightDef[] = [];
  const rw = tw.runway;
  if (!rw.lighted) return out;
  const tc = tw.side * tw.offsetM;
  const half = tw.widthM / 2 + 0.6; // lights just outside the pavement edge
  const pitch = 200 * FT_TO_M;
  const blue = (s: number, t: number): LightDef => ({
    s,
    t,
    h: 0.3,
    dirS: 0,
    dirT: 0,
    front: LIGHT_COLORS.blue,
    back: LIGHT_COLORS.blue,
    intensity: 0.45,
    kind: LightKind.Steady,
    phase: 0,
    period: 0,
    group: LightGroup.Taxiway,
    heightRef: 'surface',
    end: -1,
  });
  const len = tw.s1 - tw.s0;
  const n = Math.max(1, Math.round(len / pitch));
  for (let k = 0; k <= n; k++) {
    const s = tw.s0 + (len * k) / n;
    // Skip lights where connectors join the taxiway on the runway side.
    const nearConnector = tw.connectors.some((c) => Math.abs(c - s) < tw.widthM);
    out.push(blue(s, tc + half * tw.side));
    if (!nearConnector) out.push(blue(s, tc - half * tw.side));
  }
  // Connectors: short sections, ~60 ft spacing (Figure A-20 short-section spacing, EST).
  const halfPaved = rw.widthM / 2 + rw.shoulderM;
  for (const c of tw.connectors) {
    const tStart = tw.side * (halfPaved + 20);
    const tEnd = tc - tw.side * (tw.widthM / 2);
    const m = Math.max(1, Math.round(Math.abs(tEnd - tStart) / (60 * FT_TO_M)));
    for (let k = 0; k <= m; k++) {
      const t = tStart + ((tEnd - tStart) * k) / m;
      out.push(blue(c - tw.widthM / 2 - 0.6, t), blue(c + tw.widthM / 2 + 0.6, t));
    }
  }
  return out;
}

/** Rotating beacon light (placed by the builder at `layout.beacon`). */
export function beaconLight(): LightDef {
  return {
    s: 0,
    t: 0,
    h: 15, // EST: beacon tower height
    dirS: 0,
    dirT: 0,
    front: LIGHT_COLORS.white,
    back: LIGHT_COLORS.green,
    intensity: 8.0,
    kind: LightKind.Beacon,
    phase: 0,
    period: BEACON_ROTATION_S,
    group: LightGroup.Beacon,
    heightRef: 'surface',
    end: -1,
  };
}

/** All lights for an airport grouped per runway (beacon handled separately). */
export function airportRunwayLights(layout: AirportLayout): { runway: RunwayModel; lights: LightDef[] }[] {
  const res = layout.runways.map((runway) => ({ runway, lights: runwayLights(runway) }));
  if (layout.taxiway) {
    const entry = res.find((r) => r.runway === layout.taxiway!.runway);
    if (entry) entry.lights.push(...taxiwayLights(layout.taxiway));
  }
  return res;
}
