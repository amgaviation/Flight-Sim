/**
 * 737-800 forward overhead panel (P5 forward), laid out as on the SCBG 1:1
 * overhead drawing (cm ruler, 2,830 px/m; every coordinate below is measured
 * on it in metres from the panel's top-left corner, top = aft, bottom =
 * forward next to the windshield). 0.66 x 0.66 m: four 146 mm columns and a
 * 74 mm centre column (dossier §10.1-10.10):
 *
 *   col 1 (146)        col 2 (146)          col 3 (74)        col 4 (146)             col 5 (146)
 *   FLIGHT CONTROL     ELECTRICAL (meters,  CIRCUIT BREAKER / WINDOW HEAT + PROBE    AIR CONDITIONING
 *                       lights, selectors,   PANEL dimmers     HEAT                    BLEED (recirc fans,
 *   NAVIGATION /        BAT, CAB/UTIL, IFE)  EQUIP COOLING     ANTI-ICE                 duct press, packs,
 *   DISPLAYS           STANDBY POWER        EMER EXIT LIGHTS  HYDRAULIC PUMPS          isolation, bleeds)
 *   FUEL               GRD PWR              NO SMOKING /      DOORS                    PRESSURIZATION
 *                      BUS TRANSFER / GEN    FASTEN BELTS      COCKPIT VOICE RECORDER
 *                      APU EGT + lights,    ATTEND / GRD CALL CABIN ALT / DIFF PRESS,
 *                       L WIPER             R WIPER            CABIN CLIMB, ALT HORN CUTOUT
 *   bottom row: LANDING (RETRACTABLE, FIXED), RUNWAY TURNOFF, TAXI | APU | ENGINE START 1, IGNITION,
 *               ENGINE START 2 | LOGO, POSITION, ANTI COLLISION, WING, WHEEL WELL; INDEX TO LOCK latches.
 *
 * Every control writes the var of docs/aircraft/b737-800.md §10 (vars.ts);
 * every light shows a var the systems drive (systems/cas.ts, logic.ts).
 * SCOPE: blue valve lights show one brightness for "open" and "in transit"
 * (the systems publish 1 dim / 2 bright; the lens lights for either). The
 * DOME WHITE switch is on the aft overhead (aft.ts). The yaw damper
 * indicator is on the MIP standby column (mainPanel.ts, as on the SCBG
 * drawing and the NG centre panel; the overhead FLIGHT CONTROL module keeps
 * only the YAW DAMPER switch and light, FCOM 9.10). START VALVE OPEN is
 * shown on the upper DU engine display only (NG), not as an overhead light.
 */
import { RotaryKnob } from '../../../../cockpit/controls';
import { addTransferSwitches } from '../../../../avionics/boeing-737';
import { placeOnPanel } from '../../../../cockpit/frame';
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import { B738, APU_SW, ENG_START, type Door, type FuelPump, type HydPumpSw, type WindowHeat } from '../../vars';
import type { B738CockpitContext } from '../context';
import { seg } from '../context';
import { LcdDisplay } from '../displays';
import { OFF_ON, Ovhd, SPRING_OFF_ON, indexLock, moduleAbs } from './parts';
import { ScaleDial, lin, ticks } from './gauges';

/** Forward overhead: panel width / height (MOUNTS.overheadFwd), SCBG drawing. */
export const FWD = { w: 0.66, h: 0.66 } as const;

export function buildForwardOverhead(c: B738CockpitContext, root: Panel): void {
  const { env, ctx } = c;
  const vars = ctx.vars;
  const M = (name: string, x0: number, y0: number, x1: number, y1: number) => moduleAbs(env, root, `b738.ovhd.${name}`, x0, y0, x1, y1);
  const dial = (o: Ovhd, mk: () => ScaleDial, x: number, y: number, size: number) => {
    if (c.headless) return;
    const d = mk();
    o.p.roundInstrument(d, o.X(x), o.Y(y), size, { flange: true });
    c.onDispose(() => d.dispose());
  };
  const lcd = (o: Ovhd, id: string, power: string, watch: string[], fields: ConstructorParameters<typeof LcdDisplay>[4], x: number, y: number, w: number, h: number, width = 320, height = 64) => {
    if (c.headless) return;
    const d = new LcdDisplay(vars, id, power, watch, fields, width, undefined, height);
    // Border >= 4 mm: the library bezel has an 8 mm outer corner radius; a thinner frame around these short
    // windows makes the extruded hole touch the outer contour and the triangulation fills the window.
    o.p.display(d, o.X(x), o.Y(y), w, h, { bezel: { border: 0.004, depth: 0.003 } });
    c.onDispose(() => d.dispose());
  };
  const L = B738.lt;

  // ============================================================== column 1 (x 0 .. 0.145)
  {
    const o = M('fltctl', 0.001, 0.035, 0.145, 0.245);
    const id = (s: string) => `b738.ovhd.fltctl.${s}`;
    o.label('FLT CONTROL', 0.047, 0.042, 0.002);
    for (const [k, sys] of [
      [0, 'a'],
      [1, 'b'],
    ] as const) {
      const x = 0.03 + k * 0.035;
      o.label(sys.toUpperCase(), x, 0.05, 0.0019);
      o.guarded({ id: id(`fltctl_${sys}`), label: `FLT CONTROL ${sys.toUpperCase()}`, var: B738.fltCtl(sys), positions: ['STBY RUD', 'OFF', 'ON'], values: [-1, 0, 1], initial: 2, guard: { color: 'red', guardedPosition: 2 } }, x, 0.075, false, 0.75);
      o.annun(id(`low_press_${sys}`), `FLT CONTROL ${sys.toUpperCase()} LOW PRESSURE`, [seg.on(['LOW', 'PRESSURE'], 'amber', L.fltCtlLowPress(sys))], x, 0.115, 0.024, 0.011);
      const xs = 0.035 + k * 0.024;
      o.label(sys.toUpperCase(), xs, 0.14, 0.0017);
      o.guarded({ id: id(`spoiler_${sys}`), label: `SPOILER ${sys.toUpperCase()}`, var: B738.spoilerSw(sys), positions: ['OFF', 'ON'], values: [0, 1], initial: 1, guard: { color: 'red', guardedPosition: 1 } }, xs, 0.165, false, 0.65);
    }
    o.label('SPOILER', 0.047, 0.131, 0.0019);
    // Standby hydraulics.
    o.labels(['STANDBY', 'HYD'], 0.11, 0.041, 0.0017);
    o.annun(id('stby_low_qty'), 'STBY HYD LOW QUANTITY', [seg.on(['LOW', 'QUANTITY'], 'amber', L.stbyLowQty)], 0.11, 0.058);
    o.annun(id('stby_low_press'), 'STBY HYD LOW PRESSURE', [seg.on(['LOW', 'PRESSURE'], 'amber', L.stbyLowPress)], 0.11, 0.071);
    o.annun(id('stby_rud_on'), 'STBY RUD ON', [seg.on(['STBY', 'RUD ON'], 'amber', L.stbyRudOn)], 0.11, 0.232);
    // Alternate flaps.
    o.label('ALTERNATE FLAPS', 0.11, 0.087, 0.0017);
    o.guarded({ id: id('alt_flaps_arm'), label: 'ALTERNATE FLAPS MASTER', var: B738.altFlapsArm, positions: ['OFF', 'ARM'], values: [0, 1], initial: 0, guard: { color: 'red', guardedPosition: 0 } }, 0.093, 0.112, false, 0.7);
    o.toggle({ id: id('alt_flaps_sw'), label: 'ALTERNATE FLAPS', var: B738.altFlapsSw, positions: ['DOWN', 'OFF', 'UP'], values: [1, 0, -1], initial: 1, springs: { 0: 1 } }, 0.124, 0.125, false, 0.65);
    // FEEL DIFF PRESS, SPEED TRIM FAIL, MACH TRIM FAIL, AUTO SLAT FAIL.
    o.annun(id('feel_diff'), 'FEEL DIFF PRESS', [seg.on(['FEEL DIFF', 'PRESS'], 'amber', L.feelDiffPress)], 0.105, 0.167, 0.024, 0.011);
    o.annun(id('speed_trim_fail'), 'SPEED TRIM FAIL', [seg.on(['SPEED TRIM', 'FAIL'], 'amber', L.speedTrimFail)], 0.105, 0.18, 0.024, 0.011);
    o.annun(id('mach_trim_fail'), 'MACH TRIM FAIL', [seg.on(['MACH TRIM', 'FAIL'], 'amber', L.machTrimFail)], 0.105, 0.193, 0.024, 0.011);
    o.annun(id('auto_slat_fail'), 'AUTO SLAT FAIL', [seg.on(['AUTO SLAT', 'FAIL'], 'amber', L.autoSlatFail)], 0.105, 0.206, 0.024, 0.011);
    // Yaw damper: light and the solenoid-held switch only; the indicator is on the MIP (mainPanel.ts, FCOM 9.10).
    o.label('YAW DAMPER', 0.045, 0.195, 0.0018);
    o.annun(id('yaw_damper'), 'YAW DAMPER', [seg.on(['YAW', 'DAMPER'], 'amber', L.yawDamper)], 0.045, 0.207, 0.024, 0.011);
    o.toggle({ id: id('yd_sw'), label: 'YAW DAMPER', var: B738.ydSw, ...OFF_ON }, 0.043, 0.228, false, 0.65);
  }
  {
    const o = M('navdisp', 0.001, 0.247, 0.145, 0.35);
    o.label('NAVIGATION', 0.07, 0.256, 0.002);
    const xs = addTransferSwitches(c.b, o.p, o.X(0.025), o.Y(0.278), 0.047);
    o.label('DISPLAYS', 0.07, 0.301, 0.002);
    // Second row: DISPLAYS SOURCE / CONTROL PANEL (SCBG drawing).
    const [u3, v3] = o.p.uv(o.X(0.04), o.Y(0.327));
    placeOnPanel(xs[3].object, u3, v3);
    const [u4, v4] = o.p.uv(o.X(0.105), o.Y(0.327));
    placeOnPanel(xs[4].object, u4, v4);
  }
  {
    const o = M('fuel', 0.001, 0.352, 0.145, 0.585);
    const id = (s: string) => `b738.ovhd.fuel.${s}`;
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
      0.072,
      0.379,
      0.045,
    );
    for (const i of [1, 2] as const) {
      const x = i === 1 ? 0.028 : 0.115;
      o.annun(id(`eng_valve${i}`), `ENG VALVE CLOSED ${i}`, [seg.any(['ENG VALVE', 'CLOSED'], 'blue', L.engValveClosed(i))], x, 0.366, 0.026, 0.011);
      o.annun(id(`spar_valve${i}`), `SPAR VALVE CLOSED ${i}`, [seg.any(['SPAR VALVE', 'CLOSED'], 'blue', L.sparValveClosed(i))], x, 0.379, 0.026, 0.011);
      o.annun(id(`filter_bypass${i}`), `FILTER BYPASS ${i}`, [seg.on(['FILTER', 'BYPASS'], 'amber', L.filterBypass(i))], x, 0.42, 0.024, 0.011);
    }
    o.annun(id('xfeed_open'), 'CROSSFEED VALVE OPEN', [seg.any(['VALVE', 'OPEN'], 'blue', L.xfeedValveOpen)], 0.072, 0.418, 0.024, 0.011);
    o.selector(id('crossfeed'), 'CROSSFEED', B738.crossfeed, [{ value: 0, label: 'CLOSED', angle: -45 }, { value: 1, label: 'OPEN', angle: 45 }], 0.072, 0.442, { cap: 'bar', diameter: 0.02 });
    o.label('CROSS', 0.042, 0.435, 0.0019);
    o.label('FEED', 0.103, 0.435, 0.0019);
    const pump = (p: FuelPump, name: string, x: number, yl: number, ys: number) => {
      o.annun(id(`lp_${p}`), `FUEL PUMP ${name} LOW PRESSURE`, [seg.on(['LOW', 'PRESSURE'], 'amber', L.fuelLowPress(p))], x, yl, 0.023, 0.011);
      o.toggle({ id: id(`pump_${p}`), label: `FUEL PUMP ${name}`, var: B738.fuelPump(p), ...OFF_ON }, x, ys, false, 0.65);
    };
    o.label('FUEL PUMPS', 0.072, 0.475, 0.0019);
    pump('c_l', 'CTR L', 0.058, 0.463, 0.491);
    pump('c_r', 'CTR R', 0.086, 0.463, 0.491);
    o.label('CTR', 0.072, 0.507, 0.0017);
    pump('l_aft', 'L AFT', 0.022, 0.516, 0.545);
    pump('l_fwd', 'L FWD', 0.048, 0.516, 0.545);
    pump('r_fwd', 'R FWD', 0.094, 0.516, 0.545);
    pump('r_aft', 'R AFT', 0.121, 0.516, 0.545);
    o.label('AFT     FWD', 0.035, 0.529, 0.0016);
    o.label('FWD     AFT', 0.108, 0.529, 0.0016);
    o.label('1', 0.035, 0.568, 0.002);
    o.label('2', 0.108, 0.568, 0.002);
  }

  // ============================================================== column 2 (x 0.147 .. 0.293): ELECTRICAL
  {
    const o = M('elec1', 0.147, 0.055, 0.293, 0.25);
    const id = (s: string) => `b738.ovhd.elec.${s}`;
    // One wide meter display (SCBG: ~0.1 x 0.05 m): upper row DC AMPS | CPS FREQ, lower row DC VOLTS | AC AMPS | AC VOLTS.
    o.label('DC AMPS', 0.19, 0.065, 0.0017);
    o.label('CPS FREQ', 0.242, 0.065, 0.0017);
    const f0 = (x: number) => x.toFixed(0);
    lcd(
      o,
      'b738_elec_meters_lcd',
      'elec.batt_bus_powered',
      [L.dcVolts, L.dcAmps, L.acVolts, L.acAmps, L.acHz],
      [
        // Green LED numerals (b737.org.uk NG overhead photographs: the DC/AC meter digits read green day and night).
        { text: () => f0(vars.get(L.dcAmps)), x: 100, y: 50, size: 56, color: '#40d040' },
        { text: () => f0(vars.get(L.acHz)), x: 300, y: 50, size: 56, color: '#40d040' },
        { text: () => f0(vars.get(L.dcVolts)), x: 70, y: 132, size: 56, color: '#40d040' },
        { text: () => f0(vars.get(L.acAmps)), x: 200, y: 132, size: 56, color: '#40d040' },
        { text: () => f0(vars.get(L.acVolts)), x: 330, y: 132, size: 56, color: '#40d040' },
      ],
      0.216,
      0.095,
      0.098,
      0.042,
      400,
      180,
    );
    o.label('DC VOLTS / AC AMPS / AC VOLTS', 0.216, 0.125, 0.0015);
    o.annun(id('bat_discharge'), 'BAT DISCHARGE', [seg.on(['BAT', 'DISCHARGE'], 'amber', L.batDischarge)], 0.176, 0.145, 0.023, 0.011);
    o.annun(id('tr_unit'), 'TR UNIT', [seg.on(['TR', 'UNIT'], 'amber', L.trUnit)], 0.201, 0.145, 0.023, 0.011);
    o.annun(id('elec_lt'), 'ELEC', [seg.on('ELEC', 'amber', L.elec)], 0.226, 0.145, 0.023, 0.011);
    o.button({ id: id('maint'), label: 'ELEC MAINT', mode: 'momentary', var: B738.elecMaint, width: 0.008 }, 0.254, 0.145);
    o.label('MAINT', 0.254, 0.155, 0.0015);
    o.selector(
      id('dc_meter'),
      'DC METERS',
      B738.dcMeterSel,
      // Real rotary order STBY PWR, BAT BUS, BAT, AUX BAT, TR1, TR2, TR3, TEST (b737.org.uk Electrics; aircraft
      // with the auxiliary battery). AUX BAT is the appended var value 7 placed in its real position.
      (
        [
          ['STBY PWR', 0],
          ['BAT BUS', 1],
          ['BAT', 2],
          ['AUX BAT', 7],
          ['TR1', 3],
          ['TR2', 4],
          ['TR3', 5],
          ['TEST', 6],
        ] as const
      ).map(([l, value], i) => ({ value, label: l, angle: -140 + i * 40 })),
      0.185,
      0.183,
      { diameter: 0.013, labelHeight: 0.0013, labelRadius: 0.0125 },
    );
    o.selector(
      id('ac_meter'),
      'AC METERS',
      B738.acMeterSel,
      ['STBY PWR', 'GRD PWR', 'GEN 1', 'APU GEN', 'GEN 2', 'INV', 'TEST'].map((l, i) => ({ value: i, label: l, angle: -135 + i * 45 })),
      0.25,
      0.183,
      { diameter: 0.013, labelHeight: 0.0013, labelRadius: 0.0125 },
    );
    o.line(0.218, 0.165, 0.218, 0.242);
    o.guarded({ id: id('bat'), label: 'BAT', var: B738.batSw, positions: ['OFF', 'ON'], values: [0, 1], initial: 1, guard: { color: 'black', guardedPosition: 1 } }, 0.185, 0.225, 'BAT', 0.7);
    // SCOPE: later NG CAB/UTIL and IFE/PASS SEAT switches in place of the drawing's single GALLEY switch.
    o.toggle({ id: id('cab_util'), label: 'CAB/UTIL', var: B738.cabUtilSw, ...OFF_ON, initial: 1 }, 0.235, 0.225, 'CAB/UTIL', 0.6);
    o.toggle({ id: id('ife'), label: 'IFE/PASS SEAT', var: B738.ifeSw, ...OFF_ON, initial: 1 }, 0.268, 0.225, 'IFE/PASS SEAT', 0.6);
    o.label('DC', 0.185, 0.245, 0.0017);
    o.label('AC', 0.25, 0.245, 0.0017);
  }
  {
    const o = M('stby_pwr', 0.147, 0.252, 0.293, 0.345);
    const id = (s: string) => `b738.ovhd.elec.${s}`;
    for (const i of [1, 2] as const) {
      const x = i === 1 ? 0.175 : 0.265;
      o.label(String(i), x, 0.263, 0.002);
      o.annun(id(`drive${i}`), `DRIVE ${i}`, [seg.on('DRIVE', 'amber', L.drive(i))], x, 0.277, 0.022, 0.01);
      o.label('DISCONNECT', x, 0.29, 0.0016);
      o.guarded({ id: id(`drive_disc${i}`), label: `GENERATOR DRIVE DISCONNECT ${i}`, var: B738.driveDisc(i), positions: ['NORMAL', 'DISCONNECT'], values: [0, 1], initial: 0, springs: { 1: 0 }, guard: { color: 'red', guardedPosition: 0 } }, x, 0.318, false, 0.65);
    }
    o.annun(id('stby_pwr_off'), 'STANDBY PWR OFF', [seg.on(['STANDBY', 'PWR OFF'], 'amber', L.stbyPwrOff)], 0.22, 0.264, 0.024, 0.011);
    o.label('STANDBY POWER', 0.22, 0.281, 0.0017);
    o.guarded({ id: id('stby_pwr'), label: 'STANDBY POWER', var: B738.stbyPwrSw, positions: ['BAT', 'OFF', 'AUTO'], values: [-1, 0, 1], initial: 2, orientation: 'horizontal', guard: { color: 'black', guardedPosition: 2 } }, 0.22, 0.302, false, 0.65);
    o.label('BAT    OFF    AUTO', 0.22, 0.318, 0.0015);
  }
  {
    const o = M('grd_pwr', 0.147, 0.347, 0.293, 0.402);
    const id = (s: string) => `b738.ovhd.elec.${s}`;
    o.annun(id('grd_pwr_avail'), 'GRD POWER AVAILABLE', [seg.on(['GRD POWER', 'AVAILABLE'], 'blue', L.grdPwrAvail)], 0.216, 0.36, 0.026, 0.011);
    o.toggle({ id: id('grd_pwr'), label: 'GRD PWR', var: B738.grdPwrSw, ...SPRING_OFF_ON }, 0.216, 0.385, 'GRD PWR', 0.65);
  }
  {
    const o = M('elec2', 0.147, 0.404, 0.293, 0.505);
    const id = (s: string) => `b738.ovhd.elec.${s}`;
    for (const i of [1, 2] as const) {
      const x = i === 1 ? 0.17 : 0.262;
      o.annun(id(`xfr_bus_off${i}`), `TRANSFER BUS ${i} OFF`, [seg.on(['TRANSFER', 'BUS OFF'], 'amber', L.xfrBusOff(i))], x, 0.422, 0.024, 0.011);
      o.annun(id(`source_off${i}`), `SOURCE OFF ${i}`, [seg.on(['SOURCE', 'OFF'], 'amber', L.sourceOff(i))], x, 0.435, 0.024, 0.011);
      o.annun(id(`gen_off_bus${i}`), `GEN OFF BUS ${i}`, [seg.on(['GEN OFF', 'BUS'], 'blue', L.genOffBus(i))], x, 0.448, 0.024, 0.011);
    }
    o.label('BUS TRANSFER', 0.216, 0.412, 0.0018);
    o.guarded({ id: id('bus_xfer'), label: 'BUS TRANSFER', var: B738.busXferSw, positions: ['OFF', 'AUTO'], values: [0, 1], initial: 1, orientation: 'horizontal', guard: { color: 'black', guardedPosition: 1 } }, 0.216, 0.427, false, 0.6);
    o.annun(id('apu_gen_off_bus'), 'APU GEN OFF BUS', [seg.on(['APU GEN', 'OFF BUS'], 'blue', L.apuGenOffBus)], 0.216, 0.45, 0.026, 0.011);
    o.toggle({ id: id('gen1'), label: 'GEN 1', var: B738.genSw(1), ...SPRING_OFF_ON }, 0.17, 0.477, false, 0.6);
    o.toggle({ id: id('apu_gen1'), label: 'APU GEN 1', var: B738.apuGenSw(1), ...SPRING_OFF_ON }, 0.197, 0.477, false, 0.6);
    o.toggle({ id: id('apu_gen2'), label: 'APU GEN 2', var: B738.apuGenSw(2), ...SPRING_OFF_ON }, 0.235, 0.477, false, 0.6);
    o.toggle({ id: id('gen2'), label: 'GEN 2', var: B738.genSw(2), ...SPRING_OFF_ON }, 0.262, 0.477, false, 0.6);
    o.label('GEN 1', 0.17, 0.497, 0.0017);
    o.label('APU GEN', 0.216, 0.497, 0.0017);
    o.label('GEN 2', 0.262, 0.497, 0.0017);
  }
  {
    // APU EGT and APU lights with the L WIPER selector (bottom of column 2).
    const o = M('apu', 0.147, 0.507, 0.293, 0.585);
    const id = (s: string) => `b738.ovhd.apu.${s}`;
    o.annun(id('maint'), 'APU MAINT', [seg.on('MAINT', 'blue', L.apuMaint)], 0.172, 0.515, 0.022, 0.01);
    o.annun(id('low_oil'), 'APU LOW OIL PRESSURE', [seg.on(['LOW OIL', 'PRESSURE'], 'amber', L.apuLowOil)], 0.196, 0.515, 0.023, 0.01);
    o.annun(id('fault'), 'APU FAULT', [seg.on('FAULT', 'amber', L.apuFault)], 0.221, 0.515, 0.022, 0.01);
    o.annun(id('overspeed'), 'APU OVERSPEED', [seg.on(['OVER', 'SPEED'], 'amber', L.apuOverspeed)], 0.246, 0.515, 0.022, 0.01);
    dial(
      o,
      () => new ScaleDial({
        id: 'b738_apu_egt',
        vars,
        powerVar: 'elec.apu_ecu_powered',
        scales: [{ angle: lin(0, 1200, -135, 135), ticks: ticks(0, 1200, 100, 200, (v) => String(v / 100)), bands: [{ from: 1038, to: 1200, color: '#d02020' }] }],
        needles: [{ var: L.apuEgtC }],
        title: ['EGT', '°C x 100'],
        titleY: 168,
      }),
      0.19,
      0.553,
      0.042,
    );
    o.label('APU', 0.19, 0.58, 0.0018);
    wiperSel(o, 1, 0.258, 0.555);
  }

  // ============================================================== column 3 (narrow, x 0.295 .. 0.363)
  {
    const o = M('lights', 0.295, 0.001, 0.363, 0.235);
    const id = (s: string) => `b738.ovhd.lt.${s}`;
    o.label('CIRCUIT BREAKER', 0.329, 0.1, 0.0017);
    o.knob(id('cb'), 'CIRCUIT BREAKER LIGHTS', B738.cbPanelLt, 0.328, 0.126, { initial: 0.5, diameter: 0.02 });
    o.label('BRIGHT', 0.328, 0.109, 0.0015);
    o.label('OFF', 0.311, 0.139, 0.0015);
    o.label('PANEL', 0.328, 0.154, 0.0019);
    o.knob(id('panel'), 'OVERHEAD PANEL LIGHTS', B738.ovhdPanelLt, 0.328, 0.18, { initial: 0.5, diameter: 0.02 });
    o.label('BRIGHT', 0.328, 0.163, 0.0015);
    o.label('OFF', 0.311, 0.193, 0.0015);
  }
  {
    const o = M('equip_cool', 0.295, 0.237, 0.363, 0.31);
    const id = (s: string) => `b738.ovhd.equip.${s}`;
    o.label('EQUIP COOLING', 0.329, 0.246, 0.0017);
    o.toggle({ id: id('supply'), label: 'EQUIP COOLING SUPPLY', var: B738.equipCoolSupply, positions: ['ALTN', 'NORM'], values: [1, 0], initial: 1 }, 0.311, 0.273, 'SUPPLY', 0.55);
    o.toggle({ id: id('exhaust'), label: 'EQUIP COOLING EXHAUST', var: B738.equipCoolExhaust, positions: ['ALTN', 'NORM'], values: [1, 0], initial: 1 }, 0.346, 0.273, 'EXHAUST', 0.55);
    o.annun(id('supply_off'), 'EQUIP COOLING SUPPLY OFF', [seg.on('OFF', 'amber', L.equipCoolOff('supply'))], 0.311, 0.3, 0.022, 0.009);
    o.annun(id('exhaust_off'), 'EQUIP COOLING EXHAUST OFF', [seg.on('OFF', 'amber', L.equipCoolOff('exhaust'))], 0.342, 0.3, 0.022, 0.009);
  }
  {
    const o = M('emer_exit', 0.295, 0.312, 0.363, 0.375);
    const id = (s: string) => `b738.ovhd.emer.${s}`;
    o.label('EMER EXIT LIGHTS', 0.329, 0.318, 0.0016);
    o.guarded({ id: id('exit_lts'), label: 'EMERGENCY EXIT LIGHTS', var: B738.emerExitLt, positions: ['ON', 'ARMED', 'OFF'], values: [2, 1, 0], initial: 1, guard: { color: 'red', guardedPosition: 1 } }, 0.332, 0.348, false, 0.6);
    o.annun(id('not_armed'), 'EMERGENCY EXIT LIGHTS NOT ARMED', [seg.on(['NOT', 'ARMED'], 'amber', L.emerExitNotArmed)], 0.306, 0.352, 0.011, 0.024);
  }
  {
    const o = M('signs', 0.295, 0.377, 0.363, 0.425);
    const id = (s: string) => `b738.ovhd.signs.${s}`;
    o.toggle({ id: id('no_smoking'), label: 'NO SMOKING', var: B738.noSmoking, positions: ['OFF', 'AUTO', 'ON'], values: [0, 1, 2], initial: 1 }, 0.31, 0.405, 'NO SMOKING', 0.55);
    o.toggle({ id: id('fasten_belts'), label: 'FASTEN BELTS', var: B738.fastenBelts, positions: ['OFF', 'AUTO', 'ON'], values: [0, 1, 2], initial: 1 }, 0.346, 0.405, 'FASTEN BELTS', 0.55);
  }
  {
    const o = M('call', 0.295, 0.427, 0.363, 0.49);
    const id = (s: string) => `b738.ovhd.call.${s}`;
    o.label('ATTEND', 0.308, 0.44, 0.0017);
    o.button({ id: id('attend'), label: 'ATTEND', mode: 'momentary', var: B738.attendCall, width: 0.01, capMaterial: 'plasticBlack' }, 0.308, 0.455);
    o.labels(['GRD', 'CALL'], 0.347, 0.436, 0.0016);
    o.button({ id: id('grd_call'), label: 'GRD CALL', mode: 'momentary', var: B738.grdCall, width: 0.01, capMaterial: 'plasticBlack' }, 0.346, 0.456);
    o.annun(id('call'), 'CALL', [seg.on('CALL', 'blue', L.callLt)], 0.312, 0.478, 0.022, 0.009);
  }
  {
    const o = M('wiper2_mod', 0.295, 0.492, 0.363, 0.585);
    wiperSel(o, 2, 0.325, 0.555);
  }

  // ============================================================== column 4 (x 0.365 .. 0.51)
  {
    const o = M('win_heat', 0.365, 0.001, 0.51, 0.149);
    const id = (s: string) => `b738.ovhd.winheat.${s}`;
    const W: [WindowHeat, string, number, number][] = [
      ['l_side', 'SIDE', 0.394, 0.384],
      ['l_fwd', 'FWD', 0.419, 0.409],
      ['r_fwd', 'FWD', 0.453, 0.463],
      ['r_side', 'SIDE', 0.478, 0.488],
    ];
    for (const [w, name, xl, xs] of W) {
      const full = `${w.startsWith('l') ? 'L' : 'R'} ${name}`;
      o.annun(id(`ovht_${w}`), `WINDOW HEAT ${full} OVERHEAT`, [seg.on('OVERHEAT', 'amber', L.windowOverheat(w))], xl, 0.013, 0.024, 0.01);
      o.annun(id(`on_${w}`), `WINDOW HEAT ${full} ON`, [seg.on('ON', 'green', L.windowOn(w))], xl, 0.025, 0.024, 0.01);
      o.toggle({ id: id(w), label: `WINDOW HEAT ${full}`, var: B738.windowHeat(w), ...OFF_ON }, xs, 0.056, false, 0.55);
      o.label(name, xs, 0.045, 0.0017);
    }
    o.label('L', 0.405, 0.035, 0.0019);
    o.label('WINDOW HEAT', 0.436, 0.035, 0.0019);
    o.label('R', 0.468, 0.035, 0.0019);
    o.toggle({ id: id('test'), label: 'WINDOW HEAT TEST', var: B738.windowHeatTest, positions: ['PWR TEST', '', 'OVHT'], values: [1, 0, -1], initial: 1, springs: { 0: 1, 2: 1 } }, 0.436, 0.053, false, 0.55);
    o.label('OVHT', 0.436, 0.043, 0.0016);
    o.label('PWR TEST', 0.436, 0.065, 0.0016);
    o.line(0.41, 0.071, 0.462, 0.071);
    // PROBE HEAT.
    const pid = (s: string) => `b738.ovhd.probe.${s}`;
    o.label('PROBE', 0.436, 0.075, 0.0019);
    for (const s of ['a', 'b'] as const) {
      const x = s === 'a' ? 0.421 : 0.451;
      o.toggle({ id: pid(s), label: `PROBE HEAT ${s.toUpperCase()}`, var: B738.probeHeat(s), ...OFF_ON }, x, 0.094, s.toUpperCase(), 0.55);
    }
    o.label('HEAT', 0.436, 0.113, 0.0019);
    o.label('TAT TEST', 0.436, 0.128, 0.0016);
    o.button({ id: pid('tat_test'), label: 'TAT TEST', mode: 'momentary', var: B738.tatTest, width: 0.009, capMaterial: 'plasticBlack' }, 0.436, 0.14);
    const P: [Parameters<typeof L.probeOff>[0], string[]][][] = [
      [
        ['capt_pitot', ['CAPT', 'PITOT']],
        ['l_elev_pitot', ['L ELEV', 'PITOT']],
        ['l_alpha', ['L ALPHA', 'VANE']],
        ['temp_probe', ['TEMP', 'PROBE']],
      ],
      [
        ['fo_pitot', ['F/O', 'PITOT']],
        ['r_elev_pitot', ['R ELEV', 'PITOT']],
        ['r_alpha', ['R ALPHA', 'VANE']],
        ['aux_pitot', ['AUX', 'PITOT']],
      ],
    ];
    P.forEach((col, k) =>
      col.forEach(([pr, text], j) => {
        o.annun(pid(pr), text.join(' '), [seg.on(text, 'amber', L.probeOff(pr))], k === 0 ? 0.388 : 0.484, 0.083 + j * 0.0128, 0.024, 0.0115);
      }),
    );
  }
  {
    const o = M('anti_ice', 0.365, 0.151, 0.51, 0.24);
    const id = (s: string) => `b738.ovhd.ai.${s}`;
    for (const i of [1, 2] as const) {
      const x = i === 1 ? 0.449 : 0.477;
      o.annun(id(`cowl_ai${i}`), `COWL ANTI-ICE ${i}`, [seg.on(['COWL', 'ANTI-ICE'], 'amber', L.cowlAi(i))], x, 0.171, 0.024, 0.011);
      o.annun(id(`cowl_valve${i}`), `COWL VALVE OPEN ${i}`, [seg.any(['COWL VALVE', 'OPEN'], 'blue', L.cowlValve(i))], x, 0.184, 0.024, 0.011);
      o.toggle({ id: id(`eng${i}`), label: `ENG ${i} ANTI-ICE`, var: B738.engAi(i), ...OFF_ON }, x + 0.002, 0.214, false, 0.6);
      o.label(String(i), x + 0.002, 0.232, 0.0018);
      o.annun(id(`wing_valve${i}`), `WING ANTI-ICE ${i === 1 ? 'L' : 'R'} VALVE OPEN`, [seg.any([i === 1 ? 'L VALVE' : 'R VALVE', 'OPEN'], 'blue', L.wingAiValve(i))], i === 1 ? 0.393 : 0.418, 0.184, 0.024, 0.011);
    }
    o.label('WING ANTI-ICE', 0.405, 0.198, 0.0017);
    o.toggle({ id: id('wing'), label: 'WING ANTI-ICE', var: B738.wingAi, ...OFF_ON }, 0.405, 0.212, false, 0.6);
    o.labels(['ENG', 'ANTI-ICE'], 0.465, 0.195, 0.0016);
    o.line(0.436, 0.195, 0.436, 0.235);
  }
  {
    const o = M('hyd', 0.365, 0.242, 0.51, 0.318);
    const id = (s: string) => `b738.ovhd.hyd.${s}`;
    const H: [HydPumpSw, string, number][] = [
      ['eng1', 'ENG 1', 0.39],
      ['elec2', 'ELEC 2', 0.414],
      ['elec1', 'ELEC 1', 0.456],
      ['eng2', 'ENG 2', 0.481],
    ];
    for (const [p, name, x] of H) {
      if (p === 'elec1' || p === 'elec2') o.annun(id(`ovht_${p}`), `HYD ${name} OVERHEAT`, [seg.on('OVERHEAT', 'amber', L.hydOverheat(p))], x, 0.26, 0.023, 0.01);
      o.annun(id(`lp_${p}`), `HYD ${name} LOW PRESSURE`, [seg.on(['LOW', 'PRESSURE'], 'amber', L.hydLowPress(p))], x, 0.273, 0.023, 0.011);
      o.label(name, x, 0.284, 0.0016);
      o.toggle({ id: id(p), label: `HYD PUMP ${name}`, var: B738.hydPump(p), ...OFF_ON }, x, 0.297, false, 0.55);
    }
    o.label('A', 0.402, 0.312, 0.0018);
    o.label('HYD PUMPS', 0.436, 0.312, 0.0018);
    o.label('B', 0.468, 0.312, 0.0018);
  }
  {
    // DOORS annunciators (SCBG: forward overhead column 4 under the HYD PUMPS). SCOPE: one var per overwing
    // side (the FWD / AFT OVERWING lights of a side show the same exit state).
    const o = M('doors', 0.365, 0.32, 0.51, 0.378);
    const id = (s: string) => `b738.aovhd.door.${s}`;
    const D: [Door, string[], number, number, string?][] = [
      ['fwd_entry', ['FWD', 'ENTRY'], 0.422, 0.33],
      ['fwd_service', ['FWD', 'SERVICE'], 0.449, 0.33],
      ['l_overwing', ['LEFT FWD', 'OVERWING'], 0.422, 0.343],
      ['r_overwing', ['RIGHT FWD', 'OVERWING'], 0.449, 0.343],
      ['fwd_cargo', ['FWD', 'CARGO'], 0.478, 0.343],
      ['equip', ['EQUIP'], 0.393, 0.35],
      ['aft_cargo', ['AFT', 'CARGO'], 0.478, 0.357],
      ['aft_entry', ['AFT', 'ENTRY'], 0.422, 0.37],
      ['aft_service', ['AFT', 'SERVICE'], 0.449, 0.37],
    ];
    for (const [d, text, x, y] of D) o.annun(id(d), `${text.join(' ')} DOOR`, [seg.on(text, 'amber', L.doorLt(d))], x, y, 0.025, 0.0115);
    o.annun(id('l_overwing_aft'), 'LEFT AFT OVERWING DOOR', [seg.on(['LEFT AFT', 'OVERWING'], 'amber', L.doorLt('l_overwing'))], 0.422, 0.3565, 0.025, 0.0115);
    o.annun(id('r_overwing_aft'), 'RIGHT AFT OVERWING DOOR', [seg.on(['RIGHT AFT', 'OVERWING'], 'amber', L.doorLt('r_overwing'))], 0.449, 0.3565, 0.025, 0.0115);
    o.annun(id('flt_deck'), 'FLT DECK DOOR', [seg.on(['FLT', 'DECK'], 'amber', L.doorLt('flt_deck'))], 0.393, 0.336, 0.025, 0.0115);
  }
  {
    const o = M('cvr', 0.365, 0.38, 0.51, 0.43);
    const id = (s: string) => `b738.ovhd.cvr.${s}`;
    o.label('COCKPIT VOICE RECORDER', 0.436, 0.387, 0.0016);
    o.annun(id('status'), 'CVR STATUS', [seg.on('STATUS', 'green', 'ac.b738.cvr_test_lt')], 0.4, 0.418, 0.022, 0.009);
    o.button({ id: id('erase'), label: 'CVR ERASE (hold 2 s on the ground, parking brake set)', mode: 'momentary', var: B738.cvrErase, width: 0.008, capMaterial: 'plasticBlack' }, 0.426, 0.41);
    o.label('ERASE', 0.426, 0.399, 0.0016);
    o.button({ id: id('test'), label: 'CVR TEST', mode: 'momentary', var: B738.cvrTest, width: 0.008, capMaterial: 'plasticBlack' }, 0.451, 0.41);
    o.label('TEST', 0.451, 0.399, 0.0016);
    o.label('HEADPHONE', 0.478, 0.422, 0.0015);
  }
  {
    const o = M('cabin_alt', 0.365, 0.432, 0.51, 0.585);
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
        titleY: 196,
      }),
      0.435,
      0.476,
      0.07,
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
      0.435,
      0.553,
      0.05,
    );
    o.labels(['ALT', 'HORN', 'CUTOUT'], 0.487, 0.452, 0.0016);
    o.button({ id: id('horn_cutout'), label: 'ALT HORN CUTOUT', mode: 'momentary', var: B738.altHornCutout, width: 0.01, capMaterial: 'plasticBlack' }, 0.488, 0.477);
    o.p.placard({ text: 'PRESS DIFF\nLIMIT: TAKE-\nOFF & LDG\n.125 PSI', height: 0.0016, style: 'inverse' }, o.X(0.386), o.Y(0.528));
  }

  // ============================================================== column 5 (x 0.512 .. 0.658)
  {
    const o = M('aircond', 0.512, 0.001, 0.658, 0.21);
    const id = (s: string) => `b738.ovhd.ac.${s}`;
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
      0.54,
      0.064,
      0.045,
    );
    o.label('AIR TEMP', 0.598, 0.045, 0.0018);
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
      0.612,
      0.075,
      { diameter: 0.014, labelHeight: 0.0012, labelRadius: 0.0145 },
    );
    o.toggle({ id: id('trim_air'), label: 'TRIM AIR', var: B738.trimAir, ...OFF_ON, initial: 1 }, 0.573, 0.108, 'TRIM AIR', 0.55);
    const Z: [1 | 2 | 3, 'cont' | 'fwd' | 'aft', string][] = [
      [1, 'cont', 'CONT CAB'],
      [2, 'fwd', 'FWD CAB'],
      [3, 'aft', 'AFT CAB'],
    ];
    for (const [z, zone, name] of Z) {
      const x = 0.535 + (z - 1) * 0.0415;
      o.annun(id(`zone_temp${z}`), `${name} ZONE TEMP`, [seg.on(['ZONE', 'TEMP'], 'amber', L.zoneTemp(z))], x, 0.135, 0.022, 0.01);
      o.label(name, x, 0.147, 0.0016);
      o.knob(id(`temp_${zone}`), `${name} TEMPERATURE`, B738.tempSel(zone), x, 0.166, {
        diameter: 0.016,
        initial: 0.5,
        range: [-150, 150],
        format: (v) => (v < 0.03 ? 'OFF' : `AUTO ${(18 + 12 * v).toFixed(1)} °C`),
      });
      o.label('C   OFF   W', x, 0.185, 0.0013);
    }
    o.annun('b738.ovhd.bleed.dual_bleed', 'DUAL BLEED', [seg.on(['DUAL', 'BLEED'], 'amber', L.dualBleed)], 0.542, 0.2, 0.022, 0.01);
    for (const i of [1, 2] as const) {
      const s = i === 1 ? 'L' : 'R';
      o.annun(`b738.ovhd.bleed.ram${i}`, `RAM DOOR FULL OPEN ${s}`, [seg.on(['RAM DOOR', 'FULL OPEN'], 'blue', L.ramDoorFullOpen(i))], i === 1 ? 0.575 : 0.62, 0.2, 0.026, 0.01);
    }
  }
  {
    const o = M('bleed', 0.512, 0.212, 0.658, 0.4);
    const id = (s: string) => `b738.ovhd.bleed.${s}`;
    o.toggle({ id: 'b738.ovhd.ac.recirc1', label: 'L RECIRC FAN', var: B738.recircFan(1), positions: ['OFF', 'AUTO'], values: [0, 1], initial: 1 }, 0.54, 0.229, 'L RECIRC FAN', 0.55);
    o.toggle({ id: 'b738.ovhd.ac.recirc2', label: 'R RECIRC FAN', var: B738.recircFan(2), positions: ['OFF', 'AUTO'], values: [0, 1], initial: 1 }, 0.618, 0.229, 'R RECIRC FAN', 0.55);
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
      0.577,
      0.259,
      0.04,
    );
    o.label('OVHT', 0.627, 0.255, 0.0016);
    o.button({ id: 'b738.ovhd.ac.ovht_test', label: 'AIR COND OVHT TEST', mode: 'momentary', var: B738.ovhtTest, width: 0.008, capMaterial: 'plasticBlack' }, 0.627, 0.266);
    o.label('TEST', 0.627, 0.276, 0.0016);
    for (const i of [1, 2] as const) {
      const x = i === 1 ? 0.54 : 0.614;
      const s = i === 1 ? 'L' : 'R';
      o.toggle({ id: id(`pack_sw${i}`), label: `${s} PACK`, var: B738.pack(i), positions: ['OFF', 'AUTO', 'HIGH'], values: [0, 1, 2], initial: 1 }, i === 1 ? 0.535 : 0.625, 0.296, `${s} PACK`, 0.55);
      o.annun(id(`pack${i}`), `PACK ${s}`, [seg.on('PACK', 'amber', L.packTrip(i))], x, 0.325, 0.024, 0.011);
      o.annun(id(`wbo${i}`), `WING-BODY OVERHEAT ${s}`, [seg.on(['WING-BODY', 'OVERHEAT'], 'amber', L.wingBodyOvht(i))], x, 0.338, 0.024, 0.011);
      o.annun(id(`bleed_trip${i}`), `BLEED TRIP OFF ${i}`, [seg.on(['BLEED', 'TRIP OFF'], 'amber', L.bleedTripOff(i))], x, 0.351, 0.024, 0.011);
      o.toggle({ id: id(`bleed${i}`), label: `BLEED ${i}`, var: B738.bleed(i), ...OFF_ON, initial: 1 }, i === 1 ? 0.532 : 0.624, 0.373, String(i), 0.55);
    }
    o.toggle({ id: id('iso'), label: 'ISOLATION VALVE', var: B738.isoValve, positions: ['CLOSE', 'AUTO', 'OPEN'], values: [0, 1, 2], initial: 1 }, 0.578, 0.303, 'ISOLATION VALVE', 0.55);
    o.button({ id: id('trip_reset'), label: 'TRIP RESET', mode: 'momentary', var: B738.tripReset, width: 0.011, capMaterial: 'plasticBlack' }, 0.578, 0.343);
    o.label('TRIP', 0.578, 0.333, 0.0016);
    o.label('RESET', 0.578, 0.354, 0.0016);
    o.toggle({ id: id('apu_bleed'), label: 'APU BLEED', var: B738.apuBleed, ...OFF_ON }, 0.567, 0.373, 'APU', 0.55);
    o.label('BLEED', 0.578, 0.394, 0.002);
  }
  {
    const o = M('press', 0.512, 0.402, 0.658, 0.585);
    const id = (s: string) => `b738.ovhd.press.${s}`;
    o.annun(id('auto_fail'), 'AUTO FAIL', [seg.on(['AUTO', 'FAIL'], 'amber', L.autoFail)], 0.528, 0.41, 0.024, 0.011);
    o.annun(id('off_sched'), 'OFF SCHED DESCENT', [seg.on(['OFF SCHED', 'DESCENT'], 'amber', L.offSchedDescent)], 0.555, 0.41, 0.026, 0.011);
    o.annun(id('altn'), 'ALTN', [seg.on('ALTN', 'green', L.altn)], 0.588, 0.41, 0.024, 0.011);
    o.annun(id('manual'), 'MANUAL', [seg.on('MANUAL', 'green', L.manual)], 0.622, 0.41, 0.024, 0.011);
    o.label('AUTO', 0.555, 0.422, 0.0018);
    o.label('MANUAL', 0.618, 0.422, 0.0018);
    o.line(0.595, 0.418, 0.595, 0.495);
    // FLT ALT / LAND ALT windows (LCD) and knobs.
    const alt = (y: number, which: 'flt' | 'land') => {
      const v = which === 'flt' ? B738.fltAltFt : B738.landAltFt;
      lcd(o, `b738_${which}_alt_lcd`, 'elec.press_auto_powered', [v], [{ text: () => String(Math.round(vars.get(v))), x: 160, size: 42 }], 0.556, y, 0.046, 0.013, 320);
      o.label(which === 'flt' ? 'FLT ALT' : 'LAND ALT', 0.553, y + 0.016, 0.0018);
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
        o.X(0.553),
        o.Y(y + 0.029),
      );
    };
    alt(0.436, 'flt');
    alt(0.487, 'land');
    dial(
      o,
      () => new ScaleDial({
        id: 'b738_outflow',
        vars,
        powerVar: null,
        scales: [{ angle: lin(0, 1, -70, 70), ticks: [{ v: 0, label: 'C' }, { v: 0.25, major: false }, { v: 0.5 }, { v: 0.75, major: false }, { v: 1, label: 'O' }], labelRadius: 76 }],
        needles: [{ var: 'press.outflow_pos' }],
        title: ['VALVE'],
        titleY: 160,
      }),
      0.618,
      0.441,
      0.026,
    );
    o.toggle({ id: id('outflow'), label: 'OUTFLOW VALVE', var: B738.outflowSw, positions: ['OPEN', '', 'CLOSE'], values: [1, 0, -1], initial: 1, springs: { 0: 1, 2: 1 }, orientation: 'horizontal' }, 0.616, 0.474, false, 0.55);
    o.label('CLOSE        OPEN', 0.616, 0.486, 0.0015);
    o.selector(id('mode'), 'PRESSURIZATION MODE SELECTOR', B738.pressMode, [{ value: 0, label: 'AUTO' }, { value: 1, label: 'ALTN' }, { value: 2, label: 'MAN' }], 0.61, 0.52, { diameter: 0.018, cap: 'bar', labelHeight: 0.0018 });
    // FLT ALT / CAB ALT placard (SCBG: strip along the bottom of the module).
    o.p.placard({ text: 'CAB ALT  LAND ALT  2000  4000  6000  8000\nFLT ALT  <FL160  FL220  FL260  FL320  FL410', height: 0.0012, style: 'inverse' }, o.X(0.585), o.Y(0.572));
  }

  // ============================================================== bottom row (next to the windshield), y 0.585 .. 0.64
  const RY0 = 0.587;
  const RY1 = 0.64;
  {
    const o = M('landing', 0.033, RY0, 0.24, RY1);
    const id = (s: string) => `b738.ovhd.ext.${s}`;
    o.label('LANDING', 0.11, 0.593, 0.002);
    o.label('RETRACTABLE', 0.084, 0.633, 0.0016);
    o.label('FIXED', 0.136, 0.633, 0.0016);
    for (const i of [1, 2] as const) {
      const s = i === 1 ? 'L' : 'R';
      o.toggle({ id: id(`retract${i}`), label: `RETRACTABLE LANDING ${s}`, var: B738.landingRetract(i), positions: ['RETRACT', 'EXTEND', 'ON'], values: [0, 1, 2], initial: 0 }, 0.07 + (i - 1) * 0.028, 0.609, s, 0.55);
      o.toggle({ id: id(`fixed${i}`), label: `FIXED LANDING ${s}`, var: B738.landingFixed(i), ...OFF_ON }, 0.123 + (i - 1) * 0.026, 0.609, s, 0.55);
      o.toggle({ id: id(`turnoff${i}`), label: `RUNWAY TURNOFF ${s}`, var: B738.turnoff(i), ...OFF_ON }, 0.178 + (i - 1) * 0.024, 0.609, s, 0.55);
    }
    o.labels(['RUNWAY', 'TURNOFF'], 0.19, 0.59, 0.0015);
    o.toggle({ id: id('taxi'), label: 'TAXI', var: B738.taxiLt, ...OFF_ON }, 0.228, 0.609, 'TAXI', 0.55);
  }
  {
    const o = M('apu_sw', 0.24, RY0, 0.272, RY1);
    o.label('APU', 0.256, 0.593, 0.002);
    o.selector('b738.ovhd.apu.sw', 'APU', B738.apuSw, [{ value: APU_SW.off, label: 'OFF', angle: -45 }, { value: APU_SW.on, label: 'ON', angle: 0 }, { value: APU_SW.start, label: 'START', angle: 45, spring: APU_SW.on }], 0.256, 0.617, { diameter: 0.013, cap: 'bar', labelHeight: 0.0014 });
  }
  {
    const o = M('eng_start', 0.272, RY0, 0.445, RY1);
    const id = (s: string) => `b738.ovhd.start.${s}`;
    o.label('ENGINE START', 0.356, 0.593, 0.002);
    for (const i of [1, 2] as const) {
      const cx = i === 1 ? 0.301 : 0.412;
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
        0.617,
        { diameter: 0.019, cap: 'bar', labelHeight: 0.0017, initial: 1 },
      );
      o.label(String(i), cx, 0.636, 0.002);
    }
    o.toggle({ id: id('ign'), label: 'IGNITION SELECT', var: B738.ignSel, positions: ['IGN L', 'BOTH', 'IGN R'], values: [-1, 0, 1], initial: 0, orientation: 'horizontal' }, 0.356, 0.612, false, 0.6);
  }
  {
    const o = M('ext_lts', 0.445, RY0, 0.627, RY1);
    const id = (s: string) => `b738.ovhd.ext.${s}`;
    const items: [string, string, string, Partial<Parameters<Ovhd['toggle']>[0]>, number][] = [
      ['logo', 'LOGO', B738.logoLt, OFF_ON, 0.476],
      ['position', 'POSITION', B738.positionLt, { positions: ['STEADY', 'OFF', 'STROBE & STEADY'], values: [-1, 0, 1], initial: 1 }, 0.509],
      ['anti_coll', 'ANTI COLLISION', B738.antiColl, OFF_ON, 0.543],
      ['wing', 'WING', B738.wingLt, OFF_ON, 0.567],
      ['wheel_well', 'WHEEL WELL', B738.wheelWellLt, OFF_ON, 0.593],
    ];
    for (const [k, name, v, pos, xx] of items) {
      o.toggle({ id: id(k), label: name, var: v, ...(pos as object) }, xx, 0.613, false, 0.55);
      o.labels(name.split(' '), xx, 0.591, 0.0015);
    }
  }
  // INDEX TO LOCK latches at the lower corners.
  indexLock(env, root, 0.004, 0.585);
  indexLock(env, root, 0.63, 0.585);

  function wiperSel(o: Ovhd, s: 1 | 2, x: number, y: number): void {
    o.selector(
      `b738.ovhd.wiper${s}`,
      `WINDSHIELD WIPER ${s === 1 ? 'L' : 'R'}`,
      B738.wiper(s),
      [
        { value: 0, label: 'PARK', angle: -60 },
        { value: 1, label: 'INT', angle: -20 },
        { value: 2, label: 'LOW', angle: 20 },
        { value: 3, label: 'HIGH', angle: 60 },
      ],
      x,
      y,
      { diameter: 0.017, cap: 'bar', labelHeight: 0.0016 },
    );
    o.label(`${s === 1 ? 'L' : 'R'} WIPER`, x, y - 0.03, 0.0019);
  }
}
