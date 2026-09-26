/**
 * G800 engine / APU fire handles (dossier §9.5 inventory, §4.7): three red-lit T-handles, L ENG,
 * APU and R ENG, on a strip at the forward edge of the overhead (GVI-family arrangement: the
 * G650 fire handles sit on the overhead forward edge, G650ER overhead photograph, docs/aircraft/
 * g650.md §9; the dossier's forward-pedestal position is an estimate - EST: the G800 is taken to
 * keep the GVI location).
 *
 * Each handle is locked by its 28 VDC solenoid until a fire warning (or FIRE TEST) releases it
 * (ac.g800.fire_{l,r,apu}_unlock, SCQ fire). Pulled: closes that engine's fuel, bleed and
 * hydraulic shut-offs (ac.g800.fire_*_handle). Rotated while held: -1 = SHOT 1 (RIGHT bottle),
 * +1 = SHOT 2 (LEFT bottle); the APU handle rotated (+1) fires the LEFT bottle (GVI), springs
 * back to 0 (ac.g800.fire_*_rot). The lamp in each handle follows the zone's fire warning.
 */
import { TBarHandle } from '../../../cockpit/controls';
import { G800_VARS as V } from '../vars';
import type { G800CockpitContext } from './context';
import { FIRE_STRIP } from './layout';

export function buildFireHandles(c: G800CockpitContext): void {
  const { b, env } = c;
  const f = FIRE_STRIP;
  const strip = b.panel({ name: 'g800.fire_strip', center_m: f.center_m, facing: 'down', tiltDeg: f.tiltDeg, width: f.width, height: f.height, material: 'panelDark', screws: { kind: 'dzus', diameter: 0.006, inset: 0.008 }, radius: 0.008 });
  const handles: [string, string, string, string, string, string, number][] = [
    ['l', 'L ENG', V.fireHandleL, V.fireRotL, 'ac.g800.fire_l_unlock', 'fire.eng1_warn', -0.13],
    ['apu', 'APU', V.fireHandleApu, V.fireRotApu, 'ac.g800.fire_apu_unlock', 'fire.apu_warn', 0],
    ['r', 'R ENG', V.fireHandleR, V.fireRotR, 'ac.g800.fire_r_unlock', 'fire.eng2_warn', 0.13],
  ];
  for (const [id, legend, v, rot, unlock, light, x] of handles) {
    strip.add(
      new TBarHandle(env, {
        id: `g800.fire.${id}`,
        label: `${legend} FIRE HANDLE`,
        var: v,
        valueIn: 0,
        valueOut: 1,
        rotateVar: rot,
        style: 'fire',
        rotate: 'discharge',
        unlockVar: unlock,
        lightVar: light,
        lightColor: 'red',
        legend,
        scale: 0.95,
      }),
      x,
      0.004,
    );
    strip.label(`${legend} FIRE`, x, -0.032, { height: 0.0026 });
  }
  strip.label('PULL - ROTATE L: SHOT 1 (R BTL)  R: SHOT 2 (L BTL)', 0, 0.035, { height: 0.0021 });
}
