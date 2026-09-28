/**
 * 737-800 main instrument panel: Captain P1, centre P2 and F/O P3 in one
 * plane (layout.ts MIP), plus the standby magnetic compass on the windshield
 * centre post and the manual gear extension handle in the floor.
 *
 * Layout: measured on the Simulation Cockpit Builder Group (SCBG) 1:1 737NG
 * main panel drawing (cm ruler; /tmp/ref crops, ~2,840 px/m), offsets from
 * the DU row centre (layout.ts `mv`). Outline: stepped top edge (outboard
 * P1-1 / P3-3 sections lower and sloped, inboard sections higher, P2 raised;
 * capped under the glareshield soffit), separate lower strips P1-1 / P1-3 /
 * P3-1 / P3-3 below the DUs, DU frames in individual bezel plates, P2 ending
 * at the upper DU bezel with P9 (lower DU and CDUs, pedestal.ts) below it.
 *
 *  P1 upper strip: BELOW G/S P-INHIBIT (outboard), TAKEOFF CONFIG / CABIN
 *    ALTITUDE (EST, see below), MAIN PANEL DUs / LOWER DU selectors,
 *    A/P / A/T / FMC P/RST lights with the TEST switch, SPEED BRAKE ARMED /
 *    DO NOT ARM and STAB OUT OF TRIM lights, LIGHTS TEST / BRT / DIM.
 *  P1 outboard: square clock (CHR, TIME/DATE, ET RUN/HLD, RESET, SET, + / -),
 *    NOSE WHEEL STEERING ALT / NORM (guarded), REGISTRATION / SELCAL placard.
 *  P1 lower strips: FOOT AIR / WINDSHIELD AIR pull knobs; MAIN PANEL BRIGHT,
 *    UPPER / OUTBD / INBD / LOWER DU BRT; BACKGROUND and AFDS FLOOD.
 *  P2: ISFD (standby column); N1 SET / SPD REF / FUEL FLOW / MFD; AUTO BRAKE
 *    with AUTO BRAKE DISARM and ANTI SKID INOP; FLAPS indicator with LE
 *    FLAPS TRANSIT / EXT; gear lights (NOSE over LEFT / RIGHT); gear lever in
 *    its full-height slot with the gear / flap limit placard under it.
 *  P3 upper strip: BRAKE PRESS gauge with SPEEDBRAKES EXTENDED under it,
 *    A/P / A/T / FMC lights with TEST, BELOW G/S, LOWER DU / MAIN PANEL DUs.
 *  P3 lower strips: GROUND PROXIMITY (INOP, SYS TEST, FLAP / GEAR / TERR
 *    INHIBIT); MAIN PANEL BRIGHT, INBD / OUTBD DU BRT; WINDSHIELD / FOOT AIR.
 * FCOM 10.10, 14.10, 15.20 for the functions.
 */
import * as THREE from 'three';
import { GearHandle, GuardedSwitch, PushButton, RotaryKnob, SelectorKnob, TBarHandle } from '../../../cockpit/controls';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { MagneticCompass } from '../../../avionics/analog';
import { addCentreControls, addDisengageLights, addDisplaySelect, addDuBrightness } from '../../../avionics/boeing-737';
import { B737_HW } from '../../../avionics/boeing-737/cockpit';
import { B738_FLAPS, B738_SPEEDS } from '../../../avionics/boeing-737/data/b738';
import { DISPLAY_VARS } from '../../../cockpit/types';
import { B738, B738_DISPLAY_IDS } from '../vars';
import type { B738CockpitContext } from './context';
import { CK, seg } from './context';
import { annunciator, dimmer, toggle } from './common';
import { ClockDisplay, DialDisplay, FLAP_DIAL, IsfdDisplay } from './displays';
import { COMPASS, DU_U, FLOOR_Z, MIP, P2_HALF_W, mv } from './layout';

/** Legend heights (SCBG 1:1 drawing: panel titles ~3-3.5 mm, position legends ~2.5 mm). */
const TITLE_H = 0.0032;
const LEG_H = 0.0026;

/**
 * Stepped MIP outline (u, offset from the DU centre), Captain half, outboard -> inboard along the top, from the
 * SCBG drawing. The drawing's raised P2 top (+0.247) is capped at the glareshield soffit (+0.205 here: the MIP
 * top meets the soffit at z -0.265).
 */
const TOP_CAPT: [number, number][] = [
  [-0.745, 0.128],
  [-0.64, 0.149],
  [-0.36, 0.187],
  [-0.3, 0.205],
];
const LOWER_Y = -0.196;
const P2_LOW_Y = -0.106;

function outlineShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-0.735, mv(LOWER_Y));
  s.lineTo(-P2_HALF_W, mv(LOWER_Y));
  s.lineTo(-P2_HALF_W, mv(P2_LOW_Y));
  s.lineTo(P2_HALF_W, mv(P2_LOW_Y));
  s.lineTo(P2_HALF_W, mv(LOWER_Y));
  s.lineTo(0.735, mv(LOWER_Y));
  for (let i = 0; i < TOP_CAPT.length; i++) s.lineTo(-TOP_CAPT[i][0], mv(TOP_CAPT[i][1]));
  for (let i = TOP_CAPT.length - 1; i >= 0; i--) s.lineTo(TOP_CAPT[i][0], mv(TOP_CAPT[i][1]));
  s.closePath();
  return s;
}

export function buildMainPanel(c: B738CockpitContext): void {
  const { b, env, ctx, sys } = c;
  const vars = ctx.vars;
  // Frame only: the plate is the stepped outline below.
  const p = b.panel({ name: 'b738.mip', ...MIP, origin: 'center', invisible: true });
  {
    const depth = 0.004;
    const g = new THREE.ExtrudeGeometry(outlineShape(), { depth, bevelEnabled: false, curveSegments: 4 });
    g.translate(0, 0, -depth);
    b.trackGeometry(g);
    const m = new THREE.Mesh(g, env.materials.get('panel'));
    m.name = 'mip_outline_plate';
    m.userData.cockpitStatic = true;
    p.addObject(m, 0, 0);
  }
  const suite = sys.suite;
  const plate = (name: string, u0: number, u1: number, y0: number, y1: number): Panel =>
    p.subPanel({ name, x: (u0 + u1) / 2, y: mv((y0 + y1) / 2), width: u1 - u0, height: y1 - y0, origin: 'center', material: 'panel', thickness: 0.003, screws: { kind: 'dzus', diameter: 0.0065, positions: [[u0 - (u0 + u1) / 2 + 0.006, (y1 - y0) / 2 - 0.006], [u1 - (u0 + u1) / 2 - 0.006, (y1 - y0) / 2 - 0.006], [u0 - (u0 + u1) / 2 + 0.006, -(y1 - y0) / 2 + 0.006], [u1 - (u0 + u1) / 2 - 0.006, -(y1 - y0) / 2 + 0.006]] } });

  // ---------------------------------------------------------------- display units (the lower DU is on P9, pedestal.ts)
  for (const d of suite.du) {
    if (d.du === 'lower') continue;
    const u = DU_U[d.du];
    // Individual DU bezel plate (SCBG: each DU recessed in its own 0.21 m plate).
    plate(`b738.du_plate_${d.du}`, u - 0.105, u + 0.105, -0.106, 0.104);
    p.display(d, u, mv(0), B737_HW.du.w, B737_HW.du.h, { bezel: { border: B737_HW.du.border, material: 'bezel' }, z: 0.003 });
  }

  // ---------------------------------------------------------------- lower strips (P1-1, P1-3 / P3-1, P3-3 plates)
  const lower = {
    p11: plate('b738.mip.p1_1', -0.735, -0.558, LOWER_Y, P2_LOW_Y),
    p12: plate('b738.mip.p1_2', -0.558, -0.415, LOWER_Y, P2_LOW_Y),
    p13: plate('b738.mip.p1_3', -0.415, -P2_HALF_W, LOWER_Y, P2_LOW_Y),
    p31: plate('b738.mip.p3_1', P2_HALF_W, 0.414, LOWER_Y, P2_LOW_Y),
    p32: plate('b738.mip.p3_2', 0.414, 0.555, LOWER_Y, P2_LOW_Y),
    p33: plate('b738.mip.p3_3', 0.555, 0.735, LOWER_Y, P2_LOW_Y),
  };
  void lower;

  // ---------------------------------------------------------------- Captain / F/O outboard: clock, NWS, placard
  for (const s of [1, 2] as const) {
    const sg = s === 1 ? -1 : 1;
    const pfx = `b738.mip${s}`;
    buildClock(c, p, s, sg * 0.66, mv(0.046));
    p.placard({ text: 'REGISTRATION\nSELCAL', height: 0.0028, style: 'engraved', box: 0.25 }, sg * 0.66, mv(-0.056));
    // ---- upper strip
    // A/P, A/T, FMC P/RST lights and TEST (SCBG: Capt u -0.283, F/O +0.29, 0.154 above the DU centre).
    addDisengageLights(b, p, sg === -1 ? -0.283 : 0.29, mv(0.154), s, { material: 'panel' });
    // MAIN PANEL DUs / LOWER DU selectors on a common plate over the PFD / ND boundary (F/O mirrored).
    addDisplaySelect(b, p, sg === -1 ? -0.4065 : 0.4, mv(0.14), s, { material: 'panel', mirror: s === 2 });
    // BELOW G/S P-INHIBIT (Capt outboard end of the strip, F/O beside SPEEDBRAKES EXTENDED).
    p.add(
      new PushButton(env, {
        id: `${pfx}.below_gs`,
        label: 'BELOW G/S P-INHIBIT',
        style: 'korry',
        width: 0.024,
        height: 0.012,
        mode: 'momentary',
        var: B738.belowGs(s),
        segments: [{ text: ['BELOW G/S', 'P-INHIBIT'], color: 'amber', var: B738.lt.belowGs, style: 'legend' }],
      }),
      s === 1 ? -0.565 : 0.319,
      mv(s === 1 ? 0.122 : 0.123),
    );
    // EST: TAKEOFF CONFIG / CABIN ALTITUDE lights are a post-2008 retrofit (FAA AD 2008-23-07, separate lights
    // for the shared intermittent horn) not on the early-NG SCBG drawing; placed in the upper strip between
    // BELOW G/S and the display select plate (Capt) / outboard of the display select plate (F/O) until a
    // late-NG photograph confirms the spot.
    annunciator(env, p, `${pfx}.to_config`, 'TAKEOFF CONFIG', [seg.on(['TAKEOFF', 'CONFIG'], 'red', B738.lt.takeoffConfig)], sg * 0.528, mv(0.122), 0.026, 0.013);
    annunciator(env, p, `${pfx}.cabin_alt`, 'CABIN ALTITUDE', [seg.on(['CABIN', 'ALTITUDE'], 'red', B738.lt.cabinAltitude)], sg * 0.497, mv(0.122), 0.026, 0.013);
    // ---- lower strip: MAIN PANEL BRIGHT, DU brightness (Capt: UPPER / OUTBD / INBD / LOWER; F/O: INBD / OUTBD).
    const ds = s === 1 ? lower.p12 : lower.p32;
    const dc = s === 1 ? (-0.558 + -0.415) / 2 : (0.414 + 0.555) / 2;
    const at = (u: number, dy: number): [number, number] => [u - dc, dy - (LOWER_Y + P2_LOW_Y) / 2];
    {
      const [x, y] = at(sg * 0.524, -0.13);
      dimmer(env, ds, `${pfx}.panel_lt`, s === 1 ? 'CAPT MAIN PANEL BRIGHT' : 'F/O MAIN PANEL BRIGHT', B738.panelLt(s), x, y, undefined, 0.02);
      ds.label('MAIN PANEL', x, y + 0.019, { height: LEG_H });
      ds.label('BRIGHT', x, y + 0.0135, { height: 0.0021 });
      ds.label('OFF', x - 0.016, y - 0.012, { height: 0.0021 });
    }
    const brt = (du: 'capt_out' | 'capt_in' | 'upper' | 'lower' | 'fo_in' | 'fo_out', u: number, dy: number, name: string) => {
      const [x, y] = at(u, dy);
      addDuBrightness(b, ds, x, y, [du]);
      ds.label(name, x, y + 0.017, { height: 0.0022 });
      ds.label('BRT', x, y + 0.012, { height: 0.0022 });
    };
    if (s === 1) {
      brt('upper', -0.45, -0.13, 'UPPER DU');
      brt('capt_out', -0.527, -0.172, 'OUTBD DU');
      brt('capt_in', -0.488, -0.172, 'INBD DU');
      brt('lower', -0.45, -0.172, 'LOWER DU');
    } else {
      brt('fo_in', 0.488, -0.17, 'INBD DU');
      brt('fo_out', 0.525, -0.17, 'OUTBD DU');
    }
    // ---- FOOT AIR / WINDSHIELD AIR push-pull knobs (SCOPE: conditioned-air outlet split only, vars.ts).
    const air = s === 1 ? lower.p11 : lower.p33;
    const ac = s === 1 ? (-0.735 + -0.558) / 2 : (0.555 + 0.735) / 2;
    for (const [k, name, u, v] of [
      ['foot', 'FOOT AIR', sg * (s === 1 ? 0.619 : 0.614), B738.footAir(s)],
      ['ws', 'WINDSHIELD AIR', sg * (s === 1 ? 0.582 : 0.585), B738.windshieldAir(s)],
    ] as const) {
      const x = u - ac;
      const y = (s === 1 ? -0.129 : -0.123) - (LOWER_Y + P2_LOW_Y) / 2;
      air.add(new TBarHandle(env, { id: `${pfx}.${k}_air`, label: `${s === 1 ? 'CAPT' : 'F/O'} ${name} (pull)`, var: v, style: 'knob', pullLength: 0.018, material: 'knob' }), x, y);
      air.label(k === 'foot' ? 'FOOT\nAIR' : 'WIND-\nSHIELD\nAIR', x, y - 0.02, { height: 0.0022, lineHeight: 1.2 });
    }
  }

  // ---------------------------------------------------------------- Captain upper strip: speed brake / stab lights, LIGHTS
  annunciator(env, p, 'b738.mip1.sb_dna', 'SPEEDBRAKE DO NOT ARM', [seg.on(['SPEED BRAKE', 'DO NOT ARM'], 'amber', B738.lt.speedbrakeDoNotArm)], -0.289, mv(0.136), 0.024, 0.012);
  annunciator(env, p, 'b738.mip1.sb_armed', 'SPEEDBRAKE ARMED', [seg.on(['SPEED BRAKE', 'ARMED'], 'green', B738.lt.speedbrakeArmed)], -0.289, mv(0.122), 0.024, 0.012);
  annunciator(env, p, 'b738.mip1.stab_oot', 'STAB OUT OF TRIM', [seg.on(['STAB', 'OUT OF', 'TRIM'], 'amber', B738.lt.stabOutOfTrim)], -0.262, mv(0.129), 0.017, 0.017);
  {
    const lt = p.subPanel({ name: 'b738.mip1.lights_plate', x: -0.214, y: mv(0.152), width: 0.04, height: 0.045, origin: 'center', material: 'panel', thickness: 0.003 });
    toggle(env, lt, { id: 'b738.mip1.lights', label: 'LIGHTS', var: B738.lightsTest, positions: ['DIM', 'BRT', 'TEST'], values: [-1, 0, 1], initial: 1, scale: 0.8, labels: { name: false, positions: false, height: LEG_H } }, 0, -0.004);
    lt.label('LIGHTS', 0, 0.017, { height: TITLE_H });
    lt.label('TEST', 0, 0.0095, { height: 0.0022 });
    lt.label('BRT', 0.013, -0.004, { height: 0.0022 });
    lt.label('DIM', 0, -0.018, { height: 0.0022 });
  }
  // NOSE WHEEL STEERING ALT / NORM guarded switch on its own plate under the Captain clock (SCBG).
  {
    const nws = p.subPanel({ name: 'b738.mip1.nws_plate', x: -0.66, y: mv(-0.023), width: 0.075, height: 0.03, origin: 'center', material: 'panel', thickness: 0.003 });
    nws.add(
      new GuardedSwitch(env, {
        id: 'b738.mip1.nws',
        label: 'NOSE WHEEL STEERING',
        var: B738.nwsSw,
        positions: ['ALT', 'NORM'],
        values: [0, 1],
        initial: 1,
        orientation: 'horizontal',
        scale: 0.8,
        labels: { name: false, positions: false, height: 0.0022 },
        guard: { color: 'black', guardedPosition: 1, hinge: 'right' },
      }),
      0,
      -0.003,
    );
    nws.label('NOSE WHEEL STEERING', 0, 0.011, { height: 0.0022 });
    nws.label('A\nL\nT', -0.026, -0.003, { height: 0.0019, lineHeight: 1.1 });
    nws.label('N\nO\nR\nM', 0.026, -0.003, { height: 0.0017, lineHeight: 1.05 });
  }

  // ---------------------------------------------------------------- Captain P1-3 lower strip: BACKGROUND, AFDS FLOOD
  {
    const d = lower.p13;
    const cU = (-0.415 + -P2_HALF_W) / 2;
    const y = -0.13 - (LOWER_Y + P2_LOW_Y) / 2;
    for (const [id, name, v, u] of [
      ['background', 'BACKGROUND', B738.backgroundLt, -0.38],
      ['afds_flood', 'AFDS FLOOD', B738.afdsFlood, -0.305],
    ] as const) {
      dimmer(env, d, `b738.mip1.${id}`, name, v, u - cU, y, undefined, 0.02);
      d.label(name, u - cU, y + 0.019, { height: LEG_H });
      d.label('BRIGHT', u - cU, y + 0.0135, { height: 0.0021 });
      d.label('OFF', u - cU - 0.016, y - 0.012, { height: 0.0021 });
    }
  }
  // EST: GLARESHIELD FLOOD rheostat. Not on the early-NG SCBG drawing (where the real control sits is unverified);
  // kept on the P1-1 lower strip under the FOOT / WINDSHIELD AIR knobs so the glareshield floods stay controllable.
  {
    const d = lower.p11;
    const cU = (-0.735 + -0.558) / 2;
    const y = -0.172 - (LOWER_Y + P2_LOW_Y) / 2;
    dimmer(env, d, 'b738.mip1.gs_flood', 'GLARESHIELD FLOOD', B738.glareshieldFlood, -0.6 - cU, y, undefined, 0.014);
    d.label('GLARESHIELD FLOOD', -0.6 - cU, y + 0.013, { height: 0.0021 });
  }

  // ---------------------------------------------------------------- P2: ISFD in the standby column (between the Capt ND and the upper DU)
  {
    const isfd = p.subPanel({ name: 'b738.isfd', x: -0.135, y: mv(0.098), width: 0.1, height: 0.125, origin: 'center', material: 'bezel', thickness: 0.012 });
    if (!c.headless) {
      const d = new IsfdDisplay(vars, B738_DISPLAY_IDS.isfd);
      isfd.display(d, 0, 0.017, 0.078, 0.078, { bezel: false });
      c.onDispose(() => d.dispose());
    }
    const btn = (id: string, legend: string, x: number, o: Partial<ConstructorParameters<typeof PushButton>[1]>) =>
      isfd.add(new PushButton(env, { id: `b738.mip.isfd_${id}`, label: `ISFD ${legend}`, style: 'small', width: 0.011, height: 0.008, engraved: legend, engravedHeight: 0.0019, ...o }), x, -0.042);
    btn('app', 'APP', -0.036, { mode: 'cycle', values: [0, 1, 2], stateNames: ['OFF', 'ILS', 'B-CRS'], var: B738.isfdApp });
    btn('hpa', 'HP/IN', -0.022, { mode: 'toggle', stateNames: ['IN', 'HPA'], var: B738.isfdHpa });
    const brt = DISPLAY_VARS.brightness(B738_DISPLAY_IDS.isfd);
    const bump = (d: number) => (x: number) => {
      if (x !== 0) vars.set(brt, Math.max(0.1, Math.min(1, vars.get(brt, 1) + d)));
    };
    btn('dim', '-', -0.008, { mode: 'momentary', var: 'ac.b738.ck.isfd_dim', onChange: bump(-0.1) });
    btn('brt', '+', 0.006, { mode: 'momentary', var: 'ac.b738.ck.isfd_brt', onChange: bump(0.1) });
    btn('rst', 'RST', 0.02, { mode: 'momentary', var: B738.isfdRst });
    isfd.add(
      new RotaryKnob(env, {
        id: 'b738.mip.isfd_baro',
        label: 'ISFD BARO',
        cap: 'knurled',
        diameter: 0.012,
        // Baro setting of the ISFD's own air data (adc3), push = STD (FCOM 10.10).
        outer: { var: 'adc3.baro_inhg', min: 28.0, max: 31.0, step: 0.01, initial: 29.92, accel: { fastStep: 0.1 }, label: 'BARO', format: (v) => `${v.toFixed(2)} IN` },
        push: { var: B738.isfdStd, mode: 'momentary', label: 'STD' },
      }),
      0.038,
      -0.04,
    );
  }
  // SCOPE: the lower half of the standby column (standby RMI on early NGs, blank on ISFD aircraft) is a plain plate.
  plate('b738.stby_col_plate', -0.188, -0.083, -0.1, -0.005);

  // ---------------------------------------------------------------- P2 upper strip (above the upper DU)
  // N1 SET / SPD REF knobs over FUEL FLOW and the MFD buttons.
  addCentreControls(b, p, -0.0205, mv(0.147), { layout: 'stack', material: 'panel' });
  // AUTO BRAKE selector with AUTO BRAKE DISARM above and ANTI SKID INOP below.
  annunciator(env, p, 'b738.mip.ab_disarm', 'AUTO BRAKE DISARM', [seg.on(['AUTO BRAKE', 'DISARM'], 'amber', B738.lt.autoBrakeDisarm)], 0.042, mv(0.176), 0.024, 0.012);
  p.add(
    new SelectorKnob(env, {
      id: 'b738.mip.autobrake',
      label: 'AUTO BRAKE',
      var: B738.autobrake,
      positions: [
        { value: -1, label: 'RTO', gated: true },
        { value: 0, label: 'OFF' },
        { value: 1, label: '1' },
        { value: 2, label: '2' },
        { value: 3, label: '3' },
        { value: 4, label: 'MAX' },
      ],
      initial: 1,
      diameter: 0.016,
      labelHeight: 0.0022,
    }),
    0.042,
    mv(0.149),
  );
  p.label('AUTO BRAKE', 0.042, mv(0.187) - 0.0025, { height: 0.0021 });
  annunciator(env, p, 'b738.mip.antiskid_inop', 'ANTISKID INOP', [seg.on(['ANTI SKID', 'INOP'], 'amber', B738.lt.antiskidInop)], 0.042, mv(0.119), 0.024, 0.012);
  // FLAPS dual-needle indicator with LE FLAPS TRANSIT / EXT side by side under it.
  if (!c.headless) {
    const flaps = new DialDisplay({
      id: 'b738_flap_ind',
      vars,
      powerVar: 'elec.ac_stby_powered',
      angle: FLAP_DIAL.angle,
      ticks: FLAP_DIAL.marks.map((m) => ({ v: m, label: String(m) })),
      needles: [
        { var: B738.lt.flapGauge('l'), color: '#f2f2f2', tag: 'L', width: 8 },
        { var: B738.lt.flapGauge('r'), color: '#f2f2f2', tag: 'R', width: 8 },
      ],
      title: ['FLAPS'],
      titleY: 186,
    });
    p.roundInstrument(flaps, 0.098, mv(0.151), 0.05);
    c.onDispose(() => flaps.dispose());
  }
  annunciator(env, p, 'b738.mip.le_transit', 'LE FLAPS TRANSIT', [seg.on(['LE FLAPS', 'TRANSIT'], 'amber', B738.lt.leFlapsTransit)], 0.09, mv(0.117), 0.024, 0.012);
  annunciator(env, p, 'b738.mip.le_ext', 'LE FLAPS EXT', [seg.on(['LE FLAPS', 'EXT'], 'green', B738.lt.leFlapsExt)], 0.114, mv(0.117), 0.024, 0.012);
  // EST: FLAP LOAD RELIEF light (not on the early-NG drawing) beside the LE FLAPS lights.
  annunciator(env, p, 'b738.mip.flap_load_relief', 'FLAP LOAD RELIEF', [seg.on(['FLAP LOAD', 'RELIEF'], 'amber', B738.lt.flapLoadRelief)], 0.066, mv(0.117), 0.02, 0.012);

  // ---------------------------------------------------------------- P2: gear lights, lever slot, limit placard
  // Lights (SCBG): NOSE GEAR red over green on top, LEFT / RIGHT GEAR side by side under it (red row over green).
  const gearLt = (leg: 0 | 1 | 2, name: string, u: number, red: number, green: number) => {
    annunciator(env, p, `b738.mip.gear_red${leg}`, `${name} GEAR (red)`, [seg.on([name, 'GEAR'], 'red', B738.lt.gearRed(leg))], u, mv(red), 0.025, 0.012);
    annunciator(env, p, `b738.mip.gear_green${leg}`, `${name} GEAR (green)`, [seg.on([name, 'GEAR'], 'green', B738.lt.gearGreen(leg))], u, mv(green), 0.025, 0.012);
  };
  gearLt(0, 'NOSE', 0.157, 0.178, 0.165);
  gearLt(1, 'LEFT', 0.143, 0.151, 0.138);
  gearLt(2, 'RIGHT', 0.171, 0.151, 0.138);
  // Lever in a tall vertical slot the full DU height right of the upper DU (UP top, OFF, DN bottom).
  const gu = 0.161;
  p.subPanel({ name: 'b738.mip.gear_slot', x: gu, y: mv(0.049), width: 0.026, height: 0.145, origin: 'center', material: 'panelDark', thickness: 0.004, radius: 0.012, screws: false });
  p.add(
    new GearHandle(env, {
      id: 'b738.mip.gear',
      label: 'LANDING GEAR',
      var: B738.gearLever,
      positions: ['DN', 'OFF', 'UP'],
      values: [1, 0.5, 0],
      initial: 0,
      // Lever lock solenoid: UP blocked with weight on wheels unless the override trigger is held (FCOM 14.20).
      inhibit: (to, _from, v) => !(to === 2 && v.get('gear.handle_lock') !== 0),
      length: 0.1,
      swingDeg: 34,
      labels: false,
    }),
    gu,
    mv(0.049),
  );
  p.label('UP', gu - 0.02, mv(0.103), { height: LEG_H });
  p.label('OFF', gu - 0.021, mv(0.063), { height: LEG_H });
  p.label('DN', gu - 0.02, mv(0.026), { height: LEG_H });
  p.label('L\nA\nN\nD\nI\nN\nG\n\nG\nE\nA\nR', gu - 0.021, mv(0.052), { height: 0.0028, lineHeight: 1.05, anchor: 'middle' });
  p.add(new PushButton(env, { id: 'b738.mip.gear_ovrd', label: 'GEAR LEVER LOCK OVERRIDE', style: 'small', width: 0.008, height: 0.008, mode: 'momentary', var: B738.gearLockOvrd, capMaterial: 'knobRed' }), gu + 0.021, mv(0.085));
  p.label('OVRD', gu + 0.021, mv(0.095), { height: 0.0019 });
  // LANDING GEAR LIMIT (IAS) / FLAPS LIMIT (IAS) placard under the lever (values: data/b738 [LIM] / [PLAC]).
  {
    const sp = B738_SPEEDS;
    const m = `.${Math.round(sp.gearMach * 100)}M`;
    const f = B738_FLAPS.filter((x) => x.deg > 0).map((x) => `${x.label}-${x.placardKt}K`);
    const flapLines: string[] = [];
    for (let i = 0; i < 4; i++) flapLines.push(`${f[i].padEnd(7)}  ${f[i + 4] ?? ''}`);
    const text = ['LANDING GEAR', 'LIMIT (IAS)', 'OPERATING', `EXTEND ${sp.vloExtendKt}K-${m}`, `RETRACT ${sp.vloRetractKt}K`, `EXTENDED ${sp.vleKt}K-${m}`, 'FLAPS LIMIT (IAS)', ...flapLines].join('\n');
    p.placard({ text, height: 0.0019, style: 'engraved', align: 'center' }, gu, mv(-0.06));
  }

  // ---------------------------------------------------------------- P3 upper strip: brake pressure gauge, SPEEDBRAKES EXTENDED
  if (!c.headless) {
    const bp = new DialDisplay({
      id: 'b738_brake_press',
      vars,
      powerVar: null, // direct-reading (accumulator pressure transmitter, EST mechanical-look gauge)
      angle: (v) => -135 + (Math.max(0, Math.min(4000, v)) / 4000) * 270,
      ticks: [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000].map((v) => (v % 1000 === 0 ? { v, label: String(v / 1000) } : { v, major: false })),
      needles: [{ var: B738.lt.hydBrakePsi, color: '#f2f2f2' }],
      title: ['BRAKE', 'PRESS', 'PSI x 1000'],
      titleY: 158,
      quantum: 20,
    });
    p.roundInstrument(bp, 0.2205, mv(0.151), 0.042);
    c.onDispose(() => bp.dispose());
  }
  annunciator(env, p, 'b738.mip2.sb_ext', 'SPEEDBRAKE EXTENDED', [seg.on(['SPEEDBRAKES', 'EXTENDED'], 'amber', B738.lt.speedbrakeExtended)], 0.265, mv(0.123), 0.024, 0.012);

  // ---------------------------------------------------------------- P3-1 lower strip: GROUND PROXIMITY panel
  {
    const g = lower.p31;
    const cU = (P2_HALF_W + 0.414) / 2;
    const cy = (LOWER_Y + P2_LOW_Y) / 2;
    const X = (u: number) => u - cU;
    const Y = (dy: number) => dy - cy;
    g.label('GROUND PROXIMITY', X(0.345), Y(-0.111), { height: 0.0024 });
    g.label('GPWS', X(0.299), Y(-0.113), { height: 0.0021 });
    annunciator(env, g, 'b738.mip.gpws_inop', 'GPWS INOP', [seg.on('INOP', 'amber', B738.lt.gpwsInop)], X(0.299), Y(-0.121), 0.02, 0.009);
    g.add(new PushButton(env, { id: 'b738.mip.gpws_test', label: 'GPWS SYS TEST', style: 'round', width: 0.01, height: 0.01, mode: 'momentary', var: B738.gpwsTest, capMaterial: 'plasticBlack' }), X(0.299), Y(-0.141));
    g.label('SYS TEST', X(0.299), Y(-0.152), { height: 0.0021 });
    const guarded = (id: string, name: string, v: string, u: number) => {
      g.add(
        new GuardedSwitch(env, {
          id: `b738.mip.gpws_${id}`,
          label: `GPWS ${name} INHIBIT`,
          var: v,
          positions: ['NORMAL', 'INHIBIT'],
          values: [0, 1],
          initial: 0,
          scale: 0.8,
          labels: { name: false, positions: false, height: 0.0019 },
          // SCBG drawing: tall black flip covers over each switch, NORM legend under them.
          guard: { color: 'black', guardedPosition: 0, length: 0.05, width: 0.017 },
        }),
        X(u),
        Y(-0.147),
      );
      g.label(`${name}\nINHIBIT`, X(u), Y(-0.117), { height: 0.0019, lineHeight: 1.15 });
      g.label('NORM', X(u), Y(-0.178), { height: 0.0019 });
    };
    guarded('flap', 'FLAP', B738.gpwsFlapInh, 0.346);
    guarded('gear', 'GEAR', B738.gpwsGearInh, 0.368);
    guarded('terr', 'TERR', B738.gpwsTerrInh, 0.389);
  }

  // ---------------------------------------------------------------- standby compass on the windshield centre post
  // (Canvas-painted card: not built headless.)
  if (!c.headless) {
    const compass = new MagneticCompass({ id: 'b738.compass', vars, lightVar: CK.panelLight, width: 0.07 });
    b.place(compass, { center_m: COMPASS, facing: 'aft', tiltDeg: 10 });
  }

  // ---------------------------------------------------------------- manual gear extension handles (F/O floor access door, dossier §10.13)
  const floor = b.panel({ name: 'b738.gear_manual', center_m: [14.05, 0.92, FLOOR_Z - 0.005], facing: 'up', width: 0.2, height: 0.16, material: 'panelDark', screws: false });
  floor.add(
    new TBarHandle(env, {
      id: 'b738.mip.gear_manual_ext',
      label: 'MANUAL GEAR EXTENSION',
      var: B738.gearManualExt,
      style: 'tbar',
      material: 'knobRed',
      pullLength: 0.06,
    }),
    0,
    0,
  );
  floor.label('MANUAL GEAR EXTENSION', 0, 0.06, { height: 0.003 });
}

/**
 * Square-bezel Smiths clock (SCBG drawing, 0.084 m bezel): CHR push top-left, TIME/DATE push top-right, ET RUN /
 * HLD switch bottom-left, RESET push at the bottom, SET push on the right edge with + / - below it.
 */
function buildClock(c: B738CockpitContext, p: Panel, s: 1 | 2, u: number, v: number): void {
  const { env, ctx } = c;
  const pfx = `b738.mip${s}`;
  const bz = p.subPanel({ name: `${pfx}.clock`, x: u, y: v, width: 0.084, height: 0.084, origin: 'center', material: 'bezel', thickness: 0.01, radius: 0.014, screws: false });
  if (!c.headless) {
    const clk = new ClockDisplay(ctx.vars, `b738_clock${s}`, s);
    bz.display(clk, 0, 0, 0.062, 0.062, { bezel: false });
    c.onDispose(() => clk.dispose());
  }
  const push = (id: string, name: string, v: string, x: number, y: number, legend: string, lx: number, ly: number) => {
    bz.add(new PushButton(env, { id: `${pfx}.${id}`, label: `CLOCK ${s} ${name}`, style: 'small', width: 0.009, height: 0.009, mode: 'momentary', var: v, capMaterial: 'plasticBlack' }), x, y);
    bz.label(legend, lx, ly, { height: 0.0021 });
  };
  push('chr', 'CHR', B738.clockChr(s), -0.034, 0.034, 'CHR', -0.024, 0.039);
  push('timedate', 'TIME/DATE', B738.clockTimeDate(s), 0.034, 0.034, 'TIME/DATE', 0.012, 0.039);
  push('reset', 'RESET', B738.clockReset(s), 0, -0.037, 'RESET', -0.012, -0.037);
  push('set', 'SET', B738.clockSet(s), 0.037, 0.012, 'SET', 0.037, 0.02);
  push('plus', '+', B738.clockPlus(s), 0.037, -0.012, '+', 0.037, -0.005);
  push('minus', '-', B738.clockMinus(s), 0.034, -0.034, '-', 0.025, -0.039);
  toggle(env, bz, { id: `${pfx}.et`, label: `CLOCK ${s} ET RUN/HLD`, var: B738.clockEt(s), positions: ['HLD', 'RUN'], values: [-1, 0], initial: 1, scale: 0.5, labels: { name: false, positions: false, height: 0.0019 } }, -0.034, -0.032);
  bz.label('ET', -0.04, -0.02, { height: 0.0019 });
  bz.label('RUN\nHLD', -0.026, -0.02, { height: 0.0017, lineHeight: 1.1 });
}
