/**
 * Global 6000 glareshield front face (dossier §12.2, left to right):
 * MASTER WARNING / MASTER CAUTION (pilot), CTP 1, FCP-5120 (centre), CTP 2,
 * MASTER CAUTION / MASTER WARNING (copilot).
 *
 * Sources: FSB BD-700 appendix 6 (FCP, CTP "primary panel for PFD selection",
 * EDM button on the FCP); AOPA 2012 "Control Tuning Panel mounted up high on
 * the glareshield"; GXEL / GXAG: master warning / caution switchlights
 * acknowledge the CAS (CasManager events `cas.ack_warning` /
 * `cas.ack_caution`). Unit sizes FUSION_HW (EST); positions EST from
 * photographs.
 */
import { PushButton } from '../../../cockpit/controls';
import { addCtp, addFcp } from '../../../avionics/collins-fusion';
import { G6K_EVENTS } from '../vars';
import type { G6kCockpitContext } from './context';
import { GLARE_FACE } from './layout';

export const GS_X = { ctp: 0.47, mc: 0.72, mw: 0.765 };

export function buildGlareshield(c: G6kCockpitContext): void {
  const { b, env, suite } = c;
  const G = GLARE_FACE;
  const face = b.panel({ name: 'glareshield_face', center_m: G.center_m, facing: 'aft', tiltDeg: G.tiltDeg, width: G.width, height: G.height, material: 'glareshield', screws: false, radius: 0.012 });
  if (suite) {
    addFcp(b, face, 0, 0, suite);
    addCtp(b, face, -GS_X.ctp, 0, suite, 1);
    addCtp(b, face, GS_X.ctp, 0, suite, 2);
  }
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'l' : 'r';
    const S = side < 0 ? 'PILOT' : 'COPILOT';
    // MASTER WARNING (red) / MASTER CAUTION (amber) switchlights, 30 x 25 mm (dossier §12.2); push = acknowledge.
    face.add(
      new PushButton(env, {
        id: `g6k.gs.mw_${s}`,
        label: `MASTER WARNING (${S})`,
        mode: 'momentary',
        event: G6K_EVENTS.masterWarning,
        width: 0.03,
        height: 0.025,
        segments: [{ text: ['MASTER', 'WARNING'], color: 'red', var: 'alert.master_warning', style: 'field' }],
      }),
      side * GS_X.mw,
      0.005,
    );
    face.add(
      new PushButton(env, {
        id: `g6k.gs.mc_${s}`,
        label: `MASTER CAUTION (${S})`,
        mode: 'momentary',
        event: G6K_EVENTS.masterCaution,
        width: 0.03,
        height: 0.025,
        segments: [{ text: ['MASTER', 'CAUTION'], color: 'amber', var: 'alert.master_caution', style: 'field' }],
      }),
      side * GS_X.mc,
      0.005,
    );
  }
}
