/**
 * Development preview of the 737NG avionics hardware (not bundled): builds
 * the MCP, EFIS panels, DUs, display select panels and CDUs with the cockpit
 * library and renders them with Three.js so the layout can be compared with
 * flight deck photographs.
 *
 *   npx vite --port 5199  ->  /src/avionics/boeing-737/dev/deck.html?view=mcp|main|cdu
 */
import * as THREE from 'three';
import { SimVars } from '../../../core/SimVars';
import { EventBus } from '../../../core/EventBus';
import { CockpitBuilder, CockpitRuntime, bodyToLocalV, viewQuaternion } from '../../../cockpit';
import { createNavDatabase } from '../../../nav/NavDatabase';
import { createB737Suite } from '../suite';
import { addCdu, addCentreControls, addDisengageLights, addDisplaySelect, addDisplayUnits, addDuBrightness, addEfisPanel, addMcp, addTransferSwitches } from '../cockpit';

const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'mcp';
const vars = new SimVars();
const events = new EventBus();
const nav = createNavDatabase({ baseUrl: '/data/' });
await nav.load();
const suite = createB737Suite({ vars, events, nav }, {});
suite.applyState('cruise');
vars.set('ap.sel_alt_ft', 24000);
vars.set('ap.sel_hdg_deg', 275);
vars.set('ap.sel_spd_kt', 280);
vars.set('ap.sel_crs1_deg', 44);
vars.set('ap.sel_crs2_deg', 44);
vars.set('gear.air_ground', 0);

const b = new CockpitBuilder({ vars, events }, { palette: 'boeing', eyePosition_m: [0, -0.53, -1.0], mergeStatic: false });
const main = b.panel({ name: 'main', center_m: [0.95, 0, -0.72], facing: 'aft', tiltDeg: 10, width: 1.7, height: 0.52, material: 'panel' });
const glare = b.panel({ name: 'glare', center_m: [0.86, 0, -1.02], facing: 'aft', tiltDeg: 20, width: 1.7, height: 0.12, material: 'panel' });
const ped = b.panel({ name: 'ped', center_m: [0.35, 0, -0.52], facing: 'up', tiltDeg: -12, width: 0.46, height: 0.45, material: 'panel' });
addDisplayUnits(main, suite);
addMcp(b, glare, 0, 0, suite);
addEfisPanel(b, glare, -0.5, 0, 1);
addEfisPanel(b, glare, 0.5, 0, 2);
addDisengageLights(b, main, -0.62, 0.2, 1);
addDisengageLights(b, main, 0.62, 0.2, 2);
addDisplaySelect(b, main, -0.76, -0.18, 1);
addDisplaySelect(b, main, 0.76, -0.18, 2);
addDuBrightness(b, main, -0.62, -0.18, ['capt_out', 'capt_in']);
addCentreControls(b, main, 0.2, -0.2);
addTransferSwitches(b, main, -0.3, -0.21);
addCdu(b, ped, -0.1, 0.1, suite, 1);
addCdu(b, ped, 0.1, 0.1, suite, 2);
const build = b.build();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#303338');
scene.add(build.root);
scene.add(new THREE.HemisphereLight('#ffffff', '#444444', 2.2));
const sun = new THREE.DirectionalLight('#ffffff', 2);
sun.position.set(0, 2, 1);
scene.add(sun);
const cam = new THREE.PerspectiveCamera(q.get('fov') ? Number(q.get('fov')) : 40, innerWidth / innerHeight, 0.01, 20);
const views: Record<string, { pos: [number, number, number]; yaw: number; pitch: number; fov: number }> = {
  mcp: { pos: [0.3, 0, -1.02], yaw: 0, pitch: -3, fov: 60 },
  main: { pos: [-0.2, 0, -0.85], yaw: 0, pitch: -6, fov: 60 },
  cdu: { pos: [0.1, 0, -0.95], yaw: 0, pitch: -60, fov: 35 },
};
const vw = views[view] ?? views.mcp;
cam.fov = vw.fov;
cam.updateProjectionMatrix();
cam.position.copy(bodyToLocalV(vw.pos));
cam.quaternion.copy(viewQuaternion(vw.yaw, vw.pitch));
const rt = new CockpitRuntime({ build, vars, renderer });
for (let i = 0; i < 90; i++) {
  for (const s of suite.systems) s.update(1 / 30);
  rt.update(1 / 30);
}
for (const k of (q.get('cdu') ?? '').split(',').filter(Boolean)) suite.cdus[0].key(k);
for (let i = 0; i < 10; i++) {
  for (const s of suite.systems) s.update(1 / 30);
  rt.update(1 / 30);
}
renderer.render(scene, cam);
(window as unknown as { __ready: boolean }).__ready = true;
