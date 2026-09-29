/**
 * Cessna 172S NAV III (G1000 NXi) cabin and instrument-panel geometry.
 *
 * Body frame (src/aircraft/c172s-common/fdm.ts): metres from the datum (basic empty CG,
 * FS 38.1 in), x forward = sta(FS in), y right, z down; heights above the ground plane
 * convert with hz(h).
 *
 * Sources:
 *  - POH 172SPHBUS-00 Fig 6-6 "Internal cabin dimensions": cabin height 48.00 in (FS ~45) and
 *    41.00 in at the instrument panel, cabin width 39.50 in at the lower window line and
 *    34.00 in at the floor, forward doorpost bulkhead FS 65.30, cabin door opening 32/37 in
 *    wide (top/bottom), 40.5/39 in high; pilot and front passenger arm FS 34-46 (Fig 6-3).
 *  - POH Fig 7-2 (panel photo and legend) and Sec 7 "Instrument panel" (layout of every item).
 *  - Fig 6-6 side view (5.0 px/in): the windshield runs from the cowl deck to the roof at the forward
 *    doorpost (FS ~29); the cabin door's forward edge is FS 27-30, the roof peak (48 in) near FS 43.
 *  - Panel positions: measured on the straight-on photograph Wikimedia Commons
 *    "Cessna 172SP G1000 01.jpg" (Coyau, 2014) at 52.3 px/in, scale from the GDU bezel width
 *    (315 mm, controls.ts UNIT_SIZE_MM) and cross-checked with the 3-1/8 in standby instruments;
 *    centreline at the windshield compass. X = inches right of the centreline, Z = inches below
 *    the panel's upper edge (under the glareshield lip). +/-0.2 in.
 * Everything else is EST and says so.
 */
import type { BodyVec } from '../../../cockpit/frame';
import { GROUND_Z, sta } from '../../c172s-common/fdm';

export const IN = 0.0254;
/** Body z of a height above the ground plane (m). */
export const hz = (h: number): number => GROUND_Z - h;

/** Cabin floor (carpet) height above ground. EST: roof lining 1.98 m (exterior roof 2.02 m) minus the POH 48 in cabin height. */
export const FLOOR_H = 0.76;
export const FLOOR_Z = hz(FLOOR_H);

/**
 * Main instrument panel: face at FS 18 (POH Fig 6-6 "face of instrument panel", 48.75 in forward
 * of the forward doorpost bulkhead at FS 65.30 -> FS 16.5 at the sides, EST FS 18 at the centre
 * where the panel is flat), upper edge 1.555 m above ground, 18.8 in tall (photograph: top of the
 * grey panel to the bottom of the black lower panel), 39.5 in wide (cabin width at the lower window
 * line, POH Fig 6-6). Tilt EST 4 deg (top leaning forward).
 */
export const PANEL = { fs: 18, topH: 1.555, width: 39.5 * IN, heightIn: 18.8, tiltDeg: 4 } as const;
export const PANEL_H = PANEL.heightIn * IN;
export const PANEL_CENTER: BodyVec = [sta(PANEL.fs), 0, hz(PANEL.topH - PANEL_H / 2)];
/** Panel-local x (m from the left edge, 'top-left' convention) of a position X inches right of the centreline. */
export const px = (Xin: number): number => PANEL.width / 2 + Xin * IN;
/** Panel-local y (m down from the top edge) of a position Z inches below the upper edge. */
export const py = (Zin: number): number => Zin * IN;
/** Grey upper panel ends / black lower panel starts (photograph y 893 px). */
export const LOWER_PANEL_Z = 13.6;

/**
 * Pilot design eye: FS 42 (seat arm range FS 34-46, mid position; EST eye 1 in forward of the
 * occupant CG arm), 9.2 in left of the centreline (in front of the PFD, POH Sec 7 "The PFD,
 * centered on the instrument panel in front of the pilot"), 1.74 m above ground = 0.98 m above
 * the floor (EST: 0.23 m compressed seat cushion + 0.75 m seated eye height, 50th percentile).
 * The glareshield top then sits ~8 deg below the horizon and the cowling is visible over it.
 */
export const EYE: [number, number, number] = [sta(42), -9.2 * IN, hz(1.74)];
export const EYE_R: [number, number, number] = [sta(42), 9.2 * IN, hz(1.74)];

/** Control wheels: centred on the PFD / copilot position (photograph), column through the panel at Z 11.8 in, hub 0.20 m aft of the panel (EST). */
export const YOKE = { y: 9.2 * IN, x: sta(PANEL.fs) - 0.2, z: hz(PANEL.topH - 11.8 * IN), colZin: 11.8 };
/** Rudder pedals: floor pivots near the firewall (EST FS 6), 0.23 m apart per seat. */
export const PEDALS = { x: sta(6), y: 9.2 * IN, z: hz(0.74), spacing: 0.23 };

/** Glareshield: brow 1.2 in aft of the panel face, top 1.60 m (at the centre), forward to the windshield base (EST FS 12). */
export const GLARE = { browX: sta(PANEL.fs + 1.2), topH: 1.6, depth: 0.19, drop: 0.03 };

/**
 * Glareshield / upper panel edge arc (POH Fig 7-2; photographs "Cessna 172SP G1000 01.jpg" and "C172S G1000
 * in flight.jpg"): the padded hood's aft edge follows a gentle arc across the panel and sweeps down around
 * the outboard corners ("ears"), and the grey panel's top edge follows it.
 * EST from the photographs: 0.6 in lower at X = +/-15 in than at the centre (parabolic), plus an extra
 * 1.2 in drop over the outboard 2.75 in (the ears); the brow flange also reaches 0.8 in lower at the ears.
 */
export const GLARE_ARC = { rise: 0.6, halfSpan: 15, ear: 1.2, earStart: 17, earEnd: 19.75, earFlange: 0.8 };
/** Drop (inches) of the glareshield brow / upper panel edge below its centre height at X inches from the centreline. */
export function glareSagIn(Xin: number): number {
  const a = Math.abs(Xin);
  const t = Math.min(1, Math.max(0, (a - GLARE_ARC.earStart) / (GLARE_ARC.earEnd - GLARE_ARC.earStart)));
  return GLARE_ARC.rise * (a / GLARE_ARC.halfSpan) ** 2 + GLARE_ARC.ear * t * t * (3 - 2 * t);
}

/**
 * Centre pedestal (POH Fig 7-2 items 20-25): face from the panel's lower edge (FS 18.6, 1.075 m) down and
 * aft to FS 25 (0.80 m), then to the floor. Width 6.0 in: measured on POH Fig 7-2 with the GDU bezel
 * (315 mm, 12.4 in) as the scale (pedestal 130 px vs bezel 267 px). The one value pedestal.ts builds.
 */
export const PEDESTAL = { topFs: 18.6, topH: 1.075, botFs: 25, botH: 0.8, width: 6 * IN } as const;

/** Front seats (seat front edge FS 32, EST from the FS 34-46 occupant arm range); rear bench at FS 73 (POH Fig 6-3). */
export const SEATS = { frontFs: 32, y: 10 * IN, rearFs: 64 };

/**
 * Cabin section (inner lining): straight side walls up to the roof corner radius.
 * EST from POH Fig 6-6: half width 0.50 m at the window line tapering aft, roof 1.98 m.
 */
export const CABIN = {
  /** Half width (m) vs FS. */
  halfWidth: { x: [3, 18, 27, 65, 90, 115], y: [0.47, 0.506, 0.506, 0.506, 0.47, 0.42] },
  /** Roof lining height (m above ground) vs FS (windshield top at FS 29). */
  roofH: { x: [28, 43, 70, 95, 115], y: [1.93, 1.975, 1.975, 1.92, 1.8] },
  /** Roof corner radius (m). */
  cornerR: 0.16,
  /** Floor half width is 34/39.5 of the window-line width (POH Fig 6-6). */
  floorRatio: 34 / 39.5,
};

/**
 * One-piece windshield: base at FS 12.5 on the glareshield, top edge at the roof over the forward
 * doorposts (FS 29, POH Fig 6-6 side view; the wing root leading edge); A-pillars (forward doorposts)
 * from the glareshield corners (FS 15, 1.605 m) to the roof (FS 29.5, 1.94 m). EST +/-1 in.
 */
export const WINDSHIELD = { baseFs: 12.5, baseH: 1.605, topFs: 29, topH: 1.94, pillarBaseFs: 15, pillarTopFs: 29.5 };

/**
 * Cabin doors (POH Fig 6-6): opening from FS 26 (bottom) / 30 (top) to the forward doorpost
 * bulkhead FS 65.3, sill 0.80 m, top 1.83 m (40.5 in high). Door window FS 33.4-63.7, 1.46-1.79 m
 * (Fig 6-6 side view, 5.0 px/in); rear side window FS 68-95 at the same heights.
 */
export const DOOR = { fwdFsBottom: 26, fwdFsTop: 30, aftFs: 65.3, sillH: 0.8, topH: 1.83 };
export const DOOR_WINDOW = { fs0: 33.4, fs1: 63.7, h0: 1.46, h1: 1.79 };
export const REAR_WINDOW = { fs0: 68, fs1: 95, h0: 1.46, h1: 1.79 };

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
