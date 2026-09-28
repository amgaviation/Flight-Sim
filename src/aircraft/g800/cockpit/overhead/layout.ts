/**
 * G800 overhead geometry (body metres; EST, scaled from the OHPTS size EPIC_HW.ohpts 0.19 x 0.114 m in the
 * G600 BL7C0705 and G500 BL7C0670 overhead photographs).
 *
 * The overhead console runs from the windshield header aft ~0.8 m, hanging below the curved headliner (the console
 * body closes the gap to the skin), forward end lower so the faces tilt toward the crew. Forward to aft (photo):
 *  - the forward strip: EMERGENCY POWER, BATTERIES, COCKPIT LIGHTS, ENGINE START, APU FIRE EXT, APU CONTROL,
 *    CABIN MASTERS;
 *  - OHPTS 1 and 2 side by side;
 *  - ELECTRICAL POWER CONTROL (left), OHPTS 3 (centre) and the DOORS / ENGINE CONTROL / BLEED AIR / CABIN
 *    PRESSURE CONTROL stack (right);
 *  - two chrome gasper / reading-light assemblies;
 *  - the two CB panels (grids A-G x 1-6).
 * Panel coordinates: centred, u right (+y body), v aft (+ = toward the tail).
 */
import type { BodyVec } from '../../../../cockpit/frame';

const X_FWD = 12.94;
const LENGTH = 0.8;
const TILT = -6; // deg, forward end lower
const Z_FWD = -1.225;

export const OVHD = {
  length: LENGTH,
  width: 0.68,
  tiltDeg: TILT,
  center_m: [X_FWD - LENGTH / 2, 0, Z_FWD - (LENGTH / 2) * Math.sin((-TILT * Math.PI) / 180)] as BodyVec,
  /** Console body height above the panel face (closes to the headliner). */
  bodyDepth: 0.1,
  /** Forward strip centre (v) and height. */
  strip: { v: -0.368, h: 0.06 },
  /** OHPTS 1 / 2 (forward pair) and OHPTS 3 (centre, aft) centres [u, v]. */
  ohpts: [
    [-0.11, -0.25],
    [0.11, -0.25],
    [0, -0.075],
  ] as const,
  /** ELECTRICAL POWER CONTROL sub-panel (centre [u, v], size). */
  elec: { u: -0.228, v: -0.075, w: 0.2, h: 0.16 },
  /** DOORS / ENGINE CONTROL / BLEED AIR / CABIN PRESSURE CONTROL stack. */
  stack: { u: 0.228, v: -0.06, w: 0.2, h: 0.25 },
  /** Gasper / reading-light assemblies. */
  gasperV: 0.11,
  gasperU: 0.2,
  /** CB panels: centre v, size, left / right centre u. */
  cb: { v: 0.272, w: 0.31, h: 0.245, u: 0.163 },
};
