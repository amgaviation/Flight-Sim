import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { Apu, ApuState } from '../../../src/systems/apu/Apu';
import { ElectricalNetwork } from '../../../src/systems/electrical/ElectricalNetwork';
import { BATTERY_737NG_NICD } from '../../../src/systems/electrical/presets';

const DT = 1 / 60;

function make(vars: SimVars): Apu {
  return new Apu(vars, {
    master: 'ac.apu_master',
    start: 'ac.apu_start',
    starterVolts: 'elec.batt_bus_v',
    fuelAvailable: 'fuel.apu_on',
    fire: 'fire.apu_warn',
    bleedLoad: 'ac.apu_bleed_load',
    genLoad: 'ac.apu_gen_load',
  });
}

interface Timeline {
  doorOpenT: number;
  lightOffT: number;
  availT: number;
  peakEgt: number;
  peakAmps: number;
}

function startSequence(vars: SimVars, apu: Apu, volts: number, maxS = 180): Timeline {
  const tl: Timeline = { doorOpenT: -1, lightOffT: -1, availT: -1, peakEgt: 0, peakAmps: 0 };
  vars.set('elec.batt_bus_v', volts);
  vars.set('fuel.apu_on', 1);
  vars.set('ac.apu_master', 1);
  let pressed = false;
  for (let i = 0; i < maxS * 60; i++) {
    const t = i * DT;
    apu.update(DT);
    if (tl.doorOpenT < 0 && vars.get('apu.door_open') === 1) tl.doorOpenT = t;
    if (tl.doorOpenT >= 0 && !pressed) {
      vars.set('ac.apu_start', 1); // START (spring-loaded)
      pressed = true;
    } else if (pressed) vars.set('ac.apu_start', 0);
    if (tl.lightOffT < 0 && vars.get('apu.ff_pph') > 0) tl.lightOffT = t;
    if (tl.availT < 0 && vars.get('apu.avail') === 1) tl.availT = t;
    tl.peakEgt = Math.max(tl.peakEgt, vars.get('apu.egt_c'));
    tl.peakAmps = Math.max(tl.peakAmps, vars.get('apu.starter_amps'));
    if (tl.availT >= 0 && t > tl.availT + 5) break;
    if (vars.get('apu.fault') === 1) break;
  }
  return tl;
}

describe('Apu', () => {
  it('start timeline: door, light-off, 95 % + delay -> AVAIL, start EGT peak, starter current', () => {
    const vars = new SimVars();
    const apu = make(vars);
    const tl = startSequence(vars, apu, 24);
    expect(tl.doorOpenT).toBeGreaterThan(10);
    expect(tl.doorOpenT).toBeLessThan(14);
    expect(tl.lightOffT - tl.doorOpenT).toBeGreaterThan(1);
    expect(tl.lightOffT - tl.doorOpenT).toBeLessThan(8);
    const startDuration = tl.availT - tl.doorOpenT;
    expect(startDuration).toBeGreaterThan(35);
    expect(startDuration).toBeLessThan(60);
    expect(tl.peakEgt).toBeGreaterThan(650);
    expect(tl.peakEgt).toBeLessThan(900);
    expect(tl.peakAmps).toBeGreaterThan(300);
    expect(vars.get('apu.n_pct')).toBeGreaterThan(98);
    expect(vars.get('apu.starter')).toBe(0);
    expect(vars.get('apu.gen_drive')).toBeGreaterThan(98);
    expect(vars.get('apu.bleed_psi')).toBeGreaterThan(45);
    expect(vars.get('apu.egt_c')).toBeLessThan(450); // unloaded
    vars.set('ac.apu_bleed_load', 1);
    for (let i = 0; i < 600; i++) apu.update(DT);
    expect(vars.get('apu.egt_c')).toBeGreaterThan(520);
    expect(vars.get('apu.ff_pph')).toBeGreaterThan(250);
  });

  it('stop after bleed use: 60 s cooldown, then spool-down, door closes', () => {
    const vars = new SimVars();
    const apu = make(vars);
    startSequence(vars, apu, 24);
    vars.set('ac.apu_bleed_load', 0.8);
    for (let i = 0; i < 600; i++) apu.update(DT);
    vars.set('ac.apu_bleed_load', 0);
    vars.set('ac.apu_master', 0);
    for (let i = 0; i < 30 * 60; i++) apu.update(DT);
    expect(vars.get('apu.state')).toBe(ApuState.Cooldown);
    expect(vars.get('apu.avail')).toBe(0);
    expect(vars.get('apu.n_pct')).toBeGreaterThan(95);
    for (let i = 0; i < 35 * 60; i++) apu.update(DT);
    expect(vars.get('apu.state')).toBe(ApuState.Spooldown);
    for (let i = 0; i < 90 * 60; i++) apu.update(DT);
    expect(vars.get('apu.state')).toBe(ApuState.Off);
    expect(vars.get('apu.door_pos')).toBe(0);
    expect(vars.get('apu.ff_pph')).toBe(0);
  });

  it('a weak battery gives a hot start; a flat one never lights and faults on the start timeout', () => {
    const good = startSequence(new SimVars(), make(new SimVars()), 24);
    const vars = new SimVars();
    const weak = startSequence(vars, make(vars), 15);
    expect(weak.availT - weak.doorOpenT).toBeGreaterThan(good.availT - good.doorOpenT);
    expect(weak.peakEgt).toBeGreaterThan(good.peakEgt + 80);
    const v2 = new SimVars();
    const flat = make(v2);
    const tl = startSequence(v2, flat, 6, 200);
    expect(tl.lightOffT).toBe(-1);
    expect(v2.get('apu.fault')).toBe(1);
    // Master OFF clears the fault once stopped.
    v2.set('ac.apu_master', 0);
    for (let i = 0; i < 60 * 60; i++) flat.update(DT);
    expect(v2.get('apu.fault')).toBe(0);
  });

  it('fire causes an automatic shutdown with FIRE/FAULT latched', () => {
    const vars = new SimVars();
    const apu = make(vars);
    startSequence(vars, apu, 24);
    vars.set('fire.apu_warn', 1);
    apu.update(DT);
    expect(vars.get('apu.fire_shutdown')).toBe(1);
    expect(vars.get('apu.fault')).toBe(1);
    expect(vars.get('apu.fuel_cmd')).toBe(0);
    for (let i = 0; i < 30 * 60; i++) apu.update(DT);
    expect(vars.get('apu.n_pct')).toBeLessThan(10);
  });

  it('electrical coupling: the starter load sags the battery bus it cranks from', () => {
    const vars = new SimVars();
    const net = new ElectricalNetwork(vars, {
      buses: [{ id: 'batt_bus' }],
      batteries: [{ id: 'batt', bus: 'batt_bus', ...BATTERY_737NG_NICD }],
      loads: [{ id: 'apu_starter', bus: 'batt_bus', amps: 'apu.starter_amps' }],
    });
    const apu = make(vars);
    vars.set('fuel.apu_on', 1);
    vars.set('ac.apu_master', 1);
    let minV = 99;
    let avail = -1;
    for (let i = 0; i < 120 * 60; i++) {
      net.update(DT);
      apu.update(DT);
      if (vars.get('apu.door_open') === 1 && vars.get('apu.state') === ApuState.Door) vars.set('ac.apu_start', 1);
      else vars.set('ac.apu_start', 0);
      if (vars.get('apu.starting') === 1) minV = Math.min(minV, vars.get('elec.batt_bus_v'));
      if (avail < 0 && vars.get('apu.avail') === 1) avail = i * DT;
    }
    expect(avail).toBeGreaterThan(0);
    expect(minV).toBeLessThan(24);
    expect(minV).toBeGreaterThan(18);
    expect(vars.get('elec.batt_soc')).toBeLessThan(1);
  });
});
