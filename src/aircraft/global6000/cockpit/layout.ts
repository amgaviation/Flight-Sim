/**
 * Bombardier Global 6000 flight-deck geometry (body metres: x fwd, y right,
 * z down, from the datum = empty-weight CG with the gear down, fdm.ts).
 * Shared by every cockpit file, the exterior (fuselage profile, glazing) and
 * the overhead / side-console builders (cockpit/overhead/**, cockpit/side/**,
 * another agent), which mount on the frames in `MOUNTS`.
 *
 * Sources and anchors (dossier docs/aircraft/global6000.md §1, §10):
 *  - Design eye x +10.9, y -/+0.49, z -1.02 (GXAG GX_01_005: eye 0.49 m off
 *    the centreline, 3.14 m above the ramp = fdm.ts eyeHeightOnGround_m).
 *  - Fuselage 2.69 m outside diameter (GXAG), overall length 30.30 m (SPEC):
 *    nose tip at x +14.3, tail cone end at x -16.0.
 *  - Four AFD-6520 15.1 in landscape displays in a T (FSB appendix 6; AIN /
 *    Flying "four 15-inch landscape displays arranged in a T-pattern"): AFD 1
 *    and AFD 4 in front of each pilot, AFD 2 upper centre, AFD 3 lower centre.
 *  - "Control Tuning Panel mounted up high on the glareshield" (AOPA 2012).
 *
 * Everything else is EST from Global 6000 flight-deck photographs, scaled on
 * the AFD size (0.307 x 0.192 m active area, FUSION_HW) and made consistent
 * with a normal transport design-eye geometry (FAA AC 25.773-1: over-the-nose
 * vision ~11-15 deg below the horizontal; panel ~0.75-0.8 m from the eye).
 * The dossier's §10 glareshield height ("0.05 m below the eye") would block
 * the forward view, so the glareshield brow sits 0.19 m below the eye here
 * (15 deg over-the-nose line).
 */
import type { BodyVec } from '../../../cockpit/frame';
import { FuselageProfile, type FuselageStation } from '../../_test/loft';

/** Section from its top and bottom skin heights (body z) and half-width. */
function st(x: number, zTop: number, zBot: number, ry: number): FuselageStation {
  return { x, cz: (zTop + zBot) / 2, rz: (zBot - zTop) / 2, ry };
}

/**
 * Outer fuselage cross-sections (EST from the three-view: 2.69 m circular
 * cabin section, axis ~0.1 m above the datum; drooped radome; the upper
 * tail cone sweeps up to the APU exhaust at x -16.0).
 */
export const G6K_FUSELAGE = new FuselageProfile([
  st(14.3, 0.2, 0.28, 0.03),
  st(14.12, 0.0, 0.52, 0.28),
  st(13.75, -0.22, 0.8, 0.58),
  st(13.15, -0.45, 1.02, 0.88),
  st(12.55, -0.66, 1.14, 1.07),
  st(12.02, -0.875, 1.2, 1.22),
  st(11.6, -1.23, 1.23, 1.3),
  st(11.1, -1.41, 1.24, 1.335),
  st(10.2, -1.445, 1.245, 1.345),
  st(-5.5, -1.445, 1.245, 1.345),
  st(-7.8, -1.43, 1.0, 1.26),
  st(-10.2, -1.37, 0.46, 0.98),
  st(-12.6, -1.24, -0.18, 0.6),
  st(-14.8, -1.08, -0.68, 0.22),
  st(-16.0, -1.0, -0.88, 0.04),
]);

export const NOSE_X = 14.3;
export const TAIL_X = -16.0;

/**
 * Cockpit floor (EST: seated eye 1.22 m above the floor, ~0.45 m seat reference point + 0.77 m eye height;
 * leaves room for the lower centre AFD above the pedestal in the T arrangement).
 */
export const FLOOR_Z = 0.2;

/** Pilot / copilot design eye (dossier §10). */
export const EYE_L: [number, number, number] = [10.9, -0.49, -1.02];
export const EYE_R: [number, number, number] = [10.9, 0.49, -1.02];

/**
 * Main instrument panel: one plane tilted 12 deg back (dossier §10), 1.8 m wide,
 * from the glareshield soffit down to the pedestal. Panel coordinates (u right,
 * v up) from its centre.
 */
export const MAIN_PANEL = {
  center_m: [11.654, 0, -0.5] as BodyVec,
  tiltDeg: 12,
  width: 1.8,
  height: 0.52,
};
/** AFD centres on the main panel (u, v): upper row 0.40 m below the eye (27 deg), AFD 3 directly below AFD 2. */
export const AFD_POS: readonly [number, number][] = [
  [-0.47, 0.123],
  [0, 0.123],
  [0, -0.123],
  [0.47, 0.123],
];
/** IESI left of AFD 3 and the landing-gear panel right of it (dossier §10). */
export const IESI_POS: [number, number] = [-0.235, -0.12];
export const GEAR_PANEL = { u: 0.265, v: -0.125, w: 0.15, h: 0.24 };

/** Glareshield front face (FCP centre, CTP 1 / 2 outboard, MASTER WARNING / CAUTION at the ends). */
export const GLARE_FACE = {
  center_m: [11.565, 0, -0.787] as BodyVec,
  tiltDeg: 30,
  width: 1.66,
  height: 0.08,
};
/** Glareshield hood: brow (aft edge) and the windshield base. */
export const GLARE_HOOD = { aftX: 11.595, topZ: -0.83, frontX: 12.02, frontZ: -0.8 };

/** Windshield: base (glareshield) and header stations, angular half-extent round the nose (rad from the top). */
export const WINDSHIELD = {
  baseX: 12.02,
  headerX: 11.1,
  halfAngle: 0.8,
  /** Centre post half-width (rad): EST 0.05 m post. */
  postHalf: 0.02,
};
/** Side windows (two per side, dossier §10): x ranges and the angular band on the section (rad from the top). */
export const SIDE_WINDOWS = {
  fwd: { x0: 10.25, x1: 11.02 },
  aft: { x0: 9.62, x1: 10.18 },
  roof: 0.66,
  sill: 1.12,
};
/** A-pillar angular width beyond the windshield side edge (rad). */
export const A_PILLAR = 0.07;

/**
 * Centre pedestal (dossier §10 / §12.4): forward section (MKPs) rising gently to the lower edge of the main
 * panel under AFD 3, then the flat top, 0.41 m above the floor.
 */
export const PEDESTAL = {
  width: 0.42,
  fwdTop: [11.6, -0.245] as [number, number], // [x, z]
  fwdBottom: [11.44, -0.206] as [number, number],
  topFwd: [11.44, -0.206] as [number, number],
  topAft: [10.3, -0.21] as [number, number],
};

/** Control wheels (dossier §10: 0.45 m ahead of each eye; hub 0.47 m below it so the wheel clears the PFD). */
export const YOKE_HUB_L: [number, number, number] = [11.36, -0.49, -0.51];
export const YOKE_HUB_R: [number, number, number] = [11.36, 0.49, -0.51];
/** Rudder pedals (hanging, pivot under the panel). */
export const PEDALS_L: [number, number, number] = [11.78, -0.49, -0.12];
export const PEDALS_R: [number, number, number] = [11.78, 0.49, -0.12];
/** Crew seats (floor point under the front of the seat pan). */
export const SEAT_L: [number, number, number] = [11.05, -0.5, FLOOR_Z];
export const SEAT_R: [number, number, number] = [11.05, 0.5, FLOOR_Z];

/** NOSE STEER handwheel on the pilot's side console (dossier §12.5), forward end. */
export const TILLER = { center_m: [11.2, -0.93, -0.33] as BodyVec };

/**
 * Mount frames for the builders owned by other agents (contract in context.ts).
 * Overhead: 0.8 m wide from the windshield header aft (dossier §10 says 0.50-0.60 m above the eye, but the
 * inner crown is only ~0.34 m above the design eye in a 2.69 m fuselage with the GXAG eye height, so the
 * panel sits ~0.27 m above the eye, sloping down at the front: EST).
 * Side consoles: along each sidewall, top 0.72 m below the eye (dossier §10 0.45 m is at the armrest), from
 * the seat to the panel; the pilot's NOSE STEER handwheel (TILLER) is built by the main cockpit at the forward
 * end of the left console.
 */
export const MOUNTS = {
  overhead: { center_m: [10.8, 0, -1.29] as BodyVec, facing: 'down' as const, tiltDeg: -8, width: 0.78, height: 0.55 },
  sideLeft: { center_m: [10.85, -1.02, -0.3] as BodyVec, facing: 'up' as const, tiltDeg: 0, width: 0.28, height: 0.62 },
  sideRight: { center_m: [10.85, 1.02, -0.3] as BodyVec, facing: 'up' as const, tiltDeg: 0, width: 0.28, height: 0.62 },
};
