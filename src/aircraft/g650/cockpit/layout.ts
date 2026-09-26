/**
 * Gulfstream G650 airframe and flight-deck geometry (body metres: x fwd, y
 * right, z down, from the datum = empty-weight CG, fdm.ts). Shared by every
 * cockpit file, the exterior (exterior.ts) and the overhead / side-console
 * builders (cockpit/overhead/**, cockpit/side/**) through the mount frames
 * below.
 *
 * Anchors (fdm.ts, dossier docs/aircraft/g650.md §1, §8):
 *  - nose tip x +16.7 m, overall length 30.41 m (GAC) -> the stabilizer tips
 *    reach x -13.71 m; ground 2.35 m below the datum with static strut
 *    compression (fdm.ts GEAR_Z 2.47 - 0.12);
 *  - fuselage: cabin 98 in wide x 75 in tall inside (BJT G500 pilot report:
 *    "the G650's 98 and 75 inches"); oval section with a flatter lower part
 *    (Wikipedia G650: "oval rather than circular ... flatter lower portion");
 *    outside EST 2.74 m wide x 2.93 m tall (skin, frames and insulation);
 *  - design eye (13.9, -+0.55, -1.0) (dossier §8, fdm.ts pilot station).
 * The dossier §8 panel numbers were EST; this file refines them so the
 * over-the-nose view (~12-14 deg below the eye line, AC 25.773-1 practice)
 * clears the glareshield and the four 14-in DUs fit under a glareshield tall
 * enough for the SMCs (EPIC_HW sizes). Everything here is EST unless a
 * source is named.
 */
import { FuselageProfile, type FuselageStation } from '../../_test/loft';
import type { BodyVec } from '../../../cockpit/frame';

/** Section from its top and bottom skin heights (body z) and half-width. */
function st(x: number, zTop: number, zBot: number, ry: number): FuselageStation {
  return { x, cz: (zTop + zBot) / 2, rz: (zBot - zTop) / 2, ry };
}

/**
 * Fuselage profile with monotone cubic (Fritsch-Carlson) interpolation of the
 * section parameters between stations. The base class blends each interval
 * with a cosine, which flattens the slope at every station and would ripple a
 * densely defined nose (windshield); this keeps the skin fair.
 */
export class SmoothFuselageProfile extends FuselageProfile {
  private readonly xs: number[];
  private readonly keys: ('cz' | 'ry' | 'rz')[] = ['cz', 'ry', 'rz'];
  private readonly tangents: Record<'cz' | 'ry' | 'rz', number[]>;

  constructor(stations: FuselageStation[]) {
    super(stations);
    // Base class sorts nose -> tail; interpolate on ascending x.
    const asc = [...this.stations].reverse();
    this.xs = asc.map((s) => s.x);
    this.tangents = { cz: [], ry: [], rz: [] };
    for (const k of this.keys) {
      const y = asc.map((s) => s[k]);
      const n = y.length;
      const d: number[] = [];
      for (let i = 0; i < n - 1; i++) d.push((y[i + 1] - y[i]) / (this.xs[i + 1] - this.xs[i]));
      const m: number[] = new Array(n).fill(0);
      m[0] = d[0];
      m[n - 1] = d[n - 2];
      for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
      for (let i = 0; i < n - 1; i++) {
        if (d[i] === 0) {
          m[i] = 0;
          m[i + 1] = 0;
          continue;
        }
        const a = m[i] / d[i];
        const b = m[i + 1] / d[i];
        const s = a * a + b * b;
        if (s > 9) {
          const t = 3 / Math.sqrt(s);
          m[i] = t * a * d[i];
          m[i + 1] = t * b * d[i];
        }
      }
      this.tangents[k] = m;
    }
    this.ascStations = asc;
  }

  private ascStations: FuselageStation[];

  override at(x: number, out: FuselageStation = { x: 0, cz: 0, ry: 0, rz: 0 }): FuselageStation {
    const s = this.ascStations;
    const n = s.length;
    out.x = x;
    if (x <= s[0].x) {
      out.cz = s[0].cz;
      out.ry = s[0].ry;
      out.rz = s[0].rz;
      return out;
    }
    if (x >= s[n - 1].x) {
      out.cz = s[n - 1].cz;
      out.ry = s[n - 1].ry;
      out.rz = s[n - 1].rz;
      return out;
    }
    let i = 0;
    while (i < n - 2 && x > s[i + 1].x) i++;
    const h = s[i + 1].x - s[i].x;
    const t = (x - s[i].x) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    for (const k of this.keys) {
      const m = this.tangents[k];
      out[k] = h00 * s[i][k] + h10 * h * m[i] + h01 * s[i + 1][k] + h11 * h * m[i + 1];
    }
    return out;
  }
}

/**
 * Outer-skin cross-sections (x, top z, bottom z, half-width). Constant
 * section 2.74 x 2.93 m (EST, above) centred 0.1 m above the datum, belly
 * ~1.0 m above the ramp. The nose drops to the radome ("droop" nose of the
 * GVI family); the windshield sits between the glareshield line z -0.81 and
 * the header z -1.42 (GLAZING). Tail cone upswept to the tail-strike point
 * (fdm.ts 'Tail cone' at x -10.98, z +0.05), APU exhaust at its end.
 */
export const G650_FUSELAGE = new SmoothFuselageProfile([
  st(16.7, 0.2, 0.27, 0.02),
  st(16.63, 0.02, 0.45, 0.2),
  st(16.38, -0.2, 0.73, 0.49),
  st(15.95, -0.47, 1.0, 0.82),
  st(15.5, -0.67, 1.16, 1.04),
  st(15.08, -0.81, 1.25, 1.17),
  st(14.75, -1.08, 1.3, 1.27),
  st(14.4, -1.37, 1.33, 1.33),
  st(13.95, -1.52, 1.35, 1.36),
  st(13.3, -1.57, 1.36, 1.37),
  st(-4.0, -1.57, 1.36, 1.37),
  st(-6.0, -1.56, 1.24, 1.33),
  st(-8.5, -1.49, 0.78, 1.12),
  st(-11.0, -1.37, 0.1, 0.72),
  st(-12.6, -1.25, -0.45, 0.38),
  st(-13.28, -1.17, -0.8, 0.1),
]);
export const NOSE_TIP_X = 16.7;
export const TAIL_CONE_X = -13.28;

/** Skin inset of the cockpit interior shell (EST 45 mm: skin, frames, insulation, trim). */
export const SHELL_INSET = 0.045;

/** Flight-deck floor (EST: design eye 1.22 m above it = ~0.42 m seat reference + ~0.80 m seated eye, AC 25.773-1). */
export const FLOOR_Z = 0.22;
/** Aft end of the flight deck (cockpit door bulkhead). */
export const X_AFT = 12.9;

/** Pilot / copilot design eye (dossier §8, fdm.ts crew stations y -+0.55). */
export const EYE_L: [number, number, number] = [13.9, -0.55, -1.0];
export const EYE_R: [number, number, number] = [13.9, 0.55, -1.0];

/**
 * Glazing in side-view terms (x, z), EST from G650 / G650ER photographs:
 *  - windshield: two large panes split by a narrow centre post, above the
 *    glareshield line (z < baseZ), below the header (z > headerZ) and forward
 *    of the A-pillar line;
 *  - forward side window (DV): from the A-pillar back to a swept aft edge;
 *  - aft side window: smaller, rounded, swept like the forward one.
 */
export const GLAZING = {
  baseZ: -0.81,
  headerZ: -1.42,
  postHalf: 0.022,
  /** A-pillar (windshield aft edge) line: x at z = baseZ and at z = headerZ; post width (m). */
  aPillar: { xBase: 14.5, xTop: 14.14, width: 0.055 },
  fwdSide: { sillZ: -0.76, roofZ: -1.33, aftBase: 13.92, aftTop: 13.8, corner: 0.07 },
  aftSide: { sillZ: -0.78, roofZ: -1.27, fwdBase: 13.84, fwdTop: 13.72, aftBase: 13.34, aftTop: 13.24, corner: 0.11 },
} as const;

/** A-pillar x at height z (linear between the base and header points). */
export function aPillarX(z: number): number {
  const a = GLAZING.aPillar;
  const t = (z - GLAZING.baseZ) / (GLAZING.headerZ - GLAZING.baseZ);
  return a.xBase + (a.xTop - a.xBase) * t;
}

/** Linear edge helper: x at height z between (xAtSill, sillZ) and (xAtRoof, roofZ). */
export function edgeX(z: number, sillZ: number, roofZ: number, xAtSill: number, xAtRoof: number): number {
  const t = (z - sillZ) / (roofZ - sillZ);
  return xAtSill + (xAtRoof - xAtSill) * t;
}

/** Half-width of the section at body x, height z, inset inward by `inset` (0 outside the section). */
export function halfWidth(x: number, z: number, inset = 0): number {
  const s = G650_FUSELAGE.at(x);
  const rz = s.rz - inset;
  const ry = s.ry - inset;
  const d = (z - s.cz) / rz;
  return d >= 1 || d <= -1 ? 0 : ry * Math.sqrt(1 - d * d);
}

/** Skin height (body z, upper surface) at body (x, y), inset inward. */
export function topZ(x: number, y: number, inset = 0): number {
  const s = G650_FUSELAGE.at(x);
  const rz = s.rz - inset;
  const ry = s.ry - inset;
  const q = Math.min(1, Math.abs(y) / ry);
  return s.cz - rz * Math.sqrt(1 - q * q);
}

/** Glareshield hood: brow (aft edge) and top height; it runs forward to the windshield base (shell.ts). */
export const GLARE_HOOD = { browX: 14.61, topZ: -0.846 };

/**
 * Glareshield front face under the brow: guidance panel in the centre, SMC 1 / 2 either side (dossier §8,
 * FlightGlobal 2008), MASTER WARNING / MASTER CAUTION outboard, DU dimmers at the ends. Tilted 25 deg up.
 */
export const GLARE_FACE = {
  center_m: [14.585, 0, -0.772] as BodyVec,
  tiltDeg: 25,
  width: 1.84,
  height: 0.15,
};

/** Main instrument panel (display band): four 14-in DUs, face tilted 12 deg back (EST from photographs). */
export const MAIN_PANEL = {
  center_m: [14.57, 0, -0.565] as BodyVec,
  tiltDeg: 12,
  width: 1.9,
  height: 0.28,
};
/**
 * DU centres on the main panel (u m from the panel centre): each PFD straight ahead of its pilot (y -+0.55),
 * the MFDs side by side in the middle (G650 photographs: four DUs in a near-continuous row). EST.
 */
export const DU_U = [-0.585, -0.2, 0.2, 0.585] as const;

/** Lower centre panels either side of the pedestal under the MFDs (gear panel right, display / CAS controls left). */
export const LOWER_CENTRE = { x: 14.548, zTop: -0.424, zBottom: -0.2, yIn: 0.212, yOut: 0.43, tiltDeg: 8 };

/** Centre pedestal (EST; dossier §8: MCDUs forward, thrust quadrant, trim, MCDU 3 aft). */
export const PEDESTAL = {
  width: 0.42,
  /** Sloped forward face carrying MCDU 1 and 2, from under the MFDs down / aft to the top surface. [x, z] */
  fwdTop: [14.552, -0.424] as [number, number],
  fwdBottom: [14.3, -0.33] as [number, number],
  /** Top surface from the forward face aft, falling slightly. */
  topFwd: [14.3, -0.33] as [number, number],
  topAft: [13.3, -0.28] as [number, number],
};

/** Control wheels: hub positions (0.43 m ahead of and 0.48 m below the eye, EST from photographs). */
export const YOKE_HUB_L: [number, number, number] = [14.33, -0.55, -0.52];
export const YOKE_HUB_R: [number, number, number] = [14.33, 0.55, -0.52];
/** Rudder pedal pivots (hanging pedals under the panel). */
export const PEDALS_L: [number, number, number] = [14.8, -0.55, -0.04];
export const PEDALS_R: [number, number, number] = [14.8, 0.55, -0.04];

/** Crew seat reference (floor point under the front of the seat pan). */
export const SEAT_L: [number, number, number] = [14.12, -0.55, FLOOR_Z];
export const SEAT_R: [number, number, number] = [14.12, 0.55, FLOOR_Z];

/** Side consoles (outboard of each seat): top surface height and inboard edge. */
export const CONSOLE = { topZ: -0.26, yIn: 0.8, xFwd: 14.45, xAft: 13.1 };

/** Nosewheel tiller on the pilot's side console, forward end (LUC landing gear: tiller; built by the main cockpit). */
export const TILLER = { center_m: [14.3, -0.95, CONSOLE.topZ] as BodyVec };

/** HUD combiner (Rockwell Collins HGS, optional): 0.28 m ahead of the pilot eye (EST), 30 x 24 deg field of view. */
export const HUD = { eyeDist: 0.28, fovHDeg: 30, fovVDeg: 24 };

/**
 * Mount frames for the builders owned by other agents (contract in context.ts).
 * Overhead: from just aft of the windshield header (x ~14.25) to x ~13.2, 0.75 m wide (dossier §8), forward end
 * lower. Side consoles: the console tops aft of the tiller, x 13.15 -> 13.95.
 */
export const MOUNTS = {
  overhead: { center_m: [13.72, 0, -1.47] as BodyVec, facing: 'down' as const, tiltDeg: -10, width: 0.75, height: 1.06 },
  sideLeft: { center_m: [13.55, -0.97, CONSOLE.topZ] as BodyVec, facing: 'up' as const, tiltDeg: 0, width: 0.3, height: 0.8 },
  sideRight: { center_m: [13.55, 0.97, CONSOLE.topZ] as BodyVec, facing: 'up' as const, tiltDeg: 0, width: 0.3, height: 0.8 },
};
