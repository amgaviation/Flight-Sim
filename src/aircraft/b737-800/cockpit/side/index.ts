/**
 * Boeing 737-800 side consoles and aft sidewalls (contract in ../context.ts):
 *
 *  - Captain / F/O side consoles aft of the tiller shelves (MOUNTS.sideLeft
 *    / sideRight): crew oxygen mask stowage box with the quick-donning mask
 *    (pull = mask on, OXY ON flag), the yellow flow indicator, RESET/TEST
 *    slide, N / 100% selector and EMERGENCY knob (FCOM 1.20 "Oxygen -
 *    flight crew"); MAP light rheostat with the map light above the side
 *    window (FCOM 1.40).
 *  - Circuit breaker panels P18 (behind the Captain) and P6 (behind the
 *    F/O), every modelled breaker (breakers.ts), backlit from the CIRCUIT
 *    BREAKER dimmer (forward overhead; zone 'cb' on `ac.light.cb`).
 *  - Flight deck door handle on the aft bulkhead: opens / closes the door
 *    (`ac.b738.door_flt_deck`, FLT DECK door light on the aft overhead).
 *
 *  - Sidewall furnishings: CHART light rheostat and lamp, No. 2 window
 *    crank (state only), headset / mic jack panel and the stowed sun visors.
 *
 * SCOPE: the door leaf and the sliding No. 2 windows do not move (the door
 * is part of the static bulkhead; the crank publishes the window state
 * only). The map / chart lights are emissive lamps (the cockpit keeps its 4
 * real lights, docs/modules/cockpit.md §14).
 * Geometry EST from NG photographs (layout.ts MOUNTS).
 */
import * as THREE from 'three';
import { AnnunciatorLight, CircuitBreaker, PushButton, RotaryKnob, SelectorKnob, TBarHandle, ToggleSwitch } from '../../../../cockpit/controls';
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import { trimBoxGeometry } from '../../../../cockpit/geometry/structure';
import type { CockpitEnv } from '../../../../cockpit/env';
import { B738, type Side } from '../../vars';
import type { B738CockpitContext } from '../context';
import { FLOOR_Z, MOUNTS, X_AFT } from '../layout';
import { B738_P18, B738_P6, type CbGroup } from './breakers';

/**
 * CB panel geometry (EST from NG photographs): face 1.23 m outboard, aft of the No. 3 window
 * (x 12.66-13.10), top edge at about the seated eye height (z -0.47, CB_TOP_Z); the
 * sidewall cabinet continues down to the floor behind a plain access cover. The panel height
 * follows its breaker rows (cbPanelHeight).
 */
export const CB_PANEL = { x: 12.88, y: 1.23, w: 0.44 } as const;
const CB_GRID = { dx: 0.0305, dy: 0.034, title: 0.016, gap: 0.008, margin: 0.012, maxCols: 13 } as const;
/** Top of the breaker panels (body z, about the seated eye height; EST). */
const CB_TOP_Z = -0.47;

/** Height of one breaker group box (title band + rows). */
function cbGroupHeight(n: number, width: number): number {
  const G = CB_GRID;
  const cols = Math.min(G.maxCols, Math.max(1, Math.floor((width - 2 * G.margin) / G.dx)), n);
  return G.title + (Math.ceil(n / cols) - 1) * G.dy + 0.026;
}
/** Panel height that fits its groups (first group at y0, bottom margin 0.014). */
function cbPanelHeight(groups: CbGroup[], width: number, y0: number): number {
  return y0 + groups.reduce((h, g) => h + cbGroupHeight(g.items.length, width) + CB_GRID.gap, 0) - CB_GRID.gap + 0.014;
}

export function buildSideConsoles(c: B738CockpitContext): void {
  const { b, env, ctx } = c;
  const vars = ctx.vars;
  b.zone({ id: 'cb', intensityVar: 'ac.light.cb', gain: 2.2 });
  b.zone({ id: 'map_capt', intensityVar: 'ac.light.map_capt', color: 0xfff0d6 });
  b.zone({ id: 'map_fo', intensityVar: 'ac.light.map_fo', color: 0xfff0d6 });
  const ratings = new Map(c.sys.elec.breakerNames().map((x) => [x.name, x.ratingA]));
  const panelMat = 'panelDark';

  for (const s of [1, 2] as Side[]) {
    const sg = s === 1 ? -1 : 1;
    const mount = s === 1 ? MOUNTS.sideLeft : MOUNTS.sideRight;
    const pfx = `b738.side${s}`;
    // ---- console body (floor to the top surface, out to the sidewall).
    const yIn = Math.abs(mount.center_m[1]) - mount.width / 2;
    const yOut = 1.3;
    const len = mount.height;
    const top = mount.center_m[2];
    const body = b.structureMesh(new THREE.BoxGeometry(yOut - yIn, FLOOR_Z - top - 0.004, len), panelMat, [mount.center_m[0], sg * (yIn + yOut) / 2, (FLOOR_Z + top + 0.004) / 2]);
    body.name = 'side_console_body';
    b.structureMesh(trimBoxGeometry(yOut - yIn, 0.004, len, 0.004), 'panel', [mount.center_m[0], sg * (yIn + yOut) / 2 + sg * 0.0, top - 0.001]).name = 'side_console_top';
    const p = b.panel({ ...mount, name: `${pfx}.console`, origin: 'top-left', material: 'panel', screws: { kind: 'dzus', diameter: 0.007, pitch: 0.3 } });
    // Local x: 0 = left edge. Outboard edge: x = 0 (Capt) / x = width (F/O).
    const out = (d: number) => (s === 1 ? d : mount.width - d);

    // ---- crew oxygen mask stowage box (outboard, aft half).
    buildMaskBox(c, p, s, out(0.1), 0.56);

    // ---- map light rheostat (forward end) and the lamp above the side window.
    p.add(
      new SelectorKnob(env, {
        id: `${pfx}.map_lt`,
        label: s === 1 ? 'CAPT MAP LIGHT' : 'F/O MAP LIGHT',
        var: B738.mapLt(s),
        positions: [
          { value: 0, label: 'OFF' },
          { value: 0.25, label: '' },
          { value: 0.5, label: '' },
          { value: 0.75, label: '' },
          { value: 1, label: 'BRT' },
        ],
        initial: 0,
        diameter: 0.014,
        cap: 'pointer',
        title: 'MAP',
        labelHeight: 0.0022,
        labelZone: null,
      }),
      out(0.08),
      0.12,
    );
    const lampMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0xfff0d6, emissiveIntensity: 0, roughness: 0.4 });
    env.materials.track(lampMat);
    env.lighting.registerBacklight(lampMat, s === 1 ? 'map_capt' : 'map_fo', 3);
    const lamp = new THREE.Group();
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.03, 20), env.materials.get('plasticBlack'));
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.019, 20), lampMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.y = -0.0151;
    lamp.add(housing, lens);
    b.trackGeometry(housing.geometry, lens.geometry);
    // Lamp above the No. 2 window, aimed at the console / chart holder (cockpit-local axes: y up).
    b.addStructure(lamp, [13.72, sg * 1.06, -0.74], { occluder: false, static: false });
    lamp.rotation.z = -sg * 0.5;

    // ---- chart light rheostat and lamp, No. 2 window crank, headset / mic jack panel, sun visor (737NG sidewall
    // furnishings, b737.org.uk flight deck photographs; positions EST).
    p.add(
      new RotaryKnob(env, {
        id: `${pfx}.chart_lt`,
        label: s === 1 ? 'CAPT CHART LIGHT' : 'F/O CHART LIGHT',
        cap: 'dimmer',
        diameter: 0.013,
        outer: { var: B738.chartLt(s), min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label: 'CHART', format: (x) => (x < 0.02 ? 'OFF' : `${Math.round(x * 100)} %`) },
      }),
      out(0.08),
      0.2,
    );
    p.label('CHART', out(0.08), 0.183, { height: 0.0024 });
    {
      const chartMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, emissive: 0xfff0d6, emissiveIntensity: 0, roughness: 0.4 });
      env.materials.track(chartMat);
      c.b.zone({ id: s === 1 ? 'chart_capt' : 'chart_fo', intensityVar: s === 1 ? 'ac.light.chart_capt' : 'ac.light.chart_fo', color: 0xfff0d6 });
      env.lighting.registerBacklight(chartMat, s === 1 ? 'chart_capt' : 'chart_fo', 3);
      const g = new THREE.Group();
      const hs = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.03), env.materials.get('plasticBlack'));
      const ln = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 0.022), chartMat);
      ln.rotation.x = Math.PI / 2;
      ln.position.y = -0.0101;
      g.add(hs, ln);
      b.trackGeometry(hs.geometry, ln.geometry);
      // Under the sidewall above the console, aimed at the chart holder (cockpit-local y up).
      b.addStructure(g, [13.5, sg * 1.02, -0.2], { occluder: false });
    }
    // Window crank: turn to open the No. 2 sliding window (SCOPE in vars.ts windowCrank).
    p.add(
      new RotaryKnob(env, {
        id: `${pfx}.window_crank`,
        label: s === 1 ? 'CAPT NO. 2 WINDOW CRANK' : 'F/O NO. 2 WINDOW CRANK',
        cap: 'chicken-head',
        diameter: 0.05,
        outer: { var: B738.windowCrank(s), min: 0, max: 1, step: 0.1, angleRange: [-170, 170], label: 'WINDOW', format: (x) => (x < 0.02 ? 'CLOSED' : `${Math.round(x * 100)} % OPEN`) },
      }),
      out(0.05),
      0.34,
    );
    p.label('WINDOW', out(0.05), 0.305, { height: 0.0024 });
    // Headset / microphone jack panel (static: SCOPE, the ACPs model the audio selection).
    {
      const jp = p.subPanel({ name: `${pfx}.jacks`, x: out(0.2), y: 0.2, width: 0.06, height: 0.05, origin: 'top-left', material: 'plasticBlack', screws: false });
      const jack = env.geometry.get('b738.jack', () => new THREE.CylinderGeometry(0.0045, 0.0045, 0.004, 16).rotateX(Math.PI / 2));
      for (const [x, lbl] of [
        [0.015, 'HEADSET'],
        [0.045, 'MIC'],
      ] as const) {
        const m = new THREE.Mesh(jack, env.materials.get('chrome'));
        m.userData.cockpitStatic = true;
        jp.addObject(m, x, 0.03, { z: 0.002 });
        jp.label(lbl, x, 0.014, { height: 0.0022, zone: null, color: '#e8e8e2' });
      }
    }
    // Sun visor stowed at the top of the No. 1 / No. 2 window post (static; SCOPE: no visor interaction).
    {
      const visor = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.13, 0.26), env.materials.custom('plastic', 0x2e3a30, 0.4));
      b.trackGeometry(visor.geometry);
      visor.name = 'sun_visor';
      b.addStructure(visor, [14.05, sg * 0.86, -0.64]);
      visor.rotation.set(0, 0, sg * 0.5);
    }

    // ---- circuit breaker panel on the aft sidewall (P18 Captain, P6 F/O).
    buildCbPanel(c, s, s === 1 ? B738_P18 : B738_P6, ratings);
  }

  // ---- flight deck door handle (aft bulkhead, door face at X_AFT - 0.01).
  b.place(
    new TBarHandle(env, {
      id: 'b738.door.handle',
      label: 'FLIGHT DECK DOOR',
      var: B738.door('flt_deck'),
      valueIn: 0,
      valueOut: 1,
      style: 'lever',
      pullLength: 0.03,
      tooltip: () => (vars.get(B738.door('flt_deck')) !== 0 ? 'FLIGHT DECK DOOR: OPEN' : 'FLIGHT DECK DOOR: CLOSED'),
    }),
    { center_m: [X_AFT - 0.012, 0.19, FLOOR_Z - 1.0], facing: 'fwd' },
  );
}

/** Oxygen mask stowage box with its controls (Capt / F/O). */
function buildMaskBox(c: B738CockpitContext, p: Panel, s: Side, x: number, y: number): void {
  const { env } = c;
  const W = 0.12;
  const L = 0.15;
  const H = 0.07;
  const pfx = `b738.side${s}.oxy`;
  const box = new THREE.Mesh(new THREE.BoxGeometry(W, L, H), env.materials.get('plasticBlack'));
  box.position.z = H / 2;
  box.userData.cockpitStatic = true;
  c.b.trackGeometry(box.geometry);
  p.addObject(box, x, y);
  const top = p.subPanel({ name: `b738.side${s}.oxybox`, x, y, z: H + 0.0005, width: W - 0.004, height: L - 0.004, origin: 'top-left', material: 'plasticBlack', screws: false });
  const oxy = s === 1 ? 'capt' : 'fo';
  top.label(s === 1 ? 'CAPT OXYGEN' : 'F/O OXYGEN', 0.058, 0.008, { height: 0.0024, zone: null, color: '#e8e8e2' });
  // Quick-donning mask (red squeeze handles): pull out = mask on.
  top.add(
    new TBarHandle(env, {
      id: `${pfx}.mask`,
      label: s === 1 ? 'CAPT OXYGEN MASK' : 'F/O OXYGEN MASK',
      var: B738.oxyMask(s),
      valueIn: 0,
      valueOut: 1,
      style: 'tbar',
      material: 'knobRed',
      pullLength: 0.05,
      tooltip: () => `${s === 1 ? 'CAPT' : 'F/O'} OXYGEN MASK: ${c.ctx.vars.get(B738.oxyMask(s)) !== 0 ? 'ON (donned)' : 'STOWED'}`,
    }),
    0.058,
    0.045,
  );
  top.label('PRESS TO RELEASE', 0.058, 0.066, { height: 0.0017, zone: null, color: '#e8e8e2' });
  // OXY ON flag (left door open) and the yellow flow indicator.
  top.add(new AnnunciatorLight(env, { id: `${pfx}.oxy_on`, label: 'OXY ON flag', width: 0.02, height: 0.01, segments: [{ text: 'OXY ON', color: 'white', var: B738.oxyMask(s), style: 'field' }] }), 0.022, 0.085);
  top.add(new AnnunciatorLight(env, { id: `${pfx}.flow`, label: 'OXYGEN FLOW INDICATOR', width: 0.014, height: 0.014, segments: [{ text: '+', color: 'amber', var: `oxy.${oxy}_flowing`, style: 'field' }] }), 0.094, 0.085);
  top.label('FLOW', 0.094, 0.097, { height: 0.0016, zone: null, color: '#e8e8e2' });
  // RESET/TEST slide, N / 100% selector, EMERGENCY knob.
  top.add(new PushButton(env, { id: `${pfx}.test`, label: 'OXYGEN MASK RESET/TEST', style: 'small', width: 0.012, height: 0.008, mode: 'momentary', var: B738.oxyTest(s), engraved: 'TEST', engravedHeight: 0.0016, zone: null }), 0.022, 0.118);
  top.label('RESET/TEST', 0.022, 0.13, { height: 0.0015, zone: null, color: '#e8e8e2' });
  top.add(
    new ToggleSwitch(env, {
      id: `${pfx}.n100`,
      label: 'OXYGEN N / 100%',
      var: B738.oxyDiluter(s),
      positions: ['100%', 'N'],
      values: [0, 1],
      initial: 0,
      scale: 0.65,
      orientation: 'horizontal',
      labels: { positions: true, height: 0.0017, zone: null },
    }),
    0.058,
    0.118,
  );
  top.add(
    new SelectorKnob(env, {
      id: `${pfx}.emer`,
      label: 'OXYGEN EMERGENCY',
      var: B738.oxyEmer(s),
      positions: [
        { value: 0, label: 'NORM', angle: -40 },
        { value: 1, label: 'EMER', angle: 40 },
      ],
      initial: 0,
      diameter: 0.011,
      cap: 'wing',
      labelHeight: 0.0016,
      labelZone: null,
      material: 'knobRed',
    }),
    0.096,
    0.12,
  );
}

/** A circuit breaker panel on the aft sidewall, filled with its groups. */
function buildCbPanel(c: B738CockpitContext, s: Side, groups: CbGroup[], ratings: ReadonlyMap<string, number>): void {
  const { b, env } = c;
  const sg = s === 1 ? -1 : 1;
  // Each panel is as tall as its breakers need, hanging from CB_TOP_Z (P6 carries more breakers than P18).
  const h = cbPanelHeight(groups, CB_PANEL.w, 0.024);
  const P = { ...CB_PANEL, h, z: CB_TOP_Z + h / 2 };
  // Cabinet behind the panel (to the sidewall), from just above the panel down to the floor.
  const cabTop = P.z - P.h / 2 - 0.015;
  // Cabinet sides in the sidewall lining grey (same paint as the overhead housing, EST).
  b.structureMesh(new THREE.BoxGeometry(0.2, FLOOR_Z - cabTop, P.w + 0.03), b.env.materials.custom('paint', 0xb9bab5, 0.75), [P.x, sg * (P.y + 0.1 + 0.003), (FLOOR_Z + cabTop) / 2]).name = 'cb_cabinet';
  // Lower access cover (no controls; EST: the NG P6 / P18 lower sections are closed equipment bays).
  const lowTop = P.z + P.h / 2 + 0.008;
  const lowH = FLOOR_Z - 0.03 - lowTop;
  b.panel({
    name: `b738.cb.${s === 1 ? 'p18' : 'p6'}_lower`,
    center_m: [P.x, sg * P.y, lowTop + lowH / 2],
    facing: s === 1 ? 'right' : 'left',
    width: P.w,
    height: lowH,
    origin: 'top-left',
    material: 'panel',
    screws: { kind: 'dzus', diameter: 0.007, pitch: 0.2 },
  });
  const panel = b.panel({
    name: `b738.cb.${s === 1 ? 'p18' : 'p6'}`,
    center_m: [P.x, sg * P.y, P.z],
    facing: s === 1 ? 'right' : 'left',
    width: P.w,
    height: P.h,
    origin: 'top-left',
    material: 'panel',
    screws: { kind: 'dzus', diameter: 0.007, pitch: 0.22 },
  });
  const title = s === 1 ? 'P18  CIRCUIT BREAKER PANEL - CAPT' : 'P6  CIRCUIT BREAKER PANEL - F/O';
  panel.label(title, P.w / 2, 0.012, { height: 0.0032, zone: 'cb', weight: 800 });
  const cbs = fillCbPanel(env, panel, P.w, groups, ratings, 0.024);
  const cbVarNames = groups.flatMap((g) => g.items.map(([name]) => `cb.${name}`));
  // Draw-call saving (123 breakers): the white band on the stem shows only with the breaker out (pulled or
  // tripped), so it is not drawn while the breaker is in (same technique as the Citation M2 CB panels).
  const bands: { band: THREE.Object3D; name: string }[] = [];
  cbs.forEach((cb, i) => {
    const band = cb.object.getObjectByName('cbWhiteBand');
    const name = cbVarNames[i];
    if (band && name) bands.push({ band, name });
  });
  const v = env.vars;
  const sync = (): void => {
    for (const x of bands) x.band.visible = v.get(x.name, 1) === 0;
  };
  sync();
  b.onUpdate(sync);
}

export function fillCbPanel(env: CockpitEnv, panel: Panel, width: number, groups: CbGroup[], ratings: ReadonlyMap<string, number>, y0: number): CircuitBreaker[] {
  const G = CB_GRID;
  const out: CircuitBreaker[] = [];
  let y = y0;
  for (const g of groups) {
    const cols = Math.min(G.maxCols, Math.max(1, Math.floor((width - 2 * G.margin) / G.dx)), g.items.length);
    const w = width - 2 * G.margin;
    const h = cbGroupHeight(g.items.length, width);
    const x0 = G.margin;
    const x1 = x0 + w;
    const yt = y + 0.004;
    const y1 = y + h;
    const tw = Math.min(w - 0.006, g.title.length * 0.0027 + 0.01);
    const cx = (x0 + x1) / 2;
    panel.line(x0, yt, cx - tw / 2, yt, 0.0005, 'cb');
    panel.line(cx + tw / 2, yt, x1, yt, 0.0005, 'cb');
    panel.line(x1, yt, x1, y1, 0.0005, 'cb');
    panel.line(x1, y1, x0, y1, 0.0005, 'cb');
    panel.line(x0, y1, x0, yt, 0.0005, 'cb');
    panel.label(g.title, cx, yt, { height: 0.003, weight: 800, zone: 'cb' });
    g.items.forEach(([name, legend], i) => {
      const bx = x0 + 0.004 + G.dx / 2 + (i % cols) * G.dx;
      const by = y + G.title + 0.006 + Math.floor(i / cols) * G.dy;
      const rating = ratings.get(name);
      out.push(
        panel.add(
          new CircuitBreaker(env, {
            id: `b738.cb.${name}`,
            label: `CB ${legend.replace('\n', ' ')}${rating !== undefined ? ` ${rating} A` : ''} (${g.title})`,
            var: `cb.${name}`,
            trippedVar: `cb.${name}_tripped`,
            // The rating is engraved on the panel above the collar (static text, merged with the other
            // legends) instead of on the moving button: saves one draw call per breaker (123).
            diameter: 0.0095,
            collar: 'round',
          }),
          bx,
          by,
        ),
      );
      if (rating !== undefined) panel.label(String(rating), bx + 0.0085, by - 0.0075, { height: 0.0021, weight: 800, zone: 'cb' });
      legend.split('\n').forEach((ln, k) => panel.label(ln, bx, by + 0.011 + k * 0.0034, { height: 0.0023, weight: 700, zone: 'cb' }));
    });
    y += h + G.gap;
  }
  return out;
}
