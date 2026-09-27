/**
 * G800 overhead geometry (body metres; EST from G500/G600/G700 flight-deck photographs, scaled
 * from the OHPTS size EPIC_HW.ohpts 0.19 x 0.114 m).
 *
 * The panel starts just aft of the main cockpit's fire-handle strip (layout.ts FIRE_STRIP,
 * x 12.86 .. 12.94) and runs aft ~0.64 m. It hangs slightly below the curved headliner as an
 * overhead console (the console body closes the gap to the skin), and its forward end is lower
 * than its aft end so the faces tilt toward the crew. The three OHPTS sit side by side in one
 * row (BJT500 "three identical ... touchscreens"), 0.21 m pitch (bezel 0.01 m each side).
 */
import type { BodyVec } from '../../../../cockpit/frame';

const X_FWD = 12.84;
const LENGTH = 0.64;
const TILT = -8; // deg, forward end lower
const Z_FWD = -1.238; // ~45 mm below the headliner at the forward corners (glazing.topZ)

export const OVHD = {
  length: LENGTH,
  width: 0.68,
  tiltDeg: TILT,
  center_m: [X_FWD - LENGTH / 2, 0, Z_FWD - (LENGTH / 2) * Math.sin((-TILT * Math.PI) / 180)] as BodyVec,
  /** Console body height above the panel face (closes to the headliner). */
  bodyDepth: 0.1,
  /** Row centres (panel v, + = aft). */
  rows: { a: -0.255, ohpts: -0.095, b: 0.065, c: 0.21 },
  /** OHPTS 1..3 centres (panel u, + = right). */
  ohptsX: [-0.21, 0, 0.21] as const,
};
