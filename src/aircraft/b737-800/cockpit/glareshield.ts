/**
 * 737-800 glareshield panel (P7): Mode Control Panel in the centre, the two
 * EFIS control panels outboard of it, and at each end the master FIRE WARN
 * and MASTER CAUTION lights with the system annunciator panel ("six-pack",
 * push = RECALL). FCOM 15.20: Captain six-pack FLT CONT / IRS / FUEL / ELEC
 * / APU / OVHT/DET, F/O six-pack ANTI-ICE / HYD / DOORS / ENG / OVERHEAD /
 * AIR COND. Layout and sizes measured on the SCBG 1:1 drawing: one
 * continuous grey P7 plate ~0.91 m wide with tapered ends; MCP 0.463 x
 * 0.072 m and EFIS 0.117 x 0.072 m (avionics B737_HW) side by side; FIRE
 * WARN, MASTER CAUTION and the six-pack in one row at each end.
 */
import * as THREE from 'three';
import { PushButton } from '../../../cockpit/controls';
import { addEfisPanel, addMcp } from '../../../avionics/boeing-737';
import { B737_HW } from '../../../avionics/boeing-737/cockpit';
import { B738, type SixPackGroup } from '../vars';
import type { B738CockpitContext } from './context';
import { GLARE } from './layout';

const SIX_PACK: Record<1 | 2, [[SixPackGroup, string], [SixPackGroup, string]][]> = {
  1: [
    [
      ['flt_cont', 'FLT CONT'],
      ['elec', 'ELEC'],
    ],
    [
      ['irs', 'IRS'],
      ['apu', 'APU'],
    ],
    [
      ['fuel', 'FUEL'],
      ['ovht_det', 'OVHT/DET'],
    ],
  ],
  2: [
    [
      ['anti_ice', 'ANTI-ICE'],
      ['eng', 'ENG'],
    ],
    [
      ['hyd', 'HYD'],
      ['overhead', 'OVERHEAD'],
    ],
    [
      ['doors', 'DOORS'],
      ['air_cond', 'AIR COND'],
    ],
  ],
};

/** P7 grey plate outline (u, v from the MCP centre line), Captain end; SCBG drawing, tapered ends. */
const P7_END: [number, number][] = [
  [-0.33, -0.036],
  [-0.454, -0.023],
  [-0.454, 0.016],
  [-0.35, 0.036],
];

export function buildGlareshield(c: B738CockpitContext): void {
  const { b, env, sys } = c;
  const p = b.panel({ name: 'b738.p7', ...GLARE.face, origin: 'center', invisible: true });
  // One continuous grey P7 plate (~0.91 m, tapered ends) behind the MCP, EFIS panels and master lights.
  {
    const sh = new THREE.Shape();
    sh.moveTo(P7_END[0][0], P7_END[0][1]);
    for (const [u, v] of P7_END.slice(1)) sh.lineTo(u, v);
    for (let i = P7_END.length - 1; i >= 0; i--) sh.lineTo(-P7_END[i][0], P7_END[i][1]);
    sh.closePath();
    const depth = 0.006;
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false });
    g.translate(0, 0, -depth + 0.0004);
    b.trackGeometry(g);
    const m = new THREE.Mesh(g, env.materials.get('panel'));
    m.name = 'p7_plate';
    m.userData.cockpitStatic = true;
    p.addObject(m, 0, 0);
  }
  // The MCP controls are built even headless (no window displays) so the coverage test sees them.
  // SCBG drawing: MCP 0.463 m centred, EFIS panels (0.117 m) directly adjacent at +/-0.29 m, all panel grey.
  addMcp(b, p, 0, 0, sys.suite, { material: 'panel' });
  const efisU = B737_HW.mcp.w / 2 + B737_HW.efis.w / 2;
  addEfisPanel(b, p, -efisU, 0, 1, { material: 'panel' });
  addEfisPanel(b, p, efisU, 0, 2, { material: 'panel' });
  for (const s of [1, 2] as const) {
    const sg = s === 1 ? -1 : 1;
    // One row outboard -> inboard: FIRE WARN (+/-0.436), MASTER CAUTION (+/-0.413), six-pack (+/-0.377), SCBG.
    p.add(
      new PushButton(env, {
        id: `b738.gs.fire_warn${s}`,
        label: 'FIRE WARN (bell cutout)',
        style: 'korry',
        width: 0.02,
        height: 0.02,
        mode: 'momentary',
        var: B738.fireWarnPush(s),
        segments: [
          { text: ['FIRE', 'WARN'], color: 'red', var: B738.lt.fireWarn, style: 'field' },
          { text: 'BELL CUTOUT', color: 'red', var: B738.lt.fireWarn, style: 'legend' },
        ],
      }),
      sg * 0.436,
      0,
    );
    p.add(
      new PushButton(env, {
        id: `b738.gs.master_caution${s}`,
        label: 'MASTER CAUTION',
        style: 'korry',
        width: 0.02,
        height: 0.02,
        mode: 'momentary',
        var: B738.masterCaution(s),
        segments: [
          { text: ['MASTER', 'CAUTION'], color: 'amber', var: B738.lt.masterCaution, style: 'field' },
          { text: 'PUSH TO RESET', color: 'amber', var: B738.lt.masterCaution, style: 'legend' },
        ],
      }),
      sg * 0.413,
      0,
    );
    // Six-pack: one pushable annunciator panel (3 rows x 2 cells, 0.046 x 0.06 m). Push = RECALL.
    SIX_PACK[s].forEach((row, i) => {
      p.add(
        new PushButton(env, {
          id: `b738.gs.sixpack${s}_${i}`,
          label: `SYSTEM ANNUNCIATOR ${s === 1 ? 'CAPT' : 'F/O'} (push = RECALL)`,
          style: 'korry',
          width: 0.046,
          height: 0.0195,
          mode: 'momentary',
          var: B738.recall(s),
          layout: 'split',
          segments: row.map(([g, t]) => ({ text: t, color: 'amber' as const, var: B738.lt.group(g), style: 'legend' as const })),
        }),
        sg * 0.377,
        0.02 - i * 0.02,
      );
    });
  }
}
