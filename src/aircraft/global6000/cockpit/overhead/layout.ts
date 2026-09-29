/**
 * Global 6000 overhead panel geometry.
 *
 * Source of the layout: Bombardier Global Express FCOM CSP 700-6, Vol. 2,
 * "Airplane General" 01-10-41, drawing GF0110_024 ("OVERHEAD PANEL", Rev 51,
 * Aug 14 2006). The Global 6000 (BD-700-1A10 with the Global Vision flight
 * deck) keeps the Global Express overhead; the EMS CDUs stay on the side
 * panels (GXEL 07-10-9). Every control position below is transcribed from
 * the text positions of that vector drawing (PDF points, page 612 x 792:
 * x to the right, y up the page) and scaled so the drawing's panel outline
 * (x 132 .. 517 pt) spans the 0.78 m wide overhead mount (layout.ts MOUNTS).
 *
 * Orientation: like every FCOM overhead drawing the page shows the panel as
 * the crew reads it looking up, so the top of the page is the AFT edge (fire
 * handles, TEMPERATURE) and the bottom is the FORWARD edge (EXTERNAL LIGHTS,
 * PASS SIGNS / EMER LIGHTS, ELECTRICAL). A 'down'-facing panel with
 * origin 'top-left' has exactly that frame: x right (+y body), y from the aft
 * edge toward the nose.
 */
import type { BodyVec } from '../../../../cockpit/frame';
import { MOUNTS } from '../layout';

/** Drawing scale: 0.78 m over 385 pt (EST: the drawing is not dimensioned; the overhead width is the mount width). */
export const PT = 0.78 / 385;
/** Drawing x (pt) of the panel's left edge and y (pt) of its aft (top) edge. */
const X0 = 132;
const Y0 = 650;

/** Panel x (m from the left edge) of a drawing x in points. */
export const px = (xPt: number): number => (xPt - X0) * PT;
/** Panel y (m from the aft edge toward the nose) of a drawing y in points. */
export const py = (yPt: number): number => (Y0 - yPt) * PT;

/**
 * Overhead plate: the drawing spans y 650 .. 352 pt (0.60 m). Centred on the
 * MOUNTS.overhead frame (forward edge just aft of the windshield header at
 * x 11.03, aft edge above and behind the design eye), sloping down 5 deg at
 * the front (EST, layout.ts MOUNTS note).
 */
export const OVHD = {
  // 35 mm below the mount frame and 5 deg slope (EST): the 2.69 m cabin crown curves down to ~z -1.31 at the
  // panel's outboard edges (shell.ts headliner), so the plate hangs a few cm below the headliner like the real
  // overhead console, and its outboard corners stay clear of the lining.
  center_m: [MOUNTS.overhead.center_m[0] - 0.005, 0, MOUNTS.overhead.center_m[2] + 0.035] as BodyVec,
  tiltDeg: -5,
  width: MOUNTS.overhead.width,
  height: (Y0 - 352) * PT,
};

/**
 * The plate is two modules (FCOM drawing outline): the full-width forward
 * module (drawing y 520 .. 352 pt: ELECTRICAL, HYDRAULIC, FUEL, ENGINE, APU,
 * BLEED / ANTI-ICE, PRESSURIZATION, WINDSHIELD HEAT, EXTERNAL LIGHTS, PASS
 * SIGNS) and the narrower aft module (x 232 .. 412 pt, y 650 .. 520 pt: fire
 * handles, AURAL WARNING, TEMPERATURE, RECIRC / TRIM AIR / RAM AIR).
 */
/** Body position (x, 0, z) of the overhead's forward fitting strip edge (drawing y 316 pt), for the compass / sign. */
export function OVHD_FWD_EDGE(): [number, number, number] {
  const t = (OVHD.tiltDeg * Math.PI) / 180;
  // Panel frame: y (drawing down) runs forward; tilt -5 deg: the forward end is lower (body z larger).
  const d = py(316) - OVHD.height / 2;
  return [OVHD.center_m[0] + d * Math.cos(t), 0, OVHD.center_m[2] - d * Math.sin(t)];
}

export const MODULES = {
  fwd: { x0: 132, x1: 517, y0: 520, y1: 352 },
  aft: { x0: 232, x1: 412, y0: 650, y1: 520 },
};

/** Standard sizes on this panel (EST from the drawing: the PBAs are drawn ~8 pt = 16 mm square). */
export const SZ = {
  pba: 0.0155,
  label: 0.003,
  title: 0.0034,
  knob: 0.015,
  toggle: 0.78,
};
