/**
 * Control wheels, rudder pedals, map light and control lock of the 172S NAV III.
 *
 * POH 172SPHBUS-00 Fig 7-2 Detail A (pilot's control wheel, left grip): microphone button, control
 * wheel steering (CWS), manual electric trim (MET) and autopilot trim disconnect (A/P TRIM DISC);
 * item 14: microphone button on the copilot's wheel; item 29: yoke mounted map light, "a rheostat and
 * a light assembly, both found on the lower surface of the pilot's control wheel" (Sec 7 "Interior
 * lighting"; the NAV light switch must be ON).
 *
 * Switch placement on the grip pod per POH Fig 7-2 Detail A: microphone button at the forward end of the
 * pod top, CWS on the top face aft of it; on the inboard face the "CWS / MIC / A/P TRIM DISC" legend plate,
 * the round A/P TRIM DISC button and, lower under the thumb, the MET split switch. Sizes EST.
 *
 * Bindings:
 *  - A/P TRIM DISC: event `ap.disc` (GFC 700 disconnect / tone silence), release `g1k.ap_disc_hold`
 *    (ESP interrupt ends), C172G.apDisc held = trim interrupt (systems/variant.ts); MET split switch:
 *    C172G.met +1 nose up / -1 nose down (spring to centre) with C172G.metHalf (both halves / ARM only /
 *    DN-UP only); MET ARM with the AP engaged disconnects it, otherwise acknowledges a disconnect alert.
 *  - CWS: event `ap.cws` with the pressed state; PTT: `g1k.ptt` (GMA 1360 transmit).
 *  - Wheels / columns animate from the control-surface positions (cable controls are back-driven by
 *    the GFC 700 servos); mouse drag flies them through the cockpit.* input contract.
 *  - Control lock (POH placard 2 "CAUTION! CONTROL LOCK REMOVE BEFORE STARTING ENGINE"): the pin and
 *    flag through the pilot's column collar, C172.controlLock (flight controls locked by the shared logic).
 */
import * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import type { SimContext } from '../../../core/SimContext';
import { PushButton, RockerSwitch, RudderPedals, Thumbwheel } from '../../../cockpit/controls';
import type { ControlPointer } from '../../../cockpit/types';
import { SURF } from '../../../core/vars';
import { G1K_EVENTS } from '../../../avionics/garmin-g1000/vars';
import { C172 } from '../../c172s-common/vars';
import { C172G } from '../vars';
import { skyhawkYoke } from './yoke';
import { FLOOR_H, PEDALS, PANEL, YOKE, hz } from './layout';

/**
 * MET split switch: a 3-position spring-centred rocker whose pointer modifiers choose the halves under the thumb
 * (writes C172G.metHalf: 0 both, 1 ARM only, 2 DN/UP only; back to 0 on release).
 */
class MetRocker extends RockerSwitch {
  override onPointerDown(p: ControlPointer): void {
    this.env.vars.set(C172G.metHalf, p.shift ? 2 : p.ctrl || p.alt ? 1 : 0);
    super.onPointerDown(p);
  }
  override onPointerUp(p?: ControlPointer): void {
    super.onPointerUp(p);
    this.env.vars.set(C172G.metHalf, 0);
  }
  override onCancel(): void {
    super.onCancel();
    this.env.vars.set(C172G.metHalf, 0);
  }
}

export interface FlightControlParts {
  /** Control-lock flag (shown while C172.controlLock = 1). */
  lockFlag: THREE.Object3D;
}

export function buildFlightControls(b: CockpitBuilder, _ctx: SimContext): FlightControlParts {
  const env = b.env;
  const mats = env.materials;
  const colLen = 0.25;
  // Pilot (left) wheel with the GFC 700 switches.
  const pilot = skyhawkYoke(env, {
    id: 'c172g.yoke1',
    label: 'PILOT CONTROL WHEEL',
    column: { kind: 'translate', length: colLen, travelAft: 0.1, travelFwd: 0.08, radius: 0.0125 },
    rollDeg: 45,
    pitchVar: SURF.elevator,
    rollVar: SURF.aileron,
    // POH Fig 7-2 Detail A: the Microphone Button (raised round cap) at the forward end of the pod top with
    // the Control Wheel Steering button beside it (aft); on the inboard face the round Autopilot Trim
    // Disconnect button (upper) and the Manual Electric Trim split switch (lower, under the thumb).
    // Anchor frames (yoke.ts): leftTop +y = forward along the top face; leftInboard +x = forward, +y = up.
    switches: [
      {
        anchor: 'leftTop',
        offset: [0, 0.011, 0],
        kind: 'button',
        options: { id: 'c172g.yoke1.ptt', label: 'PILOT MICROPHONE (PTT)', style: 'round', width: 0.0085, mode: 'momentary', var: C172G.pttPilot, event: G1K_EVENTS.ptt, releaseEvent: G1K_EVENTS.ptt, capMaterial: 'plasticBlack' },
      },
      {
        anchor: 'leftTop',
        offset: [0, -0.008, 0],
        kind: 'button',
        options: { id: 'c172g.yoke1.cws', label: 'CWS (control wheel steering)', style: 'small', width: 0.0075, mode: 'momentary', var: C172G.cws, event: 'ap.cws', releaseEvent: 'ap.cws', capMaterial: 'plasticGrey' },
      },
      {
        anchor: 'leftInboard',
        offset: [0.008, 0.009, 0],
        kind: 'button',
        // Press: 'ap.disc' (AP disconnect / alert acknowledge); release: G1K apDiscHold { pressed: false } ends the
        // ESP interrupt (PG §8.11: ESP is interrupted only while the switch is held).
        options: { id: 'c172g.yoke1.ap_disc', label: 'A/P TRIM DISC (AP disconnect / trim interrupt)', style: 'round', width: 0.0082, mode: 'momentary', var: C172G.apDisc, event: 'ap.disc', releaseEvent: G1K_EVENTS.apDiscHold, capMaterial: 'paintRed' },
      },
    ],
  });
  // MET split switch rocking fore / aft under the thumb: forward = NOSE DN (the rocker's upper end, index 2, turned to
  // point forward). CRG 190-00384-12 §6.1: left half ARM, right half DN / UP; the thumb normally rocks both. Mouse:
  // plain = both halves, Shift = DN/UP half only, Ctrl/Alt = ARM half only (C172G.metHalf, systems/variant.ts).
  {
    const met = new MetRocker(env, {
      id: 'c172g.yoke1.met',
      label: 'MANUAL ELECTRIC TRIM (MET) split switch (Shift: DN/UP half only, Ctrl: ARM half only)',
      var: C172G.met,
      positions: ['NOSE UP', 'OFF', 'NOSE DN'],
      values: [1, 0, -1],
      initial: 1,
      springs: { 0: 1, 2: 1 },
      width: 0.011,
      height: 0.018,
      capMaterial: 'plasticBlack',
    });
    met.object.position.set(0.002, -0.013, 0);
    met.object.rotation.z = THREE.MathUtils.degToRad(-90);
    pilot.anchors.leftInboard.add(met.object);
    pilot.subControls.push(met);
    // Split line between the ARM (left) and DN/UP (right) halves of the cap.
    const split = new THREE.Mesh(env.geometry.get('c172g.met_split', () => new THREE.PlaneGeometry(0.0006, 0.017)), mats.custom('plastic', '#050505', 0.6));
    split.rotation.z = Math.PI / 2;
    split.position.set(0, 0, 0.0035);
    split.userData.cockpitStatic = true;
    met.object.add(split);
  }
  // Engraved legend plate on the inboard face, aft of the A/P TRIM DISC button (Detail A: "CWS / MIC /
  // A/P TRIM DISC"). Static: the switches it names are the controls above.
  {
    const plateG = env.geometry.get('c172g.yoke_legend', () => new THREE.PlaneGeometry(0.02, 0.013));
    const legend = new THREE.Mesh(plateG, mats.custom('plastic', '#101012', 0.5));
    legend.position.set(-0.009, 0.009, 0.0004);
    legend.userData.cockpitStatic = true;
    pilot.anchors.leftInboard.add(legend);
    const t = env.labels.text('CWS   MIC\nA/P TRIM\nDISC', { height: 0.0022, weight: 800, zone: null, color: '#e6e6e2' });
    t.position.set(-0.009, 0.009, 0.0007);
    pilot.anchors.leftInboard.add(t);
  }
  // Map light rheostat (knurled thumbwheel) under the hub; the lens beside it.
  const mapWheel = new Thumbwheel(env, {
    id: 'c172g.yoke1.map_light',
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
    const lens = new THREE.Mesh(env.geometry.get('c172g.map_lens', () => new THREE.CircleGeometry(0.008, 20)), mats.get('plasticGrey'));
    lens.position.set(-0.016, 0, 0.0005);
    pilot.anchors.hub.add(lens);
    const lbl = env.labels.text('MAP LIGHT DIM', { height: 0.0022, weight: 700, zone: null, color: '#d8d8d8' });
    lbl.position.set(0.0, -0.012, 0.0005);
    pilot.anchors.hub.add(lbl);
  }
  // Placed after the map-light wheel joined the sub-controls (the builder registers them with the yoke).
  b.place(pilot, { center_m: [YOKE.x, -YOKE.y, YOKE.z], facing: 'aft', tiltDeg: PANEL.tiltDeg });

  // Copilot (right) wheel: microphone button on top of the right (outboard) grip (POH Fig 7-2 item 14,
  // the leader line ends on the right grip's pod).
  const copilot = skyhawkYoke(env, {
    id: 'c172g.yoke2',
    label: 'COPILOT CONTROL WHEEL',
    column: { kind: 'translate', length: colLen, travelAft: 0.1, travelFwd: 0.08, radius: 0.0125 },
    rollDeg: 45,
    pitchVar: SURF.elevator,
    rollVar: SURF.aileron,
    switches: [
      {
        anchor: 'rightTop',
        offset: [0, 0.008, 0],
        kind: 'button',
        options: { id: 'c172g.yoke2.ptt', label: 'COPILOT MICROPHONE (PTT)', style: 'small', width: 0.009, mode: 'momentary', var: C172G.pttCopilot, event: G1K_EVENTS.ptt, releaseEvent: G1K_EVENTS.ptt, capMaterial: 'plasticBlack' },
      },
    ],
  });
  b.place(copilot, { center_m: [YOKE.x, YOKE.y, YOKE.z], facing: 'aft', tiltDeg: PANEL.tiltDeg });

  // Map light (downward spot from the bottom of the pilot's wheel onto the lap; zone 'map').
  env.lighting.addMapLight('c172g.map', 'map', [YOKE.x - 0.02, -YOKE.y, YOKE.z + 0.1], [YOKE.x - 0.25, -YOKE.y, hz(FLOOR_H + 0.35)], b.root, 2.5);

  // ---------------------------------------------------------------- rudder pedals with toe brakes (floor-hinged)
  for (const side of [-1, 1] as const) {
    b.place(
      new RudderPedals(env, {
        id: `c172g.pedals${side < 0 ? 1 : 2}`,
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

  // ---------------------------------------------------------------- control lock (pin through the pilot's column collar + flag)
  const lockFlag = new THREE.Group();
  lockFlag.name = 'control_lock_flag';
  {
    const plateGeo = env.geometry.get('c172g.lock_flag', () => {
      const s = new THREE.Shape();
      s.moveTo(-0.045, -0.03);
      s.lineTo(0.03, -0.03);
      s.lineTo(0.045, -0.012);
      s.lineTo(0.045, 0.03);
      s.lineTo(-0.045, 0.03);
      s.closePath();
      return new THREE.ShapeGeometry(s);
    });
    const plate = new THREE.Mesh(plateGeo, mats.custom('paint', '#f2f2ee', 0.5));
    lockFlag.add(plate);
    for (let i = 0; i < 4; i++) {
      const stripe = new THREE.Mesh(env.geometry.get('c172g.lock_stripe', () => new THREE.PlaneGeometry(0.012, 0.022)), mats.custom('paint', '#111111', 0.5));
      stripe.position.set(-0.034 + i * 0.022, 0.017, 0.0003);
      stripe.rotation.z = -0.45;
      lockFlag.add(stripe);
    }
    const t = env.labels.text('CAUTION!\nCONTROL LOCK\nREMOVE BEFORE\nSTARTING ENGINE', { height: 0.0036, weight: 800, zone: null, color: '#121212', align: 'left' });
    t.position.set(-0.012, -0.012, 0.0004);
    lockFlag.add(t);
  }
  lockFlag.userData.cockpitDynamic = true;
  // Hangs over the ignition switch from the pin in the pilot's column collar.
  lockFlag.position.set(-0.07, -0.02, 0.012);
  const lockPin = new PushButton(env, {
    id: 'c172g.control_lock',
    label: 'CONTROL LOCK (click: insert / remove)',
    mode: 'toggle',
    var: C172.controlLock,
    style: 'small',
    width: 0.012,
    height: 0.012,
    capMaterial: 'paintRed',
  });
  lockPin.object.add(lockFlag);
  const panel = b.panels.get('c172g.panel');
  if (!panel) throw new Error('c172-g1000 cockpit: build the instrument panel before the flight controls');
  // Column collar at X -9.2 in, Z 11.8 in (layout.ts YOKE); the pin sits on its outboard side.
  panel.add(lockPin, PANEL.width / 2 - 9.2 * 0.0254 - 0.03, YOKE.colZin * 0.0254 + 0.004, { z: 0.008 });
  return { lockFlag };
}
