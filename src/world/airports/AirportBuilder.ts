/**
 * Builds the Three.js representation of one airport from its layout:
 * runway strips (with procedural AC 150/5340-1M markings), parallel taxiway,
 * connectors with hold-short markings, apron, lights and optional buildings.
 *
 * Everything lives in the airport's local frame (Three.js ENU at the airport
 * reference point, height 0). Vertices are computed geodetic -> ECEF -> ENU,
 * so pavement follows the Earth's curvature like the terrain; the airport
 * group is placed with `ReferenceFrame.placeObject(group, lat, lon, 0)`.
 */
import * as THREE from 'three';
import { ReferenceFrame } from '../ReferenceFrame';
import { FT_TO_M } from '../geo';
import type { WorldUniforms } from '../shared/atmosphere';
import { runwayElevation, runwayToLatLon, type AirportLayout, type RunwayModel } from './runwayModel';
import { runwayMarkingLayout } from './markings';
import { airportRunwayLights, beaconLight, type LightDef } from './lightLayout';
import { AirportLights, type PlacedLight } from './AirportLights';
import { createRunwayMaterial } from './RunwayMaterial';
import type { GlyphAtlas } from './glyphAtlas';
import { hangarMesh, terminalMesh, towerMesh, type BuildingMaterials } from './buildings';

export interface AirportBuildContext {
  uniforms: WorldUniforms;
  atlas: GlyphAtlas;
  pavementMaterial: THREE.Material;
  buildings: BuildingMaterials | null;
  /** Terrain elevation (m MSL) for placing approach lights over rising ground; may return NaN. */
  terrainElevation?: (lat: number, lon: number) => number;
}

export interface BuiltAirport {
  icao: string;
  layout: AirportLayout;
  /** Group in airport-local coordinates; place with frame.placeObject(group, lat, lon, 0). */
  group: THREE.Group;
  lights: AirportLights;
  dispose(): void;
}

/** Visual lift of pavement above the runway plane (m); terrain is sunk below pavement. */
export const PAVEMENT_LIFT_M = 0.03;
const STEP_M = 40;

const _ll = { lat: 0, lon: 0 };
const _v = new THREE.Vector3();
const _up = new THREE.Vector3();

function steps(a: number, b: number, maxStep: number): number[] {
  const n = Math.max(1, Math.ceil(Math.abs(b - a) / maxStep));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(a + ((b - a) * i) / n);
  return out;
}

/**
 * Rectangle in runway (s, t) coordinates as a grid mesh in the airport frame.
 * `attr(s, t, out)` fills the custom attribute for a vertex.
 */
function rectGeometry(
  lf: ReferenceFrame,
  rw: RunwayModel,
  s0: number,
  s1: number,
  t0: number,
  t1: number,
  lift: number,
  attrName: string,
  itemSize: number,
  attr: (s: number, t: number, out: Float32Array, o: number) => void,
): THREE.BufferGeometry {
  const ss = steps(s0, s1, STEP_M);
  const ts = steps(t0, t1, STEP_M);
  const nV = ss.length * ts.length;
  const pos = new Float32Array(nV * 3);
  const nrm = new Float32Array(nV * 3);
  const extra = new Float32Array(nV * itemSize);
  let k = 0;
  for (const s of ss) {
    const h = runwayElevation(rw, s) + lift;
    for (const t of ts) {
      runwayToLatLon(rw, s, t, _ll);
      lf.toLocal(_ll.lat, _ll.lon, h, _v);
      lf.upAt(_ll.lat, _ll.lon, _up);
      pos[k * 3] = _v.x;
      pos[k * 3 + 1] = _v.y;
      pos[k * 3 + 2] = _v.z;
      nrm[k * 3] = _up.x;
      nrm[k * 3 + 1] = _up.y;
      nrm[k * 3 + 2] = _up.z;
      attr(s, t, extra, k * itemSize);
      k++;
    }
  }
  const cols = ts.length;
  const idx: number[] = [];
  for (let i = 0; i < ss.length - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Ensure counter-clockwise when seen from above (normal up).
  const ax = pos[idx[0] * 3];
  const az = pos[idx[0] * 3 + 2];
  const bx = pos[idx[1] * 3] - ax;
  const bz = pos[idx[1] * 3 + 2] - az;
  const cx = pos[idx[2] * 3] - ax;
  const cz = pos[idx[2] * 3 + 2] - az;
  // y component of (p1 - p0) x (p2 - p0)
  if (bz * cx - bx * cz < 0) {
    for (let i = 0; i < idx.length; i += 3) {
      const tmp = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = tmp;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute(attrName, new THREE.BufferAttribute(extra, itemSize));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function placeLights(lf: ReferenceFrame, rw: RunwayModel, defs: LightDef[], ctx: AirportBuildContext, out: PlacedLight[]): void {
  for (const def of defs) {
    runwayToLatLon(rw, def.s, def.t, _ll);
    let elev: number;
    if (def.heightRef === 'threshold' && def.end >= 0) {
      elev = rw.ends[def.end].elevationM + def.h;
      // Keep approach lights above rising terrain (they stand on masts over falling terrain).
      const te = ctx.terrainElevation ? ctx.terrainElevation(_ll.lat, _ll.lon) : NaN;
      if (Number.isFinite(te)) elev = Math.max(elev, te + 0.5);
    } else elev = runwayElevation(rw, def.s) + PAVEMENT_LIFT_M + def.h;
    lf.toLocal(_ll.lat, _ll.lon, elev, _v);
    // Facing direction (s, t) -> (east, north) -> local three (x = E, z = -N).
    let dE = def.dirS * rw.dirE + def.dirT * rw.dirN;
    let dN = def.dirS * rw.dirN - def.dirT * rw.dirE;
    const len = Math.hypot(dE, dN);
    if (len > 0) {
      dE /= len;
      dN /= len;
    }
    out.push({ def, x: _v.x, y: _v.y, z: _v.z, dx: dE, dy: 0, dz: -dN, lat: _ll.lat, lon: _ll.lon, elevM: elev });
  }
}

/** Builds an airport. Never throws for well-formed layouts. */
export function buildAirport(layout: AirportLayout, ctx: AirportBuildContext): BuiltAirport {
  const ap = layout.airport;
  const lf = new ReferenceFrame(ap.lat, ap.lon);
  const group = new THREE.Group();
  group.name = `airport ${ap.icao}`;
  const disposables: { dispose(): void }[] = [];
  const placed: PlacedLight[] = [];
  const lightsByRunway = airportRunwayLights(layout);

  for (const rw of layout.runways) {
    const mk = runwayMarkingLayout(rw);
    const halfPaved = rw.widthM / 2 + rw.shoulderM;
    const g = rectGeometry(lf, rw, -rw.ends[0].blastPadM, rw.lengthM + rw.ends[1].blastPadM, -halfPaved, halfPaved, PAVEMENT_LIFT_M, 'aRwy', 2, (s, t, out, o) => {
      out[o] = s / FT_TO_M;
      out[o + 1] = t / FT_TO_M;
    });
    // Rubber build-up scales with traffic (EST by airport class).
    const rubber = rw.airportType === 'large_airport' ? 1 : rw.airportType === 'medium_airport' ? 0.7 : 0.35;
    const mat = createRunwayMaterial(mk, rw.surface, ctx.uniforms, ctx.atlas, rw.paved ? rubber : 0);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = `runway ${rw.id}`;
    mesh.receiveShadow = true;
    // Draw after terrain so coplanar edges resolve toward the runway.
    mesh.renderOrder = 1;
    group.add(mesh);
    disposables.push(g, mat);
  }

  const tw = layout.taxiway;
  if (tw) {
    const rw = tw.runway;
    const tc = tw.side * tw.offsetM;
    const hw = tw.widthM / 2;
    const addPave = (g: THREE.BufferGeometry, name: string) => {
      const m = new THREE.Mesh(g, ctx.pavementMaterial);
      m.name = name;
      m.receiveShadow = true;
      m.renderOrder = 1;
      group.add(m);
      disposables.push(g);
    };
    addPave(
      rectGeometry(lf, rw, tw.s0 - hw, tw.s1 + hw, tc - hw, tc + hw, PAVEMENT_LIFT_M * 0.8, 'aPave', 4, (s, t, out, o) => {
        out[o] = s / FT_TO_M;
        out[o + 1] = (t - tc) / FT_TO_M;
        out[o + 2] = 0;
        out[o + 3] = 0;
      }),
      'parallel taxiway',
    );
    const halfPaved = rw.widthM / 2 + rw.shoulderM;
    for (const c of tw.connectors) {
      const tA = tw.side * halfPaved;
      const tB = tc - tw.side * hw;
      addPave(
        rectGeometry(lf, rw, c - hw, c + hw, Math.min(tA, tB), Math.max(tA, tB), PAVEMENT_LIFT_M * 0.9, 'aPave', 4, (s, t, out, o) => {
          out[o] = Math.abs(t) / FT_TO_M; // along the connector, from the runway centreline
          out[o + 1] = (s - c) / FT_TO_M;
          out[o + 2] = 2;
          out[o + 3] = tw.holdLineM / FT_TO_M;
        }),
        'connector',
      );
    }
    const a = tw.apron;
    addPave(
      rectGeometry(lf, rw, a.s0, a.s1, a.t0, a.t1, PAVEMENT_LIFT_M * 0.7, 'aPave', 4, (s, t, out, o) => {
        out[o] = s / FT_TO_M;
        out[o + 1] = t / FT_TO_M;
        out[o + 2] = 1;
        out[o + 3] = 0;
      }),
      'apron',
    );

    if (ctx.buildings) {
      const bm = ctx.buildings;
      const yaw = Math.atan2(rw.dirN, rw.dirE);
      const tFar = tw.side > 0 ? a.t1 : a.t0;
      const place = (obj: THREE.Object3D, s: number, t: number) => {
        runwayToLatLon(rw, s, t, _ll);
        lf.toLocal(_ll.lat, _ll.lon, runwayElevation(rw, s), obj.position);
        obj.rotation.set(0, yaw, 0);
        group.add(obj);
        obj.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) disposables.push(m.geometry);
        });
      };
      const apronLen = a.s1 - a.s0;
      const mid = (a.s0 + a.s1) / 2;
      if (rw.airportType === 'large_airport') {
        place(terminalMesh(bm, apronLen * 0.75, 40, 16), mid, tFar + tw.side * 45);
        place(towerMesh(bm, 45), a.s1 + 50, tFar + tw.side * 40);
        for (let k = 0; k < 3; k++) place(hangarMesh(bm, 60, 50, 18), a.s0 - 50 - k * 75, tFar - tw.side * 10);
      } else if (rw.airportType === 'medium_airport') {
        place(terminalMesh(bm, Math.min(90, apronLen * 0.5), 25, 9), mid, tFar + tw.side * 30);
        place(towerMesh(bm, 25), a.s1 + 30, tFar + tw.side * 25);
        for (let k = 0; k < 2; k++) place(hangarMesh(bm, 40, 35, 12), a.s0 + 30 + k * 50, tFar + tw.side * 30);
      } else {
        for (let k = 0; k < 3; k++) place(hangarMesh(bm, 18, 14, 5), a.s0 + 12 + k * 22, tFar + tw.side * 14);
      }
    }
  }

  for (const { runway, lights } of lightsByRunway) placeLights(lf, runway, lights, ctx, placed);
  if (layout.beacon) {
    const b = layout.beacon;
    const def = beaconLight();
    const main = layout.taxiway?.runway ?? layout.runways[0];
    const elev = runwayElevation(main, main.lengthM / 2) + def.h;
    lf.toLocal(b.lat, b.lon, elev, _v);
    placed.push({ def, x: _v.x, y: _v.y, z: _v.z, dx: 0, dy: 0, dz: 0, lat: b.lat, lon: b.lon, elevM: elev });
  }
  const lights = new AirportLights(placed);
  group.add(lights.points);

  return {
    icao: ap.icao,
    layout,
    group,
    lights,
    dispose() {
      group.removeFromParent();
      for (const d of disposables) d.dispose();
      lights.dispose();
    },
  };
}
