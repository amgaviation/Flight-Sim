/**
 * Longitude glareshield front face (dossier §7.1, left to right):
 * MASTER WARNING / MASTER CAUTION (above each PFD, OG 3-2 Fig 3-2-2), the
 * GDU controllers above each PFD (OG 2-2, 4-5), the L / R ENG FIRE
 * switchlights with the BOTTLE 1 / BOTTLE 2 ARMED-DISCH buttons (EST layout,
 * Citation family; dossier §4.7), and the GMC 710 AFCS controller in the
 * centre (G5000; no YD key, OG 4-7).
 */
import { PushButton, GuardedButton } from '../../../cockpit/controls';
import { LON_VARS as V } from '../vars';
import { CK, seg, type LonCockpitContext } from './context';
import { GLARE_FACE } from './layout';
import { addDisplayController, addGmc710 } from './garmin';

export function buildGlareshield(c: LonCockpitContext): void {
  const { b, env } = c;
  const face = b.panel({ name: 'glareshield_face', center_m: GLARE_FACE.center_m, facing: 'aft', tiltDeg: GLARE_FACE.tiltDeg, width: GLARE_FACE.width, height: GLARE_FACE.height, material: 'glareshield', screws: false, radius: 0.01 });
  const y = -0.004;
  addGmc710(c, face, 0, y);
  addDisplayController(c, face, 1, -0.45, y);
  addDisplayController(c, face, 2, 0.45, y);
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'L' : 'R';
    // MASTER WARNING / CAUTION switchlights (40 x 25 mm, dossier §7.1); pushing acknowledges (CasManager events).
    face.add(
      new PushButton(env, {
        id: `lon.gs.mw_${s.toLowerCase()}`,
        label: `MASTER WARNING (${s})`,
        mode: 'momentary',
        event: 'cas.ack_warning',
        width: 0.04,
        height: 0.025,
        segments: [{ text: ['MASTER', 'WARNING'], color: 'red', var: 'alert.master_warning', style: 'field' }],
      }),
      side * 0.645,
      y,
    );
    face.add(
      new PushButton(env, {
        id: `lon.gs.mc_${s.toLowerCase()}`,
        label: `MASTER CAUTION (${s})`,
        mode: 'momentary',
        event: 'cas.ack_caution',
        width: 0.04,
        height: 0.025,
        segments: [{ text: ['MASTER', 'CAUTION'], color: 'amber', var: 'alert.master_caution', style: 'field' }],
      }),
      side * 0.597,
      y,
    );
    // ENG FIRE switchlight (guarded, latching): closes fuel / hydraulic / bleed firewall valves and arms the bottles.
    const i = side < 0 ? 1 : 2;
    face.add(
      new GuardedButton(env, {
        id: `lon.gs.fire_${s.toLowerCase()}`,
        label: `${s} ENG FIRE`,
        var: side < 0 ? V.fireEngL : V.fireEngR,
        mode: 'toggle',
        width: 0.036,
        height: 0.028,
        segments: [{ text: [`${s} ENG`, 'FIRE'], color: 'red', var: `fire.eng${i}_warn`, style: 'field' }],
        guard: { color: 'clear', hinge: 'top', close: 'free' },
      }),
      side * 0.292,
      y,
    );
    // BOTTLE ARMED / DISCH (momentary; discharges into the armed engine).
    const bn = (side < 0 ? 1 : 2) as 1 | 2;
    face.add(
      new PushButton(env, {
        id: `lon.gs.bottle${bn}`,
        label: `BOTTLE ${bn}`,
        var: bn === 1 ? V.bottle1 : V.bottle2,
        mode: 'momentary',
        width: 0.022,
        height: 0.022,
        layout: 'stack',
        segments: [seg.on('ARMED', 'green', CK.bottleArmed(bn)), seg.on('DISCH', 'amber', `fire.bottle${bn}_discharged`)],
      }),
      side * 0.246,
      y,
    );
    face.label(`BOTTLE ${bn}`, side * 0.246, y + 0.02, { height: 0.0026 });
  }
}
