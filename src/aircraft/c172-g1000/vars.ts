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
   * MET switch: +1 nose UP, -1 nose DN, 0 centre (spring-loaded). SCOPE: the real switch is a
   * split (ARM + direction) pair moved together by the thumb; it is modelled as one switch.
   */
  met: 'ac.c172g.met',
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
  /** Extinguisher gage pressure (psi, green arc ~125-195 psi when charged), written by the logic. */
  extPsi: 'ac.c172g.ext_psi',

  // ---------------------------------------------------------------- avionics cooling (POH Sec 3 "Display cooling advisory")
  /** Forward (AVN BUS 1) and aft (AVN BUS 2) avionics cooling fans running. */
  fwdFan: 'ac.c172g.fwd_fan',
  aftFan: 'ac.c172g.aft_fan',
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
} as const;
