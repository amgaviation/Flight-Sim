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
  /**
   * BATTERY: EMER (-1) / OFF (0) / BATT (1), red lever-lock cap. The M2 has no avionics master: "there is no avionics
   * switch; a single battery switch controls both of the batteries and the avionics master" (AOPA Pilot, Mar 2014).
   * BATT closes the battery relay and the avionics relays; EMER feeds only the emergency bus from the battery
   * (525AFM-06 p.3-26: FLIGHT GUIDANCE SYSTEM INOPERATIVE on EMER).
   */
  battSw: `${P}batt_sw`,
  /** L / R GENERATOR: RESET (-1, spring-loaded to OFF) / OFF (0) / GEN (1). */
  genSw: (i: number) => `${P}gen${i}_sw`,
  /**
   * DISPATCH (ELECTRICAL POWER panel, second row, amber LED): OFF (0) / DISPATCH (1). "There is a dispatch switch that
   * powers GTC number 1 and the multifunction display" for ground communication and flight planning (AOPA Mar 2014),
   * from the auxiliary battery in the nose (AOPA: "activates an auxiliary battery in the nose which powers one radio,
   * one display and one GTC 570"). Model: aux battery -> MFD, GTC 1, GIA 1 (COM 1 / GPS 1) and audio 1 (EST: the
   * radio needs the audio panel); PFD 1 stays off (systems/electrical.ts). Light: dispatchLight.
   */
  dispatchSw: `${P}dispatch_sw`,
  /** Amber LED beside the DISPATCH switch: lit while the dispatch relay is closed (written by the logic). */
  dispatchLight: `${P}dispatch_lt`,
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
  /** Latched low-fuel-pressure boost activation (NORM; reset by OFF or ON and back to NORM, 525AFM-06 p.3-115). Logic output. */
  boostLatch: (i: number) => `${P}boost${i}_latch`,
  /**
   * FUEL TRANSFER selector: L TANK (-1) / OFF (0) / R TANK (1). "Fuel is transferred in the direction of the arrow
   * on the FUEL TRANSFER selector (i.e. if the selector is turned clockwise, the arrow points to R TANK and fuel is
   * transferred from the left tank)" (525AFM-06 p.3-113): R TANK runs the LEFT boost pump and moves fuel left -> right.
   */
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
  /**
   * L / R WING/ENG ANTI-ICE: OFF (0) / ENG ON (1) / WING/ENG (2) (525AFM-06 p.3-99: per-side switches; wing anti-ice
   * only together with the engine inlet). Engine inlet heat for >= 1, the side's wing valve for 2.
   */
  engAiSw: (i: number) => `${P}eng_ai${i}_sw`,
  /** Derived: either side's WING/ENG selected (1 / 0). Written by the logic (compatibility output). */
  wingAiSw: `${P}wing_ai_sw`,
  /** Derived per side: wing A/I valve commanded open (switch WING/ENG and N2 >= 75 %, 525AFM-06 p.3-99). Logic output. */
  wingAiValve: (i: number) => `${P}wai${i}_valve`,
  /** TAIL DE-ICE: MANUAL (-1, momentary) / OFF (0) / AUTO (1). */
  tailDeiceSw: `${P}tail_deice_sw`,
  /** L / R W/S BLEED (windshield anti-ice / rain): OFF (0) / LOW (1) / HI (2). */
  wsBleedSw: (i: number) => `${P}ws_bleed${i}_sw`,
  /** W/S ALCOHOL (pilot windshield backup anti-ice): OFF (0) / ON (1). */
  wsAlcoholSw: `${P}ws_alcohol_sw`,
  /** Alcohol reservoir remaining, 0..1 ("sufficient alcohol is provided for ten minutes of operation", 525AFM-06 p.3-101). */
  wsAlcoholRemaining: `${P}ws_alcohol_remaining`,

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
   * MANUAL cabin command: UP (+1) = outflow valve opens, cabin climbs; DN (-1) = valve closes, cabin descends
   * (CJ family, 525AFM-06 p.3-118); 0 holds.
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
  /** PASS OXY selector: CREW ONLY (0) / NORM (1, auto drop at 14,500 +/- 500 ft cabin, 525AFM-06 p.3-122) / MANUAL DROP (2). */
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
  /** Emergency brake pneumatic bottle pressure (psi, EST charge; depleted per application). Systems output. */
  emerBrakeBottlePsi: `${P}emer_brk_psi`,

  // ---------------------------------------------------------------- Pedestal: flaps, speed brake, trims
  /**
   * Flap handle (continuous, S&D15 §9.1 "any intermediate position from zero to 35 degrees may be selected in
   * flight"): 0 UP .. 1 15 (T.O. & APPR detent) .. 2 35 (LAND, push-down gate past T.O. & APPR) / 3 60 (GND, lift
   * at the LAND gate; 525AFM-06 p.3-103). Values between detents select proportional flap angles.
   */
  flapHandle: `${P}flap_handle`,
  /** SPEED BRAKE handle: RETRACT (0) / EXTEND (1). */
  speedbrake: `${P}speedbrake`,
  /** Elevator trim wheel position (TrimAxis units -1 nose down .. +1 nose up). */
  pitchTrim: `${P}pitch_trim`,
  /** Aileron trim knob position (-1 LWD .. +1 RWD). */
  aileronTrim: `${P}ail_trim`,
  /** Rudder trim knob position (-1 nose left .. +1 nose right). */
  rudderTrim: `${P}rud_trim`,
  /**
   * Control-wheel split pitch trim switch (pilot / copilot), direction half: -1 nose down / 0 / +1 nose up. The trim
   * runs only with both halves (yokeTrimArm) moved the same way; the pilot's switch overrides the copilot's
   * (525AFM-06 p.3-89.1). The result is yokeTrimCmd (logic output, TrimAxis / AFCS input).
   */
  yokeTrim: (side: number) => `${P}yoke_trim${side}`,
  /** Split pitch trim switch, arm half (pilot / copilot): -1 / 0 / +1. */
  yokeTrimArm: (side: number) => `${P}yoke_trim_arm${side}`,
  /** Effective yoke trim command after the split-switch and pilot-priority logic (-1 / 0 / +1). Logic output. */
  yokeTrimCmd: `${P}yoke_trim_cmd`,
  /** AP/TRIM DISC button held (pilot / copilot): disconnects the AP (event ap.disc) and interrupts electric / AP trim. */
  apTrimDisc: (side: number) => `${P}ap_trim_disc${side}`,
  // CWS button: event ap.cws { pressed }.

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
