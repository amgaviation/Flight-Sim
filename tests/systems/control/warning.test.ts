import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import type { AudioApi } from '../../../src/core/SimContext';
import { ADC, ALERT, AP, GPS, NAV } from '../../../src/core/vars';
import { CasManager } from '../../../src/systems/warning/CasManager';
import {
  bankAngleLimit,
  mode1PullUp,
  mode1SinkRate,
  mode2A,
  mode2AUpperLimit,
  mode2B,
  mode3AllowedLoss,
  mode4,
  mode5,
  MODE4A_TURBOFAN,
  MODE4B_TURBOFAN,
  fltaRequiredClearance,
} from '../../../src/systems/warning/egpwsEnvelopes';
import { Taws } from '../../../src/systems/warning/Taws';
import { AltitudeAlert, ALT_ALERT_737NG, ALT_ALERT_GFC700, MinimumsMonitor } from '../../../src/systems/warning/AltitudeAlert';
import { StallWarning } from '../../../src/systems/warning/StallWarning';
import { Overspeed } from '../../../src/systems/warning/Overspeed';
import { TakeoffConfigWarning } from '../../../src/systems/warning/TakeoffConfigWarning';
import { Tcas, type TrafficTarget } from '../../../src/systems/warning/Tcas';
import { DisconnectAlerts } from '../../../src/systems/warning/DisconnectAlerts';
import { SENSOR_VARS } from '../../../src/systems/sensors/vars';

const DT = 1 / 60;

class FakeAudio implements AudioApi {
  callouts: string[] = [];
  tones = new Map<string, boolean>();
  plays: string[] = [];
  play(id: string): void {
    this.plays.push(id);
  }
  loop() {
    return { setGain() {}, setRate() {}, stop() {} };
  }
  callout(text: string): void {
    this.callouts.push(text);
  }
  tone(id: string, on: boolean): void {
    this.tones.set(id, on);
  }
}

describe('CasManager', () => {
  function cas() {
    const vars = new SimVars();
    const events = new EventBus();
    const audio = new FakeAudio();
    vars.set('gear.air_ground', 1);
    vars.set('gear.down_locked', 1);
    vars.set(SENSOR_VARS.raAlt(1), 0);
    const c = new CasManager(
      { vars, events, audio },
      {
        messages: [
          { id: 'eng1_fire', text: 'ENG 1 FIRE', level: 'warning', when: 'ac.fire1', aural: { callout: 'FIRE' } },
          { id: 'gen1_off', text: 'GEN 1 OFF', level: 'caution', when: 'ac.gen1_off', inhibit: 'takeoff' },
          { id: 'hyd_lo', text: 'HYD LO PRESS', level: 'caution', when: 'ac.hyd_lo', delayS: 1 },
          { id: 'apu_run', text: 'APU RUNNING', level: 'advisory', when: 'ac.apu' },
        ],
      },
    );
    const run = (s: number): void => {
      for (let i = 0; i < Math.round(s / DT); i++) c.update(DT);
    };
    return { vars, events, audio, c, run };
  }

  it('latches the master caution until pushed, even after the condition clears', () => {
    const { vars, events, audio, c, run } = cas();
    vars.set('ac.gen1_off', 1);
    run(0.1);
    expect(vars.get(ALERT.masterCaution)).toBe(1);
    expect(audio.plays).toContain('master_caution');
    vars.set('ac.gen1_off', 0);
    run(0.1);
    expect(c.isActive('gen1_off')).toBe(false);
    vars.set('ac.gen1_off', 1);
    run(0.1);
    events.emit('cas.ack_caution');
    run(0.1);
    expect(vars.get(ALERT.masterCaution)).toBe(0);
    expect(c.isActive('gen1_off')).toBe(true);
    expect(vars.get('cas.gen1_off')).toBe(1);
  });

  it('warning: master warning + continuous tone until acknowledged; voice callout', () => {
    const { vars, events, audio, run } = cas();
    vars.set('ac.fire1', 1);
    run(0.1);
    expect(vars.get(ALERT.masterWarning)).toBe(1);
    expect(audio.tones.get('master_warning')).toBe(true);
    expect(audio.callouts).toContain('FIRE');
    events.emit('cas.ack_warning');
    run(0.1);
    expect(vars.get(ALERT.masterWarning)).toBe(0);
    expect(audio.tones.get('master_warning')).toBe(false);
  });

  it('display order: warnings, cautions, advisories; newest first within a level; delay debounce', () => {
    const { vars, c, run } = cas();
    vars.set('ac.apu', 1);
    run(0.1);
    vars.set('ac.gen1_off', 1);
    vars.set('ac.hyd_lo', 1);
    run(0.5);
    expect(c.isActive('hyd_lo')).toBe(false);
    run(1);
    vars.set('ac.fire1', 1);
    run(0.1);
    expect(c.list.map((m) => m.id)).toEqual(['eng1_fire', 'hyd_lo', 'gen1_off', 'apu_run']);
  });

  it('takeoff inhibit: a caution arising between 80 kt and 400 ft posts only after the inhibit', () => {
    const { vars, c, run } = cas();
    vars.set(ADC.ias(1), 100);
    run(0.2);
    vars.set('ac.gen1_off', 1);
    run(1);
    expect(c.phase.takeoffInhibit).toBe(true);
    expect(c.isActive('gen1_off')).toBe(false);
    expect(vars.get(ALERT.masterCaution)).toBe(0);
    expect(vars.get('cas.inhibited_count')).toBe(1);
    // Lift-off and climb through 400 ft RA
    vars.set('gear.air_ground', 0);
    vars.set(SENSOR_VARS.raAlt(1), 200);
    run(1);
    expect(c.isActive('gen1_off')).toBe(false);
    vars.set(SENSOR_VARS.raAlt(1), 450);
    run(0.2);
    expect(c.isActive('gen1_off')).toBe(true);
    expect(vars.get(ALERT.masterCaution)).toBe(1);
  });
});

describe('EGPWS envelopes (Honeywell MK V/VII/VIII published points)', () => {
  it('Mode 1 SINK RATE: 964 fpm @ 10 ft ... 5007 fpm @ 2450 ft; PULL UP: 1710 fpm @ 284 ft, 7125 fpm @ 2450 ft', () => {
    // boundary points (just inside / just outside)
    expect(mode1SinkRate(10.5, -970)).toBe(true);
    expect(mode1SinkRate(10.5, -950)).toBe(false);
    expect(mode1SinkRate(2400, -5007)).toBe(true);
    expect(mode1SinkRate(2449, -4980)).toBe(false);
    expect(mode1SinkRate(2451, -9000)).toBe(false); // above 2450 ft
    expect(mode1PullUp(283, -1720)).toBe(true);
    expect(mode1PullUp(283, -1700)).toBe(false);
    expect(mode1PullUp(285, -1720)).toBe(true);
    expect(mode1PullUp(285, -1700)).toBe(false);
    expect(mode1PullUp(2440, -7130)).toBe(true);
    expect(mode1PullUp(2449, -7100)).toBe(false);
    // 1000 ft: sink rate from 2605 fpm, pull up from 3500 fpm
    expect(mode1SinkRate(1000, -2650)).toBe(true);
    expect(mode1SinkRate(1000, -2550)).toBe(false);
    expect(mode1PullUp(1000, -3550)).toBe(true);
    expect(mode1PullUp(1000, -3450)).toBe(false);
  });

  it('Mode 2A: 2000 fpm closure @ 0 ft, 3545 @ 1220 ft, upper limit 1650 ft (≤220 kt) .. 2450 ft (≥310 kt)', () => {
    expect(mode2A(50, 2100, 200)).toBe(true);
    expect(mode2A(50, 2000, 200)).toBe(false);
    expect(mode2A(1210, 3545, 200)).toBe(true);
    expect(mode2A(1210, 3500, 200)).toBe(false);
    expect(mode2AUpperLimit(200)).toBe(1650);
    expect(mode2AUpperLimit(310)).toBe(2450);
    expect(mode2AUpperLimit(265)).toBeCloseTo(2050.5, 1);
    expect(mode2A(1700, 9000, 200)).toBe(false); // above the 1650 ft limit at low speed
    expect(mode2A(1700, 9000, 300)).toBe(true);
    expect(mode2A(2400, 9797 + 100, 320)).toBe(true);
    expect(mode2A(2400, 9500, 320)).toBe(false);
  });

  it('Mode 2B, 3, 4, 5, 6 bank angle', () => {
    expect(mode2B(700, 3000, false, -800)).toBe(true);
    expect(mode2B(800, 5000, false, -800)).toBe(false); // above 789 ft
    expect(mode2B(150, 3000, true, -800)).toBe(false); // below the landing-flaps floor
    expect(mode3AllowedLoss(500)).toBeCloseTo(51.4, 5);
    expect(mode4(400, 150, MODE4A_TURBOFAN)).toBe(1); // TOO LOW GEAR
    expect(mode4(600, 150, MODE4A_TURBOFAN)).toBe(0);
    expect(mode4(700, 220, MODE4A_TURBOFAN)).toBe(2); // limit 750 ft at 220 kt
    expect(mode4(900, 300, MODE4A_TURBOFAN)).toBe(2);
    expect(mode4(200, 140, MODE4B_TURBOFAN)).toBe(1); // TOO LOW FLAPS below 245 ft
    expect(mode4(300, 140, MODE4B_TURBOFAN)).toBe(0);
    expect(mode5(500, 1.5)).toBe(1);
    expect(mode5(250, 2.5)).toBe(2);
    expect(mode5(1200, 3)).toBe(0);
    expect(mode5(100, 1.5)).toBe(0); // below 150 ft needs RA > 243 − 71.43·dots
    expect(bankAngleLimit(3000, false)).toBe(55);
    expect(bankAngleLimit(150.01, false)).toBeCloseTo(40, 1);
    expect(bankAngleLimit(30.01, false)).toBeCloseTo(10, 1);
    expect(bankAngleLimit(1000, true)).toBe(33);
    expect(fltaRequiredClearance('enroute', false)).toBe(700);
    expect(fltaRequiredClearance('approach', true)).toBe(100);
  });
});

describe('Taws subsystem', () => {
  function taws() {
    const vars = new SimVars();
    const events = new EventBus();
    const audio = new FakeAudio();
    vars.set(SENSOR_VARS.raValid(1), 1);
    vars.set('gear.air_ground', 0);
    vars.set('gear.down_locked', 0);
    vars.set(ADC.ias(1), 250);
    const t = new Taws({ vars, events, audio }, { flta: false, pda: false });
    const run = (s: number, each?: () => void): void => {
      for (let i = 0; i < Math.round(s / DT); i++) {
        each?.();
        t.update(DT);
      }
    };
    return { vars, events, audio, t, run };
  }

  it('Mode 1: SINK RATE then PULL UP with the lamps', () => {
    const { vars, audio, run } = taws();
    vars.set(SENSOR_VARS.raAlt(1), 1000);
    vars.set(ADC.vs(1), -2500); // inside the envelope boundary (2605 fpm at 1000 ft)
    run(0.5);
    expect(vars.get('taws.mode1')).toBe(0);
    vars.set(ADC.vs(1), -3000);
    run(1.5);
    expect(vars.get('taws.mode1')).toBe(1);
    expect(vars.get(ALERT.tawsCaution)).toBe(1);
    expect(audio.callouts).toContain('SINK RATE');
    vars.set(ADC.vs(1), -4000);
    run(0.5);
    expect(vars.get('taws.mode1')).toBe(2);
    expect(vars.get(ALERT.tawsWarning)).toBe(1);
    expect(audio.callouts).toContain('PULL UP');
    expect(vars.getString('taws.alert')).toBe('PULL UP');
  });

  it('Mode 2A: TERRAIN TERRAIN then PULL UP on rapidly rising terrain', () => {
    const { vars, audio, run } = taws();
    vars.set(ADC.vs(1), 0);
    let ra = 1100;
    vars.set(SENSOR_VARS.raAlt(1), ra);
    run(2);
    run(4, () => {
      ra -= (6000 / 60) * DT; // 6000 fpm closure
      vars.set(SENSOR_VARS.raAlt(1), ra);
    });
    expect(audio.callouts).toContain('TERRAIN TERRAIN');
    expect(audio.callouts).toContain('PULL UP');
  });

  it('Mode 6: altitude callouts on descent and MINIMUMS', () => {
    const { vars, audio, run } = taws();
    vars.set('gear.down_locked', 1);
    vars.set('surf.flaps_deg', 30);
    vars.set(ADC.ias(1), 140);
    vars.set(ADC.vs(1), -700);
    vars.set(AP.minimums(1), 200);
    vars.set(AP.minimumsIsRadio(1), 1);
    let ra = 2800;
    vars.set(SENSOR_VARS.raAlt(1), ra);
    run(0.5);
    run(250, () => {
      ra = Math.max(5, ra - (700 / 60) * DT);
      vars.set(SENSOR_VARS.raAlt(1), ra);
    });
    const c = audio.callouts;
    for (const w of ['TWENTY FIVE HUNDRED', 'ONE THOUSAND', 'FIVE HUNDRED', 'MINIMUMS', 'ONE HUNDRED', 'FIFTY', 'FORTY', 'THIRTY', 'TWENTY', 'TEN']) expect(c).toContain(w);
    expect(c.indexOf('FIVE HUNDRED')).toBeLessThan(c.indexOf('MINIMUMS'));
    expect(c.indexOf('MINIMUMS')).toBeLessThan(c.indexOf('ONE HUNDRED'));
    expect(c.filter((x) => x === 'ONE THOUSAND').length).toBe(1);
  });

  it('Mode 4A: TOO LOW GEAR at low speed with the gear up', () => {
    const { vars, audio, run } = taws();
    vars.set(ADC.ias(1), 160);
    vars.set(ADC.vs(1), -500);
    vars.set(SENSOR_VARS.raAlt(1), 450);
    run(0.5);
    expect(vars.get('taws.mode4')).toBe(1);
    expect(audio.callouts).toContain('TOO LOW GEAR');
  });

  it('Mode 5: GLIDESLOPE below the beam with the gear down; cancel', () => {
    const { vars, events, audio, run } = taws();
    vars.set('gear.down_locked', 1);
    vars.set('surf.flaps_deg', 30);
    vars.set(ADC.ias(1), 140);
    vars.set(NAV.gsValid(1), 1);
    vars.set(NAV.isLoc(1), 1);
    vars.set(NAV.gsDev(1), 0.8); // 1.6 dots below
    vars.set(SENSOR_VARS.raAlt(1), 600);
    vars.set(ADC.vs(1), -700);
    run(0.5);
    expect(vars.get('taws.mode5')).toBe(1);
    expect(vars.get('taws.gs_light')).toBe(1);
    expect(audio.callouts).toContain('GLIDESLOPE');
    events.emit('taws.gs_cancel');
    run(0.5);
    expect(vars.get('taws.mode5')).toBe(0);
  });

  it('FLTA: CAUTION TERRAIN / TERRAIN AHEAD PULL UP from the terrain database', () => {
    const vars = new SimVars();
    const audio = new FakeAudio();
    // Terrain: a 6000 ft ridge 1.8 nm north of the origin (~26 s ahead at 250 kt).
    const world = {
      sampleGround: () => ({ elevation_m: 0, normal: [0, 0, 1] as [number, number, number], surface: 'unknown' as const, precise: true }),
      elevationAt: (lat: number) => (lat > 0.03 && lat < 0.2 ? 6000 * 0.3048 : 0),
      ensureLoaded: async () => {},
    };
    vars.set(GPS.valid, 1);
    vars.set(GPS.lat, 0);
    vars.set(GPS.lon, 0);
    vars.set(GPS.alt, 5500);
    vars.set(GPS.gs, 250);
    vars.set(GPS.trackTrue, 0);
    vars.set('gear.air_ground', 0);
    vars.set(ADC.vs(1), 0);
    const t = new Taws({ vars, audio, world }, { pda: false });
    for (let i = 0; i < 60; i++) t.update(DT);
    expect(vars.get('taws.flta')).toBe(2);
    expect(audio.callouts).toContain('TERRAIN AHEAD PULL UP');
    vars.set(GPS.lat, -0.02); // 3 nm from the ridge: inside the 60 s caution look-ahead only
    for (let i = 0; i < 60; i++) t.update(DT);
    expect(vars.get('taws.flta')).toBe(1);
    expect(audio.callouts).toContain('CAUTION TERRAIN');
    vars.set(GPS.lat, -0.2); // 13 nm away: nothing within 60 s (4.2 nm at 250 kt)
    for (let i = 0; i < 60; i++) t.update(DT);
    expect(vars.get('taws.flta')).toBe(0);
  });
});

describe('Altitude alerting and minimums', () => {
  it('Garmin: approach tone at 1000 ft, captured at 200 ft, deviation tone beyond 200 ft', () => {
    const vars = new SimVars();
    const audio = new FakeAudio();
    const a = new AltitudeAlert({ vars, audio }, ALT_ALERT_GFC700);
    vars.set(AP.selAltitude, 8000);
    vars.set(ADC.baroAlt(1), 6500);
    a.update(DT);
    expect(vars.get('alt.alert')).toBe(0);
    vars.set(ADC.baroAlt(1), 7100);
    a.update(DT);
    expect(vars.get('alt.alert')).toBe(1);
    expect(audio.plays).toEqual(['alt_alert']);
    vars.set(ADC.baroAlt(1), 7850);
    a.update(DT);
    expect(vars.get('alt.alert')).toBe(2);
    vars.set(ADC.baroAlt(1), 8000);
    a.update(DT);
    vars.set(ADC.baroAlt(1), 8250);
    a.update(DT);
    expect(vars.get('alt.alert')).toBe(3);
    expect(audio.plays.length).toBe(2);
    expect(vars.get('alt.alert_flash')).toBe(1);
  });

  it('737NG: 750/200 ft bands, tone only on deviation', () => {
    const vars = new SimVars();
    const audio = new FakeAudio();
    const a = new AltitudeAlert({ vars, audio }, ALT_ALERT_737NG);
    vars.set(AP.selAltitude, 10000);
    vars.set(ADC.baroAlt(1), 9100);
    a.update(DT);
    expect(vars.get('alt.alert')).toBe(0);
    vars.set(ADC.baroAlt(1), 9300);
    a.update(DT);
    expect(vars.get('alt.alert')).toBe(1);
    expect(audio.plays.length).toBe(0);
  });

  it('MINIMUMS callout once when descending through the radio minimums', () => {
    const vars = new SimVars();
    const audio = new FakeAudio();
    const m = new MinimumsMonitor({ vars, audio }, { approachingCallout: 'APPROACHING MINIMUMS' });
    vars.set(AP.minimums(1), 200);
    vars.set(AP.minimumsIsRadio(1), 1);
    for (const ra of [600, 400, 290, 250, 200, 150, 120]) {
      vars.set(SENSOR_VARS.raAlt(1), ra);
      m.update(DT);
    }
    expect(audio.callouts).toEqual(['APPROACHING MINIMUMS', 'MINIMUMS']);
    expect(vars.get('alert.minimums')).toBe(1);
  });
});

describe('Stall, overspeed, takeoff config, disconnect aurals, TCAS', () => {
  it('stick shaker at 85 % of the stall AoA (flaps schedule) and pusher at 95 %', () => {
    const vars = new SimVars();
    const audio = new FakeAudio();
    vars.set('gear.air_ground', 0);
    const s = new StallWarning({ vars, audio }, { kind: 'aoa', alphaStall: { x: [0, 30], y: [14, 18] }, phaseAdvanceS: 0, pusher: { norm: 0.95, command: -0.3 } });
    vars.set(SENSOR_VARS.aoa(1), 11);
    s.update(DT);
    expect(vars.get(ALERT.stickShaker)).toBe(0);
    vars.set(SENSOR_VARS.aoa(1), 12.2);
    s.update(DT);
    expect(vars.get(ALERT.stickShaker)).toBe(1);
    expect(audio.tones.get('stick_shaker')).toBe(true);
    vars.set('surf.flaps_deg', 30);
    s.update(DT);
    expect(vars.get(ALERT.stickShaker)).toBe(0); // 12.2 / 18 = 0.68
    vars.set(SENSOR_VARS.aoa(1), 17.3);
    s.update(DT);
    expect(vars.get('stall.pusher_cmd')).toBe(-0.3);
  });

  it('172 reed stall horn from the physical stall-warning output, no power needed', () => {
    const vars = new SimVars();
    const s = new StallWarning({ vars }, { kind: 'horn' });
    vars.set('fdm.stall_warning', 0.2);
    s.update(DT);
    expect(vars.get(ALERT.stallHorn)).toBe(0);
    vars.set('fdm.stall_warning', 0.35);
    s.update(DT);
    expect(vars.get(ALERT.stallHorn)).toBe(1);
  });

  it('overspeed clacker above Vmo / Mmo', () => {
    const vars = new SimVars();
    const o = new Overspeed({ vars }, { vmoKt: 340, mmo: 0.82 });
    vars.set(ADC.ias(1), 335);
    vars.set(ADC.mach(1), 0.7);
    o.update(DT);
    expect(vars.get(ALERT.overspeed)).toBe(0);
    vars.set(ADC.ias(1), 342);
    o.update(DT);
    expect(vars.get(ALERT.overspeed)).toBe(1);
    vars.set(ADC.ias(1), 300);
    vars.set(ADC.mach(1), 0.83);
    o.update(DT);
    expect(vars.get(ALERT.overspeed)).toBe(1);
  });

  it('takeoff configuration warning when thrust is set with flaps outside the takeoff range', () => {
    const vars = new SimVars();
    const audio = new FakeAudio();
    const w = new TakeoffConfigWarning({ vars, audio }, {
      armed: 'gear.air_ground && ac.tla1 > 0.6',
      checks: [
        { id: 'flaps', bad: 'surf.flaps_deg < 1 || surf.flaps_deg > 25', text: 'FLAPS', voice: 'TAKEOFF FLAPS' },
        { id: 'pbrake', bad: 'ac.parking_brake', text: 'PARKING BRAKE' },
      ],
    });
    vars.set('gear.air_ground', 1);
    vars.set('ac.tla1', 0.9);
    w.update(DT);
    expect(vars.get(ALERT.configWarning)).toBe(1);
    expect(vars.getString('tocw.text')).toBe('FLAPS');
    expect(audio.callouts).toContain('TAKEOFF FLAPS');
    vars.set('surf.flaps_deg', 5);
    w.update(DT);
    expect(vars.get(ALERT.configWarning)).toBe(0);
  });

  it('AP disconnect aural follows ap.disc_warn with a maximum duration', () => {
    const vars = new SimVars();
    const audio = new FakeAudio();
    const d = new DisconnectAlerts({ vars, audio }, { apToneMaxS: 1.5 });
    vars.set('ap.disc_warn', 1);
    d.update(DT);
    expect(audio.tones.get('ap_disconnect')).toBe(true);
    for (let i = 0; i < 120; i++) d.update(DT);
    expect(audio.tones.get('ap_disconnect')).toBe(false);
  });

  it('TCAS: TA then RA on a closing intruder; CLEAR OF CONFLICT', () => {
    const vars = new SimVars();
    const audio = new FakeAudio();
    const tgt: TrafficTarget = { id: 'N1', lat: 0.2, lon: 0, altFt: 10300, vsFpm: 0 };
    const tcas = new Tcas({ vars, audio }, { source: { targets: () => [tgt] } });
    vars.set(NAV.xpdrMode, 5);
    vars.set(GPS.lat, 0);
    vars.set(GPS.lon, 0);
    vars.set(SENSOR_VARS.pressAlt(1), 10000);
    vars.set(SENSOR_VARS.raAlt(1), 2500);
    vars.set(SENSOR_VARS.raNcd(1), 1);
    // Closing head-on at 500 kt relative (0.139 nm/s)
    let taSeen = false;
    let raSeen = false;
    for (let i = 0; i < 60 * 80; i++) {
      tgt.lat -= (500 / 3600 / 60) * DT;
      tcas.update(DT);
      if (vars.get('tcas.ta') > 0) taSeen = true;
      if (vars.get('tcas.ra') > 0) raSeen = true;
      if (tgt.lat < -0.05) break;
    }
    expect(taSeen).toBe(true);
    expect(raSeen).toBe(true);
    expect(audio.callouts).toContain('TRAFFIC, TRAFFIC');
    expect(audio.callouts).toContain('DESCEND, DESCEND');
    for (let i = 0; i < 180; i++) tcas.update(DT);
    expect(audio.callouts).toContain('CLEAR OF CONFLICT');
  });
});
