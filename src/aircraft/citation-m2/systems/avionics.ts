/**
 * Citation M2 avionics and alerting (S&D15 §10, S&D21 §10.3):
 *  - Garmin G3000: three GDU 1400W (PFD1, MFD, PFD2), two GTC 570, GMC 710,
 *    dual GIA 63W (COM/NAV/GPS/flight director), dual GDC air data, dual GRS 77
 *    AHRS, GEA 71 engine interface, GMA 36 audio, GTX 3000 transponders;
 *  - GFC 700 AFCS: dual FD, AP with roll, pitch, pitch-trim and yaw servos, YD
 *    engages with the AP, TO/GA button on the LH throttle, CWS and AP/TRIM DISC
 *    on each yoke;
 *  - Collins ALT-4000 radio altimeter (2,500 ft), Collins DME-4000, GWX 70
 *    radar, Garmin GTS 855 TCAS I, Class B TAWS, L-3 ESI-1000 standby
 *    instrument (main bus with own backup battery);
 *  - electrically heated AOA vane feeding the stall warning (stick shaker, EST
 *    CJ family) and the PFD AOA / low-speed awareness.
 */
import type { SimContext } from '../../../core/SimContext';
import { G3000Suite, G3000_M2_LAYOUT, type G3000Config } from '../../../avionics/garmin-g3000';
import { AirDataComputer, Ahrs, RadioAltimeter } from '../../../systems/sensors';
import { Afcs, AFCS_GFC700_G3000 } from '../../../systems/autopilot';
import { StallWarning, Overspeed, AltitudeAlert, ALT_ALERT_GFC700, Taws, Tcas, TakeoffConfigWarning, DisconnectAlerts } from '../../../systems/warning';
import { CITATION_M2_FDM } from '../fdm';
import { M2_LIMITS } from '../data';
import { M2, TEST_SEL } from '../vars';
import { M2_EIS_CONFIG, M2_SYNOPTICS } from './eis';
import { M2_PERFORMANCE } from './told';
import type { Checklist } from '../../types';

export interface AvionicsOptions {
  /** Headless (tests): no display canvases. */
  noDisplays?: boolean;
  checklists?: Checklist[];
}

export interface AvionicsBlocks {
  adc: AirDataComputer[];
  ahrs: Ahrs[];
  ra: RadioAltimeter;
  suite: G3000Suite;
  afcs: Afcs;
  stall: StallWarning;
  overspeed: Overspeed;
  altAlert: AltitudeAlert;
  taws: Taws;
  tcas: Tcas;
  tocw: TakeoffConfigWarning;
  disc: DisconnectAlerts;
}

export function createAvionics(ctx: SimContext, opts: AvionicsOptions = {}): AvionicsBlocks {
  const adc = [
    new AirDataComputer(ctx, { index: 1, power: 'elec.adc1_powered', trendS: 6 }), // Garmin 6 s trend (S&D15 §10.3.B)
    new AirDataComputer(ctx, { index: 2, power: 'elec.adc2_powered', trendS: 6 }),
    // ESI-1000 standby: its own air data from the standby pitot-static (index 3).
    new AirDataComputer(ctx, { index: 3, power: M2.esiPowered, pitotProbe: 1, staticPort: 1, selfTestS: 5 }),
  ];
  const ahrs = [
    new Ahrs(ctx, { index: 1, power: 'elec.ahrs1_powered', alignS: 45, hdgAlignS: 15 }), // GRS 77: "in-flight and on-the-move initialization"
    new Ahrs(ctx, { index: 2, power: 'elec.ahrs2_powered', alignS: 45, hdgAlignS: 15 }),
    new Ahrs(ctx, { index: 3, power: M2.esiPowered, alignS: 90, hdgAlignS: 0 }), // ESI-1000 attitude (EST 90 s)
  ];
  const ra = new RadioAltimeter(ctx, { index: 1, power: 'elec.ra_powered', maxFt: 2500 }); // ALT-4000: 2,500 ft (S&D15)

  const suiteCfg: G3000Config = {
    ...G3000_M2_LAYOUT,
    aircraftId: 'citation-m2',
    aircraftName: 'Citation M2',
    casLocation: 'pfd', // S&D15 §10.3.E / S&D21 §10.3.9: CAS on the lower part of each PFD
    eis: M2_EIS_CONFIG,
    synoptics: M2_SYNOPTICS,
    performance: M2_PERFORMANCE,
    checklists: opts.checklists,
    speedTape: { vmoKt: M2_LIMITS.vmoKt, shakerNorm: 0.88, cautionNorm: 0.8 },
    power: {
      pfd1: 'elec.pfd1_powered',
      mfd: 'elec.mfd_powered',
      pfd2: 'elec.pfd2_powered',
      gtc1: 'elec.gtc1_powered',
      gtc2: 'elec.gtc2_powered',
    },
    gmcPower: 'elec.gmc_powered',
    radioPower: { nav1: 'elec.gia1_powered', nav2: 'elec.gia2_powered', gps: 'elec.gia1_powered || elec.gia2_powered', marker: 'elec.audio1_powered' },
    fmsOptions: { speeds: { climbKt: 240, cruiseKt: 263, cruiseMach: 0.7, descentKt: 250, approachKt: 130 } }, // EST: FPG cruise-climb / high-speed descent
  };
  const suite = new G3000Suite(ctx, suiteCfg, { noDisplays: opts.noDisplays });

  const afcs = new Afcs(ctx, {
    ...AFCS_GFC700_G3000,
    // Flight director computers in the GIAs; servos on the AP servo breaker (AVN 1).
    power: 'elec.gia1_powered || elec.gia2_powered',
    servoPower: 'elec.ap_servos_powered',
    sensors: { valid: 'ahrs1.valid && adc1.valid' },
    disconnect: {
      ...AFCS_GFC700_G3000.disconnect,
      // AP disconnects at high speed beyond Vmo/Mmo is not automatic in the GFC 700; stall (shaker) disconnects the AP (EST, Garmin).
      auto: 'alert.stick_shaker',
    },
  });

  const stall = new StallWarning(ctx, {
    kind: 'aoa',
    alphaStall: CITATION_M2_FDM.aero.alphaStall_deg,
    shakerNorm: 0.88, // EST: shaker ~7 % above the stall speed
    power: 'elec.stall_warn_powered',
    test: `${M2.testSel} == ${TEST_SEL.stall}`,
  });
  const overspeed = new Overspeed(ctx, {
    vmoKt: M2_LIMITS.vmoKt,
    mmo: M2_LIMITS.mmo,
    marginKt: 0,
    marginMach: 0,
    vleKt: M2_LIMITS.vleKt,
    power: 'elec.gea_powered',
    test: `${M2.testSel} == ${TEST_SEL.overspeed}`,
  });
  const altAlert = new AltitudeAlert(ctx, { ...ALT_ALERT_GFC700, power: 'elec.gia1_powered || elec.gia2_powered' });
  const taws = new Taws(ctx, {
    class: 'B', // S&D21 §10.3.17 (Class B TAWS with the ALT-4000 RA)
    power: 'elec.pfd1_powered || elec.mfd_powered || elec.pfd2_powered',
    raVar: 'ra1.alt_ft',
    raValid: 'ra1.valid',
    flapsLanding: 'surf.flaps_deg >= 30',
    inhibits: { terrain: 'g3k.taws.inhibit_terr', gpws: 'g3k.taws.inhibit_gpws', flapOverride: 'g3k.taws.flap_ovrd' },
  });
  const tcas = new Tcas(ctx, { power: 'elec.tcas_powered' }); // GTS 855 TCAS I: TA only
  const tocw = new TakeoffConfigWarning(ctx, {
    armed: `gear.air_ground && (${M2.tla(1)} > 0.9 || ${M2.tla(2)} > 0.9)`,
    power: 'elec.gea_powered',
    checks: [
      { id: 'flaps', bad: 'surf.flaps_deg > 16 || (surf.flaps_deg > 1 && surf.flaps_deg < 14)', text: 'FLAPS', voice: 'FLAPS' },
      { id: 'speedbrake', bad: 'surf.speedbrake > 0.05', text: 'SPEED BRAKES', voice: 'SPEED BRAKES' },
      { id: 'trim', bad: 'trim.pitch_to_ok == 0', text: 'TRIM', voice: 'TRIM' },
      { id: 'park', bad: 'brakes.parking_set', text: 'PARKING BRAKE', voice: 'PARKING BRAKE' },
    ],
  });
  const disc = new DisconnectAlerts(ctx, { apToneMaxS: 2 }); // Garmin ~1.5-2 s tone
  return { adc, ahrs, ra, suite, afcs, stall, overspeed, altAlert, taws, tcas, tocw, disc };
}
