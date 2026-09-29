/**
 * Cessna 172S (steam gauges, Bendix/King NAV II) initial-state presets. The shared switch,
 * engine, fuel, light and surface setup comes from c172s-common `applyC172State`
 * (docs/aircraft/c172s.md §9); this adds the variant's avionics and instruments:
 *
 *  - cold_dark: radio volume knobs OFF, KLN 94 and audio panel OFF, transponder OFF, the vacuum
 *    DG rotor stopped (it spins up with the engine-driven vacuum pumps).
 *  - every other state: POH "Starting engine ... Radios - ON" done, KAP 140 past its preflight
 *    test with the baro set (Supplement 15 Sec 4 A), KLN 94 past its turn-on pages with a GPS
 *    fix, transponder SBY on the ground (ALT for takeoff and in the air), DG aligned with the
 *    compass, altimeter set to the local QNH, NAV 1 / NAV 2 OBS and the heading bug on the
 *    current heading, autopilot OFF (Supplement 15 limitation 3: OFF during takeoff and landing;
 *    the cruise / approach presets leave the engagement to the pilot).
 */
import type { InitialState } from '../types';
import type { SimContext } from '../../core/SimContext';
import { ADC, AP, FDM, NAV } from '../../core/vars';
import { applyC172State } from '../c172s-common/states';
import { KAP, KLN, KMA, KMA_BUTTONS, KMA_MIC, KR, KT, KX, ST } from './vars';
import { KT_MODE } from './avionics/kt76c';
import { CDI1_RECEIVER } from './systems';
import type { C172SteamSystems } from './createSystems';

/** Writes the variant's own control vars for a state (all momentary controls released). */
export function setC172SteamSwitches(ctx: Pick<SimContext, 'vars'>, s: InitialState): void {
  const v = ctx.vars;
  const cold = s === 'cold_dark';
  const airborne = s === 'takeoff' || s === 'cruise' || s === 'approach';
  for (const n of [1, 2] as const) {
    const k = KX(n);
    v.set(k.comVol, cold ? 0 : 0.6);
    v.set(k.navVol, cold ? 0 : 0.4);
    v.set(k.comPull, 0);
    v.set(k.comXfr, 0);
    v.set(k.comInnerPull, 0);
    v.set(k.chan, 0);
    v.set(k.navIdent, 0);
    v.set(k.navXfr, 0);
    v.set(k.navMode, 0);
    v.set(k.navInnerPull, 0);
  }
  // KMA 28: ON, COM 1 mic, marker HI with audio, ICS ALL.
  v.set(KMA.power, cold ? 0 : 1);
  v.set(KMA.icsVol, 0.5);
  v.set(KMA.mic, KMA_MIC.com1);
  v.set(KMA.mkrSens, 1);
  v.set(KMA.icsMode, 0);
  for (const b of KMA_BUTTONS) v.set(KMA.sel(b), b === 'nav1' || b === 'mkr' ? 1 : 0);
  // KT 76C: SBY on the ground before takeoff, ALT in flight.
  v.set(KT.mode, cold ? KT_MODE.off : airborne ? KT_MODE.alt : KT_MODE.sby);
  v.set(KT.idt, 0);
  // KR 87: ON, ADF mode.
  v.set(KR.vol, cold ? 0 : 0.5);
  v.set(KR.adf, 1);
  v.set(KR.bfo, 0);
  v.set(KR.frq, 0);
  v.set(KR.fltEt, 0);
  v.set(KR.setRst, 0);
  v.set(KR.innerPull, 0);
  // KAP 140 momentary buttons.
  v.set(KAP.up, 0);
  v.set(KAP.dn, 0);
  v.set(KAP.baro, 0);
  // KLN 94.
  v.set(KLN.power, cold ? 0 : 1);
  v.set(KLN.brt, 0.8);
  v.set(KLN.scan, 0);
  // Wheel switches, NAV/GPS switch (NAV), cabin items.
  v.set(ST.navGpsBtn, 0);
  v.set(ST.cdiSource, 0);
  v.set(ST.metLeft, 0);
  v.set(ST.metRight, 0);
  v.set(ST.apDisc, 0);
  v.set(ST.pttPilot, 0);
  v.set(ST.pttCopilot, 0);
  v.set(ST.pttHandMic, 0);
  v.set(ST.gloveBox, 0);
  v.set(ST.visorLeft, 0);
  v.set(ST.visorRight, 0);
}

export function applyC172SteamState(ctx: SimContext, sys: C172SteamSystems, s: InitialState): void {
  const v = ctx.vars;
  const cold = s === 'cold_dark';
  const inAir = s === 'cruise' || s === 'approach';
  setC172SteamSwitches(ctx, s);
  // Altimeter (POH Before Takeoff "Flight Instruments - CHECK and SET") and the KAP 140 baro to the local QNH.
  const qnh = v.get('env.qnh_inhg', 29.92);
  v.set(ADC.baroSetting(1), qnh);
  v.set(ADC.baroStd(1), 0);

  applyC172State(ctx, sys.core, s);

  // Course selectors and heading bug on the current heading.
  const hdg = Math.round(v.get(FDM.headingMag)) % 360 || 360;
  v.set(NAV.obs(CDI1_RECEIVER), hdg);
  v.set(NAV.obs(1), hdg);
  v.set(NAV.obs(2), hdg);
  v.set(KLN.obs, hdg);
  v.set(AP.selHeading, hdg);
  const alt = v.get(FDM.altMsl);
  v.set(AP.selAltitude, inAir ? Math.round(alt / 100) * 100 : Math.round((alt + 3000) / 500) * 500);
  v.set(AP.selVs, 0);
  v.set(KAP.metCmd, 0);

  // Instruments: DG spun up with the engine running, stopped cold.
  if (cold) sys.dg.setStopped();
  else sys.dg.setSpunUp();
  sys.kapSensors.reset(!cold);

  // Avionics units.
  sys.kx1.reset();
  sys.kx2.reset();
  sys.kr.reset();
  sys.kt.reset();
  sys.kma.reset();
  sys.kt.setCode(1200);
  if (!cold) {
    sys.radios.gps?.forceAcquired();
    // One systems pass so the power inputs of the units follow the (settled) buses.
    sys.kx1.update(0);
    sys.kx2.update(0);
    sys.kr.update(0);
    sys.encoder.warm();
    sys.encoder.update(0);
    sys.kt.update(0);
    sys.kln.update(0);
    sys.kln.setReady();
    sys.kapSensors.update(0);
    sys.kap.setReady();
    sys.kap.baroInHg = qnh;
    sys.kap.baroFlash = false;
    sys.kap.update(0);
    sys.kap.post.update(0);
  }
  sys.kln.reset();
  sys.mux.reset();
  sys.afcs.reset();
  sys.kap.reset();
  sys.extras.reset();
  sys.altAlert.reset();
  sys.disc.update(0);
  // No fire burning; checklist latches: a preset past the preflight has done the annunciator TST, the
  // avionics fan and the KAP 140 preflight test (Supplement 15 Sec 4 A); the takeoff preset stands for
  // "Before takeoff" complete (magnetos checked).
  sys.fire.reset();
  sys.tires.reset();
  sys.procedures.reset();
  if (cold) sys.procedures.clearAll();
  else sys.procedures.markPreflightDone();
  if (s === 'takeoff') sys.procedures.markRunUpDone();
}
