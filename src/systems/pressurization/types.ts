/**
 * Configuration types for `Pressurization` (Pressurization.ts).
 */
import type { Binding } from '../util/binding';
import type { Table1D } from '../../physics/types';

export interface PressurizationConfig {
  /** Var prefix (default 'press.'). */
  prefix?: string;
  /** Cabin air volume (m³). */
  cabinVolumeM3: number;
  /** Maximum normal (controller) differential (psi). */
  maxDiffPsi: number;
  /** Positive pressure relief (safety) valve setting (psi). Default maxDiff + 0.5. */
  reliefPsi?: number;
  /** Negative pressure relief (psi, positive number). Default 0.5 (EST; Gulfstream −0.25 to −0.5). */
  negReliefPsi?: number;
  /** Cabin altitude schedule: cabin altitude (ft) vs aircraft pressure altitude (ft), used in climb/cruise. */
  schedule: Table1D;
  /** Planned flight/cruise altitude (ft) for proportional climb scheduling (737 FLT ALT, FMS cruise altitude). 0/absent = schedule vs current altitude. */
  flightAltitude?: Binding;
  /** Landing field elevation (ft) from a manual selector (LDG ALT / LFE knob). */
  landingElevation?: Binding;
  /** When true, the landing elevation comes from the FMS destination (via `destinationElevation`). Default true when the callback is given. */
  landingElevationAuto?: Binding;
  /** Resolves an airport ident to its elevation (ft), e.g. `(id) => ctx.nav.airport(id)?.elevationFt`. */
  destinationElevation?: (ident: string) => number | undefined;
  /** String var with the destination ident (default 'fms.dest'). */
  destinationVar?: string;
  /** Auto cabin climb / descent rate limits (fpm, sea-level equivalent). Defaults 500 / 300 (Gulfstream: up to 500 fpm climb, 300 fpm descent — code450.com). */
  maxCabinClimbFpm?: number;
  maxCabinDescentFpm?: number;
  /** Cabin altitude relative to the landing field at touchdown (ft); negative = slightly pressurised. Default −300 (EST). */
  landingBiasFt?: number;
  /** Takeoff pre-pressurisation: while `active` on the ground the cabin is held `psi` above ambient (737NG ≈ 0.1 psi). */
  groundPrepress?: { active: Binding; psi: number };
  /** Air inflow (kg/s), e.g. 'pneu.pack_flow_kgs'. */
  inflowKgs: Binding;
  /** Outflow valve: effective max area (m², default 3.5e-4 × volume, EST) and full-travel times (s): auto 5, manual 20 (EST). */
  outflowValve?: { maxAreaM2?: number; autoTravelS?: number; manualTravelS?: number };
  /** Normal fuselage leakage effective area (m²). Default 1e-5 × volume (EST: ~15 % of inflow at max diff). */
  leakAreaM2?: number;
  /** Safety valve full-open area (m²), default = outflow max area. */
  safetyAreaM2?: number;
  /**
   * (Appended by the citation-m2 aircraft.) Holds the safety valve fully open while true, in addition to its
   * relief function, e.g. the Citation ground solenoid that opens the safety valve through the squat switch so
   * the cabin cannot pressurise on the ground. Default false.
   */
  safetyValveOpen?: Binding;
  /** Structural breach area for `fail.press.decompression` (m²), default 0.1 (EST: door-seal / window-sized). */
  decompressionAreaM2?: number;
  /** Mode: 0 AUTO, 1 ALTN (standby controller), 2 MANUAL. Default 0. */
  mode?: Binding;
  /** MANUAL outflow command −1 (close) .. +1 (open), e.g. a spring-loaded OPEN/CLOSE switch. */
  manualCommand?: Binding;
  /** Cabin dump (outflow valve fully open in AUTO/ALTN). */
  dump?: Binding;
  /** (Appended by the citation-m2 aircraft.) Dump effective in every mode, MANUAL included. Default false. */
  dumpAllModes?: boolean;
  /** (Appended by the citation-m2 aircraft.) Power needed by the dump solenoid. Default true. */
  dumpPower?: Binding;
  /**
   * (Appended by the citation-m2 aircraft.) Maximum-limit valve: while dumping (or with the MANUAL valve fully open)
   * the outflow valves close when the cabin reaches this altitude (ft), e.g. Citation 14,500 ft. Default none.
   */
  dumpLimitFt?: number;
  /**
   * (Appended by the citation-m2 aircraft.) CABIN ALTITUDE warning threshold as a binding (ft), e.g. a high-altitude
   * airport mode; overrides `cabinAltWarnFt` when given (200 ft hysteresis).
   */
  cabinAltWarnFtBinding?: Binding;
  /**
   * (Appended by the citation-m2 aircraft.) Departure field elevation (ft) for differential-limited controllers: in
   * the climb the auto schedule never commands the cabin below it, so the cabin is held at the departure field until
   * the schedule or the differential limit requires more. Default none.
   */
  departureFieldFt?: Binding;
  /** AUTO fault -> automatic transfer to ALTN (737NG). Default true. */
  autoTransferToAltn?: boolean;
  /** CABIN ALTITUDE warning threshold (ft). Default 10,000 (737: warning horn above 10,000 ft). */
  cabinAltWarnFt?: number;
  /** Passenger oxygen mask auto-deploy cabin altitude (ft). Default 14,000 (737). */
  masksDeployFt?: number;
  /** Manual mask deploy (PASS OXY switch ON). */
  masksManual?: Binding;
  /** Rising edge re-stows the masks (maintenance reset). */
  masksReset?: Binding;
  /** On-ground signal (default 'fdm.on_ground'). */
  onGround?: Binding;
  /** Ambient static pressure (Pa) (default 'fdm.static_press_pa'). */
  staticPressurePa?: Binding;
  /** Aircraft pressure altitude (ft) (default 'fdm.press_alt_ft'). */
  pressureAltitudeFt?: Binding;
  /** Cabin air temperature (°C), e.g. 'pneu.cabin_temp_c'. Default 22. */
  cabinTempC?: Binding;
}
