/**
 * Boeing 737-800 flight-deck geometry (body metres: x fwd, y right, z down,
 * from the datum; fdm.ts). Shared by every cockpit file and by the overhead
 * / side-console builders (cockpit/overhead/**, cockpit/side/**, other
 * agent), which mount on the frames in MOUNTS.
 *
 * Anchors (dossier docs/aircraft/b737-800.md §2.1 / §10.0): Captain design
 * eye EYE_CAPT = [13.754, -0.53, -0.42] (fdm.ts), flight-deck floor 1.12 m
 * below it (z = 0.70), glareshield top ~0.08 m below the eye with its lip
 * ~0.62 m ahead, main panel face ~0.78 m ahead tilted back ~15 deg, DU
 * centres ~0.20 m below the glareshield lip, control wheel hub ~0.45 m ahead
 * and 0.35 m below the eye. Everything else here is EST from 737NG
 * flight-deck photographs, scaled against the 8 x 8 in DUs (0.204 m bezel,
 * avionics B737_HW).
 */
import type { BodyVec, PanelPlacement } from '../../../cockpit/frame';
import { EYE_CAPT } from '../fdm';

export const EYE_L: [number, number, number] = [EYE_CAPT[0], EYE_CAPT[1], EYE_CAPT[2]];
export const EYE_R: [number, number, number] = [EYE_CAPT[0], -EYE_CAPT[1], EYE_CAPT[2]];

/** Flight-deck floor (body z): 1.12 m below the design eye (dossier §2.1). */
export const FLOOR_Z = EYE_CAPT[2] + 1.12;

/** Aft end of the flight deck (bulkhead / door frame), EST ~1.15 m behind the eye. */
export const X_AFT = 12.6;

/**
 * Main instrument panel (P1 / P2 / P3) as one flat panel, face tilted 15 deg
 * back (dossier §10.0). Origin 'center': u right, v up in the panel plane.
 */
export const MIP: PanelPlacement & { width: number; height: number } = {
  // Top edge stays under the glareshield soffit (x 14.611, z -0.243); the panel extends 0.11 m lower than
  // the first estimate so the upper DU row could move down (see DU_ROW_V).
  center_m: [14.5407, 0, 0.0181] as BodyVec,
  facing: 'aft',
  tiltDeg: 15,
  width: 1.64,
  height: 0.54,
};
/**
 * Panel v of the upper DU row centre (z = -0.062 m, 0.36 m below the eye). From the design eye the whole
 * active area of the PFD / ND / upper DU must be visible under the glareshield (737 eye reference
 * position); the first estimate (0.28 m below the eye) hid the FMA and the top of the speed and altitude
 * tapes behind the glareshield, so the row is 0.08 m lower (EST: sight line from EYE_CAPT past the
 * glareshield soffit edge at z -0.24).
 */
export const DU_ROW_V = 0.083;
/** DU centres (panel u, m). Captain PFD / ND ~0.11 m either side of the eye line; mirrored for the F/O. */
export const DU_U = { capt_out: -0.64, capt_in: -0.425, upper: 0, lower: 0, fo_in: 0.425, fo_out: 0.64 } as const;
/** Lower DU centre (panel v): directly below the upper DU (avionics B737_DU_LAYOUT: 0.22 m lower). */
export const LOWER_DU_V = DU_ROW_V - 0.222;

/** Glareshield (P7): front face carrying the MCP / EFIS / master lights, and the hood above it. */
export const GLARE = {
  /** Front face centre (the MCP plane), tilted 8 deg (top leaning away). */
  face: { center_m: [14.338, 0, -0.29] as BodyVec, facing: 'aft' as const, tiltDeg: 0, width: 1.46, height: 0.1 },
  /** Hood: brow (aft edge) at the lip, top height, forward edge at the windshield base. */
  lipX: 14.365,
  topZ: -0.345,
  frontX: 14.56,
  frontZ: -0.33,
  /** Soffit (underside) height between the face and the main panel. */
  soffitZ: -0.243,
};

/** Forward electronic panel (P9): the two CDUs side by side on the sloping face below P2. */
export const P9: PanelPlacement & { width: number; height: number } = {
  center_m: [14.33, 0, 0.3] as BodyVec,
  facing: 'aft',
  tiltDeg: 48,
  width: 0.34,
  height: 0.27,
};

/** Control stand (throttle quadrant) top surface: x range and height (EST). */
export const STAND = { xFwd: 14.23, xAft: 13.5, topZ: 0.3, width: 0.32 };
/** Aft electronic pedestal (P8): x range, top height (EST ~0.36 m wide, ~0.75 m long). */
export const AFT_PED = { xFwd: 13.5, xAft: 12.78, topZ: 0.37, width: 0.36 };

/** Control wheel hubs (dossier §10.0: ~0.45 m ahead, ~0.35 m below the eye, directly ahead of each pilot). */
export const YOKE_HUB_L: [number, number, number] = [14.2, -0.53, -0.065];
export const YOKE_HUB_R: [number, number, number] = [14.2, 0.53, -0.065];
/** Rudder pedal pivots (hanging pedals, pads ~0.2 m below). */
export const PEDALS_L: [number, number, number] = [14.62, -0.53, 0.36];
export const PEDALS_R: [number, number, number] = [14.62, 0.53, 0.36];
/** Crew seat reference (floor point under the front of the seat pan). */
export const SEAT_L: [number, number, number] = [13.52, -0.53, FLOOR_Z];
export const SEAT_R: [number, number, number] = [13.52, 0.53, FLOOR_Z];
/** Captain's nose-wheel steering tiller (left sidewall shelf, ~0.45 m below and ~0.35 m outboard of the eye; EST, the dossier's 0.6 m would sit inside this model's narrower sidewall). */
export const TILLER: { center_m: BodyVec } = { center_m: [14.05, -0.88, 0.06] };
/** Sidewall shelves (the tiller housing on the left; the side-console agent extends them aft). */
export const SIDE_SHELF = { xFwd: 14.3, xAft: 13.85, z: 0.1, yIn: 0.78, yOut: 1.12 };

/** Standby magnetic compass on the windshield centre post (NG: stowable compass at the post top). */
export const COMPASS: BodyVec = [14.3, 0, -0.66];

/**
 * Mount frames for the builders owned by other agents (see context.ts).
 * Forward overhead (P5 fwd): from ~0.35 m above / ahead of the eye sloping up
 * and aft to ~0.55 m above the eye (dossier §10.0), ~0.95 m wide. Aft
 * overhead: directly above the crew, ~0.40 m wide deep. Side consoles along
 * each sidewall behind the tiller shelf.
 */
export const MOUNTS = {
  overheadFwd: { center_m: [13.8, 0, -0.87] as BodyVec, facing: 'down' as const, tiltDeg: -18, width: 0.95, height: 0.64 },
  overheadAft: { center_m: [13.28, 0, -0.99] as BodyVec, facing: 'down' as const, tiltDeg: -4, width: 0.9, height: 0.42 },
  sideLeft: { center_m: [13.35, -0.98, 0.12] as BodyVec, facing: 'up' as const, tiltDeg: 0, width: 0.3, height: 0.9 },
  sideRight: { center_m: [13.35, 0.98, 0.12] as BodyVec, facing: 'up' as const, tiltDeg: 0, width: 0.3, height: 0.9 },
};
