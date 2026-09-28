/**
 * Global 6000 (Global Vision flight deck) control logic added with the
 * layout fix round (photos EB190582 / N835GL; GX pilot training guide
 * chapters 13 IAMS, 15 Lighting, 17 Power plant). Runs right after G6kLogic,
 * before the pneumatics / pressurization.
 *
 *  - PACK CONTROL rotary LO / NORM / HIGH / MAN (PTG 13 "PACK CONTROL
 *    Selector"; flow schedule PTG 13-21: NORM 30 lb/min per pack at sea level,
 *    HIGH 40, LO 20; single-pack operation selects the high schedule
 *    automatically; MAN drives the flow control valve full open with the ACSC
 *    disabled). Output `V.packFlowFactor` (flow / NORM) for the pack flow and
 *    `V.packCtlMan` (MAN) for the manual temperature path (environment.ts).
 *  - L / R MAN TEMP spring-loaded HOT / COLD toggles (photo): while held they
 *    slew the pack manual outlet demand `V.packManTemp` (EST 0.1 / s, i.e.
 *    10 s from full COLD to full HOT; no published rate).
 *  - Landing-light PULSE (PTG 15-28): "45 pulses per minute (L wing / R wing
 *    pulse alternately)" -> `V.ldgPulse` (1 = left phase, 0 = right phase).
 *  - Standby magnetic compass card (`V.compassHdg`): the magnetic heading
 *    (the compass is its own sensor: the earth's field seen by the aircraft
 *    heading, fdm.hdg_mag_deg) plus EST deviation (+/-1.5 deg, 2-cycle
 *    curve: a compensated compass card) through an EST 0.8 s damped lag.
 *    SCOPE: no northerly-turning / acceleration errors.
 *  - HUD: symbology shown (`V.hudOn`) with HUD power, DC BUS 1 (`elec.hud_powered`),
 *    BRT above the stop and the combiner deployed.
 *  - FDR EVENT button: counts event marks (`V.fdrEventCount`). SCOPE: no
 *    recorder model; the count is the recorded state.
 *  - Gasper openings summed into `V.gasperFlow` (environment.ts cockpit zone).
 *  - Control-wheel R/T / IC rocker -> `V.pttKeyed` (+1 R/T, -1 IC). SCOPE: no
 *    radio-transmit / intercom audio model; the keyed state is the output.
 *  - A/T engage on the take-off thrust advance: the Vision FCP has no A/T key
 *    (photo N835GL); AOPA 2012 ("First look at the Global 6000"): "as you push
 *    the thrust levers ahead for takeoff, the autothrottles take over
 *    automatically". On the ground, both thrust levers moved to or beyond the
 *    take-off minimum (engines.ts TLA.toMin) with the A/T powered and not
 *    engaged emit `at.engage` once (re-armed when a lever returns to IDLE).
 *  - EVS knob: gain `V.evsGain`; PUSH (EVS CAL) runs an EST 10 s calibration
 *    (`V.evsCalT`). SCOPE: no EVS infrared image is rendered.
 *
 * No per-step allocation.
 */
import type { Subsystem } from '../../types';
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { G6K_EVENTS, G6K_GASPERS, G6K_VARS as V } from '../vars';
import { TLA } from './engines';

/** PACK CONTROL flow factors (PTG 13-21 at sea level: LO 20, NORM 30, HIGH 40 lb/min per pack). */
export const PACK_FLOW = { lo: 20 / 30, norm: 1, high: 40 / 30 } as const;
/** EST MAN TEMP slew rate (full range per s). */
export const MAN_TEMP_RATE = 0.1;
/** PTG 15-28: 45 pulses per minute. */
export const PULSE_PERIOD_S = 60 / 45;

const GASPERS = G6K_GASPERS.map((g) => V.gasper(g));
const MT_SW = [V.packManTempSw('l'), V.packManTempSw('r')];
const MT = [V.packManTemp('l'), V.packManTemp('r')];

export class G6kVisionLogic implements Subsystem {
  readonly name = 'g6k.vision_logic';
  private pulseT = 0;
  private card = NaN;
  private prevEvent = 0;
  private eventMarks = 0;
  private prevCal = 0;
  private prevMode = 0;
  private calT = 0;

  private atArmed = true;

  constructor(
    private readonly v: SimVars,
    private readonly events: EventBus | null = null,
  ) {}

  update(dt: number): void {
    const v = this.v;
    // ---- PACK CONTROL
    const sel = v.get(V.packFlowSel, 1);
    const onePack = (v.get(V.pack('l')) === 1) !== (v.get(V.pack('r')) === 1);
    const f = sel === 0 ? PACK_FLOW.lo : sel === 2 || sel === 3 ? PACK_FLOW.high : onePack ? PACK_FLOW.high : PACK_FLOW.norm;
    v.set(V.packFlowFactor, f);
    v.set(V.packCtlMan, sel === 3 ? 1 : 0);
    // ---- MAN TEMP toggles
    for (let i = 0; i < 2; i++) {
      const sw = v.get(MT_SW[i]);
      if (sw !== 0) v.set(MT[i], Math.max(0, Math.min(1, v.get(MT[i], 0.5) + Math.sign(sw) * MAN_TEMP_RATE * dt)));
    }
    // ---- landing-light PULSE
    this.pulseT = (this.pulseT + dt) % PULSE_PERIOD_S;
    v.set(V.ldgPulse, this.pulseT < PULSE_PERIOD_S / 2 ? 1 : 0);
    // ---- standby compass
    const hdg = v.get('fdm.hdg_mag_deg');
    const target = hdg + 1.5 * Math.sin((2 * hdg * Math.PI) / 180);
    if (Number.isNaN(this.card)) this.card = target;
    let d = target - this.card;
    d -= 360 * Math.round(d / 360);
    this.card += d * (1 - Math.exp(-dt / 0.8));
    this.card = ((this.card % 360) + 360) % 360;
    v.set(V.compassHdg, this.card);
    v.set(V.compassReadable, v.get(V.compassOpen) !== 0 ? 1 : 0);
    // ---- HUD (PUSH/MODE cycles the display mode)
    const mb = v.get(V.hudModeBtn);
    if (mb !== 0 && this.prevMode === 0) v.set(V.hudMode, (v.get(V.hudMode) + 1) % 4);
    this.prevMode = mb;
    const hudPwr = v.get(V.hudPower) === 1 && v.get('elec.hud_powered') !== 0;
    const hudBrt = v.get(V.hudBrt);
    const deployed = v.get(V.hudStow) === 0;
    const hud = hudPwr && hudBrt > 0.02 && deployed;
    v.set(V.hudOn, hud ? 1 : 0);
    v.set(V.hudModeEff, hud ? v.get(V.hudMode) : -1);
    // ---- FDR EVENT
    const ev = v.get(V.fdrEvent);
    if (ev !== 0 && this.prevEvent === 0) this.eventMarks++;
    this.prevEvent = ev;
    v.set(V.fdrEventCount, this.eventMarks);
    // ---- A/T engage on the take-off thrust advance (ground)
    const t1 = v.get(V.tla(1));
    const t2 = v.get(V.tla(2));
    if (t1 <= TLA.idle + 0.01 || t2 <= TLA.idle + 0.01) this.atArmed = true;
    if (this.atArmed && v.get('gear.air_ground') !== 0 && t1 >= TLA.toMin && t2 >= TLA.toMin) {
      this.atArmed = false;
      if (v.get('ap.at_engaged') === 0 && (v.get('elec.afcs1_powered') !== 0 || v.get('elec.afcs2_powered') !== 0)) this.events?.emit(G6K_EVENTS.atEngage);
    }
    // ---- gaspers
    let g = 0;
    for (let i = 0; i < GASPERS.length; i++) g += v.get(GASPERS[i]);
    v.set(V.gasperFlow, g);
    // ---- R/T / IC rockers (pilot priority)
    const p1 = v.get(V.yokePtt(1));
    const p2 = v.get(V.yokePtt(2));
    v.set(V.pttKeyed, p1 !== 0 ? p1 : p2);
    // ---- EVS CAL (push) with the EVS gain above MIN
    const cal = v.get(V.evsCal);
    const gain = v.get(V.evsGain);
    if (cal !== 0 && this.prevCal === 0 && gain > 0) this.calT = 10;
    this.prevCal = cal;
    this.calT = Math.max(0, this.calT - dt);
    v.set(V.evsCalT, this.calT);
  }

  reset(): void {
    this.card = NaN;
    this.pulseT = 0;
    this.atArmed = true;
    this.prevEvent = this.v.get(V.fdrEvent);
    this.eventMarks = 0;
    this.prevCal = this.v.get(V.evsCal);
    this.prevMode = this.v.get(V.hudModeBtn);
    this.calT = 0;
  }
}
