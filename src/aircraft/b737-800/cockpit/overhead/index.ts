/**
 * Boeing 737-800 overhead panels (contract in ../context.ts): forward
 * overhead P5 (forward.ts) and aft overhead (aft.ts) on the MOUNTS frames,
 * the housing boxes that carry them down from the ceiling lining, the
 * overhead lighting zone and the cockpit-side derived gauge vars.
 *
 * Lighting (FCOM 1.40 "Flight deck lighting"): the overhead legends are
 * backlit from the overhead PANEL dimmer (`ac.b738.ovhd_panel_lt` ->
 * LightingSystem dimmer 'panel_ovhd' -> `ac.light.panel_ovhd`, zone 'ovhd').
 * The CIRCUIT BREAKER dimmer lights the P6 / P18 breaker panels (zone 'cb',
 * side/index.ts). DOME WHITE drives the dome light (index.ts zone 'dome').
 * The annunciators follow the LIGHTS TEST / DIM switch through the cockpit's
 * annunciator dimming and lamp test (index.ts).
 */
import * as THREE from 'three';
import { bl, localToBody, panelBasis } from '../../../../cockpit/frame';
import type { PanelPlacement } from '../../../../cockpit/frame';
import { B738 } from '../../vars';
import type { B738CockpitContext } from '../context';
import { B738_FUSELAGE as F } from '../fuselage';
import { MOUNTS } from '../layout';
import { INSET } from '../shell';
import { buildForwardOverhead, FWD } from './forward';
import { buildAftOverhead, AFT } from './aft';
import { ovhdPanelMaterial } from './parts';

/** Cockpit-only derived vars for the cabin altitude / rate dials (x 1000 ft, x 1000 fpm). */
const CAB_ALT_K = 'ac.b738.ck.cab_alt_k';
const CAB_RATE_K = 'ac.b738.ck.cab_rate_k';

export function buildOverhead(c: B738CockpitContext): void {
  const { b, ctx } = c;
  const vars = ctx.vars;
  // Gain EST: incandescent 5 V edge-lit overhead plates read brighter than the thin engraving suggests; raised
  // (2.2 -> 6.5, fix round 1 B738-L03) so every legend is legible at PANEL dimmer ~50 %, tuned against the
  // b737.org.uk night overhead photograph (paneloverhead_737-700_night.jpg).
  b.zone({ id: 'ovhd', intensityVar: 'ac.light.panel_ovhd', gain: 6.5 });

  // Base plates in the overhead plate material (slightly lighter than 'panel' so the shadowed ceiling renders
  // the same Boeing grey as the direct-lit MIP; see parts.ts ovhdPanelMaterial, fix round 1 B738-L11).
  const fwd = b.panel({ ...MOUNTS.overheadFwd, name: 'b738.ovhd', width: FWD.w, height: FWD.h, origin: 'top-left', material: ovhdPanelMaterial(b.env), screws: false });
  buildForwardOverhead(c, fwd);
  const aft = b.panel({ ...MOUNTS.overheadAft, name: 'b738.aovhd', width: AFT.w, height: AFT.h, origin: 'top-left', material: ovhdPanelMaterial(b.env), screws: false });
  buildAftOverhead(c, aft);

  const lining = b.env.materials.custom('paint', 0xb9bab5, 0.75);
  housing(c, { ...MOUNTS.overheadFwd, width: FWD.w, height: FWD.h }, lining, { front: true, back: false });
  housing(c, { ...MOUNTS.overheadAft, width: AFT.w, height: AFT.h }, lining, { front: false, back: true });

  b.onUpdate(() => {
    vars.set(CAB_ALT_K, vars.get(B738.lt.cabinAltFt) / 1000);
    vars.set(CAB_RATE_K, vars.get(B738.lt.cabinRateFpm) / 1000);
  });
}

/** Inner-lining height (body z, slightly above the lining) at body (x, |y|). */
function roofZ(x: number, y: number): number {
  let lo = 0;
  let hi = Math.PI / 2;
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2;
    if (F.bodyYZ(x, m, INSET)[0] < Math.abs(y)) lo = m;
    else hi = m;
  }
  return F.bodyYZ(x, lo, INSET)[1] - 0.03;
}

/**
 * Housing of an overhead panel: side cheeks (and the forward / aft end
 * plates) from the panel edges up past the ceiling lining, so the panel
 * reads as one console hanging from the roof (EST, NG photographs).
 */
function housing(c: B738CockpitContext, p: PanelPlacement & { width: number; height: number }, mat: THREE.Material, ends: { front: boolean; back: boolean }): void {
  const basis = panelBasis(p);
  const W = p.width / 2;
  const H = p.height / 2;
  const edge = (u: number, v: number): [number, number, number] => {
    const q = basis.origin.clone().addScaledVector(basis.u, u).addScaledVector(basis.v, v).addScaledVector(basis.n, -0.004);
    return localToBody(q);
  };
  const pos: number[] = [];
  const quad = (a: THREE.Vector3, b2: THREE.Vector3, c2: THREE.Vector3, d: THREE.Vector3) => pos.push(a.x, a.y, a.z, b2.x, b2.y, b2.z, c2.x, c2.y, c2.z, a.x, a.y, a.z, c2.x, c2.y, c2.z, d.x, d.y, d.z);
  const N = 8;
  // Side cheeks along v (panel v = -H is the forward end for these downward-facing panels).
  for (const su of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      const v0 = -H + (2 * H * i) / N;
      const v1 = -H + (2 * H * (i + 1)) / N;
      const e0 = edge(su * W, v0);
      const e1 = edge(su * W, v1);
      quad(bl(...e0), bl(...e1), bl(e1[0], e1[1], roofZ(e1[0], e1[1])), bl(e0[0], e0[1], roofZ(e0[0], e0[1])));
    }
  }
  // End plates across u.
  for (const [on, v] of [
    [ends.front, -H],
    [ends.back, H],
  ] as const) {
    if (!on) continue;
    for (let i = 0; i < N; i++) {
      const u0 = -W + (2 * W * i) / N;
      const u1 = -W + (2 * W * (i + 1)) / N;
      const e0 = edge(u0, v);
      const e1 = edge(u1, v);
      quad(bl(...e0), bl(...e1), bl(e1[0], e1[1], roofZ(e1[0], e1[1])), bl(e0[0], e0[1], roofZ(e0[0], e0[1])));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const m = mat.clone();
  m.side = THREE.DoubleSide;
  c.env.materials.track(m);
  const mesh = c.b.structureMesh(g, m);
  mesh.name = 'overhead_housing';
}
