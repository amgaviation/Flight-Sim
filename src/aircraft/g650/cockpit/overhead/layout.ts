/**
 * G650 overhead console geometry (body metres, EST unless noted).
 *
 * Arrangement (G650ER overhead photograph with its owner's description, Flickr jeffatchison 52948516166:
 * "The rear-most part contains Circuit Breakers ... laid out in sections that are divided by white lines and
 * clearly labeled as to what system they belong to"; the middle part holds the system switches, "most of
 * the lights here are NOT illuminated when everything is operating normally"; the forward part has
 * "switches ... to operate various lighting systems, Anti-Ice systems including windshield heat, as well as
 * switches for passenger warnings"). The console follows the headliner, which drops toward the windshield
 * header (layout.ts G650_FUSELAGE), so it is built as three flat segments that fold down toward the front:
 *
 *   BREAKERS  x 13.13 .. 13.50  nearly flat (behind the crew's heads)
 *   SYSTEMS   x 13.50 .. 13.97  forward end 45 mm lower (5.4 deg)
 *   FORWARD   x 13.97 .. 14.10  steep fascia (33 deg) facing the crew: exterior lights, passenger signs,
 *                               anti-ice, window heat, air data probe heaters.
 *
 * Width 0.72 m (dossier §8: 0.75 m console incl. trim). Each segment faces down; panel "up" (label top)
 * points aft, as overhead legends read with the head tilted back.
 */
import * as THREE from 'three';
import type { BodyVec } from '../../../../cockpit/frame';

export interface OhSegment {
  name: string;
  /** Aft and forward edge on the centreline: [x, z]. */
  aft: [number, number];
  fwd: [number, number];
  width: number;
}

export const OH_WIDTH = 0.72;

export const OH_BREAKERS: OhSegment = { name: 'g650.oh.cb', aft: [13.13, -1.448], fwd: [13.5, -1.44], width: OH_WIDTH };
export const OH_SYSTEMS: OhSegment = { name: 'g650.oh.sys', aft: [13.5, -1.44], fwd: [13.97, -1.395], width: OH_WIDTH };
export const OH_FORWARD: OhSegment = { name: 'g650.oh.fwd', aft: [13.97, -1.395], fwd: [14.1, -1.31], width: 0.68 };

/** Panel placement of a segment ('down' facing: normal +z body, label up toward the tail). */
export function segmentPlacement(s: OhSegment): { center_m: BodyVec; facing: 'down'; tiltDeg: number; width: number; height: number } {
  const dx = s.fwd[0] - s.aft[0];
  const dz = s.fwd[1] - s.aft[1];
  return {
    center_m: [(s.aft[0] + s.fwd[0]) / 2, 0, (s.aft[1] + s.fwd[1]) / 2],
    facing: 'down',
    // Forward end lower (larger z): the face normal leans aft toward the crew = positive tilt toward the panel's
    // own +v (aft) (checked numerically with panelBasis; the "negative" hint in docs/modules/cockpit.md §1 would
    // turn the face toward the windshield).
    tiltDeg: THREE.MathUtils.radToDeg(Math.atan2(dz, dx)),
    width: s.width,
    height: Math.hypot(dx, dz),
  };
}

/** Gulfstream square switchlight size (EST 19 mm, as the pedestal) and the grid pitch used on the overhead. */
export const SL = { size: 0.019, pitch: 0.027 };
