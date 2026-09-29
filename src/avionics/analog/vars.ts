/**
 * Default SimVar names used by the analog (steam-gauge) instruments.
 *
 * Every instrument takes its input/output var names as options; these are
 * the defaults. Names that are not standard (core/vars.ts) use the `ac.`
 * prefix: the AIRCRAFT must write them (power, suction, sender outputs)
 * or they are instrument state the aircraft may persist/read (knob
 * settings, tach time, DG heading output for the autopilot).
 *
 * Missing supply-voltage vars read as "powered" (SimVars.get fallback 28 V)
 * so a bare test cockpit works; an aircraft that models its electrical
 * system must write every power var it uses. Suction has NO such default:
 * a missing `ac.vac.suction_inhg` reads 0 inHg (gyros spun down, suction
 * gauge at zero), so an aircraft with vacuum instruments must write it.
 */
import { ADC, AP, ENV, FDM, FUEL, NAV } from '../../core/vars';
import { SENSOR_VARS } from '../../systems/sensors/vars';

export const ANALOG_VARS = {
  // ------------------------------------------------ inputs the aircraft provides
  /** 0..1 instrument internal/post lighting intensity (panel light dimmer x bus power). */
  instrumentLight: 'ac.light.instruments',
  /** Suction available at the gyro instruments (inHg). Vacuum system output (pumps, regulator, failures). */
  suction: 'ac.vac.suction_inhg',
  /** Turn coordinator gyro supply voltage (V). < `minVolts` = OFF flag. */
  turnCoordVolts: 'ac.elec.turn_coord_v',
  /** Electrically driven engine/fuel gauge supply voltage (V) (fuel qty, oil temp/press transducers). */
  gaugeVolts: 'ac.elec.gauges_v',
  /** Digital clock / OAT / voltmeter supply (V); also the voltmeter reading source. */
  clockVolts: 'ac.elec.clock_v',
  /** Main bus voltage (V), shown by voltmeters. */
  busVolts: 'ac.elec.bus_v',
  /** Battery charge/discharge current (A, + = charging) for the ammeter. */
  ammeterAmps: 'ac.elec.batt_amps',
  /** Outside-air temperature probe (deg C). */
  oatC: ADC.tat(1),
  // ------------------------------------------------ standard sensor vars read by default
  ias: ADC.ias(1),
  altitude: ADC.baroAlt(1),
  /**
   * Pressure altitude (29.92 datum) measured at a static source, for the
   * standby-altimeter mode. An ADC/static-source var (not fdm.press_alt_ft)
   * so static-port blockage, ice and alternate static reach the instrument;
   * a standby altimeter on its own static port uses its own ADC index.
   */
  pressureAlt: SENSOR_VARS.pressAlt(1),
  vs: ADC.vs(1),
  baroSetting: ADC.baroSetting(1),
  navCdi: NAV.cdi,
  utcHours: ENV.timeUtcHours,
  fuelTankKg: FUEL.tankKg,
  // ------------------------------------------------ instrument state (outputs / knob positions)
  /** Airspeed indicator TAS ring rotation (setting, see TasRing). */
  asiTasRing: 'ac.asi.tas_ring',
  /** Attitude indicator miniature-airplane adjustment (-1..1). */
  aiSymbolOffset: 'ac.ai.symbol_adj',
  /** Heading bug (deg magnetic) on the DG/HSI; the KAP 140 / autopilot HDG mode reads it. */
  headingBug: AP.selHeading,
  /** Heading shown by the directional gyro (deg) — for autopilot heading-bug error. */
  dgHeadingOut: 'ac.dg.hdg_deg',
  /** ADF indicator rotatable card heading (deg). */
  adfCard: 'ac.adf.card_deg',
  /** EGT reference (index) needle position (deg F). */
  egtReference: 'ac.egt.ref_f',
  /** Recording tachometer hours. */
  tachHours: 'ac.eng1.tach_hours',
  /** VSI zero-adjust screw offset (fpm). */
  vsiZero: 'ac.vsi.zero_fpm',
  /** Extra magnetic-compass deviation (deg), e.g. electrical loads / alternator off (172S POH: up to 25 deg). */
  compassExtraDeviation: 'ac.compass.extra_dev_deg',
} as const;

/**
 * FDM vars read by the self-contained mechanical sensors. The magnetic
 * compass (a magnet floating in liquid) and the inclinometer ball respond
 * directly to the magnetic field and specific force; vacuum/electric gyros
 * respond directly to the aircraft's attitude and body rates. They have no
 * upstream "sensor" to fail — their failure modes (suction, power, tumbling,
 * precession, turning/acceleration errors) are modelled inside the
 * instrument — so, like GPS position (CLAUDE.md exception), they sample FDM
 * truth. Every one of these can be redirected through the instrument options.
 */
export const PHYSICAL_INPUTS = {
  pitch: FDM.pitch,
  bank: FDM.bank,
  headingMag: FDM.headingMag,
  p: FDM.p,
  q: FDM.q,
  r: FDM.r,
  nx: FDM.nx,
  ny: FDM.ny,
  nz: FDM.nz,
  lat: FDM.lat,
  lon: FDM.lon,
  altMsl: FDM.altMsl,
} as const;
