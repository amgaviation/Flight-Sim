/**
 * Longitude primary flight controls in the cockpit: two control wheels
 * (conventional yokes, cable-driven elevator / ailerons, OG 15-2/15-3, BCA
 * "strictly cables and pulleys between a conventional yoke and the aileron
 * surfaces"), rudder pedals with toe brakes (brake-by-wire, OG 14), and the
 * left-seat nosewheel tiller (BCA: "a left seat tiller ... up to 80-81 deg").
 *
 * Wheels (L48): Longitude ram's-horn wheels ('ramshorn': tall grips on a flat
 * hub), hub at about the PFD bottom edge (Textron photograph, a21_004).
 * Wheel switches (dossier §7.8, c_yokeL21): AP/TRIM DISC (red, outboard grip;
 * event `ap.disc` + hold var: trim and pusher interrupt), ICS push, the split
 * pitch-trim switch and the PTT trigger on the back of the grip (L49; PTT and
 * ICS drive COM transmit / intercom state, SCOPE).
 *
 * The wheels are animated from the surface positions (surf.elevator /
 * surf.aileron) so the autopilot back-drives them, as with the real
 * cable-connected controls.
 */
import * as THREE from 'three';
import { RudderPedals, RotaryKnob, Yoke } from '../../../cockpit/controls';
import { SURF } from '../../../core/vars';
import { LON_VARS as V } from '../vars';
import { lonMaterials, type LonCockpitContext } from './context';
import { PEDALS_L, PEDALS_R, TILLER, YOKE_HUB_L, YOKE_HUB_R } from './layout';

export function buildFlightControls(c: LonCockpitContext): void {
  const { b, env } = c;
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'L' : 'R';
    const outboard = side < 0 ? 'left' : 'right';
    const lower = s.toLowerCase();
    const yoke = new Yoke(env, {
        id: `lon.fc.yoke_${lower}`,
        label: side < 0 ? 'PILOT CONTROL WHEEL' : 'COPILOT CONTROL WHEEL',
        style: 'ramshorn',
        column: { kind: 'pivot', length: 0.55 },
        pitchVar: SURF.elevator,
        rollVar: SURF.aileron,
        // Outboard grip face (c_yokeL21): red AP/TRIM DISC at the top, small ICS push button beside it, the split
        // pitch-trim thumb switch below; PTT trigger on the back of the grip.
        switches: [
          {
            anchor: `${outboard}Front`,
            offset: [0, 0.03, 0],
            kind: 'button',
            options: { id: `lon.fc.ap_disc_${lower}`, label: `AP/TRIM DISC (${s})`, var: side < 0 ? V.yokeDiscL : V.yokeDiscR, mode: 'momentary', event: 'ap.disc', capMaterial: 'knobRed' },
          },
          {
            anchor: `${outboard}Front`,
            offset: [-side * 0.012, 0.018, 0],
            kind: 'button',
            // SCOPE: intercom (ICS) push; sets the ICS state (systems/crewControls.ts), no audio-panel model.
            options: { id: `lon.fc.ics_${lower}`, label: `ICS (${s})`, var: side < 0 ? V.yokeIcsL : V.yokeIcsR, mode: 'momentary', style: 'small', capMaterial: 'plasticGrey' },
          },
          {
            anchor: `${outboard}Front`,
            offset: [0, -0.006, 0],
            kind: 'rocker',
            options: {
              id: `lon.fc.trim_${lower}`,
              label: `PITCH TRIM (${s})`,
              var: side < 0 ? V.yokeTrimL : V.yokeTrimR,
              positions: ['NOSE UP', 'OFF', 'NOSE DN'],
              values: [1, 0, -1],
              initial: 1,
              springs: { 0: 1, 2: 1 },
            },
          },
          {
            // MIC/INPH (DGAC CABIN ALTITUDE / EMERGENCY DESCENT step 3 "MIC/INPH Switches (both) - Outboard, as required
            // to enable intercom"): inboard = MIC (transmit on PTT), outboard = INPH (hot intercom). EST position on
            // the inboard grip face. SCOPE: sets the intercom state (systems/logic.ts), no audio model.
            anchor: `${side < 0 ? 'right' : 'left'}Front`,
            offset: [0, 0.02, 0],
            kind: 'rocker',
            options: {
              id: `lon.fc.mic_inph_${lower}`,
              label: `MIC/INPH (${s})`,
              var: side < 0 ? V.micInphL : V.micInphR,
              positions: ['MIC', 'INPH'],
              values: [0, 1],
              initial: 0,
            },
          },
          {
            anchor: `${outboard}Back`,
            kind: 'button',
            // SCOPE: PTT keys the selected COM (V.transmitting, systems/crewControls.ts); no radio-transmission model.
            options: { id: `lon.fc.ptt_${lower}`, label: `PTT (${s})`, var: side < 0 ? V.pttL : V.pttR, mode: 'momentary', style: 'key', width: 0.014, height: 0.02, capMaterial: 'plasticBlack' },
          },
        ],
      });
    // L2-13 (c_yokeL21 / a21_004): leather-wrapped horns with white stitching and the Textron badge on the hub cap.
    // The grips mesh (shared 'yokeGrip' material) gets a per-aircraft stitched-leather material; a badge placard
    // goes on the hub face. EST finish values (no material spec published).
    const gripShared = env.materials.get('yokeGrip');
    let leather = env.materials.get('yokeGrip');
    {
      const m = new THREE.MeshStandardMaterial({ color: 0x1a1714, roughness: 0.92 });
      m.name = 'lon.yokeLeather';
      env.materials.track(m);
      // Stitch rows: dashed light thread on a leather-grain base (procedural, headless-safe DataTexture).
      const n = 32;
      const data = new Uint8Array(n * n * 4);
      for (let yPix = 0; yPix < n; yPix++)
        for (let xPix = 0; xPix < n; xPix++) {
          const i = (yPix * n + xPix) * 4;
          const grain = 20 + ((xPix * 7 + yPix * 13) % 5) * 2;
          const stitch = yPix === 4 && xPix % 6 < 2;
          const v0 = stitch ? 120 : grain;
          data[i] = v0;
          data[i + 1] = stitch ? 116 : grain - 2;
          data[i + 2] = stitch ? 104 : grain - 3;
          data[i + 3] = 255;
        }
      const tex = new THREE.DataTexture(data, n, n);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;
      m.map = tex;
      leather = m;
    }
    yoke.wheel.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.material === gripShared && (mesh.geometry.getAttribute('uv') ? true : false)) mesh.material = leather;
    });
    // Hub badge: brushed cap with the Textron Aviation wordmark (the real hub carries the Textron badge).
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.002, 24), env.materials.get('steel'));
    b.trackGeometry(badge.geometry);
    badge.rotation.x = Math.PI / 2;
    badge.position.set(0, -0.035, 0.0405); // hub block front face (geometry/yokes.ts ramshorn: 0.05 deep at z 0.014)
    badge.userData.cockpitDynamic = true;
    yoke.wheel.add(badge);
    const mark = env.labels.text('TEXTRON', { height: 0.0028, anchor: 'middle', align: 'center', zone: null, color: '#2b2b2b' });
    mark.position.set(0, -0.035, 0.0418);
    mark.userData.cockpitStatic = false; // moves with the wheel
    yoke.wheel.add(mark);
    b.place(yoke, { center_m: side < 0 ? YOKE_HUB_L : YOKE_HUB_R, facing: 'aft' });
    b.place(new RudderPedals(env, { id: `lon.fc.pedals_${lower}`, label: side < 0 ? 'PILOT RUDDER PEDALS' : 'COPILOT RUDDER PEDALS', style: 'hanging', spacing: 0.3 }), {
      center_m: side < 0 ? PEDALS_L : PEDALS_R,
      facing: 'aft',
    });
  }
  // Nosewheel tiller (L50, c_lcon / AOPA "tiller knob"): a small black finger-grip knob set in the forward left
  // console top, just aft of the PFD GTC wedge: -1..1 = +-81 deg nosewheel (NosewheelSteering, via
  // systems/cockpitInputs.ts). SCOPE: the handle stays where it is left (no centring spring modelled).
  const mount = b.panel({ name: 'tiller_mount', center_m: [TILLER.center_m[0], TILLER.center_m[1], TILLER.center_m[2] - 0.004], facing: 'up', width: 0.11, height: 0.11, material: lonMaterials(env).deck, screws: false, radius: 0.05 });
  const tiller = new RotaryKnob(env, {
    id: 'lon.tiller',
    label: 'NOSEWHEEL TILLER',
    cap: 'skirted',
    diameter: 0.045,
    height: 0.016,
    pointer: 'line',
    dragPxPerClick: 6,
    outer: { var: V.tiller3d, min: -1, max: 1, step: 0.05, angleRange: [-110, 110], label: 'TILLER', format: (v) => `${Math.round(v * 81)}°` },
  });
  // L2-06 (c_lcon / OEG crop): the tiller is a large (~90 mm) black five-lobe scalloped grip lying on the console
  // top, not a small pointer knob. The grip rotates with the knob's outer channel (same drag logic).
  {
    const shape = new THREE.Shape();
    const N = 80;
    for (let k = 0; k <= N; k++) {
      const a = (k / N) * Math.PI * 2;
      const r = 0.037 + 0.008 * Math.cos(5 * a); // five lobes, 90 mm across the lobes
      const px = r * Math.cos(a);
      const py = r * Math.sin(a);
      if (k === 0) shape.moveTo(px, py);
      else shape.lineTo(px, py);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.016, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.006, bevelSegments: 3, curveSegments: 2 });
    b.trackGeometry(g);
    const grip = new THREE.Mesh(g, env.materials.get('handleBlack'));
    grip.position.z = 0.014;
    grip.userData.cockpitDynamic = true;
    tiller.outer.group.add(grip);
    // Widen the click target to the grip diameter.
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.095, 0.03), env.materials.get('hitbox'));
    b.trackGeometry(hit.geometry);
    hit.position.z = 0.02;
    tiller.object.add(hit);
    tiller.hitTargets.push(hit);
  }
  mount.add(tiller, 0, 0);
}
