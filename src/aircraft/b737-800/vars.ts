/**
 * Boeing 737-800 cockpit control vars: the contract between the cockpit
 * (3D controls write these), the systems (read them), the state presets and
 * the checklists. Every control of the inventory in docs/aircraft/b737-800.md
 * §10 maps to one entry here (or to a documented standard / avionics-suite
 * var). The comment gives the value convention; positions are listed in the
 * order the cockpit ToggleSwitch `positions` / `values` should use.
 *
 * Aircraft-specific vars use the `ac.b738.` prefix (CLAUDE.md). The avionics
 * suite (src/avionics/boeing-737) owns the MCP, EFIS control panels, display
 * select / transfer switches, N1 SET / SPD REF / FUEL FLOW, CDUs, MFD buttons
 * and the A/P-A/T-FMC disengage lights (docs/modules/avionics-boeing-737.md
 * §4); those are not repeated here. Standard vars used by controls:
 *   input.pitch / roll / yaw / tiller / brake_left / brake_right (yokes, pedals, tiller, toe brakes)
 *   input.pitch_trim_rate (keyboard trim), input.ap_disc (yoke A/P disengage), input.toga (TO/GA switches)
 *   ac.irs1_mode / ac.irs2_mode (IRS mode selectors, 0 OFF 1 ALIGN 2 NAV 3 ATT)
 *   trim.pitch_units (stabilizer trim wheels write it directly: a manual move)
 *   nav{r}.active_mhz / stby_mhz, adf{r}.active_khz / stby_khz, com{r}.active_mhz / stby_mhz (radio panels)
 *   xpdr.code, xpdr.ident (ATC panel)
 * Events used by controls: 'at.disc' (A/T disengage switches), 'cas.ack_warning' is NOT used (737: fire
 * warning bell cutout below).
 */

const P = 'ac.b738.';
/** Light / annunciator outputs (written by the systems, read by the cockpit lights). */
const L = 'ac.b738.lt.';

export type Side = 1 | 2;
export type FuelPump = 'l_aft' | 'l_fwd' | 'r_fwd' | 'r_aft' | 'c_l' | 'c_r';
export const FUEL_PUMPS: readonly FuelPump[] = ['l_aft', 'l_fwd', 'r_fwd', 'r_aft', 'c_l', 'c_r'];
export type HydPumpSw = 'eng1' | 'elec2' | 'elec1' | 'eng2';
export const HYD_PUMP_SWITCHES: readonly HydPumpSw[] = ['eng1', 'elec2', 'elec1', 'eng2'];
export type WindowHeat = 'l_side' | 'l_fwd' | 'r_fwd' | 'r_side';
export const WINDOW_HEATS: readonly WindowHeat[] = ['l_side', 'l_fwd', 'r_fwd', 'r_side'];
export type Door = 'fwd_entry' | 'aft_entry' | 'fwd_service' | 'aft_service' | 'fwd_cargo' | 'aft_cargo' | 'l_overwing' | 'r_overwing' | 'equip' | 'flt_deck';
export const DOORS: readonly Door[] = ['fwd_entry', 'aft_entry', 'fwd_service', 'aft_service', 'fwd_cargo', 'aft_cargo', 'l_overwing', 'r_overwing', 'equip', 'flt_deck'];

/** ENGINE START switch positions (rotary, GRD solenoid-held). */
export const ENG_START = { grd: 0, off: 1, cont: 2, flt: 3 } as const;
/** Speedbrake lever positions (lever travel 0..1). */
export const SPEEDBRAKE = { down: 0, armed: 0.08, flightDetent: 0.67, up: 1 } as const;
/** Landing gear lever: UP 0, OFF 0.5, DN 1. */
export const GEAR_LEVER = { up: 0, off: 0.5, down: 1 } as const;
/** APU switch: OFF 0, ON 1, START 2 (spring-loaded to ON). */
export const APU_SW = { off: 0, on: 1, start: 2 } as const;
/** Transponder mode selector (ATC/TCAS panel). */
export const XPDR_SEL = { test: -1, stby: 0, altOff: 1, xpndr: 2, taOnly: 3, taRa: 4 } as const;

/** ACP receivers (FCOM 5.10, 737NG audio control panel): the transmitter row, then NAV / ADF / MKR / SPKR. */
export const ACP_RECEIVERS = ['vhf1', 'vhf2', 'vhf3', 'hf1', 'hf2', 'flt', 'svc', 'pa', 'nav1', 'nav2', 'adf1', 'adf2', 'mkr', 'spkr'] as const;
export type AcpReceiver = (typeof ACP_RECEIVERS)[number];

export const B738 = {
  // ================================================================ FORWARD OVERHEAD (P5)
  // ---------------------------------------------------------------- FLIGHT CONTROL panel
  /** FLT CONTROL A / B: STBY RUD (-1) / OFF (0) / ON (1). Guarded to ON. */
  fltCtl: (sys: 'a' | 'b') => `${P}fltctl_${sys}`,
  /** SPOILER A / B: OFF (0) / ON (1). Guarded to ON. */
  spoilerSw: (sys: 'a' | 'b') => `${P}spoiler_${sys}`,
  /** YAW DAMPER: OFF (0) / ON (1), solenoid-held (the system writes 0 when the damper disengages). */
  ydSw: `${P}yd_sw`,
  /** ALTERNATE FLAPS master ARM: OFF (0) / ARM (1). Guarded. */
  altFlapsArm: `${P}alt_flaps_arm`,
  /** ALTERNATE FLAPS position switch: UP (-1) / OFF (0) / DOWN (1, spring-loaded to OFF). */
  altFlapsSw: `${P}alt_flaps_sw`,

  // ---------------------------------------------------------------- FUEL panel
  /** Fuel pump switches OFF (0) / ON (1): L AFT, L FWD, R FWD, R AFT, CTR L, CTR R. */
  fuelPump: (p: FuelPump) => `${P}fuel_pump_${p}`,
  /** CROSSFEED selector: CLOSED (0) / OPEN (1) (rotary). */
  crossfeed: `${P}crossfeed`,

  // ---------------------------------------------------------------- ELECTRICAL panel
  /** DC meters selector: STBY PWR 0, BAT BUS 1, BAT 2, TR1 3, TR2 4, TR3 5, TEST 6. */
  dcMeterSel: `${P}dc_meter_sel`,
  /** AC meters selector: STBY PWR 0, GRD PWR 1, GEN1 2, APU GEN 3, GEN2 4, INV 5, TEST 6. */
  acMeterSel: `${P}ac_meter_sel`,
  /** BAT: OFF (0) / ON (1). Guarded to ON. */
  batSw: `${P}bat_sw`,
  /** CAB/UTIL: OFF (0) / ON (1). */
  cabUtilSw: `${P}cab_util_sw`,
  /** IFE/PASS SEAT: OFF (0) / ON (1). */
  ifeSw: `${P}ife_sw`,
  /** STANDBY POWER: BAT (-1) / OFF (0) / AUTO (1). Guarded to AUTO. */
  stbyPwrSw: `${P}stby_pwr_sw`,
  /** GRD PWR: OFF (-1) / neutral (0) / ON (1), spring-loaded to neutral. */
  grdPwrSw: `${P}grd_pwr_sw`,
  /** BUS TRANSFER: OFF (0) / AUTO (1). Guarded to AUTO. */
  busXferSw: `${P}bus_xfer_sw`,
  /** GEN 1 / GEN 2: OFF (-1) / neutral (0) / ON (1), spring-loaded to neutral. */
  genSw: (i: Side) => `${P}gen${i}_sw`,
  /** APU GEN (two switches, one per transfer bus): OFF (-1) / neutral (0) / ON (1), spring-loaded. */
  apuGenSw: (i: Side) => `${P}apu_gen${i}_sw`,
  /** GENERATOR DRIVE DISCONNECT 1 / 2: NORMAL (0) / DISCONNECT (1, momentary, guarded, red guard). */
  driveDisc: (i: Side) => `${P}drive_disc${i}`,
  /** Electrical MAINT push button (momentary; SCOPE: maintenance BITE only lights the ELEC light test). */
  elecMaint: `${P}elec_maint`,
  /** Ground power connected at the external receptacle (ground services; not a flight deck control). */
  gpuConnected: `${P}gpu_connected`,

  // ---------------------------------------------------------------- APU / ENGINE START
  /** APU switch: OFF (0) / ON (1) / START (2, spring-loaded to ON). */
  apuSw: `${P}apu_sw`,
  /** ENGINE START 1 / 2 rotary: GRD (0, solenoid-held, releases at starter cut-out) / OFF (1) / CONT (2) / FLT (3). */
  engStart: (i: Side) => `${P}eng_start${i}`,
  /** IGNITION select: IGN L (-1) / BOTH (0) / IGN R (1). */
  ignSel: `${P}ign_sel`,

  // ---------------------------------------------------------------- HYDRAULIC PUMPS
  /** ENG 1 (A), ELEC 2 (A), ELEC 1 (B), ENG 2 (B): OFF (0) / ON (1). */
  hydPump: (p: HydPumpSw) => `${P}hyd_${p}`,

  // ---------------------------------------------------------------- WINDOW / PROBE HEAT, ANTI-ICE
  /** WINDOW HEAT L SIDE, L FWD, R FWD, R SIDE: OFF (0) / ON (1). */
  windowHeat: (w: WindowHeat) => `${P}win_heat_${w}`,
  /** WINDOW HEAT TEST: OVHT (-1) / neutral (0) / PWR TEST (1), spring-loaded. */
  windowHeatTest: `${P}win_heat_test`,
  /** PROBE HEAT A (Capt) / B (F/O): OFF (0) / ON (1). */
  probeHeat: (sys: 'a' | 'b') => `${P}probe_heat_${sys}`,
  /** TAT TEST push button (momentary). */
  tatTest: `${P}tat_test`,
  /** WING ANTI-ICE: OFF (0) / ON (1). Solenoid-held on the ground; trips OFF at lift-off (FCOM 3.20). */
  wingAi: `${P}wing_ai`,
  /** ENG 1 / ENG 2 ANTI-ICE: OFF (0) / ON (1). */
  engAi: (i: Side) => `${P}eng_ai${i}`,

  // ---------------------------------------------------------------- AIR CONDITIONING / BLEED
  /** CONT CAB / FWD CAB / AFT CAB temperature selectors: 0 = OFF, 0.05..1 = AUTO C..W (≈ 18..30 degC). */
  tempSel: (zone: 'cont' | 'fwd' | 'aft') => `${P}temp_${zone}`,
  /** Temperature source selector: 0 CONT CAB, 1 FWD DUCT, 2 AFT DUCT, 3 FWD PASS CAB, 4 AFT PASS CAB, 5 L PACK, 6 R PACK. */
  tempSrcSel: `${P}temp_src_sel`,
  /** TRIM AIR: OFF (0) / ON (1). */
  trimAir: `${P}trim_air`,
  /** L / R RECIRC FAN: OFF (0) / AUTO (1). */
  recircFan: (i: Side) => `${P}recirc${i}`,
  /** L / R PACK: OFF (0) / AUTO (1) / HIGH (2). */
  pack: (i: Side) => `${P}pack${i}`,
  /** ISOLATION VALVE: CLOSE (0) / AUTO (1) / OPEN (2). */
  isoValve: `${P}iso_valve`,
  /** No. 1 / No. 2 engine BLEED: OFF (0) / ON (1). */
  bleed: (i: Side) => `${P}bleed${i}`,
  /** APU BLEED: OFF (0) / ON (1). */
  apuBleed: `${P}apu_bleed`,
  /** TRIP RESET push button (momentary). */
  tripReset: `${P}trip_reset`,
  /** Zone temperature / duct OVHT TEST push button (momentary; SCOPE: lights test only). */
  ovhtTest: `${P}ovht_test`,

  // ---------------------------------------------------------------- PRESSURIZATION
  /** FLT ALT selector (ft, -1,000..42,000 in 500 ft steps; window). */
  fltAltFt: `${P}flt_alt_ft`,
  /** LAND ALT selector (ft, -1,000..14,000 in 50 ft steps; window). */
  landAltFt: `${P}land_alt_ft`,
  /** Pressurization mode selector: AUTO (0) / ALTN (1) / MAN (2). */
  pressMode: `${P}press_mode`,
  /** Outflow valve switch (MAN): CLOSE (-1) / neutral (0) / OPEN (1), spring-loaded. */
  outflowSw: `${P}outflow_sw`,
  /** ALT HORN CUTOUT push button (cabin altitude warning horn silence). */
  altHornCutout: `${P}alt_horn_cutout`,

  // ---------------------------------------------------------------- LIGHTING (forward overhead bottom row)
  /** RETRACTABLE LANDING L / R: RETRACT (0) / EXTEND (1) / ON (2). */
  landingRetract: (i: Side) => `${P}ldg_retract${i}`,
  /** FIXED LANDING L / R (inboard, wing root): OFF (0) / ON (1). */
  landingFixed: (i: Side) => `${P}ldg_fixed${i}`,
  /** RUNWAY TURNOFF L / R: OFF (0) / ON (1). */
  turnoff: (i: Side) => `${P}turnoff${i}`,
  /** TAXI: OFF (0) / ON (1). */
  taxiLt: `${P}taxi_lt`,
  /** LOGO: OFF (0) / ON (1). */
  logoLt: `${P}logo_lt`,
  /** POSITION: STEADY (-1) / OFF (0) / STROBE & STEADY (1). */
  positionLt: `${P}position_lt`,
  /** ANTI COLLISION (red beacons): OFF (0) / ON (1). */
  antiColl: `${P}anti_coll`,
  /** WING (leading edge scan): OFF (0) / ON (1). */
  wingLt: `${P}wing_lt`,
  /** WHEEL WELL: OFF (0) / ON (1). */
  wheelWellLt: `${P}wheel_well_lt`,

  // ---------------------------------------------------------------- MISC forward overhead
  /** EQUIPMENT COOLING SUPPLY / EXHAUST: NORMAL (0) / ALTERNATE (1). */
  equipCoolSupply: `${P}equip_cool_supply`,
  equipCoolExhaust: `${P}equip_cool_exhaust`,
  /** EMERGENCY EXIT LIGHTS: OFF (0) / ARMED (1) / ON (2). Guarded to ARMED. */
  emerExitLt: `${P}emer_exit_lt`,
  /** NO SMOKING / FASTEN BELTS: OFF (0) / AUTO (1) / ON (2). */
  noSmoking: `${P}no_smoking`,
  fastenBelts: `${P}fasten_belts`,
  /** ATTEND / GRD CALL push buttons (momentary). */
  attendCall: `${P}attend_call`,
  grdCall: `${P}grd_call`,
  /** WINDSHIELD WIPER L / R: PARK (0) / INT (1) / LOW (2) / HIGH (3). */
  wiper: (i: Side) => `${P}wiper${i}`,
  /** Cockpit voice recorder TEST / ERASE push buttons (momentary). */
  cvrTest: `${P}cvr_test`,
  cvrErase: `${P}cvr_erase`,
  /** DOME light: OFF (0) / DIM (1) / BRIGHT (2). */
  domeLt: `${P}dome_lt`,
  /** Panel light rheostats 0..1: overhead panel, circuit breaker panel. */
  ovhdPanelLt: `${P}ovhd_panel_lt`,
  cbPanelLt: `${P}cb_panel_lt`,

  // ================================================================ AFT OVERHEAD (P5 aft)
  /** IRS DSPL SEL: TEST 0, TK/GS 1, PPOS 2, WIND 3, HDG/STS 4. */
  isduSel: `${P}isdu_sel`,
  /** IRS SYS DSPL: L (0) / R (1). */
  isduSys: `${P}isdu_sys`,
  /** EEC 1 / 2 (lighted push buttons): ON (1) / ALTN (0). */
  eec: (i: Side) => `${P}eec${i}`,
  /** PASS OXYGEN: NORMAL (0) / ON (1). Guarded. */
  passOxy: `${P}pass_oxy`,
  /** FLIGHT RECORDER: NORMAL (0) / TEST (1). Guarded. */
  fdrSw: `${P}fdr_sw`,
  /** MACH AIRSPEED WARNING TEST 1 / 2, STALL WARNING TEST 1 / 2 (momentary push buttons). */
  machTest: (i: Side) => `${P}mach_test${i}`,
  stallTest: (i: Side) => `${P}stall_test${i}`,
  /** LE DEVICES annunciator TEST push button (momentary). */
  leDevTest: `${P}le_dev_test`,
  /** SERVICE INTERPHONE: OFF (0) / ON (1). */
  svcInterphone: `${P}svc_interphone`,
  /** ENGINE / APU / door annunciator panel: doors open (0 closed / 1 open; ground services & cockpit door). */
  door: (d: Door) => `${P}door_${d}`,
  /** Flight deck door lock selector (pedestal): UNLKD (-1) / AUTO (0) / DENY (1). */
  fdDoorLock: `${P}fd_door_lock`,

  // ================================================================ SIDE CONSOLES (crew oxygen mask stowage boxes, FCOM 1.20)
  /** Crew oxygen mask (Capt 1 / F/O 2): STOWED (0) / DONNED (1; pulled out of the box, flow starts, OXY ON flag). */
  oxyMask: (s: Side) => `${P}oxy_mask${s}`,
  /** Mask box RESET/TEST slide (momentary): flow check through the regulator (yellow flow indicator). */
  oxyTest: (s: Side) => `${P}oxy_test${s}`,
  /** Regulator N / 100% selector: 100% (0, the stowed setting) / N normal diluter (1). */
  oxyDiluter: (s: Side) => `${P}oxy_diluter${s}`,
  /** Regulator EMERGENCY (positive pressure) knob: NORMAL (0) / EMERGENCY (1). */
  oxyEmer: (s: Side) => `${P}oxy_emer${s}`,

  // ================================================================ FORWARD PANELS / GLARESHIELD
  /** MASTER CAUTION (Capt / F/O lighted push buttons, momentary). */
  masterCaution: (s: Side) => `${P}master_caution${s}`,
  /** Master FIRE WARN (Capt / F/O lighted push buttons, momentary: silences the bell). */
  fireWarnPush: (s: Side) => `${P}fire_warn${s}`,
  /** System annunciator panel (six-pack) push = RECALL (either panel, momentary). */
  recall: (s: Side) => `${P}recall${s}`,
  /** LIGHTS switch (Capt panel): DIM (-1) / BRT (0) / TEST (1). */
  lightsTest: `${P}lights_test`,
  /** NOSE WHEEL STEERING (Capt panel): ALT (0) / NORM (1). Guarded to NORM. */
  nwsSw: `${P}nws_sw`,
  /** BELOW G/S P-INHIBIT push lights (Capt / F/O, momentary). */
  belowGs: (s: Side) => `${P}below_gs${s}`,
  /** Clock CHR push (momentary) and ET switch RESET (1, spring-loaded to HLD) / HLD (-1) / RUN (0) (FCOM 10.10). */
  clockChr: (s: Side) => `${P}clock_chr${s}`,
  clockEt: (s: Side) => `${P}clock_et${s}`,
  /**
   * Clock bezel controls (Smiths 737NG clock, SCBG P1/P3 drawing: CHR top-left, TIME/DATE top-right, ET RUN/HLD
   * bottom-left, RESET bottom, SET with + / - bottom-right; functions per flightdeck737.be "The Clock / Chrono"):
   * RESET (chronograph to zero; the ET is zeroed with the ET switch RESET position), TIME/DATE (cycles UTC time, UTC date, MAN time, MAN date), SET (steps the MAN field
   * being set: none, hours, minutes / day, month, year) and + / - (adjust the flashing field). All momentary.
   */
  clockReset: (s: Side) => `${P}clock_reset${s}`,
  clockTimeDate: (s: Side) => `${P}clock_timedate${s}`,
  clockSet: (s: Side) => `${P}clock_set${s}`,
  clockPlus: (s: Side) => `${P}clock_plus${s}`,
  clockMinus: (s: Side) => `${P}clock_minus${s}`,
  /**
   * FOOT AIR / WINDSHIELD AIR push-pull knobs (Capt P1-1 / F/O P3-3 lower strips, SCBG drawing): IN (0) / PULLED
   * (1). SCOPE: diverts part of the flight-deck conditioned air to the pilot's feet / windshield; modelled as the
   * outlet split only (the logic publishes `ac.b738.fd_air_foot{s}` / `fd_air_ws{s}`), no local temperature field.
   */
  footAir: (s: Side) => `${P}foot_air${s}`,
  windshieldAir: (s: Side) => `${P}windshield_air${s}`,
  /** Main panel light rheostats 0..1: Capt / F/O PANEL, background, AFDS flood, glareshield flood. */
  panelLt: (s: Side) => `${P}panel_lt${s}`,
  backgroundLt: `${P}background_lt`,
  afdsFlood: `${P}afds_flood`,
  glareshieldFlood: `${P}gs_flood`,
  /** Map light rheostats (Capt / F/O). */
  mapLt: (s: Side) => `${P}map_lt${s}`,
  /** Chart light rheostats on the side consoles (Capt / F/O), 0..1 (LightingSystem dimmers chart_capt / chart_fo). */
  chartLt: (s: Side) => `${P}chart_lt${s}`,
  /**
   * No. 2 (sliding) window crank (Capt / F/O): 0 closed .. 1 fully open. SCOPE: the window cannot open with the
   * cabin pressurized or in flight; the logic publishes `ac.b738.side_window_open{s}` (state only, the pane does
   * not move).
   */
  windowCrank: (s: Side) => `${P}window_crank${s}`,
  /** GPWS panel (F/O panel): FLAP INHIBIT / GEAR INHIBIT / TERR INHIBIT: NORMAL (0) / INHIBIT (1), guarded. */
  gpwsFlapInh: `${P}gpws_flap_inh`,
  gpwsGearInh: `${P}gpws_gear_inh`,
  gpwsTerrInh: `${P}gpws_terr_inh`,
  /** GPWS SYS TEST push button (momentary). */
  gpwsTest: `${P}gpws_test`,

  // ---------------------------------------------------------------- centre forward panel (P2)
  /** Landing gear lever: UP (0) / OFF (0.5) / DN (1). */
  gearLever: `${P}gear_lever`,
  /** Manual gear extension access door / handles pulled (0 / 1). */
  gearManualExt: `${P}gear_manual_ext`,
  /** Landing gear override trigger (lever lock override, momentary 0/1). */
  gearLockOvrd: `${P}gear_lock_ovrd`,
  /** AUTO BRAKE selector: RTO (-1) / OFF (0) / 1 / 2 / 3 / MAX (4). */
  autobrake: `${P}autobrake`,
  /** ISFD (Integrated Standby Flight Display) buttons: APP (cycles OFF 0 / ILS 1 / B-CRS 2), HP/IN, +/-, RST, BARO push STD. */
  isfdApp: `${P}isfd_app`,
  isfdHpa: `${P}isfd_hpa`,
  isfdRst: `${P}isfd_rst`,
  isfdStd: `${P}isfd_std`,

  // ================================================================ CONTROL STAND / PEDESTAL
  /** Thrust levers 1 / 2: 0 = forward idle .. 1 = full forward (A/T servo drives the same vars). */
  tla: (i: Side) => `${P}tla${i}`,
  /** Reverse thrust levers 1 / 2 (piggy-back): 0 stowed .. 1 full reverse; interlocked at the reverse idle detent until the sleeves deploy. */
  revLever: (i: Side) => `${P}rev${i}`,
  /** Engine start levers 1 / 2: CUTOFF (0) / IDLE (1). */
  startLever: (i: Side) => `${P}start_lever${i}`,
  /** Speed brake lever 0..1 (SPEEDBRAKE constants: DOWN, ARMED, FLIGHT DETENT, UP). */
  speedbrake: `${P}speedbrake`,
  /** Flap lever detent index 0..8: UP, 1, 2, 5, 10, 15, 25, 30, 40 (gates at 1 and 15). */
  flapLever: `${P}flap_lever`,
  /** Parking brake lever: RELEASED (0) / SET (1). */
  parkBrake: `${P}park_brake`,
  /** STAB TRIM MAIN ELECT / AUTO PILOT cutout switches: CUTOUT (0) / NORMAL (1). Guarded to NORMAL. */
  stabCutoutMain: `${P}stab_cutout_main`,
  stabCutoutAp: `${P}stab_cutout_ap`,
  /** STAB TRIM override (aft electronic panel): NORMAL (0) / OVERRIDE (1). Guarded. Bypasses the column cutout switches. */
  stabTrimOvrd: `${P}stab_trim_ovrd`,
  /** Control wheel stabilizer trim switches (Capt / F/O): NOSE DOWN (-1) / 0 / NOSE UP (1). Both halves of a split switch must move. */
  yokeTrim: (s: Side) => `${P}yoke_trim${s}`,
  /** AILERON trim (two spring-loaded switches, both must be moved): LEFT WING DOWN (-1) / 0 / RIGHT WING DOWN (1). */
  ailTrim: (n: 1 | 2) => `${P}ail_trim${n}`,
  /** RUDDER trim knob (spring-loaded): NOSE LEFT (-1) / 0 / NOSE RIGHT (1). */
  rudTrim: `${P}rud_trim`,
  /** Landing gear warning HORN CUTOUT push button (throttle quadrant). */
  hornCutout: `${P}horn_cutout`,
  /** Captain's nose-wheel steering tiller handle in the 3D cockpit (-1 full left .. 1 full right = +/-78 deg). Merged with the hardware axis `input.tiller` by the logic into `tillerCmd`. */
  tiller3d: `${P}tiller3d`,

  // ---------------------------------------------------------------- FIRE PROTECTION panel (aft pedestal)
  /** Engine 1 / 2 fire handle: IN (0) / PULLED (1). Unlocked by the fire warning or the override button. */
  fireHandle: (i: Side) => `${P}fire_handle${i}`,
  /** Engine fire handle rotation: L bottle (-1) / neutral (0) / R bottle (1), spring-loaded. */
  fireRot: (i: Side) => `${P}fire_rot${i}`,
  /** APU fire handle: IN (0) / PULLED (1); rotation either way (-1 / 1) discharges the APU bottle. */
  fireHandleApu: `${P}fire_handle_apu`,
  fireRotApu: `${P}fire_rot_apu`,
  /** OVHT DET 1 / 2: A (-1) / NORMAL (0) / B (1). */
  ovhtDet: (i: Side) => `${P}ovht_det${i}`,
  /** Fire detection TEST: FAULT/INOP (-1) / neutral (0) / OVHT/FIRE (1), spring-loaded. */
  fireTest: `${P}fire_test`,
  /** EXTINGUISHER TEST: 1 (-1) / neutral (0) / 2 (1), spring-loaded (squib continuity lights). */
  extTest: `${P}ext_test`,
  /** BELL CUTOUT push button (momentary). */
  bellCutout: `${P}bell_cutout`,
  /** Cargo fire: DET SELECT FWD / AFT (A -1 / ORM 0 / B 1), ARM FWD / AFT (alternate action 0/1), DISCH (momentary), TEST (momentary). */
  cargoDetSel: (z: 'fwd' | 'aft') => `${P}cargo_det_${z}`,
  cargoArm: (z: 'fwd' | 'aft') => `${P}cargo_arm_${z}`,
  cargoDisch: `${P}cargo_disch`,
  cargoTest: `${P}cargo_test`,

  // ---------------------------------------------------------------- COMMUNICATION / NAVIGATION panels (aft pedestal)
  /** VHF NAV control panel transfer (momentary) and TEST (momentary). */
  navXfer: (r: Side) => `${P}nav${r}_xfer`,
  navTest: (r: Side) => `${P}nav${r}_test`,
  /** Radio tuning panel (VHF COM 1 / 2) transfer (momentary) and panel OFF switch (0 OFF / 1 ON). */
  comXfer: (r: Side) => `${P}com${r}_xfer`,
  rtpPower: (r: Side) => `${P}rtp${r}_on`,
  /** ADF control panels: mode OFF (0) / ANT (1) / ADF (2); TONE (0/1); transfer (momentary). */
  adfMode: (r: Side) => `${P}adf${r}_mode`,
  adfTone: (r: Side) => `${P}adf${r}_tone`,
  adfXfer: (r: Side) => `${P}adf${r}_xfer`,
  /** Audio control panels (Capt / F/O / observer): transmitter select 0 VHF1 1 VHF2 2 VHF3 3 HF1 4 HF2 5 FLT 6 SVC 7 PA; MKR receiver volume 0..1; ALT/NORM (0 NORM / 1 ALT); V/B/R filter (-1 V / 0 B / 1 R). SCOPE: audio routing only (volumes). */
  acpMic: (s: 1 | 2 | 3) => `${P}acp${s}_mic`,
  acpMkrVol: (s: 1 | 2 | 3) => `${P}acp${s}_mkr_vol`,
  acpAltNorm: (s: 1 | 2 | 3) => `${P}acp${s}_alt`,
  acpFilter: (s: 1 | 2 | 3) => `${P}acp${s}_filter`,
  /**
   * ACP receiver switch / volume controls (FCOM 5.10 "Audio control panel": push on / push off, rotate for
   * volume, the switch lights when on). Receivers: ACP_RECEIVERS. MKR keeps its original volume var
   * (`acpMkrVol`); SPKR is a volume control only (no on/off). SCOPE: no audio routing; the logic publishes each
   * receiver's mixer level as `ac.b738.acp{s}.lvl_<rx>` and the MKR level drives the marker tones.
   */
  acpRxOn: (s: 1 | 2 | 3, rx: AcpReceiver) => `${P}acp${s}_rxon_${rx}`,
  acpRxVol: (s: 1 | 2 | 3, rx: AcpReceiver) => (rx === 'mkr' ? `${P}acp${s}_mkr_vol` : `${P}acp${s}_rxvol_${rx}`),
  /** ACP push-to-talk switch: R/T (1, spring-loaded: keys the selected transmitter) / OFF (0) / I/C (-1, latched: flight interphone). */
  acpPtt: (s: 1 | 2 | 3) => `${P}acp${s}_ptt`,
  /** ACP MASK / BOOM microphone selector (0 BOOM / 1 MASK). */
  acpMaskBoom: (s: 1 | 2 | 3) => `${P}acp${s}_mask`,
  /** Control wheel microphone switch (FCOM 5.10): MIC (1, keys the ACP-selected transmitter) / OFF (0) / INT (-1, flight interphone); spring-loaded to OFF. */
  yokeMic: (s: Side) => `${P}yoke_mic${s}`,
  /** ATC / TCAS panel: mode selector (XPDR_SEL), ATC 1/2 (1 / 2), ALT SOURCE 1/2, ABOVE/NORM/BELOW (1 / 0 / -1), IDENT (momentary). */
  xpdrModeSel: `${P}xpdr_mode_sel`,
  xpdrAtc: `${P}xpdr_atc`,
  xpdrAltSrc: `${P}xpdr_alt_src`,
  tcasRange: `${P}tcas_range`,
  xpdrIdentBtn: `${P}xpdr_ident_btn`,
  /**
   * Weather radar control panel: mode WX 0 / WX+T 1 / MAP 2 / TEST 3; GAIN 0..1; TILT -15..+15 deg. `wxrPower` is a
   * legacy var kept for the append-only rule: the NG panel has no on/off switch (the radar transmits while WXR is
   * selected on an EFIS control panel, FCOM 11.30); no control writes it and no system reads it.
   */
  wxrMode: `${P}wxr_mode`,
  wxrGain: `${P}wxr_gain`,
  wxrTilt: `${P}wxr_tilt_deg`,
  wxrPower: `${P}wxr_on`,
  /**
   * HF 1 / 2 control panels (P8, SCBG drawing: frequency window, RF SENS, OFF / USB / AM mode selector; Collins
   * HFS-900 style; fitted per operator). Mode OFF (0) / USB (1) / AM (2); frequency kHz 2,000..29,999 in 1 kHz
   * steps; RF SENS 0..1. SCOPE: no HF propagation model: the logic publishes power / receive state only.
   */
  hfMode: (r: Side) => `${P}hf${r}_mode`,
  hfFreqKhz: (r: Side) => `${P}hf${r}_khz`,
  hfSens: (r: Side) => `${P}hf${r}_sens`,
  /** SELCAL panel (P8): push-to-reset lights VHF 1 / VHF 2 / VHF 3 / HF 1 / HF 2 (momentary pushes, index 0..4). */
  selcalReset: (ch: 0 | 1 | 2 | 3 | 4) => `${P}selcal_reset${ch}`,
  /** Pedestal lights rheostats: PANEL, FLOOD (0..1). */
  pedestalPanelLt: `${P}pedestal_panel_lt`,
  pedestalFlood: `${P}pedestal_flood`,
  /**
   * ELT remote switch (aft overhead): ARM (0, guarded) / ON (1). EST: 737NG FCOM 1.30 aft overhead
   * ELT panel (remote control of the fixed ELT); ON transmits, ARM transmits after an impact.
   */
  eltSw: `${P}elt_sw`,

  // ================================================================ OUTPUTS: annunciator lights (0/1; 2 = dim/blue bright)
  lt: {
    // six-pack groups and master lights
    masterCaution: `${L}master_caution`,
    fireWarn: `${L}fire_warn`,
    group: (g: SixPackGroup) => `${L}six_${g}`,
    // flight controls
    fltCtlLowPress: (sys: 'a' | 'b') => `${L}fltctl_low_press_${sys}`,
    stbyLowQty: `${L}stby_low_qty`,
    stbyLowPress: `${L}stby_low_press`,
    stbyRudOn: `${L}stby_rud_on`,
    feelDiffPress: `${L}feel_diff_press`,
    speedTrimFail: `${L}speed_trim_fail`,
    machTrimFail: `${L}mach_trim_fail`,
    autoSlatFail: `${L}auto_slat_fail`,
    yawDamper: `${L}yaw_damper`,
    // fuel
    fuelLowPress: (p: FuelPump) => `${L}fuel_low_press_${p}`,
    xfeedValveOpen: `${L}xfeed_valve_open`, // 1 dim (open), 2 bright (in transit / disagree)
    engValveClosed: (i: Side) => `${L}eng_valve_closed${i}`,
    sparValveClosed: (i: Side) => `${L}spar_valve_closed${i}`,
    filterBypass: (i: Side) => `${L}filter_bypass${i}`,
    fuelTempC: `${P}fuel_temp_c`,
    // electrical
    batDischarge: `${L}bat_discharge`,
    trUnit: `${L}tr_unit`,
    elec: `${L}elec`,
    stbyPwrOff: `${L}stby_pwr_off`,
    grdPwrAvail: `${L}grd_pwr_avail`,
    xfrBusOff: (i: Side) => `${L}xfr_bus_off${i}`,
    sourceOff: (i: Side) => `${L}source_off${i}`,
    genOffBus: (i: Side) => `${L}gen_off_bus${i}`,
    apuGenOffBus: `${L}apu_gen_off_bus`,
    drive: (i: Side) => `${L}drive${i}`,
    dcAmps: `${P}dc_amps`,
    dcVolts: `${P}dc_volts`,
    acAmps: `${P}ac_amps`,
    acVolts: `${P}ac_volts`,
    acHz: `${P}ac_hz`,
    // APU
    apuMaint: `${L}apu_maint`,
    apuLowOil: `${L}apu_low_oil`,
    apuFault: `${L}apu_fault`,
    apuOverspeed: `${L}apu_overspeed`,
    // engines
    engStartValve: (i: Side) => `${L}start_valve${i}`,
    reverser: (i: Side) => `${L}reverser${i}`,
    engineControl: (i: Side) => `${L}engine_control${i}`,
    eecOn: (i: Side) => `${L}eec_on${i}`,
    eecAltn: (i: Side) => `${L}eec_altn${i}`,
    // hydraulics
    hydLowPress: (p: HydPumpSw) => `${L}hyd_low_press_${p}`,
    hydOverheat: (p: 'elec1' | 'elec2') => `${L}hyd_overheat_${p}`,
    // anti-ice
    windowOverheat: (w: WindowHeat) => `${L}win_ovht_${w}`,
    windowOn: (w: WindowHeat) => `${L}win_on_${w}`,
    probeOff: (probe: 'capt_pitot' | 'l_elev_pitot' | 'l_alpha' | 'temp_probe' | 'fo_pitot' | 'r_elev_pitot' | 'r_alpha' | 'aux_pitot') => `${L}probe_${probe}`,
    wingAiValve: (i: Side) => `${L}wing_ai_valve${i}`, // 1 dim open, 2 bright transit/disagree
    cowlAi: (i: Side) => `${L}cowl_ai${i}`, // COWL ANTI-ICE (amber, overpressure)
    cowlValve: (i: Side) => `${L}cowl_valve${i}`,
    // air conditioning / bleed
    packTrip: (i: Side) => `${L}pack${i}`,
    wingBodyOvht: (i: Side) => `${L}wing_body_ovht${i}`,
    bleedTripOff: (i: Side) => `${L}bleed_trip_off${i}`,
    dualBleed: `${L}dual_bleed`,
    ramDoorFullOpen: (i: Side) => `${L}ram_door${i}`,
    zoneTemp: (z: 1 | 2 | 3) => `${L}zone_temp${z}`,
    ductPress: (i: Side) => `${P}duct_press_psi${i}`,
    // pressurization
    autoFail: `${L}auto_fail`,
    offSchedDescent: `${L}off_sched_descent`,
    altn: `${L}altn`,
    manual: `${L}manual`,
    // gear / brakes / flaps
    gearGreen: (leg: 0 | 1 | 2) => `${L}gear_green${leg}`,
    gearRed: (leg: 0 | 1 | 2) => `${L}gear_red${leg}`,
    autoBrakeDisarm: `${L}auto_brake_disarm`,
    antiskidInop: `${L}antiskid_inop`,
    parkingBrake: `${L}parking_brake`,
    leFlapsTransit: `${L}le_flaps_transit`,
    leFlapsExt: `${L}le_flaps_ext`,
    flapLoadRelief: `${L}flap_load_relief`,
    speedbrakeArmed: `${L}speedbrake_armed`,
    speedbrakeDoNotArm: `${L}speedbrake_do_not_arm`,
    speedbrakeExtended: `${L}speedbrake_extended`,
    stabOutOfTrim: `${L}stab_out_of_trim`,
    takeoffConfig: `${L}takeoff_config`,
    cabinAltitude: `${L}cabin_altitude`,
    belowGs: `${L}below_gs`,
    gpwsInop: `${L}gpws_inop`,
    pseu: `${L}pseu`,
    // fire
    engOvht: (i: Side) => `${L}eng_ovht${i}`,
    fireHandleLt: (i: Side) => `${L}fire_handle${i}`,
    fireHandleApuLt: `${L}fire_handle_apu`,
    bottleDischarge: (b: 'l' | 'r' | 'apu') => `${L}bottle_disch_${b}`,
    fireFault: `${L}fire_fault`,
    apuDetInop: `${L}apu_det_inop`,
    wheelWell: `${L}wheel_well_fire`,
    squib: (b: 'l' | 'r' | 'apu') => `${L}squib_${b}`,
    cargoFire: (z: 'fwd' | 'aft') => `${L}cargo_fire_${z}`,
    cargoExtArmed: (z: 'fwd' | 'aft') => `${L}cargo_armed_${z}`,
    cargoDischarged: `${L}cargo_disch`,
    /** Cargo DETECTOR FAULT (amber) and the cargo EXTINGUISHER squib test lights (green, FWD / AFT), FCOM 8.10. */
    cargoDetFault: `${L}cargo_det_fault`,
    cargoSquib: (z: 'fwd' | 'aft') => `${L}cargo_squib_${z}`,
    /** Flight deck door AUTO UNLK light (amber), FCOM 1.40. */
    autoUnlk: `${L}auto_unlk`,
    // doors
    doorLt: (d: Door) => `${L}door_${d}`,
    lockFail: `${L}lock_fail`,
    // misc
    passOxyOn: `${L}pass_oxy_on`,
    equipCoolOff: (w: 'supply' | 'exhaust') => `${L}equip_cool_off_${w}`,
    emerExitNotArmed: `${L}emer_exit_not_armed`,
    callLt: `${L}call`,
    irsAlign: (s: Side) => `irs${s}.align_light`,
    irsOnDc: (s: Side) => `irs${s}.on_dc`,
    irsFault: (s: Side) => `irs${s}.fault`,
    irsDcFail: (s: Side) => `irs${s}.dc_fail`,
    fdrOff: `${L}fdr_off`,
    // indicator outputs (gauges)
    hydBrakePsi: `${P}brake_accum_psi`,
    flapGauge: (s: 'l' | 'r') => `${P}flap_gauge_${s}`,
    stabPosUnits: `${P}stab_units`,
    rudderTrimUnits: `${P}rud_trim_units`,
    ailTrimUnits: `${P}ail_trim_units`,
    crewOxyPsi: `${P}crew_oxy_psi`,
    cabinAltFt: `${P}cabin_alt_ft`,
    cabinDiffPsi: `${P}cabin_diff_psi`,
    cabinRateFpm: `${P}cabin_rate_fpm`,
    apuEgtC: `${P}apu_egt_c`,
    zoneTempC: `${P}zone_temp_c`,
    clockEtS: (s: Side) => `${P}clock_et_s${s}`,
    clockChrS: (s: Side) => `${P}clock_chr_s${s}`,
    /** Clock display mode: 0 UTC time, 1 UTC date, 2 MAN time, 3 MAN date; set field (0 none, 1..3) and MAN offset (h). */
    clockMode: (s: Side) => `${P}clock_mode${s}`,
    clockSetField: (s: Side) => `${P}clock_set_field${s}`,
    clockManOffsetH: (s: Side) => `${P}clock_man_offset_h${s}`,
    clockEtRun: (s: Side) => `${P}clock_et_run${s}`,
    /** SELCAL call lights (0..4: VHF 1, VHF 2, VHF 3, HF 1, HF 2). */
    selcal: (ch: 0 | 1 | 2 | 3 | 4) => `${L}selcal${ch}`,
    isduText: (line: 'l' | 'r') => `${P}isdu_${line}`,
    yawDamperInd: `${P}yd_ind`,
    /** ELT transmitting light (aft overhead ELT panel). */
    elt: `${L}elt`,
  },

  // ================================================================ derived / internal (systems)
  /** Derived FADEC lever input (0..1) after the start lever gate. */
  fadecTla: (i: Side) => `${P}fadec_tla${i}`,
  /** XFR bus source latch: 0 none, 1 own generator, 2 APU, 3 ground power, 4 opposite generator (bus transfer). */
  xfrSrc: (i: Side) => `${P}xfr${i}_src`,
  /** Standby power on battery (1) / normal (0). */
  stbyOnBatt: `${P}stby_on_batt`,
  /** Standby hydraulic pump command, standby rudder valve, PTU command, landing gear transfer unit. */
  stbyPumpCmd: `${P}stby_pump_cmd`,
  stbyRudder: `${P}stby_rudder`,
  ptuCmd: `${P}ptu_cmd`,
  gearXferUnit: `${P}gear_xfer_unit`,
  /** Six-pack recall active. */
  recallActive: `${P}recall_active`,
  /** Wing anti-ice valves command. */
  wingAiValveCmd: `${P}wing_ai_valve_cmd`,
  /** Tiller command for the nose-wheel steering: the larger of `input.tiller` and `tiller3d` (logic). */
  tillerCmd: `${P}tiller_cmd`,
  /** Engine fuel shutoff (spar + engine valve) open commands. */
  engValveOpen: (i: Side) => `${P}eng_valve_open${i}`,
  /** EEC mode per engine: 0 NORMAL, 1 soft alternate, 2 hard alternate (engines.ts B738Eec, FCOM 7.20). */
  eecMode: (i: Side) => `${P}eec_mode${i}`,
  /** Engine oil quantity (US qt) per engine (engines.ts oil model; engine display). */
  oilQty: (i: Side) => `${P}oil_qty${i}`,
  /** Emergency lights illuminated (exit signs, cabin / exterior emergency lights; FCOM 1.40). */
  emerLtsOn: `${P}emer_lts_on`,
  /** Windshield wiper blade sweep angle (0 = parked .. 1 = full sweep) per side (logic.ts). */
  wiperSweep: (i: Side) => `${P}wiper_sweep${i}`,
} as const;

/** System annunciator (six-pack) groups: Capt FLT CONT, IRS, FUEL, ELEC, APU, OVHT/DET; F/O ANTI-ICE, HYD, DOORS, ENG, OVERHEAD, AIR COND (FCOM 15.20). */
export type SixPackGroup = 'flt_cont' | 'irs' | 'fuel' | 'elec' | 'apu' | 'ovht_det' | 'anti_ice' | 'hyd' | 'doors' | 'eng' | 'overhead' | 'air_cond';
export const SIX_PACK_GROUPS: readonly SixPackGroup[] = ['flt_cont', 'irs', 'fuel', 'elec', 'apu', 'ovht_det', 'anti_ice', 'hyd', 'doors', 'eng', 'overhead', 'air_cond'];

/** Cockpit display ids owned by this aircraft (besides the suite's DUs, CDUs and MCP windows). */
export const B738_DISPLAY_IDS = { isfd: 'b738_isfd', isdu: 'b738_isdu' } as const;

/**
 * Every cockpit control var of this module (inputs only; outputs under `lt` and the derived
 * system vars are excluded). Used by the inventory audit test (every control must be read by a
 * system) and by the dossier's control inventory.
 */
export function b738ControlVars(): string[] {
  const out: string[] = [];
  const sides: Side[] = [1, 2];
  const skip = new Set(['acpRxOn', 'acpRxVol', 'lt', 'fadecTla', 'xfrSrc', 'stbyOnBatt', 'stbyPumpCmd', 'stbyRudder', 'ptuCmd', 'gearXferUnit', 'recallActive', 'wingAiValveCmd', 'engValveOpen', 'tillerCmd', 'eecMode', 'oilQty', 'emerLtsOn', 'wiperSweep', 'wxrPower']);
  const args: Record<string, readonly unknown[]> = {
    fltCtl: ['a', 'b'],
    spoilerSw: ['a', 'b'],
    probeHeat: ['a', 'b'],
    fuelPump: FUEL_PUMPS,
    hydPump: HYD_PUMP_SWITCHES,
    windowHeat: WINDOW_HEATS,
    tempSel: ['cont', 'fwd', 'aft'],
    door: DOORS,
    cargoDetSel: ['fwd', 'aft'],
    cargoArm: ['fwd', 'aft'],
    ailTrim: [1, 2],
    acpMic: [1, 2, 3],
    acpMkrVol: [1, 2, 3],
    acpAltNorm: [1, 2, 3],
    acpFilter: [1, 2, 3],
    acpPtt: [1, 2, 3],
    acpMaskBoom: [1, 2, 3],
    selcalReset: [0, 1, 2, 3, 4],
  };
  for (const [key, val] of Object.entries(B738)) {
    if (skip.has(key)) continue;
    if (typeof val === 'string') out.push(val);
    else if (typeof val === 'function') {
      const list = args[key] ?? sides;
      for (const a of list) out.push((val as (x: unknown) => string)(a));
    }
  }
  // ACP receiver switches / volumes (two arguments). MKR volume is `acpMkrVol` (already listed); SPKR has no switch.
  for (const s of [1, 2, 3] as const)
    for (const rx of ACP_RECEIVERS) {
      if (rx !== 'spkr') out.push(B738.acpRxOn(s, rx));
      if (rx !== 'mkr') out.push(B738.acpRxVol(s, rx));
    }
  return out;
}
