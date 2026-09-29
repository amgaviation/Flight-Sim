/**
 * AFCS presets: mode sets, annunciation labels and behaviour of the
 * autopilot families used by the simulator's aircraft. Each preset is a
 * complete `AfcsConfig` minus the aircraft wiring (power, servo power,
 * sensors, gains): spread it and add those, e.g.
 *
 *   new Afcs(ctx, { ...AFCS_GFC700_G1000, power: 'elec.avn_bus_powered', gains: { ... } })
 *
 * Sources:
 *   GFC 700 (G1000 NXi 172S, G3000 Citation M2, G5000 Longitude): Garmin
 *     G1000 Pilot's Guide 190-00498 / CAP "G-1000 AFCS Expanded Course"
 *     (max commanded pitch +20°/−15°, bank 22° in the 172; GA: wings level
 *     ~7° nose up, AP disconnects; CWS resynchronises ROL/PIT/VS/ALT/FLC;
 *     MET switch disconnects the AP; annunciations ROL, PIT, HDG, GPS, VOR,
 *     LOC, BC, ALT, ALTS, ALTV, VS, FLC, VPTH, GS, GP, TO, GA, LVL).
 *   KAP 140 (steam 172S): Bendix/King Pilot's Guide 006-18034-0000 (engages
 *     ROL + VS at the current VS; UP/DN 100 fpm per press, ALT 20 ft per
 *     press; ARM for altitude capture; NAV/APR/REV; turn-rate based roll
 *     axis without an attitude gyro).
 *   737NG AFDS: SmartCockpit "Boeing 737 Systems Review – Automatic Flight"
 *     (CMD A/B, CWS A/B, CWS P/R reversion on force, TO 10° ND to 60 kt then
 *     15° NU, V2+20 after lift-off, GA 15° + ground track, LOC capture not
 *     later than 1/2 dot, G/S capture at 2/5 dot, LNAV capture within 3 nm,
 *     dual-channel autoland: FLARE armed below 1500 ft, FLARE 50 ft, both
 *     A/Ps disengage if not armed by 350 ft, second channel before 800 ft,
 *     no automatic rollout).
 *   Honeywell Primus Epic (G650 PlaneView II, G800 Symmetry) and Collins
 *     Pro Line Fusion (Global 6000 "Vision"): mode names from the
 *     manufacturers' FMA conventions (ASEL/VASEL/FLCH/VPATH; ALTS CAP/FLC);
 *     limits EST (typical 27–30° bank with half bank) — marked EST.
 */
import type { AfcsConfig } from './types';

type Preset = Omit<AfcsConfig, 'power' | 'servoPower' | 'sensors' | 'gains'>;

const GARMIN_LABELS: AfcsConfig['labels'] = {
  lateral: { ROL: 'ROL', LVL: 'LVL', HDG: 'HDG', TRK: 'TRK', LNAV: 'GPS', VOR: 'VOR', LOC: 'LOC', BC: 'BC', TO: 'TO', GA: 'GA' },
  vertical: { PIT: 'PIT', LVL: 'LVL', ALT: 'ALT', ALTS: 'ALTS', ALTV: 'ALTV', VS: 'VS', FLC: 'FLC', VPATH: 'VPTH', GS: 'GS', GP: 'GP', TO: 'TO', GA: 'GA' },
  armedVertical: { ALTS: 'ALTS', ALTV: 'ALTV', VPATH: 'VPTH', GS: 'GS', GP: 'GP' },
  vorApproach: 'VAPP',
};

/** Garmin GFC 700 in the G1000 NXi (Cessna 172S): no yaw damper, 22° bank, GA disconnects the AP. */
export const AFCS_GFC700_G1000: Preset = {
  style: 'garmin',
  name: 'gfc700',
  lateralModes: ['NONE', 'ROL', 'LVL', 'HDG', 'LNAV', 'VOR', 'LOC', 'BC', 'TO', 'GA'],
  verticalModes: ['NONE', 'PIT', 'LVL', 'ALT', 'ALTS', 'ALTV', 'VS', 'FLC', 'VPATH', 'GS', 'GP', 'TO', 'GA'],
  defaults: { apLateral: 'ROL', apVertical: 'PIT' },
  labels: GARMIN_LABELS,
  limits: { maxBankDeg: 22, lowBankDeg: 15, maxPitchUpDeg: 20, maxPitchDownDeg: -15, maxRollRateDps: 5, maxPitchRateDps: 3, maxVsFpm: 1500 },
  to: { lateral: 'LVL', pitchDeg: 7 },
  ga: { lateral: 'LVL', pitchDeg: 7, disconnectsAp: true },
  disconnect: { overrideAction: 'none', trimDisconnects: true },
  // GFC 700: AP annunciation flashes and a tone sounds on disconnect (EST 5 s).
  discWarningS: 5,
  cws: 'garmin',
  vnav: true,
  altsAutoArm: true,
  selAltChangeInCapture: 'PIT',
  nav: { lnavCaptureNm: 1, vorCaptureCdi: 0.5, locCaptureCdi: 0.4, gsCaptureDev: 0.2 },
  steps: { pitchDeg: 0.5, vsFpm: 100, flcKt: 1 },
};

/** Garmin GFC 700 in the G3000 (Citation M2): yaw damper with the AP, BANK (low bank) key, FMS label. */
export const AFCS_GFC700_G3000: Preset = {
  ...AFCS_GFC700_G1000,
  name: 'gfc700_g3000',
  lateralModes: ['NONE', 'ROL', 'LVL', 'HDG', 'LNAV', 'VOR', 'LOC', 'BC', 'TO', 'GA'],
  verticalModes: ['NONE', 'PIT', 'LVL', 'ALT', 'ALTS', 'ALTV', 'VS', 'FLC', 'VPATH', 'GS', 'GP', 'TO', 'GA'],
  labels: { ...GARMIN_LABELS, lateral: { ...GARMIN_LABELS.lateral, LNAV: 'FMS' } },
  // EST: jet GFC 700 installations use 25° max / 15° low bank, TO/GA ~10° / 7.5° pitch.
  limits: { maxBankDeg: 25, lowBankDeg: 15, maxPitchUpDeg: 20, maxPitchDownDeg: -15, maxRollRateDps: 5, maxPitchRateDps: 3, maxVsFpm: 6000 },
  to: { lateral: 'LVL', pitchDeg: 10 },
  ga: { lateral: 'LVL', pitchDeg: 7.5, disconnectsAp: true },
  yawDamper: { withAp: true, requiredForAp: true },
};

/** Garmin G5000 AFCS (Citation Longitude, autothrottle equipped). */
export const AFCS_GFC_G5000: Preset = {
  ...AFCS_GFC700_G3000,
  name: 'g5000_afcs',
  verticalModes: ['NONE', 'PIT', 'LVL', 'ALT', 'ALTS', 'ALTV', 'VS', 'FLC', 'VPATH', 'VFLC', 'GS', 'GP', 'TO', 'GA'],
  labels: {
    ...GARMIN_LABELS,
    lateral: { ...GARMIN_LABELS.lateral, LNAV: 'FMS' },
    vertical: { ...GARMIN_LABELS.vertical, VFLC: 'VFLC' },
  },
};

/** Bendix/King KAP 140 two-axis with altitude preselect (steam-gauge 172S). */
export const AFCS_KAP140: Preset = {
  style: 'kap140',
  name: 'kap140',
  lateralModes: ['NONE', 'ROL', 'HDG', 'LNAV', 'VOR', 'LOC', 'BC'],
  verticalModes: ['NONE', 'VS', 'ALT', 'ALTS', 'GS'],
  defaults: { apLateral: 'ROL', apVertical: 'VS' },
  labels: {
    lateral: { ROL: 'ROL', HDG: 'HDG', LNAV: 'NAV', VOR: 'NAV', LOC: 'NAV', BC: 'REV' },
    armedLateral: { LNAV: 'NAV ARM', VOR: 'NAV ARM', LOC: 'NAV ARM', BC: 'REV ARM' },
    approachLateral: { LNAV: 'APR', VOR: 'APR', LOC: 'APR', BC: 'REV' },
    approachArmedLateral: { LNAV: 'APR ARM', VOR: 'APR ARM', LOC: 'APR ARM', BC: 'REV ARM' },
    vertical: { VS: 'VS', ALT: 'ALT', ALTS: 'ALT', GS: 'GS' },
    armedVertical: { ALTS: 'ARM', GS: 'GS ARM' },
  },
  // Turn-coordinator based roll axis: 90 % standard rate (EST), pitch limits EST.
  limits: { maxBankDeg: 25, lowBankDeg: 15, maxPitchUpDeg: 15, maxPitchDownDeg: -15, maxRollRateDps: 4, maxPitchRateDps: 2, maxVsFpm: 1600, rollCommand: 'rate', stdRateFraction: 0.9 },
  disconnect: { overrideAction: 'none', trimDisconnects: true },
  discWarningS: 5,
  cws: 'garmin',
  fdAutoOn: false,
  altsAutoArm: true,
  selAltChangeInCapture: 'VS',
  nav: { lnavCaptureNm: 1, vorCaptureCdi: 0.5, locCaptureCdi: 0.4, gsCaptureDev: 0.2 },
  steps: { vsFpm: 100, altFt: 20 },
};

/** Boeing 737NG AFDS (MCP, CMD A/B, CWS A/B, dual-channel autoland). */
export const AFCS_B737_AFDS: Preset = {
  style: 'boeing',
  name: 'b737_afds',
  lateralModes: ['NONE', 'HDG', 'LNAV', 'VOR', 'LOC', 'TO', 'GA', 'CWS', 'TRK'],
  verticalModes: ['NONE', 'ALT', 'ALTS', 'VS', 'FLC', 'VPATH', 'VFLC', 'VALT', 'GS', 'TO', 'GA', 'FLARE', 'CWS'],
  defaults: { apLateral: 'CWS', apVertical: 'CWS', fdLateral: 'NONE', fdVertical: 'NONE' },
  labels: {
    lateral: { HDG: 'HDG SEL', LNAV: 'LNAV', VOR: 'VOR/LOC', LOC: 'VOR/LOC', TO: 'TO/GA', GA: 'TO/GA', CWS: 'CWS R', TRK: 'TO/GA' },
    vertical: { ALT: 'ALT HOLD', ALTS: 'ALT ACQ', VS: 'V/S', FLC: 'MCP SPD', VPATH: 'VNAV PTH', VFLC: 'VNAV SPD', VALT: 'VNAV PTH', GS: 'G/S', TO: 'TO/GA', GA: 'TO/GA', FLARE: 'FLARE', CWS: 'CWS P' },
    armedVertical: { ALTS: '', ALTV: '', VPATH: '', GS: 'G/S', FLARE: 'FLARE', VS: 'V/S' },
  },
  // Bank angle selector 10–30° (MCP); pitch limits EST.
  limits: { maxBankDeg: 30, lowBankDeg: 10, maxPitchUpDeg: 20, maxPitchDownDeg: -15, maxRollRateDps: 5, maxPitchRateDps: 3, maxVsFpm: 7900 },
  bankSelector: true,
  to: { lateral: 'HDG', groundPitchDeg: -10, rotateKt: 60, pitchDeg: 15, speedAfterLiftoff: { addKt: 20, minClimbFpm: 1000 } },
  ga: { lateral: 'TRK', pitchDeg: 15, disconnectsAp: false, speedAfterClimbFpm: 1500 },
  disconnect: { overrideAction: 'cws', trimDisconnects: true, overrideInput: 0.3, overrideTimeS: 0.2 },
  cws: 'boeing',
  fdAutoOn: false,
  vnav: true,
  altsAutoArm: true,
  selAltChangeInCapture: 'VS',
  autoland: { flareFt: 50, armBelowFt: 1500, secondChannelBeforeFt: 800, flareArmDeadlineFt: 350, rollout: false, flareTauS: 5, touchdownVsFpm: 120 },
  nav: { lnavCaptureNm: 3, vorCaptureCdi: 0.5, locCaptureCdi: 0.25, gsCaptureDev: 0.2, defaultReceiver: 1 },
};

/** Honeywell Primus Epic AFCS (Gulfstream G650 PlaneView II / G800 Symmetry). */
export const AFCS_PRIMUS_EPIC: Preset = {
  style: 'honeywell',
  name: 'primus_epic',
  lateralModes: ['NONE', 'ROL', 'HDG', 'TRK', 'LNAV', 'VOR', 'LOC', 'BC', 'TO', 'GA'],
  verticalModes: ['NONE', 'PIT', 'ALT', 'ALTS', 'ALTV', 'VS', 'FPA', 'FLC', 'VPATH', 'VFLC', 'VALT', 'GS', 'GP', 'TO', 'GA'],
  defaults: { apLateral: 'ROL', apVertical: 'PIT' },
  labels: {
    lateral: { ROL: 'ROLL', HDG: 'HDG', TRK: 'TRK', LNAV: 'LNAV', VOR: 'VOR', LOC: 'LOC', BC: 'BC', TO: 'TO', GA: 'GA' },
    vertical: { PIT: 'PIT', ALT: 'ALT', ALTS: 'ASEL', ALTV: 'VASEL', VS: 'VS', FPA: 'FPA', FLC: 'FLCH', VPATH: 'VPATH', VFLC: 'VFLCH', VALT: 'VALT', GS: 'GS', GP: 'GP', TO: 'TO', GA: 'GA' },
    armedVertical: { ALTS: 'ASEL', ALTV: 'VASEL', VPATH: 'VPATH', GS: 'GS', GP: 'GP' },
  },
  limits: { maxBankDeg: 27, lowBankDeg: 13.5, maxPitchUpDeg: 20, maxPitchDownDeg: -15, maxRollRateDps: 5, maxPitchRateDps: 3, maxVsFpm: 8000 },
  to: { lateral: 'TRK', pitchDeg: 12 },
  ga: { lateral: 'TRK', pitchDeg: 10, disconnectsAp: false, speedAfterClimbFpm: 1500 },
  disconnect: { overrideAction: 'disconnect', trimDisconnects: false },
  yawDamper: { withAp: true },
  vnav: true,
  altsAutoArm: true,
  selAltChangeInCapture: 'PIT',
  nav: { lnavCaptureNm: 1, vorCaptureCdi: 0.5, locCaptureCdi: 0.3, gsCaptureDev: 0.2 },
};

/** Collins Pro Line Fusion AFCS (Bombardier Global 6000 "Vision" flight deck). */
export const AFCS_PROLINE_FUSION: Preset = {
  style: 'collins',
  name: 'proline_fusion',
  lateralModes: ['NONE', 'ROL', 'HDG', 'TRK', 'LNAV', 'VOR', 'LOC', 'BC', 'TO', 'GA'],
  verticalModes: ['NONE', 'PIT', 'ALT', 'ALTS', 'ALTV', 'VS', 'FPA', 'FLC', 'VPATH', 'VFLC', 'VALT', 'GS', 'GP', 'TO', 'GA'],
  defaults: { apLateral: 'ROL', apVertical: 'PIT' },
  labels: {
    lateral: { ROL: 'ROLL', HDG: 'HDG', TRK: 'TRK', LNAV: 'LNAV', VOR: 'VOR', LOC: 'LOC', BC: 'BC', TO: 'TO', GA: 'GA' },
    vertical: { PIT: 'PITCH', ALT: 'ALT', ALTS: 'ALTS CAP', ALTV: 'VALTS CAP', VS: 'VS', FPA: 'FPA', FLC: 'FLC', VPATH: 'VPATH', VFLC: 'VFLC', VALT: 'VALT', GS: 'GS', GP: 'GP', TO: 'TO', GA: 'GA' },
    armedVertical: { ALTS: 'ALTS', ALTV: 'VALTS', VPATH: 'VPATH', GS: 'GS', GP: 'GP' },
  },
  limits: { maxBankDeg: 25, lowBankDeg: 15, maxPitchUpDeg: 20, maxPitchDownDeg: -15, maxRollRateDps: 5, maxPitchRateDps: 3, maxVsFpm: 8000 },
  to: { lateral: 'TRK', pitchDeg: 12 },
  ga: { lateral: 'TRK', pitchDeg: 10, disconnectsAp: false, speedAfterClimbFpm: 1500 },
  disconnect: { overrideAction: 'disconnect', trimDisconnects: true },
  yawDamper: { withAp: true },
  vnav: true,
  altsAutoArm: true,
  selAltChangeInCapture: 'PIT',
  nav: { lnavCaptureNm: 1, vorCaptureCdi: 0.5, locCaptureCdi: 0.3, gsCaptureDev: 0.2 },
};
