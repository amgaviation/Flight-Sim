/**
 * Centre pedestal of the 172S NAV III (POH 172SPHBUS-00 Sec 7 "Center pedestal layout", Fig 7-2
 * items 20-25): "the elevator trim control wheel, trim position indicator, 12V power outlet, aux audio
 * input jack, fuel shutoff valve, and the hand-held microphone. The fuel selector valve handle is
 * located at the base of the pedestal."
 *
 * Geometry (EST from the photographs "Cessna 172SP G1000 01.jpg" / "C172S G1000 in flight.jpg"): a
 * 6 in wide console (layout.ts PEDESTAL) whose face slopes from the lower edge of the instrument panel (FS 18.6, 1.075 m)
 * down and aft to the floor (FS 25, 0.80 m); trim wheel in the left half of the face with its
 * NOSE DOWN / TAKE OFF / NOSE UP indicator beside it, the hand microphone hanging on the right, the
 * power outlet and aux audio jack low on the left, the red fuel shutoff knob low on the right; the
 * fuel selector on a floor plate just aft of the pedestal foot.
 */
import * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import { FuelSelector, PushButton, PushPullKnob, TrimWheel } from '../../../cockpit/controls';
import { cylinderZ, extrude, roundedBox, tube } from '../../../cockpit/geometry/primitives';
import { G1K_EVENTS } from '../../../avionics/garmin-g1000/vars';
import { sta, GROUND_Z } from '../../c172s-common/fdm';
import { C172, FUEL_SEL } from '../../c172s-common/vars';
import { TAKEOFF_TRIM } from '../../c172s-common/states';
import { C172G } from '../vars';
import { TRIM_WHEEL_TURNS } from '../data';
import { FLOOR_H, IN, PEDESTAL, hz } from './layout';

/** Pedestal face: top (FS, height m), bottom (FS, height m), width (m); layout.ts PEDESTAL (sourced there). */
export const PED = PEDESTAL;
const FACE_LEN = Math.hypot((PED.botFs - PED.topFs) * IN, PED.topH - PED.botH);
const FACE_TILT = (Math.atan2((PED.botFs - PED.topFs) * IN, PED.topH - PED.botH) * 180) / Math.PI;

/** Cockpit-local point (x right, y up, z aft) from (FS in, y m right, height m). */
function L(fs: number, y: number, h: number): THREE.Vector3 {
  return new THREE.Vector3(y, h - GROUND_Z, (fs - 38.1) * 0.0254);
}

/** Side-profile prism of the pedestal body (local geometry). */
function pedestalBody(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const P = (fs: number, h: number): [number, number] => {
    const v = L(fs, 0, h);
    return [v.z, v.y];
  };
  const pts = [P(12, PED.topH + 0.01), P(PED.topFs - 0.1, PED.topH + 0.01), P(PED.botFs, PED.botH), P(PED.botFs + 0.6, FLOOR_H), P(12, FLOOR_H)];
  s.moveTo(...pts[0]);
  for (const p of pts.slice(1)) s.lineTo(...p);
  s.closePath();
  const g = extrude(s, { depth: PED.width - 0.004, bevel: 0.004, bevelSegments: 2, anchor: 'back0' });
  g.rotateY(-Math.PI / 2);
  g.translate(PED.width / 2, 0, 0);
  return g;
}

export interface PedestalParts {
  /** Plugs shown while a device is plugged in (C172G.auxAudioCable / C172G.outletDevice). */
  auxPlug: THREE.Object3D;
  outletPlug: THREE.Object3D;
}

export function buildPedestal(b: CockpitBuilder): PedestalParts {
  const env = b.env;
  const mats = env.materials;
  const black = mats.custom('plastic', '#1d1d20', 0.78);
  b.structureMesh(pedestalBody(), black).name = 'pedestal_body';

  // Face panel (top-left coordinates, metres; y down the slope).
  const midFs = (PED.topFs + PED.botFs) / 2;
  const midH = (PED.topH + PED.botH) / 2;
  const face = b.panel({
    name: 'c172g.pedestal',
    center_m: [sta(midFs) - 0.002 * Math.cos((FACE_TILT * Math.PI) / 180), 0, hz(midH + 0.002 * Math.sin((FACE_TILT * Math.PI) / 180))],
    facing: 'aft',
    tiltDeg: FACE_TILT,
    width: PED.width,
    height: FACE_LEN,
    origin: 'top-left',
    material: black,
    thickness: 0.003,
    radius: 0.006,
    screws: { positions: [[0.008, 0.008], [PED.width - 0.008, 0.008], [0.008, FACE_LEN - 0.008], [PED.width - 0.008, FACE_LEN - 0.008]] },
  });
  const W = PED.width;
  const txt = (t: string, x: number, y: number, h: number, zone: string | null = 'pedestal') => {
    const l = env.labels.text(t, { height: h, weight: 700, zone, color: '#e9e9e4' });
    l.userData.cockpitStatic = true;
    face.addObject(l, x, y, { z: 0.0002 });
  };

  // ---------------------------------------------------------------- elevator trim wheel and indicator (item 25)
  // Manual wheel on the TrimAxis position var; the GSA 81 trim servo and the MET drive the same var
  // (the wheel turns with them). Full travel = TRIM_WHEEL_TURNS turns (EST).
  const trimX = 0.042;
  const trimY = 0.1;
  face.add(
    new TrimWheel(env, {
      id: 'c172g.trim_wheel',
      label: 'ELEVATOR TRIM wheel',
      var: C172.trimPosition,
      min: -1,
      max: 1,
      perRev: 2 / TRIM_WHEEL_TURNS,
      forwardDecreases: true,
      diameter: 0.1,
      thickness: 0.016,
      exposure: 0.22,
      spokes: 0,
      material: 'plasticBlack',
      indicator: {
        length: 0.07,
        offset: [-0.025, 0, 0],
        marks: [
          { value: -1, label: '' },
          { value: TAKEOFF_TRIM, label: '' },
          { value: 1, label: '' },
        ],
        increasingUp: false,
      },
    }),
    trimX,
    trimY,
  );
  txt('NOSE\nDOWN', 0.017, trimY - 0.05, 0.0021);
  txt('NOSE\nUP', 0.017, trimY + 0.05, 0.0021);
  // TAKE OFF mark beside the indicator (POH Sec 4 "Before takeoff": elevator trim SET FOR TAKEOFF).
  txt('TAKE\nOFF', 0.0075, trimY - 0.035 * TAKEOFF_TRIM, 0.0015);

  // ---------------------------------------------------------------- hand-held microphone (item 20)
  const mic = new THREE.Group();
  mic.name = 'hand_mic';
  const body = new THREE.Mesh(env.geometry.get('c172g.mic_body', () => roundedBox(0.048, 0.07, 0.024, 0.01)), mats.get('plasticBlack'));
  mic.add(body);
  const grille = new THREE.Mesh(env.geometry.get('c172g.mic_grille', () => roundedBox(0.03, 0.022, 0.002, 0.004)), mats.custom('metal', '#55575b', 0.5));
  grille.position.set(0, 0.018, 0.012);
  mic.add(grille);
  mic.traverse((c) => (c.userData.cockpitStatic = true));
  const micX = 0.11;
  const micY = 0.105;
  face.addObject(mic, micX, micY, { z: 0.013 });
  const cessna = env.labels.text('Cessna', { height: 0.0045, weight: 700, zone: null, color: '#d8d8d8' });
  cessna.userData.cockpitStatic = true;
  face.addObject(cessna, micX, micY - 0.012, { z: 0.0254 });
  // PTT on the microphone's left side (keys COM through the GMA 1360 like the yoke switches).
  face.add(
    new PushButton(env, { id: 'c172g.ptt_hand_mic', label: 'HAND MIC PUSH-TO-TALK', mode: 'momentary', var: C172G.pttHandMic, event: G1K_EVENTS.ptt, releaseEvent: G1K_EVENTS.ptt, style: 'small', width: 0.01, height: 0.018, capMaterial: 'plasticGrey' }),
    micX - 0.026,
    micY - 0.005,
    { z: 0.013 },
  );
  // Mic hanger clip and coiled cord (static). The cord runs into the pedestal face above the FUEL SHUTOFF
  // knob (EST routing) so it never covers the knob.
  {
    const clip = new THREE.Mesh(env.geometry.get('c172g.mic_clip', () => roundedBox(0.02, 0.012, 0.012, 0.002)), mats.get('steel'));
    clip.userData.cockpitStatic = true;
    face.addObject(clip, micX, micY - 0.042, { z: 0.006 });
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      const a = t * Math.PI * 2 * 8;
      pts.push(new THREE.Vector3(0.007 * Math.cos(a), -t * 0.06, 0.007 * Math.sin(a) + 0.012 * (1 - t)));
    }
    const cord = new THREE.Mesh(env.geometry.get('c172g.mic_cord', () => tube(pts, 0.0016, 360, 6)), mats.get('plasticBlack'));
    cord.userData.cockpitStatic = true;
    face.addObject(cord, micX, micY + 0.035, { z: 0.004 });
  }
  txt('MIC JACK', 0.118, 0.018, 0.0017);

  // ---------------------------------------------------------------- aux audio jack and 12 V outlet (items 23, 24)
  // POH Sec 7 "Avionics support equipment". Clicking a receptacle plugs / unplugs a portable device: the
  // outlet's device loads the CABIN PWR 12V converter (C172G.outletDevice, electrical.ts `cabin_12v`), the
  // jack's cable feeds entertainment audio to the headsets (C172G.auxAudioCable -> auxAudioActive, variant.ts).
  const jack = new THREE.Mesh(env.geometry.get('c172g.aux_jack', () => cylinderZ(0.0045, 0.0042, 0, 0.004, 20)), mats.get('chrome'));
  jack.userData.cockpitStatic = true;
  face.addObject(jack, 0.03, 0.195);
  txt('AUX\nAUDIO IN', 0.03, 0.182, 0.0016);
  const outlet = new THREE.Mesh(env.geometry.get('c172g.outlet', () => cylinderZ(0.0115, 0.011, 0, 0.006, 28)), mats.get('plasticBlack'));
  outlet.userData.cockpitStatic = true;
  face.addObject(outlet, 0.035, 0.24);
  const hole = new THREE.Mesh(env.geometry.get('c172g.outlet_hole', () => new THREE.CircleGeometry(0.0085, 24)), mats.get('panelDark'));
  hole.userData.cockpitStatic = true;
  face.addObject(hole, 0.035, 0.24, { z: 0.0062 });
  txt('POWER OUTLET\n12V - 10A', 0.04, 0.265, 0.0015);
  // Plugs (shown while plugged in): a 3.5 mm jack plug with its cable, a cigarette-lighter adapter.
  const auxPlug = new THREE.Group();
  auxPlug.name = 'aux_audio_plug';
  auxPlug.add(new THREE.Mesh(env.geometry.get('c172g.aux_plug', () => cylinderZ(0.003, 0.003, 0.004, 0.024, 12)), mats.get('plasticBlack')));
  auxPlug.userData.cockpitDynamic = true;
  face.addObject(auxPlug, 0.03, 0.195);
  const outletPlug = new THREE.Group();
  outletPlug.name = 'outlet_plug';
  outletPlug.add(new THREE.Mesh(env.geometry.get('c172g.outlet_plug', () => cylinderZ(0.0105, 0.009, 0.004, 0.045, 20)), mats.get('plasticBlack')));
  outletPlug.userData.cockpitDynamic = true;
  face.addObject(outletPlug, 0.035, 0.24);
  face.add(
    new PushButton(env, { id: 'c172g.aux_audio_jack', label: 'AUX AUDIO IN (click: plug / unplug an audio player)', mode: 'toggle', var: C172G.auxAudioCable, style: 'small', width: 0.007, height: 0.007, capMaterial: 'chrome' }),
    0.03,
    0.195,
    { z: 0.001 },
  );
  face.add(
    new PushButton(env, { id: 'c172g.power_outlet', label: 'POWER OUTLET 12V - 10A (click: plug / unplug a device)', mode: 'toggle', var: C172G.outletDevice, style: 'small', width: 0.016, height: 0.016, capMaterial: 'plasticBlack' }),
    0.035,
    0.24,
    { z: 0.001 },
  );

  // ---------------------------------------------------------------- fuel shutoff valve (item 21): red knob, push ON / pull OFF
  face.add(
    new PushPullKnob(env, { id: 'c172g.fuel_shutoff', label: 'FUEL SHUTOFF (PUSH ON / PULL OFF)', var: C172.fuelShutoff, valueIn: 1, valueOut: 0, style: 'plain', travel: 0.04, material: 'knobRed', clickToggles: true }),
    0.108,
    0.255,
  );
  txt('FUEL\nSHUTOFF', 0.108, 0.225, 0.0019);
  txt('ON (PUSH)  OFF (PULL)', 0.108, 0.282, 0.0013);

  // Pedestal LED strip light (POH Sec 7: "a second LED strip light ... directly above the 12 volt cabin power outlet").
  const strip = new THREE.Mesh(env.geometry.get('c172g.ped_strip', () => roundedBox(W - 0.03, 0.004, 0.003, 0.001)), mats.get('plasticGrey'));
  strip.userData.cockpitStatic = true;
  face.addObject(strip, W / 2, 0.215, { z: 0.002 });

  // ---------------------------------------------------------------- fuel selector valve (item 22, placard 3) on the floor plate
  const floorPlate = b.panel({
    name: 'c172g.fuel_selector_plate',
    center_m: [sta(PED.botFs + 5), 0, hz(FLOOR_H + 0.012)], // EST: forward legend clear of the pedestal foot
    facing: 'up',
    // EST 7.5 x 8 in plate (photographs): the position legends sit outside the handle's sweep.
    width: 0.19,
    height: 0.2,
    origin: 'center',
    material: mats.custom('paint', '#141414', 0.6),
    thickness: 0.012,
    radius: 0.012,
    screws: { positions: [[-0.085, -0.09], [0.085, 0.09]] },
  });
  floorPlate.add(
    new FuelSelector(env, {
      id: 'c172g.fuel_selector',
      label: 'FUEL SELECTOR (LEFT / BOTH / RIGHT)',
      var: C172.fuelSelector,
      positions: [
        { value: FUEL_SEL.left, label: 'LEFT', angle: -90 },
        { value: FUEL_SEL.both, label: 'BOTH', angle: 0 },
        { value: FUEL_SEL.right, label: 'RIGHT', angle: 90 },
      ],
      initial: 1,
      // POH placard 3: LEFT / RIGHT 26.5 gal LEVEL FLIGHT ONLY; BOTH 53.0 gal TAKEOFF LANDING ALL FLIGHT ATTITUDES.
      sublabels: ['26.5 GAL\nLEVEL FLIGHT\nONLY', '53.0 GAL\nTAKEOFF LANDING\nALL FLIGHT ATTITUDES', '26.5 GAL\nLEVEL FLIGHT\nONLY'],
      placardDiameter: 0.185,
      // The 'wing' handle is ~2x `diameter` tip to tip (tip radius ~0.055 m, EST 4.3 in handle from the
      // photographs); legends centred at 0.074 m so no legend is ever under the handle.
      diameter: 0.055,
      labelRadius: 0.074,
      labelHeight: 0.0028,
    }),
    0,
    -0.004,
  );
  const fsl = env.labels.text('FUEL SELECTOR', { height: 0.0028, weight: 700, zone: null, color: '#f0f0ec' });
  fsl.userData.cockpitStatic = true;
  floorPlate.addObject(fsl, 0.062, -0.09, { z: 0.0002 });
  return { auxPlug, outletPlug };
}
