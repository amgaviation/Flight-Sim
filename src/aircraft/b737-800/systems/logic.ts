/**
 * Boeing 737-800 glue logic: the relay / valve / annunciator logic that
 * connects the cockpit controls to the systems-library blocks and has no
 * generic block of its own. `B738Logic` runs early in the systems list
 * (after the AC source selection, before the power blocks), `B738LogicLate`
 * runs last and computes every indicator output (annunciator lights, master
 * caution / six-pack, fire warning and bell, meters, gauges, clocks, ISDU).
 * Allocation-free per update (every expression is compiled once).
 */
import type { SimContext } from '../../../core/SimContext';
import type { Subsystem } from '../../types';
import type { FailureDef } from '../../../systems/failures';
import type { CasManager } from '../../../systems/warning';
import { NAV } from '../../../core/vars';
import { B737_VARS } from '../../../avionics/boeing-737/vars';
import { EdgeDetector, compileCondition, compileBinding, type Evaluator } from '../../../systems/util';
import { B738, ACP_RECEIVERS, SIX_PACK_GROUPS, FUEL_PUMPS, HYD_PUMP_SWITCHES, WINDOW_HEATS, XPDR_SEL, type SixPackGroup, type Side } from '../vars';
import { B738_ANNUNCIATORS } from './cas';

/** Audio control panel var names, precomputed (the logic runs at 60 Hz and must not allocate). */
const ACP_TABLE = ([1, 2, 3] as const).map((a) => ({
  mic: B738.acpMic(a),
  ptt: B738.acpPtt(a),
  mask: B738.acpMaskBoom(a),
  yoke: a < 3 ? B738.yokeMic(a as Side) : null,
  keyedTx: `ac.b738.acp${a}.keyed_tx`,
  keyedInt: `ac.b738.acp${a}.keyed_int`,
  micSrc: `ac.b738.acp${a}.mic_mask`,
  rx: ACP_RECEIVERS.map((rx) => ({ on: rx === 'spkr' ? null : B738.acpRxOn(a, rx), vol: B738.acpRxVol(a, rx), lvl: `ac.b738.acp${a}.lvl_${rx}`, isMkr: rx === 'mkr' })),
}));
const EFIS_WXR = [B737_VARS.efisMapButton(1, 'wxr'), B737_VARS.efisMapButton(2, 'wxr')] as const;
const COM_TX = ['ac.b738.com1.transmitting', 'ac.b738.com2.transmitting'] as const;
const COM_POWERED = ['com1.powered', 'com2.powered'] as const;

const SIDES: readonly Side[] = [1, 2];

/** Early glue logic (inputs -> commands). */
export class B738Logic implements Subsystem {
  readonly name = 'b738.logic';
  private readonly e = {
    hornCutout: new EdgeDetector(),
    gpwsTest: new EdgeDetector(),
    belowGs: [new EdgeDetector(), new EdgeDetector()],
    navXfer: [new EdgeDetector(), new EdgeDetector()],
    comXfer: [new EdgeDetector(), new EdgeDetector()],
    adfXfer: [new EdgeDetector(), new EdgeDetector()],
    ident: new EdgeDetector(),
    air: new EdgeDetector(),
    clockChr: [new EdgeDetector(), new EdgeDetector()],
    clockTd: [new EdgeDetector(), new EdgeDetector()],
    clockSet: [new EdgeDetector(), new EdgeDetector()],
    clockPlus: [new EdgeDetector(), new EdgeDetector()],
    clockMinus: [new EdgeDetector(), new EdgeDetector()],
    selcal: [new EdgeDetector(), new EdgeDetector(), new EdgeDetector(), new EdgeDetector(), new EdgeDetector()],
    isfdStd: new EdgeDetector(),
    isfdRst: new EdgeDetector(),
    grdCall: new EdgeDetector(),
    attendCall: new EdgeDetector(),
    cvrTest: new EdgeDetector(),
  };
  /** Cabin attendant answering an ATTEND call (s until the call-back, -1 = none). */
  private attendT = -1;
  /** Ground crew external-power request: seconds until the GPU is (dis)connected, -1 = none. */
  private gpuReqT = -1;
  /** Incoming call from the ground crew (s remaining). */
  private crewCallT = 0;
  private cvrEraseT = 0;
  private rtoSbArmed = false;
  private leAltFull = false;
  /** Wiper sweep phase (0..1 per stroke cycle) and INT dwell timer per side. */
  private readonly wiperPh = [0, 0];
  private readonly wiperWait = [7, 7];
  /** Emergency light battery pack charge (0..1). */
  private emerPack = 1;
  /** Previous cabin sign state (bit 0 NO SMOKING, bit 1 FASTEN BELTS), -1 = unknown. */
  private prevSigns = -1;
  /** Flight deck door emergency access: request pending, delay timer (s, -1 = none), unlock timer (s). */
  private doorReq = false;
  private doorAccessT = -1;
  private doorUnlockT = 0;
  /** ISFD ATT RST action (createSystems wires it to the ISFD attitude re-alignment). */
  isfdReset: (() => void) | null = null;
  private batDisch = [0, 0, 0];
  private maxAltFt = 0;
  private offSched = false;
  private chrRun: [boolean, boolean] = [false, false];
  private chrS = [0, 0];
  private etS = [0, 0];
  /** Clock TIME/DATE mode (0 UTC time, 1 UTC date, 2 MAN time, 3 MAN date), SET field, MAN offset (h). */
  private clkMode = [0, 0];
  private clkField = [0, 0];
  private clkManH = [0, 0];
  private selcalLit = [0, 0, 0, 0, 0];
  private fdrHrs = 0;
  private apuStartReq = false;
  /** Seconds since the APU ECU lost power (ride-through, see update). */
  private apuEcuOffS = 1e9;
  /**
   * Set by the in-air state presets: engage CMD A (HDG SEL, ALT HOLD, A/T MCP SPD) as soon as the ADIRU
   * air data finishes its power-up self test (the A/P refuses engagement with invalid sensors).
   */
  pendingApEngage = false;

  constructor(private readonly ctx: Pick<SimContext, 'vars' | 'events'> & Partial<Pick<SimContext, 'audio'>>) {
    // SELCAL call received on channel k (0 VHF 1 .. 4 HF 2): lights the SELCAL light until it is pushed.
    // SCOPE: no ground-station model emits calls; scenarios / instructors can emit the event.
    ctx.events.on('b738.selcal.call', (k) => {
      const i = Number(k);
      if (i >= 0 && i < 5) this.selcalLit[i] = 1;
    });
    ctx.events.on('b738.door.emer_access', () => {
      this.doorReq = true;
    });
  }

  update(dt: number): void {
    const v = this.ctx.vars;
    const ev = this.ctx.events;
    const air = v.get('gear.air_ground') === 0;

    // ---- Thrust levers -> EEC inputs; reverse levers only from the forward idle stop (mechanical interlock, FCOM 7.20).
    for (const i of SIDES) {
      const tla = Math.max(0, Math.min(1, v.get(B738.tla(i))));
      const rev = Math.max(0, Math.min(1, v.get(B738.revLever(i))));
      v.set(B738.fadecTla(i), rev > 0.02 ? 0 : tla);
      v.set(`ac.b738.fadec_rev${i}`, tla < 0.03 ? rev : 0);
      // REVERSER light condition: sleeve unlocked / deployed without a reverse command (EST).
      v.set(`ac.b738.rev_fault${i}`, (v.get(`fadec.eng${i}.rev_unlocked`) !== 0 || v.get(`eng${i}.reverser_pos`) > 0.05) && rev < 0.02 ? 1 : 0);
    }

    // ---- RTO auto speedbrake arming: a take-off thrust advance on the ground (either lever beyond ~60 %, as the
    // take-off configuration warning); cleared in the air and once slowed below 20 kt with the levers at idle.
    const tlaMax = Math.max(v.get(B738.tla(1)), v.get(B738.tla(2)));
    if (air) this.rtoSbArmed = false;
    else if (tlaMax > 0.6) this.rtoSbArmed = true;
    else if (tlaMax < 0.05 && v.get('gear.wheel_speed1_kt') < 20 && v.get('gear.wheel_speed2_kt') < 20) this.rtoSbArmed = false;
    v.set('ac.b738.rto_sb_armed', this.rtoSbArmed ? 1 : 0);

    // ---- Tiller: hardware axis and the 3D cockpit handle (whichever is deflected more) -> nose-wheel steering.
    const tHw = v.get('input.tiller');
    const t3 = v.get(B738.tiller3d);
    v.set(B738.tillerCmd, Math.abs(tHw) >= Math.abs(t3) ? tHw : t3);

    // ---- Stab trim column cutout switches, bypassed by STAB TRIM OVERRIDE (FCOM 9.20).
    v.set('ac.b738.trim_column', v.get(B738.stabTrimOvrd) !== 0 ? 0 : v.get('input.pitch'));
    // Aileron trim: both switches must be moved in the same direction.
    const a1 = v.get(B738.ailTrim(1));
    const a2 = v.get(B738.ailTrim(2));
    v.set('ac.b738.ail_trim_cmd', Math.sign(a1) === Math.sign(a2) ? Math.sign(a1) : 0);

    // ---- Standby hydraulics (FCOM 9.20 / 13.20).
    const flaps = v.get('surf.flaps_deg');
    const wheelFast = v.get('gear.wheel_speed1_kt') > 60 || v.get('gear.wheel_speed2_kt') > 60;
    const stbyRudSw = v.get(B738.fltCtl('a')) <= -0.5 || v.get(B738.fltCtl('b')) <= -0.5;
    const lossA = v.get(B738.fltCtl('a')) >= 0.5 && v.get('hyd.a_psi') < 1300;
    const lossB = v.get(B738.fltCtl('b')) >= 0.5 && v.get('hyd.b_psi') < 1300;
    const autoStby = (lossA || lossB) && flaps > 0.5 && (air || wheelFast) && !stbyRudSw;
    v.set(B738.stbyRudder, stbyRudSw || autoStby ? 1 : 0);
    v.set(B738.stbyPumpCmd, stbyRudSw || autoStby || v.get(B738.altFlapsArm) !== 0 ? 1 : 0);
    // PTU: airborne, B engine-driven pump pressure low, flaps extended but less than 15 (FCOM 13.20).
    v.set(B738.ptuCmd, air && v.get('hyd.edp_b_lowpress') !== 0 && flaps > 0.5 && flaps < 14.5 ? 1 : 0);
    // Landing gear transfer unit: airborne, gear lever UP, engine 1 N2 below ~50 % (EST limit), either main gear
    // not up and locked, B available (FCOM 14.20 / 13.20).
    const mainsUp = v.get('gear.pos1') < 0.01 && v.get('gear.pos2') < 0.01;
    v.set(B738.gearXferUnit, air && v.get(B738.gearLever) < 0.25 && v.get('eng1.n2_pct') < 50 && !mainsUp && v.get('hyd.b_psi') > 1000 ? 1 : 0);

    // ---- Wing anti-ice: switch trips OFF at lift-off; on the ground the valves close with take-off thrust (FCOM 3.20).
    if (this.e.air.update(air) === 1 && v.get(B738.wingAi) !== 0) v.set(B738.wingAi, 0);
    const wai = v.get(B738.wingAi) !== 0 && v.get('elec.wing_ai_valve_powered') !== 0 && (air || (v.get(B738.tla(1)) < 0.6 && v.get(B738.tla(2)) < 0.6));
    v.set(B738.wingAiValveCmd, wai ? 1 : 0);

    // ---- APU start latch: START (spring-loaded) latches a start request until the APU runs or the switch goes OFF.
    const apuSw = v.get(B738.apuSw);
    if (apuSw >= 1.5) this.apuStartReq = true;
    if (apuSw < 0.5 || v.get('apu.running') !== 0 || v.get('apu.fault') !== 0) this.apuStartReq = false;
    v.set('ac.b738.apu_start_req', this.apuStartReq ? 1 : 0);
    // APU ECU power ride-through: a bus transfer (e.g. ground power -> APU generator, where the battery bus
    // changes from TR3 to the battery) interrupts the battery bus for a few tens of ms; the ECU rides through
    // interrupts up to 200 ms (DO-160 Section 16 power-interrupt class; EST for the 131-9B ECU) instead of
    // shutting the APU down.
    this.apuEcuOffS = v.get('elec.apu_ecu_powered') !== 0 ? 0 : this.apuEcuOffS + dt;
    v.set('ac.b738.apu_ecu_hold', this.apuEcuOffS < 0.2 ? 1 : 0);

    // ---- Deferred A/P engagement of the in-air state presets.
    if (this.pendingApEngage && v.get('adc1.valid') !== 0 && v.get('ahrs1.valid') !== 0) {
      this.pendingApEngage = false;
      v.set('ac.at_arm', 1);
      for (const b of ['cmd_a', 'hdgsel', 'althld', 'speed']) ev.emit(`ac.mcp.${b}`);
    }

    // ---- Ground crew (SCOPE: there is no ground-services UI; the crew calls the ground engineer with GRD CALL,
    // who plugs in / removes the external power cable). On the ground and stopped, a GRD CALL push asks for the
    // GPU to be connected (EST 20 s) or, if connected, removed (EST 10 s). The cable is pulled if the aircraft
    // moves (> 2 kt ground speed).
    if (this.e.grdCall.rising(v.get(B738.grdCall) !== 0) && !air && v.get('fdm.gs_kt') < 1 && this.gpuReqT < 0) {
      this.gpuReqT = v.get(B738.gpuConnected) !== 0 ? 10 : 20;
    }
    if (this.gpuReqT >= 0) {
      this.gpuReqT -= dt;
      if (this.gpuReqT < 0) {
        v.set(B738.gpuConnected, v.get(B738.gpuConnected) !== 0 ? 0 : 1);
        this.crewCallT = 5; // the ground engineer calls the flight deck back (blue CALL light)
      }
    }
    // ATTEND: the cabin chime sounds and the attendant calls the flight deck back on the interphone (EST 8 s).
    if (this.e.attendCall.rising(v.get(B738.attendCall) !== 0) && this.attendT < 0) this.attendT = 8;
    if (this.attendT >= 0) {
      this.attendT -= dt;
      if (this.attendT < 0) this.crewCallT = 5;
    }
    if (this.crewCallT > 0) this.crewCallT -= dt;
    v.set('ac.b738.crew_call_in', this.crewCallT > 0 ? 1 : 0);
    if (v.get(B738.gpuConnected) !== 0 && (air || v.get('fdm.gs_kt') > 2)) {
      v.set(B738.gpuConnected, 0);
      this.gpuReqT = -1;
    }

    // ---- Momentary switches -> events.
    if (this.e.hornCutout.rising(v.get(B738.hornCutout) !== 0)) ev.emit('gear.horn_silence');
    if (this.e.gpwsTest.rising(v.get(B738.gpwsTest) !== 0)) ev.emit('taws.test');
    for (const s of SIDES) if (this.e.belowGs[s - 1].rising(v.get(B738.belowGs(s)) !== 0)) ev.emit('taws.gs_cancel');

    // ---- Radio panels: transfer switches swap active / standby.
    for (const r of SIDES) {
      if (this.e.navXfer[r - 1].rising(v.get(B738.navXfer(r)) !== 0)) swap(v, NAV.activeFreq(r), NAV.standbyFreq(r));
      if (this.e.comXfer[r - 1].rising(v.get(B738.comXfer(r)) !== 0)) swap(v, NAV.comActive(r), NAV.comStandby(r));
      if (this.e.adfXfer[r - 1].rising(v.get(B738.adfXfer(r)) !== 0)) swap(v, NAV.adfActive(r), NAV.adfStandby(r));
      // ADF mode: ANT (1) = aural only (no bearing), ADF (2) = bearing (nav adf{r}.mode, Radios).
      v.set(NAV.adfMode(r), v.get(B738.adfMode(r)));
    }
    // ---- ATC / TCAS panel.
    const sel = v.get(B738.xpdrModeSel);
    // ATC 1 / 2 selects the active transponder (the other is in standby), each with its own power and failure
    // (FCOM 15.20); the selected unit feeds xpdr.mode and the TCAS.
    const atcSel2 = v.get(B738.xpdrAtc) >= 1.5;
    const xpdrOn = v.get(atcSel2 ? 'elec.xpdr2_powered' : 'elec.xpdr_powered') !== 0 && v.get(atcSel2 ? 'fail.b738.xpdr2' : 'fail.b738.xpdr1') === 0;
    const mode = !xpdrOn ? 0 : sel <= XPDR_SEL.stby ? 1 : sel === XPDR_SEL.altOff ? 2 : sel === XPDR_SEL.xpndr ? 3 : sel === XPDR_SEL.taOnly ? 4 : 5;
    if (sel !== XPDR_SEL.test) v.set(NAV.xpdrMode, mode);
    if (this.e.ident.rising(v.get(B738.xpdrIdentBtn) !== 0)) v.set(NAV.xpdrIdent, 1);
    // TCAS display altitude band (FCOM 15.20 TCAS): NORM +/-2,700 ft; ABOVE +9,900 / -2,700 ft; BELOW +2,700 /
    // -9,900 ft. Read by the TCAS display filter (surveillance.ts); TAs and RAs are always shown.
    const band = v.get(B738.tcasRange);
    v.set('tcas.band_above_ft', band > 0.5 ? 9900 : 2700);
    v.set('tcas.band_below_ft', band < -0.5 ? 9900 : 2700);
    // TEST position of the mode selector (spring-loaded): runs the TCAS / transponder self test (surveillance.ts).
    v.set('ac.b738.tcas_test_sw', sel === XPDR_SEL.test && xpdrOn ? 1 : 0);

    // ---- Battery discharge detection (FCOM 6.20: > 5 A for 95 s, > 15 A for 25 s, > 100 A for 1.2 s).
    const disch = -v.get('elec.batt_amps');
    const lim = [5, 15, 100];
    let batDisch = false;
    for (let k = 0; k < 3; k++) {
      this.batDisch[k] = disch > lim[k] ? this.batDisch[k] + dt : 0;
      if (this.batDisch[k] > [95, 25, 1.2][k]) batDisch = true;
    }
    // Not during APU start cranking on the battery (EST inhibit).
    v.set('ac.b738.bat_disch_cond', batDisch && v.get('apu.starter') === 0 ? 1 : 0);

    // ---- Off-schedule descent: descent started before reaching the FLT ALT (FCOM 2.40).
    const alt = v.get('fdm.press_alt_ft');
    if (!air) {
      this.maxAltFt = alt;
      this.offSched = false;
    } else {
      this.maxAltFt = Math.max(this.maxAltFt, alt);
      if (v.get(B738.pressMode) === 0 && v.get(B738.fltAltFt) - this.maxAltFt > 1000 && this.maxAltFt - alt > 1000) this.offSched = true;
    }
    v.set('ac.b738.off_sched_descent', this.offSched ? 1 : 0);

    // ---- Clocks: CHR start/stop/reset per push cycle; ET HLD / RUN / RESET; FDR hour meter.
    for (const s of SIDES) {
      const i = s - 1;
      if (this.e.clockChr[i].rising(v.get(B738.clockChr(s)) !== 0)) {
        if (!this.chrRun[i] && this.chrS[i] > 0) this.chrS[i] = 0;
        else this.chrRun[i] = !this.chrRun[i];
      }
      // RESET push: chronograph to zero (and stopped); ET switch RESET (spring-loaded to HLD) zeroes the ET
      // (FCOM 10.10 clock).
      if (v.get(B738.clockReset(s)) !== 0) {
        this.chrS[i] = 0;
        this.chrRun[i] = false;
      }
      if (this.chrRun[i]) this.chrS[i] += dt;
      const et = v.get(B738.clockEt(s));
      if (et >= 0.5) this.etS[i] = 0;
      else if (et > -0.5) this.etS[i] += dt;
      v.set(B738.lt.clockChrS(s), this.chrS[i]);
      v.set(B738.lt.clockEtS(s), this.etS[i]);
      v.set(B738.lt.clockEtRun(s), et > -0.5 ? 1 : 0);
      // TIME/DATE cycles UTC time / UTC date / MAN time / MAN date (and ends a SET sequence); SET steps the MAN
      // field (hours, minutes on the time page; day on the date page); + / - adjust it (flightdeck737.be clock page).
      if (this.e.clockTd[i].rising(v.get(B738.clockTimeDate(s)) !== 0)) {
        this.clkMode[i] = (this.clkMode[i] + 1) % 4;
        this.clkField[i] = 0;
      }
      if (this.e.clockSet[i].rising(v.get(B738.clockSet(s)) !== 0) && this.clkMode[i] >= 2) {
        const nFields = this.clkMode[i] === 2 ? 2 : 1;
        this.clkField[i] = (this.clkField[i] + 1) % (nFields + 1);
      }
      const step = this.clkField[i] === 0 ? 0 : this.clkMode[i] === 3 ? 24 : this.clkField[i] === 1 ? 1 : 1 / 60;
      if (this.e.clockPlus[i].rising(v.get(B738.clockPlus(s)) !== 0)) this.clkManH[i] += step;
      if (this.e.clockMinus[i].rising(v.get(B738.clockMinus(s)) !== 0)) this.clkManH[i] -= step;
      v.set(B738.lt.clockMode(s), this.clkMode[i]);
      v.set(B738.lt.clockSetField(s), this.clkField[i]);
      v.set(B738.lt.clockManOffsetH(s), this.clkManH[i]);
      // No. 2 window crank: the window only opens on the ground (SCOPE: the pane does not move; in flight the
      // cabin differential pressure holds it closed).
      v.set(`ac.b738.side_window_open${s}`, !air ? v.get(B738.windowCrank(s)) : 0);
      // FOOT AIR / WINDSHIELD AIR: share of the pilot's conditioned-air outlet diverted (SCOPE, EST 0.5 each).
      v.set(`ac.b738.fd_air_foot${s}`, v.get(B738.footAir(s)) !== 0 ? 0.5 : 0);
      v.set(`ac.b738.fd_air_ws${s}`, v.get(B738.windshieldAir(s)) !== 0 ? 0.5 : 0);
      // HF 1 / 2: receiver powered (mode not OFF, AC transfer bus powered); SCOPE: no propagation.
      const hfMode = v.get(B738.hfMode(s));
      const hfOn = hfMode > 0 && v.get(s === 1 ? 'elec.xfr1_powered' : 'elec.xfr2_powered', 1) !== 0;
      v.set(`ac.b738.hf${s}.powered`, hfOn ? 1 : 0);
      v.set(`ac.b738.hf${s}.active_mhz`, hfOn ? v.get(B738.hfFreqKhz(s), 2000) / 1000 : 0);
      v.set(`ac.b738.hf${s}.squelch`, hfOn ? 1 - v.get(B738.hfSens(s), 1) : 1);
    }
    // ---- SELCAL: each light is reset by pushing it (SCOPE: no ground-station SELCAL calls are generated).
    for (let k = 0; k < 5; k++) {
      if (this.e.selcal[k].rising(v.get(B738.selcalReset(k as 0 | 1 | 2 | 3 | 4)) !== 0)) this.selcalLit[k] = 0;
      v.set(B738.lt.selcal(k as 0 | 1 | 2 | 3 | 4), this.selcalLit[k]);
    }
    if (v.get('eng1.running') !== 0 || v.get('eng2.running') !== 0) this.fdrHrs += dt / 3600;
    v.set('ac.b738.fdr_hours', this.fdrHrs);

    // ---- Wipers (FCOM 3.20): PARK / INT (one stroke every ~7 s) / LOW / HIGH, AC motor per side (XFR 1 / 2).
    // The blade sweeps 0 (parked) -> 1 (outboard) -> 0; the windshield rain effect reads the rain removal.
    // EST stroke rates: LOW ~80, HIGH ~120 cycles / min (no public figure; typical transport wipers).
    for (const s of SIDES) {
      const k = s - 1;
      const w = Math.round(v.get(B738.wiper(s)));
      const pwr = v.get(s === 1 ? 'elec.wiper_l_powered' : 'elec.wiper_r_powered') !== 0;
      const cycleS = w === 3 ? 0.5 : w === 2 ? 0.75 : 1.1;
      if (pwr) {
        if (this.wiperPh[k] > 0 || w >= 2) {
          this.wiperPh[k] += dt / cycleS;
          if (this.wiperPh[k] >= 1) this.wiperPh[k] = w >= 2 ? this.wiperPh[k] - 1 : 0;
        } else if (w === 1) {
          this.wiperWait[k] += dt;
          if (this.wiperWait[k] >= 7) {
            this.wiperWait[k] = 0;
            this.wiperPh[k] = 1e-6;
          }
        }
        if (w !== 1) this.wiperWait[k] = 7; // INT selected: first stroke at once
      }
      const ph = this.wiperPh[k];
      v.set(B738.wiperSweep(s), ph < 0.5 ? ph * 2 : 2 - ph * 2);
      v.set(`ac.b738.wiper_rain_removal${s}`, !pwr || w <= 0 ? 0 : w === 1 ? 0.4 : w === 2 ? 0.75 : 1);
    }
    // ---- Emergency lights (FCOM 1.40): ON lights them; ARMED lights them automatically when DC bus 1 fails or AC
    // power is turned off. They run on their own NiCd battery packs (charged from DC bus 1; FAR 25.812(k): at least
    // 10 min; EST 15 min capacity).
    const emerSw = v.get(B738.emerExitLt);
    const dc1 = v.get('elec.dc1_powered') !== 0;
    const acOff = v.get('elec.xfr1_powered') === 0 && v.get('elec.xfr2_powered') === 0;
    const emerOn = (emerSw >= 1.5 || (emerSw >= 0.5 && (!dc1 || acOff))) && this.emerPack > 0;
    if (emerOn) this.emerPack = Math.max(0, this.emerPack - dt / 900);
    else if (dc1 && v.get('elec.emer_lts_powered') !== 0) this.emerPack = Math.min(1, this.emerPack + dt / 3600);
    v.set(B738.emerLtsOn, emerOn ? 1 : 0);
    v.set('ac.b738.emer_lts_pack', this.emerPack);
    // ---- Igniters (FCOM 7.20): GRD with the start lever at IDLE and CONT fire the selected igniter(s)
    // (IGNITION L / BOTH / R); FLT fires both regardless of the IGNITION select switch.
    const ign = v.get(B738.ignSel);
    for (const i of SIDES) {
      const es = v.get(B738.engStart(i));
      const flt = es >= 2.5;
      const req = flt || es >= 1.5 || (es < 0.5 && v.get(B738.startLever(i)) >= 0.5);
      v.set(`eng${i}.igniters_l`, req && (flt || ign <= 0.5) && v.get('elec.ign_l_powered') !== 0 ? 1 : 0);
      v.set(`eng${i}.igniters_r`, req && (flt || ign >= -0.5) && v.get('elec.ign_r_powered') !== 0 ? 1 : 0);
    }
    // ---- Crew oxygen mask regulators (side consoles): EMERGENCY (2) / 100% (1) / N diluter (0) -> OxygenSystem mode.
    for (const s of SIDES) v.set(`ac.b738.oxy_mode${s}`, v.get(B738.oxyEmer(s)) !== 0 ? 2 : v.get(B738.oxyDiluter(s)) !== 0 ? 0 : 1);
    // ---- Alternate flaps drive running (electric motor load, electrical.ts).
    const altSw = v.get(B738.altFlapsSw);
    // ALTERNATE FLAPS DOWN with ARM: LE devices to FULL EXTEND (standby hydraulics), latched (FCOM 9.20: "LE devices
    // cannot be retracted by the alternate system"); released once ARM is OFF with system B pressure restored.
    if (v.get(B738.altFlapsArm) !== 0 && altSw >= 0.5) this.leAltFull = true;
    else if (v.get(B738.altFlapsArm) === 0 && v.get('hyd.b_psi') > 1000) this.leAltFull = false;
    v.set('ac.b738.le_alt_full', this.leAltFull ? 1 : 0);
    v.set('flaps.alt_moving', altSw !== 0 && v.get(B738.altFlapsArm) !== 0 && v.get('elec.alt_flaps_powered') !== 0 ? 1 : 0);
    // ---- Outflow valve switch: effective only in MAN (FCOM 2.40); the pressurization block reads the result.
    const outSw = v.get(B738.outflowSw);
    v.set('ac.b738.outflow_cmd', v.get(B738.pressMode) === 2 ? outSw : 0);
    // ---- CVR ERASE: on the ground with the parking brake set, held ~2 s (FCOM 5.10); an erase tone is heard in the
    // headset jack (EST: short tone). TEST: status light and test tone. SCOPE: no recording is modelled.
    this.cvrEraseT = v.get(B738.cvrErase) !== 0 && !air && v.get(B738.parkBrake) !== 0 ? this.cvrEraseT + dt : 0;
    if (this.cvrEraseT > 2) {
      if (v.get('ac.b738.cvr_erased') === 0) this.ctx.audio?.play('chime', { volume: 0.25, rate: 1.4 });
      v.set('ac.b738.cvr_erased', 1);
    } else if (v.get(B738.cvrTest) !== 0) v.set('ac.b738.cvr_erased', 0);
    if (this.e.cvrTest.rising(v.get(B738.cvrTest) !== 0)) this.ctx.audio?.play('chime', { volume: 0.2, rate: 1.2 });
    // ---- ISFD: BARO push = STD toggle, HP/IN units, ATT RST realigns the attitude, APP selects the ILS deviation display.
    if (this.e.isfdStd.rising(v.get(B738.isfdStd) !== 0)) v.set('adc3.baro_std', v.get('adc3.baro_std') !== 0 ? 0 : 1);
    if (this.e.isfdRst.rising(v.get(B738.isfdRst) !== 0)) this.isfdReset?.();
    const baro = v.get('adc3.baro_inhg', 29.92);
    v.set('ac.b738.isfd_baro_disp', v.get('adc3.baro_std') !== 0 ? (v.get(B738.isfdHpa) !== 0 ? 1013 : 29.92) : v.get(B738.isfdHpa) !== 0 ? Math.round(baro * 33.8639) : Math.round(baro * 100) / 100);
    const app = v.get(B738.isfdApp);
    v.set('ac.b738.isfd_loc_dev', app >= 1 ? (app === 2 ? -1 : 1) * v.get('nav1.cdi') : 0);
    v.set('ac.b738.isfd_gs_dev', app === 1 ? v.get('nav1.gs_dev') : 0);
    // ---- Radio panels: RTP power switches, ADF TONE (BFO), NAV TEST (SCOPE: receiver self test shown as a state flag).
    for (const r of SIDES) {
      v.set(`com${r}.powered`, v.get(B738.rtpPower(r)) !== 0 && v.get(r === 1 ? 'elec.com1_powered' : 'elec.com2_powered') !== 0 ? 1 : 0);
      v.set(`adf${r}.bfo`, v.get(B738.adfTone(r)) !== 0 ? 1 : 0);
      v.set(`nav${r}.test`, v.get(B738.navTest(r)) !== 0 && v.get(`nav${r}.powered`) !== 0 ? 1 : 0);
    }
    // ---- Audio control panels. SCOPE: no audio routing; the selections are published as state.
    for (const a of [1, 2, 3] as const) {
      v.set(`ac.b738.acp${a}.tx`, v.get(B738.acpMic(a)));
      v.set(`ac.b738.acp${a}.degraded`, v.get(B738.acpAltNorm(a)));
      v.set(`ac.b738.acp${a}.filter`, v.get(B738.acpFilter(a)));
    }
    // Receiver mixer levels (switch on x volume; SPKR has no switch) and push-to-talk keying (FCOM 5.10).
    // SCOPE: no audio routing or radio transmission model; levels and keying are published as state.
    let mkr = 0;
    for (const t of ACP_TABLE) {
      for (const r of t.rx) {
        const lvl = (r.on ? (v.get(r.on) !== 0 ? 1 : 0) : 1) * v.get(r.vol);
        v.set(r.lvl, lvl);
        if (r.isMkr && lvl > mkr) mkr = lvl;
      }
      // R/T on the ACP or MIC on the control wheel keys the selected transmitter; I/C or INT keys the flight interphone.
      const ptt = v.get(t.ptt);
      const wheel = t.yoke ? v.get(t.yoke) : 0;
      const txKey = ptt > 0.5 || wheel > 0.5;
      const icKey = ptt < -0.5 || wheel < -0.5;
      const sel = v.get(t.mic);
      v.set(t.keyedTx, txKey ? sel + 1 : 0);
      v.set(t.keyedInt, icKey || (txKey && sel === 5) ? 1 : 0);
      v.set(t.micSrc, v.get(t.mask));
    }
    // VHF 1 / 2 transmitting: keyed from any ACP with that transmitter selected and the radio powered.
    for (const r of SIDES) {
      let tx = 0;
      for (const t of ACP_TABLE) if (v.get(t.keyedTx) === r) tx = 1;
      v.set(COM_TX[r - 1], tx && v.get(COM_POWERED[r - 1]) !== 0 ? 1 : 0);
    }
    // Marker beacon audio volume: the loudest MKR receiver level of the three ACPs (used by the marker tones).
    v.set('nav.marker_volume', mkr);
    // ---- ATC panel: transponder 1 / 2 and altitude source 1 / 2 (the TCAS own altitude follows the selection).
    const atc2 = v.get(B738.xpdrAtc) >= 1.5;
    v.set('xpdr.unit', atc2 ? 2 : 1);
    v.set('elec.xpdr_sel_powered', v.get(atc2 ? 'elec.xpdr2_powered' : 'elec.xpdr_powered'));
    v.set('ac.b738.xpdr_press_alt_ft', v.get(v.get(B738.xpdrAltSrc) >= 1.5 ? 'adc2.press_alt_ft' : 'adc1.press_alt_ft'));
    // ---- Weather radar (FCOM 11.30 / 15 "Weather radar"): the radar transmits while WXR is selected on either EFIS
    // control panel (no separate on/off switch on the NG panel) with the transceiver powered; the control panel
    // MODE (TEST / WX / WX+T / MAP), GAIN and TILT shape the returns drawn by the ND overlay (surveillance.ts).
    const wxSel = v.get(EFIS_WXR[0]) !== 0 || v.get(EFIS_WXR[1]) !== 0;
    const wxPwr = v.get('elec.wxr_powered') !== 0 && v.get('elec.wxr_ctl_powered', 1) !== 0;
    const wxOn = wxSel && wxPwr && v.get('fail.b738.wxr') === 0;
    v.set('wxr.active', wxOn ? 1 : 0);
    v.set('wxr.fail', wxSel && (!wxPwr || v.get('fail.b738.wxr') !== 0) ? 1 : 0);
    const wxm = Math.round(v.get(B738.wxrMode));
    v.setString('ac.b738.wxr_mode_text', !wxOn ? 'WXR FAIL' : wxm === 3 ? 'TEST' : wxm === 2 ? 'MAP' : wxm === 1 ? 'WX+T' : 'WX');
    v.set('wxr.mode', v.get(B738.wxrMode));
    v.set('wxr.gain', v.get(B738.wxrGain));
    v.set('wxr.tilt_deg', v.get(B738.wxrTilt));
    // ---- Service interphone (SCOPE: no interphone audio), TAT probe test (SCOPE: aspirated TAT test flag).
    v.set('ac.b738.svc_interphone_active', v.get(B738.svcInterphone) !== 0 ? 1 : 0);
    v.set('ac.b738.tat_test_active', v.get(B738.tatTest) !== 0 && !air ? 1 : 0);

    // ---- Cabin signs (AUTO: NO SMOKING with the gear down, FASTEN BELTS with gear or flaps extended; FCOM 1.40).
    const gearDn = v.get('gear.down_locked') !== 0 || v.get(B738.gearLever) > 0.75;
    const ns = v.get(B738.noSmoking);
    const fb = v.get(B738.fastenBelts);
    const nsOn = ns >= 2 || (ns >= 1 && gearDn);
    const fbOn = fb >= 2 || (fb >= 1 && (gearDn || flaps > 0.5));
    v.set('ac.b738.sign_no_smoking', nsOn ? 1 : 0);
    v.set('ac.b738.sign_fasten_belts', fbOn ? 1 : 0);
    // A low single chime sounds in the cabin with each sign change (FCOM 1.40), heard on the flight deck through
    // the open door / PA (EST level); the cabin signs are lit only with their power (EST: XFR bus).
    const signPwr = v.get('elec.xfr1_powered') !== 0 || v.get('elec.xfr2_powered') !== 0;
    const signs = (nsOn ? 1 : 0) + (fbOn ? 2 : 0);
    if (signPwr && this.prevSigns >= 0 && signs !== this.prevSigns) {
      this.ctx.audio?.play('chime', { volume: 0.3, rate: 0.6 });
      v.set('ac.b738.cabin_chime_count', v.get('ac.b738.cabin_chime_count') + 1);
    }
    this.prevSigns = signs;
    v.set('ac.b738.cabin_signs_lit', signPwr ? signs : 0);

    // ---- Flight deck door (FCOM 1.40 "Flight deck door"): the emergency access code on the cabin keypad
    // (event 'b738.door.emer_access'; SCOPE: no cabin keypad model) sounds the chime and lights AUTO UNLK; unless the
    // crew selects DENY, the door unlocks after the time delay (EST 30 s, operator-programmable) for 5 s. UNLKD
    // unlocks, AUTO keeps it locked, DENY rejects a request. LOCK FAIL: AUTO selected and the lock has no power
    // (door lock breaker) or the lock failed.
    const doorSel = v.get(B738.fdDoorLock);
    if (this.doorReq && this.doorAccessT < 0 && this.doorUnlockT <= 0) {
      this.doorAccessT = 30;
      this.ctx.audio?.play('chime', { volume: 0.4, rate: 0.8 });
    }
    this.doorReq = false;
    if (this.doorAccessT >= 0) {
      if (doorSel >= 0.5) this.doorAccessT = -1; // DENY cancels the request
      else {
        this.doorAccessT -= dt;
        if (this.doorAccessT < 0) this.doorUnlockT = 5;
      }
    }
    if (this.doorUnlockT > 0) this.doorUnlockT -= dt;
    const lockPwr = v.get('elec.fd_door_lock_powered', 1) !== 0 && v.get('fail.b738.door_lock') === 0;
    v.set('ac.b738.door_auto_unlk', this.doorAccessT >= 0 ? 1 : 0);
    v.set('ac.b738.door_lock_fail', doorSel > -0.5 && doorSel < 0.5 && !lockPwr ? 1 : 0);
    v.set('ac.b738.door_unlocked', doorSel <= -0.5 || this.doorUnlockT > 0 || !lockPwr ? 1 : 0);
  }

  reset(): void {
    const v = this.ctx.vars;
    this.e.hornCutout.reset(v.get(B738.hornCutout) !== 0);
    this.e.gpwsTest.reset(v.get(B738.gpwsTest) !== 0);
    this.e.air.reset(v.get('gear.air_ground') === 0);
    this.batDisch = [0, 0, 0];
    this.maxAltFt = v.get('fdm.press_alt_ft');
    this.offSched = false;
    this.apuEcuOffS = v.get('elec.apu_ecu_powered') !== 0 ? 0 : 1e9;
    this.e.grdCall.reset(v.get(B738.grdCall) !== 0);
    this.gpuReqT = -1;
    this.e.attendCall.reset(v.get(B738.attendCall) !== 0);
    this.attendT = -1;
    this.crewCallT = 0;
    this.prevSigns = -1;
    this.rtoSbArmed = false;
    this.leAltFull = false;
    this.e.cvrTest.reset(v.get(B738.cvrTest) !== 0);
  }

  /** Failures of the aircraft-specific logic (ids under fail.b738.*). */
  failures(): FailureDef[] {
    const c = 'b738';
    const f = (id: string, name: string, description: string): FailureDef => ({ id: `b738.${id}`, name, category: c, description });
    return [
      f('speed_trim', 'Speed trim failure', 'SPEED TRIM FAIL light (both FCC channels).'),
      f('mach_trim', 'Mach trim failure', 'MACH TRIM FAIL light.'),
      f('fuel_filter1', 'Engine 1 fuel filter clogged', 'FILTER BYPASS light (engine 1).'),
      f('fuel_filter2', 'Engine 2 fuel filter clogged', 'FILTER BYPASS light (engine 2).'),
      f('oil_filter1', 'Engine 1 oil filter bypass', 'OIL FILTER BYPASS alert (engine display).'),
      f('oil_filter2', 'Engine 2 oil filter bypass', 'OIL FILTER BYPASS alert (engine display).'),
      ...WINDOW_HEATS.map((w) => f(`win_heat_${w}`, `Window heat ${w.replace('_', ' ')} overheat`, 'Window overheat: OVERHEAT light, heat removed.')),
      f('cowl_ai1', 'Cowl anti-ice 1 over-pressure', 'COWL ANTI-ICE light (engine 1).'),
      f('cowl_ai2', 'Cowl anti-ice 2 over-pressure', 'COWL ANTI-ICE light (engine 2).'),
      f('equip_cool_supply', 'Equipment cooling supply fan', 'EQUIP COOLING SUPPLY OFF light; select ALTN.'),
      f('equip_cool_exhaust', 'Equipment cooling exhaust fan', 'EQUIP COOLING EXHAUST OFF light; select ALTN.'),
      f('zone_temp', 'Duct overheat (zone temperature)', 'ZONE TEMP light.'),
      f('xpdr1', 'ATC transponder 1 failure', 'Transponder 1 inoperative (select ATC 2); TCAS off with ATC 1 selected.'),
      f('xpdr2', 'ATC transponder 2 failure', 'Transponder 2 inoperative (select ATC 1); TCAS off with ATC 2 selected.'),
      f('wxr', 'Weather radar failure', 'WXR FAIL on the ND with WXR selected; no returns.'),
      f('door_lock', 'Flight deck door lock failure', 'LOCK FAIL light with AUTO selected; door unlocked.'),
    ];
  }
}

function swap(v: SimContext['vars'], a: string, b: string): void {
  const x = v.get(a);
  v.set(a, v.get(b));
  v.set(b, x);
}

interface LightBinding {
  light: string;
  cond: () => boolean;
}

/** Late logic: annunciators, master caution / six-pack, fire warning, meters and gauges. */
export class B738LogicLate implements Subsystem {
  readonly name = 'b738.logic_late';
  private readonly lights: LightBinding[] = [];
  private readonly cautions: { id: string; group: SixPackGroup; var: string; prev: boolean; unacked: boolean; recallOnly: boolean }[] = [];
  private readonly fireIds = B738_ANNUNCIATORS.filter((x) => x.group === null).map((x) => `cas.${x.id}`);
  private readonly mcEdge = [new EdgeDetector(), new EdgeDetector()];
  private readonly recallEdge = [new EdgeDetector(), new EdgeDetector()];
  private readonly bellEdge = new EdgeDetector();
  private readonly altCutEdge = new EdgeDetector();
  private readonly annPower: () => boolean;
  private readonly groupVars = SIX_PACK_GROUPS.map((g) => B738.lt.group(g));
  private readonly groupLit = new Array<boolean>(SIX_PACK_GROUPS.length).fill(false);
  private bellOn = false;
  private bellSilenced = false;
  private prevFire = false;
  private prevTest = false;
  private hornOn = false;
  private altHornCut = false;
  /** ELT g-switch latch (impact with the switch at ARM); reset by selecting ON. */
  private eltImpact = false;
  private readonly acMeter: Evaluator[][];
  private readonly dcMeter: Evaluator[][];

  constructor(private readonly ctx: Pick<SimContext, 'vars' | 'events' | 'audio'>) {
    const v = ctx.vars;
    for (const a of B738_ANNUNCIATORS) {
      if (a.light) this.lights.push({ light: a.light, cond: compileCondition(v, a.when) });
      if (a.group) this.cautions.push({ id: a.id, group: a.group, var: `cas.${a.id}`, prev: false, unacked: false, recallOnly: a.recallOnly === true });
    }
    this.annPower = compileCondition(v, 'elec.dc1_powered || elec.dc2_powered || elec.batt_bus_powered || elec.dc_stby_powered');
    const b = (x: string): Evaluator => compileBinding(v, x, 0);
    // AC meters: STBY PWR, GRD PWR, GEN1, APU GEN, GEN2, INV (volts, Hz, amps per phase = kVA / (3 x 115 V)).
    const ph = (kva: string) => `${kva} * 1000 / 345`;
    this.acMeter = [
      [b('elec.ac_stby_v'), b('elec.ac_stby_hz'), b('elec.ac_stby_amps')],
      [b('elec.gpu_avail * 115'), b('elec.gpu_avail * 400'), b(ph('elec.gpu_kva'))],
      [b('elec.idg1_v'), b('elec.idg1_hz'), b(ph('elec.idg1_kva'))],
      [b('elec.apu_gen_v'), b('elec.apu_gen_hz'), b(ph('elec.apu_gen_kva'))],
      [b('elec.idg2_v'), b('elec.idg2_hz'), b(ph('elec.idg2_kva'))],
      [b('elec.inv_online * 115'), b('elec.inv_online * 400'), b('elec.inv_va / 115')],
      [b('0'), b('0'), b('0')],
    ];
    // DC meters: STBY PWR, BAT BUS, BAT, TR1, TR2, TR3 (volts, amps).
    this.dcMeter = [
      [b('elec.dc_stby_v'), b('elec.dc_stby_amps')],
      [b('elec.batt_bus_v'), b('elec.batt_bus_amps')],
      [b('elec.batt_v'), b('elec.batt_amps')],
      [b('elec.tru1_v'), b('elec.tru1_amps')],
      [b('elec.tru2_v'), b('elec.tru2_amps')],
      [b('elec.tru3_v'), b('elec.tru3_amps')],
      [b('0'), b('0')],
    ];
  }

  /** CasManager after construction (reads the posted messages). */
  cas: CasManager | null = null;

  update(dt: number): void {
    void dt;
    const v = this.ctx.vars;
    const powered = this.annPower();
    const test = powered && v.get(B738.lightsTest) >= 0.5;
    // ---- Individual annunciator lights (same condition as the message, plus lights test).
    for (let k = 0; k < this.lights.length; k++) {
      const l = this.lights[k];
      v.set(l.light, powered && (test || l.cond()) ? 1 : 0);
    }

    // ---- Panel test switches (FCOM): WINDOW HEAT TEST OVHT lights OVERHEAT (ON lights out), PWR TEST forces ON;
    //      air conditioning OVHT TEST lights ZONE TEMP; cargo fire TEST lights both cargo FIRE lights;
    //      electrical MAINT lights ELEC / TR UNIT (SCOPE: BITE lamp test only).
    // FWD / AFT CAB ZONE TEMP lights (the duct overheat failure lights CONT CAB via its annunciator): lamp test only.
    for (const z of [2, 3] as const) v.set(B738.lt.zoneTemp(z), powered && test ? 1 : 0);
    const wht = v.get(B738.windowHeatTest);
    if (powered && wht <= -0.5) for (const w of WINDOW_HEATS) if (v.get(B738.windowHeat(w)) !== 0) v.set(B738.lt.windowOverheat(w), 1);
    if (powered && v.get(B738.ovhtTest) !== 0) for (const z of [1, 2, 3] as const) v.set(B738.lt.zoneTemp(z), 1);
    // Cargo fire TEST (FCOM 8.20): the FWD / AFT FIRE lights, bell and master FIRE WARN come from the cargo zones'
    // own test (airframe.ts); here the extinguisher squib test lights and DISCH.
    const cargoTest = powered && v.get(B738.cargoTest) !== 0 && v.get('elec.cargo_fire_powered') !== 0;
    if (powered && v.get(B738.elecMaint) !== 0) {
      v.set(B738.lt.elec, 1);
      v.set(B738.lt.trUnit, 1);
    }
    // LE DEVICES annunciator (aft overhead, 4 LE flaps + 8 slats): 0 off, 1 TRANSIT amber, 2 EXT green, 3 FULL EXT green.
    const leTest = powered && v.get(B738.leDevTest) !== 0;
    const sl = v.get('slats.pos');
    const leState = leTest ? 3 : !powered ? 0 : v.get('slats.transit') !== 0 ? 1 : sl > 0.95 ? 3 : sl > 0.4 ? 2 : 0;
    for (let k = 1; k <= 12; k++) v.set(`ac.b738.lt.le_dev${k}`, k <= 4 && leState === 3 ? 2 : leState);

    // ---- Master caution and six-pack (FCOM 15.20).
    let mcPush = false;
    let recallRelease = false;
    let recallHeld = false;
    for (const s of SIDES) {
      if (this.mcEdge[s - 1].rising(v.get(B738.masterCaution(s)) !== 0)) mcPush = true;
      const r = this.recallEdge[s - 1].update(v.get(B738.recall(s)) !== 0);
      if (r < 0) recallRelease = true;
      if (v.get(B738.recall(s)) !== 0) recallHeld = true;
    }
    this.groupLit.fill(false);
    let anyUnacked = false;
    for (const c of this.cautions) {
      const on = v.get(c.var) !== 0;
      // Recall-only faults (single fault in a redundant system) are stored but light nothing until RECALL.
      if (on && !c.prev && !c.recallOnly) c.unacked = true;
      if (!on) c.unacked = false;
      if (mcPush) c.unacked = false;
      if (recallRelease && on) c.unacked = true;
      c.prev = on;
      if (c.unacked) {
        anyUnacked = true;
        this.groupLit[SIX_PACK_GROUPS.indexOf(c.group)] = true;
      }
    }
    const lampAll = test || recallHeld;
    for (let g = 0; g < this.groupVars.length; g++) v.set(this.groupVars[g], powered && (lampAll || this.groupLit[g]) ? 1 : 0);
    v.set(B738.lt.masterCaution, powered && (lampAll || anyUnacked) ? 1 : 0);
    v.set('alert.master_caution', powered && anyUnacked ? 1 : 0);
    v.set(B738.recallActive, recallHeld ? 1 : 0);

    // ---- Fire warning: master FIRE WARN lights and bell until FIRE WARN / BELL CUTOUT (FCOM 8.20).
    let fire = false;
    for (let k = 0; k < this.fireIds.length; k++) if (v.get(this.fireIds[k]) !== 0) fire = true;
    const cut = v.get(B738.fireWarnPush(1)) !== 0 || v.get(B738.fireWarnPush(2)) !== 0 || v.get(B738.bellCutout) !== 0;
    if (this.bellEdge.rising(cut)) this.bellSilenced = true;
    if (fire && !this.prevFire) this.bellSilenced = false;
    this.prevFire = fire;
    // Any test (OVHT/FIRE or cargo) re-arms the bell like a new fire (a previous cutout does not silence it).
    const anyTest = v.get('fire.test') !== 0 || cargoTest;
    if (anyTest && !this.prevTest) this.bellSilenced = false;
    this.prevTest = anyTest;
    const fireWarn = fire && !this.bellSilenced;
    v.set(B738.lt.fireWarn, (fireWarn || test) && powered ? 1 : 0);
    v.set('alert.master_warning', fireWarn ? 1 : 0);
    const bell = fireWarn && v.get('elec.fire_det_powered') !== 0;
    if (bell !== this.bellOn) {
      this.bellOn = bell;
      // SCOPE: the fire bell uses the synthesized master-warning chime (no bell sample in the audio engine).
      this.ctx.audio?.tone('master_warning', bell);
    }
    // ---- Intermittent warning horn: take-off configuration or cabin altitude (ALT HORN CUTOUT silences the latter).
    const cabAlt = v.get('press.cabin_alt_warn') !== 0;
    if (this.altCutEdge.rising(v.get(B738.altHornCutout) !== 0) && cabAlt) this.altHornCut = true;
    if (!cabAlt) this.altHornCut = false;
    const horn = v.get('alert.takeoff_config') !== 0 || (cabAlt && !this.altHornCut);
    if (horn !== this.hornOn) {
      this.hornOn = horn;
      this.ctx.audio?.tone('takeoff_config', horn);
    }
    const L = B738.lt;
    const lit = (x: boolean): number => (powered && (x || test) ? 1 : 0);
    v.set(L.takeoffConfig, lit(v.get('alert.takeoff_config') !== 0));
    v.set(L.cabinAltitude, lit(cabAlt));
    // ---- ELT (aft overhead remote switch): ON transmits; ARM transmits after an impact (g-switch, modelled as
    // the FDM crash), latched until the switch is cycled through ON. SCOPE: no 121.5 / 406 MHz signal model.
    const eltOn = v.get(B738.eltSw) !== 0;
    if (eltOn) this.eltImpact = false;
    else if (v.get('fdm.crashed') !== 0) this.eltImpact = true;
    const eltTx = eltOn || this.eltImpact;
    v.set('ac.b738.elt_transmitting', eltTx ? 1 : 0);
    v.set(L.elt, lit(eltTx));

    // ---- Electrical panel lights (non-caution: blue / white).
    v.set(L.grdPwrAvail, lit(v.get('elec.gpu_avail') !== 0));
    for (const i of SIDES) v.set(L.genOffBus(i), lit(v.get(`elec.idg${i}_avail`) !== 0 && v.get(B738.xfrSrc(i)) !== 1));
    v.set(L.apuGenOffBus, lit(v.get('elec.apu_gen_avail') !== 0 && v.get(B738.xfrSrc(1)) !== 2 && v.get(B738.xfrSrc(2)) !== 2));
    v.set(L.apuMaint, lit(false)); // SCOPE: no APU maintenance BITE
    // Meters.
    const acSel = Math.max(0, Math.min(6, Math.round(v.get(B738.acMeterSel))));
    const dcSel = Math.max(0, Math.min(6, Math.round(v.get(B738.dcMeterSel))));
    v.set(L.acVolts, this.acMeter[acSel][0]());
    v.set(L.acHz, this.acMeter[acSel][1]());
    v.set(L.acAmps, this.acMeter[acSel][2]());
    v.set(L.dcVolts, this.dcMeter[dcSel][0]());
    v.set(L.dcAmps, this.dcMeter[dcSel][1]());

    // ---- Fuel panel (blue valve lights: 2 bright in transit, 1 dim, 0 off).
    v.set(L.xfeedValveOpen, powered ? (v.get('fuel.xfeed_transit') !== 0 || test ? 2 : v.get('fuel.xfeed_open') !== 0 ? 1 : 0) : 0);
    for (const i of SIDES) {
      const tr = v.get(`fuel.engv${i}_transit`) !== 0;
      v.set(L.engValveClosed(i), powered ? (tr || test ? 2 : v.get(`fuel.engv${i}_open`) === 0 ? 1 : 0) : 0);
      const trs = v.get(`fuel.spar${i}_transit`) !== 0;
      v.set(L.sparValveClosed(i), powered ? (trs || test ? 2 : v.get(`fuel.spar${i}_open`) === 0 ? 1 : 0) : 0);
    }
    v.set(L.fuelTempC, v.get('fuel.main1_temp_c'));
    void FUEL_PUMPS;

    // ---- Engines / APU.
    for (const i of SIDES) {
      v.set(L.engStartValve(i), lit(v.get(`pneu.st${i}_valve_open`) !== 0));
      // ON (white) while the switch is ON (also in soft ALTN); ALTN (amber) in soft or hard alternate (FCOM 7.20).
      v.set(L.eecOn(i), lit(v.get(B738.eec(i)) !== 0));
      v.set(L.eecAltn(i), lit(v.get(B738.eecMode(i)) > 0));
    }
    v.set(L.apuEgtC, v.get('apu.egt_c'));

    // ---- Hydraulics / flight controls (non-caution lights).
    void HYD_PUMP_SWITCHES;
    v.set(L.hydBrakePsi, v.get('brakes.accum_psi'));
    v.set(L.yawDamperInd, v.get('fcs.yd_cmd'));

    // ---- Anti-ice lights.
    for (const w of WINDOW_HEATS) v.set(L.windowOn(w), lit(v.get(`elec.win_heat_${w}_powered`) !== 0 && v.get(`fail.b738.win_heat_${w}`) === 0));
    const waiCmd = v.get(B738.wingAiValveCmd) !== 0;
    for (const i of SIDES) {
      const ok = v.get(i === 1 ? 'pneu.wai_l_ok' : 'pneu.wai_r_ok');
      // WING ANTI-ICE VALVE OPEN: bright = disagree / in transit, dim = open (FCOM 3.20).
      v.set(L.wingAiValve(i), powered ? (test || (waiCmd && ok < 0.5) ? 2 : waiCmd ? 1 : 0) : 0);
      const cowl = v.get(B738.engAi(i)) !== 0;
      const cok = v.get(`pneu.eai${i}_ok`);
      v.set(L.cowlValve(i), powered ? (test || (cowl && cok < 0.5 && v.get(`eng${i}.running`) !== 0) ? 2 : cowl && cok >= 0.5 ? 1 : 0) : 0);
    }

    // ---- Air conditioning / bleed.
    const apuBleedOpen = v.get('pneu.apu_valve_open') !== 0;
    const iso = v.get('pneu.iso_open') !== 0;
    v.set(L.dualBleed, lit(apuBleedOpen && (v.get(B738.bleed(1)) !== 0 || (v.get(B738.bleed(2)) !== 0 && iso))));
    for (const i of SIDES) {
      v.set(L.ramDoorFullOpen(i), lit(v.get(`pneu.pack${i}_on`) !== 0 && (v.get('gear.air_ground') !== 0 || v.get('surf.flaps_deg') > 0.5)));
      v.set(L.ductPress(i), v.get(i === 1 ? 'pneu.l_duct_psi' : 'pneu.r_duct_psi'));
    }
    // Temperature indicator source selector.
    const src = Math.round(v.get(B738.tempSrcSel));
    const tempVars = ['pneu.flt_deck_temp_c', 'pneu.fwd_cab_supply_c', 'pneu.aft_cab_supply_c', 'pneu.fwd_cab_temp_c', 'pneu.aft_cab_temp_c', 'pneu.pack1_outlet_c', 'pneu.pack2_outlet_c'];
    v.set(L.zoneTempC, v.get(tempVars[Math.max(0, Math.min(6, src))]));

    // ---- Pressurization.
    const pm = v.get(B738.pressMode);
    v.set(L.altn, lit(pm === 1 || (pm === 0 && (v.get('press.auto_fail') !== 0 || v.get('elec.press_auto_powered') === 0))));
    v.set(L.manual, lit(pm === 2));
    v.set(L.cabinAltFt, v.get('press.cabin_alt_ft'));
    v.set(L.cabinDiffPsi, v.get('press.diff_psi'));
    v.set(L.cabinRateFpm, v.get('press.cabin_rate_fpm'));

    // ---- Gear, brakes, flaps, speedbrake.
    for (const leg of [0, 1, 2] as const) {
      v.set(L.gearGreen(leg), v.get(`gear.green${leg}`) !== 0 || test ? 1 : 0);
      v.set(L.gearRed(leg), v.get(`gear.red${leg}`) !== 0 || test ? 1 : 0);
    }
    v.set(L.autoBrakeDisarm, lit(v.get('brakes.ab_disarm') !== 0));
    v.set(L.antiskidInop, lit(v.get('brakes.antiskid_inop') !== 0));
    v.set(L.parkingBrake, lit(v.get('brakes.parking_set') !== 0));
    const slatTransit = v.get('slats.transit') !== 0;
    v.set(L.leFlapsTransit, lit(slatTransit));
    v.set(L.leFlapsExt, lit(!slatTransit && v.get('slats.pos') > 0.4));
    v.set(L.flapLoadRelief, lit(v.get('flaps.load_relief') !== 0));
    v.set(L.flapGauge('l'), v.get('flaps.left_deg'));
    v.set(L.flapGauge('r'), v.get('flaps.right_deg'));
    v.set(L.speedbrakeArmed, lit(v.get('spoilers.armed_light') !== 0));
    v.set(L.speedbrakeDoNotArm, lit(v.get('spoilers.do_not_arm') !== 0));
    v.set(L.speedbrakeExtended, lit(v.get('spoilers.ext_light') !== 0));
    v.set(L.stabOutOfTrim, lit(v.get('ac.afds.stab_out_of_trim') !== 0));
    v.set(L.stabPosUnits, v.get('trim.pitch_units'));
    v.set(L.rudderTrimUnits, v.get('trim.yaw_units'));
    v.set(L.ailTrimUnits, v.get('trim.roll_units'));
    v.set(L.belowGs, lit(v.get('taws.gs_light') !== 0));
    v.set(L.gpwsInop, lit(v.get('taws.inop') !== 0));

    // ---- Fire panel (non-warning lights).
    for (const b of ['l', 'r', 'apu'] as const) {
      v.set(L.bottleDischarge(b), lit(v.get(`fire.${b}_btl_discharged`) !== 0));
      // EXTINGUISHER TEST: squib continuity lights (1 = L/APU/R bottle circuit 1, 2 = circuit 2): all green while held.
      v.set(L.squib(b), powered && v.get(B738.extTest) !== 0 && v.get(`fire.${b}_btl_psi`) > 0 ? 1 : 0);
    }
    for (const z of ['fwd', 'aft'] as const) v.set(L.cargoExtArmed(z), lit(v.get(B738.cargoArm(z)) !== 0));
    v.set(L.cargoDischarged, lit(v.get('fire.cargo_btl_discharged') !== 0 || cargoTest));
    // DETECTOR FAULT: one or more detectors in the selected loop(s) failed (FCOM 8.10).
    v.set(L.cargoDetFault, lit(v.get('fire.cargo_fwd_fault') !== 0 || v.get('fire.cargo_aft_fault') !== 0));
    // EXTINGUISHER test lights (green): squib circuit continuity, lit during the cargo TEST with a charged bottle.
    for (const z of ['fwd', 'aft'] as const) v.set(L.cargoSquib(z), powered && (test || (cargoTest && v.get('fire.cargo_btl_psi') > 0)) ? 1 : 0);

    // ---- IRS display unit (ISDU): selected data of the selected IRS (FCOM 11.20).
    const ir = v.get(B738.isduSys) >= 0.5 ? 2 : 1;
    const sel = Math.round(v.get(B738.isduSel));
    const hasAlign = v.get(`irs${ir}.state`) === 1;
    let l = 0;
    let rr = 0;
    if (sel === 1) {
      l = v.get(`irs${ir}.trk_true_deg`);
      rr = v.get(`irs${ir}.gs_kt`);
    } else if (sel === 2) {
      l = v.get(`irs${ir}.lat_deg`);
      rr = v.get(`irs${ir}.lon_deg`);
    } else if (sel === 3) {
      l = v.get('fdm.wind_dir_deg');
      rr = v.get('fdm.wind_kt');
    } else if (sel === 4) {
      l = v.get(`ahrs${ir}.hdg_true_deg`);
      rr = hasAlign ? Math.ceil(v.get(`ahrs${ir}.align_s`) / 60) : 0; // STS: minutes to alignment
    } else if (sel === 0) {
      l = 88888;
      rr = 88888; // TEST: all segments
    }
    const on = powered && v.get(`irs${ir}.state`) !== 0;
    v.set(B738.lt.isduText('l'), on ? l : 0);
    v.set(B738.lt.isduText('r'), on ? rr : 0);

    // ---- Misc.
    v.set(L.crewOxyPsi, v.get('oxy.crew_psi'));
    // Flight deck door (logic above): LOCK FAIL with AUTO selected and the lock failed / unpowered; AUTO UNLK while
    // an emergency access request counts down.
    v.set(L.lockFail, lit(v.get('ac.b738.door_lock_fail') !== 0));
    v.set(L.autoUnlk, lit(v.get('ac.b738.door_auto_unlk') !== 0));
    // CALL (blue): the flight deck is being called by the cabin or the ground crew (FCOM 5.10). ATTEND / GRD CALL
    // themselves sound the cabin chime / nose-wheel-well horn and do not light it (SCOPE: no aural of those).
    v.set(L.callLt, lit(v.get('ac.b738.crew_call_in') !== 0));
    v.set('ac.b738.cvr_test_lt', lit(v.get(B738.cvrTest) !== 0));
    v.set('ac.b738.fd_door_locked', v.get('ac.b738.door_unlocked') === 0 && v.get(B738.door('flt_deck')) === 0 ? 1 : 0);
  }

  reset(): void {
    const v = this.ctx.vars;
    for (const c of this.cautions) {
      c.prev = v.get(c.var) !== 0;
      c.unacked = false;
    }
    this.bellSilenced = false;
    this.prevFire = false;
    this.prevTest = false;
    this.eltImpact = false;
  }
}
