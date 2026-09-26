/**
 * `_test-jet`: development test aircraft proving the full pipeline.
 *
 * FDM: physics `TEST_JET` (generic light twin, all EST). Cockpit: the
 * cockpit module's demo panel (one of every control type) moved into the
 * nose of the airframe, with a lofted cockpit shell and a PFD built from the
 * avionics-common primitives in place of the demo display. Systems: the
 * real systems library (electrical, fuel, sensors, FADEC + start, gear,
 * brakes, mechanical flight controls, trim, flaps, spoilers, steering,
 * stall/overspeed warnings, exterior lighting, failures).
 *
 * Not listed in the user catalog unless no real aircraft is available
 * (see src/ui/catalog.ts); load it directly with `?aircraft=_test-jet`.
 */
import * as THREE from 'three';
import type { AircraftInstance, AircraftModule, Checklist, InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import { ENG, FDM, SURF } from '../../core/vars';
import { TEST_JET } from '../../physics/testAircraft';
import type { FlightModel } from '../../physics/FlightModel';
import type { Turbofan } from '../../physics/engines/Turbofan';
import { buildDemoCockpit, DEMO_EYE, DEMO_VARS, DemoDisplay } from '../../cockpit/demo/DemoPanel';
import { bodyToLocal } from '../../cockpit/frame';
import { createTestJetSystems, driveDemoIndicators, FLAP_DETENTS, TEST_VARS } from './systems';
import { TestPfd } from './TestPfd';
import { createTestExterior } from './exterior';
import { createCockpitShell } from './shell';

/** Demo cockpit origin -> test-jet body: pilot eye at x 4.5 m (seat station 4.6 m in TEST_JET), floor at z 0.2 m. */
export const COCKPIT_OFFSET: [number, number, number] = [4.5, 0, 0.2];

const shift = (p: readonly [number, number, number]): [number, number, number] => [p[0] + COCKPIT_OFFSET[0], p[1] + COCKPIT_OFFSET[1], p[2] + COCKPIT_OFFSET[2]];

const CHECKLISTS: Checklist[] = [
  {
    title: 'Before start',
    phase: 'Ground',
    items: [
      { challenge: 'Parking brake', response: 'SET', check: (v) => v.get('brakes.parking_set') !== 0 },
      { challenge: 'Battery', response: 'ON', check: (v) => v.get(DEMO_VARS.batt) !== 0 },
      { challenge: 'Fuel pumps', response: 'NORM', check: (v) => v.get(DEMO_VARS.fuelPump) === 1 },
      { challenge: 'Fuel selector', response: 'BOTH', check: (v) => v.get(DEMO_VARS.fuelSel) === 1 },
      { challenge: 'Beacon', response: 'ON', check: (v) => v.get('ac.demo.beacon') !== 0 },
      { challenge: 'Thrust levers', response: 'IDLE', check: (v) => Math.abs(v.get(DEMO_VARS.tla1)) < 0.02 && Math.abs(v.get(DEMO_VARS.tla2)) < 0.02 },
    ],
  },
  {
    title: 'Engine start',
    phase: 'Ground',
    items: [
      { challenge: 'Fuel cutoff levers', response: 'RUN', check: (v) => v.get(DEMO_VARS.cutoff) >= 0.5 },
      { challenge: 'ENG START', response: 'START (left, then right)', check: (v) => v.get(ENG.running(1)) !== 0 && v.get(ENG.running(2)) !== 0 },
      { challenge: 'ITT / N2', response: 'NORMAL, stabilised at idle', check: (v) => v.get(ENG.n2(1)) > 55 && v.get(ENG.n2(2)) > 55 },
      { challenge: 'Generators', response: 'ON (GEN light out)', check: (v) => v.get('elec.sg1_online') !== 0 && v.get('elec.sg2_online') !== 0 },
    ],
  },
  {
    title: 'Before takeoff',
    phase: 'Takeoff',
    items: [
      { challenge: 'Flaps', response: '15', check: (v) => Math.abs(v.get(SURF.flapsDeg) - 15) < 1 },
      { challenge: 'Trim', response: 'TAKEOFF BAND', check: (v) => v.get('trim.pitch_to_ok') !== 0 },
      { challenge: 'Speedbrake', response: 'ARMED', check: (v) => Math.abs(v.get(DEMO_VARS.spdbrk) - 0.1) < 0.02 },
      { challenge: 'Strobes / landing lights', response: 'ON', check: (v) => v.get('ac.demo.strobe') !== 0 && v.get('ac.demo.wing_lt') !== 0 },
      { challenge: 'Parking brake', response: 'RELEASED', check: (v) => v.get('brakes.parking_set') === 0 },
    ],
  },
  {
    title: 'Approach and landing',
    phase: 'Landing',
    items: [
      { challenge: 'Altimeter', response: 'SET', check: (v) => Math.abs(v.get('adc1.baro_inhg', 29.92) - v.get('env.qnh_inhg', 29.92)) < 0.02 },
      { challenge: 'Landing gear', response: 'DOWN, 3 GREEN', check: (v) => v.get('gear.down_locked') !== 0 },
      { challenge: 'Flaps', response: '35', check: (v) => v.get(SURF.flapsDeg) > 34 },
      { challenge: 'Speedbrake', response: 'ARMED', check: (v) => Math.abs(v.get(DEMO_VARS.spdbrk) - 0.1) < 0.02 },
    ],
  },
  {
    title: 'Shutdown',
    phase: 'Ground',
    items: [
      { challenge: 'Parking brake', response: 'SET', check: (v) => v.get('brakes.parking_set') !== 0 },
      { challenge: 'Fuel cutoff levers', response: 'CUTOFF', check: (v) => v.get(DEMO_VARS.cutoff) < 0.5 },
      { challenge: 'Exterior lights', response: 'OFF', check: (v) => v.get(DEMO_VARS.navLt) === 0 && v.get('ac.demo.strobe') === 0 },
      { challenge: 'Battery', response: 'OFF', check: (v) => v.get(DEMO_VARS.batt) === 0 },
    ],
  },
];

const module: AircraftModule = {
  meta: {
    id: '_test-jet',
    name: 'Test Jet (development)',
    manufacturer: 'AMG (development)',
    icaoType: 'ZZZZ',
    engines: 2,
    engineType: 'turbofan',
    avionics: 'Test PFD (avionics-common primitives)',
    description: 'Generic light twin jet used to exercise the simulator pipeline: demo cockpit with one of every control type, real electrical/fuel/FADEC/gear systems, basic PFD.',
    typical: { cruiseAltFt: 31000, cruiseKtas: 400, approachKias: 125, rotateKias: 110, maxAltFt: 41000 },
    chaseDistance_m: 30,
  },
  fdm: TEST_JET,

  create(ctx: SimContext): AircraftInstance {
    const sys = createTestJetSystems(ctx);

    // --- Cockpit: demo panel moved into the nose (children shifted so the root stays at the datum).
    const build = buildDemoCockpit(ctx, 'citation');
    const off = bodyToLocal(COCKPIT_OFFSET[0], COCKPIT_OFFSET[1], COCKPIT_OFFSET[2], new THREE.Vector3());
    for (const c of build.root.children) c.position.add(off);
    build.eyePosition_m = shift(DEMO_EYE);
    build.views = (build.views ?? []).map((v) => ({ ...v, position_m: shift(v.position_m) }));
    const shell = createCockpitShell(build.env.materials);
    build.root.add(shell.group);
    // The demo panel's yoke hub sits in the line of sight to the display; drop it 12 cm and move it 4 cm
    // forward, where a bizjet control wheel sits below the PFD (EST, typical layouts).
    const yoke = build.controls.find((c) => c.id === 'demo.yoke');
    if (yoke) yoke.object.position.add(bodyToLocal(0.04, 0, 0.12, new THREE.Vector3()));

    // The PFD replaces the demo display on the same screen mesh (the display manager maps it on).
    const pfd = new TestPfd(ctx.vars, ctx.audio);
    const slot = build.displays.findIndex((d) => d.display instanceof DemoDisplay);
    if (slot >= 0) {
      const old = build.displays[slot];
      old.display.dispose?.();
      old.mesh.userData.displayOptions = { ...(old.mesh.userData.displayOptions ?? {}), boot: false };
      build.displays[slot] = { display: pfd, mesh: old.mesh };
    }
    // Demo annunciators follow the real systems (runs after the demo panel's own hook).
    const demoUpdate = build.update?.bind(build);
    build.update = (dt: number) => {
      demoUpdate?.(dt);
      driveDemoIndicators(ctx);
    };

    // --- Exterior
    const exterior = createTestExterior(ctx.vars);

    const setSwitches = (s: InitialState) => {
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
    };

    const applyState = (s: InitialState): void => {
      const v = ctx.vars;
      setSwitches(s);
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
    };

    return {
      systems: sys.list,
      cockpit: build,
      exterior: exterior.root,
      updateExterior: exterior.update,
      applyState,
      checklists: CHECKLISTS,
      inputMap: {
        throttles: [DEMO_VARS.tla1, DEMO_VARS.tla2],
        throttleRange: [0, 1],
        reverse: { value: -0.3 },
        flaps: { var: DEMO_VARS.flaps, detents: FLAP_DETENTS.map((d) => d.lever) },
        gear: { var: DEMO_VARS.gear, up: 1, down: 0 },
        speedbrake: { var: DEMO_VARS.spdbrk, positions: [0, 0.1, 1], armed: 0.1 },
        parkingBrake: { var: DEMO_VARS.park, on: 1, off: 0 },
      },
      dispose(): void {
        for (const s of sys.list) s.dispose?.();
        shell.dispose();
        exterior.dispose();
      },
    };
  },
};

export { TEST_VARS };
export default module;
