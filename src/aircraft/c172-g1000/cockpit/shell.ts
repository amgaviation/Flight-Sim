/**
 * 172S cabin structure and the controls mounted on it: floor, firewall closure, sidewalls, roof and
 * overhead console, one-piece windshield with the A-pillars and the magnetic compass, glareshield,
 * both cabin doors (handle, openable window), rear side windows, aft baggage partition, front seats and
 * the rear bench, wing-root fresh-air ventilators, windshield defroster knobs and the portable fire
 * extinguisher.
 *
 * Sources: POH 172SPHBUS-00 Fig 6-6 (cabin dimensions, see layout.ts), Sec 7 "Cabin heating,
 * ventilating and defrosting system" ("Two knobs control sliding valves in either defroster outlet";
 * "Separate adjustable ventilators supply additional air; one near each upper corner of the
 * windshield"), "Interior lighting" (two dimmable front flood lights in the overhead console with dimmer
 * controls, rear dome light on a push-button switch shared with the courtesy lights; POH placard 13
 * "FLOOD LIGHT"), "Entrance doors and cabin windows" (door handle OPEN / CLOSE / LOCK, openable window
 * in each door), Sec 3 "Cabin fire" (portable Halon 1211 extinguisher). Geometry EST where noted.
 */
import * as THREE from 'three';
import type { CockpitBuilder } from '../../../cockpit/CockpitBuilder';
import type { SimContext } from '../../../core/SimContext';
import { PushButton, PushPullKnob, RotaryKnob, SelectorKnob } from '../../../cockpit/controls';
import { cylinderZ, roundedBox, tube } from '../../../cockpit/geometry/primitives';
import { glareshieldGeometry } from '../../../cockpit/geometry/structure';
import { MagneticCompass } from '../../../avionics/analog';
import { GROUND_Z, sta } from '../../c172s-common/fdm';
import { C172, DOOR as DOOR_POS } from '../../c172s-common/vars';
import { C172G } from '../vars';
import { CABIN, DOOR, DOOR_WINDOW, FLOOR_H, GLARE, IN, PANEL, REAR_WINDOW, SEATS, WINDSHIELD, hz, lerpTable } from './layout';
import { STBY_LIGHT } from './panel';

/** Cockpit-local point (x right, y up, z aft) from (FS in, y m right, height m above ground). */
export function L(fs: number, y: number, h: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(y, h - GROUND_Z, (fs - 38.1) * IN);
}

const roofH = (fs: number): number => lerpTable(CABIN.roofH, Math.max(fs, 30));
const halfW = (fs: number): number => lerpTable(CABIN.halfWidth, fs);
/**
 * The one-piece windshield wraps around the cabin corners (photograph "Cessna 172 SP Nav III G1000
 * (D-ETGZ).jpg"): its side glass reaches back to the forward doorposts, so the side wall forward of the
 * door ends at the cowl-deck line under the glass (EST 1.605 m at the windshield base rising 1.2 mm/in).
 */
const deckH = (fs: number): number => WINDSHIELD.baseH + (fs - WINDSHIELD.baseFs) * 0.0012;
/** Forward doorpost (A-pillar): from the deck line at the door's forward edge up to the roof at the windshield top. */
const POST = { fs0: 26, fs1: WINDSHIELD.pillarTopFs };
const postH = (fs: number): number => deckH(POST.fs0) + ((fs - POST.fs0) / (POST.fs1 - POST.fs0)) * (WINDSHIELD.topH - deckH(POST.fs0));
/** Station where the doorpost line reaches the door top (the door's upper forward corner). */
const POST_AT_DOOR_TOP = POST.fs0 + ((DOOR.topH - deckH(POST.fs0)) / (WINDSHIELD.topH - deckH(POST.fs0))) * (POST.fs1 - POST.fs0);
/** Upper limit of the wall above the door: the doorpost line forward of the windshield top, the roof aft of it. */
const aboveDoorTop = (fs: number): number => (fs < POST.fs1 ? Math.min(postH(fs), roofH(fs)) : roofH(fs));

/** Inner lining half width at (FS, height): flared lower wall, vertical upper wall, rounded roof corner. */
export function sideX(fs: number, h: number): number {
  const w = halfW(fs);
  const wf = w * CABIN.floorRatio;
  const R = CABIN.cornerR;
  const hr = roofH(fs);
  if (h < 1.15) {
    const t = THREE.MathUtils.clamp((h - FLOOR_H) / (1.15 - FLOOR_H), 0, 1);
    return wf + (w - wf) * THREE.MathUtils.smoothstep(t, 0, 1);
  }
  if (h > hr - R) {
    const dy = Math.min(R, h - (hr - R));
    return w - R + Math.sqrt(Math.max(0, R * R - dy * dy));
  }
  return w;
}

/** Grid surface; faces are wound toward `inward` (cockpit-local); UVs in metres from `uvOf`. */
function patch(nu: number, nv: number, at: (u: number, v: number, out: THREE.Vector3) => void, inward: THREE.Vector3, uvOf: (p: THREE.Vector3) => [number, number]): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= nu; i++)
    for (let j = 0; j <= nv; j++) {
      at(i / nu, j / nv, p);
      pos.push(p.x, p.y, p.z);
      const [a, b] = uvOf(p);
      uv.push(a, b);
    }
  const row = nv + 1;
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const a = i * row + j;
      idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
    }
  // Orientation from the first quad's normal.
  const v0 = new THREE.Vector3(pos[0], pos[1], pos[2]);
  const va = new THREE.Vector3(pos[row * 3], pos[row * 3 + 1], pos[row * 3 + 2]).sub(v0);
  const vb = new THREE.Vector3(pos[3], pos[4], pos[5]).sub(v0);
  if (va.cross(vb).dot(inward) < 0)
    for (let k = 0; k < idx.length; k += 3) {
      const t = idx[k + 1];
      idx[k + 1] = idx[k + 2];
      idx[k + 2] = t;
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const uvSide = (p: THREE.Vector3): [number, number] => [p.z, p.y];
const uvFlat = (p: THREE.Vector3): [number, number] => [p.x, p.z];

/** Sidewall patch between stations fs0..fs1 and heights h0(fs)..h1(fs) on `side` (-1 left, +1 right), inset inward by `inset`. */
function wall(side: -1 | 1, fs0: number, fs1: number, h0: (fs: number) => number, h1: (fs: number) => number, nu = 8, nv = 10, inset = 0): THREE.BufferGeometry {
  return patch(
    nu,
    nv,
    (u, v, out) => {
      const fs = fs0 + (fs1 - fs0) * u;
      const lo = h0(fs);
      const hi = h1(fs);
      const h = lo + (hi - lo) * v;
      L(fs, side * (sideX(fs, h) - inset), h, out);
    },
    new THREE.Vector3(-side, 0, 0),
    uvSide,
  );
}

export interface ShellParts {
  doors: { pivot: THREE.Group; win: THREE.Group; side: -1 | 1; doorVar: string; winVar: string; open: number; winOpen: number }[];
  extNeedle: THREE.Object3D;
}

export function buildShell(b: CockpitBuilder, ctx: SimContext, opts: { analog: boolean }): ShellParts {
  const env = b.env;
  const mats = env.materials;
  const wallMat = mats.get('interior');
  const head = mats.get('headliner');
  const dark = mats.custom('plastic', '#2b2b2d', 0.8);
  const add = (g: THREE.BufferGeometry, mat: THREE.Material, name: string, occluder = true) => {
    const m = b.structureMesh(g, mat, undefined, undefined, occluder);
    m.name = name;
    return m;
  };
  const hConst = (h: number) => () => h;
  const FWD = 3; // firewall closure station (EST)
  const AFT = 115; // baggage partition (EST)

  // ---------------------------------------------------------------- floor, firewall, under-panel closure
  add(
    patch(
      24,
      6,
      (u, v, out) => {
        const fs = FWD + (AFT - FWD) * u;
        const w = halfW(fs) * CABIN.floorRatio;
        L(fs, -w + 2 * w * v, FLOOR_H, out);
      },
      new THREE.Vector3(0, 1, 0),
      uvFlat,
    ),
    mats.get('carpet'),
    'floor',
  );
  // Firewall (toe board) behind the pedals.
  add(
    patch(2, 6, (u, v, out) => {
      const h = FLOOR_H + (PANEL.topH - 0.47 - FLOOR_H) * u;
      const w = sideX(FWD, h);
      L(FWD, -w + 2 * w * v, h, out);
    }, new THREE.Vector3(0, 0, 1), uvSide),
    dark,
    'firewall',
  );
  // Under-panel closure (panel lower edge forward to the firewall).
  add(
    patch(2, 8, (u, v, out) => {
      const fs = FWD + (PANEL.fs + 0.7 - FWD) * u;
      const h = PANEL.topH - 0.47;
      const w = sideX(fs, h);
      L(fs, -w + 2 * w * v, h, out);
    }, new THREE.Vector3(0, -1, 0), uvFlat),
    dark,
    'under_panel',
  );
  // Aft baggage partition.
  add(
    patch(4, 10, (u, v, out) => {
      const h = FLOOR_H + (roofH(AFT) - FLOOR_H) * u;
      const w = sideX(AFT, h);
      L(AFT, -w + 2 * w * v, h, out);
    }, new THREE.Vector3(0, 0, -1), uvSide),
    wallMat,
    'aft_partition',
  );

  // ---------------------------------------------------------------- sidewalls around the door and window openings
  const doorTop = (fs: number) => Math.min(DOOR.topH, fs < POST.fs1 ? postH(fs) : DOOR.topH);
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'l' : 'r';
    // Forward of the door: floor up to the cowl-deck line under the windshield's side glass.
    add(wall(side, FWD, POST.fs0, hConst(FLOOR_H), deckH, 8, 10), wallMat, `wall_fwd_${s}`);
    // Below and above the door opening.
    add(wall(side, POST.fs0, DOOR.aftFs, hConst(FLOOR_H), hConst(DOOR.sillH), 10, 1), wallMat, `wall_sill_${s}`);
    add(wall(side, POST_AT_DOOR_TOP, DOOR.aftFs, hConst(DOOR.topH), aboveDoorTop, 10, 4), head, `wall_above_door_${s}`);
    // Door post and the rear side window area.
    add(wall(side, DOOR.aftFs, REAR_WINDOW.fs0, hConst(FLOOR_H), roofH, 2, 12), wallMat, `door_post_${s}`);
    add(wall(side, REAR_WINDOW.fs0, REAR_WINDOW.fs1, hConst(FLOOR_H), hConst(REAR_WINDOW.h0), 8, 6), wallMat, `wall_rear_low_${s}`);
    add(wall(side, REAR_WINDOW.fs0, REAR_WINDOW.fs1, hConst(REAR_WINDOW.h1), roofH, 8, 3), head, `wall_rear_high_${s}`);
    add(wall(side, REAR_WINDOW.fs1, AFT, hConst(FLOOR_H), roofH, 6, 12), wallMat, `wall_aft_${s}`);
    // Rear side window glass (static).
    const rw = wall(side, REAR_WINDOW.fs0, REAR_WINDOW.fs1, hConst(REAR_WINDOW.h0), hConst(REAR_WINDOW.h1), 6, 2, -0.01);
    const rwm = new THREE.Mesh(rw, mats.get('windowGlass'));
    rwm.name = `rear_window_${s}`;
    b.trackGeometry(rw);
    b.root.add(rwm);
    // Arm rest along the rear wall.
    const arm = roundedBox(0.05, 0.05, (REAR_WINDOW.fs1 - REAR_WINDOW.fs0 - 6) * IN, 0.015);
    add(arm, wallMat, `rear_armrest_${s}`).position.copy(L((REAR_WINDOW.fs0 + REAR_WINDOW.fs1) / 2, side * (sideX(80, 1.05) - 0.03), 1.05));
  }

  // ---------------------------------------------------------------- roof (headliner) and overhead console
  add(
    patch(14, 8, (u, v, out) => {
      const fs = WINDSHIELD.topFs + (AFT - WINDSHIELD.topFs) * u;
      const w = halfW(fs) - CABIN.cornerR;
      L(fs, -w + 2 * w * v, roofH(fs), out);
    }, new THREE.Vector3(0, -1, 0), uvFlat),
    head,
    'headliner',
  );

  // ---------------------------------------------------------------- windshield, A-pillars, header
  const WS = WINDSHIELD;
  const wsPoint = (u: number, v: number, out: THREE.Vector3) => {
    const fsEdge = WS.baseFs + (WS.topFs - WS.baseFs) * u;
    const h = WS.baseH + (WS.topH - WS.baseH) * u + 0.025 * Math.sin(Math.PI * u);
    const w = Math.min(halfW(fsEdge), sideX(fsEdge, Math.min(h, roofH(fsEdge) - 0.02))) - 0.01;
    const y = -w + 2 * w * v;
    const c = (y / w) ** 2;
    // Plan-view curvature: the centre of the one-piece windshield bulges forward ~2 in (EST).
    L(fsEdge - 2 * (1 - c) * (1 - u * 0.6), y, h, out);
  };
  const ws = patch(10, 20, wsPoint, new THREE.Vector3(0, 0, 1), uvSide);
  const wsm = new THREE.Mesh(ws, mats.get('windowGlass'));
  wsm.name = 'windshield';
  b.trackGeometry(ws);
  b.root.add(wsm);
  const frameMat = mats.custom('plastic', '#3a3a3c', 0.7);
  const wsEdgeH = (fs: number) => {
    const u = THREE.MathUtils.clamp((fs - WS.baseFs) / (WS.topFs - WS.baseFs), 0, 1);
    return WS.baseH + (WS.topH - WS.baseH) * u + 0.025 * Math.sin(Math.PI * u);
  };
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'l' : 'r';
    // Side glass: wraps from the front glass's side edge down to the deck line and back to the doorpost.
    const sg = patch(
      10,
      3,
      (u, v, out) => {
        const fs = WS.baseFs + (POST.fs1 - WS.baseFs) * u;
        const lo = fs < POST.fs0 ? deckH(fs) : Math.min(postH(fs), wsEdgeH(fs));
        const hi = Math.max(lo, wsEdgeH(fs));
        const h = lo + (hi - lo) * v;
        L(fs, side * (Math.min(halfW(fs), sideX(fs, Math.min(h, roofH(fs) - 0.02))) - 0.01), h, out);
      },
      new THREE.Vector3(-side, 0, 0),
      uvSide,
    );
    const sgm = new THREE.Mesh(sg, mats.get('windowGlass'));
    sgm.name = `windshield_side_${s}`;
    b.trackGeometry(sg);
    b.root.add(sgm);
    // Forward doorpost (A-pillar) and the deck-line trim under the side glass.
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const fs = POST.fs0 + ((POST.fs1 - POST.fs0) * i) / 6;
      const h = postH(fs);
      pts.push(L(fs, side * (sideX(fs, Math.min(h, roofH(fs) - 0.03)) - 0.012), h));
    }
    add(tube(pts, 0.024, 12, 8), frameMat, `a_pillar_${s}`);
    const deck: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const fs = WS.baseFs + ((POST.fs0 - WS.baseFs) * i) / 6;
      deck.push(L(fs, side * (sideX(fs, deckH(fs)) - 0.008), deckH(fs)));
    }
    add(tube(deck, 0.012, 12, 6), frameMat, `deck_trim_${s}`);
  }
  // Closure behind the panel top (the cowl deck under the glareshield; hides the engine compartment).
  add(
    patch(2, 6, (u, v, out) => {
      const fs = FWD + (PANEL.fs - 0.8 - FWD) * u;
      const h = PANEL.topH + 0.001;
      const w = halfW(fs) - 0.005;
      L(fs, -w + 2 * w * v, h, out);
    }, new THREE.Vector3(0, 1, 0), uvFlat),
    mats.get('glareshield'),
    'deck_closure',
  );
  {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const p = new THREE.Vector3();
      wsPoint(1, i / 16, p);
      p.y += 0.01;
      pts.push(p);
    }
    add(tube(pts, 0.024, 32, 8), head, 'ws_header');
  }

  // Glareshield: padded black top from the panel brow to the windshield base (EST depth 0.19 m).
  {
    const g = glareshieldGeometry(PANEL.width - 0.02, GLARE.depth, GLARE.drop, 0.028, 0.06);
    const m = add(g, mats.get('glareshield'), 'glareshield');
    m.position.copy(L(PANEL.fs + 1.2, 0, GLARE.topH));
  }

  // Magnetic compass hanging from the windshield centre (POH Sec 7; lit by the STBY IND dimmer).
  if (opts.analog) {
    const comp = new MagneticCompass({ id: 'c172g.compass', vars: ctx.vars, lightVar: STBY_LIGHT, width: 0.07, year: 2026.7 });
    b.place(comp, { center_m: [sta(WS.topFs + 1.2), 0, hz(WS.topH - 0.07)], facing: 'aft', tiltDeg: -10 });
  }
  const bracket = add(roundedBox(0.03, 0.05, 0.02, 0.004), frameMat, 'compass_bracket');
  bracket.position.copy(L(WS.topFs + 1.4, 0, WS.topH - 0.025));

  // ---------------------------------------------------------------- doors (interior trim, handle, openable window)
  const doors: ShellParts['doors'] = [];
  b.root.updateMatrixWorld(true);
  const doorFwd = POST.fs0;
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'l' : 'r';
    const pivot = new THREE.Group();
    pivot.name = `door_${s}`;
    pivot.userData.cockpitDynamic = true;
    L(doorFwd, side * sideX(doorFwd, 1.2), 1.2, pivot.position);
    b.root.add(pivot);
    const inPivot = (g: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
      const m = new THREE.Mesh(g, mat);
      m.name = name;
      b.trackGeometry(g);
      m.position.sub(pivot.position);
      pivot.add(m);
      b.occluders.push(m);
      return m;
    };
    const dIn = 0.012;
    const W0 = DOOR_WINDOW.fs0;
    const W1 = DOOR_WINDOW.fs1;
    inPivot(wall(side, doorFwd, DOOR.aftFs, hConst(DOOR.sillH), hConst(DOOR_WINDOW.h0), 10, 6, dIn), wallMat, `door_trim_low_${s}`);
    inPivot(wall(side, doorFwd, W0, hConst(DOOR_WINDOW.h0), doorTop, 3, 4, dIn), wallMat, `door_trim_fwd_${s}`);
    inPivot(wall(side, W1, DOOR.aftFs, hConst(DOOR_WINDOW.h0), hConst(DOOR.topH), 1, 4, dIn), wallMat, `door_trim_aft_${s}`);
    inPivot(wall(side, W0, W1, hConst(DOOR_WINDOW.h1), doorTop, 8, 1, dIn), wallMat, `door_trim_top_${s}`);
    // Arm rest and door pull (static on the door).
    const arm = roundedBox(0.055, 0.045, 18 * IN, 0.015);
    const armM = inPivot(arm, dark, `door_armrest_${s}`);
    armM.position.add(L(47, side * (sideX(47, 1.08) - 0.04), 1.08));
    // Openable window (hinged at its top edge, swings outward).
    const win = new THREE.Group();
    win.name = `door_window_${s}`;
    L(48, side * sideX(48, DOOR_WINDOW.h1), DOOR_WINDOW.h1, win.position).sub(pivot.position);
    pivot.add(win);
    const glassG = wall(side, W0, W1, hConst(DOOR_WINDOW.h0), hConst(DOOR_WINDOW.h1), 8, 3, 0.004);
    b.trackGeometry(glassG);
    const glass = new THREE.Mesh(glassG, mats.get('windowGlass'));
    glass.position.copy(pivot.position).add(win.position).negate();
    win.add(glass);
    const frameG = wall(side, W0, W1, hConst(DOOR_WINDOW.h0 - 0.012), hConst(DOOR_WINDOW.h0), 8, 1, 0.008);
    b.trackGeometry(frameG);
    const wframe = new THREE.Mesh(frameG, dark);
    wframe.position.copy(glass.position);
    win.add(wframe);

    // Controls on the door: handle (OPEN / CLOSE / LOCK) and the window latch.
    const facing = side < 0 ? 'right' : 'left';
    const handlePanel = b.panel({ name: `c172g.door_${s}`, center_m: [sta(36), side * (sideX(36, 1.12) - dIn - 0.004), hz(1.12)], facing, width: 0.1, height: 0.08, invisible: true });
    handlePanel.add(
      new SelectorKnob(env, {
        id: `c172g.door_${s}.handle`,
        label: `${side < 0 ? 'LEFT' : 'RIGHT'} DOOR HANDLE (OPEN / CLOSE / LOCK)`,
        var: side < 0 ? C172.doorLeft : C172.doorRight,
        // POH Sec 7 "Entrance doors": CLOSE = handle up, LOCK = rotated forward flush with the arm rest,
        // OPEN = rotated aft. Panel +u points forward on the left door and aft on the right door.
        // SCOPE: the handle position and the door position share C172.door*: OPEN = door open (the handle's
        // spring return to CLOSE while the door stands open is not modelled).
        positions: [
          { value: DOOR_POS.open, label: 'OPEN', angle: -side * 60 },
          { value: DOOR_POS.closed, label: 'CLOSE', angle: 0 },
          { value: DOOR_POS.locked, label: 'LOCK', angle: side * 88 },
        ].sort((a, b) => a.angle - b.angle),
        initial: 1,
        cap: 'chicken-head',
        diameter: 0.06,
        height: 0.016,
        labelRadius: 0.042,
        labelHeight: 0.003,
        labelZone: null,
        material: 'chrome',
      }),
      0,
      0,
    );
    const latchPanel = b.panel({ name: `c172g.window_${s}`, center_m: [sta(48), side * (sideX(48, DOOR_WINDOW.h0 - 0.02) - dIn - 0.004), hz(DOOR_WINDOW.h0 - 0.022)], facing, width: 0.05, height: 0.03, invisible: true });
    latchPanel.add(
      new PushButton(env, {
        id: `c172g.window_${s}.latch`,
        label: `${side < 0 ? 'LEFT' : 'RIGHT'} WINDOW LATCH (open / close)`,
        mode: 'toggle',
        var: side < 0 ? C172.windowLeft : C172.windowRight,
        style: 'mcp',
        width: 0.03,
        height: 0.012,
        capMaterial: 'plasticBlack',
        engraved: 'WINDOW',
        engravedHeight: 0.003,
        zone: null,
      }),
      0,
      0,
    );
    b.root.updateMatrixWorld(true);
    pivot.attach(handlePanel.group);
    win.attach(latchPanel.group);
    doors.push({ pivot, win, side, doorVar: side < 0 ? C172.doorLeft : C172.doorRight, winVar: side < 0 ? C172.windowLeft : C172.windowRight, open: 0, winOpen: 0 });
  }

  // ---------------------------------------------------------------- seats (front pair and rear bench)
  for (const side of [-1, 1]) b.seat('ga', [sta(SEATS.frontFs), side * SEATS.y * IN, hz(FLOOR_H)]);
  {
    const seatMat = mats.get(mats.palette.seatMaterial === 'fabric' ? 'fabric' : 'leather');
    const bench = add(roundedBox(0.95, 0.12, 0.46, 0.04), seatMat, 'rear_bench');
    bench.position.copy(L(SEATS.rearFs + 9, 0, FLOOR_H + 0.3));
    const back = add(roundedBox(0.95, 0.6, 0.12, 0.05), seatMat, 'rear_bench_back');
    back.position.copy(L(SEATS.rearFs + 19.5, 0, FLOOR_H + 0.66));
    back.rotation.x = -0.18;
  }

  // ---------------------------------------------------------------- overhead console: front flood dimmers, rear dome switch
  const ohFs = 47;
  const oh = b.panel({ name: 'c172g.overhead', center_m: [sta(ohFs), 0, hz(roofH(ohFs) - 0.035)], facing: 'down', width: 0.2, height: 0.26, material: mats.custom('plastic', '#bab5ab', 0.8), thickness: 0.03, radius: 0.03, screws: false });
  const ohLabel = (t: string, x: number, y: number) => {
    const l = env.labels.text(t, { height: 0.0035, weight: 700, zone: null, color: '#1c1c1c' });
    l.userData.cockpitStatic = true;
    oh.addObject(l, x, y, { z: 0.0002 });
  };
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'left' : 'right';
    ohLabel('FLOOD\nLIGHT', side * 0.055, 0.065);
    oh.add(
      new RotaryKnob(env, {
        id: `c172g.flood_${s}`,
        label: `${s.toUpperCase()} FLOOD LIGHT dimmer`,
        outer: { var: side < 0 ? C172.floodLeft : C172.floodRight, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], format: (x) => (x <= 0 ? 'OFF' : `${Math.round(x * 100)}%`) },
        cap: 'knurled',
        diameter: 0.022,
        height: 0.012,
        pointer: 'line',
        zone: null,
      }),
      side * 0.055,
      0.035,
    );
    // Flood light lens (rotatable eyeball, static here).
    const lens = new THREE.Mesh(env.geometry.get('c172g.flood_lens', () => new THREE.SphereGeometry(0.018, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2)), mats.custom('plastic', '#e8e6df', 0.4));
    lens.rotation.x = -Math.PI / 2;
    lens.userData.cockpitStatic = true;
    oh.addObject(lens, side * 0.055, -0.035, { z: 0 });
    env.lighting.addFloodLight(`c172g.flood.${s}`, 'flood', [sta(ohFs + 1.4), side * 0.055, hz(roofH(ohFs) - 0.06)], [sta(20), side * 0.25, hz(1.25)], b.root, 3, 55);
  }
  ohLabel('DOME', 0, -0.085);
  oh.add(new PushButton(env, { id: 'c172g.dome', label: 'DOME / COURTESY LIGHTS (push on / off)', mode: 'toggle', var: C172.domeCourtesy, style: 'round', width: 0.012, capMaterial: 'plasticGrey' }), 0, -0.1);
  // Speaker grille (static) between the flood lights.
  {
    const g = new THREE.Mesh(env.geometry.get('c172g.speaker', () => cylinderZ(0.028, 0.028, 0, 0.002, 28)), mats.get('panelDark'));
    g.userData.cockpitStatic = true;
    oh.addObject(g, 0, 0.02);
  }
  // Rear dome light (courtesy circuit).
  env.lighting.addDomeLight('c172g.dome', 'dome', [sta(80), 0, hz(roofH(80) - 0.03)], b.root, 4);

  // ---------------------------------------------------------------- wing-root ventilators and windshield defrosters
  for (const side of [-1, 1] as const) {
    const s = side < 0 ? 'left' : 'right';
    const vfs = WS.topFs + 2.5;
    const vh = roofH(vfs) - 0.07;
    const vp = b.panel({
      name: `c172g.vent_${s}`,
      center_m: [sta(vfs), side * (sideX(vfs, vh) - 0.035), hz(vh)],
      normal: [-0.6, -side * 0.55, 0.58],
      up: [1, 0, -1],
      width: 0.07,
      height: 0.07,
      material: frameMat,
      thickness: 0.01,
      radius: 0.03,
      screws: false,
    });
    vp.add(
      new PushPullKnob(env, {
        id: `c172g.vent_${s}`,
        label: `${s.toUpperCase()} FRESH AIR VENT (pull open)`,
        var: side < 0 ? C172.ventLeft : C172.ventRight,
        valueIn: 0,
        valueOut: 1,
        style: 'cabin',
        travel: 0.05,
        vernierStep: 0.1,
        clickToggles: true,
        material: 'plasticGrey',
      }),
      0,
      0,
    );
    // Defroster slide-valve knob at the windshield base (POH Sec 7).
    const dp = b.panel({ name: `c172g.defrost_${s}`, center_m: [sta(PANEL.fs - 2.5), side * 0.3, hz(GLARE.topH + 0.004)], facing: 'up', width: 0.04, height: 0.03, invisible: true });
    dp.add(
      new PushPullKnob(env, {
        id: `c172g.defrost_${s}`,
        label: `${s.toUpperCase()} DEFROST (pull open)`,
        var: side < 0 ? C172.defrostLeft : C172.defrostRight,
        valueIn: 0,
        valueOut: 1,
        style: 'plain',
        travel: 0.02,
        clickToggles: true,
        material: 'plasticBlack',
      }),
      0,
      0,
    );
  }

  // ---------------------------------------------------------------- portable fire extinguisher (Halon 1211) between the front seats
  // POH Sec 7 "Cabin fire extinguisher": "installed in a holder on the floorboard between the front seats";
  // gage at the top. EST: 2.5 lb bottle (70 mm x 0.25 m) lying fore-aft in its bracket, head forward.
  const extFs = SEATS.frontFs + 4;
  const ext = b.panel({ name: 'c172g.extinguisher', center_m: [sta(extFs), 0, hz(FLOOR_H + 0.075)], facing: 'up', width: 0.08, height: 0.05, invisible: true });
  {
    const bottle = new THREE.Mesh(
      env.geometry.get('c172g.ext_bottle', () => {
        const g = cylinderZ(0.035, 0.035, 0, 0.25, 28);
        g.rotateX(Math.PI / 2); // along -v (aft)
        return g;
      }),
      mats.get('paintRed'),
    );
    bottle.userData.cockpitStatic = true;
    ext.addObject(bottle, 0, 0, { z: -0.037 });
    const headM = new THREE.Mesh(env.geometry.get('c172g.ext_head', () => {
      const g = cylinderZ(0.018, 0.022, 0, 0.03, 20);
      g.rotateX(-Math.PI / 2); // forward (+v)
      return g;
    }), mats.get('chrome'));
    headM.userData.cockpitStatic = true;
    ext.addObject(headM, 0, 0, { z: -0.037 });
    const bracketM = new THREE.Mesh(env.geometry.get('c172g.ext_bracket', () => roundedBox(0.09, 0.02, 0.012, 0.003)), mats.get('plasticBlack'));
    bracketM.userData.cockpitStatic = true;
    ext.addObject(bracketM, 0, 0.06, { z: -0.07 });
    // Pressure gage (green arc when charged), needle driven by C172G.extPsi.
    const gage = new THREE.Mesh(env.geometry.get('c172g.ext_gage', () => cylinderZ(0.011, 0.011, 0, 0.004, 20)), mats.custom('paint', '#f0f0ec', 0.4));
    gage.userData.cockpitStatic = true;
    ext.addObject(gage, 0.022, -0.012, { z: 0 });
  }
  const extNeedle = new THREE.Mesh(env.geometry.get('c172g.ext_needle', () => roundedBox(0.0012, 0.009, 0.0008, 0.0003)), mats.custom('paint', '#111111', 0.4));
  extNeedle.geometry.translate(0, 0, 0);
  const needleGroup = new THREE.Group();
  needleGroup.userData.cockpitDynamic = true;
  needleGroup.add(extNeedle);
  extNeedle.position.y = 0.004;
  ext.addObject(needleGroup, 0.022, -0.012, { z: 0.0045 });
  ext.add(
    new PushButton(env, {
      id: 'c172g.extinguisher',
      label: 'FIRE EXTINGUISHER (squeeze to discharge)',
      mode: 'momentary',
      var: C172G.extTrigger,
      style: 'mcp',
      width: 0.03,
      height: 0.012,
      capMaterial: 'plasticBlack',
      engraved: 'SQUEEZE',
      engravedHeight: 0.003,
      zone: null,
    }),
    -0.02,
    0.0,
    { z: 0.0, rotDeg: 90 },
  );

  return { doors, extNeedle: needleGroup };
}
