/**
 * G650 glareshield front face (dossier §8 / §9.7, left to right):
 * DU 1 / DU 2 brightness (concentric dimmer, pilot end), MASTER WARNING /
 * MASTER CAUTION (pilot), SMC 1 (standby multifunction controller: standby
 * instrument + display controller, "two Standby Multifunctional Controllers",
 * Gulfstream / Honeywell PlaneView II), the guidance panel in the centre
 * (Epic `addGuidancePanel`), SMC 2, MASTER WARNING / CAUTION (copilot), DU 4
 * / DU 3 brightness (copilot end). Epic hardware from
 * src/avionics/honeywell-epic/cockpit.ts; positions EST from G650ER
 * photographs (dossier §8: SMCs y -+0.47, MASTER lights outboard).
 */
import { PushButton, RotaryKnob } from '../../../cockpit/controls';
import { addGuidancePanel, addSmc } from '../../../avionics/honeywell-epic/cockpit';
import { G650_VARS as V, G650_EVENTS } from '../vars';
import type { G650CockpitContext } from './context';
import { GLARE_FACE } from './layout';

export function buildGlareshield(c: G650CockpitContext): void {
  const { b, env, suite } = c;
  const face = b.panel({ name: 'g650.glareshield', center_m: GLARE_FACE.center_m, facing: 'aft', tiltDeg: GLARE_FACE.tiltDeg, width: GLARE_FACE.width, height: GLARE_FACE.height, material: 'glareshield', screws: false, radius: 0.01 });
  if (suite) {
    addGuidancePanel(b, face, 0, 0.004, suite);
    addSmc(b, face, -0.495, 0.002, suite, 1);
    addSmc(b, face, 0.495, 0.002, suite, 2);
  }
  const fmt = (v: number) => (v >= 0.999 ? 'BRT' : `${Math.round(v * 100)} %`);
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'L' : 'R';
    const lo = s.toLowerCase();
    // MASTER WARNING (red) above MASTER CAUTION (amber); pushing acknowledges (CasManager events).
    face.add(
      new PushButton(env, {
        id: `g650.gs.mw_${lo}`,
        label: `MASTER WARNING (${s})`,
        mode: 'momentary',
        event: G650_EVENTS.masterWarning,
        width: 0.042,
        height: 0.026,
        segments: [{ text: ['MASTER', 'WARNING'], color: 'red', var: 'alert.master_warning', style: 'field' }],
      }),
      side * 0.66,
      0.03,
    );
    face.add(
      new PushButton(env, {
        id: `g650.gs.mc_${lo}`,
        label: `MASTER CAUTION (${s})`,
        mode: 'momentary',
        event: G650_EVENTS.masterCaution,
        width: 0.042,
        height: 0.026,
        segments: [{ text: ['MASTER', 'CAUTION'], color: 'amber', var: 'alert.master_caution', style: 'field' }],
      }),
      side * 0.66,
      -0.03,
    );
    // DU brightness: outer = PFD (DU1 / DU4), inner = MFD (DU2 / DU3) (LightingSystem dimmers du*_brt).
    const outer = side < 0 ? V.duBrt(1) : V.duBrt(4);
    const inner = side < 0 ? V.duBrt(2) : V.duBrt(3);
    face.add(
      new RotaryKnob(env, {
        id: `g650.gs.du_brt_${lo}`,
        label: `DU BRIGHTNESS (${s})`,
        cap: 'dimmer',
        innerCap: 'dimmer',
        diameter: 0.022,
        outer: { var: outer, min: 0, max: 1, step: 0.05, initial: 1, angleRange: [-140, 140], label: side < 0 ? 'DU 1 (PFD)' : 'DU 4 (PFD)', format: fmt },
        inner: { var: inner, min: 0, max: 1, step: 0.05, initial: 1, angleRange: [-140, 140], label: side < 0 ? 'DU 2 (MFD)' : 'DU 3 (MFD)', format: fmt },
      }),
      side * 0.815,
      -0.008,
    );
    face.label(side < 0 ? 'PFD  MFD' : 'MFD  PFD', side * 0.815, 0.03, { height: 0.0026 });
    face.label('DU BRT', side * 0.815, -0.045, { height: 0.0026 });
  }
}
