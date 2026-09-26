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
  fireTest: `${P}fire.test`, // FIRE WARN TEST pushbutton, momentary (overhead)

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
  ltSeatBelt: `${P}lt.pass_safety`, // PASS SAFETY: 0 OFF, 1 BELT, 2 BELT+NO SMOKING (EST)
  ltPfdL: `${P}lt.pfd_l`, // pilot PFD/GTC dimmer outer (PFD) 0..1
  ltGtcL: `${P}lt.gtc_l`, // inner (outboard GTC)
  ltMfd: `${P}lt.mfd`, // pedestal MFD/GTC dimmer outer
  ltGtcC: `${P}lt.gtc_c`, // inner (centre GTCs)
  ltPfdR: `${P}lt.pfd_r`,
  ltGtcR: `${P}lt.gtc_r`,
  ltMapL: `${P}lt.map_l`, // MAP LIGHT knobs 0..1
  ltMapR: `${P}lt.map_r`,

  // ---------------- Oxygen (EST: side consoles / overhead)
  oxyPax: `${P}oxy.pax`, // PASS OXY: 0 NORM (auto deploy), 1 MAN DEPLOY
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
];

/** Events emitted by cockpit buttons (momentary commands). */
export const LON_EVENTS = {
  masterWarning: 'cas.ack_warning', // MASTER WARNING switchlights (glareshield, both sides)
  masterCaution: 'cas.ack_caution', // MASTER CAUTION switchlights
  toga: 'ap.toga', // TO/GA buttons (outboard side of each thrust lever handle)
  atEngage: 'at.engage', // A/T arm/engage button (aft face of each lever arm)
  atDisc: 'at.disc', // A/T disconnect button (front of each handle)
  apDisc: 'input.ap_disc', // AP/TRIM DISC on each yoke (hold var)
  tawsGsCancel: 'taws.gs_cancel',
  tawsTest: 'taws.test',
} as const;
