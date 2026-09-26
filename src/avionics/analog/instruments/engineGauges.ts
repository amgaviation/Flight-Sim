/**
 * Cessna 172S engine / system instruments built on TwinGauge and
 * RoundGauge, with Cessna 172S POH (Rev 4) markings as defaults. Every
 * option can be overridden for other aircraft.
 *
 * POH sources: Figure 2-3 "Powerplant Instrument Markings" (oil temp green
 * 100-245 F, red 245 F; oil pressure red 20 psi, green 50-90 psi, red
 * 115 psi; fuel quantity red at 0 with 1.5 gal unusable each tank; fuel flow
 * green 0-12 GPH; vacuum 4.5-5.5 inHg); §2 "Fuel Limitations" (56 gal total,
 * 28.0 gal per tank, 3.0 gal unusable); §7 "Electrical System" (28-volt
 * system, 60-amp alternator, 24-volt battery); §7 "Engine Instruments" (oil
 * pressure transducer and oil temperature probe are electrical, EGT is a
 * thermocouple).
 */
import { AVGAS_LB_PER_GAL, LB_TO_KG } from '../../../core/units';
import { ENG, FDM, FUEL } from '../../../core/vars';
import type { SimVars } from '../../../core/SimVars';
import { INSTRUMENT_SIZE } from '../geometry';
import { MARK_GREEN, MARK_WHITE, MARK_YELLOW } from '../face';
import { ANALOG_VARS } from '../vars';
import type { AnalogGaugeOptions } from '../AnalogGauge';
import { RoundGauge, type RoundGaugeOptions } from './RoundGauge';
import { TwinGauge, type TwinGaugeOptions, type TwinSide } from './TwinGauge';

type BaseOpts = Omit<AnalogGaugeOptions, 'knobCorners'>;

const AVGAS_KG_PER_GAL = AVGAS_LB_PER_GAL * LB_TO_KG;

// ------------------------------------------------------------------ fuel quantity

export interface FuelQuantityOptions extends BaseOpts {
  /** Tank quantity vars (default fuel.tank0_kg / fuel.tank1_kg, in kg). */
  leftVar?: string;
  rightVar?: string;
  /** Converts the var to US gallons (default: kg of avgas at 6.0 lb/gal). */
  kgPerGal?: number;
  /** Unusable fuel per tank (gal): the gauge reads 0 with this left (172S POH: 1.5). */
  unusableGal?: number;
  /** Full-scale indication (gal). 172S: 26.5 usable per tank. */
  fullScaleGal?: number;
  powerVar?: string;
  /**
   * Fuel slosh / float bounce from vertical acceleration (gal per g of
   * nz - 1). EST 0.8: float gauges visibly bounce in turbulence.
   */
  sloshGalPerG?: number;
}

/** Dual fuel quantity gauge (L | R), electric senders. */
export class FuelQuantityGauge extends TwinGauge {
  constructor(o: FuelQuantityOptions) {
    const kgPerGal = o.kgPerGal ?? AVGAS_KG_PER_GAL;
    const unusable = o.unusableGal ?? 1.5;
    const full = o.fullScaleGal ?? 26.5;
    const slosh = o.sloshGalPerG ?? 0.8;
    const lv = o.leftVar ?? FUEL.tankKg(0);
    const rv = o.rightVar ?? FUEL.tankKg(1);
    // The float moves with the fuel surface: vertical acceleration (a physical input, read from the FDM) bounces it.
    const reader =
      (name: string) =>
      (vars: SimVars): number =>
        Math.max(0, vars.get(name) / kgPerGal - unusable) + (vars.get(FDM.nz, 1) - 1) * slosh;
    const side = (caption: string, v: string): TwinSide => ({
      caption,
      min: 0,
      max: full,
      ticks: [0, 5, 10, 15, 20, full],
      labels: ['0', '', '10', '', '20', ''],
      minorStep: 2.5,
      redlines: [0],
      read: reader(v),
      restValue: -2,
      dynamics: { omega: 3, zeta: 1 },
    });
    const opts: TwinGaugeOptions = {
      name: 'Fuel quantity',
      ...o,
      left: side('L', lv),
      right: side('R', rv),
      captions: ['FUEL QTY', 'U.S. GAL'],
      powerVar: o.powerVar ?? ANALOG_VARS.gaugeVolts,
      minVolts: 10,
    };
    super(opts);
  }
}

// ------------------------------------------------------------------ oil

export interface OilGaugeOptions extends BaseOpts {
  engine?: number;
  powerVar?: string;
}

/** Oil temperature (F) | oil pressure (psi), electric transducers (172S POH §7). */
export class OilTempPressGauge extends TwinGauge {
  constructor(o: OilGaugeOptions) {
    const e = o.engine ?? 1;
    super({
      name: 'Oil temp / press',
      ...o,
      left: {
        caption: 'OIL TEMP',
        unit: '°F',
        min: 50,
        max: 250,
        ticks: [50, 100, 150, 200, 245],
        labels: ['', '100', '', '200', ''],
        minorStep: 25,
        bands: [{ from: 100, to: 245, color: MARK_GREEN }],
        redlines: [245],
        inputVar: ENG.oilTempF(e),
        restValue: 40,
      },
      right: {
        caption: 'OIL PRESS',
        unit: 'PSI',
        min: 0,
        max: 120,
        ticks: [0, 20, 50, 90, 115],
        labels: ['0', '', '', '', '115'],
        minorStep: 10,
        bands: [{ from: 50, to: 90, color: MARK_GREEN }],
        redlines: [20, 115],
        inputVar: ENG.oilPressPsi(e),
        restValue: -6,
      },
      powerVar: o.powerVar ?? ANALOG_VARS.gaugeVolts,
      minVolts: 10,
    });
  }
}

// ------------------------------------------------------------------ vacuum / ammeter

export interface VacAmpOptions extends BaseOpts {
  suctionVar?: string;
  ampsVar?: string;
}

/**
 * Vacuum gauge | ammeter (172S "combination vacuum gage/ammeter", POH §7):
 * suction 3-7 inHg with the 4.5-5.5 inHg green range; ammeter +/-60 A
 * (60-amp alternator; + = battery charging). Both direct-reading.
 */
export class VacuumAmmeterGauge extends TwinGauge {
  constructor(o: VacAmpOptions) {
    super({
      name: 'Suction / ammeter',
      ...o,
      left: {
        caption: 'SUCTION',
        unit: 'IN HG',
        min: 3,
        max: 7,
        ticks: [3, 4, 5, 6, 7],
        labels: ['3', '', '5', '', '7'],
        minorStep: 0.5,
        bands: [{ from: 4.5, to: 5.5, color: MARK_GREEN }],
        inputVar: o.suctionVar ?? ANALOG_VARS.suction,
        restValue: 2.6,
        selfPowered: true,
      },
      right: {
        caption: 'AMPS',
        min: -60,
        max: 60,
        ticks: [-60, -30, 0, 30, 60],
        labels: ['-', '', '0', '', '+'],
        minorStep: 10,
        inputVar: o.ampsVar ?? ANALOG_VARS.ammeterAmps,
        restValue: 0,
        selfPowered: true,
        dynamics: { omega: 12, zeta: 0.55 },
      },
    });
  }
}

// ------------------------------------------------------------------ EGT / fuel flow

export interface EgtFuelFlowOptions extends BaseOpts {
  engine?: number;
  egtVar?: string;
  fuelFlowVar?: string;
  referenceVar?: string;
  powerVar?: string;
}

/**
 * EGT (thermocouple, no numbers, adjustable peak-reference needle) | fuel
 * flow (GPH, 0-12 green). EST: EGT scale 1250-1650 F with 25 F divisions
 * (the 172S EGT dial carries no numbers; the IO-360 cruise EGT sits mid-scale).
 */
export class EgtFuelFlowGauge extends TwinGauge {
  constructor(o: EgtFuelFlowOptions) {
    const e = o.engine ?? 1;
    super({
      name: 'EGT / fuel flow',
      ...o,
      left: {
        caption: 'EGT',
        unit: '°F',
        min: 1250,
        max: 1650,
        ticks: [1250, 1350, 1450, 1550, 1650],
        minorStep: 25,
        inputVar: o.egtVar ?? ENG.egtF(e),
        restValue: 1200,
        selfPowered: true,
        dynamics: { omega: 4, zeta: 0.9 },
        reference: { var: o.referenceVar ?? ANALOG_VARS.egtReference, step: 5, name: 'EGT REF' },
      },
      right: {
        caption: 'FUEL FLOW',
        unit: 'GPH',
        min: 0,
        max: 18,
        ticks: [0, 4, 8, 12, 16],
        labels: ['0', '4', '8', '12', '16'],
        minorStep: 2,
        bands: [{ from: 0, to: 12, color: MARK_GREEN }],
        inputVar: o.fuelFlowVar ?? ENG.fuelFlowGph(e),
        restValue: -1,
      },
      powerVar: o.powerVar ?? ANALOG_VARS.gaugeVolts,
      minVolts: 10,
    });
  }
}

// ------------------------------------------------------------------ single round gauges

/** Suction gauge as a single 2-1/4 in dial (aircraft without the combination gauge). */
export function createSuctionGauge(o: BaseOpts & Partial<RoundGaugeOptions>): RoundGauge {
  return new RoundGauge({
    name: 'Suction',
    size: INSTRUMENT_SIZE.ATI2,
    unit: 'inHg',
    decimals: 1,
    inputVar: ANALOG_VARS.suction,
    ...o,
    scale: o.scale ?? {
      min: 0,
      max: 10,
      startDeg: -135,
      endDeg: 135,
      majorStep: 2,
      minorStep: 0.5,
      bands: [{ from: 4.5, to: 5.5, color: MARK_GREEN }],
      captions: ['SUCTION', 'IN HG'],
      restValue: 0,
    },
  });
}

/** Voltmeter (0-35 V for a 28 V system; EST green 24-30 V). */
export function createVoltmeter(o: BaseOpts & Partial<RoundGaugeOptions>): RoundGauge {
  return new RoundGauge({
    name: 'Voltmeter',
    size: INSTRUMENT_SIZE.ATI2,
    unit: 'V',
    decimals: 1,
    inputVar: ANALOG_VARS.busVolts,
    ...o,
    scale: o.scale ?? {
      min: 0,
      max: 35,
      startDeg: -135,
      endDeg: 135,
      majorStep: 5,
      minorStep: 1,
      bands: [
        { from: 24, to: 30, color: MARK_GREEN },
        { from: 30, to: 32, color: MARK_YELLOW },
      ],
      redlines: [32],
      captions: ['VOLTS'],
      restValue: 0,
    },
  });
}

/** Stand-alone ammeter (+/-60 A). */
export function createAmmeter(o: BaseOpts & Partial<RoundGaugeOptions>): RoundGauge {
  return new RoundGauge({
    name: 'Ammeter',
    size: INSTRUMENT_SIZE.ATI2,
    unit: 'A',
    inputVar: ANALOG_VARS.ammeterAmps,
    dynamics: { omega: 12, zeta: 0.55 },
    ...o,
    scale: o.scale ?? {
      min: -60,
      max: 60,
      startDeg: -60,
      endDeg: 60,
      majorStep: 30,
      minorStep: 10,
      captions: ['AMPS'],
      restValue: 0,
      bands: [{ from: -1, to: 1, color: MARK_WHITE, inner: 0.9, outer: 0.93 }],
    },
  });
}

