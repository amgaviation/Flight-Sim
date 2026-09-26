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
  cabinPwr: 'ac.elec.cabin_pwr_sw', // CABIN PWR toggle: 1 ON
  acBusIsol: (n: 1 | 2 | 3 | 4) => `ac.elec.ac_bus${n}_isol`, // EMS CDU EMER CNTL: 1 = bus manually isolated (MAN OFF)
  dcBusIsol: (b: 'dc_bus1' | 'dc_bus2' | 'dc_ess' | 'batt_bus') => `ac.elec.${b}_isol`, // EMS CDU EMER CNTL DC buses
  extAcAvail: `${P}elec.ext_ac_cart`, // ramp: AC ground power cart connected (service menu / states)
  extDcAvail: `${P}elec.ext_dc_cart`, // ramp: DC ground power unit connected

  // ---- WINDSHIELD HEAT (GX_01_018)
  wshldL: 'ac.ice.wshld_l_sw', // L PBA: 1 ON, 0 OFF/RESET
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
  ltLdgL: 'ac.light.landing_l_sw', // LANDING L WING: 1 ON
  ltLdgNose: 'ac.light.landing_nose_sw', // LANDING NLG: 1 ON (nose-gear lamps, gear down only)
  ltLdgR: 'ac.light.landing_r_sw', // LANDING R WING
  ltTaxi: 'ac.light.taxi_sw', // TAXI/RECOG: 1 ON
  ltNav: 'ac.light.nav_sw', // NAV: 1 ON
  ltBeacon: 'ac.light.beacon_sw', // BEACON: 1 ON (red anti-collision)
  ltStrobe: 'ac.light.strobe_sw', // STROBE: 1 ON (white anti-collision)
  ltWing: 'ac.light.wing_sw', // WING INSP: 1 ON
  ltLogo: 'ac.light.logo_sw', // LOGO: 1 ON
  // ---- APU (GXAPU): rotary OFF 0, RUN 1, START 2 (spring-loaded START -> RUN)
  apuSw: 'ac.apu.master_sw',
  // ---- ENGINE (GX_01_018 ENGINE panel)
  engStart: (i: 1 | 2) => `${P}eng.start${i}_btn`, // L / R START PBA: momentary 1 (FADEC auto start)
  engCrank: (i: 1 | 2) => `${P}eng.crank${i}_sw`, // L / R CRANK PBA: alternate action 1 = crank (dry motoring)
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
  packManTemp: (s: 'l' | 'r') => `${P}ecs.pack_${s}_man_temp`, // PACK CONTROL L / R MAN TEMP knob: 0 AUTO (full CCW), 0.05..1 COLD -> HOT manual outlet
  zoneTemp: (z: 1 | 2 | 3) => `ac.ecs.zone${z}_temp_c`, // TEMPERATURE COCKPIT / FWD CABIN / AFT CABIN knob: 16..30 degC
  // ---- ANTI-ICE (GX_01_018)
  wingAi: 'ac.ice.wing_sw', // WING rotary: 0 OFF, 1 AUTO, 2 ON
  cowlAi: (s: 'l' | 'r') => `ac.ice.cowl_${s}_sw`, // L / R COWL rotary: 0 OFF, 1 AUTO, 2 ON
  wingXbleed: `${P}ice.wing_xbleed_sw`, // WING XBLEED PBA: 1 ON (one engine supplies both wings)
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
  hudPower: `${P}hud.power_sw`, // HUD combiner / power (optional equipment): 1 ON
  tiller: 'input.tiller', // NOSE STEER handwheel (pilot side console): +/-75 deg

  // ======================================================== PEDESTAL
  tla: (i: 1 | 2) => `ac.tla${i}`, // thrust lever 0 IDLE .. 1 MAX
  revLever: (i: 1 | 2) => `${P}rev_lever${i}`, // piggy-back reverse lever 0 stowed .. 1 MAX REV (IDLE REV ~0.1)
  engRun: (i: 1 | 2) => `${P}eng.run${i}_sw`, // ENG RUN L / R toggle (lift to move): 1 RUN, 0 OFF
  engN1Mode: (i: 1 | 2) => `ac.eng${i}.n1_mode`, // ENGINE EPR/N1 PBA: 0 EPR (normal), 1 N1 (FADEC alternate mode)
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
  dcEmerOvrd: `${P}elec.dc_emer_ovrd`, // ELECT DC PWR EMER OVRD (guarded): 1 OVRD
  dcEmerOvrdGuard: `${P}elec.dc_emer_ovrd_guard`,
  ratDeploy: `${P}rat.deploy_handle`, // RAT manual deploy handle: 1 pulled (latched until stowed on the ground)
  irsMode: (n: 1 | 2 | 3) => `ac.irs${n}_mode`, // IRS 1 / 2 / 3 rotary: 0 OFF, 1 ALN, 2 NAV, 3 ATT
  // ---- COCKPIT LIGHTS (GXLT: FLOOD/DISPLAY and INTEGRAL/MISC panels)
  ltFlood: (z: 'l' | 'c' | 'r') => `${P}light.flood_${z}`, // FLOOD L / CTR / R knob 0 OFF .. 1 BRT
  ltDisplay: (z: 'l' | 'c' | 'r') => `${P}light.display_${z}`, // DISPLAY L / CTR / R knob 0 .. 1 (AFD brightness)
  ltIntegral: (z: 'l' | 'c' | 'r' | 'cb' | 'ovhd') => `${P}light.integral_${z}`, // INTEGRAL knobs 0 .. 1
  ltMaster: `${P}light.master_sw`, // MASTER DIM: 0 OFF, 1 DIM, 2 BRT (lamp test on BRT hold? no: TEST separate)
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
} as const;

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
  G6K_VARS.engStart(1),
  G6K_VARS.engStart(2),
  G6K_VARS.engCrank(1),
  G6K_VARS.engCrank(2),
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
  ...LR.map((s) => G6K_VARS.packManTemp(s)),
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
  G6K_VARS.hudPower,
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
  ...(['l', 'c', 'r'] as const).flatMap((z) => [G6K_VARS.ltFlood(z), G6K_VARS.ltDisplay(z)]),
  ...(['l', 'c', 'r', 'cb', 'ovhd'] as const).map((z) => G6K_VARS.ltIntegral(z)),
  G6K_VARS.ltMaster,
  G6K_VARS.ltDome,
  G6K_VARS.ltMap(1),
  G6K_VARS.ltMap(2),
  ...(['pax', 'emer', 'bag', 'aft_eqpt', 'svc_large', 'svc_small'] as const).map((d) => G6K_VARS.door(d)),
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
