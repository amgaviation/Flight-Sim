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
 * Main instrument panel (P1 / P2 / P3) frame, face tilted 15 deg back (dossier §10.0). Origin 'center': u
 * right, v up in the panel plane. The plate itself is the stepped P1 / P2 / P3 outline drawn in mainPanel.ts
 * (MIP_OUTLINE); this frame only fixes the plane.
 */
export const MIP: PanelPlacement & { width: number; height: number } = {
  // Top edge stays under the glareshield soffit (x 14.611, z -0.243); the panel extends 0.11 m lower than
  // the first estimate so the upper DU row could move down (see DU_ROW_V).
  center_m: [14.5407, 0, 0.0181] as BodyVec,
  facing: 'aft',
  tiltDeg: 15,
  // SCBG 1:1 main panel drawing (cm ruler): P1 + P2 + P3 overall width ~1.48 m.
  width: 1.48,
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
/**
 * DU centres (panel u, m), measured on the SCBG 1:1 main panel drawing: Capt outboard -0.504, Capt inboard
 * -0.292, upper +0.02, F/O inboard +0.291, F/O outboard +0.503 (DU openings 0.173 m). With the Captain eye at
 * y -0.53 the PFD is almost straight ahead of the pilot. The lower DU sits on P9 between the CDUs (P9 below).
 */
export const DU_U = { capt_out: -0.504, capt_in: -0.292, upper: 0.02, lower: 0, fo_in: 0.291, fo_out: 0.503 } as const;
/**
 * Offsets on the SCBG drawing are measured from the DU row centre (drawing v = -0.004 m); `mv(dv)` converts a
 * drawing offset above / below the DU centre to MIP panel v.
 */
export const mv = (dv: number): number => DU_ROW_V + dv;
/** MIP bottom edges (panel v): P1 / P3 lower strips end 0.196 m below the DU centre, P2 at the DU bezel (0.106 m). */
export const MIP_BOTTOM_V = mv(-0.196);
export const P2_BOTTOM_V = mv(-0.106);
/** P2 half-width at its bottom edge (the lower strips P1-3 / P3-1 end there; P9 sits between them). */
export const P2_HALF_W = 0.265;
/** Legacy name: lower DU centre on the MIP (unused since the lower DU moved to P9). */
export const LOWER_DU_V = DU_ROW_V - 0.222;

/**
 * Glareshield (P7): front face carrying the MCP / EFIS / master lights, and the hood above it. The face is the
 * MCP height (0.072 m on the SCBG drawing, plus trim: 0.075 m) with its top at the hood (z -0.34) and sits 0.09 m
 * further forward than the first estimate, so that from the design eye the MIP upper strip (display select,
 * A/P-A/T-FMC lights, P2 controls, up to ~0.17 m above the DU centres) is visible under it, as in the aircraft
 * (EST: sight line from EYE_CAPT past the face bottom edge; the hood top stays 0.075 m below the eye).
 */
export const GLARE = {
  /** Front face centre (the MCP plane), vertical. */
  face: { center_m: [14.43, 0, -0.3025] as BodyVec, facing: 'aft' as const, tiltDeg: 0, width: 1.46, height: 0.075 },
  /** Hood: brow (aft edge) at the lip, top height, forward edge at the windshield base. */
  // The hood brow overhangs the MCP face by ~3.5 cm (brow bottom z -0.327 stays above the sight line to the MIP).
  lipX: 14.4,
  topZ: -0.345,
  frontX: 14.56,
  frontZ: -0.33,
  /** Soffit (underside) height between the face and the main panel. */
  soffitZ: -0.265,
};

/**
 * Forward electronic panel (P9): the lower DU between the two CDUs (SCBG drawing: CDU centres +/-0.176 m, CDU
 * tops level with the bottom of the P2 DU section), on a sloping face from the P2 bottom edge (x 14.535,
 * z 0.040) down to the front of the control stand (x 14.235, z 0.40): 0.466 m long, 39.8 deg from vertical.
 */
export const P9: PanelPlacement & { width: number; height: number } = {
  center_m: [14.385, 0, 0.2202] as BodyVec,
  facing: 'aft',
  tiltDeg: 39.8,
  width: 0.53,
  height: 0.466,
};

/**
 * Control stand (throttle quadrant) top surface (EST from 737NG photographs): its forward edge meets the bottom
 * edge of the CDU panel (P9: x 14.24, z 0.40) and it rises aft to the start levers, so the CDU keyboards stay in
 * view above the stand (a flat top at z 0.30 hid the lower half of both CDUs behind the stand block). `fwdZ` /
 * `aftZ` are the top heights at the two ends; `topZ` is the height at the centre; `tiltDeg` the slope of the top
 * (panel tilt: forward end lower).
 */
export const STAND = (() => {
  const xFwd = 14.235;
  const xAft = 13.5;
  const fwdZ = 0.4;
  const aftZ = 0.22;
  // Width: SCBG control stand drawing (top view, 2,830 px/m): stand top ~0.226 m wide, trim wheel centres +/-0.133 m.
  return { xFwd, xAft, fwdZ, aftZ, topZ: (fwdZ + aftZ) / 2, width: 0.232, tiltDeg: (Math.atan2(fwdZ - aftZ, xFwd - xAft) * 180) / Math.PI };
})();
/** Height (body z) of the control stand top at body x. */
export function standTopZ(x: number): number {
  return STAND.aftZ + ((STAND.fwdZ - STAND.aftZ) * (x - STAND.xAft)) / (STAND.xFwd - STAND.xAft);
}
/**
 * Aft electronic pedestal (P8): x range, top height. SCBG P8 drawing: three 146 mm module columns (~0.45 m
 * with rails), fire panel plus six module rows ~0.55 m long (0.56 here). The top sits just below the
 * aft end of the control stand, about level with the crew seat cushions (seat pan top z ~0.23), with the inboard
 * armrests ~0.2 m higher (EST from NG photographs; the first estimate, z 0.37, put it 0.14 m below the cushions).
 */
// Width: SCBG P8 drawing, three 146 mm module columns (0.44 m) plus rails.
export const AFT_PED = { xFwd: 13.5, xAft: 12.94, topZ: 0.245, width: 0.45 };

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
 * and aft to ~0.55 m above the eye (dossier §10.0), 0.66 m wide. Aft
 * overhead: directly above the crew, 0.35 m deep. Side consoles along
 * each sidewall behind the tiller shelf.
 */
export const MOUNTS = {
  // SCBG 1:1 overhead drawing: forward overhead 0.66 x 0.66 m (four 146 mm columns + a 74 mm centre column and the
  // bottom row), aft overhead 0.66 x 0.35 m.
  overheadFwd: { center_m: [13.8, 0, -0.87] as BodyVec, facing: 'down' as const, tiltDeg: -18, width: 0.66, height: 0.66 },
  overheadAft: { center_m: [13.31, 0, -0.99] as BodyVec, facing: 'down' as const, tiltDeg: -4, width: 0.66, height: 0.35 },
  sideLeft: { center_m: [13.35, -0.98, 0.12] as BodyVec, facing: 'up' as const, tiltDeg: 0, width: 0.3, height: 0.9 },
  sideRight: { center_m: [13.35, 0.98, 0.12] as BodyVec, facing: 'up' as const, tiltDeg: 0, width: 0.3, height: 0.9 },
};
