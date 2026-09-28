/**
 * Gulfstream G800 cockpit-control and aircraft-specific vars: the contract
 * between the cockpit build (src/aircraft/g800/cockpit, another agent), the
 * Symmetry avionics suite (overhead touch screens write the
 * `GULFSTREAM_OVERHEAD_VARS` names) and the systems in systems/**. The control
 * inventory in docs/aircraft/g800.md §9 lists every control with its var,
 * positions, spring/guard and panel position.
 *
 * Conventions: latched values unless marked "momentary" (the control writes
 * the resting value on release); 3-position switches use the listed integers.
 */
import { GULFSTREAM_OVERHEAD_VARS as OH } from '../../avionics/honeywell-epic/logic/overhead';

const P = 'ac.g800.';

export const G800_VARS = {
  // =============================================================== OVERHEAD (3 touch screens, Symmetry OHPTS)
  // Electrical (OHPTS ELEC page)
  battL: OH['elec.batt_l'], // L BATT: 0 OFF, 1 ON
  battR: OH['elec.batt_r'], // R BATT: 0 OFF, 1 ON
  genL: OH['elec.gen_l'], // L GEN: 0 OFF, 1 ON (cycle OFF->ON resets a tripped IDG GCU)
  genR: OH['elec.gen_r'],
  apuGen: OH['elec.apu_gen'], // APU GEN: 0 OFF, 1 ON
  gpu: OH['elec.gpu'], // GPU (external AC): 0 OFF, 1 ON (AVAIL shown when a cart is connected)
  busTie: OH['elec.bus_tie'], // BUS TIE: 1 AUTO, 0 OPEN
  lMainTru: OH['elec.l_main_tru'], // L MAIN TRU: 0 OFF, 1 ON
  rMainTru: OH['elec.r_main_tru'],
  emerPwr: OH['elec.emer_pwr'], // EMER PWR: 0 OFF, 1 ARM (emergency batteries connect below 20 V on an ESS DC bus)
  ratDeploy: OH['elec.rat'], // RAT DEPLOY (guarded touch key) / RAT manual T-handle: 1 deployed (cannot be restowed in flight)
  cabinMaster: OH['elec.cabin_master'], // CABIN MASTER: 0 OFF, 1 ON (cabin electrical loads)
  galleyMaster: OH['elec.galley_master'], // GALLEY MASTER: 0 OFF, 1 ON
  apuMaster: OH['apu.master'], // APU MASTER: 0 OFF, 1 ON
  apuStart: OH['apu.start'], // APU START: momentary 1
  // Fuel (OHPTS FUEL page)
  boostL: OH['fuel.boost_l'], // L BOOST: 0 OFF, 1 AUTO, 2 ON
  boostR: OH['fuel.boost_r'],
  altPumpL: OH['fuel.alt_l'], // L ALT PUMP: 0 OFF, 1 ON
  altPumpR: OH['fuel.alt_r'],
  xflow: OH['fuel.xflow'], // CROSSFLOW: 0 CLOSED, 1 OPEN
  hfr: OH['fuel.hfr'], // HEATED RETURN: 0 OFF, 1 AUTO, 2 ON
  // Hydraulics (OHPTS HYD page). The GVI EDPs have no cockpit switch (SCQ); the suite hides edp_l/edp_r.
  auxPump: OH['hyd.aux'], // AUX PUMP: 0 OFF, 1 ARM, 2 ON
  ptu: OH['hyd.ptu'], // PWR XFR UNIT: 0 OFF, 1 ARM, 2 ON
  // Bleed / ECS / pressurization (OHPTS ECS page)
  bleedL: OH['bleed.l'], // L ENG BLEED: 0 OFF, 1 ON
  bleedR: OH['bleed.r'],
  bleedApu: OH['bleed.apu'], // APU BLEED: 0 OFF, 1 ON
  isoValve: OH['bleed.iso'], // ISOLATION: 1 AUTO, 2 OPEN, 0 CLOSED
  packL: OH['ecs.pack_l'], // L PACK: 0 OFF, 1 ON
  packR: OH['ecs.pack_r'],
  ramAir: OH['ecs.ram_air'], // RAM AIR (guarded): 0 CLOSED, 1 OPEN
  zoneTemp: (z: 1 | 2 | 3 | 4) => OH[`ecs.zone${z}`], // zone targets degC: 1 cockpit, 2 fwd cabin, 4 mid cabin, 3 aft cabin
  pressMode: OH['press.mode'], // PRESS MODE: 0 AUTO, 1 SEMI, 2 MANUAL
  pressLdgElev: OH['press.ldg_elev'], // LDG ELEV (ft) used in SEMI (and in AUTO when no FMS destination)
  pressManual: OH['press.manual'], // MAN RATE -1 (close, cabin descends) .. +1 (open, cabin climbs), MANUAL only
  pressDump: OH['press.dump'], // DUMP (guarded): 0 OFF, 1 ON
  // Ice (OHPTS ICE page)
  waiL: OH['ice.wing_l'], // L WING: 0 OFF, 1 AUTO, 2 ON
  waiR: OH['ice.wing_r'],
  caiL: OH['ice.cowl_l'], // L COWL: 0 OFF, 1 AUTO, 2 ON
  caiR: OH['ice.cowl_r'],
  probeHeat: OH['ice.probes'], // PROBE HEAT: 1 AUTO, 2 ON
  wshldL: OH['ice.wshld_l'], // L WSHLD heat: 0 OFF, 1 ON
  wshldR: OH['ice.wshld_r'],
  cabinWdoHeat: OH['ice.cabin_wdo'], // CABIN WDO heat: 0 OFF, 1 ON
  evsWdoHeat: OH['ice.evs_wdo'], // EVS WDO heat: 0 OFF, 1 ON
  // Lights (OHPTS LIGHTS page)
  ltNav: OH['light.nav'],
  ltBeacon: OH['light.beacon'],
  ltStrobe: OH['light.strobe'],
  ltLandingL: OH['light.landing_l'],
  ltLandingR: OH['light.landing_r'],
  ltTaxi: OH['light.taxi'],
  ltRecog: OH['light.recog'],
  ltLogo: OH['light.logo'],
  ltWing: OH['light.wing'],
  ltEmer: OH['light.emer'], // EMER LTS: 0 OFF, 1 ARM, 2 ON
  ltSeatbelt: OH['light.seatbelt'],
  ltNoSmoke: OH['light.nosmoke'],
  ltDome: OH['light.dome'],
  ltPanel: OH['light.panel'], // PANEL dimmer 0..1
  ltFlood: OH['light.flood'], // FLOOD dimmer 0..1
  // Engine start / oxygen (OHPTS ENGINE page)
  startMaster: OH['eng.start_master'], // START MASTER: 0 OFF, 1 ON
  crankMaster: OH['eng.crank_master'], // CRANK MASTER: 0 OFF, 1 ON (dry motoring with the START buttons)
  startL: OH['eng.start_l'], // L START: momentary 1
  startR: OH['eng.start_r'],
  contIgn: OH['eng.ign'], // CONT IGN: 0 OFF, 1 ON
  oxyCrew: OH['oxy.crew'], // CREW O2 supply: 0 OFF, 1 ON
  oxyPax: OH['oxy.pax'], // PASS O2: 0 OFF, 1 AUTO, 2 ON (manual deploy)

  // =============================================================== OVERHEAD hardware (few physical items)
  fireTest: `${P}fire_test`, // FIRE TEST button, momentary 1 (overhead aft, SYSTEM TEST area)
  // STORM light switch (overhead COCKPIT LIGHTS, cockpit-overhead agent): 0 OFF, 1 ON - all flood / dome lighting to full
  // brightness for lightning (EST: GVI-family storm function; drives the 'storm' dimmer in systems/lighting.ts).
  stormLt: `${P}storm_lt`,
  gpuAvail: `${P}gpu_avail`, // ground service: AC cart connected (set by the states / menu), not a cockpit control

  // =============================================================== GLARESHIELD
  // GP-700 guidance panel and the two touch SFDs are owned by the Epic suite (epic.gp.* events).
  // MASTER WARNING / MASTER CAUTION (L and R): events 'cas.ack_warning' / 'cas.ack_caution'; lamps alert.master_warning / alert.master_caution.

  // =============================================================== CENTER PANEL (below DU2/DU3)
  gearHandle: `${P}gear_handle`, // LANDING GEAR handle: 1 DN, 0 UP (lock solenoid on the ground: gear.handle_lock)
  gearLockRel: `${P}gear_lock_rel`, // DN LOCK RELEASE button, momentary 1 (allows UP with weight on wheels; maintenance)
  gearAlt: `${P}gear_alt`, // EMERGENCY GEAR T-handle (nitrogen blowdown, one shot): 0 stowed, 1 pulled
  // HORN SILENCE button: event 'gear.horn_silence'

  // =============================================================== CENTER CONSOLE / FIRE HANDLES (forward pedestal)
  fireHandleL: `${P}fire_l_handle`, // L ENG FIRE handle: 0 in, 1 pulled (unlocks with a fire warning or the override)
  fireHandleR: `${P}fire_r_handle`,
  fireHandleApu: `${P}fire_apu_handle`, // APU FIRE handle
  fireRotL: `${P}fire_l_rot`, // L handle rotated: -1 SHOT 1 (right bottle), 0, +1 SHOT 2 (left bottle); spring to 0
  fireRotR: `${P}fire_r_rot`,
  fireRotApu: `${P}fire_apu_rot`, // APU handle rotated: +1 discharges the LEFT bottle (GVI: APU uses the left bottle)

  // =============================================================== PEDESTAL (throttle quadrant and aft)
  tla: (i: number) => `${P}tla${i}`, // power lever 0 IDLE .. 1 MAX (full forward = maximum takeoff)
  rev: (i: number) => `${P}rev${i}`, // piggy-back thrust reverser lever 0 stowed .. 1 max reverse (only at IDLE)
  // TO/GA buttons (outboard of each power-lever knob): event 'ap.toga'. A/T DISC buttons (inboard): event 'at.disc'.
  flapLever: `${P}flap_lever`, // FLAP handle: 0 UP, 1 10, 2 20, 3 39
  speedbrake: `${P}speedbrake`, // SPEED BRAKE handle: 0 RET .. 1 EXT (continuous; 0.5 mid detent)
  gndSplrArm: `${P}gnd_splr_arm`, // GND SPLR switch: 0 OFF, 1 ARMED
  parkBrake: `${P}park_brake`, // PARKING BRAKE handle: 0 released, 1 set
  autobrake: `${P}autobrake`, // AUTOBRAKE knob: -1 RTO, 0 OFF, 1 LOW, 2 MED, 3 HIGH
  runL: `${P}eng_run_l`, // L ENGINE RUN/STOP (lift-lock toggle): 1 RUN, 0 STOP
  runR: `${P}eng_run_r`,
  rollTrimSw: `${P}roll_trim`, // ROLL TRIM rocker: -1 LWD, 0, +1 RWD (spring to 0)
  yawTrimSw: `${P}yaw_trim`, // RUDDER TRIM knob: -1 NL, 0, +1 NR (spring to 0)
  yawTrimCenter: `${P}yaw_trim_ctr`, // RUDDER TRIM AUTO CENTER button, momentary 1
  fltCtrlReset: `${P}flt_ctrl_reset`, // FLT CTRL RESET (guarded button), momentary 1
  nwsSw: `${P}nws`, // NOSEWHEEL STEERING (guarded switch): 1 ON, 0 OFF
  // CCDs and pedestal TSCs: owned by the Epic suite (epic.ccd{s}.*, touch displays).

  // =============================================================== SIDESTICKS (outboard consoles, BAE active control sidesticks)
  // Pitch/roll: input.pitch/roll (via the cockpit sidestick drag vars, COCKPIT_VARS.yoke*).
  // AP DISC / TRIM SYNC button (top, thumb): input.ap_disc (hold) - disconnects the AP; with the AP off it syncs the FBW trim speed.
  ssTrim: (s: 1 | 2) => `${P}ss_trim${s}`, // pitch trim switch on the grip: +1 nose up (slower trim speed), -1 nose down; spring to 0
  // AP DISC / TRIM SYNC button on each 3D grip (hold var, momentary 1). The app's input module rewrites input.ap_disc every
  // frame from the keyboard/hardware, so the 3D buttons write these; the grip button also emits 'ap.disc' (AFCS DISC).
  ssDisc: (s: 1 | 2) => `${P}ss_disc${s}`,
  hudRocker: (s: 1 | 2) => `${P}hud_rocker${s}`, // HUD/EVS rocker: +1 cycles SVS/EVS/CVS video, -1 clears video (FSB App. 4); spring to 0
  ptt: (s: 1 | 2) => `${P}ptt${s}`, // PTT trigger on the front of the grip, momentary 1 = MIC keyed (systems/audio.ts)
  micSel: (s: 1 | 2) => `${P}mic_sel${s}`, // TSC audio MIC select: 1 VHF1, 2 VHF2, 3 VHF3, 4 HF1, 5 HF2, 6 PA (SCOPE: no touch UI)
  micKeyed: (s: 1 | 2) => `${P}mic_keyed${s}`, // derived: transmitter keyed by that side (0 none)
  comTx: (r: 1 | 2 | 3) => `${P}com${r}_tx`, // derived: VHF r transmitting
  stuckMic: `${P}stuck_mic`, // derived: continuous keying past the stuck-mic timeout (CAS "Stuck Mic")

  // =============================================================== SIDE CONSOLES
  tiller: `${P}tiller`, // NOSEWHEEL STEERING tiller (left console only, FSB 9.4 b): -1..1
  oxyMask: (s: 1 | 2) => `${P}oxy_mask${s}`, // crew quick-donning mask: 0 stowed, 1 donned (flow)
  oxyMode: (s: 1 | 2) => `${P}oxy_mode${s}`, // mask regulator: 0 NORMAL (diluter), 1 100 %, 2 EMERGENCY

  // =============================================================== derived (systems -> cockpit/avionics), not controls
  tlaEff: (i: number) => `${P}tla_eff${i}`, // effective FADEC lever (forward 0..1, reverse -1..0)
  idleBoth: `${P}idle_both`,
  toThrust: `${P}to_thrust`,
  busTieCmd: `${P}bus_tie_cmd`,
  gearDown: `${P}gear_dn_cmd`,
  ratDeployed: `${P}rat_deployed`,
  ratSpeed: `${P}rat_drive`,
  ebattOn: `${P}ebatt_on`,
  startReq: (i: number) => `${P}start_req${i}`,
  isoOpen: `${P}iso_open`,
  packOn: (s: 1 | 2) => `${P}pack_on${s}`,
  waiOn: (s: 1 | 2) => `${P}wai_on${s}`,
  caiOn: (s: 1 | 2) => `${P}cai_on${s}`,
  probeHeatOn: `${P}probe_heat_on`,
  hfrActive: `${P}hfr_active`,
  auxPumpOn: `${P}aux_pump_on`,
  ptuOn: `${P}ptu_on`,
  steerCmd: `${P}tiller_cmd`,
  eldac: `${P}eldac_cmd`,
  fccFault: `${P}fcc_fault`,
  epr: (i: number) => `ac.eng${i}.epr`, // EPR (P50/P20) for the Epic engine window (read by the suite)
  avionicsPowered: `${P}avn_powered`,
  // =============================================================== FIX ROUND 1 (layout audit): hardware on the Symmetry panels
  // Forward overhead strip (G600 BL7C0705 p_strip0-2; code450 G700/G800 electrical / powerplant / fire study sheets)
  // EMERGENCY POWER ON / ARM / OFF: three clear-guarded switchlights selecting emerPwr (0 OFF, 1 ARM, 2 ON = E-batts forced on).
  fcsBattEbha: `${P}fcs_batt_ebha`, // BATTERIES FCS EBHA: 1 ON (clear guard); amber ON lamp when it powers the EBHA bus (no AC)
  fcsBattUps: `${P}fcs_batt_ups`, // BATTERIES FCS UPS: 1 ON (clear guard); amber ON lamp when it powers the FCC UPS bus (no AC)
  engStartBtn: `${P}eng_start_btn`, // ENGINE START push-button (round, momentary 1): AutoStart of every engine whose FUEL CONTROL is at RUN
  fireApuDisch: `${P}fire_apu_disch`, // APU FIRE EXT (red-hatched guard, momentary 1): discharges the LEFT bottle into the APU (Disch 2)
  // ELECTRICAL POWER CONTROL
  ratGen: `${P}rat_gen`, // RAT GEN (clear guard): 1 AUTO (RAT generator may take the EMER AC bus), 0 OFF
  elecReset: `${P}elec_reset`, // AC / DC RESET, momentary 1: one reset of tripped generator control units per flight
  busTieL: `${P}bus_tie_l`, // L BUS TIE: 1 AUTO, 0 OPEN (blue AUTO legend); both AUTO = busTie AUTO
  busTieR: `${P}bus_tie_r`,
  // DOORS
  doorOpenCmd: `${P}door_open_cmd`, // DOORS OPEN (clear guard, alternate action): 1 open the main airstair door, 0 close
  doorSafety: `${P}door_safety`, // DOORS SAFETY: 1 ON (amber) = door actuation locked out
  // ENGINE CONTROL
  engAlt: (i: 1 | 2) => `${P}eng_alt${i}`, // L / R ENG: 1 = FADEC alternate (LP / N1) control selected (blue CAS "Engine ALT Control")
  // CABIN PRESSURE CONTROL: FAULT/MANUAL writes pressMode 0 AUTO / 2 MANUAL; CABIN ALT rotary writes pressManual (-1/0/+1, spring to HOLD)
  // Glareshield pod ends
  warnInhibit: `${P}warn_inhibit`, // WARN INHIBIT (L or R): 1 = nuisance CAS cautions held back during the takeoff roll (EST)
  // GS INHIBIT (L / R): event 'taws.gs_cancel'
  // Pedestal
  altTrimA: `${P}alt_trim_a`, // PITCH TRIM split switch, left half: +1 NOSE UP, -1 NOSE DN, spring to 0
  altTrimB: `${P}alt_trim_b`, // right half (both halves must move for trim)
  altTrimCmd: `${P}alt_trim_cmd`, // derived: both halves agree (to the FBW trim input)
  // Left side ledge
  pedalSteer: `${P}pedal_steer`, // PEDAL STEER switchlight: 1 ON, 0 OFF (amber OFF); pedals +/-7 deg only
  pedalSteerCmd: `${P}pedal_steer_cmd`, // derived: pedal input to the steering (0 when PEDAL STEER is OFF)
  // HUD (left headliner HUD control panel and combiner, pilot side)
  hudStow: `${P}hud_deploy`, // combiner: 1 deployed, 0 stowed
  hudBrt: `${P}hud_brt`, // HUD BRT knob 0..1 (MAN)
  hudAuto: `${P}hud_auto`, // MAN / AUTO: 1 AUTO (brightness follows ambient light)
  hudContr: `${P}hud_contr`, // CONTR knob 0..1 (symbology contrast against the video)
  hudVideoBrt: `${P}hud_video_brt`, // VIDEO BRT knob 0..1 (EVS / CVS video)
  hudOn: `${P}hud_on`, // derived: HUD powered and combiner deployed
  hudLum: `${P}hud_lum`, // derived: symbology luminance 0..1
  hudVideo: `${P}hud_video`, // derived: video luminance 0..1 (0 when no EVS/CVS selected)
  // Cabin / flight deck (state only)
  visor: (s: 1 | 2) => `${P}visor${s}`, // sun visor: 0 stowed, 1 down (SCOPE: no glare model)
  table: (s: 1 | 2) => `${P}table${s}`, // pull-out meal / desk table: 0 stowed, 1 out (SCOPE: state and animation only)
  armTilt: (s: 1 | 2) => `${P}arm_tilt${s}`, // sidestick armrest TILT ADJ 0..1 (SCOPE: state only)
  pedalAdj: (s: 1 | 2) => `${P}pedal_adj${s}`, // rudder-pedal adjust crank 0 (aft) .. 1 (fwd) (SCOPE: reach state only)
  /** Positions of the slow furniture actuators (systems/furnishings.ts): `${var}_pos` 0..1. */
  sfdMenuEvent: (s: 1 | 2) => `g800.sfd.menu${s}`, // SFD bezel MENU button event (systems/sfdMenu.ts opens the SFD baro menu)
  obsMask: `${P}oxy_mask3`, // observer (jump seat) quick-donning mask: 0 stowed, 1 donned (G500 BL7C0670 right aft bulkhead)
  obsMaskMode: `${P}oxy_mode3`, // observer mask regulator: 0 NORMAL, 1 100 %, 2 EMERGENCY
} as const;

/** Autobrake selector values. */
export const AUTOBRAKE = { RTO: -1, OFF: 0, LOW: 1, MED: 2, HIGH: 3 } as const;
