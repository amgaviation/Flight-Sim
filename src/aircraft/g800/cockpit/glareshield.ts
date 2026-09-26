/**
 * G800 glareshield (dossier §9.1):
 *  - GP-700 guidance panel in the centre (Epic `addGuidancePanel`: SPEED / HEADING / VS-FPA /
 *    ALTITUDE windows, BARO / CRS / SPD / HDG / ALT knobs, VS wheel, lit mode keys, PFD CMD);
 *  - the two touch standby flight displays (ESIS SFDs) either side of it (BJT500: "two ...
 *    standby instruments mounted under the glareshield on either side of the guidance panel");
 *  - MASTER WARNING (red) and MASTER CAUTION (amber) switchlights in front of each pilot
 *    (events cas.ack_warning / cas.ack_caution; lamps alert.master_warning / alert.master_caution).
 * Positions EST from G500/G600/G700 photographs.
 */
import { PushButton } from '../../../cockpit/controls';
import { addGuidancePanel, addSfd } from '../../../avionics/honeywell-epic/cockpit';
import type { G800CockpitContext } from './context';
import { GLARE_FACE } from './layout';

export function buildGlareshield(c: G800CockpitContext): void {
  const { b, env, suite } = c;
  const f = GLARE_FACE;
  const face = b.panel({ name: 'g800.glare', center_m: f.center_m, facing: 'aft', tiltDeg: f.tiltDeg, width: f.width, height: f.height, material: 'panelDark', screws: false, radius: 0.006 });
  if (suite) {
    addGuidancePanel(b, face, 0, 0, suite);
    addSfd(face, -0.465, 0, suite, 1);
    addSfd(face, 0.465, 0, suite, 2);
  }
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'L' : 'R';
    face.add(
      new PushButton(env, {
        id: `g800.gs.mwarn_${s.toLowerCase()}`,
        label: `MASTER WARNING (${s})`,
        mode: 'momentary',
        event: 'cas.ack_warning',
        style: 'korry',
        width: 0.03,
        height: 0.022,
        layout: 'stack',
        segments: [{ text: ['MASTER', 'WARNING'], color: 'red', var: 'alert.master_warning' }],
      }),
      side * 0.585,
      0.013,
    );
    face.add(
      new PushButton(env, {
        id: `g800.gs.mcaut_${s.toLowerCase()}`,
        label: `MASTER CAUTION (${s})`,
        mode: 'momentary',
        event: 'cas.ack_caution',
        style: 'korry',
        width: 0.03,
        height: 0.022,
        layout: 'stack',
        segments: [{ text: ['MASTER', 'CAUTION'], color: 'amber', var: 'alert.master_caution' }],
      }),
      side * 0.585,
      -0.015,
    );
  }
}
