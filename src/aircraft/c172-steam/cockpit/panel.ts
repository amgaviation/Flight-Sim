/**
 * Cessna 172S NAV II instrument panel (POH 172SPHUS Rev 5 Fig 7-2 items 1-15, 22-23, 40; Sec 7
 * "Instrument panel"): the grey upper panel with the shock-mounted flight-instrument sub-panel
 * (basic "T" around the gyros), the engine cluster and Davtron clock on the left sub-panel, the
 * annunciator panel with its TST / BRT / DIM switch above the altimeter, the right-hand pilot
 * sub-panel with the #1 CDI (KI 209A, NAV 1 or GPS through the NAV/GPS switch-annunciator), the
 * #2 CDI (KI 208), the ADF bearing indicator (KI 227) and the recording tachometer, the avionics
 * circuit-breaker strip, and on the right panel the ELT remote switch and the hour meter.
 *
 * Positions: layout.ts POS (measured on Fig 7-2). Instruments are the shared analog library
 * (src/avionics/analog); the directional gyro shares the system gyro (systems.ts
 * SteamDirectionalGyro) so the card the pilot sets with the ADJ knob is the KAP 140 heading datum.
 */
import * as THREE from 'three';
import type { SimContext } from '../../../core/SimContext';
import type { CockpitBuilder, Panel } from '../../../cockpit/CockpitBuilder';
import { AnnunciatorLight, CircuitBreaker, PushButton, RockerSwitch, ToggleSwitch } from '../../../cockpit/controls';
import { extrude, cylinderZ, roundedBox } from '../../../cockpit/geometry/primitives';
import {
  AdfIndicator,
  AirspeedIndicator,
  Altimeter,
  AnalogAttitudeIndicator,
  AnalogVerticalSpeedIndicator,
  CourseIndicator,
  DavtronClock,
  DirectionalGyro,
  EgtFuelFlowGauge,
  FuelQuantityGauge,
  HeadingIndicator,
  INSTRUMENT_SIZE,
  OilTempPressGauge,
  Tachometer,
  TurnCoordinator,
  VacuumAmmeterGauge,
  type AnalogGauge,
  type HeadingIndicatorOptions,
} from '../../../avionics/analog';
import type { CockpitDisplay } from '../../../cockpit/types';
import { ANN, ANN_SW, C172, ELT_SW } from '../../c172s-common/vars';
import { STEAM_BREAKERS } from '../../c172s-common/systems/electrical';
import { KAP, KLN, ST } from '../vars';
import { CDI1_RECEIVER } from '../systems';
import type { C172SteamSystems } from '../createSystems';
import { IN, PANEL, PANEL_CENTER, PANEL_CORNER_IN, PANEL_H, PANEL_W, POS, px, py } from './layout';

/** Combined annunciator legends written by systems.ts SteamCabinExtras. */
export const ANN_ANY = { lowFuel: 'ac.c172s.ann_low_fuel', vac: 'ac.c172s.ann_vac' } as const;

/**
 * Directional gyro indicator driven by the system gyro (systems.ts SteamDirectionalGyro): the
 * instrument shows and adjusts the same DirectionalGyro instead of running its own, so the ADJ
 * knob sets the heading the KAP 140 flies and headless runs keep the gyro without a cockpit.
 */
class SteamHeadingIndicator extends HeadingIndicator {
  constructor(o: HeadingIndicatorOptions, gyro: DirectionalGyro) {
    super(o);
    (this as unknown as { gyro: DirectionalGyro }).gyro = gyro;
  }
  protected override updateGauge(_dt: number): void {
    // The system integrates the gyro at 60 Hz; dt = 0 only repaints the card and the bug.
    super.updateGauge(0);
  }
}

export interface PanelParts {
  panel: Panel;
  gauges: AnalogGauge[];
}

/** Grey upper panel outline (rounded upper corners, Fig 7-2), in the panel frame's centred (u, v) metres. */
function upperPanelShape(): THREE.Shape {
  const W = PANEL_W / 2;
  const top = PANEL_H / 2;
  const bot = PANEL_H / 2 - PANEL.upperIn * IN;
  const r = PANEL_CORNER_IN * IN;
  const s = new THREE.Shape();
  s.moveTo(-W, bot);
  s.lineTo(W, bot);
  s.lineTo(W, top - r);
  s.quadraticCurveTo(W, top, W - r, top);
  s.lineTo(-W + r, top);
  s.quadraticCurveTo(-W, top, -W, top - r);
  s.closePath();
  return s;
}

export function buildMainPanel(b: CockpitBuilder, ctx: SimContext, sys: C172SteamSystems, displays: Map<string, CockpitDisplay>, analog: boolean): PanelParts {
  const env = b.env;
  const mats = env.materials;
  const vars = ctx.vars;
  const panel = b.panel({
    name: 'c172s.panel',
    center_m: PANEL_CENTER,
    facing: 'aft',
    tiltDeg: PANEL.tiltDeg,
    width: PANEL_W,
    height: PANEL_H,
    origin: 'top-left',
    invisible: true,
  });

  // ---------------------------------------------------------------- plates
  const grey = mats.get('panel');
  const plate = new THREE.Mesh(extrude(upperPanelShape(), { depth: 0.0032, bevel: 0.0008, bevelSegments: 1, anchor: 'front0' }), grey);
  plate.name = 'upper_panel';
  plate.userData.cockpitStatic = true;
  b.trackGeometry(plate.geometry);
  panel.group.add(plate);
  // Shock-mounted flight-instrument sub-panel (raised 2 mm, screws at the corners).
  const sp = POS.sixPack;
  panel.subPanel({
    name: 'c172s.sixpack',
    x: px((sp.X0 + sp.X1) / 2),
    y: py((sp.Z0 + sp.Z1) / 2),
    z: 0.0005,
    width: (sp.X1 - sp.X0) * IN,
    height: (sp.Z1 - sp.Z0) * IN,
    thickness: 0.002,
    radius: 0.004,
    material: grey,
    screws: { kind: 'phillips', diameter: 0.005, pitch: 0.09, inset: 0.007 },
  });
  // Radio-rack opening behind the stack (dark), the right panel edge line between the sub-panels.
  const st = POS.stack;
  const rack = new THREE.Mesh(env.geometry.get('c172s.rack', () => roundedBox((st.X1 - st.X0) * IN, (st.Z1 - st.Z0) * IN, 0.01, 0.002)), mats.get('panelDark'));
  rack.userData.cockpitStatic = true;
  panel.addObject(rack, px((st.X0 + st.X1) / 2), py((st.Z0 + st.Z1) / 2), { z: -0.004 });
  panel.line(px(-4.2), py(0.2), px(-4.2), py(13.1), 0.0006, null);
  panel.line(px(0.1), py(0.2), px(0.1), py(13.1), 0.0006, null);
  panel.line(px(6.8), py(0.2), px(6.8), py(13.1), 0.0006, null);

  // Registration placard (Fig 7-2), SMOKING PROHIBITED, the seat-latch warning placard.
  panel.placard({ text: 'N172SP', style: 'plate', height: 0.0045, plateColor: '#101010', color: '#e8e8e8', zone: null }, px(POS.regPlacard.X), py(POS.regPlacard.Z));
  panel.label('SMOKING PROHIBITED', px(10.6), py(0.7), { height: 0.0024, zone: null, color: '#e6e6e0' });
  panel.label('WARNING\nASSURE THAT SEAT IS LOCKED IN POSITION PRIOR TO TAXI,\nTAKE-OFF AND LANDING. FAILURE TO PROPERLY LATCH SEAT\nCAN RESULT IN SERIOUS INJURY OR DEATH.', px(-15.5), py(9.9), { height: 0.0016, zone: null, color: '#f1d27a', align: 'center' });

  // ---------------------------------------------------------------- flight and engine instruments
  const gauges: AnalogGauge[] = [];
  if (analog) {
    const common = { vars, audio: ctx.audio, materials: { bezel: mats.get('bezel'), knob: mats.get('knob'), screw: mats.get('screw') } };
    const add = <T extends AnalogGauge>(g: T, p: { X: number; Z: number }): T => {
      panel.add(g, px(p.X), py(p.Z), { z: 0.0021 });
      gauges.push(g);
      return g;
    };
    const S2 = INSTRUMENT_SIZE.ATI2;
    add(new AirspeedIndicator({ id: 'c172s.asi', name: 'Airspeed indicator', ...common }), POS.asi);
    add(new AnalogAttitudeIndicator({ id: 'c172s.ai', name: 'Attitude indicator (vacuum)', ...common }), POS.ai);
    add(new Altimeter({ id: 'c172s.alt', name: 'Altimeter', ...common }), POS.alt);
    add(new TurnCoordinator({ id: 'c172s.tc', name: 'Turn coordinator', ...common }), POS.tc);
    add(new SteamHeadingIndicator({ id: 'c172s.dg', name: 'Directional gyro (vacuum)', ...common }, sys.dg.gyro), POS.dg);
    add(new AnalogVerticalSpeedIndicator({ id: 'c172s.vsi', name: 'Vertical speed indicator', ...common }), POS.vsi);
    add(new CourseIndicator({ id: 'c172s.cdi1', name: 'KI 209A course deviation / glideslope (NAV 1 / GPS)', receiver: CDI1_RECEIVER, glideslope: true, ...common }), POS.cdi1);
    add(new CourseIndicator({ id: 'c172s.cdi2', name: 'KI 208 course deviation (NAV 2)', receiver: 2, ...common }), POS.cdi2);
    add(new AdfIndicator({ id: 'c172s.adf', name: 'KI 227 ADF bearing indicator', receiver: 1, ...common }), POS.adf);
    add(new Tachometer({ id: 'c172s.tach', name: 'Recording tachometer', engine: 1, initialHours: 1873.4, ...common }), POS.tach);
    add(new FuelQuantityGauge({ id: 'c172s.fuel_qty', name: 'Fuel quantity L / R', size: S2, ...common }), POS.fuelQty);
    add(new EgtFuelFlowGauge({ id: 'c172s.egt_ff', name: 'EGT / fuel flow', size: S2, engine: 1, ...common }), POS.egtFf);
    add(new OilTempPressGauge({ id: 'c172s.oil', name: 'Oil temperature / pressure', size: S2, engine: 1, ...common }), POS.oil);
    add(new VacuumAmmeterGauge({ id: 'c172s.vac_amp', name: 'Vacuum / ammeter', size: S2, ...common }), POS.vacAmp);
    add(new DavtronClock({ id: 'c172s.clock', name: 'Davtron M803 clock / OAT / voltmeter', ...common }), POS.clock);
    // Instrument captions printed on the panel under the engine cluster.
    panel.label('FUEL QTY', px(POS.fuelQty.X), py(POS.fuelQty.Z + 1.45), { height: 0.0018, zone: null });
    panel.label('EGT/FUEL FLOW', px(POS.egtFf.X), py(POS.egtFf.Z + 1.45), { height: 0.0018, zone: null });
  }

  // ---------------------------------------------------------------- annunciator panel (item 13) and its switch
  const ap = POS.annPanel;
  const annBack = new THREE.Mesh(env.geometry.get('c172s.ann_back', () => roundedBox(ap.w * IN, ap.h * IN, 0.006, 0.002)), mats.get('plasticBlack'));
  annBack.userData.cockpitStatic = true;
  panel.addObject(annBack, px(ap.X), py(ap.Z), { z: 0.003 });
  const cellW = 0.57 * IN;
  const cellH = 0.42 * IN;
  const cells: { id: string; segs: ConstructorParameters<typeof AnnunciatorLight>[1]['segments'] }[] = [
    {
      id: 'low_fuel',
      segs: [
        { text: 'L', color: 'amber', var: ANN.lamp('low_fuel_l'), test: (v) => v > 0.05 },
        { text: ['LOW', 'FUEL'], color: 'amber', var: ANN_ANY.lowFuel, test: (v) => v > 0.05 },
        { text: 'R', color: 'amber', var: ANN.lamp('low_fuel_r'), test: (v) => v > 0.05 },
      ],
    },
    { id: 'oil_press', segs: [{ text: ['OIL', 'PRESS'], color: 'red', var: ANN.lamp('oil_press'), test: (v) => v > 0.05 }] },
    {
      id: 'vac',
      segs: [
        { text: 'L', color: 'amber', var: ANN.lamp('vac_l'), test: (v) => v > 0.05 },
        { text: 'VAC', color: 'amber', var: ANN_ANY.vac, test: (v) => v > 0.05 },
        { text: 'R', color: 'amber', var: ANN.lamp('vac_r'), test: (v) => v > 0.05 },
      ],
    },
    { id: 'volts', segs: [{ text: 'VOLTS', color: 'red', var: ANN.lamp('volts'), test: (v) => v > 0.05 }] },
    // KAP 140 installations: red PITCH TRIM on the airplane annunciator panel (Supplement 15 item 17).
    { id: 'pitch_trim', segs: [{ text: ['PITCH', 'TRIM'], color: 'red', var: KAP.pitchTrimLamp, test: (v) => v > 0.05 }] },
  ];
  // Cell widths (in): the split L / R cells are wider (EST from the photograph, 3.0 in total).
  const widths = [0.78, 0.5, 0.66, 0.5, 0.5];
  let cx = ap.X - ap.w / 2 + 0.03;
  cells.forEach((c, i) => {
    const w = widths[i];
    panel.add(
      new AnnunciatorLight(env, {
        id: `c172s.ann.${c.id}`,
        label: `Annunciator ${c.id.replace('_', ' ').toUpperCase()}`,
        segments: c.segs,
        layout: c.segs.length > 1 ? 'split' : 'stack',
        width: (w - 0.04) * IN,
        height: cellH,
        bezel: false,
      }),
      px(cx + w / 2),
      py(ap.Z),
      { z: 0.0062 },
    );
    cx += w;
  });
  void cellW;
  // POH Sec 7 "Annunciator panel": TST (momentary) / BRT / DIM toggle right of the panel.
  panel.add(
    new ToggleSwitch(env, {
      id: 'c172s.ann_switch',
      label: 'ANNUNCIATOR PANEL switch (TST / BRT / DIM)',
      var: C172.annSwitch,
      positions: ['DIM', 'BRT', 'TST'],
      values: [ANN_SW.night, ANN_SW.day, ANN_SW.test],
      initial: 1,
      springs: { 2: 1 },
      scale: 0.55,
      labels: { positions: false },
    }),
    px(POS.annSwitch.X),
    py(POS.annSwitch.Z),
  );
  panel.label('TST', px(POS.annSwitch.X - 0.05), py(POS.annSwitch.Z - 0.42), { height: 0.0017, zone: null });
  panel.label('BRT', px(POS.annSwitch.X + 0.42), py(POS.annSwitch.Z), { height: 0.0017, zone: null });
  panel.label('DIM', px(POS.annSwitch.X - 0.05), py(POS.annSwitch.Z + 0.42), { height: 0.0017, zone: null });

  // ---------------------------------------------------------------- NAV/GPS switch-annunciator and KLN 94 annunciators (Supplement 19 Fig 2)
  // EST arrangement: the square switch-annunciator above the #1 CDI (photograph), with the KLN 94
  // external annunciators (message, waypoint alert, approach arm / active) beside it; the KLN 94
  // lights them all during its self test (Pilot's Guide 3.2 step 3).
  panel.add(
    new PushButton(env, {
      id: 'c172s.navgps',
      label: 'NAV/GPS switch-annunciator (#1 CDI / KAP 140 source)',
      var: ST.navGpsBtn,
      mode: 'momentary',
      style: 'korry',
      width: 0.017,
      height: 0.017,
      segments: [
        { text: 'NAV', color: 'green', var: 'ac.c172s.ann_nav' },
        { text: 'GPS', color: 'cyan', var: 'ac.c172s.ann_gps' },
      ],
    }),
    px(POS.navGps.X - 0.55),
    py(POS.navGps.Z),
  );
  const klnAnn: { id: string; text: string; color: 'amber' | 'green' | 'white'; v: string; t: (x: number) => boolean }[] = [
    { id: 'msg', text: 'MSG', color: 'amber', v: 'ac.c172s.ann_kln_msg', t: (x) => x > 0.5 },
    { id: 'wpt', text: 'WPT', color: 'amber', v: 'ac.c172s.ann_kln_wpt', t: (x) => x > 0.5 },
    { id: 'apr', text: 'APR', color: 'green', v: 'ac.c172s.ann_kln_apr', t: (x) => x > 0.5 },
  ];
  klnAnn.forEach((a, i) =>
    panel.add(
      new AnnunciatorLight(env, { id: `c172s.kln_ann.${a.id}`, label: `KLN 94 ${a.text} annunciator`, segments: [{ text: a.text, color: a.color, var: a.v, test: a.t }], width: 0.012, height: 0.008 }),
      px(POS.navGps.X + 0.2 + i * 0.52),
      py(POS.navGps.Z),
    ),
  );
  void KLN;

  // ---------------------------------------------------------------- avionics circuit-breaker panel (item 40)
  const ac = POS.avnCb;
  const avn = panel.subPanel({
    name: 'c172s.avn_cb',
    x: px((ac.X0 + ac.X1) / 2),
    y: py((ac.Z0 + ac.Z1) / 2),
    z: 0.0006,
    width: (ac.X1 - ac.X0) * IN,
    height: (ac.Z1 - ac.Z0) * IN,
    origin: 'top-left',
    material: mats.custom('paint', '#1c1d1f', 0.7),
    thickness: 0.0025,
    radius: 0.003,
    screws: { positions: [[0.006, 0.006], [(ac.X1 - ac.X0) * IN - 0.006, 0.006], [0.006, (ac.Z1 - ac.Z0) * IN - 0.006], [(ac.X1 - ac.X0) * IN - 0.006, (ac.Z1 - ac.Z0) * IN - 0.006]] },
  });
  // Photograph: "NAV COM 2, XPNDR, ADF, AUTO PILOT" on the right with "AVIONICS" below; the BUS 1
  // group (AVN FAN, GPS, GYRO, NAV COM 1, POH Fig 7-7A) on the left (order EST).
  const avnOrder: { name: string; text: string }[] = [
    { name: 'avn_fan', text: 'AVN\nFAN' },
    { name: 'gps', text: 'GPS' },
    { name: 'gyro', text: 'GYRO' },
    { name: 'nav_com1', text: 'NAV\nCOM 1' },
    { name: 'nav_com2', text: 'NAV\nCOM 2' },
    { name: 'xpndr', text: 'XPNDR' },
    { name: 'adf', text: 'ADF' },
    { name: 'autopilot', text: 'AUTO\nPILOT' },
  ];
  avnOrder.forEach((c, i) => {
    const def = STEAM_BREAKERS.find((x) => x.name === c.name)!;
    const x = (0.75 + i * 0.98 + (i >= 4 ? 0.35 : 0)) * IN;
    avn.add(new CircuitBreaker(env, { id: `c172s.cb.${c.name}`, label: `${def.label} circuit breaker (${def.ratingA} A)`, var: `cb.${c.name}`, trippedVar: `cb.${c.name}_tripped`, rating: def.ratingA, diameter: 0.0095 }), x, 0.9 * IN);
    avn.label(c.text, x, 0.36 * IN, { height: 0.0017 });
  });
  avn.label('AVIONICS', 5.0 * IN, 1.32 * IN, { height: 0.0019 });
  avn.label('BUS 1', 2.2 * IN, 1.32 * IN, { height: 0.0016 });

  // ---------------------------------------------------------------- right panel: ELT (item 22), hour meter (item 23)
  panel.add(
    new RockerSwitch(env, {
      id: 'c172s.elt',
      label: 'ELT remote switch (ON / ARM / TEST-RESET)',
      var: C172.elt,
      positions: ['TEST', 'ARM', 'ON'],
      values: [ELT_SW.reset, ELT_SW.arm, ELT_SW.on],
      initial: 1,
      springs: { 0: 1 },
      width: 0.011,
      height: 0.02,
      indicator: { var: C172.eltTx, color: 'red' },
      capMaterial: 'plasticBlack',
    }),
    px(POS.elt.X),
    py(POS.elt.Z),
  );
  panel.label('ELT', px(POS.elt.X), py(POS.elt.Z - 0.55), { height: 0.0022, zone: null });
  panel.label('ON', px(POS.elt.X + 0.4), py(POS.elt.Z - 0.25), { height: 0.0016, zone: null });
  panel.label('ARM', px(POS.elt.X + 0.45), py(POS.elt.Z + 0.25), { height: 0.0016, zone: null });
  const hobbs = displays.get('hobbs');
  if (hobbs) {
    const hb = new THREE.Mesh(env.geometry.get('c172s.hobbs_case', () => roundedBox(0.044, 0.018, 0.008, 0.002)), mats.get('plasticBlack'));
    hb.userData.cockpitStatic = true;
    panel.addObject(hb, px(POS.hobbs.X), py(POS.hobbs.Z), { z: 0.004 });
    panel.display(hobbs, px(POS.hobbs.X), py(POS.hobbs.Z), 0.034, 0.0085, { bezel: false, z: 0.0085 });
  }
  panel.label('HOURS', px(POS.hobbs.X), py(POS.hobbs.Z + 0.4), { height: 0.0017, zone: null });

  // ---------------------------------------------------------------- control-wheel column bushings (static)
  for (const s of [-1, 1]) {
    const col = new THREE.Mesh(env.geometry.get('c172s.col_bushing', () => cylinderZ(0.022, 0.02, 0, 0.006, 32)), mats.get('plasticBlack'));
    col.userData.cockpitStatic = true;
    panel.addObject(col, px(s * POS.yokeCol.X), py(POS.yokeCol.Z), { z: 0.001 });
  }

  // Combined annunciator legends ("LOW FUEL" lit with either side, "VAC" likewise) and the
  // KLN 94 external annunciators: written by SteamCabinExtras (systems.ts).
  void vars;
  return { panel, gauges };
}
