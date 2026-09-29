/**
 * Citation Longitude crew controls added in the layout-audit fix round (the
 * AOPA 2021 and Textron flight-deck photographs show them; the first build
 * lacked them). Two subsystems:
 *
 *  - `LongitudeCrewControls` (after the FADEC lever law):
 *     - EIS thrust-mode label per engine (OG 7-7: TO / CLB / CRU / APR / T/R;
 *       green when pilot selected, magenta under the autothrottle). The FADEC
 *       law publishes a detent label only when a lever sits on a detent; the
 *       G5000 shows the governing rating, i.e. the highest detent at or below
 *       the lever (CRU below CLB), so the label is never blank in the forward
 *       range (EST reading of OG 7-7). APR while POWER RESERVE is active.
 *     - COCKPIT VOICE RECORDER row (pedestal aft, photograph: green TEST
 *       button, "HOLD 5 SEC" status light, HEADSET jack, red ERASE button).
 *       SCOPE: no audio is recorded; TEST held 5 s with the CVR powered lights
 *       the status light (`V.cvrTestOk`); ERASE is accepted only on the ground
 *       with the parking brake set (14 CFR 25.1457(d)(5) erase interlock
 *       practice) and sets `V.cvrErased`.
 *     - EVENT MARKER (pedestal aft right, photograph): SCOPE, counts the
 *       flight-data-recorder event marks (`V.eventCount`).
 *     - Control-wheel PTT / intercom switches: SCOPE, the COM transmit state
 *       (`V.transmitting`, COM powered) without a radio-transmission model.
 *     - Gaspers and sun visors: SCOPE, cockpit airflow / shading state
 *       (`ac.lon.ecs.gasper_flow`, `ac.lon.visor_shade`); the thermal model
 *       does not use them.
 *  - `LongitudeControlLock` (after the flight controls and the pitch/roll
 *    disconnect, before the trims and spoilers): CONTROL LOCK lever at LOCK
 *    holds the elevator, ailerons and rudder at neutral (gust lock; the
 *    thrust-lever interlock is in logic.ts, the NO TAKEOFF condition too).
 *    EST: Citation-family mechanical gust lock (the OG says "Control lock ...
 *    not modeled"; photograph: "CONTROL LOCK" lever, UNLOCK up / LOCK down).
 *
 * No per-step allocation (constant strings only).
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { G3K_EVENTS } from '../../../avionics/garmin-g3000/vars';
import { LON_VARS as V } from '../vars';
import { TLA } from './logic';

const MODE_VAR = ['', V.thrustMode(1), V.thrustMode(2)];
const TLA_VAR = ['', V.tla(1), V.tla(2)];
const REV_VAR = ['', 'eng1.reverser_pos', 'eng2.reverser_pos'];

/** Governing FADEC rating label for a thrust-lever position (see header). */
export function thrustModeFor(lever: number, apr: boolean, reverser: number): string {
  if (reverser > 0.05 || lever < -0.01) return 'T/R';
  if (lever <= TLA.idle) return '';
  if (apr && lever >= TLA.clb - 0.02) return 'APR';
  if (lever >= TLA.to - 0.01) return 'TO';
  if (lever >= TLA.clb - 0.01) return 'CLB';
  return 'CRU';
}

export class LongitudeCrewControls implements Subsystem {
  readonly name = 'lon.crew_controls';
  private cvrHeldS = 0;
  private prevErase = false;
  private prevEvent = false;
  private events = 0;

  constructor(private readonly vars: SimVars) {}

  update(dt: number): void {
    const v = this.vars;
    const apr = v.get(V.aprActive) !== 0;
    for (let i = 1; i <= 2; i++) v.setString(MODE_VAR[i], thrustModeFor(v.get(TLA_VAR[i]), apr, v.get(REV_VAR[i])));

    // Cockpit voice recorder (R emergency bus load 'cvr', electrical.ts).
    const cvrPwr = v.get('elec.cvr_powered') !== 0;
    this.cvrHeldS = cvrPwr && v.get(V.cvrTest) !== 0 ? this.cvrHeldS + dt : 0;
    v.set(V.cvrTestOk, this.cvrHeldS >= 5 ? 1 : 0);
    const erase = v.get(V.cvrErase) !== 0;
    if (erase && !this.prevErase && cvrPwr && v.get('gear.air_ground') !== 0 && v.get('brakes.parking_set') !== 0) v.set(V.cvrErased, 1);
    else if (v.get('gear.air_ground') === 0) v.set(V.cvrErased, 0);
    this.prevErase = erase;
    const ev = v.get(V.eventMarker) !== 0;
    if (ev && !this.prevEvent && cvrPwr) this.events++;
    this.prevEvent = ev;
    v.set(V.eventCount, this.events);

    // PTT (either wheel) keys the selected COM when it is powered (GIA 1 / 2).
    const ptt = v.get(V.pttL) !== 0 || v.get(V.pttR) !== 0;
    const comPwr = v.get('elec.gia1_powered') !== 0 || v.get('elec.gia2_powered') !== 0;
    v.set(V.transmitting, ptt && comPwr ? 1 : 0);
    v.set('ac.lon.com.ics_active', v.get(V.yokeIcsL) !== 0 || v.get(V.yokeIcsR) !== 0 ? 1 : 0);

    // Gaspers (fed from the cockpit ECS duct, EST 0.02 kg/s each fully open) and sun visors.
    const duct = v.get('pneu.pack_on') !== 0 ? 1 : 0;
    v.set('ac.lon.ecs.gasper_flow', duct * 0.02 * (v.get(V.gasperL) + v.get(V.gasperR)));
    v.set('ac.lon.visor_shade', Math.max(v.get(V.visorL), v.get(V.visorR)));
  }

  reset(): void {
    this.cvrHeldS = 0;
    this.prevErase = this.vars.get(V.cvrErase) !== 0;
    this.prevEvent = this.vars.get(V.eventMarker) !== 0;
  }
}

/** CONTROL LOCK: surfaces held at neutral while locked (see header). */
export class LongitudeControlLock implements Subsystem {
  readonly name = 'lon.control_lock';
  constructor(private readonly vars: SimVars) {}
  update(): void {
    const v = this.vars;
    if (v.get(V.controlLock) === 0) return;
    v.set('surf.elevator', 0);
    v.set('surf.aileron', 0);
    v.set('surf.rudder', 0);
  }
}

/** GMC 710 ALT knob events of the Longitude unit (single knob, "PUSH FINE", AOPA 2021 photograph c_gs21). */
export const LON_GMC_EVENTS = { altTurn: 'lon.gmc.alt', altPush: 'lon.gmc.alt_push' } as const;

/**
 * Longitude GMC 710 ALT knob: one knob engraved "PUSH FINE" (c_gs21) instead of the G3000 dual concentric ALT SEL
 * knob. EST (the G5000 Longitude pilot's guide text is not public): turning steps the selected altitude by 1,000 ft,
 * or by 100 ft (10 ft on an approach, G3000 PG §2.1) after a push selects FINE; a second push returns to 1,000 ft.
 * Forwards to the suite's ALT SEL outer / inner events. `V.altFine` holds the FINE state.
 */
export class LongitudeGmcAltKnob implements Subsystem {
  readonly name = 'lon.gmc_alt_knob';
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly vars: SimVars,
    events: EventBus | undefined,
  ) {
    if (!events) return;
    const clicks = (p: unknown): number => (typeof p === 'number' ? p : 1);
    const turn = (n: number) => events.emit(vars.get(V.altFine) !== 0 ? `${G3K_EVENTS.altTurnInner}${n > 0 ? '_inc' : '_dec'}` : `${G3K_EVENTS.altTurnOuter}${n > 0 ? '_inc' : '_dec'}`, Math.abs(n));
    this.offs.push(events.on(`${LON_GMC_EVENTS.altTurn}_inc`, (p) => turn(Math.abs(clicks(p)))));
    this.offs.push(events.on(`${LON_GMC_EVENTS.altTurn}_dec`, (p) => turn(-Math.abs(clicks(p)))));
    this.offs.push(events.on(LON_GMC_EVENTS.altPush, () => vars.set(V.altFine, vars.get(V.altFine) !== 0 ? 0 : 1)));
  }

  update(): void {
    // Event driven; the FINE state is read by the event handler above.
    this.vars.get(V.altFine);
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }
}
