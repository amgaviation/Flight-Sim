/**
 * Initial-state presets of the `_test-jet` (cold & dark, ready to taxi,
 * takeoff, cruise, approach). Kept apart from the cockpit build so the
 * headless integration tests (tests/integration/testJet.test.ts) run the
 * exact code the app runs, without Three.js or a DOM.
 *
 * Contract (docs/modules/app.md 2.4): the app has already called
 * `fdm.reposition(...)`; this sets every switch/lever var, snaps the system
 * internals, starts or stops the engines and, for the in-air states, trims
 * the aircraft (pitch trim + thrust lever position).
 */
import type { InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import { ENG, FDM } from '../../core/vars';
import type { FlightModel } from '../../physics/FlightModel';
import type { Turbofan } from '../../physics/engines/Turbofan';
import { DEMO_VARS } from '../../cockpit/demo/DemoPanel';
import { FLAP_DETENTS, type TestJetSystems } from './systems';

/** Writes the cockpit switch/lever vars for `s` (no system snapping). */
export function setTestJetSwitches(ctx: Pick<SimContext, 'vars'>, sys: TestJetSystems, s: InitialState): void {
  const v = ctx.vars;
  const powered = s !== 'cold_dark';
  const moving = s === 'takeoff' || s === 'cruise' || s === 'approach';
  v.set(DEMO_VARS.batt, powered ? 1 : 0);
  v.set(DEMO_VARS.gen, powered ? 1 : 0);
  v.set(DEMO_VARS.start, 1);
  v.set(DEMO_VARS.fuelPump, 1);
  v.set(DEMO_VARS.fuelSel, 1);
  v.set(DEMO_VARS.cutoff, powered ? 1 : 0);
  v.set(DEMO_VARS.tla1, 0);
  v.set(DEMO_VARS.tla2, 0);
  v.set(DEMO_VARS.park, moving ? 0 : 1);
  v.set(DEMO_VARS.navLt, powered ? 1 : 0);
  v.set('ac.demo.beacon', powered ? 1 : 0);
  v.set('ac.demo.strobe', moving ? 1 : 0);
  v.set('ac.demo.wing_lt', s === 'takeoff' || s === 'approach' ? 1 : 0);
  const night = v.get('env.ambient_light', 1) < 0.5;
  v.set(DEMO_VARS.panelLt, powered && night ? 0.6 : 0);
  v.set(DEMO_VARS.floodLt, powered && night ? 0.25 : 0);
  v.set(DEMO_VARS.spdbrk, s === 'takeoff' || s === 'approach' ? 0.1 : 0);
  const flapLever = s === 'ready_to_taxi' || s === 'takeoff' || s === 'approach' ? 2 : 0;
  v.set(DEMO_VARS.flaps, flapLever);
  sys.flaps.setPosition(FLAP_DETENTS[flapLever].flapDeg);
  const gearDown = s !== 'cruise';
  v.set(DEMO_VARS.gear, gearDown ? 0 : 1);
  sys.gear.setDown(gearDown);
  sys.trim.setPosition(s === 'takeoff' || s === 'ready_to_taxi' ? 0.1 : 0);
  v.set(DEMO_VARS.fire, 0);
  v.set(DEMO_VARS.fireRot, 0);
}

/** `AircraftInstance.applyState` of the test jet. */
export function applyTestJetState(ctx: SimContext, sys: TestJetSystems, s: InitialState): void {
  const v = ctx.vars;
  setTestJetSwitches(ctx, sys, s);
  sys.logic.update();
  sys.fuel.snapValves();
  sys.lights.snap();
  sys.elec.settle();
  const fm = ctx.fdm as Partial<FlightModel> & SimContext['fdm'];
  if (s === 'cold_dark') {
    ctx.fdm.setEnginesRunning?.(false);
    for (const st of sys.starts) st.reset();
    sys.ahrs.reset(false);
    return;
  }
  const inAir = s === 'cruise' || s === 'approach';
  if (inAir) {
    // Re-place the aircraft so its trimmed attitude reflects the new flap/gear configuration.
    const ias = Math.max(100, v.get(FDM.ias));
    ctx.fdm.reposition({ lat: v.get(FDM.lat), lon: v.get(FDM.lon), altFtMsl: v.get(FDM.altMsl), headingTrue: v.get(FDM.headingTrue), iasKt: ias });
    const trim = fm.computeTrim?.({ iasKt: ias });
    if (trim?.converged && fm.engines && fm.engineEnv) {
      sys.trim.setPosition(Math.max(-1, Math.min(1, trim.pitchTrim)));
      const n1 = (fm.engines[0] as Turbofan).n1ForThrust(trim.thrustN / 2, fm.engineEnv);
      sys.ratings.update(1 / 60);
      const idle = sys.fadec.idleN1(v.get(FDM.pressAlt), false);
      // Invert the FADEC lever law by bisection (monotonic in lever position).
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (sys.fadec.forwardN1(mid, idle) < n1) lo = mid;
        else hi = mid;
      }
      v.set(DEMO_VARS.tla1, lo);
      v.set(DEMO_VARS.tla2, lo);
    }
  }
  sys.logic.update();
  sys.ratings.update(1 / 60);
  sys.fadec.update(1 / 60);
  for (const i of [1, 2]) {
    v.set(`fadec.eng${i}.fuel_cmd`, 1);
    v.set(ENG.fuelOn(i), 1);
  }
  ctx.fdm.setEnginesRunning?.(true);
  for (const st of sys.starts) st.reset();
  sys.elec.settle();
  sys.ahrs.reset(true);
  sys.adc.reset();
}
