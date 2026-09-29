/**
 * G800 head-up display computers (DUAL HUD, fix round 1 L02: the G800
 * demonstrator flight-deck photograph shows identical HUD control panels in
 * both headliner corners with overhead projector housings above both seats;
 * the G700/G800 HUD has EFVS - FSB GVIII-G700 App. 4: HUD / EVS rocker on the
 * sidesticks; code450 G700 taxi checklist "HUD Combiner . . . DEPLOY FOR USE /
 * CHECK"). Each headliner control panel carries CONTR, VIDEO BRT, HUD BRT and
 * a MAN / AUTO selector (G600 BL7C0705 photograph, crop p_hdliner).
 *
 * Inputs per side s: combiner deployed (`ac.g800.hud{2}_deploy`), HUD power
 * (`elec.hud_{l,r}_powered`), the four panel controls, EVS / SVS video
 * selection of that side (Epic vars, cycled by the sidestick HUD rocker in
 * logic.ts), ambient light (AUTO brightness).
 * Outputs (read by the cockpit HUD displays): `..hud{2}_on`, `..hud{2}_lum`
 * (symbology luminance 0..1), `..hud{2}_video` (video luminance 0..1).
 * EST: MAN = HUD BRT directly; AUTO = HUD BRT as a trim of the photocell level (HUD BRT x (0.3 + 0.7 x ambient light));
 * contrast scales the symbology over the video (lum x (0.4 + 0.6 CONTR)).
 * SCOPE: no symbology modes or declutter logic here (cockpit/hud.ts draws the primary set).
 */
import type { SimVars } from '../../../core/SimVars';
import type { Subsystem } from '../../types';
import { EPIC_VARS } from '../../../avionics/honeywell-epic/vars';
import { G800_VARS as V } from '../vars';

export class G800Hud implements Subsystem {
  readonly name = 'g800.hud';
  constructor(private readonly vars: SimVars) {}

  update(): void {
    const v = this.vars;
    for (const s of [1, 2] as const) {
      const on = v.get(s === 1 ? 'elec.hud_l_powered' : 'elec.hud_r_powered') !== 0 && v.get(V.hudStowS(s), s === 1 ? 1 : 0) > 0.5;
      const auto = v.get(V.hudAutoS(s), 1) !== 0;
      const brt = v.get(V.hudBrtS(s), 0.8);
      const base = auto ? brt * (0.3 + 0.7 * Math.max(0, Math.min(1, v.get('env.ambient_light', 1)))) : brt;
      const contr = v.get(V.hudContrS(s), 0.7);
      const lum = on ? Math.max(0, Math.min(1, base * (0.4 + 0.6 * contr))) : 0;
      const videoSel = v.get(EPIC_VARS.evs(s)) !== 0 || v.get(EPIC_VARS.svs(s)) !== 0;
      v.set(V.hudOnS(s), on ? 1 : 0);
      v.set(V.hudLumS(s), lum);
      v.set(V.hudVideoS(s), on && videoSel ? Math.max(0, Math.min(1, v.get(V.hudVideoBrtS(s), 0.5))) : 0);
    }
  }
}
