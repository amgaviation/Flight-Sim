/**
 * Control wheels, rudder pedals, map light and control lock of the steam 172S NAV II.
 *
 * Pilot's wheel, left grip (Supplement 15 Fig 2): item 12 A/P DISC / TRIM INT switch (red, the
 * outboard face of the grip), item 13 manual electric trim split switch (two halves side by side
 * on the grip top: each spring-loaded OFF, forward = DN, aft = UP; trim runs only with both halves
 * moved together), and the microphone push-to-talk; the map light rheostat and lamp on the lower
 * surface of the wheel (POH Sec 7 "Interior lighting", needs the NAV light switch ON).
 * Copilot's wheel: microphone push-to-talk.
 * Control wheel lock (POH placard "CONTROL LOCK - REMOVE BEFORE STARTING ENGINE"): pin through the
 * pilot's column collar with its red flag over the ignition switch; C172.controlLock (flight
 * controls locked by the shared logic).
 */
import * as THREE from 'three';
import type { CockpitBuilder, Panel } from '../../../cockpit/CockpitBuilder';
import { PushButton, RudderPedals, Thumbwheel } from '../../../cockpit/controls';
import { roundedBox } from '../../../cockpit/geometry/primitives';
import { SURF } from '../../../core/vars';
import { C172 } from '../../c172s-common/vars';
import { ST } from '../vars';
import { skyhawkYoke } from './yoke';
import { FLOOR_H, PANEL, PEDALS, POS, YOKE, hz, px, py } from './layout';

export interface FlightControlParts {
  lockFlag: THREE.Object3D;
}

export function buildFlightControls(b: CockpitBuilder, panel: Panel): FlightControlParts {
  const env = b.env;
  const mats = env.materials;
  const colLen = 0.25;
  const metHalf = (id: string, label: string, v: string, dx: number) => ({
    anchor: 'leftTop' as const,
    offset: [dx, 0, 0] as [number, number, number],
    kind: 'rocker' as const,
    options: {
      id,
      label,
      var: v,
      positions: ['UP', 'OFF', 'DN'],
      values: [1, 0, -1],
      initial: 1,
      springs: { 0: 1, 2: 1 },
      width: 0.0075,
      height: 0.016,
      capMaterial: 'plasticBlack' as const,
    },
  });
  const pilot = skyhawkYoke(env, {
    id: 'c172s.yoke1',
    label: 'PILOT CONTROL WHEEL',
    column: { kind: 'translate', length: colLen, travelAft: 0.1, travelFwd: 0.08, radius: 0.0125 },
    rollDeg: 45,
    pitchVar: SURF.elevator,
    rollVar: SURF.aileron,
    switches: [
      metHalf('c172s.yoke1.met_lh', 'MANUAL ELECTRIC TRIM - LH switch (both halves move the trim)', ST.metLeft, -0.0048),
      metHalf('c172s.yoke1.met_rh', 'MANUAL ELECTRIC TRIM - RH switch (both halves move the trim)', ST.metRight, 0.0048),
      {
        anchor: 'leftOutboard',
        kind: 'button',
        options: { id: 'c172s.yoke1.ap_disc', label: 'A/P DISC / TRIM INT (hold: trim interrupt)', style: 'small', width: 0.0085, mode: 'momentary', var: ST.apDisc, capMaterial: 'paintRed' },
      },
      {
        anchor: 'leftInboard',
        kind: 'button',
        options: { id: 'c172s.yoke1.ptt', label: 'PILOT MICROPHONE (push-to-talk)', style: 'small', width: 0.009, mode: 'momentary', var: ST.pttPilot, capMaterial: 'plasticBlack' },
      },
    ],
  });
  // The grip-top anchor's up axis points forward (away from the pilot), so the rocker's top half is
  // the forward half: positions bottom -> top UP / OFF / DN give "push forward = DN" (Supplement 15
  // Sec 4 A.3 test steps).
  b.place(pilot, { center_m: [YOKE.x, -YOKE.y, YOKE.z], facing: 'aft', tiltDeg: PANEL.tiltDeg });
  const mapWheel = new Thumbwheel(env, {
    id: 'c172s.yoke1.map_light',
    label: 'MAP LIGHT rheostat (needs NAV lights ON)',
    channel: { var: C172.mapLight, min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
    diameter: 0.02,
    width: 0.007,
    orientation: 'horizontal',
  });
  mapWheel.object.position.set(0.018, 0, 0);
  pilot.anchors.hub.add(mapWheel.object);
  pilot.subControls.push(mapWheel);
  {
    const lens = new THREE.Mesh(env.geometry.get('c172s.map_lens', () => new THREE.CircleGeometry(0.008, 20)), mats.get('plasticGrey'));
    lens.position.set(-0.016, 0, 0.0005);
    pilot.anchors.hub.add(lens);
  }
  const copilot = skyhawkYoke(env, {
    id: 'c172s.yoke2',
    label: 'COPILOT CONTROL WHEEL',
    column: { kind: 'translate', length: colLen, travelAft: 0.1, travelFwd: 0.08, radius: 0.0125 },
    rollDeg: 45,
    pitchVar: SURF.elevator,
    rollVar: SURF.aileron,
    switches: [
      {
        anchor: 'leftInboard',
        kind: 'button',
        options: { id: 'c172s.yoke2.ptt', label: 'COPILOT MICROPHONE (push-to-talk)', style: 'small', width: 0.009, mode: 'momentary', var: ST.pttCopilot, capMaterial: 'plasticBlack' },
      },
    ],
  });
  b.place(copilot, { center_m: [YOKE.x, YOKE.y, YOKE.z], facing: 'aft', tiltDeg: PANEL.tiltDeg });
  env.lighting.addMapLight('c172s.map', 'map', [YOKE.x - 0.02, -YOKE.y, YOKE.z + 0.1], [YOKE.x - 0.25, -YOKE.y, hz(FLOOR_H + 0.35)], b.root, 2.5);

  // Rudder pedals with toe brakes (floor-hinged, one pair per seat).
  for (const side of [-1, 1] as const) {
    b.place(
      new RudderPedals(env, {
        id: `c172s.pedals${side < 0 ? 1 : 2}`,
        label: `${side < 0 ? 'PILOT' : 'COPILOT'} RUDDER PEDALS / TOE BRAKES`,
        style: 'floor',
        spacing: PEDALS.spacing,
        travel: 0.08,
        yawVar: SURF.rudder,
        padWidth: 0.075,
        padHeight: 0.14,
      }),
      { center_m: [PEDALS.x, side * PEDALS.y, PEDALS.z], facing: 'aft' },
    );
  }

  // Control wheel lock: the pin head at the pilot's column collar is the control; the flag shows while installed.
  panel.add(
    new PushButton(env, { id: 'c172s.control_lock', label: 'CONTROL WHEEL LOCK (click: install / remove)', var: C172.controlLock, mode: 'toggle', style: 'small', width: 0.009, capMaterial: 'paintRed' }),
    px(-POS.yokeCol.X - 0.9),
    py(POS.yokeCol.Z - 0.6),
    { z: 0.004 },
  );
  const lockFlag = new THREE.Group();
  lockFlag.name = 'control_lock_flag';
  lockFlag.userData.cockpitDynamic = true;
  const flag = new THREE.Mesh(env.geometry.get('c172s.lock_flag', () => roundedBox(0.09, 0.045, 0.002, 0.004)), mats.get('paintRed'));
  lockFlag.add(flag);
  const txt = env.labels.text('CONTROL LOCK\nREMOVE BEFORE\nSTARTING ENGINE', { height: 0.0045, weight: 700, zone: null, color: '#ffffff' });
  txt.position.z = 0.0012;
  lockFlag.add(txt);
  panel.addObject(lockFlag, px(POS.key.X + 0.9), py(POS.key.Z - 2.2), { z: 0.03 });
  return { lockFlag };
}
