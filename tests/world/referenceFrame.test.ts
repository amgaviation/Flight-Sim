import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ReferenceFrame } from '../../src/world/ReferenceFrame';
import { destinationPoint, ecefToGeodetic, geodeticToEcef, haversineM } from '../../src/world/geo';

const geo = { lat: 0, lon: 0, alt_m: 0 };

describe('geodesy', () => {
  it('ECEF round trip is exact to sub-millimetre', () => {
    const ecef = new Float64Array(3);
    for (const [lat, lon, h] of [
      [0, 0, 0],
      [39.8617, -104.6731, 1655],
      [-33.9, 151.2, 12000],
      [89.9, 45, 100],
      [-89.99, -170, -400],
      [51.47, -0.4543, 25],
    ]) {
      geodeticToEcef(lat, lon, h, ecef);
      ecefToGeodetic(ecef[0], ecef[1], ecef[2], geo);
      expect(geo.lat).toBeCloseTo(lat, 10);
      expect(Math.abs(((geo.lon - lon + 540) % 360) - 180)).toBeLessThan(1e-9);
      expect(geo.alt_m).toBeCloseTo(h, 5);
    }
  });

  it('WGS84 equatorial radius and polar radius', () => {
    const e = geodeticToEcef(0, 0, 0, [0, 0, 0]);
    expect(e[0]).toBeCloseTo(6378137.0, 6);
    const p = geodeticToEcef(90, 0, 0, [0, 0, 0]);
    expect(p[2]).toBeCloseTo(6356752.314245, 5); // NIMA TR8350.2 b
  });
});

describe('ReferenceFrame', () => {
  it('maps ENU to Three.js as x=east, y=up, z=south at the origin', () => {
    const f = new ReferenceFrame(45, 7);
    const v = new THREE.Vector3();
    f.toLocal(45, 7, 0, v);
    expect(v.length()).toBeLessThan(1e-6);
    f.toLocal(45, 7, 1000, v);
    expect(v.y).toBeCloseTo(1000, 6);
    f.toLocal(45.01, 7, 0, v); // north
    expect(v.z).toBeLessThan(-1000);
    expect(Math.abs(v.x)).toBeLessThan(1e-6);
    f.toLocal(45, 7.01, 0, v); // east
    expect(v.x).toBeGreaterThan(700);
    // Curvature: points on the ellipsoid away from the origin sit below the tangent plane.
    expect(v.y).toBeLessThan(0);
  });

  it('round-trips geodetic -> local -> geodetic within 1 cm at 50 km', () => {
    const f = new ReferenceFrame(39.8617, -104.6731);
    const v = new THREE.Vector3();
    const ll = { lat: 0, lon: 0 };
    const ecefA = new Float64Array(3);
    const ecefB = new Float64Array(3);
    for (let brg = 0; brg < 360; brg += 30) {
      for (const alt of [0, 1655, 12500]) {
        destinationPoint(39.8617, -104.6731, brg, 50_000, ll);
        f.toLocal(ll.lat, ll.lon, alt, v);
        expect(Math.hypot(v.x, v.z)).toBeGreaterThan(49_000);
        f.toGeodetic(v.x, v.y, v.z, geo);
        geodeticToEcef(ll.lat, ll.lon, alt, ecefA);
        geodeticToEcef(geo.lat, geo.lon, geo.alt_m, ecefB);
        const err = Math.hypot(ecefA[0] - ecefB[0], ecefA[1] - ecefB[1], ecefA[2] - ecefB[2]);
        expect(err).toBeLessThan(0.01);
      }
    }
  });

  it('local distances match geodesic distances', () => {
    const f = new ReferenceFrame(51.47, -0.45);
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    f.toLocal(51.47, -0.45, 0, a);
    f.toLocal(51.52, -0.3, 0, b);
    const d = a.distanceTo(b);
    // Chord vs great-circle on the mean sphere: agree to ~0.5% (ellipsoid vs sphere).
    expect(Math.abs(d - haversineM(51.47, -0.45, 51.52, -0.3)) / d).toBeLessThan(0.005);
  });

  it('recenters beyond 10 km and the delta maps old coordinates to new ones', () => {
    const f = new ReferenceFrame(47.0, 8.0);
    const events: unknown[] = [];
    f.onRecenter((e) => events.push(e));
    expect(f.maybeRecenter(47.05, 8.0)).toBe(false); // ~5.6 km
    const pOld = new THREE.Vector3();
    f.toLocal(47.3, 8.2, 3000, pOld);
    let delta: THREE.Matrix4 | null = null;
    f.onRecenter((e) => (delta = e.delta));
    expect(f.maybeRecenter(47.2, 8.1)).toBe(true);
    expect(events.length).toBe(1);
    expect(f.originLat).toBe(47.2);
    expect(f.version).toBe(1);
    const pNew = new THREE.Vector3();
    f.toLocal(47.3, 8.2, 3000, pNew);
    const mapped = pOld.clone().applyMatrix4(delta!);
    expect(mapped.distanceTo(pNew)).toBeLessThan(0.001);
  });

  it('enuQuaternion rotates local up to the local vertical', () => {
    const f = new ReferenceFrame(10, 20);
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3();
    f.enuQuaternion(10.5, 20.5, q);
    f.upAt(10.5, 20.5, up);
    const v = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    expect(v.distanceTo(up)).toBeLessThan(1e-9);
    // The tilt equals the angle between verticals (~0.7 deg over ~78 km).
    expect(THREE.MathUtils.radToDeg(Math.acos(up.y))).toBeGreaterThan(0.5);
  });

  it('attitudeQuaternion: nose points along heading, right wing drops in right bank', () => {
    const f = new ReferenceFrame(0, 0);
    const q = new THREE.Quaternion();
    const fwd = new THREE.Vector3();
    f.attitudeQuaternion(0, 0, 90, 0, 0, q);
    fwd.set(0, 0, -1).applyQuaternion(q);
    expect(fwd.x).toBeCloseTo(1, 9); // east
    f.attitudeQuaternion(0, 0, 0, 10, 0, q);
    fwd.set(0, 0, -1).applyQuaternion(q);
    expect(fwd.y).toBeCloseTo(Math.sin(THREE.MathUtils.degToRad(10)), 9);
    expect(fwd.z).toBeLessThan(0); // north
    f.attitudeQuaternion(0, 0, 0, 0, 30, q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    expect(right.y).toBeCloseTo(-0.5, 9);
  });

  it('nedQuaternionToLocal agrees with attitudeQuaternion for ZYX Euler angles', () => {
    const f = new ReferenceFrame(40, -105);
    const toRad = THREE.MathUtils.degToRad;
    for (const [h, p, b] of [
      [0, 0, 0],
      [37, 5, -12],
      [270, -8, 45],
      [123, 60, 170],
    ]) {
      // Body-to-NED quaternion q = qz(psi) * qy(theta) * qx(phi).
      const qz = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), toRad(h));
      const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), toRad(p));
      const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), toRad(b));
      const qNed = qz.multiply(qy).multiply(qx);
      const a = f.nedQuaternionToLocal(40.2, -105.1, qNed.w, qNed.x, qNed.y, qNed.z, new THREE.Quaternion());
      const e = f.attitudeQuaternion(40.2, -105.1, h, p, b, new THREE.Quaternion());
      expect(Math.abs(a.dot(e))).toBeCloseTo(1, 9);
    }
  });
});
