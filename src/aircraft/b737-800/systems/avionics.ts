/**
 * Boeing 737-800 sensors, avionics suite and alerting (FCOM 10 "Flight
 * instruments", 11 "FMS", 4 "Automatic flight", 15 "Warning systems").
 *
 *  - Two ADIRUs (Honeywell ADIRS): IRS on the AC standby bus (left) / XFR 2
 *    (right) with DC backup from the switched hot battery bus (ON DC), and
 *    their air data modules. The ISFD (Integrated Standby Flight Display) has
 *    its own air data (auxiliary pitot / alternate static) and inertial
 *    sensors on the DC standby / hot battery bus.
 *  - Two radio altimeters (2,500 ft).
 *  - The 737NG avionics family (src/avionics/boeing-737): six DUs, two DEUs,
 *    EFIS control panels, FMC with two CDUs, MCP + AFDS (CMD A/B, dual-channel
 *    autoland) + autothrottle, VHF NAV / ADF / marker / GPS receivers.
 *  - EGPWS (class A, MK V: modes 1-6, terrain awareness, callouts incl.
 *    2,500 / 1,000 / 500 / 100 / 50 / 40 / 30 / 20 / 10 ft on the NG), TCAS II,
 *    stall warning (two SMYDs: stick shaker), Mach/airspeed warning clacker,
 *    altitude alert (900 / 300 ft, FCOM 10.10), take-off configuration warning
 *    (intermittent horn: flaps, stab trim, speed brake, parking brake;
 *    FCOM 15.20), A/P and A/T disconnect aurals.
 */
import type { SimContext } from '../../../core/SimContext';
import type { NavDatabase } from '../../../nav/types';
import { AirDataComputer, Ahrs, Irs, RadioAltimeter } from '../../../systems/sensors';
import { StallWarning, Overspeed, AltitudeAlert, ALT_ALERT_737NG, Taws, Tcas, TakeoffConfigWarning, DisconnectAlerts } from '../../../systems/warning';
import { VERTICAL_MODES, AFCS_B737_AFDS } from '../../../systems/autopilot';
import { createB737Suite, type B737Suite } from '../../../avionics/boeing-737';
import { B737_VARS } from '../../../avionics/boeing-737/vars';
import type { AfcsGains } from '../../../systems/autopilot';
import { SHAKER_ALPHA_DEG } from '../fdm';
import { B738_LIMITS, STAB } from '../data';
import { B738, SPEEDBRAKE } from '../vars';
import { POWER } from './electrical';
import { B738TcasDisplay, B738RadioAudio, createWxrOverlay } from './surveillance';

export interface AvionicsOptions {
  /** Headless (tests): no display canvases. */
  noDisplays?: boolean;
  /** Override the navigation database (null = none: no receivers / FMC / FMS). Default ctx.nav. */
  nav?: NavDatabase | null;
}

export interface AvionicsBlocks {
  adc: AirDataComputer[];
  irs: Irs[];
  isfdAhrs: Ahrs;
  ra: RadioAltimeter[];
  suite: B737Suite;
  stall: StallWarning;
  overspeed: Overspeed;
  altAlert: AltitudeAlert;
  taws: Taws;
  tcas: Tcas;
  tcasDisplay: B738TcasDisplay;
  radioAudio: B738RadioAudio;
  tocw: TakeoffConfigWarning;
  disc: DisconnectAlerts;
}

/**
 * AFDS inner/outer loop gains for the 737-800 FDM (EST, tuned with the
 * headless approach / cruise tests; systems-control §4.1 laws).
 */
export const B738_AFCS_GAINS: Partial<AfcsGains> = {
  pitchKp: 0.05,
  pitchKi: 0.02,
  pitchKq: 0.12,
  rollKp: 0.035,
  rollKi: 0.008,
  rollKp_rate: 0.06,
  gainRefKt: 250,
};

/**
 * Autothrottle speed loop (lever rate = kp * speed error - kd * speed trend; systems-control §5): EST, tuned
 * with the headless full-flight test: the library default kp 0.02 cycled N1 between ~33 % and ~80 % every
 * ~30 s on the glideslope against the CFM56 spool lag; kp 0.01 holds VREF + 5 within 0.5 kt at a steady
 * ~57 % N1 (typical 737-800 flaps 30 approach N1, line experience).
 */
export const B738_AT_GAINS: { speedKp: number; speedKd: number } = { speedKp: 0.01, speedKd: 0.08 };

export function createAvionics(ctx: SimContext, opts: AvionicsOptions = {}): AvionicsBlocks {
  const nav = opts.nav === undefined ? ctx.nav : opts.nav;
  const irs = [
    new Irs(ctx, { index: 1, power: POWER.irs1, dcBackup: 'elec.sw_hot_batt_powered' }),
    new Irs(ctx, { index: 2, power: POWER.irs2, dcBackup: 'elec.sw_hot_batt_powered' }),
  ];
  const adc = [
    // ADIRU air data modules (Boeing 10 s speed trend vector, FCOM 10.10).
    // Vertical speed: the ADIRU blends baro rate with IRS vertical acceleration (inertial vertical speed,
    // FCOM 10.10 "Vertical speed ... inertial"), so it has much less lag than a pure baro rate: EST 0.15 s.
    new AirDataComputer(ctx, { index: 1, power: `${POWER.irs1} || irs1.on_dc`, trendS: 10, vsTauS: 0.15 }),
    new AirDataComputer(ctx, { index: 2, power: `${POWER.irs2} || irs2.on_dc`, trendS: 10, vsTauS: 0.15 }),
    // ISFD: auxiliary pitot (pitot 3) and the alternate static ports (static 3).
    new AirDataComputer(ctx, { index: 3, power: POWER.isfd, pitotProbe: 3, staticPort: 3, selfTestS: 10, trendS: 10 }),
  ];
  // ISFD inertial sensors: ~90 s attitude initialization (EST, Smiths/GE ISFD).
  const isfdAhrs = new Ahrs(ctx, { index: 3, power: POWER.isfd, alignS: 90, hdgAlignS: 0 });
  const ra = [new RadioAltimeter(ctx, { index: 1, power: POWER.ra1, maxFt: 2500 }), new RadioAltimeter(ctx, { index: 2, power: POWER.ra2, maxFt: 2500 })];
  // TCAS own altitude from the ATC panel ALT SOURCE selection (B738Logic).
  const tcas = new Tcas(ctx, { power: `${POWER.tcas} && ${POWER.xpdr}`, ownAltVar: 'ac.b738.xpdr_press_alt_ft' });
  // ND traffic: ABOVE / NORM / BELOW band filter and the TCAS self test (surveillance.ts).
  const tcasDisplay = new B738TcasDisplay(ctx.vars, ctx.audio, tcas);

  const suite = createB737Suite(
    { vars: ctx.vars, events: ctx.events, nav, world: ctx.world, audio: ctx.audio, noDisplays: opts.noDisplays },
    {
      aircraftId: 'b737-800',
      model: '737-800W',
      engineRating: '26K',
      weightUnit: 'kg',
      autoland: 'fail-operational',
      power: {
        du: { capt_out: POWER.duCaptOut, capt_in: POWER.duCaptIn, upper: POWER.duUpper, lower: POWER.duLower, fo_in: POWER.duFoIn, fo_out: POWER.duFoOut },
        deu1: POWER.deu1,
        deu2: POWER.deu2,
        // Dual FMC (FCOM 11): the FMC transfer switch selects the operative computer. One FMC is modelled; the
        // switch selects which of the two FMC failure states (fail.b738.fmc1/2, B738Logic failures) drives it:
        // NORMAL and BOTH ON L run on FMC L, BOTH ON R on FMC R — with FMC L failed, BOTH ON R restores the
        // CDU / LNAV / VNAV / ND map data (SCOPE: no independent second computation channel).
        fmc: `${POWER.fmc} && ((${B737_VARS.fmcSel} > 0.5 && !fail.b738.fmc2) || (${B737_VARS.fmcSel} <= 0.5 && !fail.b738.fmc1))`,
        cdu1: POWER.cdu1,
        cdu2: POWER.cdu2,
        mcp: POWER.mcp,
        efis1: POWER.efis1,
        efis2: POWER.efis2,
        nav1: POWER.nav1,
        nav2: POWER.nav2,
        adf1: `${POWER.adf1} && ${B738.adfMode(1)} != 0`,
        adf2: `${POWER.adf2} && ${B738.adfMode(2)} != 0`,
        gps: POWER.gps,
        marker: POWER.marker,
      },
      vars: {
        centerPumpsOff: `${B738.fuelPump('c_l')} == 0 && ${B738.fuelPump('c_r')} == 0`,
        startValveOpen: (e) => `pneu.st${e}_valve_open`,
        startLeverIdle: (e) => `${B738.startLever(e)} >= 0.5`,
        eecPowered: (e) => `eng${e}.n2_pct > 15 || elec.eec${e}_alt_powered`,
        oilFilterBypass: (e) => `fail.b738.oil_filter${e}`,
        oilQty: (e) => `${B738.oilQty(e as 1 | 2)} ?? 18`,
        shakerNorm: 0.9,
        wxrModeText: 'ac.b738.wxr_mode_text',
        wxrTiltDeg: B738.wxrTilt,
      },
      afds: {
        power: `${POWER.fccA} || ${POWER.fccB}`,
        // STAB TRIM AUTOPILOT cutout at CUTOUT inhibits engagement and disengages the A/P (FCOM 4.10).
        engageInhibit: `${B738.stabCutoutAp} == 0`,
        autoDisconnect: `${B738.stabCutoutAp} == 0 || alert.stick_shaker`,
        atPower: POWER.at,
        leverVar: (e) => B738.tla(e as 1 | 2),
        gains: B738_AFCS_GAINS,
        autothrottle: { ...B738_AT_GAINS },
        // Fail-operational autoland: allow the ROLLOUT lateral mode (the AFDS preset lists the modes of the
        // fail-passive system) and annunciate it (FCOM 4.20 FMA "ROLLOUT").
        afcs: {
          lateralModes: [...(AFCS_B737_AFDS.lateralModes ?? []), 'ROLLOUT'],
          labels: { ...AFCS_B737_AFDS.labels, lateral: { ...AFCS_B737_AFDS.labels.lateral, ROLLOUT: 'ROLLOUT' } },
          // Flare law: firmer touchdown (EST ~2-3 ft/s, typical 737 autoland) than the generic preset.
          // LAND 3 holds through the flare and rollout (FCOM 4.20: the G/S is not used after FLARE; without this
          // the FMA turned NO AUTOLAND 2 s after touchdown when the G/S went invalid on the ground).
          // A/P disconnect on the ground after the autoland clears ROLLOUT / FLARE (F/D bars retract, FMA blank; the
          // F/D gives no rollout guidance, FCOM 4.20).
          autoland: { ...AFCS_B737_AFDS.autoland, rollout: true, flareTauS: 4, touchdownVsFpm: 200, holdStatusInFlare: true, clearOnGroundDisconnect: true },
        },
      },
      trafficSource: tcasDisplay,
      weatherOverlay: createWxrOverlay(ctx),
      radiosOptions: { navCount: 2, adfCount: 2 },
    },
  );

  ctx.vars.set('ac.b738.gps_installed', suite.radios ? 1 : 0);
  // Stick shaker (two SMYDs) at the shaker AoA schedule: aoa_norm = 0.9 there (the PFD minimum-speed bar reads it).
  const stall = new StallWarning(ctx, {
    kind: 'aoa',
    alphaStall: { x: SHAKER_ALPHA_DEG.x, y: SHAKER_ALPHA_DEG.y.map((a) => a / 0.9) },
    shakerNorm: 0.9,
    power: POWER.stallWarn,
    test: `gear.air_ground && (${B738.stallTest(1)} || ${B738.stallTest(2)})`,
  });
  const overspeed = new Overspeed(ctx, {
    vmoKt: B738_LIMITS.vmoKt,
    mmo: B738_LIMITS.mmo,
    marginKt: 0,
    marginMach: 0,
    vleKt: B738_LIMITS.vleKt,
    power: POWER.machWarn,
    test: `${B738.machTest(1)} || ${B738.machTest(2)}`,
  });
  // Altitude alert (FCOM 10.10 / B737NG "Warning Systems"): white box from 900 ft to 300 ft before the selected
  // altitude; after capture a deviation of 300 ft or more turns it amber and flashing with the tone. Inhibited with
  // flaps 25+ or G/S captured (systems-control §7.3). The shared ALT_ALERT_737NG preset (750 / 200 ft) is kept
  // for other users; the NG values are applied here.
  const altAlert = new AltitudeAlert(ctx, {
    ...ALT_ALERT_737NG,
    approachFt: 900,
    captureFt: 300,
    deviationFt: 300,
    power: POWER.mcp,
    inhibit: `surf.flaps_deg >= 25 || ap.vert_code == ${VERTICAL_MODES.indexOf('GS')}`,
  });
  const taws = new Taws(ctx, {
    class: 'A',
    power: POWER.taws,
    raVar: 'ra1.alt_ft',
    raValid: 'ra1.valid',
    flapsLanding: 'surf.flaps_deg >= 29.5',
    inhibits: { flapOverride: `${B738.gpwsFlapInh} != 0`, gearOverride: `${B738.gpwsGearInh} != 0`, terrain: `${B738.gpwsTerrInh} != 0` },
  });
  const tocw = new TakeoffConfigWarning(ctx, {
    // Armed on the ground with either forward thrust lever advanced for take-off (FCOM 15.20).
    armed: `gear.air_ground && (${B738.tla(1)} > 0.6 || ${B738.tla(2)} > 0.6)`,
    power: 'elec.dc1_powered || elec.dc2_powered',
    // The intermittent warning horn is shared with the cabin altitude warning: the late logic drives it.
    tone: '',
    checks: [
      // Trailing-edge flaps not in the take-off range (1-25) or LE devices not configured.
      { id: 'flaps', bad: 'surf.flaps_deg < 0.5 || surf.flaps_deg > 25.5 || flaps.transit || slats.pos < 0.4', text: 'FLAPS' },
      { id: 'stab', bad: `trim.pitch_units < ${STAB.greenBand[0]} || trim.pitch_units > ${STAB.greenBand[1]}`, text: 'STAB TRIM' },
      // FCOM 15.20: speed brake lever not in the DOWN detent (ARMED counts as not DOWN).
      { id: 'speedbrake', bad: `${B738.speedbrake} > ${SPEEDBRAKE.down + 0.02}`, text: 'SPEED BRAKE' },
      { id: 'park', bad: 'brakes.parking_set', text: 'PARKING BRAKE' },
    ],
  });
  const disc = new DisconnectAlerts(ctx, {});
  const radioAudio = new B738RadioAudio(ctx.vars, ctx.audio);
  return { adc, irs, isfdAhrs, ra, suite, stall, overspeed, altAlert, taws, tcas, tcasDisplay, radioAudio, tocw, disc };
}
