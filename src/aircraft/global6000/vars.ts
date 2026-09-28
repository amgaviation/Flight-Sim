/**
 * Bombardier Global 6000 cockpit-control and aircraft-specific vars: the
 * contract between the cockpit build (src/aircraft/global6000/cockpit,
 * another agent), the systems (systems/**) and the initial states
 * (states.ts). The panel-by-panel inventory with positions, legends and
 * spring-loading is in docs/aircraft/global6000.md section 12.
 *
 * Names that the Collins Pro Line Fusion synoptics already read
 * (src/avionics/collins-fusion/logic/readouts.ts DEFAULT_READOUT_BINDINGS:
 * `ac.elec.gen{n}_sw`, `ac.elec.ac_bus{n}_isol`, `ac.hyd.pump{p}_sw`,
 * `ac.ice.wing_sw`, `ac.ice.cowl_l_sw`, `ac.ecs.zone{z}_temp_c`,
 * `ac.door.<id>_open`, `ac.flap_lever`, `ac.eng{i}.n1_mode`) keep those names;
 * everything else uses the `ac.g6k.` prefix.
 *
 * Conventions: push-button switchlights ("PBA") are 1 = pressed-in / normal
 * state as listed per var; rotary knobs use the listed integers; momentary
 * controls write 1 while held and 0 on release (spring-loaded); guarded
 * controls have a `...Guard` var (0 closed, 1 open) where the cockpit models
 * the guard.
 */
const P = 'ac.g6k.';

export const G6K_VARS = {
  // ======================================================== OVERHEAD
  // ---- ELECTRICAL panel (GXAG GX_01_018, GXEL)
  extAc: 'ac.elec.ext_ac_sw', // EXT AC PBA: 1 ON (AVAIL / ON legends), 0 off
  gen: (n: 1 | 2 | 3 | 4) => `ac.elec.gen${n}_sw`, // GEN n PBA: 1 normal (dark), 0 OFF (white OFF); push OFF -> ON resets the GCU
  extDc: 'ac.elec.ext_dc_sw', // EXT DC PBA: 1 ON
  apuGen: 'ac.elec.apu_gen_sw', // APU GEN PBA: 1 normal, 0 OFF
  ratGen: 'ac.elec.rat_gen_sw', // RAT GEN PBA: 1 normal (armed / ON when deployed), 0 OFF ("RAT GEN OFF")
  battMaster: 'ac.elec.batt_master_sw', // BATT MASTER toggle: 1 ON, 0 OFF
  cabinPwr: 'ac.elec.cabin_pwr_sw', // CABIN POWER PBA (overhead CABIN SYSTEMS) / EMS SWITCH CONTROL: 1 ON
  acBusIsol: (n: 1 | 2 | 3 | 4) => `ac.elec.ac_bus${n}_isol`, // EMS CDU EMER CNTL: 1 = bus manually isolated (MAN OFF)
  dcBusIsol: (b: 'dc_bus1' | 'dc_bus2' | 'dc_ess' | 'batt_bus') => `ac.elec.${b}_isol`, // EMS CDU EMER CNTL DC buses
  extAcAvail: `${P}elec.ext_ac_cart`, // ramp: AC ground power cart connected (service menu / states)
  extDcAvail: `${P}elec.ext_dc_cart`, // ramp: DC ground power unit connected

  // ---- WINDSHIELD HEAT (GX_01_018)
  wshldL: 'ac.ice.wshld_l_sw', // L rotary: 1 ON, 0 OFF/RESET
  wshldR: 'ac.ice.wshld_r_sw',
  // ---- HYDRAULIC SOV (GXHY)
  hydSovL: 'ac.hyd.sov_l_sw', // L HYD SOV PBA: 1 CLOSED (white CLOSED legend), 0 normal (open)
  hydSovR: 'ac.hyd.sov_r_sw',
  // ---- HYDRAULIC pumps (GXHY): 1B / 2B / 3B rotary OFF 0, AUTO 1, ON 2; 3A toggle OFF 0 / ON 2
  hydPump: (p: '1b' | '2b' | '3a' | '3b') => `ac.hyd.pump${p}_sw`,
  // ---- AURAL WARNING (GX_01_018): IAC 1 / IAC 2 MUTED PBAs (push to mute the non-essential aurals)
  auralMute: (n: 1 | 2) => `${P}aural.iac${n}_mute`,
  // ---- PASS SIGNS / EMER LIGHTS
  noSmoking: 'ac.cabin.nosmoke_sw', // NO SMKG: 0 OFF, 1 AUTO, 2 ON
  seatBelts: 'ac.cabin.seatbelt_sw', // SEAT BLTS: 0 OFF, 1 AUTO, 2 ON
  emerLights: 'ac.light.emer_sw', // EMER LIGHTS: 0 OFF, 1 ARM, 2 ON (guarded at ARM)
  // ---- EXTERNAL LIGHTS (GXLT, GX_01_018)
  ltLdgL: 'ac.light.landing_l_sw', // LANDING L WING: 0 OFF, 1 STEADY, 2 PULSE (GX PTG 15-28)
  ltLdgNose: 'ac.light.landing_nose_sw', // LANDING NLG: 0 OFF, 1 STEADY, 2 PULSE (nose-gear lamps, gear down only)
  ltLdgR: 'ac.light.landing_r_sw', // LANDING R WING: 0 OFF, 1 STEADY, 2 PULSE
  ltTaxi: 'ac.light.taxi_sw', // TAXI/RECOG: 0 OFF, 1 ON (wing taxi / recognition), 2 WINGTIP (wingtip taxi lights)
  ltNav: 'ac.light.nav_sw', // NAV: 1 ON
  ltBeacon: 'ac.light.beacon_sw', // BEACON: 0 OFF, 1 RED, 2 WHT (FCOM 01-10-41 three-position switch)
  ltStrobe: 'ac.light.strobe_sw', // STROBE: 1 ON (white anti-collision)
  ltWing: 'ac.light.wing_sw', // WING INSP: 1 ON
  ltLogo: 'ac.light.logo_sw', // LOGO: 1 ON
  // ---- APU (GXAPU): rotary OFF 0, RUN 1, START 2 (spring-loaded START -> RUN)
  apuSw: 'ac.apu.master_sw',
  // ---- ENGINE (GX_01_018 ENGINE panel)
  // Legacy start inputs (no cockpit control since the Vision START rotary, V.engStartSel; engines.ts still honours them
  // for scripted tests): engStart = auto-start request (rising edge), engCrank = crank (manual mode) held.
  engStart: (i: 1 | 2) => `${P}eng.start${i}_btn`,
  engCrank: (i: 1 | 2) => `${P}eng.crank${i}_sw`,
  ignition: 'ac.eng.ign_sw', // IGNITION PBA: 1 ON (continuous), 0 AUTO
  // ---- FUEL (GXFU)
  priPumps: (s: 'l' | 'r') => `ac.fuel.pri_${s}_sw`, // L / R PRI PUMPS PBA: 1 normal (auto), 0 OFF (inhibited)
  auxPump: (s: 'l' | 'r') => `ac.fuel.aux_${s}_sw`, // L / R AUX PUMP PBA: 1 normal (auto), 0 OFF
  xfeed: 'ac.fuel.xfeed_sw', // XFEED SOV PBA: 1 OPEN
  recirc: (s: 'l' | 'r') => `ac.fuel.recirc_${s}_sw`, // L / R RECIRC PBA (-9 FMQGC): 1 normal (auto), 0 OFF
  aftXfer: 'ac.fuel.aft_xfer_sw', // AFT XFER rotary: 0 OFF, 1 AUTO, 2 ON
  wingXfer: 'ac.fuel.wing_xfer_sw', // WING XFER rotary: 0 OFF, 1 AUTO, 2 L -> R, 3 R -> L
  // ---- BLEED / AIR COND (GX_01_018)
  engBleed: (s: 'l' | 'r') => `ac.bleed.${s}_sw`, // L / R ENG BLEED rotary: 0 OFF, 1 AUTO, 2 ON (HP forced open)
  apuBleed: 'ac.bleed.apu_sw', // APU BLEED rotary: 0 CLSD, 1 AUTO, 2 OPEN
  xbleed: 'ac.bleed.xbleed_sw', // XBLEED rotary: 0 CLSD, 1 AUTO, 2 OPEN
  pack: (s: 'l' | 'r') => `ac.ecs.pack_${s}_sw`, // L / R PACK PBA: 1 normal, 0 OFF
  trimAir: 'ac.ecs.trim_air_sw', // TRIM AIR PBA: 1 normal, 0 OFF
  recircFan: 'ac.ecs.recirc_sw', // RECIRC PBA: 1 normal, 0 OFF
  ramAir: 'ac.ecs.ram_air_sw', // RAM AIR PBA (guarded): 1 ON
  packManTemp: (s: 'l' | 'r') => `${P}ecs.pack_${s}_man_temp`, // L / R pack manual outlet demand 0 COLD .. 1 HOT, slewed by the MAN TEMP toggles (V.packManTempSw), effective with PACK CONTROL MAN
  zoneTemp: (z: 1 | 2 | 3) => `ac.ecs.zone${z}_temp_c`, // TEMPERATURE COCKPIT / FWD CABIN / AFT CABIN knob: 16..30 degC
  // ---- ANTI-ICE (GX_01_018)
  wingAi: 'ac.ice.wing_sw', // WING rotary: 0 OFF, 1 AUTO, 2 ON
  cowlAi: (s: 'l' | 'r') => `ac.ice.cowl_${s}_sw`, // L / R COWL rotary: 0 OFF, 1 AUTO, 2 ON
  wingXbleed: `${P}ice.wing_xbleed_sw`, // WING XBLEED rotary (FCOM 01-10-41): 0 AUTO, 1 FROM L, 2 FROM R (that engine supplies both wings)
  // ---- FIRE (GX_01_018, GXFP): handles pull, DISCH 1 / 2 PBAs under each handle
  fireHandle: (z: 'l' | 'apu' | 'r') => `${P}fire.${z}_handle`, // 0 stowed, 1 pulled (arms squibs, closes fuel / hyd / bleed SOVs)
  fireDisch: (z: 'l' | 'apu' | 'r', b: 1 | 2) => `${P}fire.${z}_disch${b}`, // DISCH n PBA: momentary 1 (bottle n)
  fireTest: `${P}fire.test_btn`, // EMS CDU TEST -> FIRE TEST: momentary 1
  // ---- PRESSURIZATION (GX_01_018)
  pressAutoMan: 'ac.press.mode_sw', // AUTO/MAN PBA: 0 AUTO, 2 MAN (MAN legend)
  pressManAlt: 'ac.press.manual_cmd', // MAN ALT toggle: -1 DN (close) .. 0 .. +1 UP (open), spring-loaded to centre
  pressManRate: `${P}press.man_rate`, // MAN RATE knob: 0 LOW .. 1 HIGH (outflow valve slew factor)
  ldgElevFms: `${P}press.ldg_elev_fms`, // LDG ELEV FMS/MAN PBA: 1 FMS, 0 MAN (MAN legend)
  ldgElevFt: 'ac.press.ldg_elev_ft', // LDG ELEV knob (MAN): -1,000 .. 14,000 ft
  outflowClosed: (n: 1 | 2) => `${P}press.ofv${n}_closed`, // OUTFLOW VALVE 1 / 2 CLOSED PBA: 1 closed
  emerDepress: 'ac.press.dump_sw', // EMERG DEPRESS PBA (guarded): 1 ON
  emerDepressGuard: `${P}press.dump_guard`,
  ditching: `${P}press.ditching_sw`, // DITCHING PBA (guarded): 1 ON
  // ---- ELT
  elt: `${P}elt_sw`, // ELT: 0 ARM/RESET, 1 ON (transmit)

  // ======================================================== SIDE PANELS / GLARESHIELD
  pusher: (s: 1 | 2) => `${P}stall.pusher${s}_sw`, // STALL PUSHER ON/OFF (pilot / copilot side panels): 1 ON
  stallTest: `${P}stall.test_btn`, // EMS CDU TEST -> STALL TEST: momentary 1
  oxyMask: (s: 1 | 2) => `${P}oxy.mask${s}`, // quick-donning mask out of its stowage: 1 in use
  oxyMaskMode: `${P}oxy.mask_mode`, // mask regulator: 0 N (diluter), 1 100 %, 2 EMERGENCY
  crewOxy: 'ac.oxy.crew_sw', // crew oxygen supply valve: 1 ON
  paxOxy: 'ac.oxy.pax_sw', // PASSENGER OXYGEN: 0 CLOSED, 1 NORMAL (auto at 14,000 ft cabin), 2 OVERRIDE (deploy)
  hudPower: `${P}hud.power_sw`, // HUD system power (optional equipment): 1 ON. No cockpit switch on the Vision deck (powered through its DC BUS 1 breaker; states.ts sets it with aircraft power)
  tiller: 'input.tiller', // NOSE STEER handwheel (pilot side console): +/-75 deg

  // ======================================================== PEDESTAL
  tla: (i: 1 | 2) => `ac.tla${i}`, // thrust lever 0 IDLE .. 1 MAX
  revLever: (i: 1 | 2) => `${P}rev_lever${i}`, // piggy-back reverse lever 0 stowed .. 1 MAX REV (IDLE REV ~0.1)
  engRun: (i: 1 | 2) => `${P}eng.run${i}_sw`, // ENG RUN L / R toggle (lift to move): 1 RUN, 0 OFF
  engN1Mode: (i: 1 | 2) => `ac.eng${i}.n1_mode`, // overhead ENGINE MODE L / R toggle: 0 EPR (normal, down), 1 N1 (FADEC alternate mode, up)
  flapLever: 'ac.flap_lever', // SLAT/FLAP lever: 0 0 IN, 1 0 OUT, 2 6, 3 16, 4 30
  flightSpoiler: `${P}flt_spoiler`, // FLIGHT SPOILER lever: 0 RETRACT, 0.25 1/4 (soft), 0.5 1/2, 0.8 FULL, 1.0 MAX
  stabCh: (n: 1 | 2) => `${P}trim.stab_ch${n}_off`, // STAB CH 1 / CH 2 PBA: 1 = channel disconnected (OFF legend)
  ailTrimSw: `${P}trim.ail_sw`, // AIL trim split switch: -1 LWD, 0, +1 RWD (both halves together, spring-loaded)
  rudTrimSw: `${P}trim.rud_sw`, // RUD trim rotary: -1 NL, 0, +1 NR (spring-loaded)
  pitchTrimYoke: 'input.pitch_trim_rate', // control wheel pitch trim switches (both levers together)
  terrOff: `${P}taws.terr_off`, // EGPWS TERRAIN OFF PBA: 1 OFF
  gsMute: `${P}taws.gs_mute_btn`, // G/S WARN MUTED PBA: momentary 1 (glideslope alert cancel below 2,000 ft)
  flapOvrd: `${P}taws.flap_ovrd`, // FLAP OVRD PBA (guarded): 1 OVRD
  flapOvrdGuard: `${P}taws.flap_ovrd_guard`,
  gldManArm: `${P}gld.man_arm_sw`, // GND LIFT DUMPING MAN ARM PBA: 1 armed manually
  gldOff: `${P}gld.off_sw`, // GND LIFT DUMPING OFF PBA: 1 disarmed
  autobrake: 'ac.autobrake_sel', // AUTOBRAKE rotary: 0 OFF, 1 LO, 2 MED, 3 HI (solenoid-held, returns to OFF on disarm)
  gearHandle: `${P}gear_handle`, // LDG GEAR handle: 1 DN, 0 UP
  gearDnLckRel: `${P}gear.dn_lck_rel`, // DN LCK REL PBA: momentary 1 (overrides the handle solenoid)
  gearManRelease: `${P}gear.man_release`, // landing gear manual release handle: 0 stowed .. 1 fully extended (free fall)
  nwsArm: `${P}nws_sw`, // NOSE STEER PBA: 1 ARMED, 0 OFF
  hornMute: `${P}gear.horn_mute`, // HORN MUTED PBA: 1 muted (only with both RAs invalid)
  btmsReset: `${P}btms.reset_btn`, // BTMS OVHT WARN RESET: momentary 1
  parkBrake: `${P}park_brake`, // PARK/EMER BRAKE handle: 0 stowed .. 1 locked (proportional emergency braking below)
  dcEmerOvrd: `${P}elec.dc_emer_ovrd`, // EMER DC PWR PBA (overhead ELECTRICAL, red guard): 1 OVRD
  dcEmerOvrdGuard: `${P}elec.dc_emer_ovrd_guard`,
  ratDeploy: `${P}rat.deploy_handle`, // RAT manual deploy handle: 1 pulled (latched until stowed on the ground)
  irsMode: (n: 1 | 2 | 3) => `ac.irs${n}_mode`, // IRS 1 / 2 / 3 rotary: 0 OFF, 1 ALN, 2 NAV, 3 ATT
  // ---- COCKPIT LIGHTS (GXLT: FLOOD/DISPLAY and INTEGRAL/MISC panels)
  ltFlood: (z: 'l' | 'c' | 'r') => `${P}light.flood_${z}`, // FLOOD L / CTR / R knob 0 OFF .. 1 BRT
  ltDisplay: (z: 'l' | 'c' | 'r') => `${P}light.display_${z}`, // DISPLAY L / CTR / R knob 0 .. 1 (AFD brightness)
  ltIntegral: (z: 'l' | 'c' | 'r' | 'cb' | 'ovhd') => `${P}light.integral_${z}`, // INTEGRAL knobs 0 .. 1
  ltMaster: `${P}light.master_sw`, // MASTER INTEG: 0 OFF, 1 AUTO (photocell), 2 ON (Global Vision pedestal; GX PTG 15-11)
  ltDome: 'ac.light.dome_sw', // DOME: 1 ON
  ltMap: (s: 1 | 2) => `${P}light.map${s}`, // pilot / copilot map (side console) knob 0..1
  annunTest: 'alert.annun_test', // LAMP TEST (MASTER / integral panel): momentary 1

  // ======================================================== DOORS (exterior / cabin agents; LGECU monitoring)
  door: (id: 'pax' | 'emer' | 'bag' | 'aft_eqpt' | 'svc_large' | 'svc_small') => `ac.door.${id}_open`, // 1 open / not locked

  // ======================================================== DERIVED (written by systems/logic.ts)
  // Electrical bus power control (priority selectors) are in electrical.ts (`elec.<bus>_sel_src`).
  singleGen: `${P}elec.single_gen`,
  singleTru: `${P}elec.single_tru`,
  ratDeployed: 'ac.rat.deployed', // RAT out (auto or manual); the Fusion synoptic reads this name
  ratDrive: `${P}elec.rat_drive`, // RAT turbine speed proxy (KCAS while deployed)
  ratLatchT: `${P}elec.rat_timer`,
  battEmer: `${P}elec.batt_emer`, // batteries feeding DC ESS / BATT bus (BATT EMER PWR ON)
  acmpCmd: (p: '1b' | '2b' | '3a' | '3b') => `${P}hyd.pump${p}_cmd`,
  pumpRatCmd: `${P}hyd.pumprat_cmd`,
  sovOpen: (n: 1 | 2) => `hyd.sov${n}_open`, // Fusion synoptic reads this name
  priCmd: (s: 'l1' | 'l2' | 'r1' | 'r2') => `${P}fuel.pri_${s}_cmd`,
  auxCmd: (s: 'l' | 'r') => `${P}fuel.aux_${s}_cmd`,
  ctrXferCmd: (s: 'l' | 'r') => `${P}fuel.ctr_${s}_cmd`,
  aftXferCmd: (s: 'l' | 'r') => `${P}fuel.aft_${s}_cmd`,
  wingXferCmd: (d: 'lr' | 'rl') => `${P}fuel.wing_${d}_cmd`,
  recircOn: `${P}fuel.recirc_on`,
  engBleedCmd: (s: 'l' | 'r') => `${P}bleed.${s}_cmd`,
  apuBleedCmd: `${P}bleed.apu_cmd`,
  xbleedCmd: `${P}bleed.xbleed_cmd`,
  packCmd: (s: 'l' | 'r') => `${P}ecs.pack_${s}_cmd`,
  waiCmd: (s: 'l' | 'r') => `${P}ice.wai_${s}_cmd`,
  caiCmd: (s: 'l' | 'r') => `${P}ice.cai_${s}_cmd`,
  probeHeat: `${P}ice.probe_heat`, // HBMU air data probe / AOA vane heat (automatic)
  wshldOn: (s: 'l' | 's' | 'r') => `${P}ice.wshld_${s}_on`,
  iceAutoInhibit: `${P}ice.auto_inhibit`,
  sbCmd: `${P}sb_cmd`, // flight spoiler command (0..1 of full MFS deflection) after the flap / MAX logic
  gldArmed: `${P}gld_armed`,
  gldAutoArm: `${P}gld_auto_arm`,
  idleBoth: `${P}idle_both`,
  idleAny: `${P}idle_any`,
  toThrust: `${P}to_thrust`,
  toPhase: `${P}to_phase`, // take-off thrust phase: TO rating held from the take-off roll to the thrust reduction (logic.ts)
  tlaEff: (i: 1 | 2) => `${P}tla_eff${i}`,
  parkSet: `${P}park_set`, // handle at the locked (parking) position
  emerBrake: `${P}emer_brake`, // proportional emergency brake demand (handle below the lock)
  stallCfg: `${P}stall_cfg`, // flaps deg + 100 x slats: stall protection configuration index
  pusherEnabled: `${P}pusher_enabled`,
  engFail: (i: 1 | 2) => `${P}eng${i}_fail`,
  noTakeoff: `${P}no_takeoff`,
  bankLow: `${P}afcs.low_bank`,
  hornMuteEff: `${P}gear.horn_muted`,
  btmsWarn: `${P}btms.warn`,
  dcpcFail: `${P}elec.dcpc_fail`,

  // ======================================================== 3D COCKPIT INPUTS (added with the cockpit build)
  // The app's input module rewrites input.pitch_trim_rate / input.ap_disc / input.tiller every frame from the
  // keyboard and hardware, so the 3D control-wheel switches and the tiller handle write their own vars and
  // systems/cockpitInputs.ts merges them (the same pattern as the Citation Longitude).
  yokeTrim: (s: 1 | 2) => `${P}yoke.trim${s}`, // control-wheel pitch trim (split) switch, momentary: +1 NOSE UP, 0, -1 NOSE DN
  yokeDisc: (s: 1 | 2) => `${P}yoke.disc${s}`, // AP/SP DISC (MASTER DISC) button held: 1
  tiller3d: `${P}tiller`, // NOSE STEER handwheel of the 3D cockpit -1..1 (+ right)
  // Derived by systems/cockpitInputs.ts:
  yokeTrimCmd: `${P}yoke.trim_cmd`, // merged wheel trim command (pilot priority), read by the stabilizer trim
  discHeld: `${P}yoke.disc_held`, // either AP/SP DISC held: trim and pusher interrupted
  tillerCmd: `${P}tiller_cmd`, // merged tiller command (hardware axis or 3D handle) for the NWS

  // ======================================================== OVERHEAD / SIDE CONSOLES (added with the overhead build)
  // FCOM CSP 700-6 01-10-41 (overhead panel drawing GF0110_024) and 01-10-37 / -46 (side consoles).
  packCtlMan: `${P}ecs.pack_ctl_man`, // derived since fix round 1 (logic.ts): 1 while PACK CONTROL (V.packFlowSel) is at MAN
  ldgElevSlew: `${P}press.ldg_elev_slew`, // LDG ELEV UP / DN toggle (spring to centre): +1 UP, -1 DN; slews ac.press.ldg_elev_ft and selects MAN
  oxyMaskModeR: `${P}oxy.mask2_mode`, // copilot mask regulator N / 100 % / EMERGENCY (0 / 1 / 2); oxyMaskMode is the pilot's
  oxyTest: (s: 1 | 2) => `${P}oxy.mask${s}_test`, // mask stowage box RESET / TEST: momentary 1 (flow check, blinker)
  apuFuelOk: `${P}apu.fuel_ok`, // derived (logic.ts G6kPostLogic): APU fuel supply with a 2 s ride-through of boost-pump changeovers

  // ======================================================== GLOBAL VISION LAYOUT (fix round 1, photos EB190582 / N835GL)
  // BLEED / AIR COND (GX IAMS PTG 13 "AUX PRESS Switch", "PACK CONTROL Selector", L / R MAN TEMP)
  auxPress: 'ac.ecs.aux_press_sw', // AUX PRESS PBA (clear guard): 1 ON (trim air used for pressurization)
  auxPressGuard: `${P}ecs.aux_press_guard`,
  packFlowSel: `${P}ecs.pack_ctl_sel`, // PACK CONTROL rotary: 0 LO, 1 NORM, 2 HIGH, 3 MAN (GX PTG 13: flow control valve full open, ACSC off)
  packManTempSw: (s: 'l' | 'r') => `${P}ecs.pack_${s}_man_temp_sw`, // L / R MAN TEMP toggle, spring to centre: +1 HOT, 0, -1 COLD (slews V.packManTemp, logic.ts)
  // CABIN SYSTEMS (aft-left overhead module): CABIN OUTLETS / CABIN POWER PBAs (CABIN POWER = V.cabinPwr)
  cabinOutlets: 'ac.elec.cabin_outlets_sw', // CABIN OUTLETS PBA: 1 ON (cabin 115 VAC / 60 Hz outlets)
  // ENGINE panel (GX PTG 17 "ENGINE START Selector"; photo: START L CRANK / AUTO / R CRANK, MODE L / R N1 / EPR)
  engStartSel: `${P}eng.start_sel`, // START rotary: -1 L CRANK, 0 AUTO, +1 R CRANK
  // ELECTRICAL
  ratGenGuard: `${P}elec.rat_gen_guard`, // RAT GEN clear flip guard (1 open)
  // EXTERNAL LIGHTS (GX PTG 15-28: landing lights OFF / PULSE / STEADY, 45 pulses/min, L / R alternately)
  ldgPulse: `${P}light.ldg_pulse`, // derived (logic.ts): 1 = left-side phase of the 45 /min PULSE cycle, 0 = right-side phase
  // COCKPIT LIGHTS INTEGRAL / MISC (GX PTG 15-11 .. 15-13; photo EB190582 aft-right pedestal)
  ltArea: `${P}light.area`, // AREA (FLOOR / CEILING) knob 0 OFF .. 1 BRT (area lights: drives the overhead flood)
  ltPbaDim: `${P}light.pba_dim_sw`, // PBA DIM / BRT toggle: 0 DIM, 1 BRT (switchlight legends)
  ltCtp: (s: 1 | 2) => `${P}light.ctp${s}_brt`, // CTP 1 / 2 BRT / OFF knob 0 OFF .. 1 BRT (CTP display)
  ltEyeRef: `${P}light.eye_ref_sw`, // EYE REF ON / OFF: 1 ON (eye-reference light)
  ltFoot: `${P}light.foot_sw`, // FOOT ON / OFF: 1 ON (floor / footwell lights)
  // Standby compass (overhead forward edge, "STANDBY COMPASS PULL DOWN TO OPEN")
  compassOpen: `${P}compass.open`, // 1 pulled down (readable), 0 stowed
  compassHdg: `${P}compass.hdg_deg`, // derived (vision.ts): damped magnetic compass card heading
  compassReadable: `${P}compass.readable`, // derived (vision.ts): 1 with the compass pulled down (card visible)
  // Glareshield HUD / EVS knobs (pilot side; GX PTG 15-18 "brightness control knob on the glareshield")
  hudBrt: `${P}hud.brt`, // HUD DIM .. BRT knob 0..1 (0 = display off)
  hudModeBtn: `${P}hud.mode_btn`, // HUD knob PUSH/MODE: momentary 1 (vision.ts cycles V.hudMode)
  hudMode: `${P}hud.mode`, // derived (vision.ts): HUD display mode 0 PRI / 1 AIII / 2 VMC / 3 IMC (EST mode set, SCOPE)
  hudStow: `${P}hud.combiner_stowed`, // HUD combiner: 1 stowed ("PUSH" latch), 0 deployed
  evsGain: `${P}evs.gain`, // EVS MIN .. MAX knob 0..1
  evsCal: `${P}evs.cal_btn`, // EVS knob push (EVS CAL): momentary 1
  hudOn: `${P}hud.on`, // derived (logic.ts): HUD symbology shown (power, BRT > 0, combiner deployed, DC BUS 1)
  // Gaspers (outboard main-panel wings, overhead aft corners and forward edge): eyeball open 0..1
  gasper: (id: string) => `${P}ecs.gasper_${id}`,
  // Control wheel R/T / IC rocker (horn rear): +1 R/T, -1 IC, 0 (spring to centre)
  yokePtt: (s: 1 | 2) => `${P}yoke.ptt${s}`,
  // Pedestal EVENT button (flight-data recorder event marker)
  fdrEvent: `${P}fdr.event_btn`, // momentary 1
  fdrEventCount: `${P}fdr.event_count`, // derived (logic.ts): number of event marks recorded this flight
  packFlowFactor: `${P}ecs.pack_flow_factor`, // derived (vision.ts): pack flow demand / NORM (LO 0.67, NORM 1, HIGH / MAN / single pack 1.33)
  gasperFlow: `${P}ecs.gasper_flow`, // derived (vision.ts): sum of the cockpit gasper openings (0..6)
  pttKeyed: `${P}comm.ptt`, // derived (vision.ts): 1 R/T keyed (either wheel), -1 IC (intercom) keyed, 0 idle
  evsCalT: `${P}evs.cal_timer`, // derived (vision.ts): EVS calibration running (s left)
  hudModeEff: `${P}hud.mode_eff`, // derived (vision.ts): HUD display mode shown (-1 = HUD blank)
} as const;

/** Gasper eyeballs: main-panel wings L / R, overhead aft corners L / R, overhead forward edge L / R. */
export const G6K_GASPERS = ['wing_l', 'wing_r', 'ovhd_aft_l', 'ovhd_aft_r', 'ovhd_fwd_l', 'ovhd_fwd_r'] as const;

type S = 'l' | 'r';
const LR: S[] = ['l', 'r'];

/** Every cockpit control var (inputs), for the "every control is consumed" audit test. */
export const G6K_CONTROL_VARS: string[] = [
  G6K_VARS.extAc,
  ...([1, 2, 3, 4] as const).map((n) => G6K_VARS.gen(n)),
  G6K_VARS.extDc,
  G6K_VARS.apuGen,
  G6K_VARS.ratGen,
  G6K_VARS.battMaster,
  G6K_VARS.cabinPwr,
  ...([1, 2, 3, 4] as const).map((n) => G6K_VARS.acBusIsol(n)),
  ...(['dc_bus1', 'dc_bus2', 'dc_ess', 'batt_bus'] as const).map((b) => G6K_VARS.dcBusIsol(b)),
  G6K_VARS.extAcAvail,
  G6K_VARS.extDcAvail,
  G6K_VARS.wshldL,
  G6K_VARS.wshldR,
  G6K_VARS.hydSovL,
  G6K_VARS.hydSovR,
  ...(['1b', '2b', '3a', '3b'] as const).map((p) => G6K_VARS.hydPump(p)),
  G6K_VARS.auralMute(1),
  G6K_VARS.auralMute(2),
  G6K_VARS.noSmoking,
  G6K_VARS.seatBelts,
  G6K_VARS.emerLights,
  G6K_VARS.ltLdgL,
  G6K_VARS.ltLdgNose,
  G6K_VARS.ltLdgR,
  G6K_VARS.ltTaxi,
  G6K_VARS.ltNav,
  G6K_VARS.ltBeacon,
  G6K_VARS.ltStrobe,
  G6K_VARS.ltWing,
  G6K_VARS.ltLogo,
  G6K_VARS.apuSw,
  G6K_VARS.engStartSel,
  G6K_VARS.ignition,
  ...LR.map((s) => G6K_VARS.priPumps(s)),
  ...LR.map((s) => G6K_VARS.auxPump(s)),
  G6K_VARS.xfeed,
  ...LR.map((s) => G6K_VARS.recirc(s)),
  G6K_VARS.aftXfer,
  G6K_VARS.wingXfer,
  ...LR.map((s) => G6K_VARS.engBleed(s)),
  G6K_VARS.apuBleed,
  G6K_VARS.xbleed,
  ...LR.map((s) => G6K_VARS.pack(s)),
  G6K_VARS.trimAir,
  G6K_VARS.recircFan,
  G6K_VARS.ramAir,
  ...([1, 2, 3] as const).map((z) => G6K_VARS.zoneTemp(z)),
  G6K_VARS.wingAi,
  ...LR.map((s) => G6K_VARS.cowlAi(s)),
  G6K_VARS.wingXbleed,
  ...(['l', 'apu', 'r'] as const).flatMap((z) => [G6K_VARS.fireHandle(z), G6K_VARS.fireDisch(z, 1), G6K_VARS.fireDisch(z, 2)]),
  G6K_VARS.fireTest,
  G6K_VARS.pressAutoMan,
  G6K_VARS.pressManAlt,
  G6K_VARS.pressManRate,
  G6K_VARS.ldgElevFms,
  G6K_VARS.ldgElevFt,
  G6K_VARS.outflowClosed(1),
  G6K_VARS.outflowClosed(2),
  G6K_VARS.emerDepress,
  G6K_VARS.ditching,
  G6K_VARS.elt,
  G6K_VARS.pusher(1),
  G6K_VARS.pusher(2),
  G6K_VARS.stallTest,
  G6K_VARS.oxyMask(1),
  G6K_VARS.oxyMask(2),
  G6K_VARS.oxyMaskMode,
  G6K_VARS.crewOxy,
  G6K_VARS.paxOxy,
  G6K_VARS.tla(1),
  G6K_VARS.tla(2),
  G6K_VARS.revLever(1),
  G6K_VARS.revLever(2),
  G6K_VARS.engRun(1),
  G6K_VARS.engRun(2),
  G6K_VARS.engN1Mode(1),
  G6K_VARS.engN1Mode(2),
  G6K_VARS.flapLever,
  G6K_VARS.flightSpoiler,
  G6K_VARS.stabCh(1),
  G6K_VARS.stabCh(2),
  G6K_VARS.ailTrimSw,
  G6K_VARS.rudTrimSw,
  G6K_VARS.terrOff,
  G6K_VARS.gsMute,
  G6K_VARS.flapOvrd,
  G6K_VARS.gldManArm,
  G6K_VARS.gldOff,
  G6K_VARS.autobrake,
  G6K_VARS.gearHandle,
  G6K_VARS.gearDnLckRel,
  G6K_VARS.gearManRelease,
  G6K_VARS.nwsArm,
  G6K_VARS.hornMute,
  G6K_VARS.btmsReset,
  G6K_VARS.parkBrake,
  G6K_VARS.dcEmerOvrd,
  G6K_VARS.ratDeploy,
  ...([1, 2, 3] as const).map((n) => G6K_VARS.irsMode(n)),
  ...(['l', 'c', 'r'] as const).map((z) => G6K_VARS.ltDisplay(z)),
  ...(['l', 'c', 'r', 'cb', 'ovhd'] as const).map((z) => G6K_VARS.ltIntegral(z)),
  G6K_VARS.ltMaster,
  G6K_VARS.ltDome,
  G6K_VARS.ltMap(1),
  G6K_VARS.ltMap(2),
  ...(['pax', 'emer', 'bag', 'aft_eqpt', 'svc_large', 'svc_small'] as const).map((d) => G6K_VARS.door(d)),
  G6K_VARS.yokeTrim(1),
  G6K_VARS.yokeTrim(2),
  G6K_VARS.yokeDisc(1),
  G6K_VARS.yokeDisc(2),
  G6K_VARS.tiller3d,
  G6K_VARS.ldgElevSlew,
  G6K_VARS.oxyMaskModeR,
  G6K_VARS.oxyTest(1),
  G6K_VARS.oxyTest(2),
  // Global Vision layout (fix round 1)
  G6K_VARS.auxPress,
  G6K_VARS.packFlowSel,
  ...LR.map((s) => G6K_VARS.packManTempSw(s)),
  G6K_VARS.cabinOutlets,
  G6K_VARS.ltArea,
  G6K_VARS.ltPbaDim,
  G6K_VARS.ltCtp(1),
  G6K_VARS.ltCtp(2),
  G6K_VARS.ltEyeRef,
  G6K_VARS.ltFoot,
  G6K_VARS.compassOpen,
  G6K_VARS.hudBrt,
  G6K_VARS.hudModeBtn,
  G6K_VARS.hudStow,
  G6K_VARS.evsGain,
  G6K_VARS.evsCal,
  G6K_VARS.yokePtt(1),
  G6K_VARS.yokePtt(2),
  G6K_VARS.fdrEvent,
  ...G6K_GASPERS.map((g) => G6K_VARS.gasper(g)),
];

/** Events emitted by cockpit buttons (momentary commands). */
export const G6K_EVENTS = {
  masterWarning: 'cas.ack_warning', // MASTER WARNING switchlights (glareshield, both sides)
  masterCaution: 'cas.ack_caution', // MASTER CAUTION switchlights
  atDisc: 'at.disc', // A/T disconnect buttons (outboard of each thrust lever)
  atEngage: 'at.engage', // FCP A/T button (collins-fusion FCP emits it)
  toga: 'ap.toga', // TO/GA buttons (inboard of the thrust levers); also input.toga
  apDiscYoke: 'input.ap_disc', // AP/SP DISC (MASTER DISC) on each control wheel: held var
  tcs: 'ap.cws', // TCS (touch control steering) on each control wheel: { pressed }
  fpvCage: (s: 1 | 2) => `fusion.s${s}.fpv_cage`, // FPV CAGE on each control wheel (FSB)
  tawsTest: 'taws.test',
  tawsGsCancel: 'taws.gs_cancel',
} as const;
