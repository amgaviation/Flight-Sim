/**
 * Circuit breakers of the steam 172S (POH Fig 7-7A, serials 172S8704 and on): pulling each
 * breaker removes exactly the loads behind it and the equipment it feeds stops working
 * (avionics units, instruments, lights, flaps, alternator field, annunciators); pushing it back
 * in restores them. Switch/breakers pop OFF when they trip and reset by switching ON again.
 */
import { describe, expect, it } from 'vitest';
import { AP, NAV } from '../../../src/core/vars';
import { STEAM_BREAKERS } from '../../../src/aircraft/c172s-common/systems/electrical';
import { C172 } from '../../../src/aircraft/c172s-common/vars';
import { KAP, KLN, KMA, KR, KT, KX } from '../../../src/aircraft/c172-steam/vars';
import { makeSteamRig, type SteamRig } from './rig';

type Check = (r: SteamRig) => boolean;
const off = (n: string): Check => (r) => r.vars.get(n) < 0.5;
const low = (n: string, x: number): Check => (r) => r.vars.get(n) < x;

/** Per breaker: the load-powered vars that must drop, and functional consequences. */
const EXPECT: Record<string, { loads: string[]; checks?: [string, Check][] }> = {
  // ELECTRICAL BUS 1
  cabin_lts_pwr: { loads: ['elec.flood_lts_powered', 'elec.dome_courtesy_powered', 'elec.pedestal_lt_powered', 'elec.glareshield_lt_powered'] },
  inst: { loads: ['elec.engine_gauges_powered'], checks: [['engine gauge supply volts', low(C172.analogGaugesV, 5)]] },
  flap: { loads: ['elec.flap_motor_powered'] },
  avn_bus1: {
    loads: ['elec.nav_com1_powered', 'elec.gps_powered', 'elec.gyro_powered', 'elec.avn_fan_powered'],
    checks: [
      ['KX 155A #1 off', off(KX(1).on)],
      ['KLN 94 off', off(KLN.on)],
      ['NAV 1 receiver off', off(NAV.powered(1))],
    ],
  },
  // ESSENTIAL / CROSSFEED BUS
  warn: { loads: ['elec.warn_powered'] },
  alt_fld: { loads: ['elec.alt_field_powered'], checks: [['alternator off line', off('elec.alt_online')]] },
  // ELECTRICAL BUS 2
  avn_bus2: {
    loads: ['elec.nav_com2_powered', 'elec.xpndr_powered', 'elec.autopilot_powered', 'elec.adf_powered'],
    checks: [
      ['KX 155A #2 off', off(KX(2).on)],
      ['KMA 28 off (EMG)', off(KMA.on)],
      ['KT 76C off', off(KT.on)],
      ['KAP 140 off', off(KAP.on)],
      ['KR 87 off', off(KR.on)],
    ],
  },
  turn_coord: { loads: ['elec.turn_coord_powered'], checks: [['TC gyro volts', low(C172.analogTurnCoordV, 5)], ['KAP 140 R lamp', (r) => r.vars.get(KAP.rLamp) > 0.5]] },
  inst_lts: { loads: ['elec.panel_lts_powered'] },
  // AVIONICS BUS 1
  avn_fan: { loads: ['elec.avn_fan_powered'] },
  gps: { loads: ['elec.gps_powered'], checks: [['KLN 94 off', off(KLN.on)], ['GPS receiver off', off('gps.powered')]] },
  gyro: { loads: ['elec.gyro_powered'] },
  nav_com1: { loads: ['elec.nav_com1_powered'], checks: [['KX 155A #1 off', off(KX(1).on)], ['NAV 1 receiver off', off(NAV.powered(1))]] },
  // AVIONICS BUS 2
  nav_com2: { loads: ['elec.nav_com2_powered'], checks: [['KX 155A #2 off', off(KX(2).on)], ['KMA 28 off (EMG)', off(KMA.on)], ['marker receiver off', off(NAV.markerPowered)]] },
  xpndr: { loads: ['elec.xpndr_powered'], checks: [['KT 76C off', off(KT.on)], ['transponder mode off', off(NAV.xpdrMode)]] },
  autopilot: { loads: ['elec.autopilot_powered'], checks: [['KAP 140 off', off(KAP.on)], ['autopilot not engaged', off(AP.engaged)]] },
  adf: { loads: ['elec.adf_powered'], checks: [['KR 87 off', off(KR.on)], ['ADF receiver off', off(NAV.adfPowered(1))]] },
};

describe('c172-steam circuit breakers (POH Fig 7-7A)', () => {
  const plain = STEAM_BREAKERS.filter((b) => !b.switchVar);
  it('every panel breaker has an expectation', () => {
    expect(plain.map((b) => b.name).sort()).toEqual(Object.keys(EXPECT).sort());
  });

  for (const b of plain) {
    it(`pulling ${b.label} removes its loads; pushing it restores them`, () => {
      const r = makeSteamRig({ state: 'cruise', air: { altFtMsl: 5000, iasKt: 105 } });
      const v = r.vars;
      // Everything that can be on is on (lights, dimmers) so each load is drawing.
      v.set(C172.floodLeft, 1);
      v.set(C172.domeCourtesy, 1);
      v.set(C172.dimPanel, 0.8);
      v.set(C172.dimRadio, 0.8);
      v.set(C172.dimGlareshield, 0.8);
      v.set(C172.dimPedestal, 0.8);
      r.run(2);
      if (b.name === 'autopilot' || b.name === 'avn_bus2') {
        r.events.emit('kap140.ap');
        r.run(0.5);
        expect(v.get(AP.engaged), 'AP engaged before the pull').toBe(1);
      }
      const e = EXPECT[b.name];
      for (const n of e.loads) expect(v.get(n), `${n} before`).toBe(1);
      v.set(`cb.${b.name}`, 0);
      r.run(1.5);
      for (const n of e.loads) expect(v.get(n), `${n} after pulling ${b.label}`).toBe(0);
      for (const [what, ok] of e.checks ?? []) expect(ok(r), `${what} after pulling ${b.label}`).toBe(true);
      v.set(`cb.${b.name}`, 1);
      r.run(2);
      for (const n of e.loads) expect(v.get(n), `${n} after reset`).toBe(1);
    });
  }

  it('a tripped switch/breaker pops OFF and resets when switched ON again (POH Sec 7)', () => {
    const r = makeSteamRig({ state: 'cruise', air: { altFtMsl: 5000, iasKt: 105 } });
    const v = r.vars;
    v.set(C172.land, 1);
    r.run(1);
    expect(v.get('elec.land_lt_powered')).toBe(1);
    // Trip (as the electrical network does on an overload).
    v.set('cb.land', 0);
    v.set('cb.land_tripped', 1);
    r.run(0.5);
    expect(v.get(C172.land)).toBe(0);
    expect(v.get('elec.land_lt_powered')).toBe(0);
    v.set(C172.land, 1);
    r.run(0.5);
    expect(v.get('cb.land')).toBe(1);
    expect(v.get('cb.land_tripped')).toBe(0);
    expect(v.get('elec.land_lt_powered')).toBe(1);
  });
});
