/**
 * Standby magnetic ("whiskey") compass on the windshield centre post
 * (S&D15 §10.4 "Magnetic Compass"; dossier §9.0: on the windshield centre
 * post). A liquid-damped drum card seen through a window, with a lubber line,
 * an internal lamp on the panel-lights circuit and a deviation card.
 *
 * The compass is its own sensor (a magnet in the earth's field), so it reads
 * the airframe's magnetic heading `fdm.hdg_mag_deg` directly (like GPS, an
 * exception to the avionics-read-sensor-vars rule: it has no electrical
 * sensor to fail). Behaviour per the FAA Pilot's Handbook (FAA-H-8083-25C,
 * ch. 8 "Magnetic Compass"):
 *   - card damping: first-order lag, EST tau 1.2 s, and a small overshoot is
 *     ignored (SCOPE);
 *   - reverse sensing: the card is fixed to the magnet, so numbers higher than
 *     the heading appear to the LEFT of the lubber line;
 *   - northerly turning error (UNOS: undershoot north / overshoot south):
 *     error = -(latitude / 15) * bank * cos(heading) (the rule of thumb "lead or
 *     lag by the latitude in a standard-rate turn", ~15 deg bank), limited to
 *     +/-45 deg (EST);
 *   - acceleration error (ANDS: accelerate north, decelerate south) on east /
 *     west headings: error = -60 deg/g * (high-passed longitudinal specific
 *     force) * sin(heading), limited to +/-15 deg (EST magnitudes).
 */
import * as THREE from 'three';
import type { CockpitBuilder } from '../../../../cockpit/CockpitBuilder';
import { bl } from '../../../../cockpit/frame';
import { roundedBox } from '../../../../cockpit/geometry/primitives';
import { FDM } from '../../../../core/vars';

const D2R = Math.PI / 180;
/** Drum (card) radius and height (m). EST from a 2 1/4 in panel-mount compass (e.g. Airpath C-2300). */
const DRUM_R = 0.021;
const DRUM_H = 0.016;
/** Card lag time constant (s). EST. */
const TAU = 1.2;

/** Card texture (browser only; headless gets a plain drum). Headings increase to the LEFT (reverse sensing). */
function cardTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 1440;
  c.height = 128;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#101010';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#f2f2f2';
  g.strokeStyle = '#f2f2f2';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // u = (-H / 360) mod 1 -> pixel x = ((360 - H) % 360) * 4.
  const px = (h: number) => (((360 - h) % 360) + 360) % 360 * 4;
  for (let h = 0; h < 360; h += 5) {
    const x = px(h);
    const long = h % 10 === 0;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, long ? 34 : 22);
    g.stroke();
  }
  const names: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let h = 0; h < 360; h += 30) {
    const t = names[h] ?? String(h / 10);
    g.font = `bold ${names[h] ? 64 : 52}px Arial, Helvetica, sans-serif`;
    const x = px(h);
    g.fillText(t, x, 86);
    if (h === 0) g.fillText(t, c.width, 86); // wrap copy at the seam
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export interface M2Compass {
  /** Card indication (deg magnetic) for tests. */
  indication(): number;
}

export function buildCompass(b: CockpitBuilder, pos: [number, number, number]): M2Compass {
  const env = b.env;
  const vars = env.vars;
  const mats = env.materials;
  // Housing: black case hanging on a bracket from the centre post (local frame x right, y up, z aft).
  const housing = new THREE.Group();
  housing.name = 'm2.compass';
  const caseG = roundedBox(0.062, 0.05, 0.056, 0.008);
  const bracketG = new THREE.BoxGeometry(0.02, 0.04, 0.012).translate(0, 0.043, -0.02);
  b.trackGeometry(caseG, bracketG);
  const caseMat = mats.get('plasticBlack');
  housing.add(new THREE.Mesh(caseG, caseMat), new THREE.Mesh(bracketG, caseMat));
  // Window bezel (front, aft-facing) and glass.
  const bezelG = new THREE.RingGeometry(0.0205, 0.0235, 32, 1).scale(1.05, 0.62, 1).translate(0, 0, 0.0296);
  b.trackGeometry(bezelG);
  housing.add(new THREE.Mesh(bezelG, mats.get('bezel')));
  b.addStructure(housing, pos, { occluder: false });

  // Card drum (dynamic): rotation.y = indicated heading (rad), see the header.
  const tex = cardTexture();
  const cardMat = new THREE.MeshStandardMaterial({ color: tex ? 0xffffff : 0x1a1a1a, map: tex, emissiveMap: tex, roughness: 0.6, metalness: 0 });
  mats.track(cardMat);
  if (tex) b.env.lighting.registerBacklight(cardMat, 'panel', 0.9); // internal compass lamp on the panel-lights circuit (EST)
  const drumG = new THREE.CylinderGeometry(DRUM_R, DRUM_R, DRUM_H, 72, 1, true);
  b.trackGeometry(drumG);
  const drum = new THREE.Mesh(drumG, cardMat);
  drum.name = 'm2.compass_card';
  drum.userData.cockpitDynamic = true;
  const drumHolder = new THREE.Group();
  drumHolder.userData.cockpitDynamic = true;
  drumHolder.position.copy(bl(...pos)).add(new THREE.Vector3(0, -0.002, 0.0095)); // drum front pokes 2.5 mm through the case face = the card window (+/-25 deg of card);
  drumHolder.add(drum);
  b.root.add(drumHolder);
  // Lubber line (orange-white vertical wire in the window) and the glass.
  const lubG = new THREE.BoxGeometry(0.0012, 0.02, 0.001);
  b.trackGeometry(lubG);
  const lubMat = mats.custom('paint', '#ff8a1c', 0.5) as THREE.MeshStandardMaterial;
  const lub = new THREE.Mesh(lubG, lubMat);
  lub.position.set(0, -0.002, 0.031);
  housing.add(lub);
  const glassG = new THREE.CircleGeometry(0.021, 32).scale(1.05, 0.62, 1).translate(0, 0, 0.0318);
  b.trackGeometry(glassG);
  const glass = new THREE.Mesh(glassG, mats.displayGlass());
  housing.add(glass);
  // Deviation card below the case (static label on a white card).
  const card = env.labels.text('FOR  N   30   60   E  120  150\nSTR  N   30   60   E  120  150\nFOR  S  210  240   W  300  330\nSTR  S  210  240   W  300  330', { height: 0.0017, color: '#141414', zone: null, align: 'center' });
  const cardBg = new THREE.Mesh(new THREE.PlaneGeometry(0.062, 0.02), mats.custom('paint', '#e8e4d8', 0.8));
  b.trackGeometry(cardBg.geometry);
  cardBg.position.set(0, -0.037, 0.0);
  card.position.set(0, -0.037, 0.0003);
  const devG = new THREE.Group();
  devG.add(cardBg, card);
  devG.rotation.x = -0.25;
  devG.position.z = 0.02;
  housing.add(devG);
  housing.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.userData.cockpitStatic = true) : undefined));

  // Card dynamics.
  let ind = vars.get(FDM.headingMag);
  let nxSlow = vars.get(FDM.nx);
  b.onUpdate((dt) => {
    if (dt <= 0) return;
    const hdg = vars.get(FDM.headingMag);
    const bank = vars.get(FDM.bank);
    const lat = vars.get(FDM.lat);
    const nx = vars.get(FDM.nx);
    nxSlow += (nx - nxSlow) * Math.min(1, dt / 8);
    const turnErr = Math.max(-45, Math.min(45, -(lat / 15) * bank * Math.cos(hdg * D2R)));
    const accErr = Math.max(-15, Math.min(15, -60 * (nx - nxSlow) * Math.sin(hdg * D2R)));
    const target = hdg + turnErr + accErr;
    let d = target - ind;
    d -= 360 * Math.round(d / 360);
    ind += d * (1 - Math.exp(-dt / TAU));
    ind = ((ind % 360) + 360) % 360;
    drum.rotation.y = ind * D2R;
  });
  return { indication: () => ind };
}
