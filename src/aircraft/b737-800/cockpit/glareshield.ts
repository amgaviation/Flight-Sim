/**
 * 737-800 glareshield panel (P7): Mode Control Panel in the centre, the two
 * EFIS control panels outboard of it, and at each end the master FIRE WARN
 * and MASTER CAUTION lights with the system annunciator panel ("six-pack",
 * push = RECALL). FCOM 15.20: Captain six-pack FLT CONT / IRS / FUEL / ELEC
 * / APU / OVHT/DET, F/O six-pack ANTI-ICE / HYD / DOORS / ENG / OVERHEAD /
 * AIR COND. Sizes: MCP 0.60 x 0.09 m and EFIS 0.165 x 0.09 m (avionics
 * B737_HW); the master lights and six-pack cells EST from photographs.
 */
import { PushButton } from '../../../cockpit/controls';
import { addEfisPanel, addMcp } from '../../../avionics/boeing-737';
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

export function buildGlareshield(c: B738CockpitContext): void {
  const { b, env, sys } = c;
  const p = b.panel({ name: 'b738.p7', ...GLARE.face, origin: 'center', invisible: true });
  // The MCP controls are built even headless (no window displays) so the coverage test sees them.
  addMcp(b, p, 0, 0, sys.suite);
  addEfisPanel(b, p, -0.39, 0, 1);
  addEfisPanel(b, p, 0.39, 0, 2);
  for (const s of [1, 2] as const) {
    const sg = s === 1 ? -1 : 1;
    // Master lights and six-pack plate.
    const plate = p.subPanel({ name: `b738.gs.masters${s}`, x: sg * 0.595, y: 0, width: 0.155, height: 0.075, origin: 'center', material: 'panelDark', thickness: 0.006 });
    const mx = sg * 0.045;
    plate.add(
      new PushButton(env, {
        id: `b738.gs.fire_warn${s}`,
        label: 'FIRE WARN (bell cutout)',
        style: 'korry',
        width: 0.036,
        height: 0.026,
        mode: 'momentary',
        var: B738.fireWarnPush(s),
        segments: [{ text: ['FIRE', 'WARN'], color: 'red', var: B738.lt.fireWarn, style: 'field' }],
      }),
      mx,
      0.016,
    );
    plate.add(
      new PushButton(env, {
        id: `b738.gs.master_caution${s}`,
        label: 'MASTER CAUTION',
        style: 'korry',
        width: 0.036,
        height: 0.026,
        mode: 'momentary',
        var: B738.masterCaution(s),
        segments: [{ text: ['MASTER', 'CAUTION'], color: 'amber', var: B738.lt.masterCaution, style: 'field' }],
      }),
      mx,
      -0.016,
    );
    // Six-pack: one pushable annunciator panel (3 rows x 2 cells). Push = RECALL.
    SIX_PACK[s].forEach((row, i) => {
      plate.add(
        new PushButton(env, {
          id: `b738.gs.sixpack${s}_${i}`,
          label: `SYSTEM ANNUNCIATOR ${s === 1 ? 'CAPT' : 'F/O'} (push = RECALL)`,
          style: 'korry',
          width: 0.07,
          height: 0.017,
          mode: 'momentary',
          var: B738.recall(s),
          layout: 'split',
          segments: row.map(([g, t]) => ({ text: t, color: 'amber' as const, var: B738.lt.group(g), style: 'legend' as const })),
        }),
        -sg * 0.03,
        0.02 - i * 0.02,
      );
    });
  }
}
