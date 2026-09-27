/**
 * Cessna 172S Skyhawk SP (steam gauges, NAV II) cabin and instrument-panel geometry.
 *
 * Body frame (src/aircraft/c172s-common/fdm.ts): metres from the datum, x forward = sta(FS in),
 * y right, z down; heights above the ground plane convert with hz(h).
 *
 * Sources:
 *  - POH 172SPHUS Rev 5 Fig 6-4 "Internal cabin dimensions" (same airframe as the NAV III POH
 *    Fig 6-6): cabin height 48 in, 41 in at the instrument panel, cabin width 39.5 in at the
 *    window line and 34 in at the floor, forward doorpost bulkhead FS 65.3, door opening
 *    32/37 in wide (top/bottom) and 40.5/39 in high; front seat occupant arm FS 34-46.
 *  - POH Fig 7-2 (steam instrument panel line drawing, items 1-43) and Sec 7 "Instrument panel".
 *    Panel positions are measured on Fig 7-2 at 38.5 px/in (scale from the 6.25 in radio stack
 *    and the 40.5 in panel width; the six-pack spacing then comes out 3.6 in horizontally and
 *    3.9 in vertically, the 3-1/8 in cases 3.25 in square): X = inches right of the centreline
 *    (the magnetic compass / radio-stack reference), Z = inches below the panel's upper edge
 *    under the glareshield lip. +/-0.3 in.
 *  - Reference photograph of a 2004 NAV II 172SP panel (flight-school N146TC, straight-on view)
 *    for colours and for the items the line drawing leaves out (avionics breaker labels, the
 *    annunciator panel with its DIM/TST switch above the altimeter, the lower breaker order).
 * Everything else is EST and says so.
 */
import type { BodyVec } from '../../../cockpit/frame';
import { GROUND_Z, sta } from '../../c172s-common/fdm';

export const IN = 0.0254;
/** Body z of a height above the ground plane (m). */
export const hz = (h: number): number => GROUND_Z - h;

/** Cabin floor (carpet) height above ground. EST: roof lining 1.98 m minus the POH 48 in cabin height (same as the G1000 variant). */
export const FLOOR_H = 0.76;
export const FLOOR_Z = hz(FLOOR_H);

/**
 * Main instrument panel frame: face at FS 18 (POH Fig 6-4: face of the instrument panel 47-49 in
 * forward of the doorpost bulkhead FS 65.3; EST FS 18 at the flat centre), upper edge 1.555 m
 * above ground (EST: glareshield top 1.60 m), 40.6 in wide (Fig 7-2), 17.2 in from the upper
 * edge to the bottom of the black lower panel (Fig 7-2: grey upper panel 13.2 in, lower switch /
 * engine-control panel 4.0 in). Tilt EST 4 deg (top leaning forward).
 */
export const PANEL = { fs: 18, topH: 1.555, widthIn: 40.6, heightIn: 17.2, upperIn: 13.2, tiltDeg: 4 } as const;
export const PANEL_W = PANEL.widthIn * IN;
export const PANEL_H = PANEL.heightIn * IN;
export const PANEL_CENTER: BodyVec = [sta(PANEL.fs), 0, hz(PANEL.topH - PANEL_H / 2)];
/** Panel-local x (m from the left edge, 'top-left' convention) of X inches right of the centreline. */
export const px = (Xin: number): number => PANEL_W / 2 + Xin * IN;
/** Panel-local y (m down from the upper edge) of Z inches below the upper edge. */
export const py = (Zin: number): number => Zin * IN;
/** Upper panel corner radius (Fig 7-2: the upper corners are cut in a ~5.3 in arc). */
export const PANEL_CORNER_IN = 5.3;

/**
 * Instrument and control centres (X, Z inches), POH Fig 7-2 item numbers in brackets.
 * 3-1/8 in cases: flight instruments, CDIs, ADF indicator, tachometer; 2-1/4 in: engine cluster, clock.
 */
export const POS = {
  // Engine cluster and clock (left sub-panel, POH Sec 7 "Pilot side panel layout").
  fuelQty: { X: -18.4, Z: 6.1 }, // [3]
  egtFf: { X: -15.9, Z: 6.1 }, // [4]
  oil: { X: -18.4, Z: 9.2 }, // [1]
  vacAmp: { X: -15.9, Z: 9.2 }, // [2]
  clock: { X: -16.0, Z: 3.0 }, // [5]
  // Six-pack ("T" around the gyros, POH Sec 7).
  asi: { X: -12.9, Z: 3.0 }, // [7]
  ai: { X: -9.3, Z: 2.9 }, // [9]
  alt: { X: -5.6, Z: 2.9 }, // [12]
  tc: { X: -12.9, Z: 6.75 }, // [6]
  dg: { X: -9.3, Z: 6.75 }, // [8]
  vsi: { X: -5.6, Z: 6.75 }, // [11]
  // Right-hand sub-panel of the pilot side: CDIs, ADF bearing indicator, tachometer.
  cdi1: { X: -2.1, Z: 2.9 }, // [15] KI 209A (NAV 1 / GPS)
  cdi2: { X: -2.1, Z: 6.75 }, // [15] KI 208 (NAV 2)
  adf: { X: -2.1, Z: 10.6 }, // [14] KI 227
  tach: { X: -5.6, Z: 10.6 }, // [10]
  // Annunciator panel above the altimeter (POH Sec 7) with its DIM / TST toggle; NAV/GPS switch.
  annPanel: { X: -6.6, Z: 0.85, w: 3.0, h: 0.62 }, // [13]
  annSwitch: { X: -4.45, Z: 0.85 },
  navGps: { X: -2.1, Z: 0.65 }, // Supplement 19 Fig 2 item 4: NAV/GPS switch-annunciator above the #1 CDI
  regPlacard: { X: -11.6, Z: 0.7 },
  // Shock-mounted flight-instrument sub-panel outline.
  sixPack: { X0: -14.7, X1: -3.9, Z0: 0.8, Z1: 8.7 },
  // Avionics circuit-breaker panel [40] (black strip, lower left of the upper panel).
  avnCb: { X0: -19.4, X1: -10.6, Z0: 10.85, Z1: 12.35 },
  // Radio stack (6.36 in wide, centre X +3.44).
  stack: { X0: 0.26, X1: 6.62, Z0: 0.13, Z1: 13.1 },
  // Right panel: ELT remote switch [22], hour meter [23], glove box [24].
  elt: { X: 16.5, Z: 3.0 },
  hobbs: { X: 16.5, Z: 4.7 },
  gloveBox: { X0: 12.1, X1: 18.4, Z0: 13.45, Z1: 16.5 },
  // Control-wheel column bushings through the panel (Fig 7-2 round collars).
  yokeCol: { X: 9.35, Z: 10.1 },
  // ---------------------------------------------------------------- lower (black) panel
  key: { X: -18.0, Z: 15.0 }, // [39]
  master: { X: -16.1, Z: 15.1 }, // [38]
  /** Upper breaker row [37] (7 breakers left of the avionics master, WARN / ALT FLD right of it). */
  cbRowZ: 14.2,
  cbLeftX0: -15.15,
  cbPitch: 0.73,
  cbRightX: [-8.5, -7.75],
  avnMaster: { X: -9.4, Z: 15.0 }, // [36]
  /** Switch-breaker row [37]. */
  swRowZ: 16.05,
  swX0: -15.1,
  swPitch: 0.8,
  dimmerUpper: { X: -2.3, Z: 14.6 }, // [31] RADIO / PANEL
  dimmerLower: { X: -2.3, Z: 16.5 }, // [32] GLARESHIELD / PEDESTAL
  throttle: { X: 0.0, Z: 14.7 }, // [30]
  mixture: { X: 2.1, Z: 14.7 }, // [28]
  altStatic: { X: 1.0, Z: 16.6 }, // [29]
  flap: { X: 6.9, Z: 15.2 }, // [27]
  cabinHeat: { X: 11.0, Z: 14.0 }, // [25]
  cabinAir: { X: 11.0, Z: 15.6 }, // [26]
} as const;

/**
 * Pilot design eye: FS 42 (seat arm range FS 34-46), in line with the attitude indicator
 * (X -9.3 in), 1.74 m above ground (EST: 0.23 m cushion + 0.75 m seated eye height). Same
 * design eye as the G1000 variant.
 */
export const EYE: [number, number, number] = [sta(42), -9.3 * IN, hz(1.74)];
export const EYE_R: [number, number, number] = [sta(42), 9.3 * IN, hz(1.74)];

/** Control wheels: columns through the panel at X +/-9.35 in, Z 10.1 in (Fig 7-2); hub 0.20 m aft of the panel (EST). */
export const YOKE = { y: 9.35 * IN, x: sta(PANEL.fs) - 0.2, z: hz(PANEL.topH - 10.1 * IN) };
/** Rudder pedals: floor pivots near the firewall (EST FS 6), one pair per seat, 0.23 m apart. */
export const PEDALS = { x: sta(6), y: 9.35 * IN, z: hz(0.74), spacing: 0.23 };

/** Glareshield: brow 1.2 in aft of the panel face, top 1.60 m, forward to the windshield base (EST FS 12). */
export const GLARE = { browX: sta(PANEL.fs + 1.2), topH: 1.6, depth: 0.19, drop: 0.05 };

/**
 * Pedestal below the lower centre panel (POH Fig 7-2 items 33-35, 41, 42): face from the lower
 * panel's bottom edge down and aft to the floor at FS 25, 6 in wide (EST from photographs).
 */
export const PED = { topFs: 18.6, topH: PANEL.topH - PANEL_H - 0.005, botFs: 25, botH: 0.8, width: 6 * IN };

/** Front seats (seat pan front edge FS 32, EST from the FS 34-46 occupant arm range); rear bench at FS 64. */
export const SEATS = { frontFs: 32, y: 10 * IN, rearFs: 64 };

/** Cabin section (inner lining), EST from POH Fig 6-4. */
export const CABIN = {
  /** Half width (m) vs FS: 0.52 m at the instrument panel so its 40.6 in span (Fig 7-2) meets the door posts. */
  halfWidth: { x: [10, 18, 27, 65, 90, 115], y: [0.5, 0.525, 0.52, 0.51, 0.47, 0.42] },
  roofH: { x: [30, 42, 70, 95, 115], y: [1.9, 1.97, 1.98, 1.92, 1.8] },
  cornerR: 0.16,
  floorRatio: 34 / 39.5,
};

/** Windshield: base at FS 12.5 (glareshield), top edge FS 41 at the roof; A-pillars from (FS 15, 1.60 m) to (FS 41, 1.96 m). */
export const WINDSHIELD = { baseFs: 12.5, baseH: 1.605, topFs: 41, topH: 1.965, pillarBaseFs: 15, pillarTopFs: 41.5 };

/** Cabin doors (POH Fig 6-4): opening FS 26 (bottom) / 30 (top) to FS 65.3, sill 0.80 m, top 1.83 m. */
export const DOOR = { fwdFsBottom: 26, fwdFsTop: 30, aftFs: 65.3, sillH: 0.8, topH: 1.83 };
/** Door window (the openable storm window is its lower aft part), rear side window. */
export const DOOR_WINDOW = { fs0: 33.4, fs1: 63.7, h0: 1.46, h1: 1.79 };
export const REAR_WINDOW = { fs0: 68, fs1: 95, h0: 1.46, h1: 1.79 };

/** Overhead console (flood lights, dome switch, vents): centre on the headliner, FS 36-48 (EST from photographs). */
export const OVERHEAD = { fs0: 34, fs1: 50, width: 0.2 };

/** Linear interpolation in a {x, y} table (clamped). */
export function lerpTable(t: { x: readonly number[]; y: readonly number[] }, v: number): number {
  const { x, y } = t;
  if (v <= x[0]) return y[0];
  for (let i = 1; i < x.length; i++) {
    if (v <= x[i]) {
      const f = (v - x[i - 1]) / (x[i] - x[i - 1]);
      return y[i - 1] + (y[i] - y[i - 1]) * f;
    }
  }
  return y[y.length - 1];
}
