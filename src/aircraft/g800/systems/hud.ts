/**
 * G800 head-up display computer (pilot side). The G700/G800 has a HUD with EFVS
 * (FSB GVIII-G700 App. 4: HUD / EVS rocker on the sidesticks; code450 G700 taxi
 * checklist "HUD Combiner . . . DEPLOY FOR USE / CHECK"). The HUD control panel on
 * the left headliner carries CONTR, VIDEO BRT, HUD BRT and a MAN / AUTO selector
 * (G600 BL7C0705 photograph, crop p_hdliner).
 *
 * Inputs: combiner deployed (`ac.g800.hud_deploy`), HUD power (`elec.hud_l_powered`),
 * the four panel controls, EVS / SVS video selection of side 1 (Epic vars, cycled by
 * the sidestick HUD rocker in logic.ts), ambient light (AUTO brightness).
 * Outputs (read by the cockpit HUD display): `ac.g800.hud_on`, `ac.g800.hud_lum`
 * (symbology luminance 0..1), `ac.g800.hud_video` (video luminance 0..1).
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
    const on = v.get('elec.hud_l_powered') !== 0 && v.get(V.hudStow, 1) > 0.5;
    const auto = v.get(V.hudAuto, 1) !== 0;
    const brt = v.get(V.hudBrt, 0.8);
    const base = auto ? brt * (0.3 + 0.7 * Math.max(0, Math.min(1, v.get('env.ambient_light', 1)))) : brt;
    const contr = v.get(V.hudContr, 0.7);
    const lum = on ? Math.max(0, Math.min(1, base * (0.4 + 0.6 * contr))) : 0;
    const videoSel = v.get(EPIC_VARS.evs(1)) !== 0 || v.get(EPIC_VARS.svs(1)) !== 0;
    v.set(V.hudOn, on ? 1 : 0);
    v.set(V.hudLum, lum);
    v.set(V.hudVideo, on && videoSel ? Math.max(0, Math.min(1, v.get(V.hudVideoBrt, 0.5))) : 0);
  }
}
