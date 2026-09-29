/**
 * Cessna 172S G1000 NXi / GFC 700: variant-specific SimVars (`ac.c172g.*`).
 *
 * The switch panel, engine controls, fuel, lights, doors and cabin controls
 * write the shared `C172.*` vars of src/aircraft/c172s-common/vars.ts; the
 * G1000 bezels and the GMA 1360 emit the `g1k.*` events of
 * src/avionics/garmin-g1000/vars.ts. Only the controls that the shared core
 * does not know about (GFC 700 yoke switches, ELT rocker, ignition key tag,
 * extinguisher, throttle friction consequences, display/key lighting) live
 * here, each consumed by `C172G1000Logic` (systems/variant.ts).
 *
 * Source for the controls: Cessna 172S NAV III GFC 700 AFCS POH/AFM
 * 172SPHBUS-00 (20 Dec 2007), cited "POH": Fig 7-2 (instrument panel, items
 * 1-34, Detail A pilot control wheel), Sec 7 "GFC 700 AFCS", Sec 3
 * "Autopilot or electric trim failure".
 */

/** Manual electric trim (MET) split switch on the pilot's left grip (POH Fig 7-2 Detail A). */
export const MET = { noseDn: -1, off: 0, noseUp: 1 } as const;

/** ELT remote switch rocker (POH Fig 7-2 item 11: "ELT remote switch/annunciator", ON / ARM, TEST RESET = ON then ARM). */
export const ELT_ROCKER = { arm: 0, on: 1 } as const;

export const C172G = {
  // ---------------------------------------------------------------- pilot control wheel (POH Fig 7-2 Detail A)
  /**
   * MET switch position under the thumb: +1 nose UP, -1 nose DN, 0 centre (spring-loaded). The real
   * switch is split (CRG 190-00384-12 §6.1: "The left switch is the ARM contact and the right switch
   * controls the DN and UP contacts"); normally the thumb rocks both halves together. Which halves the
   * thumb is on is `metHalf` (cockpit: plain drag = both, Shift = DN/UP half only, Ctrl/Alt = ARM half only).
   */
  met: 'ac.c172g.met',
  /** Halves operated by `met`: 0 both (normal), 1 ARM half only, 2 DN/UP half only. */
  metHalf: 'ac.c172g.met_half',
  /** Outputs: ARM contact closed (0/1), DN/UP contacts (+1 up, -1 down, 0), stuck-half MET fault (PTRM). */
  metArm: 'ac.c172g.met_arm',
  metDir: 'ac.c172g.met_dir',
  metFault: 'ac.c172g.met_fault',
  /** A/P TRIM DISC button held (1): disconnects the AP and interrupts all electric trim while held. */
  apDisc: 'ac.c172g.ap_disc',
  /** CWS button held (1). */
  cws: 'ac.c172g.cws',
  /** Microphone (PTT) buttons: pilot wheel, copilot wheel, hand-held microphone. */
  pttPilot: 'ac.c172g.ptt_l',
  pttCopilot: 'ac.c172g.ptt_r',
  pttHandMic: 'ac.c172g.ptt_mic',
  /** Go-around button on the lower panel beside the throttle (POH Fig 7-2 item 27), held (1). */
  ga: 'ac.c172g.ga',

  // ---------------------------------------------------------------- outputs of C172G1000Logic
  /** Electric pitch trim command for the TrimAxis electric channel (MET, or the keyboard trim acting as the MET). */
  metCmd: 'ac.c172g.met_cmd',
  /** 1 while the A/P TRIM DISC button interrupts electric trim (TrimAxis enable is its inverse). */
  trimInterrupt: 'ac.c172g.trim_interrupt',

  // ---------------------------------------------------------------- right panel
  /** ELT remote switch rocker, see ELT_ROCKER. */
  eltRocker: 'ac.c172g.elt_rocker',

  // ---------------------------------------------------------------- ignition key
  /** Ignition key tag clicked (momentary): inserts the key, or removes it with the MAGNETOS switch OFF. */
  keyTag: 'ac.c172g.key_tag',

  // ---------------------------------------------------------------- cabin
  /** Portable Halon 1211 extinguisher trigger squeezed (momentary). */
  extTrigger: 'ac.c172g.ext_trigger',
  /**
   * Extinguisher operating ring pin pulled (1) / in place (0). POH 7-79: "pull the operating ring pin, then
   * press the lever"; preflight: "lock pin secure". The trigger discharges only with the pin pulled.
   */
  extPin: 'ac.c172g.ext_pin',
  /** Output: 1 while the bottle discharges (read by the c172s-common fire model as Halon into the cabin). */
  extDischarging: 'ac.c172g.ext_discharging',
  /** Cabin door handles (DOOR values, spring-loaded from OPEN back to CLOSE; LOCK over-centre, POH 7-27). */
  doorHandleLeft: 'ac.c172g.door_handle_l',
  doorHandleRight: 'ac.c172g.door_handle_r',
  /** Door pulled shut by its arm rest / pull strap (momentary): latches the door if the airspeed allows. */
  doorPullLeft: 'ac.c172g.door_pull_l',
  doorPullRight: 'ac.c172g.door_pull_r',
  /** External power receptacle (left cowl) door / GPU cart: ground-service toggle, writes C172.extPower. */
  gpuRequest: 'ac.c172g.gpu_request',
  /** ELT remote switch red light (flashing ~1 Hz while the ELT transmits). */
  eltLight: 'ac.c172g.elt_light',
  /** 121.5 MHz ELT sweep heard on a COM receiver (0/1) and the ELT remote aural warning (0/1). */
  eltComAudio: 'ac.c172g.elt_com_audio',
  eltAural: 'ac.c172g.elt_aural',
  /** Extinguisher gage pressure (psi, green arc ~125-195 psi when charged), written by the logic. */
  extPsi: 'ac.c172g.ext_psi',

  /** Glove box door open (1) / latched (0), toggled by its latch (POH Fig 7-2 item 15). */
  glovebox: 'ac.c172g.glovebox',

  // ---------------------------------------------------------------- pedestal (POH Fig 7-2 items 23, 24; Sec 7 "Avionics support equipment")
  /**
   * A portable device plugged into the POWER OUTLET 12V - 10A (1). With CABIN PWR 12V ON its charge current
   * loads ELECTRICAL BUS 1 through the CABIN LTS/PWR breaker (c172s-common electrical.ts `cabin_12v`).
   */
  outletDevice: 'ac.c172g.outlet_device',
  /** An audio player cable plugged into the AUX AUDIO IN jack (1). */
  auxAudioCable: 'ac.c172g.aux_audio_cable',
  /**
   * Output: entertainment audio from AUX AUDIO IN reaching the headsets (1). POH Sec 7: not switched by the
   * audio panel's AUX key; "automatically muted during radio communications". SCOPE: muted while any PTT is
   * keyed; COM-reception and ICS-isolation muting and the audio itself are not modelled.
   */
  auxAudioActive: 'ac.c172g.aux_audio_active',

  // ---------------------------------------------------------------- avionics cooling (POH Sec 3 "Display cooling advisory")
  /**
   * Avionics cooling fans running (POH 7-73; Fig 7-7 sheet 2): forward (deckskin) and PFD fans on the AVN 1
   * PFD breaker, MFD fan on the MFD breaker, aft (tailcone) fan on the NAV 2 breaker. They run only with
   * AVIONICS BUS 1 and BUS 2 both on.
   */
  fwdFan: 'ac.c172g.fwd_fan',
  aftFan: 'ac.c172g.aft_fan',
  pfdFan: 'ac.c172g.pfd_fan',
  mfdFan: 'ac.c172g.mfd_fan',
  /** EST GDU internal temperature rise above the cabin (deg C) and the PFD1 / MFD1 COOLING advisories. */
  pfdTempC: 'ac.c172g.pfd_temp_c',
  mfdTempC: 'ac.c172g.mfd_temp_c',
  pfdCooling: 'ac.c172g.pfd_cooling',
  mfdCooling: 'ac.c172g.mfd_cooling',

  // ---------------------------------------------------------------- lighting outputs
  /** Bezel / GMA key backlighting 0..1 (AVIONICS dimmer or photocell). */
  keyLight: 'ac.c172g.key_light',
  /** Standby attitude indicator GYRO (low vacuum) flag in view (0..1). */
  gyroFlag: 'ac.c172g.gyro_flag',
} as const;

/** Failure ids registered by the variant logic. */
export const C172G_FAIL = {
  /** Forward avionics cooling fan (POH Sec 3 display cooling advisory). */
  fwdFan: 'c172g.fwd_avn_fan',
  /** Aft avionics cooling fan. */
  aftFan: 'c172g.aft_avn_fan',
  /** PFD and MFD cooling fans (POH 7-73). */
  pfdFan: 'c172g.pfd_fan',
  mfdFan: 'c172g.mfd_fan',
} as const;
