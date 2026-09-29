/**
 * Citation Longitude cockpit-control and aircraft-specific vars (the contract
 * between the cockpit build, the systems and the initial states). Every var
 * here is written by exactly one cockpit control (or the GTC system pages)
 * and read by a system in systems/**. Positions and meaning follow the
 * control inventory in docs/aircraft/citation-longitude.md.
 *
 * Conventions: pushbutton "states" are latched values the cockpit
 * PushButton toggles; 3-position switches use the listed integers;
 * momentary positions spring back (the cockpit control writes the resting
 * value on release).
 */
const P = 'ac.lon.';

export const LON_VARS = {
  // ---------------- Electrical (pilot lower sub-panel, OG 5-4..5-7)
  battL: `${P}elec.batt_l`, // BATT L pushbutton: 1 ON (cyan), 0 OFF (amber)
  battR: `${P}elec.batt_r`,
  genL: `${P}elec.gen_l`, // L GEN toggle: 0 OFF, 1 ON, 2 RESET (momentary, springs to OFF)
  genR: `${P}elec.gen_r`,
  genApu: `${P}elec.gen_apu`, // APU GEN toggle: 0 OFF, 1 ON, 2 RESET (momentary)
  busTieBtn: `${P}elec.bus_tie`, // BUS TIE pushbutton: in-air manual request 1 = CLOSED (ignored on the ground: automatic)
  mainL: `${P}elec.main_l`, // L MAIN pushbutton: 1 ON, 0 OFF
  mainR: `${P}elec.main_r`,
  elecL: `${P}elec.elec_l`, // L ELEC pushbutton: 1 ON (mission-emer tied), 0 EMER
  elecR: `${P}elec.elec_r`,
  interior: `${P}elec.interior`, // INTERIOR pushbutton: 1 NORM, 0 OFF
  stbyPwr: `${P}elec.stby_pwr`, // STBY PWR toggle: 0 OFF, 1 ON, 2 TEST (momentary)
  extPwr: `${P}elec.ext_pwr`, // EXT PWR pushbutton: 1 ON (AVAIL lamp when a GPU is connected)
  extPwrAvail: `${P}elec.ext_pwr_avail`, // ground cart connected (ramp service; set by the states / menu)

  // ---------------- Hydraulics (pedestal right of the throttles, OG 13-3..13-5)
  hydPumpA: `${P}hyd.pump_a`, // HYDRAULICS PUMP A: 0 NORM, 1 MIN, 2 SHUTOFF (guarded)
  hydPumpB: `${P}hyd.pump_b`,
  ptcu: `${P}hyd.ptcu`, // PTCU knob: 0 OFF, 1 AUX A, 2 NORM, 3 AUX B, 4 HYD GEN
  rudderStby: `${P}hyd.rudder_stby`, // RUDDER STANDBY pushbutton: 1 NORM, 0 OFF

  // ---------------- Fuel (pedestal right fore; RECIRC under the speedbrake handle, OG 6-3..6-5)
  boostL: `${P}fuel.boost_l`, // L FUEL BOOST PUMP pushbutton: 0 NORM, 1 ON
  boostR: `${P}fuel.boost_r`,
  gravXflow: `${P}fuel.grav_xflow`, // GRAVITY XFLOW pushbutton: 0 CLOSED, 1 OPEN
  fuelTransfer: `${P}fuel.transfer`, // FUEL TRANSFER knob: -1 L TANK, 0 OFF, 1 R TANK
  fuelRecirc: `${P}fuel.recirc`, // FUEL RECIRC pushbutton: 1 NORM, 0 OFF

  // ---------------- Engines (throttle quadrant / pedestal aft of the throttles, OG 7-2..7-6)
  tla: (i: number) => `ac.tla${i}`, // thrust lever 0 IDLE .. 1 TO; -1..0 reverse range (reverser lever lifted)
  runL: `${P}eng.run_l`, // ENGINE RUN/STOP pushbutton (guarded): 1 RUN, 0 STOP
  runR: `${P}eng.run_r`,
  runGuardL: `${P}eng.run_l_guard`, // guard: 0 closed, 1 open
  runGuardR: `${P}eng.run_r_guard`,
  startL: `${P}eng.start_l`, // ENGINE STARTER pushbutton, momentary: 1 while pressed
  startR: `${P}eng.start_r`,

  // ---------------- APU (pedestal aft right, OG 8-2)
  apuKnob: `${P}apu.knob`, // 0 OFF, 1 ON, 2 START (momentary, springs to ON)

  // ---------------- Bleed air (pedestal aft centre, OG 9-3/9-4)
  bleedEngL: `${P}bleed.eng_l`, // L ENG BLD AIR pushbutton: 1 NORM, 0 OFF
  bleedEngR: `${P}bleed.eng_r`,
  bleedApu: `${P}bleed.apu`, // APU BLEED: 1 NORM, 0 OFF
  bleedIsolate: `${P}bleed.isolate`, // BLEED ISOLATE: 0 NORM, 1 XFLOW
  pressSrcL: `${P}bleed.press_src_l`, // L PRESS SOURCE: 1 NORM, 0 OFF
  pressSrcR: `${P}bleed.press_src_r`,
  flow: `${P}bleed.flow`, // FLOW: 0 NORM, 1 HIGH

  // ---------------- Air conditioning (pedestal aft of the start buttons, OG 10-3/10-4)
  cabinTempKnob: `${P}ecs.cabin_temp`, // CABIN TEMP: 0 = NORM detent (auto); 0.05..1 manual COLD..HOT supply
  ckptTempKnob: `${P}ecs.ckpt_temp`, // CKPT TEMP: same
  ecsMode: `${P}ecs.mode`, // ECS knob: 0 NORM, 1 ACM ONLY, 2 HEAT EXCHG ONLY
  cabinSetC: `${P}ecs.cabin_set_c`, // GTC Temperature page: cabin target (degC)
  ckptSetC: `${P}ecs.ckpt_set_c`, // GTC Temperature page: cockpit target (degC)
  recircFan: `${P}ecs.recirc_fan`, // GTC: 0 AUTO, 1 LOW, 2 HIGH

  // ---------------- Pressurization (pedestal centre, OG 11-4/11-5)
  pressDump: `${P}press.dump`, // CABIN DUMP pushbutton (guarded): 0 NORM, 1 DUMP
  pressDumpGuard: `${P}press.dump_guard`,
  pressMode: `${P}press.mode`, // PRESS MODE: 0 NORM, 1 MANUAL
  cabinAltSw: `${P}press.cabin_alt_sw`, // CABIN ALT toggle, momentary: -1 DN, 0, +1 UP
  pressSelMode: `${P}press.sel_mode`, // GTC Cabin Pressure page: 0 Normal (landing elevation), 1 Altitude Select
  pressLdgElevFt: `${P}press.ldg_elev_ft`, // GTC manual landing elevation (ft); NaN-free: -9999 = use FMS destination
  pressSelCabinFt: `${P}press.sel_cabin_ft`, // GTC Altitude Select target (ft)

  // ---------------- Ice & rain protection (copilot lower sub-panel, OG 12-3/12-4)
  aiEngL: `${P}ice.eng_l`, // L ENGINE: 0 OFF, 1 ON
  aiEngR: `${P}ice.eng_r`,
  aiWing: `${P}ice.wing`, // WING: 0 OFF, 1 ON
  aiStab: `${P}ice.stab`, // STAB (EMEDS): 0 OFF, 1 ON
  pitotStatic: `${P}ice.pitot_static`, // PITOT/STATIC: 0 NORM (auto), 1 ON

  // ---------------- Fire protection (glareshield, EST layout; docs §Fire)
  fireEngL: `${P}fire.eng_l`, // L ENG FIRE switchlight: 1 pushed (fuel/hyd/bleed shutoff, bottles armed)
  fireEngR: `${P}fire.eng_r`,
  bottle1: `${P}fire.bottle1`, // BOTTLE 1 ARMED/DISCH pushbutton, momentary
  bottle2: `${P}fire.bottle2`,
  fireTest: `${P}fire.test`, // fire warning test: GTC Aircraft Systems > Tests FIRE WARN toggle (no overhead test button, c_oh)

  // ---------------- Flight controls (pedestal / yoke / pedestal aft)
  flapLever: `${P}flap_lever`, // 0 UP, 1 (7), 2 (15), 3 FULL (35)
  speedbrake: `${P}speedbrake`, // 0 RETRACTED .. 1 full (35 deg panels)
  ailTrimSw: `${P}trim.ail_sw`, // AILERON TRIM switch, momentary: -1 LWD, 0, +1 RWD
  rudTrimSw: `${P}trim.rud_sw`, // RUDDER TRIM knob/switch, momentary: -1 NL, 0, +1 NR
  stabSecSw: `${P}trim.stab_sec_sw`, // SECONDARY STAB TRIM (guarded), momentary: -1 NOSE DN, 0, +1 NOSE UP
  stabSecGuard: `${P}trim.stab_sec_guard`,
  pitchTrimYoke: 'input.pitch_trim_rate', // yoke pitch trim switches (primary)

  // ---------------- Landing gear / brakes (copilot panel inboard; EMER/PARK handle pilot panel)
  gearHandle: `${P}gear_handle`, // 1 DN, 0 UP
  gearEmer: `${P}gear_emer`, // EMER GEAR EXTENSION T-handle: 1 pulled
  parkBrake: `${P}park_brake`, // EMER/PARK BRAKE handle 0 stowed .. 1 set
  tiller: 'input.tiller',

  // ---------------- Lighting (overhead lighting panel + lower panels, OG 16-2..16-4)
  ltLdgL: `${P}lt.ldg_l`, // L LDG pushbutton 0/1
  ltLdgR: `${P}lt.ldg_r`,
  ltRecog: `${P}lt.recog`,
  ltPulse: `${P}lt.pulse`,
  ltTaxi: `${P}lt.taxi`,
  ltWingInsp: `${P}lt.wing_insp`,
  ltTailFlood: `${P}lt.tail_flood`,
  ltAntiColl: `${P}lt.anti_coll`,
  ltNav: `${P}lt.nav`, // GTC Exterior Lights: 1 ON (auto ON at G5000 power-up)
  ltBeaconMode: `${P}lt.beacon_mode`, // GTC: 0 OFF, 1 NORM (auto with RUN/starter), 2 ON
  ltAutoPulse: `${P}lt.auto_pulse`, // GTC: 1 ON (pulse on TCAS TA/RA)
  ltPanel: `${P}lt.panel`, // PANEL knob 0..1 (1 = DAY)
  ltFlood: `${P}lt.flood`, // FLOOD knob 0..1
  ltAux: `${P}lt.aux`, // AUX knob 0..1 (glareshield under-lighting, EST)
  ltEmer: `${P}lt.emer`, // EMER LTS: 0 OFF, 1 ARM, 2 ON
  ltSeatBelt: `${P}lt.pass_safety`, // legacy 3-position PASS SAFETY state (0 / 1 belt / 2 belt + safety), still honoured; the cockpit now has the SEAT BELTS / PAX SAFETY switchlights (ltSeatBelts / ltPaxSafety)
  ltPfdL: `${P}lt.pfd_l`, // pilot PFD/GTC dimmer outer (PFD) 0..1
  ltGtcL: `${P}lt.gtc_l`, // inner (outboard GTC)
  ltMfd: `${P}lt.mfd`, // pedestal MFD/GTC dimmer outer
  ltGtcC: `${P}lt.gtc_c`, // inner (centre GTCs)
  ltPfdR: `${P}lt.pfd_r`,
  ltGtcR: `${P}lt.gtc_r`,
  ltMapL: `${P}lt.map_l`, // MAP LIGHT knobs 0..1
  ltMapR: `${P}lt.map_r`,

  // ---------------- Oxygen (EST: side consoles / overhead)
  oxyPax: `${P}oxy.pax`, // passenger oxygen: 0 AUTO (auto deploy), 1 DEPLOY (GTC ECS page PAX OXY, SCOPE)
  oxyMaskL: `${P}oxy.mask_l`, // crew mask in use (stowage door open)
  oxyMaskR: `${P}oxy.mask_r`,
  oxyMode: `${P}oxy.mode`, // mask regulator: 0 NORM, 1 100 %, 2 EMER

  // ---------------- Derived / internal (written by systems, read by displays and other systems)
  sbCmd: `${P}sb_cmd`, // speedbrake command after the in-flight flap limit and auto-stow
  sbAutoStow: `${P}sb_autostow`,
  busTieCmd: `${P}elec.bus_tie_cmd`,
  busTieClosed: `${P}elec.bus_tie_closed`,
  isoOpen: `${P}bleed.iso_open`,
  wingXflowOpen: `${P}bleed.wing_xflow_open`,
  apuBleedReady: `${P}apu.bleed_ready`,
  ptcuMode: `${P}hyd.ptcu_mode`, // string: OFF / XFER / AUX A / AUX B / GEN A / GEN B / PRIME
  ptcuGenSrcB: `${P}hyd.ptcu_gen_src_b`,
  rssActive: `${P}hyd.rss_active`,
  ydAuto: `${P}yd_auto`,
  noTakeoff: `${P}no_takeoff`,
  toThrust: `${P}to_thrust`, // throttles in the T/O range (either lever)
  idleBoth: `${P}idle_both`,
  pitotHeatOn: `${P}pitot_heat_on`,
  wshldHeatOn: `${P}wshld_heat_on`,
  gsArmed: `${P}gs_armed`,
  gsAccum: (i: number) => `${P}gs_accum${i}_psi`,
  revMaxFrac: `${P}rev_max_frac`,
  startPsi: 'pneu.start_psi',
  lastShutdown: (i: number) => `${P}eng${i}_shutdown_s`,
  dryMotorReq: (i: number) => `${P}eng${i}_dry_motor_req`,
  fuelInletC: (i: number) => `${P}fuel.inlet${i}_c`,
  recircOn: (i: number) => `${P}fuel.recirc${i}_on`,
  hydTempC: (s: 'a' | 'b') => `${P}hyd.${s}_temp_c`,
  stbyBattLed: `${P}elec.stby_led`, // 1 amber (not charging), 2 green (test OK)
  stbyPowered: `${P}elec.stby_powered`,
  highAltMode: `${P}press.high_alt_mode`,
  engFail: (i: number) => `${P}eng${i}_fail`, // FADEC engine-failure latch (ENGINE FAIL CAS)

  // ---------------- Control wheels / tiller (3D cockpit; added by the cockpit agent). The input module
  // rewrites input.pitch_trim_rate / input.ap_disc / input.tiller every frame from the keyboard and hardware,
  // so the 3D yoke switches and tiller write their own vars; systems/cockpitInputs.ts merges them.
  yokeTrimL: `${P}yoke.trim_l`, // pilot pitch trim split switch, momentary: +1 NOSE UP, 0, -1 NOSE DN
  yokeTrimR: `${P}yoke.trim_r`, // copilot
  yokeDiscL: `${P}yoke.disc_l`, // AP/TRIM DISC button held (1): disconnects the AP, interrupts trim and the pusher
  yokeDiscR: `${P}yoke.disc_r`,
  tiller3d: `${P}tiller`, // left-console tiller handle -1..1 (+ right)
  yokeTrimCmd: `${P}yoke.trim_cmd`, // merged wheel trim command (pilot priority), read by the stabilizer trim
  tillerCmd: `${P}tiller_cmd`, // merged tiller command (hardware axis or 3D handle), read by the NWS
  discHeld: `${P}yoke.disc_held`, // either AP/TRIM DISC held

  // ---------------- Overhead / side consoles (added by the overhead + side-console agent)
  ltDome: `${P}lt.dome`, // cockpit dome light: GTC Lights page CKPT DOME toggle (SCOPE; hot battery bus, EST)
  oxyModeR: `${P}oxy.mode_r`, // copilot mask regulator: 0 NORM, 1 100 %, 2 EMER (pilot = oxyMode)
  oxyTestL: `${P}oxy.test_l`, // mask stowage PRESS TO TEST, momentary: 1 while held
  oxyTestR: `${P}oxy.test_r`,
  lampTest: 'alert.annun_test', // annunciator lamp test: GTC Tests page ANNUN toggle, read by the CAS and every lens

  // ---------------- Check-ride pass: controls from the DGAC-published Longitude abnormal checklist card
  pitchRollDisc: `${P}fc.pitch_roll_disc`, // PITCH/ROLL DISCONNECT handle: 0 NORM, 1 PULLED (both axes split), 2 PITCH RECONNECT, 3 ROLL RECONNECT

  // ---------------- Fix round 1 (layout audit, AOPA 2021 / Textron flight-deck photographs): controls the
  // photographs show that the first build lacked. Behaviour EST where the AFM text is not public (see systems/logic.ts).
  fireApu: `${P}fire.apu`, // APU FIRE switchlight (glareshield, right of ENG FIRE R): 1 pushed (APU shutdown, APU fuel shutoff, APU bottle discharge)
  aprAuto: `${P}eng.apr_auto`, // POWER RESERVE AUTO switchlight (yellow frame): 1 armed (APR on an engine failure), 0 disarmed
  aprManual: `${P}eng.apr_manual`, // POWER RESERVE MANUAL switchlight: 1 APR commanded on both engines
  aprActive: `${P}eng.apr_active`, // derived: APR thrust rating in force (auto-triggered or manual)
  stabChan: `${P}trim.stab_chan`, // STABILIZER PRIMARY TRIM CHANNEL SELECT: 1 / 2 = active primary channel (each press alternates)
  stabSecArm: `${P}trim.stab_sec_arm`, // SECONDARY TRIM switchlight (yellow guard frame): 1 secondary channel engaged (primary disengaged)
  autoGndSplr: `${P}fc.auto_gnd_splr`, // AUTO GROUND SPOILERS switchlight: 1 NORM (armed), 0 OFF (disarmed)
  stbyYd: `${P}fc.stby_yd`, // STANDBY YAW DAMP switchlight: 1 standby yaw damper engaged
  flapReset: `${P}fc.flap_reset`, // FLAP RESET pushbutton, momentary: 1 while pressed (clears a latched flap fault)
  flapFault: `${P}fc.flap_fault`, // derived: flap system fault latched (flaps frozen until FLAP RESET)
  controlLock: `${P}fc.control_lock`, // CONTROL LOCK lever: 1 LOCK (down), 0 UNLOCK (up)
  cvrTest: `${P}cvr.test`, // CVR TEST pushbutton, momentary
  cvrErase: `${P}cvr.erase`, // CVR ERASE pushbutton, momentary
  cvrTestOk: `${P}cvr.test_ok`, // derived: CVR status light (green) after TEST held 5 s with the CVR powered
  cvrErased: `${P}cvr.erased`, // derived: last ERASE accepted (on the ground with the parking brake set)
  eventMarker: `${P}fdr.event_marker`, // EVENT MARKER pushbutton, momentary
  eventCount: `${P}fdr.event_count`, // derived: flight-data-recorder events marked this power-up
  pttL: `${P}yoke.ptt_l`, // control-wheel PTT (back of the grip), momentary: 1 while held (COM transmit)
  pttR: `${P}yoke.ptt_r`,
  yokeIcsL: `${P}yoke.ics_l`, // control-wheel intercom (ICS) push, momentary
  yokeIcsR: `${P}yoke.ics_r`,
  transmitting: `${P}com.transmitting`, // derived: 1 while either PTT keys the selected COM
  gasperL: `${P}ecs.gasper_l`, // pilot gasper (upper outboard PFD corner): 0 closed .. 1 open
  gasperR: `${P}ecs.gasper_r`,
  ltPaxSafety: `${P}lt.pax_safety_btn`, // overhead PAX SAFETY switchlight: 1 ON (cabin NO SMOKING / safety signs)
  ltSeatBelts: `${P}lt.seat_belts`, // overhead SEAT BELTS switchlight: 1 ON (cabin FASTEN SEAT BELT signs)
  visorL: `${P}visor_l`, // sun visor (rail above the side window): 0 stowed .. 1 deployed
  visorR: `${P}visor_r`,
  thrustMode: (i: number) => `${P}eng${i}.thrust_mode`, // derived string: governing FADEC rating label for the EIS (TO / CLB / CRU / APR / T/R)
  ltStby: `${P}lt.stby`, // standby display brightness knob (right of the standby unit, c_top21; EST function) 0..1
  altFine: `${P}gmc.alt_fine`, // GMC ALT knob PUSH FINE state: 1 = 100 ft steps, 0 = 1000 ft steps (EST)
  stabSecCmd: `${P}trim.stab_sec_cmd`, // derived: secondary stab trim rocker command while SECONDARY TRIM is engaged

  // ---------------- Function fix round 1 (DGAC card / OG function audit)
  micSelL: `${P}audio.mic_sel_l`, // MIC SEL (side console, beside the mask cup; EST position): 0 BOOM, 1 MASK (DGAC CABIN ALTITUDE step 2)
  micSelR: `${P}audio.mic_sel_r`,
  micInphL: `${P}audio.mic_inph_l`, // MIC/INPH switch (control wheel): 0 inboard (MIC, PTT), 1 outboard (INPH: hot intercom) (DGAC step 3)
  micInphR: `${P}audio.mic_inph_r`,
  maskMicLiveL: `${P}audio.mask_mic_l`, // derived: crew mask microphone live (MASK selected and the mask in use)
  maskMicLiveR: `${P}audio.mask_mic_r`,
  intercomHotL: `${P}audio.intercom_hot_l`, // derived: hot intercom on (MIC/INPH outboard, the selected mic live)
  intercomHotR: `${P}audio.intercom_hot_r`,
  parkSet: `${P}park_set`, // derived: EMER/PARK BRAKE handle at the PARK latch (full travel), the parking brake is set
  brakePedalL: `${P}brake_pedal_l`, // derived: toe-brake demand through the brake-by-wire controller (0 when it is unpowered)
  brakePedalR: `${P}brake_pedal_r`,
  busTieOverride: `${P}elec.bus_tie_override`, // derived: in-air crew BUS TIE selection masking the automation
  g5000Up: `${P}g5000_up`, // derived: G5000 powered (either PFD or the MFD) - NAV / beacon power-up defaults
  ecsAutoHx: `${P}ecs.auto_hx`, // derived: pack automatically switched to heat-exchanger-only (ACM fault, OG 10-3)
  ecsMinOutletC: `${P}ecs.min_outlet_c`, // derived: pack outlet limits for the ECS mode (OG 10-3)
  ecsMaxOutletC: `${P}ecs.max_outlet_c`,
  ecsPackFlowKgs: `${P}ecs.pack_flow_kgs`, // derived: pack flow demand (FLOW NORM/HIGH; APU-only 60 % in NORM, OG 10-4; ACM ONLY EST)
  genLoadPct: (g: 'l' | 'r' | 'apu') => `${P}elec.gen_${g}_load_pct`, // derived: load vs the air/ground rating (OG 5-3)
  waiValvesOpen: `${P}ai.wing_valves_open`, // derived: wing A/I valves open 4 s after the selection (OG 12-3)
  engExceed: (i: number) => `${P}eng${i}_exceed`, // derived: ENG EXCEEDANCE latch (cleared by maintenance / state reset, OG 3-5)
  scavengeOn: (i: number) => `${P}fuel.scavenge${i}_on`, // derived: scavenge ejector running (low fuel or cold fuel, OG 6-2)
  highAltLatched: `${P}press.high_alt_latched`, // derived: high-altitude airport mode (departure or destination > 8,000 ft, OG 11-3)
  edmActive: `${P}afcs.edm_active`, // derived: Emergency Descent Mode in progress (BCA 2021)
  atProt: `${P}at.protection`, // derived: A/T protection 0 none, 1 MIN SPD, 2 MAX SPD (OG 7-5)
  startFail: (i: number) => `${P}eng${i}_start_fail`, // derived: FADEC start abort latched (fadec.eng{i}.abort)
  fadecFault: (i: number) => `${P}eng${i}_fadec_fault`, // derived: FADEC channel fault (ENG CONTROL FAULT, EST)
  spoilerInd: `${P}spoiler_ind`, // derived: EIS SPOILERS indication 0..1 = max(speedbrake, ground-spoiler) panel extension (OG 15-5)

  // ---------------- Function fix round 2 (LON4 gaps)
  apprSpdAddKt: `${P}fms.appr_spd_add_kt`, // GTC pilot-set approach speed additive (kt) over VREF (BCA 2021; default 5, EST)
  apprSpdActive: `${P}fms.appr_spd_active`, // derived: approach-speed schedule active (< 2 nm on final, FMS speed mode)
} as const;

/** Every cockpit control var (inputs), for the "every control is consumed" audit test. */
export const LON_CONTROL_VARS: string[] = [
  LON_VARS.battL, LON_VARS.battR, LON_VARS.genL, LON_VARS.genR, LON_VARS.genApu, LON_VARS.busTieBtn,
  LON_VARS.mainL, LON_VARS.mainR, LON_VARS.elecL, LON_VARS.elecR, LON_VARS.interior, LON_VARS.stbyPwr, LON_VARS.extPwr,
  LON_VARS.hydPumpA, LON_VARS.hydPumpB, LON_VARS.ptcu, LON_VARS.rudderStby,
  LON_VARS.boostL, LON_VARS.boostR, LON_VARS.gravXflow, LON_VARS.fuelTransfer, LON_VARS.fuelRecirc,
  LON_VARS.tla(1), LON_VARS.tla(2), LON_VARS.runL, LON_VARS.runR, LON_VARS.startL, LON_VARS.startR,
  LON_VARS.apuKnob,
  LON_VARS.bleedEngL, LON_VARS.bleedEngR, LON_VARS.bleedApu, LON_VARS.bleedIsolate, LON_VARS.pressSrcL, LON_VARS.pressSrcR, LON_VARS.flow,
  LON_VARS.cabinTempKnob, LON_VARS.ckptTempKnob, LON_VARS.ecsMode, LON_VARS.cabinSetC, LON_VARS.ckptSetC, LON_VARS.recircFan,
  LON_VARS.pressDump, LON_VARS.pressMode, LON_VARS.cabinAltSw, LON_VARS.pressSelMode, LON_VARS.pressLdgElevFt, LON_VARS.pressSelCabinFt,
  LON_VARS.aiEngL, LON_VARS.aiEngR, LON_VARS.aiWing, LON_VARS.aiStab, LON_VARS.pitotStatic,
  LON_VARS.fireEngL, LON_VARS.fireEngR, LON_VARS.bottle1, LON_VARS.bottle2, LON_VARS.fireTest,
  LON_VARS.flapLever, LON_VARS.speedbrake, LON_VARS.ailTrimSw, LON_VARS.rudTrimSw, LON_VARS.stabSecSw,
  LON_VARS.gearHandle, LON_VARS.gearEmer, LON_VARS.parkBrake,
  LON_VARS.ltLdgL, LON_VARS.ltLdgR, LON_VARS.ltRecog, LON_VARS.ltPulse, LON_VARS.ltTaxi, LON_VARS.ltWingInsp, LON_VARS.ltTailFlood,
  LON_VARS.ltAntiColl, LON_VARS.ltNav, LON_VARS.ltBeaconMode, LON_VARS.ltAutoPulse, LON_VARS.ltPanel, LON_VARS.ltFlood, LON_VARS.ltAux,
  LON_VARS.ltEmer, LON_VARS.ltSeatBelt, LON_VARS.ltPfdL, LON_VARS.ltGtcL, LON_VARS.ltMfd, LON_VARS.ltGtcC, LON_VARS.ltPfdR, LON_VARS.ltGtcR,
  LON_VARS.ltMapL, LON_VARS.ltMapR,
  LON_VARS.oxyPax, LON_VARS.oxyMaskL, LON_VARS.oxyMaskR, LON_VARS.oxyMode,
  LON_VARS.yokeTrimL, LON_VARS.yokeTrimR, LON_VARS.yokeDiscL, LON_VARS.yokeDiscR, LON_VARS.tiller3d,
  LON_VARS.ltDome, LON_VARS.oxyModeR, LON_VARS.oxyTestL, LON_VARS.oxyTestR, LON_VARS.lampTest,
  LON_VARS.pitchRollDisc,
  LON_VARS.fireApu, LON_VARS.aprAuto, LON_VARS.aprManual, LON_VARS.stabChan, LON_VARS.stabSecArm, LON_VARS.autoGndSplr,
  LON_VARS.stbyYd, LON_VARS.flapReset, LON_VARS.controlLock, LON_VARS.cvrTest, LON_VARS.cvrErase, LON_VARS.eventMarker,
  LON_VARS.pttL, LON_VARS.pttR, LON_VARS.yokeIcsL, LON_VARS.yokeIcsR, LON_VARS.gasperL, LON_VARS.gasperR,
  LON_VARS.ltPaxSafety, LON_VARS.ltSeatBelts, LON_VARS.visorL, LON_VARS.visorR, LON_VARS.ltStby,
  LON_VARS.micSelL, LON_VARS.micSelR, LON_VARS.micInphL, LON_VARS.micInphR,
];

/** Events emitted by cockpit buttons (momentary commands). */
export const LON_EVENTS = {
  masterWarning: 'cas.ack_warning', // MASTER WARNING RESET switchlights (lower glareshield tier, both sides)
  masterCaution: 'cas.ack_caution', // MASTER CAUTION RESET switchlights
  toga: 'ap.toga', // TO/GA buttons (outboard end of each thrust-lever grip)
  atEngage: 'at.engage', // AT paddle on the outboard side of each thrust-lever arm
  atDisc: 'at.disc', // AT DISC button (inboard top of each thrust-lever grip)
  apDisc: 'input.ap_disc', // AP/TRIM DISC on each yoke (hold var)
  tawsGsCancel: 'taws.gs_cancel',
  tawsTest: 'taws.test',
} as const;
