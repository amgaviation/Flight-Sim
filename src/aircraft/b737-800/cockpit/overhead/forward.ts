/**
 * 737-800 forward overhead panel (P5 forward), FCOM 1.30 "Forward overhead
 * panel" arrangement (dossier §10.1-10.10). Seen from the seat (panel top =
 * aft, bottom = forward, next to the windshield):
 *
 *   col 1           col 2          col 3            col 4          col 5           col 6
 *   FLIGHT CONTROL  ELECTRICAL     LIGHTS / CVR     PROBE HEAT     AIR COND        CABIN ALTITUDE
 *   NAV / DISPLAYS  (meters, BAT,  EQUIP COOLING    ANTI-ICE       BLEED           PRESSURIZATION
 *   FUEL             STBY PWR,     EMER EXIT LTS    HYDRAULIC                      (FLT / LAND ALT,
 *                    GRD PWR,      PASS SIGNS        PUMPS                          outflow, mode)
 *                    GEN / APU GEN) CALL
 *                                  WINDOW HEAT
 *   bottom row: WIPER L | LANDING (RETRACTABLE, FIXED), RUNWAY TURNOFF, TAXI | APU | ENGINE START
 *               + IGNITION | LOGO, POSITION, ANTI COLLISION, WING, WHEEL WELL | WIPER R
 *
 * Every control writes the var of docs/aircraft/b737-800.md §10 (vars.ts);
 * every light shows a var the systems drive (systems/cas.ts, logic.ts).
 * Module sizes / positions EST from NG photographs (Boeing 146 mm modules).
 * SCOPE: blue valve lights show one brightness for "open" and "in transit"
 * (the systems publish 1 dim / 2 bright; the lens lights for either).
 */
import { RotaryKnob } from '../../../../cockpit/controls';
import { addTransferSwitches } from '../../../../avionics/boeing-737';
import { placeOnPanel } from '../../../../cockpit/frame';
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import { B738, APU_SW, ENG_START, type FuelPump, type HydPumpSw, type WindowHeat } from '../../vars';
import type { B738CockpitContext } from '../context';
import { seg } from '../context';
import { LcdDisplay } from '../displays';
import { MOD_W, OFF_ON, Ovhd, SPRING_OFF_ON, module } from './parts';
import { ScaleDial, lin, ticks } from './gauges';

/** Forward overhead: panel width / height (MOUNTS.overheadFwd) and the module column centres. */
export const FWD = { w: 0.95, h: 0.64 } as const;
const COL = [0, 1, 2, 3, 4, 5].map((i) => FWD.w / 2 + (i - 2.5) * 0.148);
const TOP = 0.012;
/** Bottom row (next to the windshield). */
const ROW_Y = 0.532;
const ROW_H = 0.096;

export function buildForwardOverhead(c: B738CockpitContext, root: Panel): void {
  const { env, ctx } = c;
  const vars = ctx.vars;
  /** Stacks modules down a column; returns the module helpers. */
  const stack = (col: number) => {
    let y = TOP;
    return (name: string, h: number) => {
      const p = module(root, `b738.ovhd.${name}`, COL[col], y + h / 2, MOD_W, h);
      y += h + 0.002;
      return new Ovhd(env, p);
    };
  };
  const dial = (o: Ovhd, mk: () => ScaleDial, x: number, y: number, size: number) => {
    if (c.headless) return;
    const d = mk();
    o.p.roundInstrument(d, x, y, size, { flange: true });
    c.onDispose(() => d.dispose());
  };
  const lcd = (o: Ovhd, id: string, power: string, watch: string[], fields: ConstructorParameters<typeof LcdDisplay>[4], x: number, y: number, w: number, h: number, width = 320) => {
    if (c.headless) return;
    const d = new LcdDisplay(vars, id, power, watch, fields, width);
    o.p.display(d, x, y, w, h, { bezel: { border: 0.0025, depth: 0.003 } });
    c.onDispose(() => d.dispose());
  };
  const L = B738.lt;

  // ============================================================== column 1: FLIGHT CONTROL, NAV/DISPLAYS, FUEL
  const c1 = stack(0);
  {
    const o = c1('fltctl', 0.225);
    const id = (s: string) => `b738.ovhd.fltctl.${s}`;
    o.label('FLIGHT CONTROL', 0.046, 0.009, 0.0022);
    o.label('SPOILER', 0.114, 0.009, 0.0022);
    for (const [k, sys] of [
      [0, 'a'],
      [1, 'b'],
    ] as const) {
      const x = 0.026 + k * 0.04;
      o.label(sys.toUpperCase(), x, 0.018);
      o.guarded({ id: id(`fltctl_${sys}`), label: `FLT CONTROL ${sys.toUpperCase()}`, var: B738.fltCtl(sys), positions: ['STBY RUD', 'OFF', 'ON'], values: [-1, 0, 1], initial: 2, guard: { color: 'red', guardedPosition: 2 } }, x, 0.045, false);
      o.annun(id(`low_press_${sys}`), `FLT CONTROL ${sys.toUpperCase()} LOW PRESSURE`, [seg.on(['LOW', 'PRESSURE'], 'amber', L.fltCtlLowPress(sys))], x, 0.078);
      const xs = 0.1 + k * 0.028;
      o.label(sys.toUpperCase(), xs, 0.018);
      o.guarded({ id: id(`spoiler_${sys}`), label: `SPOILER ${sys.toUpperCase()}`, var: B738.spoilerSw(sys), positions: ['OFF', 'ON'], values: [0, 1], initial: 1, guard: { color: 'red', guardedPosition: 1 } }, xs, 0.045, false, 0.7);
    }
    // Standby hydraulics.
    o.label('STANDBY HYD', 0.114, 0.07, 0.0019);
    o.annun(id('stby_low_qty'), 'STBY HYD LOW QUANTITY', [seg.on(['LOW', 'QUANTITY'], 'amber', L.stbyLowQty)], 0.114, 0.082);
    o.annun(id('stby_low_press'), 'STBY HYD LOW PRESSURE', [seg.on(['LOW', 'PRESSURE'], 'amber', L.stbyLowPress)], 0.114, 0.096);
    o.annun(id('stby_rud_on'), 'STBY RUD ON', [seg.on(['STBY', 'RUD ON'], 'amber', L.stbyRudOn)], 0.114, 0.11);
    // Alternate flaps.
    o.bracket('ALTERNATE FLAPS', 0.046, 0.1, 0.07, 0.0019);
    o.guarded({ id: id('alt_flaps_arm'), label: 'ALTERNATE FLAPS MASTER', var: B738.altFlapsArm, positions: ['OFF', 'ARM'], values: [0, 1], initial: 0, guard: { color: 'red', guardedPosition: 0 } }, 0.026, 0.128, false);
    o.toggle({ id: id('alt_flaps_sw'), label: 'ALTERNATE FLAPS', var: B738.altFlapsSw, positions: ['DOWN', 'OFF', 'UP'], values: [1, 0, -1], initial: 1, springs: { 0: 1 } }, 0.066, 0.128, false);
    o.label('ARM', 0.026, 0.108);
    // Right column: FEEL DIFF PRESS, SPEED TRIM FAIL, MACH TRIM FAIL, AUTO SLAT FAIL.
    o.annun(id('feel_diff'), 'FEEL DIFF PRESS', [seg.on(['FEEL DIFF', 'PRESS'], 'amber', L.feelDiffPress)], 0.114, 0.132);
    o.annun(id('speed_trim_fail'), 'SPEED TRIM FAIL', [seg.on(['SPEED TRIM', 'FAIL'], 'amber', L.speedTrimFail)], 0.114, 0.146);
    o.annun(id('mach_trim_fail'), 'MACH TRIM FAIL', [seg.on(['MACH TRIM', 'FAIL'], 'amber', L.machTrimFail)], 0.114, 0.16);
    o.annun(id('auto_slat_fail'), 'AUTO SLAT FAIL', [seg.on(['AUTO SLAT', 'FAIL'], 'amber', L.autoSlatFail)], 0.114, 0.174);
    // Yaw damper: indicator, light and the solenoid-held switch.
    o.annun(id('yaw_damper'), 'YAW DAMPER', [seg.on(['YAW', 'DAMPER'], 'amber', L.yawDamper)], 0.026, 0.168);
    o.toggle({ id: id('yd_sw'), label: 'YAW DAMPER', var: B738.ydSw, ...OFF_ON }, 0.026, 0.2, false);
    o.label('YAW DAMPER', 0.058, 0.212, 0.0017);
    dial(
      o,
      () => new ScaleDial({
        id: 'b738_yd_ind',
        vars,
        powerVar: 'elec.yd_powered',
        scales: [{ angle: lin(-1, 1, -60, 60), ticks: [{ v: -1, label: 'L' }, { v: -0.5, major: false }, { v: 0 }, { v: 0.5, major: false }, { v: 1, label: 'R' }] }],
        needles: [{ var: L.yawDamperInd }],
        title: ['YAW', 'DAMPER'],
        titleY: 170,
      }),
      0.068,
      0.18,
      0.03,
    );
  }
  {
    const o = c1('navdisp', 0.098);
    o.label('NAVIGATION', 0.073, 0.007, 0.002);
    o.label('DISPLAYS', 0.098, 0.057, 0.0019);
    const xs = addTransferSwitches(c.b, o.p, 0.03, 0.03, 0.043);
    // Second row: DISPLAYS SOURCE / CONTROL PANEL (FCOM 10.10 panel figure).
    const [u3, v3] = o.p.uv(0.052, 0.075);
    placeOnPanel(xs[3].object, u3, v3);
    const [u4, v4] = o.p.uv(0.11, 0.075);
    placeOnPanel(xs[4].object, u4, v4);
  }
  {
    const o = c1('fuel', 0.2);
    const id = (s: string) => `b738.ovhd.fuel.${s}`;
    o.label('FUEL', 0.073, 0.007, 0.0024);
    dial(
      o,
      () => new ScaleDial({
        id: 'b738_fuel_temp',
        vars,
        powerVar: 'elec.dc1_powered',
        scales: [{ angle: lin(-50, 50, -130, 130), ticks: ticks(-50, 50, 10, 50, (v) => (v === 0 ? '0' : `${v > 0 ? '+' : ''}${v}`)), bands: [{ from: -50, to: -43, color: '#d02020' }] }],
        needles: [{ var: L.fuelTempC }],
        title: ['FUEL', 'TEMP', '°C'],
        titleY: 160,
      }),
      0.024,
      0.03,
      0.03,
    );
    for (const i of [1, 2] as const) {
      const x = i === 1 ? 0.063 : 0.121;
      o.annun(id(`eng_valve${i}`), `ENG VALVE CLOSED ${i}`, [seg.any(['ENG VALVE', 'CLOSED'], 'blue', L.engValveClosed(i))], x, 0.022);
      o.annun(id(`spar_valve${i}`), `SPAR VALVE CLOSED ${i}`, [seg.any(['SPAR VALVE', 'CLOSED'], 'blue', L.sparValveClosed(i))], x, 0.038);
      o.annun(id(`filter_bypass${i}`), `FILTER BYPASS ${i}`, [seg.on(['FILTER', 'BYPASS'], 'amber', L.filterBypass(i))], i === 1 ? 0.024 : 0.121, 0.066);
    }
    o.annun(id('xfeed_open'), 'CROSSFEED VALVE OPEN', [seg.any(['VALVE', 'OPEN'], 'blue', L.xfeedValveOpen)], 0.073, 0.062);
    o.selector(id('crossfeed'), 'CROSSFEED', B738.crossfeed, [{ value: 0, label: 'CLOSED', angle: -45 }, { value: 1, label: 'OPEN', angle: 45 }], 0.073, 0.088, { cap: 'bar', diameter: 0.015, title: 'CROSSFEED' });
    const pump = (p: FuelPump, name: string, x: number, yl: number, ys: number) => {
      o.annun(id(`lp_${p}`), `FUEL PUMP ${name} LOW PRESSURE`, [seg.on(['LOW', 'PRESSURE'], 'amber', L.fuelLowPress(p))], x, yl, 0.022, 0.011);
      o.toggle({ id: id(`pump_${p}`), label: `FUEL PUMP ${name}`, var: B738.fuelPump(p), ...OFF_ON }, x, ys, false, 0.7);
    };
    o.label('CTR', 0.073, 0.114, 0.0019);
    pump('c_l', 'CTR L', 0.036, 0.1, 0.124);
    pump('c_r', 'CTR R', 0.11, 0.1, 0.124);
    pump('l_aft', 'L AFT', 0.02, 0.148, 0.174);
    pump('l_fwd', 'L FWD', 0.048, 0.148, 0.174);
    pump('r_fwd', 'R FWD', 0.098, 0.148, 0.174);
    pump('r_aft', 'R AFT', 0.126, 0.148, 0.174);
    o.labels(['AFT', '', 'FWD'], 0.034, 0.188, 0.0016);
    o.label('AFT    FWD', 0.034, 0.194, 0.0016);
    o.label('FWD    AFT', 0.112, 0.194, 0.0016);
    o.label('1', 0.034, 0.137, 0.002);
    o.label('2', 0.112, 0.137, 0.002);
  }

  // ============================================================== column 2: ELECTRICAL
  const c2 = stack(1);
  {
    const o = c2('elec1', 0.255);
    const id = (s: string) => `b738.ovhd.elec.${s}`;
    o.label('DC', 0.026, 0.007);
    o.label('AC', 0.12, 0.007);
    o.selector(
      id('dc_meter'),
      'DC METERS',
      B738.dcMeterSel,
      ['STBY PWR', 'BAT BUS', 'BAT', 'TR1', 'TR2', 'TR3', 'TEST'].map((l, i) => ({ value: i, label: l, angle: -135 + i * 45 })),
      0.026,
      0.036,
      { diameter: 0.012, labelHeight: 0.0014, labelRadius: 0.0125 },
    );
    o.selector(
      id('ac_meter'),
      'AC METERS',
      B738.acMeterSel,
      ['STBY PWR', 'GRD PWR', 'GEN 1', 'APU GEN', 'GEN 2', 'INV', 'TEST'].map((l, i) => ({ value: i, label: l, angle: -135 + i * 45 })),
      0.12,
      0.036,
      { diameter: 0.012, labelHeight: 0.0014, labelRadius: 0.0125 },
    );
    const f0 = (x: number) => x.toFixed(0);
    lcd(o, 'b738_elec_dc_lcd', 'elec.batt_bus_powered', [L.dcVolts, L.dcAmps], [{ text: () => f0(vars.get(L.dcAmps)), x: 80, size: 38 }, { text: () => f0(vars.get(L.dcVolts)), x: 240, size: 38 }], 0.073, 0.02, 0.042, 0.011);
    lcd(o, 'b738_elec_ac_lcd', 'elec.batt_bus_powered', [L.acVolts, L.acAmps, L.acHz], [{ text: () => f0(vars.get(L.acAmps)), x: 60, size: 34 }, { text: () => f0(vars.get(L.acHz)), x: 160, size: 34 }, { text: () => f0(vars.get(L.acVolts)), x: 260, size: 34 }], 0.073, 0.042, 0.042, 0.011);
    o.label('AMPS   VOLTS', 0.073, 0.0105, 0.0014);
    o.label('AMPS  CPS  VOLTS', 0.073, 0.0325, 0.0014);
    o.button({ id: id('maint'), label: 'ELEC MAINT', mode: 'momentary', var: B738.elecMaint, engraved: 'MAINT', engravedHeight: 0.0013, width: 0.008 }, 0.073, 0.064);
    o.annun(id('bat_discharge'), 'BAT DISCHARGE', [seg.on(['BAT', 'DISCHARGE'], 'amber', L.batDischarge)], 0.026, 0.084);
    o.annun(id('tr_unit'), 'TR UNIT', [seg.on(['TR', 'UNIT'], 'amber', L.trUnit)], 0.073, 0.084);
    o.annun(id('elec_lt'), 'ELEC', [seg.on('ELEC', 'amber', L.elec)], 0.12, 0.084);
    o.guarded({ id: id('bat'), label: 'BAT', var: B738.batSw, positions: ['OFF', 'ON'], values: [0, 1], initial: 1, guard: { color: 'red', guardedPosition: 1 } }, 0.026, 0.122, 'BAT');
    o.toggle({ id: id('cab_util'), label: 'CAB/UTIL', var: B738.cabUtilSw, ...OFF_ON, initial: 1 }, 0.073, 0.122, 'CAB/UTIL');
    o.toggle({ id: id('ife'), label: 'IFE/PASS SEAT', var: B738.ifeSw, ...OFF_ON, initial: 1 }, 0.12, 0.122, 'IFE/PASS SEAT');
    for (const i of [1, 2] as const) {
      const x = i === 1 ? 0.024 : 0.122;
      o.annun(id(`drive${i}`), `DRIVE ${i}`, [seg.on('DRIVE', 'amber', L.drive(i))], x, 0.162);
      o.guarded({ id: id(`drive_disc${i}`), label: `GENERATOR DRIVE DISCONNECT ${i}`, var: B738.driveDisc(i), positions: ['NORMAL', 'DISCONNECT'], values: [0, 1], initial: 0, springs: { 1: 0 }, guard: { color: 'red', guardedPosition: 0 } }, x, 0.206, 'DISCONNECT', 0.7);
    }
    o.label('GENERATOR DRIVE', 0.073, 0.236, 0.0017);
    o.annun(id('stby_pwr_off'), 'STANDBY PWR OFF', [seg.on(['STANDBY', 'PWR OFF'], 'amber', L.stbyPwrOff)], 0.073, 0.162);
    o.guarded({ id: id('stby_pwr'), label: 'STANDBY POWER', var: B738.stbyPwrSw, positions: ['BAT', 'OFF', 'AUTO'], values: [-1, 0, 1], initial: 2, guard: { color: 'red', guardedPosition: 2 } }, 0.073, 0.206, 'STANDBY POWER');
  }
  {
    const o = c2('elec2', 0.262);
    const id = (s: string) => `b738.ovhd.elec.${s}`;
    o.annun(id('grd_pwr_avail'), 'GRD POWER AVAILABLE', [seg.on(['GRD POWER', 'AVAILABLE'], 'blue', L.grdPwrAvail)], 0.073, 0.016, 0.026);
    o.toggle({ id: id('grd_pwr'), label: 'GRD PWR', var: B738.grdPwrSw, ...SPRING_OFF_ON }, 0.073, 0.052, 'GRD PWR');
    for (const i of [1, 2] as const) {
      const x = i === 1 ? 0.026 : 0.12;
      o.annun(id(`xfr_bus_off${i}`), `TRANSFER BUS ${i} OFF`, [seg.on(['TRANSFER', 'BUS OFF'], 'amber', L.xfrBusOff(i))], x, 0.086);
      o.annun(id(`source_off${i}`), `SOURCE OFF ${i}`, [seg.on(['SOURCE', 'OFF'], 'amber', L.sourceOff(i))], x, 0.101);
      o.annun(id(`gen_off_bus${i}`), `GEN OFF BUS ${i}`, [seg.on(['GEN OFF', 'BUS'], 'blue', L.genOffBus(i))], i === 1 ? 0.022 : 0.124, 0.148);
    }
    o.guarded({ id: id('bus_xfer'), label: 'BUS TRANSFER', var: B738.busXferSw, positions: ['OFF', 'AUTO'], values: [0, 1], initial: 1, guard: { color: 'red', guardedPosition: 1 } }, 0.073, 0.1, 'BUS TRANSFER');
    o.annun(id('apu_gen_off_bus'), 'APU GEN OFF BUS', [seg.on(['APU GEN', 'OFF BUS'], 'blue', L.apuGenOffBus)], 0.073, 0.148);
    o.toggle({ id: id('gen1'), label: 'GEN 1', var: B738.genSw(1), ...SPRING_OFF_ON }, 0.022, 0.196, false);
    o.toggle({ id: id('apu_gen1'), label: 'APU GEN 1', var: B738.apuGenSw(1), ...SPRING_OFF_ON }, 0.057, 0.196, false);
    o.toggle({ id: id('apu_gen2'), label: 'APU GEN 2', var: B738.apuGenSw(2), ...SPRING_OFF_ON }, 0.089, 0.196, false);
    o.toggle({ id: id('gen2'), label: 'GEN 2', var: B738.genSw(2), ...SPRING_OFF_ON }, 0.124, 0.196, false);
    o.label('GEN 1', 0.022, 0.232);
    o.label('APU GEN', 0.073, 0.232);
    o.label('GEN 2', 0.124, 0.232);
    o.line(0.012, 0.244, 0.134, 0.244);
    o.label('ELECTRICAL', 0.073, 0.252, 0.0022);
  }

  // ============================================================== column 3: lights, CVR, equipment cooling, emergency lights, signs, call, window heat
  const c3 = stack(2);
  {
    const o = c3('lights', 0.062);
    const id = (s: string) => `b738.ovhd.lt.${s}`;
    o.knob(id('cb'), 'CIRCUIT BREAKER LIGHTS', B738.cbPanelLt, 0.024, 0.032, { initial: 0.5 });
    o.labels(['CIRCUIT', 'BREAKER'], 0.024, 0.01, 0.0016);
    o.knob(id('panel'), 'OVERHEAD PANEL LIGHTS', B738.ovhdPanelLt, 0.058, 0.032, { initial: 0.5 });
    o.label('PANEL', 0.058, 0.012, 0.0017);
    o.toggle({ id: id('dome'), label: 'DOME WHITE', var: B738.domeLt, positions: ['BRIGHT', 'OFF', 'DIM'], values: [2, 0, 1], initial: 1 }, 0.108, 0.034, false, 0.75);
    o.label('DOME WHITE', 0.108, 0.01, 0.0017);
  }
  {
    const o = c3('cvr', 0.058);
    const id = (s: string) => `b738.ovhd.cvr.${s}`;
    o.label('VOICE RECORDER', 0.073, 0.008, 0.0019);
    o.button({ id: id('test'), label: 'CVR TEST', mode: 'momentary', var: B738.cvrTest, engraved: 'TEST', engravedHeight: 0.0014 }, 0.03, 0.032);
    o.annun(id('status'), 'CVR STATUS', [seg.on('STATUS', 'green', 'ac.b738.cvr_test_lt')], 0.073, 0.032, 0.02, 0.01);
    o.button({ id: id('erase'), label: 'CVR ERASE (hold 2 s on the ground, parking brake set)', mode: 'momentary', var: B738.cvrErase, engraved: 'ERASE', engravedHeight: 0.0014 }, 0.116, 0.032);
  }
  {
    const o = c3('equip_cool', 0.058);
    const id = (s: string) => `b738.ovhd.equip.${s}`;
    o.label('EQUIP COOLING', 0.073, 0.008, 0.0019);
    o.toggle({ id: id('supply'), label: 'EQUIP COOLING SUPPLY', var: B738.equipCoolSupply, positions: ['ALTN', 'NORM'], values: [1, 0], initial: 1 }, 0.026, 0.034, 'SUPPLY', 0.7);
    o.annun(id('supply_off'), 'EQUIP COOLING SUPPLY OFF', [seg.on('OFF', 'amber', L.equipCoolOff('supply'))], 0.052, 0.034, 0.014, 0.01);
    o.toggle({ id: id('exhaust'), label: 'EQUIP COOLING EXHAUST', var: B738.equipCoolExhaust, positions: ['ALTN', 'NORM'], values: [1, 0], initial: 1 }, 0.1, 0.034, 'EXHAUST', 0.7);
    o.annun(id('exhaust_off'), 'EQUIP COOLING EXHAUST OFF', [seg.on('OFF', 'amber', L.equipCoolOff('exhaust'))], 0.126, 0.034, 0.014, 0.01);
  }
  {
    const o = c3('emer_exit', 0.056);
    const id = (s: string) => `b738.ovhd.emer.${s}`;
    o.labels(['EMERGENCY', 'EXIT LIGHTS'], 0.04, 0.007, 0.0017);
    o.guarded({ id: id('exit_lts'), label: 'EMERGENCY EXIT LIGHTS', var: B738.emerExitLt, positions: ['ON', 'ARMED', 'OFF'], values: [2, 1, 0], initial: 1, guard: { color: 'red', guardedPosition: 1 } }, 0.04, 0.036, false, 0.75);
    o.annun(id('not_armed'), 'EMERGENCY EXIT LIGHTS NOT ARMED', [seg.on(['NOT', 'ARMED'], 'amber', L.emerExitNotArmed)], 0.105, 0.03);
  }
  {
    const o = c3('signs', 0.058);
    const id = (s: string) => `b738.ovhd.signs.${s}`;
    o.label('PASSENGER SIGNS', 0.073, 0.007, 0.0017);
    o.toggle({ id: id('no_smoking'), label: 'NO SMOKING', var: B738.noSmoking, positions: ['OFF', 'AUTO', 'ON'], values: [0, 1, 2], initial: 1 }, 0.042, 0.034, 'NO SMOKING', 0.75);
    o.toggle({ id: id('fasten_belts'), label: 'FASTEN BELTS', var: B738.fastenBelts, positions: ['OFF', 'AUTO', 'ON'], values: [0, 1, 2], initial: 1 }, 0.104, 0.034, 'FASTEN BELTS', 0.75);
  }
  {
    const o = c3('call', 0.046);
    const id = (s: string) => `b738.ovhd.call.${s}`;
    o.button({ id: id('attend'), label: 'ATTEND', mode: 'momentary', var: B738.attendCall, engraved: 'ATTEND', engravedHeight: 0.0013, width: 0.01 }, 0.03, 0.024);
    o.annun(id('call'), 'CALL', [seg.on('CALL', 'blue', L.callLt)], 0.073, 0.024, 0.018, 0.01);
    o.button({ id: id('grd_call'), label: 'GRD CALL', mode: 'momentary', var: B738.grdCall, engraved: 'GRD CALL', engravedHeight: 0.0013, width: 0.01 }, 0.116, 0.024);
  }
  {
    const o = c3('win_heat', 0.17);
    const id = (s: string) => `b738.ovhd.winheat.${s}`;
    o.label('WINDOW HEAT', 0.073, 0.008, 0.0022);
    const W: [WindowHeat, string][] = [
      ['l_side', 'L SIDE'],
      ['l_fwd', 'L FWD'],
      ['r_fwd', 'R FWD'],
      ['r_side', 'R SIDE'],
    ];
    W.forEach(([w, name], k) => {
      const x = 0.022 + k * 0.034;
      o.annun(id(`ovht_${w}`), `WINDOW HEAT ${name} OVERHEAT`, [seg.on('OVERHEAT', 'amber', L.windowOverheat(w))], x, 0.026, 0.024, 0.011);
      o.annun(id(`on_${w}`), `WINDOW HEAT ${name} ON`, [seg.on('ON', 'green', L.windowOn(w))], x, 0.041, 0.024, 0.011);
      o.toggle({ id: id(w), label: `WINDOW HEAT ${name}`, var: B738.windowHeat(w), ...OFF_ON }, x, 0.078, false, 0.75);
      o.label(name, x, 0.104, 0.0018);
    });
    o.toggle({ id: id('test'), label: 'WINDOW HEAT TEST', var: B738.windowHeatTest, positions: ['OVHT', '', 'PWR TEST'], values: [-1, 0, 1], initial: 1, springs: { 0: 1, 2: 1 }, orientation: 'horizontal' }, 0.073, 0.138, false, 0.75);
    o.label('TEST', 0.073, 0.155, 0.0018);
  }

  // ============================================================== column 4: PROBE HEAT, ANTI-ICE, HYDRAULIC PUMPS
  const c4 = stack(3);
  {
    const o = c4('probe', 0.172);
    const id = (s: string) => `b738.ovhd.probe.${s}`;
    o.label('PROBE HEAT', 0.073, 0.008, 0.0022);
    for (const s of ['a', 'b'] as const) {
      const x = s === 'a' ? 0.026 : 0.12;
      o.toggle({ id: id(s), label: `PROBE HEAT ${s.toUpperCase()}`, var: B738.probeHeat(s), ...OFF_ON }, x, 0.042, s.toUpperCase(), 0.75);
    }
    o.button({ id: id('tat_test'), label: 'TAT TEST', mode: 'momentary', var: B738.tatTest, engraved: 'TAT TEST', engravedHeight: 0.0013, width: 0.01 }, 0.073, 0.042);
    const P: [Parameters<typeof L.probeOff>[0], string][][] = [
      [
        ['capt_pitot', 'CAPT PITOT'],
        ['l_elev_pitot', 'L ELEV PITOT'],
        ['l_alpha', 'L ALPHA VANE'],
        ['temp_probe', 'TEMP PROBE'],
      ],
      [
        ['fo_pitot', 'F/O PITOT'],
        ['r_elev_pitot', 'R ELEV PITOT'],
        ['r_alpha', 'R ALPHA VANE'],
        ['aux_pitot', 'AUX PITOT'],
      ],
    ];
    P.forEach((col, k) =>
      col.forEach(([pr, name], j) => {
        const parts = name.split(' ');
        const top = parts.slice(0, parts.length - 1).join(' ');
        o.annun(id(pr), name, [seg.on([top, parts[parts.length - 1]], 'amber', L.probeOff(pr))], k === 0 ? 0.042 : 0.104, 0.082 + j * 0.02, 0.028, 0.013);
      }),
    );
  }
  {
    const o = c4('anti_ice', 0.168);
    const id = (s: string) => `b738.ovhd.ai.${s}`;
    o.label('WING ANTI-ICE', 0.073, 0.008, 0.0019);
    o.label('ENG ANTI-ICE', 0.024, 0.008, 0.0016);
    o.label('ENG ANTI-ICE', 0.122, 0.008, 0.0016);
    for (const i of [1, 2] as const) {
      const x = i === 1 ? 0.022 : 0.124;
      o.annun(id(`cowl_ai${i}`), `COWL ANTI-ICE ${i}`, [seg.on(['COWL', 'ANTI-ICE'], 'amber', L.cowlAi(i))], x, 0.028, 0.024, 0.012);
      o.annun(id(`cowl_valve${i}`), `COWL VALVE OPEN ${i}`, [seg.any(['COWL VALVE', 'OPEN'], 'blue', L.cowlValve(i))], x, 0.046, 0.024, 0.012);
      o.toggle({ id: id(`eng${i}`), label: `ENG ${i} ANTI-ICE`, var: B738.engAi(i), ...OFF_ON }, x, 0.09, `ENG ${i}`, 0.75);
      o.annun(id(`wing_valve${i}`), `WING ANTI-ICE ${i === 1 ? 'L' : 'R'} VALVE OPEN`, [seg.any([i === 1 ? 'L VALVE' : 'R VALVE', 'OPEN'], 'blue', L.wingAiValve(i))], i === 1 ? 0.059 : 0.087, 0.037, 0.024, 0.012);
    }
    o.toggle({ id: id('wing'), label: 'WING ANTI-ICE', var: B738.wingAi, ...OFF_ON }, 0.073, 0.09, 'WING', 0.75);
    o.line(0.012, 0.15, 0.134, 0.15);
    o.label('ANTI-ICE', 0.073, 0.158, 0.0022);
  }
  {
    const o = c4('hyd', 0.168);
    const id = (s: string) => `b738.ovhd.hyd.${s}`;
    o.label('HYDRAULIC PUMPS', 0.073, 0.008, 0.0022);
    o.bracket('A', 0.039, 0.02, 0.058, 0.002);
    o.bracket('B', 0.107, 0.02, 0.058, 0.002);
    const H: [HydPumpSw, string][] = [
      ['eng1', 'ENG 1'],
      ['elec2', 'ELEC 2'],
      ['elec1', 'ELEC 1'],
      ['eng2', 'ENG 2'],
    ];
    H.forEach(([p, name], k) => {
      const x = 0.022 + k * 0.034;
      if (p === 'elec1' || p === 'elec2') o.annun(id(`ovht_${p}`), `HYD ${name} OVERHEAT`, [seg.on('OVERHEAT', 'amber', L.hydOverheat(p))], x, 0.042, 0.024, 0.011);
      o.annun(id(`lp_${p}`), `HYD ${name} LOW PRESSURE`, [seg.on(['LOW', 'PRESSURE'], 'amber', L.hydLowPress(p))], x, 0.06, 0.024, 0.012);
      o.toggle({ id: id(p), label: `HYD PUMP ${name}`, var: B738.hydPump(p), ...OFF_ON }, x, 0.1, false, 0.75);
      o.label(name, x, 0.128, 0.0018);
    });
  }

  // ============================================================== column 5: AIR CONDITIONING, BLEED
  const c5 = stack(4);
  {
    const o = c5('aircond', 0.235);
    const id = (s: string) => `b738.ovhd.ac.${s}`;
    o.label('AIR CONDITIONING', 0.073, 0.008, 0.0022);
    dial(
      o,
      () => new ScaleDial({
        id: 'b738_zone_temp',
        vars,
        powerVar: 'elec.dc1_powered',
        scales: [{ angle: lin(0, 100, -130, 130), ticks: ticks(0, 100, 10, 20) }],
        needles: [{ var: L.zoneTempC }],
        title: ['TEMP', '°C'],
        titleY: 168,
      }),
      0.034,
      0.04,
      0.036,
    );
    o.selector(
      id('temp_src'),
      'TEMPERATURE SOURCE SELECTOR',
      B738.tempSrcSel,
      [
        ['CONT CAB', 'CONT\nCAB'],
        ['FWD DUCT', 'FWD\nDUCT'],
        ['AFT DUCT', 'AFT\nDUCT'],
        ['FWD PASS CAB', 'FWD\nCAB'],
        ['AFT PASS CAB', 'AFT\nCAB'],
        ['L PACK', 'L\nPACK'],
        ['R PACK', 'R\nPACK'],
      ].map(([l, d], i) => ({ value: i, label: l, display: d, angle: -120 + i * 40 })),
      0.106,
      0.044,
      { diameter: 0.011, labelHeight: 0.0013, labelRadius: 0.0135 },
    );
    o.button({ id: id('ovht_test'), label: 'AIR COND OVHT TEST', mode: 'momentary', var: B738.ovhtTest, engraved: 'OVHT TEST', engravedHeight: 0.0011, width: 0.008 }, 0.134, 0.075);
    const Z: [1 | 2 | 3, 'cont' | 'fwd' | 'aft', string][] = [
      [1, 'cont', 'CONT CAB'],
      [2, 'fwd', 'FWD CAB'],
      [3, 'aft', 'AFT CAB'],
    ];
    for (const [z, zone, name] of Z) {
      const x = 0.028 + (z - 1) * 0.045;
      o.annun(id(`zone_temp${z}`), `${name} ZONE TEMP`, [seg.on(['ZONE', 'TEMP'], 'amber', L.zoneTemp(z))], x, 0.094, 0.022, 0.012);
      o.knob(id(`temp_${zone}`), `${name} TEMPERATURE`, B738.tempSel(zone), x, 0.13, {
        diameter: 0.014,
        initial: 0.5,
        range: [-150, 150],
        format: (v) => (v < 0.03 ? 'OFF' : `AUTO ${(18 + 12 * v).toFixed(1)} °C`),
      });
      o.label('OFF   C   W', x, 0.149, 0.0014);
      o.label(name, x, 0.157, 0.0017);
    }
    o.label('AUTO', 0.073, 0.112, 0.0015);
    o.toggle({ id: id('recirc1'), label: 'L RECIRC FAN', var: B738.recircFan(1), positions: ['OFF', 'AUTO'], values: [0, 1], initial: 1 }, 0.028, 0.2, 'L RECIRC FAN', 0.7);
    o.toggle({ id: id('trim_air'), label: 'TRIM AIR', var: B738.trimAir, ...OFF_ON, initial: 1 }, 0.073, 0.2, 'TRIM AIR', 0.7);
    o.toggle({ id: id('recirc2'), label: 'R RECIRC FAN', var: B738.recircFan(2), positions: ['OFF', 'AUTO'], values: [0, 1], initial: 1 }, 0.118, 0.2, 'R RECIRC FAN', 0.7);
  }
  {
    const o = c5('bleed', 0.278);
    const id = (s: string) => `b738.ovhd.bleed.${s}`;
    dial(
      o,
      () => new ScaleDial({
        id: 'b738_duct_press',
        vars,
        powerVar: 'elec.dc1_powered',
        scales: [{ angle: lin(0, 80, -130, 130), ticks: ticks(0, 80, 10, 20) }],
        needles: [
          { var: L.ductPress(1), tag: 'L', width: 9 },
          { var: L.ductPress(2), tag: 'R', width: 9 },
        ],
        title: ['DUCT', 'PRESS'],
        titleY: 170,
      }),
      0.073,
      0.03,
      0.038,
    );
    o.annun(id('dual_bleed'), 'DUAL BLEED', [seg.on(['DUAL', 'BLEED'], 'amber', L.dualBleed)], 0.022, 0.022);
    for (const i of [1, 2] as const) {
      const x = i === 1 ? 0.024 : 0.122;
      const s = i === 1 ? 'L' : 'R';
      o.annun(id(`ram${i}`), `RAM DOOR FULL OPEN ${s}`, [seg.on(['RAM DOOR', 'FULL OPEN'], 'blue', L.ramDoorFullOpen(i))], x, i === 1 ? 0.044 : 0.03);
      o.annun(id(`pack${i}`), `PACK ${s}`, [seg.on('PACK', 'amber', L.packTrip(i))], x, 0.075);
      o.annun(id(`wbo${i}`), `WING-BODY OVERHEAT ${s}`, [seg.on(['WING-BODY', 'OVERHEAT'], 'amber', L.wingBodyOvht(i))], x, 0.091);
      o.annun(id(`bleed_trip${i}`), `BLEED TRIP OFF ${i}`, [seg.on(['BLEED', 'TRIP OFF'], 'amber', L.bleedTripOff(i))], x, 0.107);
      o.toggle({ id: id(`pack_sw${i}`), label: `${s} PACK`, var: B738.pack(i), positions: ['OFF', 'AUTO', 'HIGH'], values: [0, 1, 2], initial: 1 }, x, 0.15, `${s} PACK`, 0.75);
      o.toggle({ id: id(`bleed${i}`), label: `BLEED ${i}`, var: B738.bleed(i), ...OFF_ON, initial: 1 }, x, 0.222, String(i), 0.75);
    }
    o.button({ id: id('trip_reset'), label: 'TRIP RESET', mode: 'momentary', var: B738.tripReset, engraved: 'TRIP RESET', engravedHeight: 0.0012, width: 0.01 }, 0.073, 0.095);
    o.toggle({ id: id('iso'), label: 'ISOLATION VALVE', var: B738.isoValve, positions: ['CLOSE', 'AUTO', 'OPEN'], values: [0, 1, 2], initial: 1 }, 0.073, 0.15, 'ISOLATION VALVE', 0.75);
    o.toggle({ id: id('apu_bleed'), label: 'APU BLEED', var: B738.apuBleed, ...OFF_ON }, 0.073, 0.222, 'APU', 0.75);
    o.label('BLEED', 0.073, 0.258, 0.0022);
  }

  // ============================================================== column 6: CABIN ALTITUDE, PRESSURIZATION
  const c6 = stack(5);
  {
    const o = c6('cabin_alt', 0.2);
    const id = (s: string) => `b738.ovhd.cab.${s}`;
    dial(
      o,
      () => new ScaleDial({
        id: 'b738_cabin_alt',
        vars,
        powerVar: null,
        scales: [
          { angle: lin(0, 50, -150, 150), ticks: ticks(0, 50, 2, 10), radius: 118, labelRadius: 94, labelSize: 18 },
          { angle: lin(0, 10, -150, 150), ticks: ticks(0, 10, 1, 2), radius: 70, labelRadius: 52, labelSize: 14, bands: [{ from: 9.1, to: 10, color: '#d02020' }] },
        ],
        needles: [
          { var: 'ac.b738.ck.cab_alt_k', scale: 0, width: 8 },
          { var: L.cabinDiffPsi, scale: 1, width: 6, length: 64, color: '#e8e8e8' },
        ],
        title: ['CABIN ALT', 'DIFF PRESS'],
        titleY: 186,
      }),
      0.042,
      0.06,
      0.058,
    );
    dial(
      o,
      () => new ScaleDial({
        id: 'b738_cabin_rate',
        vars,
        powerVar: null,
        scales: [{ angle: (v) => -90 + Math.max(-4, Math.min(4, v)) * 40, ticks: ticks(-4, 4, 0.5, 1, (v) => String(Math.abs(v))) }],
        needles: [{ var: 'ac.b738.ck.cab_rate_k' }],
        title: ['CABIN CLIMB', '1000 FT/MIN'],
        titleY: 162,
      }),
      0.108,
      0.06,
      0.046,
    );
    o.button({ id: id('horn_cutout'), label: 'ALT HORN CUTOUT', mode: 'momentary', var: B738.altHornCutout, engraved: 'ALT HORN CUTOUT', engravedHeight: 0.0012, width: 0.012 }, 0.108, 0.13);
    o.label('CABIN ALTITUDE', 0.042, 0.13, 0.0019);
    o.label('ALT HORN', 0.108, 0.145, 0.0017);
    o.label('CUTOUT', 0.108, 0.15, 0.0017);
  }
  {
    const o = c6('press', 0.313);
    const id = (s: string) => `b738.ovhd.press.${s}`;
    o.annun(id('auto_fail'), 'AUTO FAIL', [seg.on(['AUTO', 'FAIL'], 'amber', L.autoFail)], 0.026, 0.02);
    o.annun(id('off_sched'), 'OFF SCHED DESCENT', [seg.on(['OFF SCHED', 'DESCENT'], 'amber', L.offSchedDescent)], 0.073, 0.02);
    o.annun(id('altn'), 'ALTN', [seg.on('ALTN', 'green', L.altn)], 0.12, 0.02);
    o.annun(id('manual'), 'MANUAL', [seg.on('MANUAL', 'green', L.manual)], 0.12, 0.036);
    // FLT ALT / LAND ALT windows (LCD) and knobs.
    const alt = (x: number, which: 'flt' | 'land') => {
      const v = which === 'flt' ? B738.fltAltFt : B738.landAltFt;
      lcd(o, `b738_${which}_alt_lcd`, which === 'flt' ? 'elec.press_auto_powered' : 'elec.press_auto_powered', [v], [{ text: () => String(Math.round(vars.get(v))), x: 160, size: 42 }], x, 0.066, 0.046, 0.013, 320);
      o.label(which === 'flt' ? 'FLT ALT' : 'LAND ALT', x, 0.054, 0.0019);
      o.p.add(
        new RotaryKnob(env, {
          id: id(`${which}_alt`),
          label: which === 'flt' ? 'FLT ALT' : 'LAND ALT',
          cap: 'knurled',
          diameter: 0.014,
          zone: 'ovhd',
          outer:
            which === 'flt'
              ? { var: v, min: -1000, max: 42000, step: 500, initial: 0, accel: { fastStep: 2000, slow: 6, fast: 14 }, label: 'FLT ALT', format: (x) => `${Math.round(x)} FT` }
              : { var: v, min: -1000, max: 14000, step: 50, initial: 0, accel: { fastStep: 500, slow: 6, fast: 14 }, label: 'LAND ALT', format: (x) => `${Math.round(x)} FT` },
        }),
        x,
        0.088,
      );
    };
    alt(0.042, 'flt');
    alt(0.104, 'land');
    dial(
      o,
      () => new ScaleDial({
        id: 'b738_outflow',
        vars,
        powerVar: null,
        scales: [{ angle: lin(0, 1, -70, 70), ticks: [{ v: 0, label: 'C' }, { v: 0.25, major: false }, { v: 0.5 }, { v: 0.75, major: false }, { v: 1, label: 'O' }], labelRadius: 76 }],
        needles: [{ var: 'press.outflow_pos' }],
        title: ['OUTFLOW', 'VALVE'],
        titleY: 160,
      }),
      0.036,
      0.16,
      0.034,
    );
    o.toggle({ id: id('outflow'), label: 'OUTFLOW VALVE', var: B738.outflowSw, positions: ['OPEN', '', 'CLOSE'], values: [1, 0, -1], initial: 1, springs: { 0: 1, 2: 1 } }, 0.036, 0.232, 'VALVE', 0.75);
    o.selector(id('mode'), 'PRESSURIZATION MODE SELECTOR', B738.pressMode, [{ value: 0, label: 'AUTO' }, { value: 1, label: 'ALTN' }, { value: 2, label: 'MAN' }], 0.106, 0.2, { diameter: 0.016, cap: 'bar', labelHeight: 0.0019 });
    o.line(0.012, 0.29, 0.134, 0.29);
    o.label('PRESSURIZATION', 0.073, 0.298, 0.0022);
  }

  // ============================================================== bottom row (next to the windshield)
  const row = (name: string, x0: number, w: number) => new Ovhd(env, module(root, `b738.ovhd.${name}`, x0 + w / 2, ROW_Y + ROW_H / 2, w, ROW_H));
  const wiper = (s: 1 | 2, x0: number) => {
    const o = row(`wiper${s}`, x0, 0.078);
    o.selector(
      `b738.ovhd.wiper${s}`,
      `WINDSHIELD WIPER ${s === 1 ? 'L' : 'R'}`,
      B738.wiper(s),
      [
        { value: 0, label: 'PARK', angle: -90 },
        { value: 1, label: 'INT', angle: -30 },
        { value: 2, label: 'LOW', angle: 30 },
        { value: 3, label: 'HIGH', angle: 90 },
      ],
      0.039,
      0.05,
      { diameter: 0.015, cap: 'bar', labelHeight: 0.0018 },
    );
    o.labels(['WINDSHIELD', `WIPER - ${s === 1 ? 'L' : 'R'}`], 0.039, 0.012, 0.0018);
  };
  let x = 0.031;
  wiper(1, x);
  x += 0.08;
  {
    const o = row('landing', x, 0.238);
    const id = (s: string) => `b738.ovhd.ext.${s}`;
    o.label('LANDING', 0.085, 0.01, 0.0021);
    o.bracket('RETRACTABLE', 0.043, 0.02, 0.05, 0.0017);
    o.bracket('FIXED', 0.113, 0.02, 0.05, 0.0017);
    for (const i of [1, 2] as const) {
      const s = i === 1 ? 'L' : 'R';
      o.toggle({ id: id(`retract${i}`), label: `RETRACTABLE LANDING ${s}`, var: B738.landingRetract(i), positions: ['RETRACT', 'EXTEND', 'ON'], values: [0, 1, 2], initial: 0 }, 0.03 + (i - 1) * 0.027, 0.058, s, 0.75);
      o.toggle({ id: id(`fixed${i}`), label: `FIXED LANDING ${s}`, var: B738.landingFixed(i), ...OFF_ON }, 0.1 + (i - 1) * 0.027, 0.058, s, 0.75);
      o.toggle({ id: id(`turnoff${i}`), label: `RUNWAY TURNOFF ${s}`, var: B738.turnoff(i), ...OFF_ON }, 0.162 + (i - 1) * 0.027, 0.058, s, 0.75);
    }
    o.labels(['RUNWAY', 'TURNOFF'], 0.1755, 0.01, 0.0017);
    o.toggle({ id: id('taxi'), label: 'TAXI', var: B738.taxiLt, ...OFF_ON }, 0.218, 0.058, 'TAXI', 0.75);
  }
  x += 0.24;
  {
    const o = row('apu', x, 0.1);
    const id = (s: string) => `b738.ovhd.apu.${s}`;
    dial(
      o,
      () => new ScaleDial({
        id: 'b738_apu_egt',
        vars,
        powerVar: 'elec.apu_ecu_powered',
        scales: [{ angle: lin(0, 1200, -135, 135), ticks: ticks(0, 1200, 100, 200, (v) => String(v / 100)), bands: [{ from: 1038, to: 1200, color: '#d02020' }] }],
        needles: [{ var: L.apuEgtC }],
        title: ['APU EGT', '°C x 100'],
        titleY: 168,
      }),
      0.028,
      0.032,
      0.03,
    );
    o.annun(id('maint'), 'APU MAINT', [seg.on('MAINT', 'blue', L.apuMaint)], 0.077, 0.015, 0.026, 0.01);
    o.annun(id('low_oil'), 'APU LOW OIL PRESSURE', [seg.on(['LOW OIL', 'PRESSURE'], 'amber', L.apuLowOil)], 0.077, 0.029, 0.026, 0.012);
    o.annun(id('fault'), 'APU FAULT', [seg.on('FAULT', 'amber', L.apuFault)], 0.077, 0.044, 0.026, 0.01);
    o.annun(id('overspeed'), 'APU OVERSPEED', [seg.on('OVERSPEED', 'amber', L.apuOverspeed)], 0.077, 0.057, 0.026, 0.01);
    o.selector(id('sw'), 'APU', B738.apuSw, [{ value: APU_SW.off, label: 'OFF', angle: -45 }, { value: APU_SW.on, label: 'ON', angle: 0 }, { value: APU_SW.start, label: 'START', angle: 45, spring: APU_SW.on }], 0.04, 0.076, { diameter: 0.014, cap: 'bar', labelHeight: 0.0017 });
    o.label('APU', 0.077, 0.08, 0.0022);
  }
  x += 0.102;
  {
    const o = row('eng_start', x, 0.19);
    const id = (s: string) => `b738.ovhd.start.${s}`;
    o.label('ENGINE START', 0.095, 0.008, 0.0021);
    for (const i of [1, 2] as const) {
      const cx = i === 1 ? 0.04 : 0.15;
      o.annun(id(`valve${i}`), `START VALVE OPEN ${i}`, [seg.on(['START VALVE', 'OPEN'], 'amber', L.engStartValve(i))], cx, 0.02, 0.028, 0.012);
      o.selector(
        id(`sw${i}`),
        `ENGINE START ${i}`,
        B738.engStart(i),
        [
          { value: ENG_START.grd, label: 'GRD', angle: -90 },
          { value: ENG_START.off, label: 'OFF', angle: -30 },
          { value: ENG_START.cont, label: 'CONT', angle: 30 },
          { value: ENG_START.flt, label: 'FLT', angle: 90 },
        ],
        cx,
        0.062,
        { diameter: 0.019, cap: 'bar', labelHeight: 0.0019, initial: 1 },
      );
      o.label(String(i), cx, 0.088, 0.0024);
    }
    o.toggle({ id: id('ign'), label: 'IGNITION SELECT', var: B738.ignSel, positions: ['IGN L', 'BOTH', 'IGN R'], values: [-1, 0, 1], initial: 0, orientation: 'horizontal' }, 0.095, 0.062, false, 0.75);
    o.label('IGNITION', 0.095, 0.042, 0.0017);
  }
  x += 0.192;
  {
    const o = row('ext_lts', x, 0.2);
    const id = (s: string) => `b738.ovhd.ext.${s}`;
    const items: [string, string, string, Partial<Parameters<Ovhd['toggle']>[0]>][] = [
      ['logo', 'LOGO', B738.logoLt, OFF_ON],
      ['position', 'POSITION', B738.positionLt, { positions: ['STEADY', 'OFF', 'STROBE & STEADY'], values: [-1, 0, 1], initial: 1 }],
      ['anti_coll', 'ANTI COLLISION', B738.antiColl, OFF_ON],
      ['wing', 'WING', B738.wingLt, OFF_ON],
      ['wheel_well', 'WHEEL WELL', B738.wheelWellLt, OFF_ON],
    ];
    items.forEach(([k, name, v, pos], i) => {
      const xx = 0.022 + i * 0.039;
      o.toggle({ id: id(k), label: name, var: v, ...(pos as object) }, xx, 0.058, false, 0.75);
      o.labels(name.split(' '), xx, 0.014, 0.0017);
    });
  }
  x += 0.202;
  wiper(2, x);
}

