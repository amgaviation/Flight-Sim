/**
 * Citation M2 cockpit control vars: the contract between the cockpit (3D
 * controls write these), the systems (read them) and the states/checklists.
 * Every control of the inventory in docs/aircraft/citation-m2.md §9 maps to
 * one entry here; the comment gives the value convention. All aircraft-
 * specific vars use the `ac.m2.` prefix (CLAUDE.md).
 *
 * Positions are listed bottom -> top (or left -> right) with their values,
 * matching the cockpit ToggleSwitch `positions`/`values` options.
 */

const P = 'ac.m2.';

export const M2 = {
  // ---------------------------------------------------------------- LH instrument panel: ELECTRICAL POWER panel
  /** BATTERY: EMER (-1) / OFF (0) / BATT (1). EMER feeds only the emergency bus from the battery. */
  battSw: `${P}batt_sw`,
  /** L / R GENERATOR: RESET (-1, spring-loaded to OFF) / OFF (0) / GEN (1). */
  genSw: (i: number) => `${P}gen${i}_sw`,
  /** AVIONICS: DISPATCH (-1) / OFF (0) / ON (1). DISPATCH powers PFD1, GTC1, GIA1 (COM1/GPS1) from the emergency bus. */
  avionicsSw: `${P}avionics_sw`,
  /**
   * STBY FLT DISPLAY switch (ELECTRICAL POWER panel): OFF (0) / ON (1) / TEST (2, spring-loaded to ON).
   * M2 flows cockpit prep "STBY FLT DISPLAY SWITCH - TEST/ON", shutdown "- OFF"; CJ-family AFM 4-5 "Standby Gyro
   * Switch - TEST; ON". The ESI-1000 is powered (bus or its own battery) only with the switch ON / TEST; TEST
   * runs it from its battery and lights the STBY BATT test light (systems/logic.ts).
   */
  stbyDispSw: `${P}stby_disp_sw`,
  /** STBY BATT test light beside the switch (written by the logic). */
  stbyBattLight: `${P}stby_batt_lt`,
  /**
   * BATTERY DISCONNECT (guarded, LH sidewall above the pilot's armrest; CAE CJ-family differences p.5-23):
   * NORMAL (0) / DISC (1). DISC opens the battery disconnect relay between the NiCd and the HOT BATT bus; the
   * relay coil drains the battery slowly while held (systems/electrical.ts).
   */
  battDisc: `${P}batt_disc`,
  /** Ground power unit plugged in and on (external receptacle under the LH pylon; set from the ground-services menu). */
  gpuConnected: `${P}gpu_connected`,

  // ---------------------------------------------------------------- Pedestal: ENGINE START panel and throttle quadrant
  /** L / R ENGINE START push buttons (momentary 1 while pressed); annunciator light var startLight(i). */
  startBtn: (i: number) => `${P}start${i}`,
  startLight: (i: number) => `${P}start${i}_lt`,
  /** START DISENGAGE push button (momentary). */
  startDiseng: `${P}start_diseng`,
  /** L / R IGNITION: NORM (0) / ON (1). Set on the GTC ENGINE page (AOPA Mar 2014: ignition in the G3000; no pedestal switch). */
  ignSw: (i: number) => `${P}ign${i}_sw`,
  /** Throttle levers: CUTOFF (-0.1, gated, finger lift) / IDLE 0 / CRU 0.62 / CLB 0.82 / TO 1.0 (detents). */
  tla: (i: number) => `${P}tla${i}`,
  /** Derived FADEC lever input max(0, tla) (systems). */
  fadecTla: (i: number) => `${P}fadec_tla${i}`,
  // TO/GA button on the LH throttle: writes input.toga (momentary).

  // ---------------------------------------------------------------- Tilt panel: FUEL
  /**
   * L / R FUEL BOOST: OFF (-1) / NORM (0) / ON (1) (CAE differences p.5-30: 3-position; OFF = pump de-energized,
   * no automatic operation). NORM = automatic on start, low fuel pressure and transfer.
   */
  boostSw: (i: number) => `${P}boost${i}_sw`,
  /** FUEL TRANSFER selector: L TANK (-1) / OFF (0) / R TANK (1): transfer from the selected tank to the other. */
  fuelXfer: `${P}fuel_xfer`,

  // ---------------------------------------------------------------- Glareshield: ENG FIRE / BOTTLE ARMED
  /** L / R ENG FIRE lighted push buttons (alternate action, 1 = pushed in = armed: fuel, hydraulic, bleed and generator off). */
  engFireBtn: (i: number) => `${P}eng_fire${i}`,
  engFireLight: (i: number) => `${P}eng_fire${i}_lt`,
  /** BOTTLE 1 / 2 ARMED push buttons (momentary): discharge into the armed engine. Light vars bottleLight(n). */
  bottleBtn: (n: number) => `${P}bottle${n}`,
  bottleLight: (n: number) => `${P}bottle${n}_lt`,
  /** MASTER WARNING / MASTER CAUTION lighted buttons (L and R): emit cas.ack_warning / cas.ack_caution. */

  // ---------------------------------------------------------------- Tilt panel: ICE PROTECTION
  /** PITOT & STATIC heat (L, R pitot-static and AOA vane): OFF (0) / ON (1). */
  pitotStaticSw: `${P}pitot_static_sw`,
  /** L / R ENGINE ANTI-ICE: OFF (0) / ON (1). */
  engAiSw: (i: number) => `${P}eng_ai${i}_sw`,
  /** WING ANTI-ICE (L and R wing leading edges): OFF (0) / ON (1). */
  wingAiSw: `${P}wing_ai_sw`,
  /** TAIL DE-ICE: MANUAL (-1, momentary) / OFF (0) / AUTO (1). */
  tailDeiceSw: `${P}tail_deice_sw`,
  /** L / R W/S BLEED (windshield anti-ice / rain): OFF (0) / LOW (1) / HI (2). */
  wsBleedSw: (i: number) => `${P}ws_bleed${i}_sw`,
  /** W/S ALCOHOL (pilot windshield backup anti-ice): OFF (0) / ON (1). */
  wsAlcoholSw: `${P}ws_alcohol_sw`,

  // ---------------------------------------------------------------- Tilt panel: PRESSURIZATION / ENVIRONMENTAL
  /**
   * AIR SOURCE SELECT: OFF (0) / L (1) / R (2) / BOTH (3) / EMER (4) / FRESH AIR (5) (CJ-family AFM: "Air Source
   * Select - BOTH"; smoke procedure "... FRESH AIR (cabin will depressurize)"). Values: PRESS_SRC.
   */
  pressSource: `${P}press_source`,
  /** CABIN DUMP (guarded): NORM (0) / DUMP (1). */
  cabinDump: `${P}cabin_dump`,
  /** PRESSURIZATION mode: AUTO (0) / MANUAL (2) (value matches Pressurization.mode). GTC ENVIRONMENTAL page. */
  pressMode: `${P}press_mode`,
  /**
   * MANUAL cabin rate command -1 (DN, climb cabin) / 0 / +1 (UP, descend cabin); valve command -1 close .. +1 open.
   * Driven by the GTC ENVIRONMENTAL page CABIN UP / CABIN DN buttons (events pressManUp / pressManDn, 1 s per press).
   */
  pressManual: `${P}press_manual`,
  /** Landing field elevation (ft) entered on the GTC (S&D15 §9.5). */
  landingElevFt: `${P}ldg_elev_ft`,
  /** Takeoff field elevation (ft MSL), latched on the ground: the pressurization controller's landing elevation when none is entered and no FMS destination exists (EST, CJ family). */
  takeoffFieldElevFt: `${P}to_field_elev_ft`,
  /** AIR COND (vapor cycle): OFF (0) / ON (1). */
  airCondSw: `${P}air_cond_sw`,
  /** CABIN FAN: OFF (0) / LOW (1) / HIGH (2). */
  cabinFan: `${P}cabin_fan`,
  /** TEMP CONTROL: AUTO (0) / MANUAL (1). */
  tempMode: `${P}temp_mode`,
  /** Cabin temperature selector knob 0 (COLD) .. 1 (HOT). */
  tempSel: `${P}temp_sel`,
  /** Manual temperature (MANUAL mode): COLD (-1) / hold (0) / HOT (1) spring-loaded. */
  tempManual: `${P}temp_man`,
  /** Cockpit air / windshield defog diverter knob 0 (cabin) .. 1 (defog). */
  airDistrib: `${P}air_distrib`,

  // ---------------------------------------------------------------- Oxygen
  /** PASS OXY selector: CREW ONLY (0) / NORM (1, auto drop at 13,500 ft cabin) / MANUAL DROP (2). */
  paxOxy: `${P}pax_oxy`,
  /** Crew masks donned (quick-donning mask stowage doors open). */
  maskOn: (side: number) => `${P}mask${side}_on`,
  /** Crew mask regulator: NORMAL (0) / 100% (1) / EMERGENCY (2). */
  maskMode: (side: number) => `${P}mask${side}_mode`,

  // ---------------------------------------------------------------- Tilt panel: LANDING GEAR control module
  /** Gear handle: UP (0) / DN (1); locked down on the ground (gear.handle_lock). */
  gearHandle: `${P}gear_handle`,
  /** Gear warning horn silence button (momentary, emits gear.horn_silence). */
  gearHornSilence: `${P}gear_horn_sil`,
  /** EMERGENCY GEAR RELEASE T-handle (below the panel): 0 stowed / 1 pulled (uplock release, free fall). */
  gearEmerRelease: `${P}gear_emer`,
  /** Gear BLOW DOWN knob (pneumatic): 0 / 1 pulled. */
  gearBlowdown: `${P}gear_blowdown`,
  /** ANTISKID switch: OFF (0) / ON (1). */
  antiskidSw: `${P}antiskid_sw`,

  // ---------------------------------------------------------------- Below the panel: brakes, control lock
  /** PARKING BRAKE handle: 0 in / 1 pulled (set). */
  parkBrake: `${P}park_brake`,
  /** EMERGENCY BRAKE handle 0..1 (pneumatic, no anti-skid). */
  emerBrake: `${P}emer_brake`,
  /** Control lock handle: 0 stowed / 1 engaged (locks rudder, elevators, ailerons and throttles). */
  controlLock: `${P}control_lock`,
  /** Rain removal door levers L / R: 0 closed / 1 open. */
  rainDoor: (i: number) => `${P}rain_door${i}`,

  // ---------------------------------------------------------------- Pedestal: flaps, speed brake, trims
  /** Flap handle detents: 0 UP / 1 15 (T.O. & APPR) / 2 35 (LAND) / 3 60 (GND). */
  flapHandle: `${P}flap_handle`,
  /** SPEED BRAKE handle: RETRACT (0) / EXTEND (1). */
  speedbrake: `${P}speedbrake`,
  /** Elevator trim wheel position (TrimAxis units -1 nose down .. +1 nose up). */
  pitchTrim: `${P}pitch_trim`,
  /** Aileron trim knob position (-1 LWD .. +1 RWD). */
  aileronTrim: `${P}ail_trim`,
  /** Rudder trim knob position (-1 nose left .. +1 nose right). */
  rudderTrim: `${P}rud_trim`,
  /** Control-wheel pitch trim switches (pilot / copilot): -1 nose down / 0 / +1 nose up. */
  yokeTrim: (side: number) => `${P}yoke_trim${side}`,
  // Control wheel AP/TRIM DISC button: input.ap_disc. CWS button: event ap.cws { pressed }.

  // ---------------------------------------------------------------- Tilt panel: LIGHTS
  /** NAV lights: OFF (0) / ON (1). */
  navLt: `${P}nav_lt`,
  /** ANTI-COLL: OFF (0) / BEACON (1) / ALL (2, beacon + wingtip strobes). */
  antiColl: `${P}anti_coll`,
  /** LANDING / RECOG: OFF (0) / PULSE (1) / ON (2). */
  landingLt: `${P}landing_lt`,
  /** TAXI lights: OFF (0) / ON (1). */
  taxiLt: `${P}taxi_lt`,
  /** TAIL (logo) lights: OFF (0) / ON (1). */
  logoLt: `${P}logo_lt`,
  /** WING INSP / ice detection lights: OFF (0) / ON (1). */
  wingInspLt: `${P}wing_insp_lt`,
  /** PANEL LIGHTS dimmer 0 (OFF) .. 1. */
  panelLt: `${P}panel_lt`,
  /** Pedestal / tilt panel backlighting dimmer 0..1. */
  pedestalLt: `${P}pedestal_lt`,
  /** Glareshield floodlight dimmer 0..1. */
  floodLt: `${P}flood_lt`,
  /** Overhead map lights L / R dimmer 0..1. */
  mapLt: (side: number) => `${P}map_lt${side}`,
  /** DISPLAYS dimmer (glareshield DIMMING group): 0 = automatic (photocell) .. 1 manual full bright (GDUs). */
  displayDim: `${P}display_dim`,
  /** TOUCH CONTROLS dimmer (glareshield DIMMING group): 0 = automatic (photocell) .. 1 (GTC 570 brightness). */
  gtcDim: `${P}gtc_dim`,
  /** PASS SAFETY: OFF (0) / BELT (1) / BELT & NO SMOKE (2). */
  paxSafety: `${P}pax_safety`,
  /** CABIN LIGHTS master: OFF (0) / ON (1). */
  cabinLt: `${P}cabin_lt`,

  // ---------------------------------------------------------------- Tilt panel: misc
  /** EMER COMM (guarded): NORM (0) / EMER (1): COM1 tuned to 121.5 MHz. */
  emerComm: `${P}emer_comm`,
  /** EVENT marker button (momentary). */
  eventMarker: `${P}event_marker`,
  /** CVR TEST button (momentary). */
  cvrTest: `${P}cvr_test`,
  /** ELT remote switch: ARM (0) / ON (1) / RESET-TEST (-1, momentary). */
  eltSw: `${P}elt_sw`,
  /**
   * SYSTEM TESTS selection (GTC Aircraft Systems > SYSTEM TESTS page; no hardware rotary on the M2, AOPA Mar 2014):
   * OFF 0 / FIRE WARN 1 / ANNU (lamps) 2 / STALL WARN 3 / O'SPEED 4 / LDG GEAR 5 / TAWS 6. Returns to OFF after
   * TEST_AUTO_OFF_S (systems/logic.ts).
   */
  testSel: `${P}test_sel`,

  /** EMERGENCY LIGHTS switch: OFF (0) / ARMED (1) / ON (2) (M2 flows: prep ARMED, shutdown OFF; EST location RH tilt panel). */
  emerLtsSw: `${P}emer_lts_sw`,
  /** Push-to-talk switches under each armrest (AOPA Mar 2014: "yoke-free push-to-talk"), 1 while pressed. */
  ptt: (side: number) => `${P}ptt${side}`,

  // ---------------------------------------------------------------- Doors (ground services menu / exterior)
  doorOpen: (door: 'cabin' | 'emer_exit' | 'nose_bag_l' | 'nose_bag_r' | 'tail_bag') => `${P}door_${door}`,

  // ---------------------------------------------------------------- Derived / indicator outputs (systems write)
  hydDemand: `${P}hyd_demand`,
  sbCommand: `${P}sb_cmd`,
  esiPowered: `${P}esi_powered`,
  iceWing: `${P}ice_wing`,
  iceTail: `${P}ice_tail`,
  hydPressOn: `${P}hyd_press_on`,
  gearHornActive: `${P}gear_horn_active`,
} as const;

/** Throttle detent lever values (FADEC detent law). */
export const TLA = { cutoff: -0.1, idle: 0, cru: 0.62, clb: 0.82, to: 1.0 } as const;

/** AIR SOURCE SELECT values. */
export const PRESS_SRC = { off: 0, l: 1, r: 2, both: 3, emer: 4, fresh: 5 } as const;

/** GTC ENVIRONMENTAL page manual cabin-altitude buttons (events). */
export const M2_EVENTS = { pressManUp: 'ac.m2.press_man_up', pressManDn: 'ac.m2.press_man_dn' } as const;

/** Values of the SYSTEM TEST selector. */
export const TEST_SEL = { off: 0, fire: 1, annu: 2, stall: 3, overspeed: 4, gear: 5, taws: 6 } as const;
