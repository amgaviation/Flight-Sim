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
 * Main instrument panel plane: tilted 12 deg (top edge forward, facing up toward the eye), centred at
 * `center_m`. Panel coordinates (u right, v up) from that centre. Global Vision layout (photo N835GL, fix round 1):
 * the upper row AFD 1 | IESI + TAWS + placards | AFD 2 | GEAR AND BRAKES | AFD 4 on the centre band, the outboard
 * wings (STALL PUSHER, gasper, EMS CDU) angled toward each pilot, and AFD 3 on the steep forward face of the
 * pedestal below (PED_FACE).
 */
export const MAIN_PANEL = {
  center_m: [11.654, 0, -0.5] as BodyVec,
  tiltDeg: 12,
  /** Centre band (between the wings): u -0.605 .. 0.605, v -0.035 .. 0.255. */
  band: { u0: -0.605, u1: 0.605, v0: -0.035, v1: 0.255 },
  /** Outboard wings: 0.325 m wide from |u| 0.605, v -0.05 .. 0.255, turned 14 deg toward the pilot (EST from the photo). */
  wing: { w: 0.325, v0: -0.05, v1: 0.255, yawDeg: 14 },
  // Legacy extents (shell backing box).
  width: 1.86,
  height: 0.41,
};

/** Body point of main-panel coordinates (u, v) (the panel's own tilt: +v goes up and forward). */
export function mainPoint(u: number, v: number, n = 0): BodyVec {
  const t = (MAIN_PANEL.tiltDeg * Math.PI) / 180;
  const c = MAIN_PANEL.center_m;
  // Panel basis in body axes: u = +y, v = (sin t, 0, -cos t), n (toward the viewer) = (-cos t, 0, -sin t).
  return [c[0] + v * Math.sin(t) - n * Math.cos(t), c[1] + u, c[2] - v * Math.cos(t) - n * Math.sin(t)];
}

/**
 * AFD centres on the main-panel plane (u, v). AFD 1 / 2 / 4 in the upper row, their bezels separated only by the
 * ~95 mm IESI / TAWS column (left) and GEAR AND BRAKES column (right): centres u -/+0.43 (photo N835GL).
 * AFD_POS[2] (AFD 3) is not on this plane: it is on the pedestal forward face (PED_FACE.afd).
 */
export const AFD_POS: readonly [number, number][] = [
  [-0.43, 0.123],
  [0, 0.123],
  [0, -0.123],
  [0.43, 0.123],
];
/** Top of the upper-row AFD bezels (v). */
export const AFD_TOP_V = 0.123 + 0.096 + 0.014;
/** IESI at the top of the left centre column, level with the top of the PFD (photo c_centre). */
export const IESI_POS: [number, number] = [-0.215, AFD_TOP_V - 0.0475];
/** TAWS panel (G/S, FLAPS, TERRAIN) under the IESI, then the airspeed-limits placard (photo c_centre). */
export const TAWS_PANEL = { u: -0.215, v: 0.097, w: 0.085, h: 0.07 };
/** GEAR AND BRAKES column between AFD 2 and AFD 4 (u, v = centre; photo c_centre). */
export const GEAR_PANEL = { u: 0.215, v: (AFD_TOP_V + MAIN_PANEL.band.v0) / 2, w: 0.09, h: AFD_TOP_V - MAIN_PANEL.band.v0 };

/**
 * Pedestal forward face carrying AFD 3 (photos N835GL / EB190582): from the main band's lower edge it drops
 * steeply (EST 40 deg back from vertical) to the pedestal top; the AFD 3 bezel top is ~0.10 m below the upper
 * row's bezels.
 */
export const PED_FACE = (() => {
  const top = mainPoint(0, MAIN_PANEL.band.v0);
  const back = (40 * Math.PI) / 180;
  const len = 0.34;
  return {
    top: [top[0], top[2]] as [number, number],
    bottom: [top[0] - len * Math.sin(back), top[2] + len * Math.cos(back)] as [number, number],
    /** Tilt from vertical (deg) and length (m) along the face. */
    backDeg: 40,
    len,
    /** AFD 3 centre distance down the face from its top edge. */
    afdS: 0.08 + 0.114,
  };
})();

/** Glareshield front face (FCP centre, CTP 1 / 2, MASTER WARNING/CAUTION, ROLL SPLRS, HUD / EVS knobs outboard). */
export const GLARE_FACE = {
  center_m: [11.553, 0, -0.787] as BodyVec,
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
  /** Centre post half-width (rad): a dark, fairly wide post from the seat (photo N835GL): EST 0.08 m. */
  postHalf: 0.031,
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
 * Centre pedestal (photos N835GL / EB190582): 0.54 m wide between tan-leather side rails, wide enough for
 * MKP | quadrant | MKP side by side. Forward end: the steep AFD 3 face (PED_FACE); top 0.41 m above the floor from
 * the foot of that face aft. Rows on the top (distance aft of its forward edge): MKP 1 / 2 (u -/+0.17) beside the
 * narrow throttle quadrant (FLIGHT SPOILER slot + two thrust levers, ~0.14 m centre channel); CCP 1 / 2 palm rests
 * aft of the MKPs, ENGINE RUN at the aft end of the quadrant; the ACP row; the reversion / display-dimmer panel
 * (left), PARK/EMER BRAKE gate and SLAT/FLAP lever (centre) and COCKPIT LIGHTS panel (right); then the aft section
 * (trims, GLD, IRS) that the photographs do not show (EST).
 */
export const PEDESTAL = {
  width: 0.54,
  fwdTop: PED_FACE.top,
  fwdBottom: PED_FACE.bottom,
  topFwd: PED_FACE.bottom,
  topAft: [10.3, -0.21] as [number, number],
  /** Row stations on the top panel (m aft of the forward edge). */
  row: { mkp: 0.075, ccp: 0.23, acp: 0.39, mid: 0.54, aft: 0.72, aft2: 0.88 },
  /** Lateral centres (u from the centreline). */
  mkpU: 0.17,
};

/**
 * Control wheels: hub at about the lower third of AFD 1 / 4, directly in front of each pilot, the horns reaching
 * above the PFD's mid-height (photo N835GL, c_lwing): 0.50 m ahead of and 0.37 m below the eye (EST: seen from the design eye the hub then overlays the lower third of the PFD, as in the photo).
 */
export const YOKE_HUB_L: [number, number, number] = [11.4, -0.49, -0.655];
export const YOKE_HUB_R: [number, number, number] = [11.4, 0.49, -0.655];
/** Rudder pedals (hanging, pivot under the panel). */
export const PEDALS_L: [number, number, number] = [11.78, -0.49, -0.12];
export const PEDALS_R: [number, number, number] = [11.78, 0.49, -0.12];
/** Crew seats (floor point under the front of the seat pan). */
export const SEAT_L: [number, number, number] = [11.05, -0.5, FLOOR_Z];
export const SEAT_R: [number, number, number] = [11.05, 0.5, FLOOR_Z];

/**
 * NOSE STEER tiller: a black D-loop crank handle on a round hub set flush into the top of the pilot's tan-leather
 * side console, forward end, with a cup holder just aft (photo EB190582 e_tiller). z = the console top
 * (MOUNTS.sideLeft), so the hub sits flush.
 */
export const TILLER = { center_m: [11.16, -0.955, -0.303] as BodyVec };

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
  // Shifted 0.055 m aft of the GX position so the Vision forward fitting strip (compass, reading lights) clears the
  // windshield header (EST).
  overhead: { center_m: [10.745, 0, -1.29] as BodyVec, facing: 'down' as const, tiltDeg: -8, width: 0.78, height: 0.55 },
  sideLeft: { center_m: [10.85, -1.02, -0.3] as BodyVec, facing: 'up' as const, tiltDeg: 0, width: 0.28, height: 0.62 },
  sideRight: { center_m: [10.85, 1.02, -0.3] as BodyVec, facing: 'up' as const, tiltDeg: 0, width: 0.28, height: 0.62 },
};
