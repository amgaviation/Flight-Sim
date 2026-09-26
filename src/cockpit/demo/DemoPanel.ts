/**
 * Demo cockpit for the integration agent and visual QA: one of every control
 * type, a touch display, structure, lighting, and a tiny demo "system" so
 * every switch changes state that something shows (annunciators, the demo
 * display). Uses only `ac.demo.*` vars plus standard lighting/alert vars.
 *
 *   const build = buildDemoCockpit(ctx);          // CockpitBuildEx
 *   const rt = new CockpitRuntime({ build, vars: ctx.vars, domElement, camera, renderer });
 *
 * Layout (body metres, x fwd, y right, z down): pilot eye at
 * DEMO_EYE; main panel ahead, pedestal on the centreline, overhead above.
 */
import * as THREE from 'three';
import { ALERT, INPUT, SURF } from '../../core/vars';
import type { CockpitDisplay } from '../types';
import { CockpitBuilder, type CockpitBuildEx } from '../CockpitBuilder';
import type { CockpitHost } from '../env';
import { createCanvas, context2d, type AnyCanvas, type AnyContext2D } from '../env';
import {
  AnnunciatorLight,
  CircuitBreaker,
  FuelSelector,
  GearHandle,
  GuardedButton,
  GuardedSwitch,
  KeyPad,
  Lever,
  PushButton,
  PushPullKnob,
  RockerSwitch,
  RotaryKnob,
  RudderPedals,
  SelectorKnob,
  TBarHandle,
  Thumbwheel,
  ToggleSwitch,
  TrimWheel,
  Yoke,
} from '../controls';
import { glareshieldGeometry, pedestalGeometry } from '../geometry/structure';
import { bl } from '../frame';

export const DEMO_EYE: [number, number, number] = [0, -0.36, -1.05];

/** Demo var names. */
export const DEMO_VARS = {
  batt: 'ac.demo.batt',
  busV: 'ac.demo.bus_v',
  gen: 'ac.demo.gen',
  genFail: 'ac.demo.gen_fail',
  start: 'ac.demo.start',
  fuelPump: 'ac.demo.fuel_pump',
  emerLt: 'ac.demo.emer_lt',
  emerLtGuard: 'ac.demo.emer_lt_guard',
  disch: 'ac.demo.disch',
  navLt: 'ac.demo.nav_lt',
  hdg: 'ac.demo.hdg_deg',
  hdgSync: 'ac.demo.hdg_sync',
  crs: 'ac.demo.crs_deg',
  baro: 'ac.demo.baro_inhg',
  mode: 'ac.demo.mode',
  mags: 'ac.demo.mags',
  panelLt: 'ac.light.panel',
  floodLt: 'ac.light.flood',
  domeLt: 'ac.light.dome',
  annunBrt: 'ac.demo.annun_brt',
  cabinAlt: 'ac.demo.cabin_alt_ft',
  gear: 'ac.demo.gear_handle',
  gearTransit: 'ac.demo.gear_transit',
  park: 'ac.demo.park_brake',
  fire: 'ac.demo.fire_handle',
  fireRot: 'ac.demo.fire_rot',
  fireWarn: 'ac.demo.fire_warn',
  fireOvrd: 'ac.demo.fire_ovrd',
  throttle: 'ac.demo.throttle',
  mixture: 'ac.demo.mixture',
  tla1: 'ac.demo.tla1',
  tla2: 'ac.demo.tla2',
  flaps: 'ac.demo.flap_handle',
  spdbrk: 'ac.demo.speedbrake',
  cutoff: 'ac.demo.cutoff',
  trim: 'ac.demo.pitch_trim',
  fuelSel: 'ac.demo.fuel_sel',
  apDisc: 'ac.demo.ap_disc',
  yokeTrim: 'ac.demo.yoke_trim',
  ptt: 'ac.demo.ptt',
  cbPitot: 'ac.demo.cb_pitot',
  cbPitotTrip: 'ac.demo.cb_pitot_trip',
  cbAvn: 'ac.demo.cb_avn',
  cdu: 'ac.demo.cdu_text',
} as const;

/** A small touch-capable canvas display showing demo vars. */
export class DemoDisplay implements CockpitDisplay {
  readonly id: string;
  readonly canvas: AnyCanvas;
  readonly width = 512;
  readonly height = 384;
  readonly refreshHz = 20;
  private readonly ctx: AnyContext2D | null;
  private readonly host: CockpitHost;
  private touch: { x: number; y: number; down: boolean } = { x: -1, y: -1, down: false };
  private t = 0;

  constructor(host: CockpitHost, id = 'demo') {
    this.id = id;
    this.host = host;
    this.canvas = createCanvas(this.width, this.height) ?? ({ width: this.width, height: this.height, getContext: () => null } as unknown as AnyCanvas);
    this.ctx = context2d(this.canvas);
  }

  render(dt: number): boolean {
    this.t += dt;
    const c = this.ctx;
    if (!c) return false;
    const v = this.host.vars;
    c.fillStyle = '#05080c';
    c.fillRect(0, 0, this.width, this.height);
    c.fillStyle = '#1e7bd6';
    c.fillRect(0, 0, this.width, 40);
    c.fillStyle = '#ffffff';
    c.font = '600 22px Arial, sans-serif';
    c.textBaseline = 'middle';
    c.fillText('COCKPIT DEMO', 14, 20);
    c.font = '18px "Courier New", monospace';
    const rows: [string, string][] = [
      ['BUS', `${v.get(DEMO_VARS.busV).toFixed(1)} V`],
      ['HDG', v.get(DEMO_VARS.hdg).toFixed(0).padStart(3, '0')],
      ['CRS', v.get(DEMO_VARS.crs).toFixed(0).padStart(3, '0')],
      ['BARO', v.get(DEMO_VARS.baro).toFixed(2)],
      ['TLA', `${v.get(DEMO_VARS.tla1).toFixed(2)} / ${v.get(DEMO_VARS.tla2).toFixed(2)}`],
      ['FLAPS', v.get(DEMO_VARS.flaps).toFixed(0)],
      ['TRIM', v.get(DEMO_VARS.trim).toFixed(2)],
      ['CDU', v.getString(DEMO_VARS.cdu)],
    ];
    rows.forEach(([k, val], i) => {
      c.fillStyle = '#7fd4ff';
      c.fillText(k, 20, 70 + i * 32);
      c.fillStyle = '#ffffff';
      c.fillText(val, 140, 70 + i * 32);
    });
    if (this.touch.x >= 0) {
      c.strokeStyle = this.touch.down ? '#ff00ff' : '#888';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(this.touch.x, this.touch.y, 14, 0, Math.PI * 2);
      c.stroke();
    }
    return true;
  }

  onPointer(x: number, y: number, kind: 'down' | 'up' | 'move' | 'wheel', delta?: number): void {
    if (kind === 'wheel') {
      this.host.vars.add(DEMO_VARS.hdg, delta ?? 0, 0, 360, true);
      return;
    }
    this.touch = { x, y, down: kind === 'down' || (kind === 'move' && this.touch.down) };
    if (kind === 'up') this.touch.down = false;
  }
}

/** A round electromechanical-style gauge face (needle follows the demo throttle). */
export class DemoGauge implements CockpitDisplay {
  readonly id: string;
  readonly canvas: AnyCanvas;
  readonly width = 256;
  readonly height = 256;
  readonly refreshHz = 30;
  private readonly ctx: AnyContext2D | null;
  private readonly host: CockpitHost;
  private last = NaN;

  constructor(host: CockpitHost, id = 'demo.gauge') {
    this.id = id;
    this.host = host;
    this.canvas = createCanvas(this.width, this.height) ?? ({ width: this.width, height: this.height, getContext: () => null } as unknown as AnyCanvas);
    this.ctx = context2d(this.canvas);
  }

  render(): boolean {
    const c = this.ctx;
    const v = this.host.vars.get(DEMO_VARS.throttle);
    if (!c || v === this.last) return false;
    this.last = v;
    const r = 124;
    c.fillStyle = '#0b0b0c';
    c.fillRect(0, 0, 256, 256);
    c.save();
    c.translate(128, 128);
    c.strokeStyle = '#f2f2f2';
    c.fillStyle = '#f2f2f2';
    c.font = '600 22px Arial, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let i = 0; i <= 10; i++) {
      const a = (-135 + i * 27) * (Math.PI / 180);
      c.lineWidth = i % 2 ? 2 : 4;
      c.beginPath();
      c.moveTo(Math.sin(a) * (r - 6), -Math.cos(a) * (r - 6));
      c.lineTo(Math.sin(a) * (r - (i % 2 ? 18 : 26)), -Math.cos(a) * (r - (i % 2 ? 18 : 26)));
      c.stroke();
      if (i % 2 === 0) c.fillText(String(i * 10), Math.sin(a) * (r - 46), -Math.cos(a) * (r - 46));
    }
    c.font = '600 14px Arial, sans-serif';
    c.fillText('THROTTLE %', 0, 42);
    const a = (-135 + v * 270) * (Math.PI / 180);
    c.rotate(a);
    c.fillStyle = '#f5f5f5';
    c.beginPath();
    c.moveTo(-4, 16);
    c.lineTo(0, -(r - 14));
    c.lineTo(4, 16);
    c.closePath();
    c.fill();
    c.restore();
    c.fillStyle = '#222';
    c.beginPath();
    c.arc(128, 128, 10, 0, Math.PI * 2);
    c.fill();
    return true;
  }
}

/** Builds the demo cockpit. */
export function buildDemoCockpit(host: CockpitHost, palette: 'citation' | 'boeing' | 'gulfstream' | 'bombardier' | 'cessna172' = 'citation'): CockpitBuildEx {
  const b = new CockpitBuilder(host, {
    palette,
    name: 'demo',
    eyePosition_m: DEMO_EYE,
    views: [
      { name: 'Pedestal', position_m: [0.05, -0.2, -1.0], yawDeg: 25, pitchDeg: -45 },
      { name: 'Overhead', position_m: [0.1, -0.3, -1.05], yawDeg: 10, pitchDeg: 55 },
    ],
  });
  const env = b.env;
  const vars = host.vars;

  // --- Lighting -------------------------------------------------------------
  b.zone({ id: 'panel', intensityVar: DEMO_VARS.panelLt, powerVar: DEMO_VARS.batt });
  b.zone({ id: 'flood', intensityVar: DEMO_VARS.floodLt, powerVar: DEMO_VARS.batt });
  b.zone({ id: 'dome', intensityVar: DEMO_VARS.domeLt, powerVar: DEMO_VARS.batt, lagS: 0 });
  env.lighting.setAnnunciatorDimming(DEMO_VARS.annunBrt, 0.3, false, DEMO_VARS.batt);
  env.lighting.addFloodLight('flood.l', 'flood', [0.45, -0.35, -1.25], [0.75, -0.2, -0.8], b.root);
  env.lighting.addDomeLight('dome', 'dome', [0.2, 0, -1.5], b.root);

  // --- Structure ------------------------------------------------------------
  // Brow just aft of the main panel's top edge (panel top ~ [0.815, y, -0.926]).
  const gs = b.structureMesh(glareshieldGeometry(1.5, 0.35, 0.055), 'glareshield', [0.76, 0, -0.945]);
  gs.name = 'glareshield';
  b.structureMesh(pedestalGeometry(0.3, 0.5, 0.575, 0.655), 'panelDark', [0.5, 0, 0]);
  b.seat('bizjet', [-0.05, -0.36, 0]);
  b.seat('bizjet', [-0.05, 0.36, 0]);

  // --- Main panel -------------------------------------------------------------
  const main = b.panel({
    name: 'main',
    center_m: [0.78, 0, -0.76],
    facing: 'aft',
    tiltDeg: 12,
    width: 1.4,
    height: 0.34,
    origin: 'top-left',
    cutouts: [{ shape: 'rect', u: 0.33, v: 0.13, w: 0.2, h: 0.15 }],
  });
  main.display(new DemoDisplay(host), 0.33, 0.13, 0.2, 0.15, { bezel: { border: 0.012 }, display: { boot: { seconds: 2, title: 'DEMO DISPLAY' } } });
  main.roundInstrument(new DemoGauge(host), 0.33, 0.28, '3ATI');
  main.label('ELECTRICAL', 0.08, 0.03);
  main.add(new ToggleSwitch(env, { id: 'demo.batt', var: DEMO_VARS.batt, label: 'BATT', positions: ['OFF', 'ON'], labels: { name: 'BATT', positions: true } }), 0.05, 0.085);
  main.add(
    new ToggleSwitch(env, { id: 'demo.start', var: DEMO_VARS.start, label: 'START', positions: ['DISENG', 'OFF', 'START'], initial: 1, springs: { 2: 1 }, labels: { name: 'ENG START', positions: true } }),
    0.1,
    0.085,
  );
  main.add(
    new ToggleSwitch(env, { id: 'demo.fuelpump', var: DEMO_VARS.fuelPump, label: 'FUEL PUMP', positions: ['OFF', 'NORM', 'ON'], initial: 1, leverLock: [0], labels: { name: 'FUEL PUMP', positions: true } }),
    0.15,
    0.085,
  );
  main.add(
    new GuardedSwitch(env, {
      id: 'demo.emerlt',
      var: DEMO_VARS.emerLt,
      label: 'EMER LTS',
      positions: ['OFF', 'ARM'],
      initial: 1,
      guard: { color: 'red', guardedPosition: 1, var: DEMO_VARS.emerLtGuard, hinge: 'bottom' },
    }),
    0.05,
    0.165,
  );
  main.add(
    new GuardedButton(env, {
      id: 'demo.disch',
      var: DEMO_VARS.disch,
      label: 'BOTTLE DISCH',
      segments: [{ text: 'DISCH', color: 'amber', whenOn: true }],
      guard: { color: 'clear' },
    }),
    0.11,
    0.165,
  );
  main.add(
    new RockerSwitch(env, { id: 'demo.nav', var: DEMO_VARS.navLt, label: 'NAV LTS', legend: { top: 'NAV', bottom: 'OFF' }, indicator: { var: DEMO_VARS.navLt, color: 'green' }, name: 'NAV' }),
    0.16,
    0.165,
  );
  main.add(
    new PushButton(env, {
      id: 'demo.gen',
      var: DEMO_VARS.gen,
      mode: 'toggle',
      label: 'GEN',
      style: 'korry',
      segments: [
        { text: 'FAIL', color: 'amber', var: DEMO_VARS.genFail },
        { text: 'OFF', color: 'white', var: DEMO_VARS.gen, test: (v) => v === 0 },
      ],
      name: 'GEN',
    }),
    0.05,
    0.245,
  );
  main.add(new PushButton(env, { id: 'demo.lamptest', var: ALERT.annunTest, label: 'LAMP TEST', style: 'round', engraved: 'TEST' }), 0.1, 0.245);
  main.add(
    new PushButton(env, {
      id: 'demo.mc',
      var: ALERT.masterCaution,
      label: 'MASTER CAUTION',
      style: 'mushroom',
      mode: 'momentary',
      segments: [{ text: ['MASTER', 'CAUTION'], color: 'amber', var: DEMO_VARS.genFail, style: 'field' }],
    }),
    0.155,
    0.245,
  );
  main.add(new AnnunciatorLight(env, { id: 'demo.annun.bus', label: 'BUS', segments: [{ text: 'BUS ON', color: 'green', var: DEMO_VARS.busV, test: (v) => v > 20 }] }), 0.05, 0.31);
  main.add(new AnnunciatorLight(env, { id: 'demo.annun.fire', label: 'FIRE', pressToTest: true, segments: [{ text: 'FIRE', color: 'red', var: DEMO_VARS.fireWarn, style: 'field' }] }), 0.08, 0.31);

  // Flight guidance: concentric HDG knob with push sync, CRS encoder, BARO, MODE selector.
  main.add(
    new RotaryKnob(env, {
      id: 'demo.hdg',
      label: 'HDG',
      outer: { var: DEMO_VARS.crs, min: 0, max: 360, wrap: true, step: 1, accel: { fastStep: 10 }, label: 'CRS', format: (v) => v.toFixed(0).padStart(3, '0') },
      inner: { var: DEMO_VARS.hdg, min: 0, max: 360, wrap: true, step: 1, accel: { fastStep: 10 }, label: 'HDG', format: (v) => v.toFixed(0).padStart(3, '0') },
      push: { var: DEMO_VARS.hdgSync, label: 'SYNC' },
    }),
    0.52,
    0.08,
  );
  main.add(new RotaryKnob(env, { id: 'demo.baro', label: 'BARO', cap: 'knurled', outer: { var: DEMO_VARS.baro, min: 28.0, max: 31.0, step: 0.01, initial: 29.92, accel: { fastStep: 0.1 }, format: (v) => `${v.toFixed(2)} inHg` } }), 0.57, 0.08);
  main.add(
    new SelectorKnob(env, {
      id: 'demo.mode',
      var: DEMO_VARS.mode,
      label: 'MODE',
      cap: 'bar',
      positions: [
        { value: 0, label: 'OFF' },
        { value: 1, label: 'AUTO' },
        { value: 2, label: 'MAN' },
        { value: 3, label: 'TEST', spring: 2 },
      ],
      initial: 1,
      title: 'PRESS MODE',
    }),
    0.64,
    0.1,
  );
  main.add(
    new SelectorKnob(env, {
      id: 'demo.mags',
      var: DEMO_VARS.mags,
      label: 'MAGNETOS',
      cap: 'key',
      diameter: 0.02,
      positions: [
        { value: 0, label: 'OFF' },
        { value: 1, label: 'R' },
        { value: 2, label: 'L' },
        { value: 3, label: 'BOTH' },
        { value: 4, label: 'START', spring: 3 },
      ],
      ticks: false,
    }),
    0.64,
    0.2,
  );
  main.add(new RotaryKnob(env, { id: 'demo.panellt', label: 'PANEL LT', cap: 'dimmer', diameter: 0.014, outer: { var: DEMO_VARS.panelLt, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], format: (v) => `${(v * 100).toFixed(0)}%` } }), 0.52, 0.2);
  main.add(new RotaryKnob(env, { id: 'demo.floodlt', label: 'FLOOD LT', cap: 'dimmer', diameter: 0.014, outer: { var: DEMO_VARS.floodLt, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], format: (v) => `${(v * 100).toFixed(0)}%` } }), 0.56, 0.2);
  main.add(new ToggleSwitch(env, { id: 'demo.annunbrt', var: DEMO_VARS.annunBrt, label: 'ANNUN', positions: ['DIM', 'BRT'], initial: 1, labels: { name: 'ANNUN', positions: true } }), 0.52, 0.27);
  main.add(new ToggleSwitch(env, { id: 'demo.dome', var: DEMO_VARS.domeLt, label: 'DOME', labels: { name: 'DOME', positions: true }, handle: 'paddle' }), 0.56, 0.27);
  main.add(new Thumbwheel(env, { id: 'demo.cabalt', label: 'CAB ALT', channel: { var: DEMO_VARS.cabinAlt, min: -1000, max: 14000, step: 100, initial: 8000, label: 'CAB ALT', format: (v) => `${v.toFixed(0)} ft` } }), 0.6, 0.27);

  // Gear, parking brake, fire handle, push-pull controls.
  main.add(
    new GearHandle(env, {
      id: 'demo.gear',
      var: DEMO_VARS.gear,
      label: 'LANDING GEAR',
      positions: ['DN', 'UP'],
      lights: [{ var: DEMO_VARS.gearTransit, color: 'red' }],
      inhibit: (to, _from, v) => !(to === 1 && v.get('gear.wow1') !== 0),
    }),
    0.8,
    0.17,
  );
  main.add(new TBarHandle(env, { id: 'demo.park', var: DEMO_VARS.park, label: 'PARKING BRAKE', style: 'tbar', rotate: 'lock', springIn: true, legend: 'PARK' }), 0.9, 0.29);
  main.add(
    new TBarHandle(env, {
      id: 'demo.fire',
      var: DEMO_VARS.fire,
      rotateVar: DEMO_VARS.fireRot,
      label: 'ENG FIRE',
      style: 'fire',
      legend: 'ENG 1',
      lightVar: DEMO_VARS.fireWarn,
      unlockVar: DEMO_VARS.fireWarn,
      overrideVar: DEMO_VARS.fireOvrd,
    }),
    0.97,
    0.1,
  );
  main.add(new PushButton(env, { id: 'demo.fireovrd', var: DEMO_VARS.fireOvrd, label: 'FIRE SW OVRD', style: 'small', capMaterial: 'knobGrey' }), 1.03, 0.1);
  main.add(new PushPullKnob(env, { id: 'demo.throttle', var: DEMO_VARS.throttle, label: 'THROTTLE', style: 'throttle', legend: 'THROTTLE', axis: { var: INPUT.throttle(1) } }), 1.1, 0.28);
  main.add(new PushPullKnob(env, { id: 'demo.mixture', var: DEMO_VARS.mixture, label: 'MIXTURE', style: 'mixture', legend: 'MIXTURE' }), 1.16, 0.28);

  // Circuit breakers.
  main.add(new CircuitBreaker(env, { id: 'demo.cb.pitot', var: DEMO_VARS.cbPitot, trippedVar: DEMO_VARS.cbPitotTrip, label: 'PITOT HT', rating: 10, name: 'PITOT HT' }), 1.25, 0.08);
  main.add(new CircuitBreaker(env, { id: 'demo.cb.avn', var: DEMO_VARS.cbAvn, label: 'AVN BUS', rating: '7.5', name: 'AVN', pullable: false }), 1.28, 0.08);

  // --- Overhead panel (data-table layout) -------------------------------------
  const ovhd = b.panel({ name: 'overhead', center_m: [0.3, 0, -1.42], facing: 'down', tiltDeg: -15, width: 0.5, height: 0.3, origin: 'top-left', screws: { kind: 'slot', diameter: 0.006 } });
  ovhd.bracket('EXTERIOR LIGHTS', 0.14, 0.03, 0.22);
  b.addSwitchRow(ovhd, { x: 0.05, y: 0.07, spacing: 0.045 }, [
    { type: 'toggle', id: 'demo.ovhd.beacon', var: 'ac.demo.beacon', label: 'BEACON', labels: { name: 'BEACON', positions: true } },
    { type: 'toggle', id: 'demo.ovhd.strobe', var: 'ac.demo.strobe', label: 'STROBE', labels: { name: 'STROBE', positions: true } },
    { type: 'spacer', gap: 0.03 },
    { type: 'button', id: 'demo.ovhd.wing', var: 'ac.demo.wing_lt', mode: 'toggle', label: 'WING', segments: [{ text: 'ON', color: 'green', whenOn: true }], caption: 'WING' },
    { type: 'placard', text: 'DEMO', style: 'plate', height: 0.003 },
  ]);
  b.addGrid(ovhd, { x: 0.05, y: 0.19, dx: 0.025, dy: 0.04 }, [
    [
      { type: 'breaker', id: 'demo.ovhd.cb1', var: 'ac.demo.cb1', rating: 5, name: 'NAV 1' },
      { type: 'breaker', id: 'demo.ovhd.cb2', var: 'ac.demo.cb2', rating: 5, name: 'NAV 2' },
      null,
      { type: 'breaker', id: 'demo.ovhd.cb3', var: 'ac.demo.cb3', rating: 15, name: 'FUEL' },
    ],
    [{ type: 'annunciator', id: 'demo.ovhd.a1', label: 'LOW PRESS', segments: [{ text: ['LOW', 'PRESS'], color: 'amber', var: 'ac.demo.cb3', test: (v) => v === 0 }] }],
  ]);

  // --- Pedestal -----------------------------------------------------------------
  const ped = b.panel({ name: 'pedestal', center_m: [0.5, 0, -0.618], facing: 'up', tiltDeg: -9, width: 0.28, height: 0.46 });
  const tlDetents = [
    { value: -0.3, label: 'REV' },
    { value: 0, label: 'IDLE', kind: 'gate' as const, direction: 'decreasing' as const },
    { value: 0.7, label: 'CRU' },
    { value: 0.85, label: 'CLB' },
    { value: 1, label: 'TO' },
  ];
  ped.add(new Lever(env, { id: 'demo.tl1', var: DEMO_VARS.tla1, label: 'THRUST L', min: -0.3, max: 1, detents: tlDetents, knob: 'throttle', detentLabels: 'left', axis: { var: INPUT.throttle(1) } }), -0.03, 0.05);
  ped.add(new Lever(env, { id: 'demo.tl2', var: DEMO_VARS.tla2, label: 'THRUST R', min: -0.3, max: 1, detents: tlDetents, knob: 'throttle', axis: { var: INPUT.throttle(2) } }), 0.03, 0.05);
  ped.add(
    new Lever(env, {
      id: 'demo.flaps',
      var: DEMO_VARS.flaps,
      label: 'FLAPS',
      min: 0,
      max: 3,
      discrete: true,
      detents: [
        { value: 0, label: 'UP' },
        { value: 1, label: '1', kind: 'gate' },
        { value: 2, label: '15' },
        { value: 3, label: '35' },
      ],
      travel: { kind: 'arc', minDeg: 25, maxDeg: -25, pivotDepth: 0.05 },
      knob: 'flap',
      armLength: 0.09,
      detentLabels: 'right',
      format: (v) => v.toFixed(0),
    }),
    0.1,
    -0.05,
  );
  ped.add(
    new Lever(env, {
      id: 'demo.spdbrk',
      var: DEMO_VARS.spdbrk,
      label: 'SPEEDBRAKE',
      min: 0,
      max: 1,
      detents: [
        { value: 0, label: 'DN', kind: 'gate', direction: 'increasing' },
        { value: 0.1, label: 'ARM' },
        { value: 1, label: 'UP' },
      ],
      knob: 'speedbrake',
      armLength: 0.08,
      detentLabels: 'left',
    }),
    -0.1,
    0.02,
  );
  ped.add(
    new Lever(env, {
      id: 'demo.cutoff',
      var: DEMO_VARS.cutoff,
      label: 'FUEL CUTOFF',
      min: 0,
      max: 1,
      discrete: true,
      detents: [
        { value: 0, label: 'CUTOFF', kind: 'gate' },
        { value: 1, label: 'RUN', kind: 'gate' },
      ],
      travel: { kind: 'arc', minDeg: -15, maxDeg: 15, pivotDepth: 0.03 },
      knob: 'start',
      armLength: 0.055,
      detentLabels: 'right',
    }),
    0.05,
    -0.12,
  );
  ped.add(
    new TrimWheel(env, {
      id: 'demo.trim',
      var: DEMO_VARS.trim,
      label: 'PITCH TRIM',
      perRev: 0.25,
      diameter: 0.2,
      stripes: true,
      handle: true,
      indicator: { length: 0.08, offset: [0.035, 0, 0], marks: [{ value: -1, label: 'DN' }, { value: 0, label: 'TO' }, { value: 1, label: 'UP' }], band: [-0.2, 0.3] },
    }),
    -0.12,
    -0.15,
    { rotDeg: 0 },
  );
  ped.add(
    new FuelSelector(env, {
      id: 'demo.fuelsel',
      var: DEMO_VARS.fuelSel,
      label: 'FUEL SELECTOR',
      positions: [
        { value: 0, label: 'LEFT', angle: -90 },
        { value: 1, label: 'BOTH', angle: 0 },
        { value: 2, label: 'RIGHT', angle: 90 },
        { value: 3, label: 'OFF', angle: 180, gated: true },
      ],
      wrap: true,
      initial: 1,
      sublabels: ['26 GAL', '53 GAL', '26 GAL', ''],
    }),
    0.0,
    -0.17,
  );
  const cdu = ped.add(
    new KeyPad(env, {
      id: 'demo.cdu',
      label: 'CDU',
      eventPrefix: 'demo.cdu.',
      keyboard: true,
      rows: [
        [{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }, { id: 'E' }],
        [{ id: '1' }, { id: '2' }, { id: '3' }, { id: 'CLR' }, { id: 'EXEC', lightVar: 'ac.demo.exec_lt' }],
        [{ id: 'SP', w: 2, label: 'SPACE' }, { id: 'DEL' }, { id: 'ENT', w: 2 }],
      ],
      lights: [{ text: 'MSG', color: 'white', var: 'ac.demo.exec_lt', x: 0.07, y: 0.008 }],
    }),
    -0.1,
    0.2,
  );
  void cdu;

  // --- Yoke and pedals (pilot side) -------------------------------------------------
  b.place(
    new Yoke(env, {
      id: 'demo.yoke',
      label: 'CONTROL WHEEL',
      style: 'bizjet',
      pitchVar: SURF.elevator,
      rollVar: SURF.aileron,
      switches: [
        { anchor: 'leftOutboard', kind: 'button', options: { id: 'demo.yoke.apdisc', var: DEMO_VARS.apDisc, label: 'AP DISC', capMaterial: 'knobRed' } },
        {
          anchor: 'leftTop',
          kind: 'rocker',
          options: { id: 'demo.yoke.trim', var: DEMO_VARS.yokeTrim, label: 'PITCH TRIM', positions: ['NOSE UP', 'OFF', 'NOSE DN'], values: [1, 0, -1], initial: 1, springs: { 0: 1, 2: 1 } },
        },
        { anchor: 'leftInboard', kind: 'button', options: { id: 'demo.yoke.ptt', var: DEMO_VARS.ptt, label: 'PTT' } },
      ],
    }),
    { center_m: [0.5, -0.36, -0.86], facing: 'aft' },
  );
  b.place(new RudderPedals(env, { id: 'demo.pedals', label: 'RUDDER PEDALS', style: 'hanging' }), { center_m: [0.95, -0.36, -0.35], facing: 'aft' });

  // --- Demo "system": every control drives something visible -------------------
  const gearState = { last: vars.get(DEMO_VARS.gear), t: 0 };
  b.onUpdate((dt) => {
    const on = vars.get(DEMO_VARS.batt) !== 0;
    vars.set(DEMO_VARS.busV, on ? 24.5 + (vars.get(DEMO_VARS.gen) ? 3.5 : 0) : 0);
    vars.set(DEMO_VARS.genFail, on && vars.get(DEMO_VARS.gen) === 0 ? 1 : 0);
    vars.set('display.demo.power', on ? 1 : 0);
    vars.set('display.demo.brt', 0.3 + 0.7 * vars.get(DEMO_VARS.panelLt));
    // Gear transit light for 4 s after handle movement.
    const g = vars.get(DEMO_VARS.gear);
    const st = gearState;
    if (g !== st.last) {
      st.last = g;
      st.t = 4;
    }
    st.t = Math.max(0, st.t - dt);
    vars.set(DEMO_VARS.gearTransit, on && st.t > 0 ? 1 : 0);
    vars.set('ac.demo.exec_lt', vars.getString(DEMO_VARS.cdu).length > 0 ? 1 : 0);
    // Demo fault: the PITOT HT breaker trips when the strobes run on battery only (bus < 25 V).
    if (on && vars.get(DEMO_VARS.cbPitot) === 1 && vars.get('ac.demo.strobe') !== 0 && vars.get(DEMO_VARS.busV) < 25) {
      vars.set(DEMO_VARS.cbPitot, 0);
      vars.set(DEMO_VARS.cbPitotTrip, 1);
    }
  });
  host.events.on('demo.cdu.CLR', () => vars.setString(DEMO_VARS.cdu, ''));
  host.events.on('demo.cdu.DEL', () => vars.setString(DEMO_VARS.cdu, vars.getString(DEMO_VARS.cdu).slice(0, -1)));
  for (const k of ['A', 'B', 'C', 'D', 'E', '1', '2', '3']) host.events.on(`demo.cdu.${k}`, () => vars.setString(DEMO_VARS.cdu, (vars.getString(DEMO_VARS.cdu) + k).slice(-12)));
  host.events.on('demo.cdu.SP', () => vars.setString(DEMO_VARS.cdu, `${vars.getString(DEMO_VARS.cdu)} `.slice(-12)));

  // A cockpit-local marker for the eye position (helps visual QA of frames).
  const eye = new THREE.Object3D();
  eye.name = 'eyeMarker';
  eye.position.copy(bl(...DEMO_EYE));
  b.root.add(eye);
  return b.build();
}
