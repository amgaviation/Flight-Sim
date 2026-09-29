/**
 * Cessna 172S G1000 NXi / GFC 700 initial-state presets. The shared switch, engine, fuel,
 * light and surface setup comes from c172s-common `applyC172State` (docs/aircraft/c172s.md §9);
 * this adds the variant's controls, the G1000 (power-on / GPS / transponder via the suite),
 * the GRS 79 alignment, the altimeter settings and the GFC 700 references.
 *
 * POH 172SPHBUS-02 Sec 4: Before Takeoff ends with the Flight Director OFF and ALT SEL SET;
 * the cruise / approach presets start with the autopilot OFF and the references synchronised
 * to the current heading / altitude (the pilot engages it).
 */
import type { InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import { ADC, AP, FDM } from '../../core/vars';
import { applyC172State } from '../c172s-common/states';
import { C172G, ELT_ROCKER, MET } from './vars';
import type { C172G1000Systems } from './createSystems';
import { C172G_PROC } from './systems/procedures';

/** Writes the variant's own control vars for a state (all momentary controls released). */
export function setC172G1000Switches(ctx: Pick<SimContext, 'vars'>): void {
  const v = ctx.vars;
  v.set(C172G.met, MET.off);
  v.set(C172G.metCmd, 0);
  v.set(C172G.apDisc, 0);
  v.set(C172G.cws, 0);
  v.set(C172G.pttPilot, 0);
  v.set(C172G.pttCopilot, 0);
  v.set(C172G.pttHandMic, 0);
  v.set(C172G.ga, 0);
  v.set(C172G.keyTag, 0);
  v.set(C172G.extTrigger, 0);
  v.set(C172G.eltRocker, ELT_ROCKER.arm);
}

export function applyC172G1000State(ctx: SimContext, sys: C172G1000Systems, s: InitialState): void {
  const v = ctx.vars;
  const cold = s === 'cold_dark';
  const inAir = s === 'cruise' || s === 'approach';
  setC172G1000Switches(ctx);
  // Altimeter settings (PFD BARO and standby altimeter, POH Before Takeoff item 7) to the local QNH.
  const qnh = v.get('env.qnh_inhg', 29.92);
  v.set(ADC.baroSetting(1), qnh);
  v.set(ADC.baroSetting(2), qnh);
  v.set(ADC.baroStd(1), 0);
  v.set(ADC.baroStd(2), 0);

  applyC172State(ctx, sys.core, s);

  // GRS 79 attitude / heading: aligned in every state but cold & dark.
  sys.ahrsHold.reset();
  sys.ahrs.reset(!cold);
  sys.suite.applyState(s);
  // GFC 700: AP and FD off (POH Before Takeoff: "Flight Director - OFF"); references synchronised.
  v.set(AP.fdOn(1), 0);
  v.set(AP.selHeading, Math.round(v.get(FDM.headingMag)) % 360 || 360);
  const alt = v.get(FDM.altMsl);
  v.set(AP.selAltitude, inAir ? Math.round(alt / 100) * 100 : Math.round((alt + 3000) / 500) * 500);
  v.set(AP.selVs, 0);
  sys.afcs.reset();
  sys.logic.reset();
  sys.lateLogic.reset();
  sys.disc.update(0);
  // Procedure latches: a takeoff preset stands for "Before takeoff" complete (AP preflight test and magneto
  // check done); a running preset has had its STBY BATT test (Starting engine 3a).
  sys.tires.reset();
  sys.procedures.reset();
  v.set(C172G_PROC.stbyTestOk, cold ? 0 : 1);
  if (s === 'takeoff') sys.procedures.markRunUpDone();
}
