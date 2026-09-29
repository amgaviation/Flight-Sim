/**
 * Cessna 172S NAV III (G1000 NXi / GFC 700) instrument panel, POH 172SPHBUS-00 Fig 7-2 items 1-34.
 *
 * Positions are the photograph measurements of layout.ts (X inches right of the centreline, Z inches
 * below the upper edge; +/-0.2 in); where the photograph hides an item (behind the control wheels)
 * the position is EST and says so. Everything is placed on one panel frame (`c172g.panel`) whose
 * plates are:
 *  - the textured grey upper panel (PFD, audio panel, MFD, placards, ELT, hour meter),
 *  - the dark-grey electrical switch panel under the lower-left corner of the PFD (POH Sec 7: "an
 *    internally lighted subpanel found below the lower left corner of the PFD") with the STBY BATT,
 *    MASTER and AVIONICS switches above it,
 *  - the standby-instrument plate under the audio panel,
 *  - the black lower panel: circuit breakers and MAGNETOS switch (left), engine controls, ALT STATIC
 *    AIR and GO-AROUND (centre), wing flaps and cabin heat / air (right of centre), glove box (right).
 *
 * Lighting zones: 'panel' = the internally lit switch, circuit-breaker, engine-control and environmental
 * panels (SW/CB PANELS dimmer, POH Sec 7 "Interior lighting"), 'stby' = standby instruments (STBY IND
 * dimmer), 'pedestal' = the LED strip on the throttle / flap panel (PEDESTAL dimmer).
 */
import * as THREE from 'three';
import type { SimContext } from '../../../core/SimContext';
import { ADC, SURF } from '../../../core/vars';
import type { CockpitBuilder, Panel } from '../../../cockpit/CockpitBuilder';
import type { CockpitDisplay } from '../../../cockpit/types';
import {
  CircuitBreaker,
  Lever,
  PushButton,
  PushPullKnob,
  RockerSwitch,
  RotaryKnob,
  SelectorKnob,
  TBarHandle,
  ToggleSwitch,
} from '../../../cockpit/controls';
import { cylinderZ, extrude, roundedBox, roundedRectShape } from '../../../cockpit/geometry/primitives';
import { ATI3_HOLE } from '../../../cockpit/geometry/panel';
import { AirspeedIndicator, Altimeter, AnalogAttitudeIndicator } from '../../../avionics/analog';
import type { G1000Resolved } from '../../../avionics/garmin-g1000/config';
import { C172, MAG, STBY_BATT } from '../../c172s-common/vars';
import { G1000_BREAKERS } from '../../c172s-common/systems/electrical';
import { FLAP_DETENTS } from '../../c172s-common/data';
import { C172G, ELT_ROCKER } from '../vars';
import { GDU_MM, GMA_MM, NullDisplay, buildGdu, buildGma } from './gdu';
import { JewelLamp } from './jewelLamp';
import { IN, LOWER_PANEL_Z, PANEL, PANEL_CENTER, PANEL_H, glareSagIn, px, py } from './layout';

/** Standby instrument lighting var (STBY IND dimmer, c172s-common lighting.ts). */
export const STBY_LIGHT = 'ac.light.stby_ind';

export interface PanelBuildContext {
  b: CockpitBuilder;
  ctx: SimContext;
  cfg: G1000Resolved;
  displays: Map<string, CockpitDisplay>;
  /** Build the canvas-textured electromechanical standby instruments (needs a DOM or OffscreenCanvas). */
  analog: boolean;
}

// ---------------------------------------------------------------- measured positions (inches, see header)

/** GDU / GMA bezel upper-left corners. */
const PFD_TL = { X: -15.34, Z: 1.01 };
const GMA_TL = { X: -2.38, Z: 1.01 };
const MFD_TL = { X: -0.55, Z: 1.01 };
/** Standby airspeed, attitude, altimeter centres (3-1/8 in cases). */
const STBY = { asi: -2.1, ai: 1.72, alt: 5.41, Z: 11.28 };
/** Circuit-breaker rows (X-FEED / ESS, ELEC 1 / AVN 1, ELEC 2 / AVN 2) and columns. */
const CB_ROWS = [14.55, 15.65, 16.75];
const CB_COLS_L = [-15.72, -14.88, -14.05, -13.27, -12.47, -11.66];
const CB_COLS_R = [-9.9, -9.1, -8.3, -7.5, -6.7, -5.9];

/**
 * Circuit-breaker panel layout (POH NAV III Fig 7-7 sheet 2, photograph "Cessna 172SP G1000 01/02.jpg"):
 * row by row, left panel ELECTRICAL buses, right panel ESSENTIAL / AVIONICS buses. null = empty hole.
 * SCOPE: the optional AVN BUS 1 FIS / ADF / DME breakers of the photographed airplane are left out
 * (equipment not installed in this simulation; the holes carry blank plugs).
 */
const CB_LEFT: (string | null)[][] = [
  ['alt_field', 'warn', null, null, null, null],
  ['fuel_pump', 'bcn_lt', 'land_lt', 'cabin_lts_pwr', 'flaps', 'avn1'],
  ['pitot_heat', 'nav_lts', 'taxi_lt', 'strobe_lts', 'panel_lts', 'avn2'],
];
const CB_RIGHT: (string | null)[][] = [
  ['pfd_ess', 'adc_ahrs_ess', 'nav1_eng_ess', 'comm1', 'stdby_ind_lts', 'stdby_batt'],
  ['pfd_avn1', 'adc_ahrs_avn1', 'nav1_eng_avn1', null, null, null],
  ['mfd', 'xpndr', 'nav2', 'comm2', 'audio', 'autopilot'],
];
/** Two-line breaker legends as engraved on the panel. */
const CB_TEXT: Record<string, string> = {
  alt_field: 'ALT\nFIELD',
  warn: 'WARN',
  fuel_pump: 'FUEL\nPUMP',
  bcn_lt: 'BCN\nLT',
  land_lt: 'LAND\nLT',
  cabin_lts_pwr: 'CABIN\nLTS/PWR',
  flaps: 'FLAPS',
  avn1: 'AVN\n1',
  pitot_heat: 'PITOT\nHEAT',
  nav_lts: 'NAV\nLTS',
  taxi_lt: 'TAXI\nLT',
  strobe_lts: 'STROBE\nLTS',
  panel_lts: 'PANEL\nLTS',
  avn2: 'AVN\n2',
  pfd_ess: 'PFD',
  adc_ahrs_ess: 'ADC\nAHRS',
  nav1_eng_ess: 'NAV 1\nENG',
  comm1: 'COMM 1',
  stdby_ind_lts: 'STDBY\nIND LTS',
  stdby_batt: 'STDBY\nBATT',
  pfd_avn1: 'PFD',
  adc_ahrs_avn1: 'ADC\nAHRS',
  nav1_eng_avn1: 'NAV 1\nENG',
  mfd: 'MFD',
  xpndr: 'XPNDR',
  nav2: 'NAV 2',
  comm2: 'COMM 2',
  audio: 'AUDIO',
  autopilot: 'AUTO\nPILOT',
};
/**
 * POH NAV III Sec 7 "Circuit breakers and fuses": the ESSENTIAL BUS, AVIONICS BUS 1 and 2 breakers can be
 * pulled; the ELECTRICAL BUS 1, 2 and CROSSFEED BUS breakers cannot (push-to-reset only).
 */
const PULLABLE_BUSES = new Set(['ess', 'avn1', 'avn2']);

const TXT = '#e9e9e4';

/** Adds a flat decorative plate (static) on the panel. */
function plate(b: CockpitBuilder, panel: Panel, name: string, X0: number, Z0: number, X1: number, Z1: number, mat: THREE.Material | 'panel' | 'panelDark', z = 0, thickness = 0.0016, radius = 0.004, holes: { X: number; Z: number; d: number }[] = []): Panel {
  const cx = (X0 + X1) / 2;
  const cz = (Z0 + Z1) / 2;
  return panel.subPanel({
    cutouts: holes.map((h) => ({ shape: 'circle' as const, u: (h.X - cx) * IN, v: (cz - h.Z) * IN, d: h.d })),
    name,
    x: px((X0 + X1) / 2),
    y: py((Z0 + Z1) / 2),
    width: (X1 - X0) * IN,
    height: (Z1 - Z0) * IN,
    thickness,
    radius,
    material: mat,
    screws: false,
    z,
  });
}

/** Engraved / printed text at panel inches. */
function text(b: CockpitBuilder, panel: Panel, t: string, X: number, Z: number, h: number, zone: string | null, z = 0, opts: { align?: 'left' | 'center' | 'right'; weight?: number; color?: string; box?: number } = {}): void {
  const l = b.env.labels.text(t, { height: h, weight: opts.weight ?? 700, zone, color: opts.color ?? TXT, align: opts.align, box: opts.box });
  l.userData.cockpitStatic = true;
  panel.addObject(l, px(X), py(Z), { z: z + 0.0002 });
}

/** Screw heads (static) at panel inches. */
function screws(b: CockpitBuilder, panel: Panel, pts: [number, number][], z = 0): void {
  const env = b.env;
  const geo = env.geometry.get('c172g.screw', () => {
    const g = new THREE.CylinderGeometry(0.0021, 0.0023, 0.0011, 16);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, 0.00055);
    return g;
  });
  const mat = env.materials.get('screwPhillips');
  for (const [X, Z] of pts) {
    const m = new THREE.Mesh(geo, mat);
    m.userData.cockpitStatic = true;
    panel.addObject(m, px(X), py(Z), { z });
  }
}

export interface InstrumentPanel {
  panel: Panel;
  /** GYRO flag mesh of the standby attitude indicator (animated by the cockpit hook). */
  gyroFlag: THREE.Object3D | null;
  /** Flap position pointer (animated by the cockpit hook from surf.flaps_deg). */
  flapPointer: THREE.Object3D;
  /** Ignition key bow group (hidden while the key is out). */
  keyBow: THREE.Object3D | null;
  /** Glove box door (hinged at its lower edge; opened by C172G.glovebox). */
  gloveDoor: THREE.Object3D;
}

export function buildInstrumentPanel(pc: PanelBuildContext): InstrumentPanel {
  const { b, cfg, displays } = pc;
  const env = b.env;
  const vars = pc.ctx.vars;
  const mats = env.materials;
  const W = PANEL.width;

  // Panel frame (face at FS 18, tilted 4 deg, top-left coordinates).
  const panel = b.panel({ name: 'c172g.panel', center_m: PANEL_CENTER, facing: 'aft', tiltDeg: PANEL.tiltDeg, width: W, height: PANEL_H, origin: 'top-left', invisible: true });

  // ---------------------------------------------------------------- plates
  // Upper panel: textured grey overlay from the glareshield lip to the lower panel (photograph).
  // Instrument holes (3-1/8 in) for the standby cluster: the dials sit in the holes, their black backing behind.
  const stbyHoles = [STBY.asi, STBY.ai, STBY.alt].map((X) => ({ X, Z: STBY.Z, d: ATI3_HOLE }));
  // Its top edge follows the glareshield arc (layout.ts GLARE_ARC: lower toward the ends, dropping around
  // the outboard corners under the glareshield ears), so it is an extruded outline rather than a rectangle.
  {
    const halfW = W / 2;
    const hPl = LOWER_PANEL_Z * IN;
    const sh = new THREE.Shape();
    sh.moveTo(-halfW, -hPl / 2);
    sh.lineTo(halfW, -hPl / 2);
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const Xin = (halfW / IN) * (1 - (2 * i) / n);
      sh.lineTo(Xin * IN, hPl / 2 - glareSagIn(Xin) * IN);
    }
    sh.closePath();
    for (const h of stbyHoles) {
      const hp = new THREE.Path();
      hp.absarc(h.X * IN, (LOWER_PANEL_Z / 2 - h.Z) * IN, h.d / 2, 0, Math.PI * 2, true);
      sh.holes.push(hp);
    }
    const g = env.geometry.get('c172g.upper_plate', () => extrude(sh, { depth: 0.004, bevel: 0.001, bevelSegments: 2, curveSegments: 32, anchor: 'front0' }));
    const m = new THREE.Mesh(g, mats.get('panel'));
    m.name = 'panelPlate:c172g.upper';
    m.userData.cockpitStatic = true;
    panel.addObject(m, px(0), py(LOWER_PANEL_Z / 2));
    b.occluders.push(m);
  }
  // Screws along the (arched) upper edge and around the display openings (photograph).
  screws(b, panel, [
    ...([-19.0, -15.9, -12, -8, -4, 0, 4, 7.9, 11.9, 15.7, 19.0] as const).map((X): [number, number] => [X, glareSagIn(X) + 0.32]),
    [-11.2, 13.25], [11.9, 13.2], [19.2, 13.2], [14.5, 9.4], [19.2, 6.5],
  ]);
  // Black lower panel (engine controls, breakers, flaps, cabin heat/air, glove box).
  const black = mats.custom('plastic', '#1d1d20', 0.78);
  plate(b, panel, 'c172g.lower', -PANEL.width / IN / 2, LOWER_PANEL_Z, PANEL.width / IN / 2, PANEL.heightIn, black, 0, 0.004, 0.01);
  screws(b, panel, [
    [-19.3, 14.1], [-19.3, 18.2], [-10.75, 14.1], [-10.75, 18.2], [-5.2, 14.1], [-5.2, 18.2], [5.2, 14.1], [5.2, 18.2], [11.4, 14.1], [11.4, 18.2], [19.3, 14.1], [19.3, 18.2],
  ]);
  // Dark-grey electrical switch panel (L-shaped: switches above the DIMMING / LIGHTS panel).
  const swGrey = mats.custom('paint', '#3c3e42', 0.7);
  plate(b, panel, 'c172g.sw_upper', -19.72, 4.2, -15.45, 9.25, swGrey, 0.0012);
  plate(b, panel, 'c172g.sw_lower', -19.72, 9.2, -11.4, 13.45, swGrey, 0.0012);
  screws(b, panel, [[-15.8, 4.5], [-19.4, 9.0], [-15.75, 6.1], [-11.75, 9.55], [-11.75, 13.1], [-19.4, 13.1]], 0.0012);
  // Standby instrument plate under the audio panel.
  const stbyGrey = mats.custom('paint', '#45474b', 0.7);
  plate(b, panel, 'c172g.stby_plate', -7.9, 9.4, 7.9, 13.62, stbyGrey, 0.0012, 0.0016, 0.004, stbyHoles);
  screws(b, panel, [[-7.55, 9.75], [-7.55, 13.3], [-0.2, 9.75], [7.55, 9.75], [7.55, 13.3], [3.55, 13.3], [-3.9, 13.3]], 0.0012);

  // ---------------------------------------------------------------- GDU 1054B PFD / MFD and GMA 1360 (POH Fig 7-2 items 5, 7, 10)
  const disp = (id: string): CockpitDisplay => displays.get(id) ?? new NullDisplay(id);
  buildGdu(b, panel, cfg, 'pfd', disp('pfd'), px(PFD_TL.X), py(PFD_TL.Z));
  buildGdu(b, panel, cfg, 'mfd', disp('mfd'), px(MFD_TL.X), py(MFD_TL.Z));
  buildGma(b, panel, px(GMA_TL.X), py(GMA_TL.Z));
  void GDU_MM;
  void GMA_MM;

  // ---------------------------------------------------------------- placards (POH Sec 2 "Placards", photograph)
  text(b, panel, 'MANEUVERING SPEED:  105 KIAS', -12.5, 0.72, 0.0022, null); // POH placard 9, above the PFD
  text(b, panel, 'WARNING', -17.6, 1.35, 0.0026, null, 0, { weight: 800 });
  text(
    b,
    panel,
    'ASSURE THAT ALL CONTAMINANTS,\nINCLUDING WATER, ARE REMOVED\nFROM FUEL AND FUEL SYSTEM BEFORE\nFLIGHT. FAILURE TO ASSURE\nCONTAMINANT FREE FUEL AND HEED\nALL SAFETY INSTRUCTIONS AND\nOWNER ADVISORIES PRIOR TO FLIGHT\nCAN RESULT IN BODILY INJURY OR DEATH.',
    -17.6,
    2.4,
    0.0012,
    null,
  );
  text(b, panel, 'WARNING', -18.2, 3.35, 0.0022, null, 0, { weight: 800 });
  text(b, panel, 'ASSURE THAT SEAT IS LOCKED IN POSITION\nPRIOR TO TAXI, TAKE-OFF, AND LANDING.\nFAILURE TO PROPERLY LATCH SEAT AND HEED\nALL SAFETY INSTRUCTIONS CAN RESULT IN\nBODILY INJURY OR DEATH.', -17.8, 3.95, 0.0011, null);
  text(b, panel, 'SMOKING PROHIBITED', 14.35, 3.95, 0.0024, null, 0, { weight: 800 }); // POH placard 10
  // POH placard 1 (in full view of the pilot): operating limitations.
  panel.placard(
    {
      text:
        'THE MARKINGS AND PLACARDS INSTALLED IN THIS AIRPLANE CONTAIN OPERATING\nLIMITATIONS WHICH MUST BE COMPLIED WITH WHEN OPERATING THIS AIRPLANE\nIN THE NORMAL CATEGORY. OTHER OPERATING LIMITATIONS WHICH MUST BE\nCOMPLIED WITH WHEN OPERATING THIS AIRPLANE IN THIS CATEGORY OR IN THE\nUTILITY CATEGORY ARE CONTAINED IN THE PILOT\'S OPERATING HANDBOOK AND\nFAA APPROVED AIRPLANE FLIGHT MANUAL.\nNORMAL CATEGORY - NO ACROBATIC MANEUVERS, INCLUDING SPINS, APPROVED.\nUTILITY CATEGORY - NO ACROBATIC MANEUVERS APPROVED, EXCEPT THOSE LISTED\nIN THE PILOT\'S OPERATING HANDBOOK. BAGGAGE COMPARTMENT AND REAR SEAT\nMUST NOT BE OCCUPIED.\nSPIN RECOVERY - OPPOSITE RUDDER - FORWARD ELEVATOR - NEUTRALIZE CONTROLS.\nFLIGHT INTO KNOWN ICING CONDITIONS PROHIBITED.\nTHIS AIRPLANE IS CERTIFIED FOR THE FOLLOWING FLIGHT OPERATIONS AS OF\nDATE OF ORIGINAL AIRWORTHINESS CERTIFICATE:  DAY - NIGHT - VFR - IFR',
      height: 0.00085,
      style: 'plate',
      align: 'left',
      zone: null,
    },
    px(14.6),
    py(5.9),
    { z: 0.0002 },
  );

  // ---------------------------------------------------------------- STBY BATT / MASTER / AVIONICS (POH Fig 7-2 items 1-4)
  const zSw = 0.0012;
  text(b, panel, 'STBY BATT', -17.7, 5.3, 0.0021, 'panel', zSw);
  panel.line(px(-18.95), py(5.55), px(-16.5), py(5.55), 0.0005, 'panel');
  text(b, panel, 'ARM', -18.07, 5.72, 0.0016, 'panel', zSw);
  text(b, panel, 'OFF', -18.72, 6.08, 0.0016, 'panel', zSw);
  text(b, panel, 'TEST', -18.07, 6.5, 0.0016, 'panel', zSw);
  text(b, panel, 'TEST', -16.75, 6.08, 0.0016, 'panel', zSw);
  // POH NAV III Sec 7 "Standby battery": three-position ARM / OFF / TEST, TEST momentary.
  panel.add(
    new ToggleSwitch(env, {
      id: 'c172g.stby_batt',
      label: 'STBY BATT (ARM / OFF / TEST)',
      var: C172.stbyBatt,
      positions: ['TEST', 'OFF', 'ARM'],
      values: [STBY_BATT.test, STBY_BATT.off, STBY_BATT.arm],
      initial: 1,
      springs: { 0: 1 },
      handle: 'bat',
      handleMaterial: 'paintRed',
      scale: 0.85,
    }),
    px(-18.07),
    py(6.08),
    { z: zSw },
  );
  // Green STBY BATT TEST annunciator (POH Fig 7-2 item 3): a round jewel lens (~6 mm) in a round bezel with
  // "TEST" printed to its right (photographs "Cessna 172SP G1000 01/02.jpg").
  panel.add(
    new JewelLamp(env, { id: 'c172g.stby_batt_test_lamp', label: 'STBY BATT TEST', var: C172.stbyTestLamp, color: 'green', diameter: 0.006 }),
    px(-17.3),
    py(6.08),
    { z: zSw },
  );
  // MASTER (ALT | BAT) red split rocker and AVIONICS (BUS 1 | BUS 2) white split rocker.
  const rocker = (id: string, label: string, v: string, X: number, cap: 'paintRed' | 'knobWhite') =>
    panel.add(new RockerSwitch(env, { id, label, var: v, positions: ['OFF', 'ON'], values: [0, 1], width: 0.0104, height: 0.027, capMaterial: cap, tiltDeg: 9 }), px(X), py(8.2), { z: zSw });
  const frame = (X: number) => {
    const g = env.geometry.get('c172g.rocker_frame', () => {
      const s = roundedRectShape(0.0265, 0.0405, 0.003);
      s.holes.push(new THREE.Path().moveTo(-0.0112, -0.0152).lineTo(0.0112, -0.0152).lineTo(0.0112, 0.0152).lineTo(-0.0112, 0.0152).closePath());
      return extrude(s, { depth: 0.004, bevel: 0.0008, anchor: 'back0' });
    });
    const m = new THREE.Mesh(g, mats.get('plasticBlack'));
    m.userData.cockpitStatic = true;
    panel.addObject(m, px(X), py(8.2), { z: zSw });
  };
  frame(-18.4);
  frame(-16.8);
  rocker('c172g.master_alt', 'MASTER ALT', C172.masterAlt, -18.64, 'paintRed');
  rocker('c172g.master_bat', 'MASTER BAT', C172.masterBat, -18.16, 'paintRed');
  rocker('c172g.avn_bus1', 'AVIONICS BUS 1', C172.avionicsBus1, -17.04, 'knobWhite');
  rocker('c172g.avn_bus2', 'AVIONICS BUS 2', C172.avionicsBus2, -16.56, 'knobWhite');
  text(b, panel, 'MASTER', -18.4, 7.05, 0.0019, 'panel', zSw);
  text(b, panel, 'ALT   BAT', -18.4, 7.4, 0.0017, 'panel', zSw);
  text(b, panel, 'AVIONICS', -16.8, 7.05, 0.0019, 'panel', zSw);
  text(b, panel, 'BUS 1  BUS 2', -16.8, 7.4, 0.0015, 'panel', zSw);
  text(b, panel, 'ON', -19.45, 7.85, 0.0016, 'panel', zSw);
  text(b, panel, 'ON', -17.6, 7.85, 0.0016, 'panel', zSw);
  text(b, panel, 'ON', -15.95, 7.85, 0.0016, 'panel', zSw);

  // ---------------------------------------------------------------- DIMMING group (POH Fig 7-2 item 34)
  panel.line(px(-19.2), py(9.62), px(-19.2), py(13.1), 0.0005, 'panel');
  panel.line(px(-16.3), py(9.62), px(-16.3), py(13.1), 0.0005, 'panel');
  panel.line(px(-19.2), py(13.1), px(-16.3), py(13.1), 0.0005, 'panel');
  panel.line(px(-19.2), py(9.62), px(-18.4), py(9.62), 0.0005, 'panel');
  panel.line(px(-17.1), py(9.62), px(-16.3), py(9.62), 0.0005, 'panel');
  text(b, panel, 'DIMMING', -17.75, 9.62, 0.0018, 'panel', zSw);
  const dimmer = (id: string, label: string, v: string, X: number, Z: number, t: string, init: number) => {
    text(b, panel, t, X, Z - 0.85, 0.0017, 'panel', zSw);
    return panel.add(
      new RotaryKnob(env, {
        id,
        label,
        outer: { var: v, min: 0, max: 1, step: 0.05, initial: init, angleRange: [-140, 140], format: (x) => (x <= 0 ? 'OFF' : `${Math.round(x * 100)}%`) },
        cap: 'skirted',
        diameter: 0.0195,
        height: 0.012,
        pointer: 'line',
        zone: 'panel',
      }),
      px(X),
      py(Z),
      { z: zSw },
    );
  };
  dimmer('c172g.dim_swcb', 'SW / CB PANELS dimmer', C172.dimPanel, -18.4, 10.75, 'SW / CB\nPANELS', 0);
  dimmer('c172g.dim_stby', 'STBY IND dimmer', C172.dimStbyInd, -17.1, 10.75, 'STBY\nIND', 0);
  dimmer('c172g.dim_ped', 'PEDESTAL dimmer', C172.dimPedestal, -18.4, 12.35, 'PEDESTAL', 0);
  // POH Sec 7: AVIONICS dimmer fully counterclockwise (off) = display photocells control the lighting.
  dimmer('c172g.dim_avn', 'AVIONICS dimmer (OFF = photocell)', C172.dimRadio, -17.1, 12.35, 'AVIONICS', 0);

  // ---------------------------------------------------------------- LIGHTS and system switches (POH Fig 7-2 item 32)
  const LIGHTS: [string, string, string, number][] = [
    ['beacon', 'BEACON', C172.beacon, -16.0],
    ['land', 'LAND', C172.land, -15.2],
    ['taxi', 'TAXI', C172.taxi, -14.4],
    ['nav', 'NAV', C172.nav, -13.6],
    ['strobe', 'STROBE', C172.strobe, -12.8],
  ];
  panel.line(px(-16.45), py(9.72), px(-16.45), py(9.55), 0.0005, 'panel');
  panel.line(px(-16.45), py(9.55), px(-14.9), py(9.55), 0.0005, 'panel');
  panel.line(px(-13.9), py(9.55), px(-12.35), py(9.55), 0.0005, 'panel');
  panel.line(px(-12.35), py(9.55), px(-12.35), py(9.72), 0.0005, 'panel');
  text(b, panel, 'LIGHTS', -14.4, 9.55, 0.0018, 'panel', zSw);
  const toggle = (id: string, label: string, v: string, X: number, Z: number, handleMat: THREE.Material | 'knobWhite') => {
    panel.add(new ToggleSwitch(env, { id: `c172g.${id}`, label, var: v, positions: ['OFF', 'ON'], values: [0, 1], handle: 'bat', handleMaterial: handleMat, scale: 0.8 }), px(X), py(Z), { z: zSw });
    text(b, panel, 'OFF', X, Z + 0.55, 0.0015, 'panel', zSw);
  };
  const cream = mats.custom('plastic', '#e8e4d8', 0.45);
  for (const [id, t, v, X] of LIGHTS) {
    text(b, panel, t, X, 10.02, 0.0017, 'panel', zSw);
    toggle(id, `${t} light`, v, X, 10.55, cream);
  }
  text(b, panel, 'FUEL\nPUMP', -16.0, 11.55, 0.0016, 'panel', zSw);
  toggle('fuel_pump', 'FUEL PUMP', C172.fuelPump, -16.0, 12.2, cream);
  text(b, panel, 'PITOT\nHEAT', -15.2, 11.55, 0.0016, 'panel', zSw);
  toggle('pitot_heat', 'PITOT HEAT', C172.pitotHeat, -15.2, 12.2, mats.custom('plastic', '#2f8a3a', 0.45));
  // EST position (behind the control wheel in the photograph): CABIN PWR 12V under NAV (POH Sec 7 "12V power outlet").
  text(b, panel, 'CABIN PWR\n12V', -13.6, 11.55, 0.0015, 'panel', zSw);
  toggle('cabin_pwr', 'CABIN PWR 12V', C172.cabinPwr12v, -13.6, 12.2, cream);

  // ---------------------------------------------------------------- standby instruments (POH Fig 7-2 items 6, 8, 9)
  const zStby = 0.0012;
  text(b, panel, 'WARNING:', -5.35, 10.0, 0.0022, null, zStby, { weight: 800 });
  text(b, panel, 'PITOT HEAT MUST BE ON WHEN\nOPERATING BELOW 40° F IN INSTRUMENT\nMETEOROLOGICAL CONDITIONS.', -5.35, 10.55, 0.0012, null, zStby);
  text(b, panel, 'WINTERIZATION KIT MUST BE REMOVED\nWHEN OUTSIDE AIR TEMPERATURE\nIS ABOVE 20° F.', -5.35, 11.9, 0.0012, null, zStby);
  let gyroFlag: THREE.Object3D | null = null;
  if (pc.analog) {
    const audio = pc.ctx.audio;
    const gm = { bezel: mats.get('bezel') as THREE.MeshStandardMaterial };
    // Standby ASI and altimeter on the pneumatic standby air data (adc2: same pitot and static as the ADC).
    panel.add(new AirspeedIndicator({ id: 'c172g.stby_asi', name: 'Standby airspeed', vars, audio, iasVar: ADC.ias(2), tasRingVar: 'ac.asi.tas_ring', lightVar: STBY_LIGHT, materials: gm }), px(STBY.asi), py(STBY.Z), { z: zStby });
    // Vacuum-driven standby attitude indicator (POH Sec 7 "Vacuum system": "low vacuum flag").
    panel.add(new AnalogAttitudeIndicator({ id: 'c172g.stby_ai', name: 'Standby attitude', vars, audio, lightVar: STBY_LIGHT, materials: gm }), px(STBY.ai), py(STBY.Z), { z: zStby });
    panel.add(new Altimeter({ id: 'c172g.stby_alt', name: 'Standby altimeter', vars, audio, altVar: ADC.baroAlt(2), baroVar: ADC.baroSetting(2), lightVar: STBY_LIGHT, materials: gm }), px(STBY.alt), py(STBY.Z), { z: zStby });
    // GYRO (low vacuum) flag: an orange-red flag that drops into the upper window of the dial.
    const flag = new THREE.Group();
    const fm = new THREE.Mesh(env.geometry.get('c172g.gyro_flag', () => new THREE.PlaneGeometry(0.014, 0.0055)), mats.custom('paint', '#e0401c', 0.5));
    flag.add(fm);
    const ft = env.labels.text('GYRO', { height: 0.0028, weight: 800, zone: null, color: '#ffffff' });
    ft.position.z = 0.0002;
    flag.add(ft);
    flag.name = 'gyro_flag';
    flag.userData.cockpitDynamic = true;
    panel.addObject(flag, px(STBY.ai + 0.62), py(STBY.Z - 0.62), { z: zStby + 0.012 });
    gyroFlag = flag;
  }

  // ---------------------------------------------------------------- right upper panel: ELT, hour meter (POH Fig 7-2 items 11, 12)
  const eltPlate = plate(b, panel, 'c172g.elt_plate', 12.45, 0.95, 13.95, 3.05, mats.custom('paint', '#2a2b2e', 0.6), 0.001, 0.0015, 0.002);
  void eltPlate;
  text(b, panel, 'ARTEX\nELT', 13.2, 1.2, 0.0014, null, 0.001);
  text(b, panel, 'ON', 13.62, 1.72, 0.0013, null, 0.001);
  text(b, panel, 'ARM', 13.62, 2.28, 0.0013, null, 0.001);
  text(b, panel, 'TEST/RESET: PUSH ON\nMOMENTARILY, THEN ARM', 13.2, 2.8, 0.0008, null, 0.001);
  // Remote switch: ARM (normal) / ON; ON then back to ARM resets (TEST/RESET), POH Sec 9 Supplement 1/2.
  panel.add(
    new RockerSwitch(env, {
      id: 'c172g.elt',
      label: 'ELT REMOTE SWITCH (ARM / ON)',
      var: C172G.eltRocker,
      positions: ['ARM', 'ON'],
      values: [ELT_ROCKER.arm, ELT_ROCKER.on],
      width: 0.0085,
      height: 0.017,
      capMaterial: 'paintRed',
      indicator: { var: C172G.eltLight, color: 'red' }, // flashes while the ELT transmits (NXi Supplement 1)
    }),
    px(13.05),
    py(2.0),
    { z: 0.001 },
  );
  // Hour (Hobbs) meter: electromechanical counter (display 'hobbs').
  const hob = plate(b, panel, 'c172g.hobbs', 14.3, 1.37, 15.95, 2.18, mats.custom('plastic', '#161617', 0.5), 0.0015, 0.003, 0.0015);
  void hob;
  panel.display(disp('hobbs'), px(15.12), py(1.775), 0.033, 0.0132, { z: 0.0034, bezel: false });

  // ---------------------------------------------------------------- circuit breakers (POH Fig 7-2 item 31, Fig 7-7)
  const busOf = new Map(G1000_BREAKERS.map((x) => [x.name, x]));
  const cbPanel = (rows: (string | null)[][], cols: number[], labels: string[], labelX: number) => {
    rows.forEach((row, r) => {
      text(b, panel, labels[r], labelX, CB_ROWS[r], 0.0015, 'panel', 0, { align: 'center' });
      panel.line(px(labelX + 0.45), py(CB_ROWS[r] - 0.45), px(labelX + 0.45), py(CB_ROWS[r] + 0.45), 0.0005, 'panel');
      row.forEach((name, c) => {
        const X = cols[c];
        const Z = CB_ROWS[r];
        if (!name) {
          if (r === 0 && labels[0].startsWith('X-FEED')) return; // the CROSSFEED row has only two breakers
          // Blank hole plug.
          const m = new THREE.Mesh(env.geometry.get('c172g.cb_plug', () => cylinderZ(0.0052, 0.005, 0, 0.0012, 18)), mats.get('plasticBlack'));
          m.userData.cockpitStatic = true;
          panel.addObject(m, px(X), py(Z));
          return;
        }
        const def = busOf.get(name);
        if (!def) throw new Error(`c172-g1000 cockpit: breaker ${name} not in G1000_BREAKERS`);
        text(b, panel, CB_TEXT[name] ?? def.label, X, Z - 0.46, 0.0013, 'panel');
        panel.add(
          new CircuitBreaker(env, {
            id: `c172g.cb.${name}`,
            label: `${def.label} (${def.bus.toUpperCase()}) ${def.ratingA} A`,
            var: `cb.${name}`,
            trippedVar: `cb.${name}_tripped`,
            rating: def.ratingA,
            pullable: PULLABLE_BUSES.has(def.bus),
            diameter: 0.0092,
          }),
          px(X),
          py(Z + 0.08),
        );
      });
    });
  };
  cbPanel(CB_LEFT, CB_COLS_L, ['X-FEED\nBUS', 'ELEC\nBUS 1', 'ELEC\nBUS 2'], -16.55);
  cbPanel(CB_RIGHT, CB_COLS_R, ['ESS\nBUS', 'AVN\nBUS 1', 'AVN\nBUS 2'], -10.5);

  // ---------------------------------------------------------------- MAGNETOS / START key switch (POH Fig 7-2 item 33)
  const mX = -17.85;
  const mZ = 15.55;
  text(b, panel, 'MAGNETOS', mX, mZ - 1.1, 0.0016, 'panel');
  const mag = new SelectorKnob(env, {
    id: 'c172g.magnetos',
    label: 'MAGNETOS / START (ignition key)',
    var: C172.magneto,
    positions: [
      { value: MAG.off, label: 'OFF', angle: -70 },
      { value: MAG.right, label: 'R', angle: -35 },
      { value: MAG.left, label: 'L', angle: 0 },
      { value: MAG.both, label: 'BOTH', angle: 35 },
      { value: MAG.start, label: 'START', angle: 75, spring: 3 },
    ],
    initial: 0,
    cap: 'key',
    diameter: 0.021,
    height: 0.012,
    labelRadius: 0.019,
    labelHeight: 0.0016,
    labelZone: 'panel',
    enabledVar: C172.keyIn,
  });
  panel.add(mag, px(mX), py(mZ));
  // Lock cylinder bezel.
  {
    const m = new THREE.Mesh(env.geometry.get('c172g.lock_cyl', () => cylinderZ(0.0105, 0.0098, 0, 0.004, 28)), mats.get('chrome'));
    m.userData.cockpitStatic = true;
    panel.addObject(m, px(mX), py(mZ));
  }
  // Key tag (red plastic fob on the key ring): click inserts the key, or removes it with the switch at OFF.
  // SCOPE: the key cannot be carried anywhere else in the cabin; the fob stays by the switch.
  panel.add(
    new PushButton(env, {
      id: 'c172g.key_tag',
      label: 'IGNITION KEY (click: insert / remove at OFF)',
      mode: 'momentary',
      var: C172G.keyTag,
      style: 'small',
      width: 0.011,
      height: 0.028,
      capMaterial: 'paintRed',
    }),
    px(mX + 0.35),
    py(mZ + 1.25),
    { rotDeg: -12 },
  );
  const keyBow = (mag as unknown as { outer?: { group: THREE.Object3D } }).outer?.group ?? null;

  // ---------------------------------------------------------------- engine controls panel (POH Fig 7-2 items 19, 26, 27, 28)
  // ALT STATIC AIR valve: red knob, pull = ON (POH Sec 7 "Pitot-static system").
  panel.add(new PushPullKnob(env, { id: 'c172g.alt_static', label: 'ALT STATIC AIR (PULL ON)', var: C172.altStatic, valueIn: 0, valueOut: 1, style: 'plain', travel: 0.025, material: 'knobRed' }), px(-3.82), py(15.0));
  text(b, panel, 'ALT\nSTATIC AIR\nPULL ON', -3.75, 16.25, 0.0014, 'panel');
  // GO-AROUND button (POH Fig 7-2 item 27; EST position between the ALT STATIC knob and the throttle).
  panel.add(new PushButton(env, { id: 'c172g.ga', label: 'GO-AROUND (GA)', mode: 'momentary', var: C172G.ga, event: 'ap.toga', style: 'round', width: 0.0085, capMaterial: 'plasticBlack', engraved: 'GA', engravedHeight: 0.0022, zone: 'panel' }), px(-2.05), py(15.15));
  text(b, panel, 'GO\nAROUND', -2.05, 15.95, 0.0012, 'panel');
  // Throttle with the friction lock (knurled ring at the panel, clockwise = more friction).
  panel.add(new PushPullKnob(env, { id: 'c172g.throttle', label: 'THROTTLE (PUSH OPEN)', var: C172.throttle, valueIn: 1, valueOut: 0, style: 'throttle', travel: 0.095, vernierStep: 0 }), px(-0.44), py(16.0));
  panel.add(
    new RotaryKnob(env, {
      id: 'c172g.throttle_friction',
      label: 'THROTTLE FRICTION LOCK',
      outer: { var: C172.throttleFriction, min: 0, max: 1, step: 0.1, initial: 0.5, degPerClick: 30, format: (x) => `${Math.round(x * 100)}%` },
      cap: 'ring',
      diameter: 0.031,
      height: 0.006,
      material: 'chrome',
      pointer: 'none',
    }),
    px(-0.44),
    py(16.0),
  );
  text(b, panel, 'THROTTLE\nPUSH\nOPEN', -2.05, 17.1, 0.0013, 'panel');
  // Mixture: red, lock button in the centre, vernier twist (POH Sec 7 "Engine controls").
  panel.add(new PushPullKnob(env, { id: 'c172g.mixture', label: 'MIXTURE (PULL LEAN)', var: C172.mixture, valueIn: 1, valueOut: 0, style: 'mixture', travel: 0.095, lockButton: true, vernierStep: 0.008 }), px(1.85), py(16.0));
  {
    const m = new THREE.Mesh(env.geometry.get('c172g.mix_collar', () => cylinderZ(0.0135, 0.0125, 0, 0.005, 6)), mats.get('chrome'));
    m.userData.cockpitStatic = true;
    panel.addObject(m, px(1.85), py(16.0));
  }
  text(b, panel, 'MIXTURE\nPULL\nLEAN', 3.35, 16.0, 0.0013, 'panel');

  // ---------------------------------------------------------------- wing flaps (POH Fig 7-2 item 18, placard 5)
  const fX = 7.25;
  const fTop = 14.55;
  const fBot = 16.35;
  text(b, panel, 'WING FLAPS', 6.7, 13.95, 0.0016, 'panel');
  // Indicator placard: blue UP-10 band (110 KIAS), white 10-FULL band (85 KIAS).
  {
    const blue = new THREE.Mesh(env.geometry.get('c172g.flap_blue', () => new THREE.PlaneGeometry(0.0085, 0.019)), mats.custom('paint', '#2c5da8', 0.6));
    blue.userData.cockpitStatic = true;
    panel.addObject(blue, px(5.95), py(fTop + 0.37), { z: 0.0002 });
    const white = new THREE.Mesh(env.geometry.get('c172g.flap_white', () => new THREE.PlaneGeometry(0.0085, 0.024)), mats.custom('paint', '#e9e9e4', 0.6));
    white.userData.cockpitStatic = true;
    panel.addObject(white, px(5.95), py(fTop + 1.25), { z: 0.0002 });
    text(b, panel, '110', 5.95, fTop + 0.5, 0.0017, null, 0.0002, { color: '#ffffff' });
    text(b, panel, '85', 5.95, fTop + 1.3, 0.0017, null, 0.0002, { color: '#141414' });
  }
  const detentZ = (lev: number) => fTop + ((fBot - fTop) * lev) / 3;
  for (const d of FLAP_DETENTS) text(b, panel, d.label, 6.6, detentZ(d.lever), 0.0014, 'panel');
  // Flap switch lever: moves down UP -> 10 -> 20 -> FULL (the Lever's +value is +v, so the lever is turned 180 deg).
  panel.add(
    new Lever(env, {
      id: 'c172g.flaps',
      label: 'WING FLAPS lever',
      var: C172.flapLever,
      min: 0,
      max: 3,
      initial: 0,
      discrete: true,
      // POH 7-22: the slotted panel "provides mechanical stops at the 10°, 20° and FULL positions"; the lever is moved
      // right to clear the stops at 10° and 20° (gates: a drag stops there, release and drag again to pass).
      detents: FLAP_DETENTS.map((d) => ({ value: d.lever, label: d.label, ...(d.lever === 1 || d.lever === 2 ? { kind: 'gate' as const } : {}) })),
      travel: { kind: 'linear', length: (fBot - fTop) * IN },
      knob: 'flap',
      knobScale: 0.7,
      knobMaterial: 'knobWhite',
      armLength: 0.03,
      detentLabels: false,
      slot: { width: 0.006, plateWidth: 0.016 },
      dragInvert: true,
      format: (v) => FLAP_DETENTS[Math.round(v)]?.label ?? '',
    }),
    px(fX),
    py((fTop + fBot) / 2),
    { rotDeg: 180 },
  );
  // Follow-up pointer: shows the actual flap position (surf.flaps_deg) beside the scale.
  const flapPointer = new THREE.Mesh(
    env.geometry.get('c172g.flap_ptr', () => {
      const s = new THREE.Shape();
      s.moveTo(0.004, 0);
      s.lineTo(-0.002, 0.0022);
      s.lineTo(-0.002, -0.0022);
      s.closePath();
      return extrude(s, { depth: 0.0012, anchor: 'back0' });
    }),
    mats.custom('paint', '#f2f2ee', 0.5),
  );
  flapPointer.name = 'flap_pointer';
  flapPointer.userData.cockpitDynamic = true;
  panel.addObject(flapPointer, px(6.45), py(fTop), { z: 0.0003 });
  flapPointer.userData.flapScale = { yTop: py(fTop), yBot: py(fBot) };

  // ---------------------------------------------------------------- cabin heat / air (POH Fig 7-2 items 16, 17; Sec 7 "Cabin heating")
  // Plain chrome push-pull knobs, legends printed to their left (photograph "Cessna 172SP G1000 01.jpg").
  panel.add(new PushPullKnob(env, { id: 'c172g.cabin_heat', label: 'CABIN HT (PULL ON)', var: C172.cabinHeat, valueIn: 0, valueOut: 1, style: 'cabin', travel: 0.05, vernierStep: 0.05, clickToggles: false, material: 'chrome' }), px(10.7), py(14.6));
  text(b, panel, 'CABIN\nHT\nPULL ON', 9.3, 14.6, 0.0014, 'panel');
  panel.add(new PushPullKnob(env, { id: 'c172g.cabin_air', label: 'CABIN AIR (PULL ON)', var: C172.cabinAir, valueIn: 0, valueOut: 1, style: 'cabin', travel: 0.05, vernierStep: 0.05, clickToggles: false, material: 'chrome' }), px(10.7), py(16.15));
  text(b, panel, 'CABIN\nAIR\nPULL ON', 9.3, 16.15, 0.0014, 'panel');

  // ---------------------------------------------------------------- glove box (POH Fig 7-2 item 15)
  // The door hinges at its lower edge and drops open when the chrome latch is clicked (C172G.glovebox,
  // animated by the cockpit hook). EST 7.6 x 3.6 in door (photograph). SCOPE: the glove box is empty.
  const gloveDoor = new THREE.Group();
  gloveDoor.name = 'glovebox_door';
  gloveDoor.userData.cockpitDynamic = true;
  {
    const g = env.geometry.get('c172g.glovebox', () => roundedBox(7.6 * IN, 3.6 * IN, 0.006, 0.004));
    const m = new THREE.Mesh(g, black);
    m.position.set(0, 1.8 * IN, 0);
    gloveDoor.add(m);
    panel.addObject(gloveDoor, px(15.85), py(17.95), { z: 0.003 });
    // Dark cavity behind the door (visible while open).
    const cav = new THREE.Mesh(env.geometry.get('c172g.glove_cavity', () => new THREE.PlaneGeometry(7.4 * IN, 3.4 * IN)), mats.get('panelDark'));
    cav.userData.cockpitStatic = true;
    panel.addObject(cav, px(15.85), py(16.15), { z: -0.0005 });
  }
  const gloveLatch = panel.add(
    new PushButton(env, { id: 'c172g.glovebox_latch', label: 'GLOVE BOX latch (open / close)', mode: 'toggle', var: C172G.glovebox, style: 'mcp', width: 0.03, height: 0.008, capMaterial: 'chrome' }),
    px(15.85),
    py(14.75),
    { z: 0.0065 },
  );
  b.root.updateMatrixWorld(true);
  gloveDoor.attach(gloveLatch.object);

  // ---------------------------------------------------------------- parking brake (POH Fig 7-2 item 30)
  // T-handle under the lower left panel: pull aft and rotate 90 deg down to set (POH Sec 4 "Securing airplane").
  panel.add(
    new TBarHandle(env, {
      id: 'c172g.parking_brake',
      label: 'PARKING BRAKE (pull, rotate to lock)',
      var: C172.parkingBrake,
      valueIn: 0,
      valueOut: 1,
      style: 'tbar',
      rotate: 'lock',
      springIn: true,
      pullLength: 0.05,
      legend: 'PARK BRAKE',
      scale: 0.8,
    }),
    px(-11.1),
    py(18.35),
  );

  // Pilot / copilot control column bushings through the panel.
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(env.geometry.get('c172g.col_bush', () => cylinderZ(0.022, 0.019, 0, 0.006, 32)), mats.get('plasticBlack'));
    m.userData.cockpitStatic = true;
    panel.addObject(m, px(s * 9.2), py(11.8), { z: s < 0 ? 0 : 0 });
  }

  void SURF;
  return { panel, gyroFlag, flapPointer, keyBow, gloveDoor };
}
