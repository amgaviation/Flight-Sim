/**
 * Gulfstream G650 cockpit-control and aircraft-specific vars: the contract
 * between the cockpit build (src/aircraft/g650/cockpit, another agent), the
 * systems (systems/**) and the initial states (states.ts).
 *
 * Overhead controls that the Honeywell Epic suite already names
 * (`GULFSTREAM_OVERHEAD_VARS`, src/avionics/honeywell-epic/logic/overhead.ts)
 * keep those names so `addOverheadSwitches` / the synoptics and the systems
 * agree; everything else uses the `ac.g650.` prefix. Positions follow the
 * control inventory of docs/aircraft/g650.md (panel by panel).
 *
 * Conventions: 2-position switchlights 0 = OFF / 1 = ON (normal) unless
 * stated; rotary knobs use the listed integers; momentary controls write 1
 * while held and 0 on release (spring-loaded); guarded controls have a
 * `...Guard` var (0 closed, 1 open) where the cockpit models the guard.
 */
const P = 'ac.g650.';

export const G650_VARS = {
  // ======================================================== OVERHEAD
  // ---- ELECTRICAL POWER CONTROL panel (LUC electrical p.51)
  battL: 'ac.elec.batt_l_sw', // MAIN BATTERIES LEFT switchlight: 1 ON, 0 OFF
  battR: 'ac.elec.batt_r_sw', // MAIN BATTERIES RIGHT
  genL: 'ac.elec.gen_l_sw', // L GEN: 1 ON (green), 0 OFF (amber); OFF -> ON cycles the GCU (reset)
  genR: 'ac.elec.gen_r_sw',
  apuGen: 'ac.elec.apu_gen_sw', // APU GEN: 1 ON, 0 OFF
  extPwr: 'ac.elec.gpu_sw', // EXT PWR: 1 ON (AVAIL lit when a cart is connected)
  busTieL: 'ac.elec.bus_tie_sw', // L BUS TIE: 1 AUTO (blue legend), 0 ISLN
  busTieR: `${P}elec.bus_tie_r_sw`, // R BUS TIE: 1 AUTO, 0 ISLN
  gsb: `${P}elec.gsb_sw`, // GND SVC BUS: 1 ON, 0 off
  elecReset: `${P}elec.reset_btn`, // RESET (AC/DC): momentary 1
  // ---- L/R MAIN TRU (LUC: pressed -> fed from the opposite main AC bus, "R AC"/"L AC" legend)
  lMainTru: 'ac.elec.l_main_tru_sw', // 1 NORM (L MAIN AC), 0 "R AC" (fed from R MAIN AC)
  rMainTru: 'ac.elec.r_main_tru_sw', // 1 NORM, 0 "L AC"
  // ---- EMERGENCY POWER / RAT / FLT CTRL BATTERIES / masters
  emerPwr: 'ac.elec.emer_pwr_sw', // EMERGENCY POWER: 0 OFF, 1 ARM, 2 ON
  ratDeploy: 'ac.elec.rat_deploy', // RAT deploy T-handle (twist & pull, guarded): 1 deployed (cannot be stowed in flight)
  ratGen: `${P}elec.rat_gen_sw`, // RAT GEN: 1 ON, 0 OFF (LUC: OFF before deploy, ON after 30 s)
  ebhaBatt: `${P}elec.ebha_batt_sw`, // FLT CTRL BATTERIES EBHA: 1 ON (normal), 0 OFF
  upsBatt: `${P}elec.ups_batt_sw`, // FLT CTRL BATTERIES UPS: 1 ON, 0 OFF
  cabinMaster: 'ac.elec.cabin_master_sw', // CABIN MASTER: 1 ON
  galleyMaster: 'ac.elec.galley_master_sw', // GALLEY MASTER: 1 ON
  gpuAvail: `${P}elec.gpu_avail`, // ramp: external AC cart connected (service menu / states)

  // ---- APU CONTROL panel (LUC apu)
  apuMaster: 'ac.apu.master_sw', // MASTER: 1 ON (blue)
  apuStart: 'ac.apu.start_btn', // START: momentary 1
  apuStop: `${P}apu.stop_btn`, // STOP: momentary 1
  apuFireExt: `${P}fire.apu_disch_btn`, // APU FIRE EXT (guarded, red): momentary 1 = discharge LEFT bottle into the APU
  apuFireExtGuard: `${P}fire.apu_disch_guard`,
  apuFireTest: `${P}fire.apu_test_btn`, // APU (fire) TEST: momentary 1

  // ---- FUEL panel (LUC fuel)
  boostL: 'ac.fuel.boost_l_sw', // L MAIN pump (L ESS DC): 0 OFF, >= 1 ON (Epic touch pages offer AUTO = ON on the G650)
  boostR: 'ac.fuel.boost_r_sw',
  altL: 'ac.fuel.alt_l_sw', // L ALT pump (L MAIN DC): 0 OFF, 1 ON
  altR: 'ac.fuel.alt_r_sw',
  xflow: 'ac.fuel.xflow_sw', // X-FLOW: 0 CLOSED, 1 OPEN
  interTank: `${P}fuel.intertank_sw`, // INTER TANK: 0 CLOSED, 1 OPEN
  fuelReturn: 'ac.fuel.hfr_sw', // FUEL RETURN (heated fuel return): 0 OFF, 1 AUTO (2 = AUTO)

  // ---- HYDRAULICS (LUC hyd): two switchlights per pump, OFF/ARM and ON
  auxPump: 'ac.hyd.aux_pump_sw', // AUX PUMP: 0 OFF, 1 ARM, 2 ON
  ptu: 'ac.hyd.ptu_sw', // PWR XFR UNIT: 0 OFF, 1 ARM, 2 ON

  // ---- BLEED AIR (LUC pneu)
  bleedL: 'ac.bleed.l_sw', // L ENG: 1 ON, 0 OFF (amber)
  bleedR: 'ac.bleed.r_sw',
  bleedApu: 'ac.bleed.apu_sw', // APU: 1 ON (blue), 0 OFF
  isolation: 'ac.bleed.iso_sw', // ISOLATION: 1 AUTO, 2 OPEN, 0 CLOSED

  // ---- TEMP CONTROL (LUC air conditioning)
  packL: 'ac.ecs.pack_l_sw', // L PACK: 1 ON, 0 OFF (amber)
  packR: 'ac.ecs.pack_r_sw',
  ramAir: 'ac.ecs.ram_air_sw', // RAM AIR (guarded): 1 ON (RAM amber)
  zoneTemp: (z: 1 | 2 | 3) => `ac.ecs.zone${z}_temp_c`, // COLD/HOT knob: 1 cockpit, 2 fwd cabin, 3 aft cabin (16..30 degC)
  zoneMan: (z: 1 | 2 | 3) => `${P}ecs.zone${z}_man_sw`, // AUTO/MAN: 0 AUTO, 1 MAN (knob then commands the supply temperature)
  // TEMP DISPLAY row (G650ER overhead photograph: a "TEMP DISPLAY" row beside the TEMP CONTROL zone knobs;
  // EST legends): selects the zone whose measured temperature the readout shows (0 CKPT, 1 FWD, 2 AFT).
  tempDispSel: `${P}ecs.temp_disp_sel`,
  tempDispC: `${P}ecs.temp_disp_c`, // derived by systems/environment.ts: selected zone temperature (degC)

  // ---- CABIN PRESSURE CONTROL (LUC press)
  pressMode: 'ac.press.mode_sw', // AUTO/SEMI + FAULT/MANUAL: 0 AUTO, 1 SEMI, 2 MANUAL
  ldgElevFt: 'ac.press.ldg_elev_ft', // landing field elevation (SMC entry in SEMI; -9999 = FMS destination)
  manHold: 'ac.press.manual_cmd', // MAN HOLD knob: -1 DESCEND .. 0 HOLD .. +1 CLIMB (outflow valve rate)
  pressDump: 'ac.press.dump_sw', // DUMP (guarded): 1 DUMP
  fltLdg: `${P}press.flt_ldg_sw`, // FLIGHT/LANDING: 0 FLIGHT, 1 LANDING

  // ---- ANTI-ICE (LUC ice: four rotary knobs L WING, L COWL, R COWL, R WING: OFF / AUTO / ON)
  wingL: 'ac.ice.wing_l_sw',
  wingR: 'ac.ice.wing_r_sw',
  cowlL: 'ac.ice.cowl_l_sw',
  cowlR: 'ac.ice.cowl_r_sw',
  probe: (n: 1 | 2 | 3 | 4) => `${P}ice.probe${n}_sw`, // ANTI-ICE HTR AIR DATA probe 1..4: 1 ON (normal), 0 OFF (amber)
  wshldL: 'ac.ice.wshld_l_sw', // L WSHLD HEAT: 1 ON
  wshldR: 'ac.ice.wshld_r_sw',
  cabinWdo: 'ac.ice.cabin_wdo_sw', // CABIN WDO HEAT: 1 ON
  evsWdo: 'ac.ice.evs_wdo_sw', // EVS WDO HEAT: 1 ON

  // ---- ENGINE START (LUC powerplant)
  startMaster: 'ac.eng.start_master_sw', // START MASTER: 1 ON (arms auto start, opens isolation, packs off)
  crankMaster: 'ac.eng.crank_master_sw', // CRANK MASTER: 1 ON (dry motoring / alternate start)
  startL: 'ac.eng.start_l_btn', // L ENG (start) switchlight: momentary 1
  startR: 'ac.eng.start_r_btn',
  contIgn: 'ac.eng.ign_sw', // CONT IGN: 1 ON (blue)

  // ---- SYSTEM TEST block (overhead systems panel aft-left; G650ER overhead photograph, Flickr jeffatchison
  // 52948516166: a labelled "SYSTEM TEST" block of square test switchlights with adjacent DOOR and
  // LDG GEAR / DUMP VLV items). Legends of the individual keys are not readable in the photograph: the keys
  // model the testable systems the sim has (EST selection). Momentary 1 while held; logic.ts runs the test
  // and writes the `sysTestPass` result lamps while the tested system is powered.
  sysTest: (k: SystemTestKey) => `${P}test.${k}_btn`,
  sysTestPass: (k: SystemTestKey) => `${P}test.${k}_pass`, // derived by logic.ts: 1 while the test passes

  // ---- ENGINE FIRE TEST (LUC fire)
  fireTestLA: `${P}fire.test_l_a`, // L ENG LOOP A test: momentary
  fireTestLB: `${P}fire.test_l_b`,
  fireTestRA: `${P}fire.test_r_a`,
  fireTestRB: `${P}fire.test_r_b`,
  fireFaultTest: `${P}fire.fault_test`, // FAULT TEST: momentary

  // ---- OXYGEN SYSTEM panel (LUC oxy)
  crewOxy: 'ac.oxy.crew_sw', // crew supply: 1 ON
  paxOxy: 'ac.oxy.pax_sw', // PASSENGER OXYGEN rotary: 0 OFF, 1 AUTO, 2 MAN
  paxShutoff: `${P}oxy.pass_shutoff`, // PASS OXYGEN shutoff: 1 ON (open), 0 OFF
  oxyMaskL: `${P}oxy.mask_l`, // pilot quick-donning mask out of its stowage (EROS MLD 20, LUC): 1 in use
  oxyMaskR: `${P}oxy.mask_r`,
  /** @deprecated kept for compatibility; each EROS mask has its own regulator: use oxyMaskModeL / oxyMaskModeR. */
  oxyMaskMode: `${P}oxy.mask_mode`, // mask regulator: 0 N (diluter), 1 100 %, 2 EMERGENCY
  // Each EROS mask has its own N / 100 % / EMERGENCY regulator (LUC oxygen): one mode var per crew mask.
  oxyMaskModeL: `${P}oxy.mask_mode_l`, // pilot mask regulator: 0 N (diluter), 1 100 %, 2 EMERGENCY
  oxyMaskModeR: `${P}oxy.mask_mode_r`,

  // ---- EXTERIOR / INTERIOR LIGHTS (overhead)
  ltNav: 'ac.light.nav_sw',
  ltBeacon: 'ac.light.beacon_sw',
  ltStrobe: 'ac.light.strobe_sw', // ANTI-COLL (white strobes)
  ltLdgL: 'ac.light.landing_l_sw',
  ltLdgR: 'ac.light.landing_r_sw',
  ltTaxi: 'ac.light.taxi_sw',
  ltRecog: 'ac.light.recog_sw',
  ltLogo: 'ac.light.logo_sw',
  ltWing: 'ac.light.wing_sw', // WING INSP
  ltEmer: 'ac.light.emer_sw', // EMER LTS: 0 OFF, 1 ARM, 2 ON
  seatBelt: 'ac.cabin.seatbelt_sw', // SEAT BELT: 1 ON
  noSmoke: 'ac.cabin.nosmoke_sw', // NO SMOKE: 1 ON
  ltPanel: 'ac.light.panel_knob', // PANEL (integral) 0..1
  ltFlood: 'ac.light.flood_knob', // FLOOD 0..1
  ltDome: 'ac.light.dome_sw', // DOME: 1 ON
  ltMapL: `${P}light.map_l`, // pilot map light knob 0..1 (side console)
  ltMapR: `${P}light.map_r`,
  duBrt: (n: 1 | 2 | 3 | 4) => `${P}light.du${n}_brt`, // DU brightness knobs 0..1 (glareshield outboard / inboard)
  // COCKPIT LIGHTS MASTER CONTROL knob (G650 training material: "rotated from OFF to the nighttime setting,
  // annunciator lights dim and panel backlighting illuminates"; "full clockwise rotation brings all annunciator
  // lights to full bright; further rotation to ORIDE illuminates the cockpit overhead dome light and side
  // console floodlights"): 0 OFF (day) .. 1 full bright; >= 1.1 ORIDE.
  ltMaster: `${P}light.master`,
  // VEST LTS ORIDE switchlight (side console; training material: "alternate means for turning off the vestibule
  // or companionway lights ... blue ON"): 1 = vestibule lights forced off.
  vestOride: `${P}light.vest_oride`,
  /** Lighting system output: 1 = annunciators full bright, 0 = dimmed (night range of MASTER CONTROL). */
  annunBright: `${P}light.annun_bright`,

  // ======================================================== PEDESTAL / GLARESHIELD / YOKES
  tla: (i: number) => `ac.tla${i}`, // thrust lever 0 IDLE .. 1 MAX (TO/GA); -1..0 reverse (reverser levers lifted)
  fuelCtlL: `${P}eng.fuel_ctl_l`, // FUEL CONTROL L: 1 RUN, 0 OFF (lever-lock)
  fuelCtlR: `${P}eng.fuel_ctl_r`,
  fireHandleL: `${P}fire.handle_l`, // L ENG FIRE handle: 0 stowed, 1 pulled
  fireHandleR: `${P}fire.handle_r`,
  fireDischL: `${P}fire.disch_l`, // handle rotation (spring-loaded): -1 inward = shot 2 (LEFT bottle), +1 outward = shot 1 (RIGHT bottle)
  fireDischR: `${P}fire.disch_r`,
  flapLever: `${P}flap_lever`, // 0 UP, 1 10, 2 TO/20, 3 DOWN (39)
  speedbrake: `${P}speedbrake`, // speed brake handle 0 RET .. 1 EXT (30 deg in flight)
  gndSpoiler: `${P}fc.gnd_spoiler_sw`, // GND SPOILER: 1 ARMED (blue), 0 OFF
  flapOride: `${P}fc.flap_oride_sw`, // GPWS / GND SPLR FLAP ORIDE: 1 ON
  fltCtrlReset: `${P}fc.reset_btn`, // FLT CTRL RESET: momentary 1
  backupPitch: `${P}fc.backup_pitch_sw`, // BACKUP PITCH trim (guarded, split): momentary -1 NOSE DN / +1 NOSE UP
  rollMotor: `${P}fc.roll_motor_sw`, // ROLL MOTOR CONTROL: 1 ON (normal), 0 OFF
  autoCenter: `${P}fc.auto_center_btn`, // AUTO CENTER (rudder trim to neutral): momentary 1
  ailTrimSw: `${P}trim.ail_sw`, // AILERON TRIM: momentary -1 L WING DN / +1 R WING DN
  rudTrimSw: `${P}trim.rud_sw`, // RUDDER TRIM: momentary -1 NOSE L / +1 NOSE R
  pitchTrimYoke: 'input.pitch_trim_rate', // yoke pitch trim (FBW: moves the reference speed in the air)
  gearHandle: `${P}gear_handle`, // 1 DN, 0 UP
  gearEmer: `${P}gear.emer_handle`, // EMER LDG GEAR T-handle: 1 pulled (N2 blowdown, one shot)
  gearLockRelease: `${P}gear.lock_release`, // LOCK RELEASE: momentary 1 (overrides the down-lock solenoid)
  parkBrake: `${P}park_brake`, // PARKING BRAKE handle 0 stowed .. 1 set (also emergency braking, proportional)
  autobrake: `${P}autobrake`, // AUTOBRAKE rotary: -1 RTO, 0 OFF, 1 LOW, 2 MED, 3 HIGH
  nwsPower: `${P}nws_sw`, // NWS POWER (guarded, red): 1 ON, 0 OFF
  terrInhibit: `${P}taws.terr_inhibit`, // TERRAIN INHIBIT: 1 ON
  // SCOPE: GPWS INHIBIT is a TAWS input / state var without a cockpit switch. The photographed G650
  // pedestal tilt panel carries TERRAIN INHIBIT, RAAS INHIBIT and GPWS / GND SPLR FLAP ORIDE (pedestal.ts);
  // no public photo shows a discrete basic-GPWS inhibit switch, so the var is settable from states /
  // failures only until a tilt-panel photo settles the full switch set (dossier §9.8).
  gpwsInhibit: `${P}taws.gpws_inhibit`,
  tiller: 'input.tiller',
  // ---- added by the check-ride review (G650ER pedestal / lower centre panel photographs, Flickr jeffatchison
  // 52948656184 / 52948654839; SmartCockpit G650 avionics quiz: "IRS Mode Select panel", amber "ON BAT")
  irsMode: (n: 1 | 2 | 3) => `${P}irs${n}_mode`, // IRS MODE SELECT switchlight IRS n: 2 ON (NAV, aligns on power-up), 0 OFF
  raasInhibit: `${P}taws.raas_inhibit`, // RAAS INHIBIT (pedestal): 1 = runway awareness callouts inhibited
  cockpitCall: (k: CockpitCallKey) => `${P}call.${k}_btn`, // COCKPIT CALL panel buttons (pedestal): momentary / toggle 1
  // Derived by systems/audio.ts (cabin interphone): latched call from the cockpit, privacy modes.
  cabinCall: `${P}call.cabin_chime`, // 1 = cockpit call to the cabin chimed, until RESET
  privacy: `${P}call.privacy_on`, // cockpit PRIVACY (cabin cannot listen in on the flight-deck interphone)
  aftPrivacy: `${P}call.aft_privacy_on`, // AFT (cabin) PRIVACY

  // ======================================================== DOORS / RAMP (exterior + cabin agents)
  doorMain: 'ac.door.main', // 0 closed .. 1 open
  doorBaggage: 'ac.door.baggage', // internal baggage door
  doorExtBaggage: 'ac.door.ext_baggage',
  // Flight-deck divider door on the aft bulkhead (cabin photographs show a cockpit divider/door; the lock
  // switch and its logic are EST - no public lock-panel source found, dossier §13).
  doorCockpit: `${P}door.cockpit`, // 0 closed .. 1 open (animated door leaf)
  doorLockSw: `${P}door.lock_sw`, // cockpit door LOCK switch (pedestal/side console, EST): 1 LOCKED
  doorLocked: `${P}door.locked`, // derived (systems/audio.ts): door closed and lock commanded

  // ======================================================== DERIVED (written by systems/logic.ts)
  lBtbCmd: `${P}elec.l_btb_cmd`,
  rBtbCmd: `${P}elec.r_btb_cmd`,
  extCmd: `${P}elec.ext_cmd`,
  emerFeedCmd: `${P}elec.emer_feed_cmd`,
  ratMode: `${P}elec.rat_mode`,
  auxSubst: `${P}elec.aux_subst`, // 0 AUX DC, 1 L ESS, 2 R ESS, 3 L MAIN, 4 R MAIN
  ebattOn: `${P}elec.ebatt_on`, // emergency batteries powering the emergency buses
  ratDrive: `${P}elec.rat_drive`,
  gpuAvailOut: `${P}elec.gpu_avail_out`,
  auxPumpCmd: `${P}hyd.aux_cmd`,
  ptuCmd: `${P}hyd.ptu_cmd`,
  isoCmd: `${P}bleed.iso_cmd`,
  apuBleedReady: `${P}apu.bleed_ready`,
  packLCmd: `${P}ecs.pack_l_cmd`,
  packRCmd: `${P}ecs.pack_r_cmd`,
  waiCmd: (s: 'l' | 'r') => `${P}ice.wai_${s}_cmd`,
  caiCmd: (s: 'l' | 'r') => `${P}ice.cai_${s}_cmd`,
  wshldOn: (s: 'l' | 'r') => `${P}ice.wshld_${s}_on`,
  probeHeatOn: (n: 1 | 2 | 3 | 4) => `${P}ice.probe${n}_on`,
  iceAutoInhibit: `${P}ice.auto_inhibit`,
  sbCmd: `${P}sb_cmd`, // speed brake command after auto-retract
  sbAutoRetract: `${P}sb_auto_retract`,
  gsArmed: `${P}gs_armed`, // ground spoilers armed (switch ARMED, not BFCU/DIRECT)
  idleBoth: `${P}idle_both`,
  idleAny: `${P}idle_any`,
  toThrust: `${P}to_thrust`,
  tlaEff: (i: number) => `${P}tla_eff${i}`,
  fcModeSel: `${P}fc.mode_sel`, // FBW mode selection latch: 0 auto, 1 ALTERNATE latched (FLT CTRL RESET clears)
  fcsBatt: `${P}fc.batt_on`, // flight-control batteries discharging
  yokeRollTrim: `${P}fc.yoke_roll_trim`, // yoke back-drive by the roll trim motor (0 with ROLL MOTOR CONTROL OFF), for the cockpit
  starterCmd: (i: number) => `fadec.eng${i}.starter_cmd`,
  crankLatch: (i: number) => `${P}eng${i}_crank`, // L/R ENG switchlight latched ON with CRANK MASTER (logic.ts)
  engFail: (i: number) => `${P}eng${i}_fail`,
  hfrsOn: (i: number) => `${P}fuel.hfrs${i}_on`,
  noTakeoff: `${P}no_takeoff`,
  aircraftConfig: `${P}aircraft_config`, // speed brake with flaps 39 / gear down in flight
  raasActive: `${P}taws.raas_active`, // RAAS available (TAWS powered, not inhibited)
  fmsCruise: `${P}fms_cruise`, // airborne in the FMS cruise phase (VNAV CRZ): automatic CRZ thrust rating (engines.ts)
  // ---- added by fix round 1 (function lens)
  parkSetCmd: `${P}park_set_cmd`, // logic.ts: PARK BRAKE handle near full travel (~>= 0.9) = parking brake SET
  accumInbdPsi: `${P}brakes.accum_inbd_psi`, // inboard brake accumulator (charged from the LEFT system, LUC)
  accumOutbdPsi: `${P}brakes.accum_outbd_psi`, // outboard brake accumulator (RIGHT system)
  eprMode: (i: number) => `${P}eng${i}_epr_mode`, // BR725 EEC thrust-setting mode: 1 EPR (primary), 0 N1 "ALT" (reversion)
  edm: `${P}press.edm`, // Emergency Descent Mode latched (high cabin altitude, no crew response)
  raasCallout: `${P}taws.raas_callout`, // string: last RAAS callout ('' when none)
  raasOnRunway: `${P}taws.raas_on_rwy`, // 1 while RAAS considers the aircraft on a runway
  // ---- added by fix round 1 (procedures lens)
  // Fire tests seen this power cycle (logic.ts latches; checklists.ts "TESTED" auto-checks, code450
  // Before Starting Engines fire-test items and APU Start Checklist item 6): 'l' / 'r' engine loop tests,
  // 'apu' APU detector test, 'fault' FAULT TEST. Cleared when the detection system loses power.
  fireTested: (k: 'l' | 'r' | 'apu' | 'fault') => `${P}fire.tested_${k}`,

  // ======================================================== YOKE / TILLER (added with the cockpit build)
  // The app's input module rewrites input.pitch_trim_rate / input.ap_disc / input.tiller every frame, so the
  // 3D yoke switches and the tiller handle write their own vars; systems/cockpitInputs.ts merges them.
  yokeTrimL: `${P}fc.yoke_trim_l`, // pilot yoke split pitch-trim switch: momentary +1 NOSE UP / -1 NOSE DN
  yokeTrimR: `${P}fc.yoke_trim_r`, // copilot yoke
  yokeDiscL: `${P}fc.yoke_disc_l`, // AP / TRIM DISC button (outboard yoke horn): momentary 1
  yokeDiscR: `${P}fc.yoke_disc_r`,
  tiller3d: `${P}tiller_3d`, // pilot side-console tiller handle -1..1 (+ right)
  // Derived by systems/cockpitInputs.ts
  yokeTrimCmd: `${P}fc.yoke_trim_cmd`, // merged yoke trim switch (pilot priority), read by the FBW as a trim switch
  discHeld: `${P}fc.disc_held`, // an AP/TRIM DISC button held: yoke trim interrupted
  tillerCmd: `${P}tiller_cmd`, // hardware tiller axis or the 3D handle, whichever is deflected more

  // ======================================================== AUDIO CONTROL PANELS (side consoles; added with the overhead / side build)
  // SCOPE: systems/audio.ts tracks the selections (no radio audio is synthesised by the app).
  acpMic: (n: 1 | 2) => `${P}acp${n}.mic`, // transmitter select: 1 VHF 1, 2 VHF 2, 3 VHF 3, 4 HF 1, 5 HF 2, 6 PA
  acpVol: (n: 1 | 2, ch: AcpChannel) => `${P}acp${n}.vol_${ch}`, // receiver volume 0..1
  // Derived by systems/audio.ts
  acpTx: (n: 1 | 2) => `${P}acp${n}.tx`, // selected transmitter while the ACP is powered (0 = none)
  acpRx: (n: 1 | 2, ch: AcpChannel) => `${P}acp${n}.rx_${ch}`, // receiver audio level (volume x ACP and receiver power)
  // Yoke MIC / INT rocker (added with the main cockpit build): +1 MIC (key the selected transmitter), 0 off, -1 INT.
  acpPtt: (n: 1 | 2) => `${P}acp${n}.ptt`,
  // Derived by systems/audio.ts: transmitter being keyed (1..6 as acpMic) while MIC is held, -1 intercom, 0 none.
  acpKeyed: (n: 1 | 2) => `${P}acp${n}.keyed`,
} as const;

/** ACP receiver channels (EST Primus Epic ACP layout: VHF 1-3, NAV 1-2, ADF, MKR). */
export const ACP_CHANNELS = ['vhf1', 'vhf2', 'vhf3', 'nav1', 'nav2', 'adf', 'mkr'] as const;
export type AcpChannel = (typeof ACP_CHANNELS)[number];
/** COCKPIT CALL panel buttons (pedestal, G650ER photograph: CREW, RESET, PRIVACY, AFT PRIVACY). */
export type CockpitCallKey = 'crew' | 'reset' | 'privacy' | 'aft_privacy';
/** SYSTEM TEST block keys (overhead; EST selection: the testable systems modelled). */
export type SystemTestKey = 'stall' | 'gpws' | 'antiskid' | 'ice_det';
export const SYSTEM_TEST_KEYS: SystemTestKey[] = ['stall', 'gpws', 'antiskid', 'ice_det'];

/** Every cockpit control var (inputs), for the "every control is consumed" audit test. */
export const G650_CONTROL_VARS: string[] = [
  G650_VARS.battL, G650_VARS.battR, G650_VARS.genL, G650_VARS.genR, G650_VARS.apuGen, G650_VARS.extPwr,
  G650_VARS.busTieL, G650_VARS.busTieR, G650_VARS.gsb, G650_VARS.elecReset, G650_VARS.lMainTru, G650_VARS.rMainTru,
  G650_VARS.emerPwr, G650_VARS.ratDeploy, G650_VARS.ratGen, G650_VARS.ebhaBatt, G650_VARS.upsBatt,
  G650_VARS.cabinMaster, G650_VARS.galleyMaster,
  G650_VARS.apuMaster, G650_VARS.apuStart, G650_VARS.apuStop, G650_VARS.apuFireExt, G650_VARS.apuFireTest,
  G650_VARS.boostL, G650_VARS.boostR, G650_VARS.altL, G650_VARS.altR, G650_VARS.xflow, G650_VARS.interTank, G650_VARS.fuelReturn,
  G650_VARS.auxPump, G650_VARS.ptu,
  G650_VARS.bleedL, G650_VARS.bleedR, G650_VARS.bleedApu, G650_VARS.isolation,
  G650_VARS.packL, G650_VARS.packR, G650_VARS.ramAir, G650_VARS.zoneTemp(1), G650_VARS.zoneTemp(2), G650_VARS.zoneTemp(3),
  G650_VARS.zoneMan(1), G650_VARS.zoneMan(2), G650_VARS.zoneMan(3),
  G650_VARS.pressMode, G650_VARS.ldgElevFt, G650_VARS.manHold, G650_VARS.pressDump, G650_VARS.fltLdg,
  G650_VARS.wingL, G650_VARS.wingR, G650_VARS.cowlL, G650_VARS.cowlR,
  G650_VARS.probe(1), G650_VARS.probe(2), G650_VARS.probe(3), G650_VARS.probe(4),
  G650_VARS.wshldL, G650_VARS.wshldR, G650_VARS.cabinWdo, G650_VARS.evsWdo,
  G650_VARS.startMaster, G650_VARS.crankMaster, G650_VARS.startL, G650_VARS.startR, G650_VARS.contIgn,
  G650_VARS.fireTestLA, G650_VARS.fireTestLB, G650_VARS.fireTestRA, G650_VARS.fireTestRB, G650_VARS.fireFaultTest,
  G650_VARS.sysTest('stall'), G650_VARS.sysTest('gpws'), G650_VARS.sysTest('antiskid'), G650_VARS.sysTest('ice_det'),
  G650_VARS.tempDispSel,
  G650_VARS.crewOxy, G650_VARS.paxOxy, G650_VARS.paxShutoff, G650_VARS.oxyMaskL, G650_VARS.oxyMaskR,
  G650_VARS.oxyMaskModeL, G650_VARS.oxyMaskModeR,
  G650_VARS.ltNav, G650_VARS.ltBeacon, G650_VARS.ltStrobe, G650_VARS.ltLdgL, G650_VARS.ltLdgR, G650_VARS.ltTaxi, G650_VARS.ltRecog,
  G650_VARS.ltLogo, G650_VARS.ltWing, G650_VARS.ltEmer, G650_VARS.seatBelt, G650_VARS.noSmoke, G650_VARS.ltPanel, G650_VARS.ltFlood,
  G650_VARS.ltDome, G650_VARS.ltMaster, G650_VARS.vestOride, G650_VARS.ltMapL, G650_VARS.ltMapR, G650_VARS.duBrt(1), G650_VARS.duBrt(2), G650_VARS.duBrt(3), G650_VARS.duBrt(4),
  G650_VARS.tla(1), G650_VARS.tla(2), G650_VARS.fuelCtlL, G650_VARS.fuelCtlR,
  G650_VARS.fireHandleL, G650_VARS.fireHandleR, G650_VARS.fireDischL, G650_VARS.fireDischR,
  G650_VARS.flapLever, G650_VARS.speedbrake, G650_VARS.gndSpoiler, G650_VARS.flapOride, G650_VARS.fltCtrlReset,
  G650_VARS.backupPitch, G650_VARS.rollMotor, G650_VARS.autoCenter, G650_VARS.ailTrimSw, G650_VARS.rudTrimSw,
  G650_VARS.gearHandle, G650_VARS.gearEmer, G650_VARS.gearLockRelease, G650_VARS.parkBrake, G650_VARS.autobrake, G650_VARS.nwsPower,
  G650_VARS.terrInhibit, G650_VARS.gpwsInhibit, G650_VARS.raasInhibit,
  G650_VARS.irsMode(1), G650_VARS.irsMode(2), G650_VARS.irsMode(3),
  G650_VARS.cockpitCall('crew'), G650_VARS.cockpitCall('reset'), G650_VARS.cockpitCall('privacy'), G650_VARS.cockpitCall('aft_privacy'),
  G650_VARS.doorMain, G650_VARS.doorBaggage, G650_VARS.doorExtBaggage, G650_VARS.doorCockpit, G650_VARS.doorLockSw,
  G650_VARS.yokeTrimL, G650_VARS.yokeTrimR, G650_VARS.yokeDiscL, G650_VARS.yokeDiscR, G650_VARS.tiller3d,
];

/** Events emitted by cockpit buttons (momentary commands). */
export const G650_EVENTS = {
  masterWarning: 'cas.ack_warning', // MASTER WARNING switchlights (glareshield, both sides)
  masterCaution: 'cas.ack_caution', // MASTER CAUTION switchlights
  hornSilence: 'gear.horn_silence', // HORN SILENCE button (gear panel)
  atDisc: 'at.disc', // A/T disconnect buttons (outboard of each thrust lever)
  atEngage: 'at.engage', // guidance panel A/T button (via the Epic GP)
  tawsTest: 'taws.test',
  tawsGsCancel: 'taws.gs_cancel',
} as const;

/**
 * Epic overhead controls that the G650 does not have, or models with its own
 * vars (passed as `overheadVars` to the suite): engine-driven pump switches
 * (the G650 EDPs are isolated by the fire handles only, LUC hyd), the single
 * PROBE HEAT switch (four ANTI-ICE HTR switchlights instead), auto refuel
 * (refuel panel, outside the cockpit: SCOPE).
 */
export const G650_OVERHEAD_OVERRIDES: Readonly<Record<string, string | null>> = {
  'hyd.edp_l': null,
  'hyd.edp_r': null,
  'ice.probes': null,
  'fuel.auto_refuel': null,
  'ecs.zone4': null,
};
