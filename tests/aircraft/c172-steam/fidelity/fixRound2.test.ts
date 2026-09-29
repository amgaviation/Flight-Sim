/**
 * Fix round 2 of the steam 172S (function + layout lenses): each test fails without its fix.
 *  - F01: a mis-set KAP 140 heading bug (the course datum in NAV/APR/REV, Supplement 15 Fig 2 items 14/15)
 *    leaves a lasting tracking error; the Afcs cross-track integral is limited to a crosswind-sized correction.
 *  - V01: the magnetic compass hangs at the top centre of the windshield (VH-SPQ photograph), not on the glareshield.
 *  - L06: the prop blur disc fades to nothing at the tip and is faint from the seat.
 *  - L09 / L17: fuel selector pointer about 3 x 0.8 in; mixture cap with raised points round its rim.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AP, FDM, NAV } from '../../../../src/core/vars';
import { EV, ST } from '../../../../src/aircraft/c172-steam/vars';
import { CDI1_RECEIVER } from '../../../../src/aircraft/c172-steam/systems';
import { COURSE_DATUM_INTEGRAL_DEG } from '../../../../src/systems/autopilot/Afcs';
import { PROP_DISC_OPACITY_COCKPIT, propDiscAlpha, propDiscGeometry } from '../../../../src/aircraft/c172s-common/exterior';
import { knobGeometry } from '../../../../src/cockpit/geometry/knobs';
import { WINDSHIELD, GLARE, hz } from '../../../../src/aircraft/c172-steam/cockpit/layout';
import { sta } from '../../../../src/aircraft/c172s-common/fdm';
import { makeSteamRig, type SteamRig } from '../rig';

const D2R = Math.PI / 180;

/**
 * VOR tracking at 105 KIAS against a synthetic station 20 nm ahead whose deviation follows the airplane's real
 * cross-track from the start point along the course. Returns the cross-track (nm, + right of course) sampled at
 * the given times.
 */
function trackVor(bugOffsetDeg: number, sampleAt: number[]): number[] {
  const r: SteamRig = makeSteamRig({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 105 } });
  const i = r.sys.list.indexOf(r.sys.radios);
  if (i >= 0) r.sys.list.splice(i, 1);
  const v = r.vars;
  r.run(2);
  const crsMag = Math.round(v.get(ST.dgHeading));
  const crsTrue = v.get(FDM.headingTrue) * D2R;
  const lat0 = v.get(FDM.lat);
  const lon0 = v.get(FDM.lon);
  let right = 0;
  const feed = (): void => {
    const dN = (v.get(FDM.lat) - lat0) * 60;
    const dE = (v.get(FDM.lon) - lon0) * 60 * Math.cos(lat0 * D2R);
    right = dE * Math.cos(crsTrue) - dN * Math.sin(crsTrue);
    const dev = Math.asin(Math.max(-1, Math.min(1, -right / 20))) / D2R; // + = left of course, fly right
    v.set(NAV.powered(1), 1);
    v.set(NAV.received(1), 1);
    v.set(NAV.isLoc(1), 0);
    v.set(NAV.toFrom(1), 1);
    v.set(NAV.devDeg(1), dev);
    v.set(NAV.cdi(1), Math.max(-1, Math.min(1, dev / 10)));
    v.set(NAV.distNm(1), 20);
    v.set(NAV.obs(1), crsMag);
    v.set(NAV.obs(CDI1_RECEIVER), crsMag);
  };
  feed();
  v.set(AP.selHeading, (crsMag + bugOffsetDeg + 360) % 360);
  r.events.emit(EV.kap('ap'));
  r.run(0.2, () => void feed());
  r.events.emit(EV.kap('nav'));
  const out: number[] = [];
  let t = 0;
  for (const s of sampleAt) {
    r.run(s - t, () => void feed());
    t = s;
    expect(r.sys.afcs.lat).toBe('VOR');
    out.push(right);
  }
  return out;
}

describe('c172-steam fix round 2', () => {
  it('F01: a heading bug 30 deg off the course leaves a lasting VOR tracking error (not washed out by the integrator)', () => {
    expect(COURSE_DATUM_INTEGRAL_DEG).toBeLessThanOrEqual(12);
    const good = trackVor(0, [400]);
    expect(Math.abs(good[0])).toBeLessThan(0.15);
    const [x240, x400, x600] = trackVor(30, [240, 400, 600]);
    // Standing off to the bug side (the bug pulls right) and not converging back to the course.
    expect(x240).toBeGreaterThan(0.25);
    expect(x400).toBeGreaterThan(0.25);
    expect(x600).toBeGreaterThan(0.25);
    expect(Math.abs(x600 - x400)).toBeLessThan(0.15);
  }, 120_000);

  it('V01: compass hangs from the windshield top centre, above the glareshield and clear of it', async () => {
    const { steamCockpitRig } = await import('../cockpitRig');
    const { ck } = await steamCockpitRig('cold_dark');
    ck.build.root.updateMatrixWorld(true);
    const c = ck.build.controls.find((x) => x.id === 'c172s.compass');
    expect(c).toBeTruthy();
    const p = new THREE.Vector3();
    (c as unknown as { object: THREE.Object3D }).object.getWorldPosition(p);
    const local = ck.build.root.worldToLocal(p.clone());
    const bodyLocal = new THREE.Vector3(-local.z, local.x, -local.y); // cockpit-local (x right, y up, z aft) -> body
    // Near the windshield top (within 4 in fore/aft of its top station), well above the glareshield top.
    expect(Math.abs(bodyLocal.x - sta(WINDSHIELD.topFs))).toBeLessThan(0.1 + 4 * 0.0254);
    expect(bodyLocal.z).toBeLessThan(hz(GLARE.topH + 0.15)); // z down: higher = smaller z
    expect(Math.abs(bodyLocal.y)).toBeLessThan(0.01);
    expect((ck.build.views ?? []).some((w) => w.name === 'Compass')).toBe(true);
  });

  it('L06: prop blur disc alpha falls to zero at the tip; faint from the seat', () => {
    expect(propDiscAlpha(0.3)).toBe(1);
    expect(propDiscAlpha(0.9)).toBeLessThan(0.15);
    expect(propDiscAlpha(1)).toBe(0);
    const g = propDiscGeometry(0.95);
    const col = g.getAttribute('color');
    expect(col.itemSize).toBe(4);
    const pos = g.getAttribute('position');
    for (let k = 0; k < pos.count; k++) if (Math.hypot(pos.getX(k), pos.getY(k)) > 0.94) expect(col.getW(k)).toBeLessThan(1e-3);
    expect(PROP_DISC_OPACITY_COCKPIT).toBeLessThanOrEqual(0.04);
  });

  it('L09/L17: fuel selector pointer ~3 x 0.8 in; mixture cap has raised points round its rim', async () => {
    const { steamCockpitRig } = await import('../cockpitRig');
    const { ck } = await steamCockpitRig('cold_dark');
    const fs = ck.build.controls.find((x) => x.id === 'c172s.fuel_selector') as unknown as { o: { diameter: number; height?: number } };
    // The handle is the shared 'wing' cap at the selector's diameter (the meshes are consolidated at build time).
    const wing = knobGeometry({ style: 'wing', diameter: fs.o.diameter, height: fs.o.height ?? 0.018 });
    wing.computeBoundingBox();
    const sz = wing.boundingBox!.getSize(new THREE.Vector3());
    expect(sz.y).toBeGreaterThan(2.6 * 0.0254);
    expect(sz.y).toBeLessThan(3.4 * 0.0254);
    expect(sz.x).toBeLessThan(1.1 * 0.0254);
    // Star cap: vertices on the rim alternate between tooth tips (full radius) and roots.
    const star = knobGeometry({ style: 'star', diameter: 0.028, height: 0.015, ridges: 12 });
    const pos = star.getAttribute('position');
    let tips = 0;
    let roots = 0;
    for (let k = 0; k < pos.count; k++) {
      const rr = Math.hypot(pos.getX(k), pos.getY(k));
      if (rr > 0.0139) tips++;
      else if (rr > 0.0118 && rr < 0.0122) roots++;
    }
    expect(tips).toBeGreaterThan(12);
    expect(roots).toBeGreaterThan(12);
  });
});
