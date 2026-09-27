/**
 * Ground start on a sloped runway (jets QA: every 737-800 and G650 ground state at KLAX 25R crashed at
 * spawn). The runway there rises ~0.1 % toward the tail; the settle's initial guess let only the nose gear
 * touch, the Newton step then pitched the nose down into its -17 deg clamp and the aircraft was released
 * 11 ft up, nose down, and crashed. Every jet must settle level on its gear on either slope direction.
 */
import { describe, expect, it } from 'vitest';
import { FlatWorld, makeFdm, run, SEA_TAC } from './helpers';
import { B738_FDM } from '../../src/aircraft/b737-800/fdm';
import { G650_FDM } from '../../src/aircraft/g650/fdm';
import { GLOBAL6000_FDM } from '../../src/aircraft/global6000/fdm';
import { CITATION_M2_FDM } from '../../src/aircraft/citation-m2/fdm';
import { GEAR } from '../../src/core/vars';

const CONFIGS = { b738: B738_FDM, g650: G650_FDM, global6000: GLOBAL6000_FDM, m2: CITATION_M2_FDM };

describe('ground settle on a sloped runway', () => {
  for (const [name, cfg] of Object.entries(CONFIGS)) {
    for (const slope of [0.002, 0.01, -0.002, -0.01]) {
      it(`${name}: ${slope * 100} % slope, heading north`, () => {
        const world = new FlatWorld(29, 'concrete', slope, SEA_TAC.lat);
        const { fdm, vars } = makeFdm(cfg, world, 0.3);
        for (let i = 0; i < 3; i++) vars.set(GEAR.pos(i), 1);
        fdm.reposition({ lat: SEA_TAC.lat, lon: SEA_TAC.lon, onGround: true, headingTrue: 0 });
        const alt0 = fdm.alt;
        vars.set(GEAR.brakeLeft, 1);
        vars.set(GEAR.brakeRight, 1);
        run(fdm, 2);
        expect(fdm.crashed).toBe(false);
        expect(vars.get('fdm.on_ground')).toBe(1);
        // Released in equilibrium: the CG hardly moves, the attitude follows the runway.
        expect(Math.abs(fdm.alt - alt0)).toBeLessThan(0.1);
        expect(Math.abs(vars.get('fdm.pitch_deg') - (Math.atan(slope) * 180) / Math.PI)).toBeLessThan(1.5);
      });
    }
  }
});
