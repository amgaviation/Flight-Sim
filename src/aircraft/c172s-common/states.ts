/**
 * Cessna 172S initial-state presets (docs/modules/app.md §2.4) for the shared cockpit
 * controls and systems. The variant's `applyState` calls `applyC172State` first and then
 * sets its own avionics / autopilot (radios, KAP 140 or GFC 700, G1000 units).
 *
 * Switch positions follow the POH checklists (Section 4):
 *  - cold_dark: everything OFF, key out, control lock installed, parking brake SET, fuel
 *    selector LEFT (POH "Securing airplane": LEFT or RIGHT to prevent crossfeeding; the preflight
 *    cabin item then sets BOTH), fuel shutoff ON (pushed in), mixture idle
 *    cut-off, throttle closed, flaps
 *    UP, trim neutral-ish (takeoff mark).
 *  - ready_to_taxi: after "Starting engine": engine at ~1000 rpm, mixture leaned for ground
 *    operations, MASTER and AVIONICS on, beacon and nav lights on, flaps retracted.
 *  - takeoff: "Before takeoff" complete: flaps 10 (G1000 POH: "UP - 10 deg (10 deg
 *    preferred)"), trim TAKEOFF, mixture RICH, strobes/landing/taxi on, parking brake off.
 *  - cruise: flaps UP, mixture leaned, trimmed level at the app's cruise speed.
 *  - approach: "Before landing" complete: flaps 10, mixture RICH, LAND and TAXI lights on
 *    (day and night), trimmed level.
 */
import type { InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import type { FlightModel } from '../../physics/FlightModel';
import type { Piston } from '../../physics/engines/Piston';
import { ENG, FDM, FUEL, GEAR, INPUT } from '../../core/vars';
import { julianDayFromDayOfYear, sunPosition } from '../../world/sky/solar';
import { C172, ANN_SW, DOOR, ELT_SW, FUEL_SEL, MAG, STBY_BATT } from './vars';
import { FLAP_DETENTS } from './data';
import { C172S_ENGINE } from './fdm';
import type { C172Core } from './createSystems';

/**
 * Elevator trim TAKEOFF mark (trim units, -1 nose down .. +1 nose up). EST: the trim that holds
 * ~70 KIAS in the initial climb at a mid-envelope CG with flaps 10 (computeTrim in the tests);
 * the trim indicator on the pedestal carries a TAKEOFF mark near this position.
 */
export const TAKEOFF_TRIM = 0.1;

/** Night for the lighting presets (NOAA solar elevation below +2 deg; EST dusk threshold). */
export function isNightForPreset(v: SimContext['vars']): boolean {
  if (v.has('env.time_utc_h') && v.has(FDM.lat)) {
    const jd = julianDayFromDayOfYear(2026, Math.max(1, v.get('env.day_of_year', 172)), v.get('env.time_utc_h'));
    return sunPosition(jd, v.get(FDM.lat), v.get(FDM.lon)).elevationDeg < 2;
  }
  return v.get('env.ambient_light', 1) < 0.5;
}

/**
 * Mixture knob position that gives best power at a density ratio: the physics servo meters
 * full rich = 1.12 x best-power fuel/air / sqrt(sigma) (physics Piston `fullRichFactor`), so
 * best power ("lean for maximum RPM", POH Sec 4) is at sqrt(sigma) / 1.12.
 */
export function bestPowerMixture(sigma: number): number {
  return Math.min(1, Math.sqrt(Math.max(0.2, sigma)) / (C172S_ENGINE.fullRichFactor ?? 1.12));
}
/** POH "recommended lean" (50 F rich of peak EGT, Sec 4 cruise): EST phi ~1.05 vs best power 1.15. */
export function recommendedLeanMixture(sigma: number): number {
  return bestPowerMixture(sigma) * (1.05 / 1.15);
}

export interface C172StateOptions {
  /** Fuel per tank (gal) for the state; default: keep the current fuel (the app's Fuel & payload page). */
  fuelGalPerTank?: number;
}

/** Writes every shared cockpit control var for `s` (no system snapping). */
export function setC172Switches(ctx: Pick<SimContext, 'vars'>, core: Pick<C172Core, 'variant'>, s: InitialState): void {
  const v = ctx.vars;
  const cold = s === 'cold_dark';
  const powered = !cold;
  const moving = s === 'takeoff' || s === 'cruise' || s === 'approach';
  const inAir = s === 'cruise' || s === 'approach';
  const night = isNightForPreset(v);
  const g = core.variant === 'g1000';

  // Electrical
  v.set(C172.masterBat, powered ? 1 : 0);
  v.set(C172.masterAlt, powered ? 1 : 0);
  v.set(C172.avionicsBus1, powered ? 1 : 0);
  v.set(C172.avionicsBus2, powered ? 1 : 0);
  v.set(C172.stbyBatt, g && powered ? STBY_BATT.arm : STBY_BATT.off);
  v.set(C172.extPower, 0);
  v.set(C172.cabinPwr12v, 0);
  // Engine and fuel
  v.set(C172.keyIn, powered ? 1 : 0);
  v.set(C172.magneto, powered ? MAG.both : MAG.off);
  v.set(C172.fuelPump, 0);
  // POH Securing Airplane (172SPHUS item 8, 172SPHBUS-02 item 10) leaves the selector on LEFT or
  // RIGHT "to prevent cross feeding"; the preflight cabin item (steam 16, G1000 26) then sets BOTH.
  // Cold & dark therefore starts on LEFT in both variants.
  v.set(C172.fuelSelector, cold ? FUEL_SEL.left : FUEL_SEL.both);
  v.set(C172.fuelShutoff, 1);
  v.set(C172.throttleFriction, 0.3);
  // Flight controls
  const flapLever = s === 'takeoff' || s === 'approach' ? 1 : 0;
  v.set(C172.flapLever, flapLever);
  v.set(C172.parkingBrake, moving ? 0 : 1);
  v.set(C172.controlLock, cold ? 1 : 0);
  // Exterior lights (POH Sec 4 checklists)
  v.set(C172.beacon, powered ? 1 : 0);
  v.set(C172.nav, powered && (night || moving) ? 1 : 0);
  v.set(C172.strobe, moving ? 1 : 0);
  v.set(C172.land, s === 'takeoff' || s === 'approach' ? 1 : 0);
  // POH Before Landing 5 "LAND and TAXI Light Switches - ON" (day or night): the approach preset
  // stands for Before Landing complete.
  v.set(C172.taxi, s === 'ready_to_taxi' || s === 'takeoff' || s === 'approach' ? 1 : 0);
  v.set(C172.pitotHeat, 0);
  // Interior lights
  v.set(C172.dimPanel, powered && night ? 0.6 : 0);
  v.set(C172.dimRadio, powered && night ? 0.5 : 0);
  v.set(C172.dimGlareshield, powered && night && !g ? 0.3 : 0);
  v.set(C172.dimPedestal, powered && night ? 0.4 : 0);
  v.set(C172.dimStbyInd, powered && night && g ? 0.5 : 0);
  v.set(C172.floodLeft, 0);
  v.set(C172.floodRight, 0);
  v.set(C172.domeCourtesy, 0);
  v.set(C172.mapLight, 0);
  v.set(C172.annSwitch, night ? ANN_SW.night : ANN_SW.day);
  // Cabin
  v.set(C172.cabinHeat, 0);
  v.set(C172.cabinAir, powered ? 0.5 : 0);
  v.set(C172.defrostLeft, 0);
  v.set(C172.defrostRight, 0);
  v.set(C172.altStatic, 0);
  v.set(C172.ventLeft, 0);
  v.set(C172.ventRight, 0);
  // Miscellaneous
  v.set(C172.elt, ELT_SW.arm);
  v.set(C172.doorLeft, cold ? DOOR.closed : DOOR.locked);
  v.set(C172.doorRight, cold ? DOOR.closed : DOOR.locked);
  v.set(C172.windowLeft, 0);
  v.set(C172.windowRight, 0);
  v.set(C172.baggageDoor, DOOR.locked);
  v.set(C172.extinguisher, 0);
  // Pilot inputs at rest
  v.set(INPUT.brakeLeft, 0);
  v.set(INPUT.brakeRight, 0);
  if (inAir) v.set(GEAR.brakeLeft, 0);
}

/** `applyState` part shared by both variants. The app has already called `fdm.reposition`. */
export function applyC172State(ctx: SimContext, core: C172Core, s: InitialState, opts: C172StateOptions = {}): void {
  const v = ctx.vars;
  setC172Switches(ctx, core, s);
  const cold = s === 'cold_dark';
  const inAir = s === 'cruise' || s === 'approach';

  if (opts.fuelGalPerTank !== undefined) {
    const kg = opts.fuelGalPerTank * 6 * 0.45359237;
    core.fuel.setTankKg('left', kg);
    core.fuel.setTankKg('right', kg);
    v.set(FUEL.tankKg(0), kg);
    v.set(FUEL.tankKg(1), kg);
  }

  // Surfaces and trim to their commanded positions.
  const flapDeg = FLAP_DETENTS[Math.round(v.get(C172.flapLever))].flapDeg;
  core.flaps.setPosition(flapDeg);
  core.gear.setDown(true);
  core.pitchTrim.setPosition(TAKEOFF_TRIM);
  core.rigging.update();

  // Engine controls for the state.
  const fm = ctx.fdm as Partial<FlightModel> & SimContext['fdm'];
  const sigma = v.get(FDM.densityKgM3, 1.225) / 1.225;
  if (cold) {
    v.set(C172.mixture, 0);
    v.set(C172.throttle, 0);
  } else if (s === 'ready_to_taxi') {
    // POH Sec 4 "Leaning for ground operations": lean for max RPM at 1200, then 800-1000 RPM.
    v.set(C172.mixture, bestPowerMixture(sigma));
    // "800 to 1000 RPM recommended": 0.04 settles at ~930 RPM with the leaned mixture (idle-rpm probe).
    v.set(C172.throttle, 0.04);
  } else if (s === 'takeoff') {
    // Full rich for takeoff (above 3000 ft lean for maximum RPM: POH Sec 4).
    v.set(C172.mixture, v.get(FDM.pressAlt) > 3000 ? bestPowerMixture(sigma) : 1);
    // Before Takeoff "Throttle - 1000 RPM or LESS" (POH 4-15): 0.04 settles at ~920 RPM full rich.
    // Lined up with the brakes off the airplane creeps forward at this power (about 4 kt after 12 s, as a
    // real 172 does at 1000 RPM on pavement). Idle (~620 RPM) would stop it, but then the alternator is off
    // line (LOW VOLTS) and the POH / presets test band of 800-1000 RPM is not met, so the creep is kept.
    v.set(C172.throttle, 0.04);
  } else if (s === 'cruise') {
    v.set(C172.mixture, recommendedLeanMixture(sigma));
    v.set(C172.throttle, 0.7);
  } else {
    v.set(C172.mixture, 1); // before landing: mixture RICH
    v.set(C172.throttle, 0.3);
  }

  core.logic.reset();
  core.logic.update();
  core.fuel.snapValves();
  core.lights.snap();
  core.elec.settle();
  core.fuel.update(1 / 60);

  if (cold) {
    ctx.fdm.setEnginesRunning?.(false);
    core.vacuum.reset?.();
    for (const a of core.airData.sources) a.reset();
    core.late.reset();
    return;
  }

  // Fuel pressure at the servo (selector BOTH, shutoff ON, engine-driven pump turning) so the
  // engine can run while the power is solved below; the fuel system confirms it next frame.
  v.set(ENG.fuelOn(1), 1);
  if (inAir && fm.computeTrim && fm.engines) {
    // Re-place so the trimmed attitude reflects the configuration, then trim pitch and power.
    const ias = Math.max(60, v.get(FDM.ias));
    ctx.fdm.reposition({ lat: v.get(FDM.lat), lon: v.get(FDM.lon), altFtMsl: v.get(FDM.altMsl), headingTrue: v.get(FDM.headingTrue), iasKt: ias });
    const trim = fm.computeTrim({ iasKt: ias });
    if (trim.converged) {
      core.pitchTrim.setPosition(Math.max(-1, Math.min(1, trim.pitchTrim)));
      const eng = fm.engines[0] as Piston;
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 16; i++) {
        const mid = 0.5 * (lo + hi);
        v.set(C172.throttle, mid);
        core.logic.update();
        ctx.fdm.setEnginesRunning?.(true);
        if (eng.thrust_N < trim.thrustN) lo = mid;
        else hi = mid;
      }
      v.set(C172.throttle, 0.5 * (lo + hi));
      core.logic.update();
    }
  }
  // Engine running at the commanded power.
  ctx.fdm.setEnginesRunning?.(true);
  core.elec.settle();
  core.fuel.update(1 / 60);
  core.vacuum.reset?.();
  // A preset stands for an airplane whose avionics have been running: the GDC has finished its
  // power-up self test (POH Before Takeoff 6 "Flight Instruments (PFD) - CHECK (no red X's)").
  for (const a of core.airData.sources) a.reset({ powered: true });
  core.pitchTrim.reset?.();
  core.late.reset();
}
