/**
 * Citation M2 main instrument panel and centre glareshield panel.
 *
 * S&D15 §10.2 (Oct 2015 Rev A):
 *  A. Centre glareshield panel: LH and RH MASTER CAUTION / MASTER WARNING
 *     lights, LH and RH ENGINE FIRE control switches, reversionary and
 *     dimming controls, flight director / autopilot controller (GMC 710),
 *     electronic standby instrument (ESI-1000), LH and RH display control
 *     units (GCU 275, AIN: "Each pilot has a GCU 275 display controller
 *     mounted under the glareshield").
 *  B. Instrument panel (left to right): electrical power panel, LH PFD, MFD,
 *     RH PFD (three GDU 1400W, 14.1 in, 1280 x 800).
 * Layout (M2-L01..L08, L15, L16): photographs pin1 / Skies 2017 / S&D21
 * Fig 3 / listing 9525 #24 / Jetcraft 525-0851 and the Garmin GMC 710 /
 * GCU 275 unit images; positions within each panel are EST from those
 * (docs/aircraft/citation-m2.md §9); names the M2 documents do not give follow
 * the CJ family (dossier EST).
 * Every control writes the `ac.m2.*` / `g3k.*` vars or emits the G3000 /
 * CAS events that the systems consume (tests/aircraft/citation-m2/cockpit-main).
 */
import * as THREE from 'three';
import type { CockpitBuilder, Panel } from '../../../cockpit/CockpitBuilder';
import type { CockpitDisplay } from '../../../cockpit/types';
import type { MaterialName } from '../../../cockpit/materials';
import { AnnunciatorLight, GuardedButton, KeyPad, PushButton, RotaryKnob, SelectorKnob, Thumbwheel, ToggleSwitch } from '../../../cockpit/controls';
import { plateGeometry } from '../../../cockpit/geometry/structure';
import { ALERT } from '../../../core/vars';
import { G3K, G3K_EVENTS } from '../../../avionics/garmin-g3000/vars';
import type { GcuKeyName, GduId } from '../../../avionics/garmin-g3000/vars';
import { M2 } from '../vars';
import { M2_LIMITS } from '../data';
import { GDU, GLARE_PANEL, MAIN } from './layout';
import { ESI_VARS } from './displays';
import { MapJoystickKnob } from './controls';
import { fittedPlate, topEdge } from './fit';

const inc = (e: string) => `${e}_inc`;
const dec = (e: string) => `${e}_dec`;

/** A display stand-in for headless builds (no canvas): keeps the screen mesh and bezel. */
export class NullDisplay implements CockpitDisplay {
  readonly canvas = { width: 4, height: 4 } as unknown as HTMLCanvasElement;
  readonly width = 4;
  readonly height = 4;
  readonly refreshHz = 1;
  constructor(readonly id: string) {}
  render(): boolean {
    return false;
  }
}

export interface PanelCtx {
  b: CockpitBuilder;
  displays: Map<string, CockpitDisplay>;
}

function disp(c: PanelCtx, id: string): CockpitDisplay {
  return c.displays.get(id) ?? new NullDisplay(id);
}

/** A flat trim plate (static) on a panel. */
function plate(c: PanelCtx, p: Panel, x: number, y: number, w: number, h: number, material: MaterialName = 'bezel', z = 0.0005): THREE.Mesh {
  const env = c.b.env;
  const m = new THREE.Mesh(env.geometry.get(`m2.plate.${w.toFixed(4)}.${h.toFixed(4)}`, () => plateGeometry(w, h, 0.002, 0.003)), env.materials.get(material));
  m.userData.cockpitStatic = true;
  return p.addObject(m, x, y, { z });
}

// =============================================================================== main instrument panel

export function buildMainPanel(c: PanelCtx): void {
  const b = c.b;
  const env = b.env;
  const main = b.panel({
    name: 'm2.main',
    center_m: MAIN.center,
    facing: 'aft',
    tiltDeg: MAIN.tiltDeg,
    width: MAIN.width,
    height: MAIN.height,
    origin: 'top-left',
    screws: false,
    invisible: true,
  });
  // Plate with its outboard edges on the lining (M2-L12).
  const [mtx, mtz] = topEdge(MAIN.center, MAIN.tiltDeg, MAIN.height);
  fittedPlate(b, main, { topX: mtx, topZ: mtz, tiltDeg: MAIN.tiltDeg, height: MAIN.height, width: MAIN.width }, { name: 'm2.main', material: 'panel', maxHalf: 0.76 });

  // --- Three GDU 1400W (PFD1, MFD, PFD2) with 12 bezel softkeys each (PG Figure 1-2).
  const [bl, br, bt, bb] = GDU.border;
  const screenCy = GDU.top + bt + GDU.screenH / 2;
  const gdus: [GduId, number][] = [
    ['pfd1', GDU.xPfd1],
    ['mfd', GDU.xMfd],
    ['pfd2', GDU.xPfd2],
  ];
  for (const [id, cx] of gdus) {
    const sx = cx;
    main.display(disp(c, id), sx, screenCy, GDU.screenW, GDU.screenH, { bezel: { border: [bl, br, bt, bb], depth: 0.012, material: 'bezel' }, display: { boot: false } });
    main.label('GARMIN', sx, GDU.top + 0.0085, { height: 0.0028, weight: 700, color: '#b8bcc2', zone: null });
    // SD card slots (upper: database, lower: terrain/charts, S&D15 §10.3.K / S) on the right bezel.
    for (const dy of [0.05, 0.09]) plate(c, main, sx + GDU.screenW / 2 + 0.0145, GDU.top + dy, 0.004, 0.028, 'plasticBlack', 0.012);
    const keyW = 0.0165;
    const gap = (GDU.screenW - 12 * keyW) / 11;
    main.add(
      new KeyPad(env, {
        id: `m2.${id}.softkeys`,
        label: `${id.toUpperCase()} SOFTKEYS`,
        eventPrefix: `g3k.${id}.sk`,
        rows: [Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), label: '' }))],
        keyWidth: keyW,
        keyHeight: 0.0085,
        gap,
        keyMaterial: 'plasticBlack',
      }),
      sx - GDU.screenW / 2,
      GDU.top + bt + GDU.screenH + 0.012,
      { z: 0.012 },
    );
  }

  // --- LH edge outboard of PFD1 (photos pin1, listing 9525 #24, Jetcraft 525-0851): registration plate, the
  //     black limitations placard below it, and the ~100 x 110 mm ELECTRICAL POWER panel on the lower part.
  main.placard({ text: 'N0000', height: 0.0048, style: 'engraved' }, 0.072, 0.02); // EST: generic registration (not a real N-number)
  main.placard(
    {
      text: `VMO ${M2_LIMITS.vmoKt} KIAS  MMO ${M2_LIMITS.mmo.toFixed(2)}\nVLO EXT ${M2_LIMITS.vloExtendKt} RET ${M2_LIMITS.vloRetractKt}\nVLE ${M2_LIMITS.vleKt}  VFE 15 ${M2_LIMITS.vfe15Kt} 35 ${M2_LIMITS.vfe35Kt}\nOPERATE PER AFM`,
      height: 0.0021,
      style: 'plate',
      align: 'center',
    },
    0.072,
    0.068,
  );
  const ep = main.subPanel({ name: 'm2.elec', x: 0.072, y: 0.19, width: 0.1, height: 0.11, origin: 'top-left', material: 'panel', screws: { kind: 'dzus', diameter: 0.006, positions: [[0.006, 0.006], [0.094, 0.006], [0.006, 0.104], [0.094, 0.104]] } });
  ep.label('ELECTRICAL POWER', 0.05, 0.012, { height: 0.0026 });
  ep.line(0.012, 0.018, 0.088, 0.018);
  const sw = (o: ConstructorParameters<typeof ToggleSwitch>[1]) => new ToggleSwitch(env, { scale: 0.8, ...o });
  ep.add(
    sw({
      id: 'm2.elec.batt',
      var: M2.battSw,
      label: 'BATTERY',
      positions: ['EMER', 'OFF', 'BATT'],
      values: [-1, 0, 1],
      initial: 1,
      leverLock: [2],
      handle: 'lever-lock',
      labels: { name: 'BATTERY', positions: true, height: 0.0022 },
    }),
    0.022,
    0.042,
  );
  ep.add(
    sw({
      id: 'm2.elec.avionics',
      var: M2.avionicsSw,
      label: 'AVIONICS',
      positions: ['DISPATCH', 'OFF', 'ON'],
      values: [-1, 0, 1],
      initial: 1,
      labels: { name: 'AVIONICS', positions: true, height: 0.0022 },
    }),
    0.05,
    0.042,
  );
  // STBY FLT DISPLAY OFF / ON / TEST (M2 flows; CJ-family "Standby Gyro Switch - TEST; ON"), STBY BATT test light.
  ep.add(
    sw({
      id: 'm2.elec.stby_disp',
      var: M2.stbyDispSw,
      label: 'STBY FLT DISPLAY',
      positions: ['OFF', 'ON', 'TEST'],
      values: [0, 1, 2],
      initial: 1,
      springs: { 2: 1 },
      labels: { name: 'STBY DISP', positions: true, height: 0.0022 },
    }),
    0.078,
    0.042,
  );
  ep.add(new AnnunciatorLight(env, { id: 'm2.elec.stby_batt', label: 'STBY BATT (ESI ON BATTERY)', width: 0.012, height: 0.007, segments: [{ text: ['STBY', 'BATT'], color: 'amber', var: M2.stbyBattLight, style: 'field' }] }), 0.078, 0.07);
  ep.label('GENERATOR', 0.036, 0.068, { height: 0.0022 });
  for (const [i, x] of [
    [1, 0.022],
    [2, 0.05],
  ] as const) {
    ep.add(
      sw({
        id: `m2.elec.gen${i}`,
        var: M2.genSw(i),
        label: `${i === 1 ? 'L' : 'R'} GEN`,
        positions: ['RESET', 'OFF', 'GEN'],
        values: [-1, 0, 1],
        initial: 1,
        springs: { 0: 1 },
        labels: { name: i === 1 ? 'L' : 'R', positions: true, height: 0.0022 },
      }),
      x,
      0.088,
    );
  }

  // --- RH edge outboard of PFD2: registration plate only (photos).
  main.placard({ text: 'N0000', height: 0.0048, style: 'engraved' }, 1.3, 0.02);
}

// =============================================================================== centre glareshield panel

function gmcKey(env: CockpitBuilder['env'], key: string, label: string): PushButton {
  return new PushButton(env, {
    id: `m2.gmc.key.${key}`,
    label: `GMC ${label}`,
    style: 'key',
    width: 0.013,
    height: 0.0095,
    event: G3K_EVENTS.gmcKey(key),
    engraved: label,
    engravedHeight: 0.0024,
    lightBar: { var: G3K.gmcLight(key), color: 'green' },
    capMaterial: 'plasticBlack',
  });
}

function encoderKnob(env: CockpitBuilder['env'], id: string, label: string, base: string, push: string | undefined, d: number, cap: 'fluted' | 'knurled' = 'fluted'): RotaryKnob {
  return new RotaryKnob(env, {
    id,
    label,
    cap,
    diameter: d,
    height: 0.012,
    outer: { incEvent: inc(base), decEvent: dec(base), label },
    push: push ? { event: push, label: 'PUSH' } : undefined,
  });
}

const dimmer = (env: CockpitBuilder['env'], id: string, v: string, name: string, fmt: (x: number) => string) =>
  new RotaryKnob(env, { id, label: name, cap: 'dimmer', diameter: 0.011, outer: { var: v, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], format: fmt } });

export function buildGlareshieldPanel(c: PanelCtx): void {
  const b = c.b;
  const env = b.env;
  const gp = b.panel({
    name: 'm2.glare',
    center_m: GLARE_PANEL.center,
    facing: 'aft',
    tiltDeg: GLARE_PANEL.tiltDeg,
    width: GLARE_PANEL.width,
    height: GLARE_PANEL.height,
    origin: 'top-left',
    screws: false,
    invisible: true,
  });
  const W = GLARE_PANEL.width;
  const mid = W / 2;
  const [gtx, gtz] = topEdge(GLARE_PANEL.center, GLARE_PANEL.tiltDeg, GLARE_PANEL.height);
  fittedPlate(b, gp, { topX: gtx, topZ: gtz, tiltDeg: GLARE_PANEL.tiltDeg, height: GLARE_PANEL.height, width: W }, { name: 'm2.glare', material: 'panel', maxHalf: 0.76 });

  // --- MASTER CAUTION (inboard) / MASTER WARNING (outboard), mirror-symmetric on both sides; ~18 mm square lenses
  //     centred at |y| 0.46 (MC) / 0.50 (MW) (photos pin1 / Skies 2017; S&D15 §10.2.A; CAS acknowledge §10.3.E).
  for (const side of [1, 2] as const) {
    const sgn = side === 1 ? -1 : 1;
    gp.add(
      new PushButton(env, {
        id: `m2.mw${side}`,
        label: 'MASTER WARNING',
        style: 'korry',
        width: 0.018,
        height: 0.018,
        mode: 'momentary',
        event: 'cas.ack_warning',
        segments: [{ text: ['MASTER', 'WARNING'], color: 'red', var: ALERT.masterWarning, style: 'field' }],
      }),
      mid + sgn * 0.5,
      0.036,
    );
    gp.add(
      new PushButton(env, {
        id: `m2.mc${side}`,
        label: 'MASTER CAUTION',
        style: 'korry',
        width: 0.018,
        height: 0.018,
        mode: 'momentary',
        event: 'cas.ack_caution',
        segments: [{ text: ['MASTER', 'CAUTION'], color: 'amber', var: ALERT.masterCaution, style: 'field' }],
      }),
      mid + sgn * 0.46,
      0.036,
    );
  }

  // --- GCU 275 display controllers (140 x 51 mm; Garmin unit image; S&D15 §10.3.D inset map pan/range, baro,
  //     flight planning): RANGE knob + joystick (PUSH PAN), CLR / ENT, dual FMS knob, Direct-To + COM/NAV over
  //     FPL + PROC, BARO knob (PUSH STD). Logic: avionics/garmin-g3000/state/Gcu.ts.
  for (const s of [1, 2] as const) {
    const cx = mid + (s === 1 ? -0.365 : 0.365);
    const u = gp.subPanel({ name: `m2.gcu${s}`, x: cx, y: 0.046, width: 0.14, height: 0.051, origin: 'top-left', material: 'bezel', screws: false, z: 0.003 });
    u.label('GARMIN', 0.07, 0.0045, { height: 0.0018, weight: 700, color: '#b8bcc2', zone: null });
    u.add(
      new MapJoystickKnob(env, {
        id: `m2.gcu${s}.range`,
        label: `GCU ${s} RANGE / PAN`,
        incEvent: inc(G3K_EVENTS.rangeTurn(s)),
        decEvent: dec(G3K_EVENTS.rangeTurn(s)),
        pushEvent: G3K_EVENTS.rangePush(s),
        joystickEvent: G3K_EVENTS.gcuJoystick(s),
        diameter: 0.017,
      }),
      0.02,
      0.027,
    );
    u.label('RANGE', 0.02, 0.011, { height: 0.0021 });
    u.label('PUSH PAN', 0.02, 0.045, { height: 0.0017, weight: 600 });
    const keyDef = (id: GcuKeyName, label: string) => ({ id: id.toLowerCase(), label });
    u.add(
      new KeyPad(env, {
        id: `m2.gcu${s}.clr_ent`,
        label: `GCU ${s} CLR / ENT`,
        eventPrefix: `g3k.gcu${s}.key_`,
        rows: [[keyDef('CLR', 'CLR')], [keyDef('ENT', 'ENT')]],
        keyWidth: 0.013,
        keyHeight: 0.009,
        gap: 0.004,
        keyMaterial: 'plasticBlack',
        legendHeight: 0.0024,
      }),
      0.035,
      0.012,
    );
    u.add(
      new RotaryKnob(env, {
        id: `m2.gcu${s}.fms`,
        label: `GCU ${s} FMS KNOB`,
        cap: 'ring',
        innerCap: 'fluted',
        diameter: 0.021,
        outer: { incEvent: inc(G3K_EVENTS.gcuFmsOuter(s)), decEvent: dec(G3K_EVENTS.gcuFmsOuter(s)), label: 'FMS OUTER' },
        inner: { incEvent: inc(G3K_EVENTS.gcuFmsInner(s)), decEvent: dec(G3K_EVENTS.gcuFmsInner(s)), label: 'FMS INNER' },
        push: { event: G3K_EVENTS.gcuFmsPush(s), label: 'PUSH ENT' },
      }),
      0.066,
      0.027,
    );
    u.label('PUSH ENT', 0.066, 0.045, { height: 0.0017, weight: 600 });
    u.add(
      new KeyPad(env, {
        id: `m2.gcu${s}.keys`,
        label: `GCU ${s} KEYS`,
        eventPrefix: `g3k.gcu${s}.key_`,
        rows: [
          [keyDef('DTO', 'D→'), keyDef('COMNAV', 'COM\nNAV')],
          [keyDef('FPL', 'FPL'), keyDef('PROC', 'PROC')],
        ],
        keyWidth: 0.013,
        keyHeight: 0.009,
        gap: 0.003,
        keyMaterial: 'plasticBlack',
        legendHeight: 0.0022,
      }),
      0.082,
      0.012,
    );
    u.add(encoderKnob(env, `m2.gcu${s}.baro`, `BARO ${s}`, G3K_EVENTS.baroTurn(s), G3K_EVENTS.baroPush(s), 0.016, 'knurled'), 0.124, 0.027);
    u.label('BARO', 0.124, 0.011, { height: 0.0021 });
    u.label('PUSH STD', 0.124, 0.045, { height: 0.0017, weight: 600 });
  }

  // --- ESI-1000 standby instrument (L-3: 3.7 in landscape AMLCD, 3-ATI bezel ~102 x 86 mm; light sensor top
  //     centre; four bezel keys M / S / - / + below the screen), inboard of the pilot's GCU 275.
  {
    const ex = mid - 0.228;
    const esi = gp.subPanel({ name: 'm2.esi', x: ex, y: 0.0475, width: 0.102, height: 0.086, origin: 'top-left', material: 'bezel', screws: false, z: 0.004 });
    esi.display(disp(c, 'esi'), 0.051, 0.04, 0.0752, 0.0564, { bezel: false, z: 0.002, display: { boot: false } });
    esi.label('L-3', 0.012, 0.006, { height: 0.0025, weight: 700, color: '#b8bcc2', zone: null });
    // Light sensor (automatic dimming photocell, S&D15 §10.3.U).
    esi.add(new AnnunciatorLight(env, { id: 'm2.esi.sensor', label: 'ESI LIGHT SENSOR', width: 0.004, height: 0.004, bezel: false, segments: [{ text: '', color: '#303030', var: M2.esiPowered, test: () => false }] }), 0.051, 0.0065);
    // Bezel keys (S&D15 §10.3.U: brightness, barometric setting, menu). Logic: EsiController (displays.ts).
    ['M', 'S', '-', '+'].forEach((lab, i) => {
      esi.add(
        new PushButton(env, { id: `m2.esi.b${i + 1}`, label: `ESI ${lab} KEY`, style: 'key', width: 0.011, height: 0.008, mode: 'momentary', var: ESI_VARS.button(i + 1), engraved: lab, engravedHeight: 0.0034, capMaterial: 'plasticGrey' }),
        0.024 + i * 0.018,
        0.077,
      );
    });
  }

  // --- Upper centre panel above the GMC 710 (S&D15 §10.2.A "Reversionary and Dimming Controls"; photos pin1 /
  //     Skies 2017 / S&D21 Fig 3): DISPLAY REV PILOT (NORM / REV), DIMMING bracket over FLOOD LTS, PANELS (DAY
  //     at the stop), DISPLAYS, TOUCH CONTROLS, DISPLAY REV COPILOT (NORM / REV). 241 x 40 mm, GMC width.
  {
    const up = gp.subPanel({ name: 'm2.dim_rev', x: mid, y: 0.0225, width: 0.241, height: 0.038, origin: 'top-left', material: 'panel', screws: false, z: 0.002 });
    const rev = (id: 'pfd1' | 'pfd2', who: string, x: number) => {
      up.add(
        new SelectorKnob(env, {
          id: `m2.rev.${id}`,
          var: G3K.reversionSwitch(id),
          label: `DISPLAY REV ${who}`,
          cap: 'pointer',
          diameter: 0.011,
          labelHeight: 0.0019,
          labelRadius: 0.0105,
          positions: [
            { value: 0, label: 'NORM', angle: -35 },
            { value: 1, label: 'REV', angle: 35 },
          ],
          initial: 0,
        }),
        x,
        0.025,
      );
      up.label(`DISPLAY REV\n${who}`, x, 0.0065, { height: 0.0019 });
    };
    rev('pfd1', 'PILOT', 0.021);
    rev('pfd2', 'COPILOT', 0.22);
    up.bracket('DIMMING', 0.1205, 0.006, 0.15, { height: 0.0024 });
    const autoFmt = (x: number) => (x <= 0.02 ? 'AUTO' : `${Math.round(x * 100)} %`);
    const dims: [string, string, string, number, (x: number) => string][] = [
      ['m2.flood_lt', M2.floodLt, 'FLOOD LTS', 0.063, (x) => (x <= 0.001 ? 'OFF' : `${Math.round(x * 100)} %`)],
      ['m2.panel_lt', M2.panelLt, 'PANELS', 0.101, (x) => (x >= 0.98 ? 'DAY' : x <= 0.001 ? 'OFF' : `${Math.round(x * 100)} %`)],
      ['m2.display_dim', M2.displayDim, 'DISPLAYS', 0.14, autoFmt],
      ['m2.gtc_dim', M2.gtcDim, 'TOUCH CONTROLS', 0.178, autoFmt],
    ];
    for (const [id, v, name, x, fmt] of dims) {
      up.add(dimmer(env, id, v, name, fmt), x, 0.026);
      up.label(name.replace(' ', '\n'), x, 0.0135, { height: 0.0018 });
    }
    up.label('DAY', 0.101 + 0.009, 0.034, { height: 0.0016, weight: 600 });
  }

  // --- GMC 710 AFCS mode controller (241 x 42 mm, SE Aerospace; Garmin unit image), six sections left to right:
  //     1 HDG / APR / NAV keys over the HDG knob (PUSH SYNC), BC, CRS1 knob (PUSH CTR); 2 FD over BANK; 3 XFR
  //     (side arrows) over AP / YD; 4 ALT / VS over the ALT SEL knob with VNV; 5 NOSE DN/UP wheel with FLC / SPD;
  //     6 CRS2 knob. Keys light green when the mode / function is on.
  const gmc = gp.subPanel({ name: 'm2.gmc', x: mid, y: 0.0655, width: 0.241, height: 0.042, origin: 'top-left', material: 'bezel', screws: false, z: 0.003 });
  const T = 0.0085;
  const B = 0.029;
  for (const x of [0.077, 0.1, 0.143, 0.197, 0.223]) gmc.line(x, 0.003, x, 0.039);
  // 1
  gmc.add(gmcKey(env, 'HDG', 'HDG'), 0.016, T);
  gmc.add(gmcKey(env, 'APR', 'APR'), 0.038, T);
  gmc.add(gmcKey(env, 'NAV', 'NAV'), 0.06, T);
  gmc.add(encoderKnob(env, 'm2.gmc.hdg', 'HDG', G3K_EVENTS.hdgTurn, G3K_EVENTS.hdgPush, 0.017), 0.016, 0.026);
  gmc.label('PUSH SYNC', 0.016, 0.0385, { height: 0.0016, weight: 600 });
  gmc.add(gmcKey(env, 'BC', 'BC'), 0.038, B);
  gmc.add(encoderKnob(env, 'm2.gmc.crs1', 'CRS1', G3K_EVENTS.crsTurn(1), G3K_EVENTS.crsPush(1), 0.016), 0.06, 0.026);
  gmc.label('PUSH CTR', 0.06, 0.0385, { height: 0.0016, weight: 600 });
  gmc.label('CRS1', 0.06, 0.0165, { height: 0.0016 });
  // 2
  gmc.add(gmcKey(env, 'FD', 'FD'), 0.0885, 0.0125);
  gmc.add(gmcKey(env, 'BANK', 'BANK'), 0.0885, B);
  // 3
  gmc.add(gmcKey(env, 'XFR', 'XFR'), 0.1215, 0.0125);
  gmc.add(new AnnunciatorLight(env, { id: 'm2.gmc.xfr_l', label: 'XFR LEFT', width: 0.004, height: 0.004, bezel: false, segments: [{ text: '', color: 'green', var: G3K.gmcLight('xfr_l') }] }), 0.1085, 0.0125);
  gmc.add(new AnnunciatorLight(env, { id: 'm2.gmc.xfr_r', label: 'XFR RIGHT', width: 0.004, height: 0.004, bezel: false, segments: [{ text: '', color: 'green', var: G3K.gmcLight('xfr_r') }] }), 0.1345, 0.0125);
  gmc.add(gmcKey(env, 'AP', 'AP'), 0.1125, B);
  gmc.add(gmcKey(env, 'YD', 'YD'), 0.1305, B);
  // 4
  gmc.add(gmcKey(env, 'ALT', 'ALT'), 0.153, T);
  gmc.add(gmcKey(env, 'VS', 'VS'), 0.173, T);
  gmc.add(
    new RotaryKnob(env, {
      id: 'm2.gmc.alt',
      label: 'ALT SEL',
      cap: 'ring',
      innerCap: 'fluted',
      diameter: 0.02,
      outer: { incEvent: inc(G3K_EVENTS.altTurnOuter), decEvent: dec(G3K_EVENTS.altTurnOuter), label: 'ALT 1000' },
      inner: { incEvent: inc(G3K_EVENTS.altTurnInner), decEvent: dec(G3K_EVENTS.altTurnInner), label: 'ALT 100' },
      push: { event: G3K_EVENTS.altPush, label: 'SYNC' },
    }),
    0.161,
    0.029,
  );
  gmc.add(gmcKey(env, 'VNAV', 'VNV'), 0.186, 0.031);
  // 5
  gmc.add(
    new Thumbwheel(env, {
      id: 'm2.gmc.nose',
      label: 'NOSE UP / DN',
      diameter: 0.026,
      width: 0.008,
      exposure: 0.25,
      orientation: 'vertical',
      // Rolling the top of the wheel away (mouse wheel up) = NOSE DN; toward the pilot = NOSE UP (+ clicks, vars.ts).
      channel: { incEvent: dec(G3K_EVENTS.noseWheel), decEvent: inc(G3K_EVENTS.noseWheel), label: 'NOSE' },
    }),
    0.203,
    0.021,
  );
  gmc.label('DN', 0.203, 0.0045, { height: 0.0017 });
  gmc.label('UP', 0.203, 0.0385, { height: 0.0017 });
  gmc.add(gmcKey(env, 'FLC', 'FLC'), 0.2145, 0.0125);
  gmc.add(gmcKey(env, 'SPD', 'SPD'), 0.2145, B);
  // 6
  gmc.add(encoderKnob(env, 'm2.gmc.crs2', 'CRS2', G3K_EVENTS.crsTurn(2), G3K_EVENTS.crsPush(2), 0.014), 0.2325, 0.024);
  gmc.label('CRS2', 0.2325, 0.0095, { height: 0.0016 });
  gmc.label('PUSH\nCTR', 0.2325, 0.037, { height: 0.0014, weight: 600 });

  // --- ENG FIRE (L / R): large-letter lens ~32 x 27 mm immediately outboard of the GMC at GMC height, under a
  //     clear hinged cover (525AFM-06 p.3-9 "ENGINE FIRE Button - LIFT COVER and PUSH"); BOTTLE n ARMED push button
  //     stacked directly below (photos pin1 / Skies 2017 / S&D21 Fig 3). Alternate action: pushed = armed.
  for (const i of [1, 2] as const) {
    const fx = mid + (i === 1 ? -0.143 : 0.143);
    gp.add(
      new GuardedButton(env, {
        id: `m2.engfire${i}`,
        label: `${i === 1 ? 'L' : 'R'} ENG FIRE`,
        style: 'korry',
        width: 0.032,
        height: 0.027,
        mode: 'toggle',
        var: M2.engFireBtn(i),
        stateNames: ['OUT', 'PUSHED (ARMED)'],
        // Large L / R over a small ENG FIRE (photos): split legend, letter segment 2/3 of the lens.
        layout: 'stack',
        segments: [
          { text: i === 1 ? 'L' : 'R', color: 'red', var: M2.engFireLight(i), style: 'field' },
          { text: 'ENG FIRE', color: 'red', var: M2.engFireLight(i), style: 'field' },
        ],
        guard: { color: 'clear', width: 0.036, length: 0.031, height: 0.012, hinge: 'top' },
      }),
      fx,
      0.047,
    );
    gp.add(
      new PushButton(env, {
        id: `m2.bottle${i}`,
        label: `BOTTLE ${i} ARMED`,
        style: 'korry',
        width: 0.026,
        height: 0.015,
        mode: 'momentary',
        var: M2.bottleBtn(i),
        segments: [{ text: ['BOTTLE', `${i} ARMED`], color: 'white', var: M2.bottleLight(i) }],
      }),
      fx,
      0.0805,
    );
  }
}
