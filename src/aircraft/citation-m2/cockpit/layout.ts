/**
 * Citation M2 flight-deck geometry (body metres: x forward, y right, z down,
 * datum = FDM empty CG at FS 250.0; x = (250 - FS) * 0.0254).
 *
 * Sources: docs/aircraft/citation-m2.md §9.0 (panel geometry, EST), the
 * S&D15 §10.2 panel list (glareshield / instrument panel / tilt panel /
 * pedestal / beneath the panel, left to right) and Figure III (flight-deck
 * photograph); Garmin GDU 1400W: 14.1 in WXGA 1280 x 800 (S&D15 §10.3.A);
 * L-3 ESI-1000 bezel 3 x 4 in, 3.7 in LCD, four bezel buttons (L-3 data,
 * S&D15 §10.3.U). Everything else is EST from the photograph and marked so.
 *
 * Eye point: the dossier gives FS 130 (x 3.05) / y -0.33 and ~0.06 m above
 * the glareshield; it is placed 6 cm further aft (FS 132.4, x 2.99: PFD centre
 * ~26 deg below the horizontal as in the S&D photograph) and at z -0.42 so that the seated eye height
 * above the seat cushion is 0.76 m (FAA-H-8083 / MIL-STD-1472 50th
 * percentile seated eye height ~0.79 m, compressed cushion) with the cockpit
 * floor at z 0.70 inside the 1.66 m fuselage (EST).
 */

/** Pilot design eye (body m). Copilot mirrored. */
export const EYE: [number, number, number] = [2.99, -0.33, -0.42];
export const EYE_R: [number, number, number] = [2.99, 0.33, -0.42];

/** Cockpit floor height and extent (EST). */
export const FLOOR_Z = 0.7;
export const FLOOR_AFT_X = 2.3;

/** Main instrument panel: face centre, tilt (top leaning forward), size (EST: dossier 12 deg). */
export const MAIN = { center: [3.665, 0, -0.08] as [number, number, number], tiltDeg: 12, width: 1.36, height: 0.25 };
/** Panel-local x of the display centres (top-left convention) and top edge of the bezels. */
export const GDU = {
  /** GDU 1400W bezel 14.25 x 9.75 in = 362 x 248 mm (SE Aerospace unit data) and 14.1 in 16:10 active area. */
  bezelW: 0.362,
  bezelH: 0.248,
  screenW: 0.3037, // 14.1 in diagonal, 16:10 -> 303.7 x 189.8 mm
  screenH: 0.1898,
  /** Bezel borders left, right, top, bottom (m): softkeys on the lower bezel (PG Figure 1-2); sums match 362 x 248. */
  border: [0.02915, 0.02915, 0.0165, 0.0417] as [number, number, number, number],
  top: 0.001,
  /** Centres 0.369 m apart: bezels nearly abut (~7 mm gaps, photos). */
  xPfd1: 0.311,
  xMfd: 0.68,
  xPfd2: 1.049,
};

/** Glareshield face (GMC 710 with the DIMMING / reversion panel above it, ESI, GCU 275s, masters, fire switches) below the brow (EST). */
export const GLARE_PANEL = { center: [3.662, 0, -0.243] as [number, number, number], tiltDeg: 10, width: 1.16, height: 0.095 };
/** Glareshield hood: brow aft edge station/height, depth to the windshield, forward droop. */
export const GLARE = { browX: 3.628, browZ: -0.306, width: 1.4, depth: 0.34, pitchDeg: -8 };

/**
 * Tilt panels below the display row (S&D15 §10.2.C). EST ~30 deg back from vertical and a ~110 mm band
 * (scaled from the GCU 275 width in the pin1 / S&D21 Fig 3 photos); the landing gear module is part of the
 * LH tilt-panel face (same plane, joined by a seam).
 */
export const TILT = {
  tiltDeg: 30,
  height: 0.11,
  /** Top edge (meets the main panel's lower edge). */
  topX: 3.64,
  topZ: 0.043,
  left: { y0: -0.74, y1: -0.285 },
  right: { y0: 0.162, y1: 0.74 },
};
/** Landing gear control module: inboard end of the LH tilt-panel face (photographs: below PFD1's inboard edge). */
export const GEAR_MODULE = { y0: -0.28, y1: -0.165 };

/** Pedestal: GTC tower (two GTC 570), throttle quadrant, aft console (EST). */
export const PEDESTAL = {
  halfWidth: 0.15,
  towerTiltDeg: 50,
  towerLen: 0.245,
  towerTopX: 3.636,
  towerTopZ: 0.046,
  quadrantZ: 0.21,
  quadrantAftX: 3.02,
  aftEndX: 2.8,
  aftTopZ: 0.24,
};

/** Control wheels (hub) and rudder pedals (pivot), per side (EST from the photograph). */
export const YOKE_HUB = { x: 3.38, z: 0.0, y: 0.373 };
export const PEDALS = { x: 3.86, z: 0.3, y: 0.33 };
/** Crew seats: origin on the floor line under the seat-pan front edge, sunk so the cushion top is at z 0.34. */
export const SEAT = { x: 3.37, y: 0.33, z: 0.81 };

/** Mount points reserved for the overhead / sidewall agent (cockpit/overhead, cockpit/side). */
export const MOUNTS = {
  /** Map / reading lights, oxygen mask stowage above each shoulder (S&D21 §10.1), compass (windshield centre post). */
  overhead: [2.95, 0, -0.74] as [number, number, number],
  /** LH / RH sidewall circuit-breaker panels forward of each seat (S&D15 §9.4). */
  sideL: [3.25, -0.72, 0.1] as [number, number, number],
  sideR: [3.25, 0.72, 0.1] as [number, number, number],
};

/** Utility: body point on a panel plane given its top edge, tilt and distance down the face. */
export function downFace(topX: number, topZ: number, tiltDeg: number, d: number): [number, number] {
  const t = (tiltDeg * Math.PI) / 180;
  return [topX - d * Math.sin(t), topZ + d * Math.cos(t)];
}
