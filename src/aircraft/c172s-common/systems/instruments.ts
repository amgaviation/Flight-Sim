/**
 * Cessna 172S pneumatic systems shared by both variants: pitot-static (air data sources,
 * POH airspeed calibration, alternate static, heated pitot) and the engine-driven vacuum
 * system (docs/aircraft/c172s.md §5.4-5.5).
 *
 *  - Steam: one pneumatic air-data source `adc1` feeds the ASI, altimeter and VSI (and the
 *    KAP 140 static line in reality). Two engine-driven dry vacuum pumps (POH Sec 7 "Vacuum
 *    system and instruments": manifold with check valves, a transducer per pump; L VAC / VAC R
 *    below 3.0 in.Hg) drive the attitude indicator and the directional gyro.
 *  - G1000: `adc1` is the GDC air data computer (digital, powered through the dual-fed
 *    ADC/AHRS breakers); `adc2` is the pneumatic standby airspeed indicator / altimeter on
 *    the same pitot head and static ports (POH NAV III Sec 7). One engine-driven vacuum pump
 *    drives the standby attitude indicator (LOW VACUUM below 3.5 in.Hg, POH NAV III Sec 7).
 */
import type { Subsystem } from '../../types';
import type { SimContext } from '../../../core/SimContext';
import type { Table1D } from '../../../physics/types';
import { AirDataComputer, VacuumSystem } from '../../../systems/sensors';
import { SENSOR_VARS } from '../../../systems/sensors/vars';
import { IceProtection } from '../../../systems/ice';
import { ADC, ICE, SURF } from '../../../core/vars';
import { interp1 } from '../../../core/math';
import { KT_TO_MS } from '../../../core/units';
import { ASI_ALT_STATIC_DELTA, ASI_CAL_NORMAL } from '../data';
import { C172 } from '../vars';
import type { C172Variant } from './electrical';

/**
 * Cabin (alternate) static-pressure error vs KCAS (Pa, negative = cabin below ambient), derived
 * from the POH Fig 5-1 sheet 2 increments: dp = -rho0 * V * dV (incompressible, sea-level
 * density; EST adequate at these speeds).
 */
export const ALT_STATIC_ERROR_PA: Table1D = {
  x: ASI_ALT_STATIC_DELTA.x,
  y: ASI_ALT_STATIC_DELTA.x.map((kcas, i) => -1.225 * kcas * KT_TO_MS * ASI_ALT_STATIC_DELTA.y[i] * KT_TO_MS),
};

/**
 * Airspeed-indicator calibration (POH Fig 5-1 sheet 1, flap dependent): rewrites
 * `adc{s}.ias_kt` from the source's measured CAS. Runs right after the air-data sources.
 * Flap position is the physical flap angle (it changes the static-port pressure field).
 */
export class C172AsiCalibration implements Subsystem {
  readonly name = 'c172-asi-calibration';
  private readonly outs: { ias: string; cas: string; powered: string; digital: boolean }[];
  constructor(
    private readonly vars: SimContext['vars'],
    sources: { index: number; digital: boolean }[],
  ) {
    this.outs = sources.map((s) => ({ ias: ADC.ias(s.index), cas: SENSOR_VARS.cas(s.index), powered: SENSOR_VARS.powered(s.index), digital: s.digital }));
  }
  update(): void {
    const v = this.vars;
    const flaps = v.get(SURF.flapsDeg);
    for (const o of this.outs) {
      if (o.digital && v.get(o.powered) === 0) continue; // a dead digital ADC holds its last output
      v.set(o.ias, calibratedIas(v.get(o.cas), flaps));
    }
  }
}

/** KIAS for a measured KCAS at a flap angle (linear blend between the POH flap tables). */
export function calibratedIas(kcas: number, flapDeg: number): number {
  const t = ASI_CAL_NORMAL;
  if (flapDeg <= t[0].flapDeg) return interp1(t[0].kiasVsKcas, kcas);
  for (let i = 1; i < t.length; i++) {
    if (flapDeg <= t[i].flapDeg) {
      const f = (flapDeg - t[i - 1].flapDeg) / (t[i].flapDeg - t[i - 1].flapDeg);
      return (1 - f) * interp1(t[i - 1].kiasVsKcas, kcas) + f * interp1(t[i].kiasVsKcas, kcas);
    }
  }
  return interp1(t[t.length - 1].kiasVsKcas, kcas);
}

export interface C172AirData {
  /** Air-data sources in update order (adc1, and adc2 on the G1000). */
  sources: AirDataComputer[];
  calibration: C172AsiCalibration;
  /** Heated pitot (ice protection of `ice.pitot1`). */
  pitotHeat: IceProtection;
  /** Index of the pneumatic source feeding the standby / steam instruments. */
  pneumaticIndex: number;
}

export function createC172AirData(ctx: Pick<SimContext, 'vars'>, variant: C172Variant): C172AirData {
  const env = { vars: ctx.vars };
  const alternateStatic = { active: C172.altStatic, errorPa: ALT_STATIC_ERROR_PA };
  const sources: AirDataComputer[] = [];
  if (variant === 'g1000') {
    // GDC air data computer (UND: ADC AHRS breakers on AVN BUS 1 and ESS, dual fed).
    sources.push(
      new AirDataComputer(env, { index: 1, power: 'elec.adc_ahrs_powered', pitotProbe: 1, staticPort: 1, pitotDrainOpen: true, alternateStatic, trendS: 6 }),
    );
    // Standby airspeed indicator and altimeter share the pitot head and static ports.
    sources.push(new AirDataComputer(env, { index: 2, pitotProbe: 1, staticPort: 1, pitotDrainOpen: true, alternateStatic, vsTauS: 2 }));
  } else {
    // Pitot tube under the left wing, static port on the left forward fuselage (POH Sec 7).
    // The Cessna pitot head has a drain hole: a blocked ram inlet reads zero (FAA-H-8083-15B ch. 5).
    sources.push(new AirDataComputer(env, { index: 1, pitotProbe: 1, staticPort: 1, pitotDrainOpen: true, alternateStatic, vsTauS: 2 }));
  }
  const calibration = new C172AsiCalibration(
    ctx.vars,
    sources.map((s) => ({ index: s.index, digital: variant === 'g1000' && s.index === 1 })),
  );
  // Heated pitot (POH Sec 7 "Pitot-static system": heating element in the pitot tube, PITOT HEAT
  // switch/breaker). Accretion rates EST (systems-power §8 typical: pitot 0.5/min, speedExp 0.5).
  const pitotHeat = new IceProtection(ctx.vars, {
    surfaces: [
      {
        id: 'pitot',
        output: ICE.pitot(1),
        ratePerMin: 0.5,
        speedExp: 0.5,
        protection: { kind: 'electric', active: 'elec.pitot_heat_powered' },
      },
      // Airframe (no ice protection: POH Sec 2 "Flight into known icing conditions is prohibited").
      { id: 'airframe', output: ICE.airframe, ratePerMin: 0.1 },
      // Static port (unheated; the ALT STATIC AIR valve bypasses it).
      { id: 'static', output: ICE.static(1), ratePerMin: 0.05 },
    ],
  });
  return { sources, calibration, pitotHeat, pneumaticIndex: variant === 'g1000' ? 2 : 1 };
}

/** Engine-driven vacuum system: steam two pumps (L VAC / VAC R), G1000 one pump (LOW VACUUM). */
export function createC172Vacuum(ctx: Pick<SimContext, 'vars'>, variant: C172Variant): VacuumSystem {
  const env = { vars: ctx.vars };
  if (variant === 'g1000') {
    return new VacuumSystem(env, {
      pumps: [{ suction: 'eng1.vacuum_inhg' }],
      regulatedInHg: 5.0, // EST: centre of the POH 4.5-5.5 green arc
      lowInHg: 3.5, // POH NAV III Sec 7: LOW VACUUM below 3.5 in.Hg
      annunciatorPower: 'elec.nav1_eng_powered', // vacuum transducer read by the GEA 71
    });
  }
  return new VacuumSystem(env, {
    // Two engine-driven pumps on the accessory case (POH Sec 7 "Engine": "dual vacuum pumps").
    pumps: [{ suction: 'eng1.vacuum_inhg' }, { suction: 'eng1.vacuum_inhg' }],
    regulatedInHg: 5.0, // EST
    lowInHg: 3.0, // POH Sec 7 "Low vacuum annunciation": below 3.0 in.Hg per pump
    annunciatorPower: 'elec.warn_powered',
  });
}
