import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { ENG } from '../../../src/core/vars';
import { ElectricalNetwork } from '../../../src/systems/electrical/ElectricalNetwork';
import { SourceSelector } from '../../../src/systems/electrical/AutoTransfer';
import { BATTERY_172S_MAIN, BATTERY_RG380E44 } from '../../../src/systems/electrical/presets';
import type { ElectricalConfig } from '../../../src/systems/electrical/types';
import { Turbofan } from '../../../src/physics/engines/Turbofan';
import { createEngineEnv } from '../../../src/physics/engines/Engine';
import { TEST_JET } from '../../../src/physics/testAircraft';
import type { TurbofanConfig } from '../../../src/physics/types';

const DT = 1 / 60;

function run(net: { update(dt: number): void }, seconds: number, each?: (t: number) => void): void {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    net.update(DT);
    each?.(i * DT);
  }
}

/** 172S-like network: hot battery bus -> master contactor -> main bus; alternator with field from the main bus. */
function cessna(vars: SimVars): ElectricalNetwork {
  const cfg: ElectricalConfig = {
    buses: [{ id: 'batt_bus' }, { id: 'main' }, { id: 'avn' }],
    batteries: [{ id: 'batt', bus: 'batt_bus', ...BATTERY_172S_MAIN }],
    dcGenerators: [
      {
        id: 'alt',
        bus: 'main',
        kind: 'alternator',
        regulatedV: 28.5,
        ratedA: 60,
        drive: 'eng1.rpm',
        minDrive: 700,
        maxAmpsVsDrive: { x: [700, 1000, 1500, 2000], y: [0, 30, 55, 60] },
        switch: 'ac.alt_sw',
        field: { bus: 'main', minV: 8 },
      },
    ],
    links: [
      { id: 'batt_contactor', a: 'batt_bus', b: 'main', closed: 'ac.bat_sw', coil: { pickupV: 14, dropoutV: 10 } },
      { id: 'avn_relay', a: 'main', b: 'avn', closed: 'ac.avn_sw', cb: { name: 'avn', ratingA: 15 } },
    ],
    loads: [
      { id: 'misc', bus: 'main', amps: 'ac.misc_amps', cb: { name: 'misc', ratingA: 20 } },
      { id: 'pitot_heat', bus: 'main', amps: 9, model: 'resistive', enabled: 'ac.pitot_sw', cb: { name: 'pitot', ratingA: 10 } },
      { id: 'radios', bus: 'avn', amps: 4 },
    ],
    starters: [
      {
        id: 'starter',
        bus: 'batt_bus',
        command: 'ac.key_start',
        speed: 'eng1.rpm',
        noLoadSpeed: 350,
        resistanceOhm: 0.065,
        nominalV: 24,
        engineStarterVar: ENG.starter(1),
        engineKind: 'piston',
        contactor: { bus: 'main', pickupV: 16, dropoutV: 11, pickupDelayS: 0.03 },
      },
    ],
  };
  return new ElectricalNetwork(vars, cfg);
}

describe('ElectricalNetwork: batteries', () => {
  it('powers the bus from the battery and discharges it realistically', () => {
    const vars = new SimVars();
    vars.set('ac.bat_sw', 1);
    vars.set('ac.misc_amps', 10);
    const net = cessna(vars);
    net.settle();
    const v = vars.get('elec.main_v');
    // 13.6 Ah lead-acid at 25.8 V OCV with ~10 A load: ~25.6 V.
    expect(v).toBeGreaterThan(25.0);
    expect(v).toBeLessThan(25.9);
    expect(vars.get('elec.main_powered')).toBe(1);
    expect(vars.get('elec.batt_amps')).toBeCloseTo(-10, 0); // ammeter: discharging
    expect(vars.get('elec.avn_v')).toBe(0); // avionics switch off
    // 30 minutes at 10 A from a 13.6 Ah battery: ~5 Ah (plus Peukert) used.
    run(net, 1800);
    const soc = vars.get('elec.batt_soc');
    expect(soc).toBeGreaterThan(0.55);
    expect(soc).toBeLessThan(0.66);
    // Voltage falls with SOC.
    expect(vars.get('elec.main_v')).toBeLessThan(v - 0.3);
  });

  it('runs flat under load and the bus drops below the powered threshold', () => {
    const vars = new SimVars();
    vars.set('ac.bat_sw', 1);
    vars.set('ac.misc_amps', 20);
    const net = cessna(vars);
    net.setBatterySoc('batt', 0.15);
    run(net, 3600);
    expect(vars.get('elec.batt_soc')).toBeLessThan(0.02);
    expect(vars.get('elec.main_v')).toBeLessThan(22);
  });

  it('alternator comes on line, carries the load and recharges the battery with a tapering current', () => {
    const vars = new SimVars();
    vars.set('ac.bat_sw', 1);
    vars.set('ac.alt_sw', 1);
    vars.set('ac.misc_amps', 15);
    const net = cessna(vars);
    net.setBatterySoc('batt', 0.97);
    net.settle();
    expect(vars.get('elec.alt_online')).toBe(0); // engine not turning: not available
    expect(vars.get('elec.alt_amps')).toBe(0);
    vars.set('eng1.rpm', 2200);
    run(net, 2);
    expect(vars.get('elec.alt_online')).toBe(1);
    expect(vars.get('elec.main_v')).toBeGreaterThan(27.5);
    const charge0 = vars.get('elec.batt_amps');
    expect(charge0).toBeGreaterThan(3); // charging after a small deficit
    expect(vars.get('elec.alt_amps')).toBeGreaterThan(15);
    run(net, 900);
    const charge1 = vars.get('elec.batt_amps');
    expect(charge1).toBeGreaterThan(0);
    expect(charge1).toBeLessThan(charge0 * 0.25); // tapers as the battery fills
    expect(vars.get('elec.batt_soc')).toBeGreaterThan(0.985);
    // Low rpm: alternator output limited by its drive curve -> battery helps.
    vars.set('ac.misc_amps', 45);
    vars.set('eng1.rpm', 900);
    run(net, 1);
    expect(vars.get('elec.alt_amps')).toBeCloseTo(20, 0);
    expect(vars.get('elec.batt_amps')).toBeLessThan(-10);
  });

  it('a completely flat battery cannot excite the alternator field', () => {
    const vars = new SimVars();
    vars.set('ac.bat_sw', 1);
    vars.set('ac.alt_sw', 1);
    vars.set('ac.misc_amps', 5);
    vars.set('eng1.rpm', 2200);
    const net = cessna(vars);
    net.setBatterySoc('batt', 0);
    // Relays drop out (contactor coil below drop-out) so the bus stays dead and the field never excites.
    vars.set('ac.misc_amps', 5);
    net.settle(120);
    expect(vars.get('elec.main_v')).toBeLessThan(8);
    expect(vars.get('elec.alt_amps')).toBe(0);
  });
});

describe('ElectricalNetwork: circuit breakers', () => {
  it('a short circuit trips the breaker, and it re-trips while the fault persists', () => {
    const vars = new SimVars();
    vars.set('ac.bat_sw', 1);
    vars.set('ac.pitot_sw', 1);
    const net = cessna(vars);
    net.settle();
    expect(vars.get('elec.pitot_heat_powered')).toBe(1);
    expect(vars.get('elec.pitot_heat_amps')).toBeGreaterThan(7);
    vars.set('fail.elec.pitot_heat.short', 1);
    let tripT = -1;
    run(net, 3, (t) => {
      if (tripT < 0 && vars.get('cb.pitot') === 0) tripT = t;
    });
    expect(tripT).toBeGreaterThan(0);
    expect(tripT).toBeLessThan(0.5); // 10x rating: fast trip
    expect(vars.get('cb.pitot_tripped')).toBe(1);
    expect(vars.get('elec.pitot_heat_powered')).toBe(0);
    // Pilot resets it with the fault still present: it trips again.
    vars.set('cb.pitot', 1);
    run(net, 2);
    expect(vars.get('cb.pitot')).toBe(0);
    // Fault cleared: reset holds.
    vars.set('fail.elec.pitot_heat.short', 0);
    vars.set('cb.pitot', 1);
    run(net, 5);
    expect(vars.get('cb.pitot')).toBe(1);
    expect(vars.get('cb.pitot_tripped')).toBe(0);
    expect(vars.get('elec.pitot_heat_powered')).toBe(1);
  });

  it('pulling a breaker de-powers its load; a moderate overload trips on the thermal curve', () => {
    const vars = new SimVars();
    vars.set('ac.bat_sw', 1);
    vars.set('ac.avn_sw', 1);
    vars.set('ac.misc_amps', 5);
    const net = cessna(vars);
    net.settle();
    expect(vars.get('elec.radios_powered')).toBe(1);
    vars.set('cb.avn', 0);
    run(net, 0.1);
    expect(vars.get('elec.radios_powered')).toBe(0);
    expect(vars.get('elec.avn_v')).toBe(0);
    vars.set('cb.avn', 1);
    // 200 % on the 20 A misc breaker: trips after several seconds, not instantly.
    vars.set('ac.misc_amps', 40);
    let tripT = -1;
    run(net, 20, (t) => {
      if (tripT < 0 && vars.get('cb.misc') === 0) tripT = t;
    });
    expect(tripT).toBeGreaterThan(3);
    expect(tripT).toBeLessThan(15);
  });
});

describe('ElectricalNetwork: generators and bus ties', () => {
  function twin(vars: SimVars): ElectricalNetwork {
    return new ElectricalNetwork(vars, {
      buses: [{ id: 'hot' }, { id: 'l' }, { id: 'r' }],
      batteries: [{ id: 'batt', bus: 'hot', ...BATTERY_RG380E44 }],
      dcGenerators: [
        { id: 'gen1', bus: 'l', kind: 'starter-generator', regulatedV: 28.5, ratedA: 300, drive: 'eng1.n2_pct', minDrive: 50, switch: 'ac.gen1_sw' },
        { id: 'gen2', bus: 'r', kind: 'starter-generator', regulatedV: 28.5, ratedA: 300, drive: 'eng2.n2_pct', minDrive: 50, switch: 'ac.gen2_sw' },
      ],
      links: [
        { id: 'batt_rly', a: 'hot', b: 'l', closed: 'ac.batt_sw' },
        // Bus tie closes automatically when one side has lost its generator.
        { id: 'tie', a: 'l', b: 'r', closed: '!(elec.gen1_online && elec.gen2_online)' },
      ],
      loads: [
        { id: 'lload', bus: 'l', amps: 120 },
        { id: 'rload', bus: 'r', amps: 150 },
      ],
    });
  }

  it('generators regulate, share nothing across an open tie, and the tie picks up a failed side', () => {
    const vars = new SimVars();
    vars.set('ac.batt_sw', 1);
    vars.set('ac.gen1_sw', 1);
    vars.set('ac.gen2_sw', 1);
    vars.set('eng1.n2_pct', 60);
    vars.set('eng2.n2_pct', 60);
    const net = twin(vars);
    net.settle();
    expect(vars.get('elec.gen1_online')).toBe(1);
    expect(vars.get('elec.tie_closed')).toBe(0);
    expect(vars.get('elec.l_v')).toBeGreaterThan(28);
    expect(vars.get('elec.r_v')).toBeGreaterThan(28);
    expect(vars.get('elec.gen2_amps')).toBeCloseTo(150, 0);
    // Generator 2 fails: tie closes, generator 1 carries both sides.
    vars.set('fail.elec.gen2', 1);
    net.settle(10);
    expect(vars.get('elec.gen2_online')).toBe(0);
    expect(vars.get('elec.tie_closed')).toBe(1);
    expect(vars.get('elec.r_v')).toBeGreaterThan(27.5);
    expect(vars.get('elec.gen1_amps')).toBeGreaterThan(265);
    expect(vars.get('elec.gen1_load_pct')).toBeGreaterThan(88);
  });

  it('over-voltage protection trips a runaway generator and GEN switch cycling resets it', () => {
    const vars = new SimVars();
    vars.set('ac.batt_sw', 1);
    vars.set('ac.gen1_sw', 1);
    vars.set('ac.gen2_sw', 1);
    vars.set('eng1.n2_pct', 60);
    vars.set('eng2.n2_pct', 60);
    const net = twin(vars);
    net.settle();
    vars.set('fail.elec.gen1.regulator', 1);
    run(net, 1);
    expect(vars.get('elec.gen1_tripped')).toBe(1);
    expect(vars.get('elec.gen1_online')).toBe(0);
    expect(vars.get('elec.l_v')).toBeLessThan(29);
    vars.set('fail.elec.gen1.regulator', 0);
    vars.set('ac.gen1_sw', 0);
    run(net, 0.2);
    vars.set('ac.gen1_sw', 1);
    run(net, 0.5);
    expect(vars.get('elec.gen1_tripped')).toBe(0);
    expect(vars.get('elec.gen1_online')).toBe(1);
  });
});

describe('ElectricalNetwork: diodes, AC, TRU and inverter', () => {
  it('a steering diode feeds the essential bus from main but never back-feeds main', () => {
    const vars = new SimVars();
    const net = new ElectricalNetwork(vars, {
      buses: [{ id: 'hot' }, { id: 'main' }, { id: 'ess' }, { id: 'stby_hot' }],
      batteries: [
        { id: 'batt', bus: 'hot', ...BATTERY_172S_MAIN },
        { id: 'stby', bus: 'stby_hot', chemistry: 'lead-acid', capacityAh: 7, internalResistanceOhm: 0.04, initialSoc: 0.9 },
      ],
      links: [
        { id: 'master', a: 'hot', b: 'main', closed: 'ac.master' },
        { id: 'd_main', a: 'main', b: 'ess', kind: 'diode' },
        { id: 'stby_rly', a: 'stby_hot', b: 'ess', closed: 'ac.stby_arm' },
      ],
      loads: [
        { id: 'pfd', bus: 'ess', amps: 6 },
        { id: 'lights', bus: 'main', amps: 10 },
      ],
    });
    vars.set('ac.stby_arm', 1);
    net.settle();
    // Master off: standby battery powers ess only; the diode blocks back-feed to main.
    expect(vars.get('elec.ess_powered')).toBe(1);
    expect(vars.get('elec.main_v')).toBe(0);
    expect(vars.get('elec.stby_amps')).toBeCloseTo(-6, 0);
    // Master on: main battery (higher voltage) feeds ess through the diode.
    vars.set('ac.master', 1);
    net.settle();
    expect(vars.get('elec.main_powered')).toBe(1);
    expect(vars.get('elec.d_main_closed')).toBe(1);
    expect(vars.get('elec.d_main_amps')).toBeGreaterThan(0);
  });

  it('IDG powers AC and a TRU; loss of AC leaves the battery feeding DC and the inverter feeding standby AC', () => {
    const vars = new SimVars();
    const net = new ElectricalNetwork(vars, {
      buses: [{ id: 'xfr1', type: 'ac' }, { id: 'ac_stby', type: 'ac' }, { id: 'dc1' }, { id: 'batt_bus' }],
      batteries: [{ id: 'batt', bus: 'batt_bus', chemistry: 'nicd', capacityAh: 48, internalResistanceOhm: 0.012 }],
      acGenerators: [{ id: 'idg1', bus: 'xfr1', ratedKva: 90, drive: 'eng1.n2_pct', minDrive: 50, switch: 'ac.gen1', disconnect: 'ac.disc1' }],
      trus: [{ id: 'tr1', acBus: 'xfr1', dcBus: 'dc1', ratedA: 75 }],
      inverters: [{ id: 'inv', dcBus: 'batt_bus', acBus: 'ac_stby', ratedVa: 1000, enabled: '!elec.xfr1_powered' }],
      links: [
        { id: 'xfr_to_stby', a: 'xfr1', b: 'ac_stby', closed: 'elec.xfr1_powered' },
        { id: 'dc_to_batt', a: 'dc1', b: 'batt_bus', kind: 'diode' },
        { id: 'batt_to_dc', a: 'batt_bus', b: 'dc1', closed: '!elec.xfr1_powered' },
      ],
      loads: [
        { id: 'galley', bus: 'xfr1', va: 20000 },
        { id: 'stby_inst', bus: 'ac_stby', va: 300 },
        { id: 'dc_avionics', bus: 'dc1', amps: 40 },
      ],
    });
    vars.set('ac.gen1', 1);
    vars.set('eng1.n2_pct', 62);
    net.settle();
    expect(vars.get('elec.xfr1_v')).toBeGreaterThan(112);
    expect(vars.get('elec.xfr1_hz')).toBe(400);
    expect(vars.get('elec.dc1_v')).toBeGreaterThan(27);
    expect(vars.get('elec.tr1_amps')).toBeGreaterThan(40); // loads + battery charging
    expect(vars.get('elec.idg1_kva')).toBeGreaterThan(20);
    expect(vars.get('elec.ac_stby_powered')).toBe(1);
    // IDG disconnect: latched even when the switch is released.
    vars.set('ac.disc1', 1);
    net.settle(5);
    vars.set('ac.disc1', 0);
    net.settle(30);
    expect(vars.get('elec.idg1_disconnected')).toBe(1);
    expect(vars.get('elec.idg1_drive_lowpress')).toBe(1);
    expect(vars.get('elec.xfr1_powered')).toBe(0);
    expect(vars.get('elec.dc1_powered')).toBe(1); // battery via the transfer relay
    expect(vars.get('elec.inv_online')).toBe(1);
    expect(vars.get('elec.ac_stby_v')).toBeGreaterThan(110);
    expect(vars.get('elec.batt_amps')).toBeLessThan(-40); // DC load + inverter draw
    net.reconnectDrive('idg1');
    net.settle(5);
    expect(vars.get('elec.xfr1_powered')).toBe(1);
  });

  it('an overloaded static inverter collapses its AC bus but its DC draw stays bounded', () => {
    const vars = new SimVars();
    const net = new ElectricalNetwork(vars, {
      buses: [{ id: 'batt_bus' }, { id: 'ac_stby', type: 'ac' }],
      batteries: [{ id: 'batt', bus: 'batt_bus', chemistry: 'nicd', capacityAh: 48, internalResistanceOhm: 0.012 }],
      inverters: [{ id: 'inv', dcBus: 'batt_bus', acBus: 'ac_stby', ratedVa: 1000 }],
      loads: [{ id: 'big', bus: 'ac_stby', va: 9500 }],
    });
    net.settle();
    expect(vars.get('elec.ac_stby_v')).toBeLessThan(40);
    expect(vars.get('elec.ac_stby_powered')).toBe(0);
    expect(vars.get('elec.inv_va')).toBeLessThanOrEqual(2000);
    expect(vars.get('elec.batt_bus_v')).toBeGreaterThan(22); // DC side not dragged down
  });

  it('SourceSelector: manual latching with auto transfer (737 BUS TRANSFER style)', () => {
    const vars = new SimVars();
    const sel = new SourceSelector(vars, {
      id: 'xfr1_sel',
      mode: 'manual',
      sources: [
        { name: 'GEN1', available: 'gen1_avail', select: 'gen1_on' },
        { name: 'GEN2 via BTB', available: 'gen2_avail', autoCandidate: true },
        { name: 'APU', available: 'apu_avail', select: 'apu_on', autoCandidate: false },
      ],
      deselect: 'gen1_off',
      autoTransfer: 'bus_xfr_auto',
    });
    vars.set('apu_avail', 1);
    vars.set('gen1_avail', 1);
    vars.set('gen2_avail', 1);
    sel.update(DT);
    expect(vars.get('elec.xfr1_sel_src')).toBe(0);
    vars.set('apu_on', 1);
    sel.update(DT);
    vars.set('apu_on', 0);
    sel.update(DT);
    expect(vars.get('elec.xfr1_sel_src')).toBe(3);
    vars.set('gen1_on', 1);
    sel.update(DT);
    expect(vars.get('elec.xfr1_sel_src')).toBe(1);
    vars.set('gen1_avail', 0);
    sel.update(DT);
    expect(vars.get('elec.xfr1_sel_src')).toBe(0); // BUS TRANSFER OFF: bus unpowered
    vars.set('bus_xfr_auto', 1);
    sel.update(DT);
    expect(vars.get('elec.xfr1_sel_src')).toBe(2);
    vars.set('gen1_avail', 1);
    sel.update(DT);
    expect(vars.get('elec.xfr1_sel_src')).toBe(1);
  });
});

describe('ElectricalNetwork: engine starts', () => {
  const engCfg = TEST_JET.engines[0] as TurbofanConfig;

  /** Turbine start on a starter-generator from the battery, with a simple FADEC start sequence. */
  function turbineStart(soc: number, tempC: number): { lit: boolean; running: boolean; minBusV: number; peakAmps: number; maxN2Unlit: number; finalN2: number } {
    const vars = new SimVars();
    const net = new ElectricalNetwork(vars, {
      buses: [{ id: 'hot' }, { id: 'main' }],
      batteries: [{ id: 'batt', bus: 'hot', ...BATTERY_RG380E44, ambientC: tempC }],
      dcGenerators: [
        {
          id: 'sg1',
          bus: 'main',
          kind: 'starter-generator',
          regulatedV: 28.5,
          ratedA: 300,
          drive: ENG.n2(1),
          minDrive: 50,
          starter: {
            command: 'fadec1.start_req',
            speed: ENG.n2(1),
            noLoadSpeed: 35, // EST: motor no-load speed ~1.25 x the engine's starter-only N2
            resistanceOhm: 0.02,
            nominalV: 24,
            engineStarterVar: ENG.starter(1),
          },
        },
      ],
      links: [{ id: 'batt_rly', a: 'hot', b: 'main' }],
      loads: [{ id: 'avionics', bus: 'main', amps: 25 }],
    });
    net.setBatterySoc('batt', soc);
    net.reset();
    const eng = new Turbofan(engCfg, 1, vars);
    const env = createEngineEnv();
    net.settle(10);
    vars.set('fadec1.start_req', 1);
    let minBusV = 99;
    let peakAmps = 0;
    let lit = false;
    let maxN2Unlit = 0;
    for (let step = 0; step < 120 * 90; step++) {
      if (step % 2 === 0) {
        net.update(DT);
        // FADEC: fuel + ignition at light-off N2, starter cut-out at 46 % N2.
        const n2 = vars.get(ENG.n2(1));
        if (n2 >= engCfg.lightOffN2_pct) {
          vars.set(ENG.fuelOn(1), 1);
          vars.set(ENG.ignition(1), 1);
        }
        if (n2 >= 46) {
          vars.set('fadec1.start_req', 0);
          vars.set(ENG.ignition(1), 0);
        }
        minBusV = Math.min(minBusV, vars.get('elec.main_v'));
        peakAmps = Math.max(peakAmps, vars.get('elec.sg1_starter_amps'));
      }
      eng.step(1 / 120, env);
      if (eng.lit) lit = true;
      else maxN2Unlit = Math.max(maxN2Unlit, eng.n2);
    }
    return { lit, running: vars.get(ENG.running(1)) === 1, minBusV, peakAmps, maxN2Unlit, finalN2: eng.n2 };
  }

  it('a good battery starts the engine; the starter current and bus sag look like a battery start', () => {
    const r = turbineStart(1, 20);
    expect(r.lit).toBe(true);
    expect(r.running).toBe(true);
    expect(r.peakAmps).toBeGreaterThan(600);
    expect(r.minBusV).toBeGreaterThan(14);
    expect(r.minBusV).toBeLessThan(21);
  });

  it('a weak, cold-soaked battery gives a hung start: the engine never reaches idle', () => {
    const r = turbineStart(0.05, -18);
    expect(r.running).toBe(false);
    expect(r.finalN2).toBeLessThan(40);
    expect(r.minBusV).toBeLessThan(10);
  });

  it('a nearly flat battery cannot even crank to light-off N2', () => {
    const r = turbineStart(0.025, -18);
    expect(r.lit).toBe(false);
    expect(r.running).toBe(false);
    expect(r.maxN2Unlit).toBeLessThan(engCfg.lightOffN2_pct);
    expect(r.maxN2Unlit).toBeGreaterThan(2); // it does crank, slowly
  });

  it('piston starter solenoid chatters on a flat battery instead of cranking', () => {
    const vars = new SimVars();
    vars.set('ac.bat_sw', 1);
    const net = cessna(vars);
    net.setBatterySoc('batt', 0.004);
    net.settle(30);
    vars.set('ac.key_start', 1);
    let toggles = 0;
    let prev = vars.get('elec.starter_contactor');
    let onFrac = 0;
    const n = 120;
    for (let i = 0; i < n; i++) {
      net.update(DT);
      const c = vars.get('elec.starter_contactor');
      if (c !== prev) toggles++;
      prev = c;
      onFrac += vars.get(ENG.starter(1)) / n;
    }
    expect(toggles).toBeGreaterThan(4); // click-click-click
    expect(onFrac).toBeLessThan(0.5);
    // A healthy battery holds the solenoid in and cranks steadily.
    net.setBatterySoc('batt', 1);
    vars.set('ac.key_start', 0);
    net.settle(30);
    vars.set('ac.key_start', 1);
    toggles = 0;
    prev = vars.get('elec.starter_contactor');
    let cranking = 0;
    for (let i = 0; i < n; i++) {
      net.update(DT);
      const c = vars.get('elec.starter_contactor');
      if (c !== prev) toggles++;
      prev = c;
      cranking += vars.get(ENG.starter(1)) / n;
    }
    expect(toggles).toBeLessThanOrEqual(1);
    expect(cranking).toBeGreaterThan(0.85);
    expect(vars.get('elec.starter_amps')).toBeGreaterThan(150); // locked rotor at rpm 0 in this test
  });
});
