/**
 * Global 6000 Electrical Management System CDUs (EMS CDU 1 on the pilot's
 * side panel, EMS CDU 2 on the copilot's; FCOM CSP 700-6 01-10-38 / -45 item 1
 * and CSP 700-5000-6 chapter 7).
 *
 * Keys (07-10-9 drawing GF0710_008): six line select keys left, six
 * activation keys right, STAT, SYS, BUS, PREV PAGE, NEXT PAGE, CNTL, TEST,
 * EMER CNTL and the BRT rocker. Pages:
 *  - CIRCUIT BREAKER - SYSTEM 1/2 (07-20-2): the system groups; a group opens
 *    its breaker list: name, IN / OUT / TRIP, bus, location.
 *  - CIRCUIT BREAKER - BUS: the same by bus (07-20-4 .. 38).
 *  - CIRCUIT BREAKER - STATUS (07-10-10): TRIP first, then OUT; it comes up
 *    by itself whenever a breaker trips (the most recent trip highlighted).
 *  - Line select key = select / acknowledge the row; activation key = pull an
 *    SSPC (IN -> OUT) or reset it (OUT / TRIP -> IN). Thermal breakers (CCBP,
 *    ACPC, DCPC, ASCA) show "THERM CB CANT BE CHANGED FROM CDU" (07-10-12).
 *  - SWITCH CONTROL (CNTL, 07-20-39): CABIN PWR ON / OFF (`ac.elec.cabin_pwr_sw`).
 *  - TEST CONTROL (07-20-40 .. 42): FIRE TEST (10 s), STALL TEST (20 s, on
 *    the ground only), LAMP TEST 1 / 2 (10 s, EST duration). Re-selecting a
 *    running test terminates it.
 *  - EMER CNTL: AC BUS 1-4, DC BUS 1 / 2, DC ESS, BATT BUS manual isolation
 *    (MAN OFF), the same vars as the pedestal EMER CNTL unit.
 *  - Display goes dark 2 min after the last key press (07-10-9 NOTE); any key
 *    wakes it. "M" / "S" linking indication in the lower left corner (07-10-11).
 * Power: EMS CDU 1 PWR B / EMS CDU 2 PWR B on the BATT BUS, EMS CDU 2 PWR A on
 * the APU BATT bus (07-20-30 / -38).
 *
 *  - AURAL WARNING TEST 1 / 2 (03-10-16): the IAC 1 / IAC 2 aural generator
 *    plays its tone / voice sequence (auralTest.ts).
 * SCOPE: RAT TEST (maintenance BIT) is not on the page; SWITCH CONTROL has only CABIN PWR (no
 * humidifier / footwarmer / STALL WARN ADVANCE model); the two units are not
 * linked (each keeps its own page, both show "M"); LOCKED (maintenance)
 * breakers are not modelled. Screen colours and fonts are EST.
 */
import * as THREE from 'three';
import type { SimVars } from '../../../../core/SimVars';
import type { EventBus } from '../../../../core/EventBus';
import { CanvasDisplay, type DisplayCanvas } from '../../../../avionics/common/CanvasDisplay';
import type { Ctx2D } from '../../../../avionics/common/draw/context';
import { KeyPad } from '../../../../cockpit/controls';
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import type { CockpitEnv } from '../../../../cockpit/env';
import { G6K_VARS as V } from '../../vars';
import type { AudioApi } from '../../../../core/SimContext';
import { G6kAuralTest } from './auralTest';
import { CB_TABLE, EMS_BUSES, EMS_SYSTEMS, cbStatus, type CbEntry } from './cbTable';

export const EMS_SIDE_EVENTS = {
  key: (n: 1 | 2) => `g6k.ems${n}.key`,
} as const;

export type EmsPage = 'SYS' | 'SYSCB' | 'BUS' | 'BUSCB' | 'STAT' | 'CNTL' | 'TEST' | 'EMER';
const ROWS = 6;
const IDLE_OFF_S = 120;
const FIRE_TEST_S = 10;
const STALL_TEST_S = 20;
const LAMP_TEST_S = 10; // EST

const AC_ISOL = ([1, 2, 3, 4] as const).map((n) => V.acBusIsol(n));
const DC_ISOL = (['dc_bus1', 'dc_bus2', 'dc_ess', 'batt_bus'] as const).map((b) => V.dcBusIsol(b));
const EMER_NAMES = { left: ['AC BUS 1', 'AC BUS 2', 'AC BUS 3', 'AC BUS 4'], right: ['DC BUS 1', 'DC BUS 2', 'DC ESS BUS', 'BATT BUS'] };
const TEST_ROWS = ['FIRE TEST', 'STALL TEST', 'AURAL WARNING TEST 1', 'AURAL WARNING TEST 2', 'LAMP TEST 1', 'LAMP TEST 2'];

/**
 * Shared state of both units: breaker list with precomputed var names, running
 * tests and the trip watcher (one scan per frame, no allocation).
 */
export class EmsShared {
  readonly entries: { e: CbEntry; vIn: string; vTrip: string; lastTrip: number }[];
  /** Test timers (s left; 0 = off): FIRE, STALL, LAMP 1, LAMP 2. */
  readonly tests = [0, 0, 0, 0];
  /** Index into `entries` of the most recent trip (-1 = none since the last look). */
  newTrip = -1;
  private tripSeq = 0;
  /** Sequence of trip detections, so each unit can notice a new one. */
  get tripCount(): number {
    return this.tripSeq;
  }

  /** AURAL WARNING TEST 1 / 2 sequencers (IAC 1 / 2 generators). */
  readonly aural: G6kAuralTest;

  constructor(
    readonly vars: SimVars,
    breakerNames: string[],
    audio: AudioApi | null = null,
  ) {
    this.aural = new G6kAuralTest(vars, audio);
    const known = new Set(breakerNames);
    this.entries = CB_TABLE.filter((e) => known.has(e.id)).map((e) => ({ e, vIn: `cb.${e.id}`, vTrip: `cb.${e.id}_tripped`, lastTrip: 0 }));
  }

  status(i: number): 'IN' | 'OUT' | 'TRIP' {
    const x = this.entries[i];
    return cbStatus(this.vars.get(x.vIn, 1), this.vars.get(x.vTrip));
  }

  /** Activation key on a breaker: SSPC pull / reset; thermal breakers cannot be changed from the CDU. */
  toggle(i: number): boolean {
    const x = this.entries[i];
    if (x.e.loc !== 'SSPC') return false;
    const v = this.vars;
    if (this.status(i) === 'IN') {
      v.set(x.vIn, 0);
      v.set(x.vTrip, 0);
    } else {
      v.set(x.vIn, 1);
      v.set(x.vTrip, 0);
    }
    return true;
  }

  startTest(k: number): void {
    const v = this.vars;
    if (this.tests[k] > 0) {
      this.tests[k] = 0;
      this.apply();
      return;
    }
    if (k === 1 && v.get('gear.air_ground') === 0) return; // STALL TEST on the ground only (07-20-42)
    this.tests[k] = k === 0 ? FIRE_TEST_S : k === 1 ? STALL_TEST_S : LAMP_TEST_S;
    this.apply();
  }

  private written = [false, false, false];

  private apply(): void {
    const v = this.vars;
    const fire = this.tests[0] > 0;
    const stall = this.tests[1] > 0;
    const lamp = this.tests[2] > 0 || this.tests[3] > 0;
    // Only release a test var this unit set (the pedestal EMER / TEST unit writes the same vars while held).
    if (fire || this.written[0]) v.set(V.fireTest, fire ? 1 : 0);
    if (stall || this.written[1]) v.set(V.stallTest, stall ? 1 : 0);
    if (lamp || this.written[2]) v.set(V.annunTest, lamp ? 1 : 0);
    this.written[0] = fire;
    this.written[1] = stall;
    this.written[2] = lamp;
  }

  tick(dt: number): void {
    this.aural.tick(dt);
    let changed = false;
    for (let k = 0; k < 4; k++) {
      if (this.tests[k] > 0) {
        this.tests[k] = Math.max(0, this.tests[k] - dt);
        if (this.tests[k] === 0) changed = true;
      }
    }
    if (changed) this.apply();
    const v = this.vars;
    for (let i = 0; i < this.entries.length; i++) {
      const x = this.entries[i];
      const t = v.get(x.vTrip);
      if (t !== 0 && x.lastTrip === 0) {
        this.newTrip = i;
        this.tripSeq++;
      }
      x.lastTrip = t;
    }
  }
}

/** One EMS CDU: page state and key handling. */
export class EmsCduUnit {
  page: EmsPage = 'SYS';
  pageNo = 0;
  /** Selected system / bus index for the CB list pages. */
  group = 0;
  /** Highlighted row on this page (-1 none). */
  sel = -1;
  message = '';
  idle = 0;
  /** Filtered entry indices for the current CB list page (rebuilt on page change only). */
  list: number[] = [];
  private seenTrips = 0;
  private readonly offs: (() => void)[] = [];
  readonly awakeVar: string;
  readonly brtVar: string;
  /** Screen power (bus power and not blanked), written by the side-console hook. */
  readonly onVar: string;

  constructor(
    readonly n: 1 | 2,
    readonly shared: EmsShared,
    events: EventBus,
    readonly powerVar: string,
  ) {
    this.awakeVar = `ac.g6k.ck.ems${n}_awake`;
    this.brtVar = `display.g6k.ems${n}.brt`;
    this.onVar = `ac.g6k.ck.ems${n}_on`;
    const v = shared.vars;
    v.set(this.awakeVar, 1);
    if (!v.has(this.brtVar)) v.set(this.brtVar, 0.8);
    this.offs.push(events.on(EMS_SIDE_EVENTS.key(n), (id) => this.press(String(id))));
  }

  get powered(): boolean {
    return this.shared.vars.get(this.powerVar) !== 0;
  }

  pages(): number {
    switch (this.page) {
      case 'SYS':
        return Math.ceil(EMS_SYSTEMS.length / (2 * ROWS));
      case 'BUS':
        return 1;
      case 'SYSCB':
      case 'BUSCB':
      case 'STAT':
        return Math.max(1, Math.ceil(this.list.length / ROWS));
      default:
        return 1;
    }
  }

  private open(page: EmsPage, group = 0): void {
    this.page = page;
    this.group = group;
    this.pageNo = 0;
    this.sel = -1;
    this.message = '';
    this.rebuild();
  }

  private rebuild(): void {
    const s = this.shared;
    const out: number[] = [];
    if (this.page === 'SYSCB') {
      const sys = EMS_SYSTEMS[this.group];
      s.entries.forEach((x, i) => x.e.sys === sys && out.push(i));
    } else if (this.page === 'BUSCB') {
      const bus = EMS_BUSES[this.group];
      s.entries.forEach((x, i) => x.e.bus === bus && out.push(i));
    } else if (this.page === 'STAT') {
      s.entries.forEach((_x, i) => s.status(i) === 'TRIP' && out.push(i));
      s.entries.forEach((_x, i) => s.status(i) === 'OUT' && out.push(i));
    }
    this.list = out;
  }

  press(id: string): void {
    if (!this.powered) return;
    const v = this.shared.vars;
    this.idle = 0;
    if (v.get(this.awakeVar) === 0) {
      v.set(this.awakeVar, 1);
      return; // the first key press only wakes the display
    }
    this.message = '';
    switch (id) {
      case 'STAT':
        return this.open('STAT');
      case 'SYS':
        return this.open('SYS');
      case 'BUS':
        return this.open('BUS');
      case 'CNTL':
        return this.open('CNTL');
      case 'TEST':
        return this.open('TEST');
      case 'EMER':
        return this.open('EMER');
      case 'NEXT':
        this.pageNo = (this.pageNo + 1) % this.pages();
        this.sel = -1;
        return;
      case 'PREV':
        this.pageNo = (this.pageNo + this.pages() - 1) % this.pages();
        this.sel = -1;
        return;
      case 'BRT+':
        v.set(this.brtVar, Math.min(1, v.get(this.brtVar, 0.8) + 0.1));
        return;
      case 'BRT-':
        v.set(this.brtVar, Math.max(0.1, v.get(this.brtVar, 0.8) - 0.1));
        return;
    }
    const side = id[0];
    const row = Number(id.slice(1)) - 1;
    if ((side !== 'L' && side !== 'R') || !(row >= 0 && row < ROWS)) return;
    this.lineKey(side, row);
  }

  private lineKey(side: 'L' | 'R', row: number): void {
    const s = this.shared;
    const v = s.vars;
    switch (this.page) {
      case 'SYS': {
        const k = this.pageNo * 2 * ROWS + (side === 'L' ? row : ROWS + row);
        if (k < EMS_SYSTEMS.length) this.open('SYSCB', k);
        return;
      }
      case 'BUS': {
        const k = side === 'L' ? row : ROWS + row;
        if (k < EMS_BUSES.length) this.open('BUSCB', k);
        return;
      }
      case 'SYSCB':
      case 'BUSCB':
      case 'STAT': {
        const k = this.pageNo * ROWS + row;
        if (k >= this.list.length) return;
        if (side === 'L') {
          this.sel = row; // select / acknowledge
          return;
        }
        if (this.sel !== row) this.sel = row;
        if (!s.toggle(this.list[k])) this.message = 'THERM CB CANT BE CHANGED FROM CDU';
        return;
      }
      case 'CNTL':
        if (row === 0 && side === 'R') v.set(V.cabinPwr, v.get(V.cabinPwr) !== 0 ? 0 : 1);
        return;
      case 'TEST': {
        if (side !== 'R') {
          this.sel = row;
          return;
        }
        const map = [0, 1, -1, -1, 2, 3];
        const t = map[row];
        this.sel = row;
        if (t >= 0) s.startTest(t);
        else s.aural.toggle(row === 2 ? 1 : 2);
        return;
      }
      case 'EMER': {
        if (row >= 4) return;
        const name = side === 'L' ? AC_ISOL[row] : DC_ISOL[row];
        v.set(name, v.get(name) !== 0 ? 0 : 1);
        return;
      }
    }
  }

  tick(dt: number): void {
    const v = this.shared.vars;
    if (!this.powered) return;
    // Auto STATUS page on a new trip, most recent trip highlighted.
    if (this.shared.tripCount !== this.seenTrips) {
      this.seenTrips = this.shared.tripCount;
      this.open('STAT');
      v.set(this.awakeVar, 1);
      this.idle = 0;
      const k = this.list.indexOf(this.shared.newTrip);
      if (k >= 0) {
        this.pageNo = Math.floor(k / ROWS);
        this.sel = k % ROWS;
      }
    }
    if (this.page === 'STAT' || this.page === 'SYSCB' || this.page === 'BUSCB') {
      // Keep STATUS current (pulled / reset breakers leave or join the list) without rebuilding every frame.
      this.refreshT += dt;
      if (this.refreshT > 1 && this.page === 'STAT') {
        this.refreshT = 0;
        this.rebuild();
        if (this.pageNo >= this.pages()) this.pageNo = this.pages() - 1;
      }
    }
    this.idle += dt;
    if (this.idle > IDLE_OFF_S && v.get(this.awakeVar) !== 0) v.set(this.awakeVar, 0);
  }
  private refreshT = 0;

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }
}

const W = 320;
const H = 256;
/** Row centre y (logical px) of line key row i. */
export const EMS_ROW_Y = (i: number): number => 46 + i * 32;

const C = { white: '#ffffff', green: '#19e619', cyan: '#19d9ff', amber: '#ffb300', grey: '#8c9399', magenta: '#ff66ff' };

/** EMS CDU screen (320 x 256 logical px; EST layout after the FCOM drawings GF0710_008 .. 013). */
export class EmsCduScreen extends CanvasDisplay {
  constructor(
    private readonly u: EmsCduUnit,
    vars: SimVars,
    canvas?: 'dom' | 'offscreen' | DisplayCanvas,
  ) {
    super({ id: `g6k.ems${u.n}`, width: W, height: H, vars, canvas, refreshHz: 5, powerVar: u.onVar, bootTimeS: 2 });
    this.animating = true;
  }

  protected draw(ctx: Ctx2D): void {
    const u = this.u;
    const s = u.shared;
    ctx.textBaseline = 'middle';
    const font = (px: number) => `600 ${px}px "Arial Narrow", Arial, sans-serif`;
    const text = (t: string, x: number, y: number, color: string, align: 'left' | 'right' | 'center' = 'left', px = 15) => {
      ctx.font = font(px);
      ctx.fillStyle = color;
      ctx.textAlign = align;
      ctx.fillText(t, x, y);
    };
    const pages = u.pages();
    const pg = `${u.pageNo + 1}/${pages}`;
    const hdr = (t: string) => {
      text(t, 10, 16, C.white, 'left', 16);
      text(pg, W - 10, 16, C.white, 'right', 16);
      ctx.fillStyle = C.grey;
      ctx.fillRect(8, 28, W - 16, 1);
    };
    const hi = (row: number) => {
      ctx.strokeStyle = C.cyan;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(4, EMS_ROW_Y(row) - 13, W - 8, 26);
    };
    switch (u.page) {
      case 'SYS':
      case 'BUS': {
        hdr(u.page === 'SYS' ? 'CIRCUIT BREAKER - SYSTEM' : 'CIRCUIT BREAKER - BUS');
        const names: readonly string[] = u.page === 'SYS' ? EMS_SYSTEMS : EMS_BUSES;
        const base = u.page === 'SYS' ? u.pageNo * 2 * ROWS : 0;
        for (let i = 0; i < ROWS; i++) {
          const l = names[base + i];
          const r = names[base + ROWS + i];
          if (l) text(`<${l}`, 8, EMS_ROW_Y(i), C.cyan);
          if (r) text(`${r}>`, W - 8, EMS_ROW_Y(i), C.cyan, 'right');
        }
        break;
      }
      case 'SYSCB':
      case 'BUSCB':
      case 'STAT': {
        const t = u.page === 'STAT' ? 'CIRCUIT BREAKER - STATUS' : u.page === 'SYSCB' ? `CB - ${EMS_SYSTEMS[u.group]}` : `CB - ${EMS_BUSES[u.group]} BUS`;
        hdr(t);
        if (u.list.length === 0) text(u.page === 'STAT' ? 'NO TRIPPED OR OUT CB' : 'NO CB', W / 2, EMS_ROW_Y(2), C.white, 'center');
        for (let i = 0; i < ROWS; i++) {
          const k = u.pageNo * ROWS + i;
          if (k >= u.list.length) break;
          const x = s.entries[u.list[k]];
          const st = s.status(u.list[k]);
          const y = EMS_ROW_Y(i);
          text(x.e.name, 8, y - 6, C.white, 'left', 15);
          text(`${x.e.bus}  ${x.e.loc === 'SSPC' ? '' : x.e.loc}`, 8, y + 8, C.grey, 'left', 11);
          text(st, W - 8, y, st === 'IN' ? C.green : st === 'TRIP' ? C.amber : C.white, 'right', 16);
          if (u.sel === i) hi(i);
        }
        break;
      }
      case 'CNTL': {
        hdr('SWITCH CONTROL');
        const on = s.vars.get(V.cabinPwr) !== 0;
        text('CABIN PWR', 8, EMS_ROW_Y(0), C.white);
        text(on ? 'ON' : 'OFF', W - 8, EMS_ROW_Y(0), on ? C.green : C.white, 'right', 16);
        break;
      }
      case 'TEST': {
        hdr('TEST CONTROL');
        for (let i = 0; i < ROWS; i++) {
          const map = [0, 1, -1, -1, 2, 3];
          const t = map[i];
          const running = t >= 0 ? s.tests[t] > 0 : s.aural.running(i === 2 ? 1 : 2);
          text(TEST_ROWS[i], 8, EMS_ROW_Y(i), C.white);
          text(running ? 'TEST' : 'OFF', W - 8, EMS_ROW_Y(i), running ? C.green : C.white, 'right', 16);
          if (u.sel === i) hi(i);
        }
        break;
      }
      case 'EMER': {
        hdr('EMER CNTL');
        for (let i = 0; i < 4; i++) {
          const y = EMS_ROW_Y(i);
          const l = s.vars.get(AC_ISOL[i]) !== 0;
          const r = s.vars.get(DC_ISOL[i]) !== 0;
          text(EMER_NAMES.left[i], 8, y - 7, C.white, 'left', 13);
          text(l ? '<MAN OFF' : '<NORM', 8, y + 8, l ? C.amber : C.green, 'left', 14);
          text(EMER_NAMES.right[i], W - 8, y - 7, C.white, 'right', 13);
          text(r ? 'MAN OFF>' : 'NORM>', W - 8, y + 8, r ? C.amber : C.green, 'right', 14);
        }
        break;
      }
    }
    if (u.message) text(u.message, W / 2, EMS_ROW_Y(ROWS) - 6, C.amber, 'center', 13);
    text('M', 8, H - 10, C.white, 'left', 13);
  }

  protected override drawBoot(ctx: Ctx2D, p: number): void {
    ctx.fillStyle = C.white;
    ctx.font = '600 18px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`EMS CDU ${this.u.n}`, W / 2, 110);
    ctx.fillStyle = C.cyan;
    ctx.fillRect(80, 135, 160 * p, 6);
  }
}

/**
 * EMS CDU (Global Vision): a landscape unit in the outboard wing of the main panel (photo N835GL, crops c_lwing /
 * c_rwing): screen in the middle with six line select keys on the left and six activation keys on the right (each
 * with an engraved line to its screen row), bottom row STAT, SYS, BUS ("CIRCUIT BREAKER"), PREV PAGE, NEXT PAGE,
 * CNTL, TEST ("SYSTEM"), and at the right the red-bordered EMER CNTL key ("BUS") and BRT up / down keys.
 * Size EST from the photo against the 15.1 in AFD: ~0.27 x 0.15 m, screen 0.105 x 0.084 m (the 320 x 256 page).
 */
export const EMS_UNIT = { w: 0.27, h: 0.15, sw: 0.105, sh: 0.084, sy: 0.014 };

/**
 * EMS CDU unit on a panel (top-left origin convention), top-left corner at (x, y).
 * Keypads emit `g6k.ems{n}.key` with the key id.
 */
export function addEmsCduUnit(env: CockpitEnv, p: Panel, n: 1 | 2, x: number, y: number, unit: EmsCduUnit, canvas: 'dom' | 'offscreen' | DisplayCanvas | null | undefined, vars: SimVars): void {
  const U = EMS_UNIT;
  const zone = n === 1 ? 'panel_l' : 'panel_r';
  const sub = p.subPanel({ name: `g6k.ems${n}`, x: x + U.w / 2, y: y + U.h / 2, width: U.w, height: U.h, origin: 'top-left', material: 'panelDark', thickness: 0.008, screws: { kind: 'hex', diameter: 0.004, inset: 0.006, pitch: 0.075 } });
  const sx0 = U.w / 2 - U.sw / 2;
  if (canvas !== null) sub.display(new EmsCduScreen(unit, vars, canvas ?? undefined), U.w / 2, U.sy + U.sh / 2, U.sw, U.sh, { bezel: false });
  const pitch = (32 / H) * U.sh;
  const keyH = 0.0058;
  const keyW = 0.011;
  const top = U.sy + (EMS_ROW_Y(0) / H) * U.sh - keyH / 2;
  const kx = { L: sx0 - 0.036, R: sx0 + U.sw + 0.036 - keyW };
  for (const side of ['L', 'R'] as const) {
    const kp = new KeyPad(env, {
      id: `g6k.side.ems${n}_${side.toLowerCase()}`,
      label: `EMS CDU ${n} ${side === 'L' ? 'line select' : 'activation'} keys`,
      rows: [1, 2, 3, 4, 5, 6].map((r) => [{ id: `${side}${r}`, label: '' }]),
      singleEvent: EMS_SIDE_EVENTS.key(n),
      eventPrefix: `g6k.ems${n}.k.`,
      keyWidth: keyW,
      keyHeight: keyH,
      gap: pitch - keyH,
      zone,
    });
    sub.add(kp, kx[side], top);
    // Engraved lines from each key to its screen row (photo).
    for (let r = 0; r < 6; r++) {
      const ly = U.sy + (EMS_ROW_Y(r) / H) * U.sh;
      if (side === 'L') sub.line(kx.L + keyW + 0.003, ly, sx0 - 0.003, ly, 0.0007, zone);
      else sub.line(sx0 + U.sw + 0.003, ly, kx.R - 0.003, ly, 0.0007, zone);
    }
  }
  // Bottom row: CIRCUIT BREAKER (STAT, SYS, BUS), PREV / NEXT PAGE, SYSTEM (CNTL, TEST).
  const by = U.sy + U.sh + 0.02;
  const fk = new KeyPad(env, {
    id: `g6k.side.ems${n}_fn`,
    label: `EMS CDU ${n} page keys`,
    rows: [[{ id: 'STAT' }, { id: 'SYS' }, { id: 'BUS' }, { id: 'PREV', label: 'PREV\nPAGE' }, { id: 'NEXT', label: 'NEXT\nPAGE' }, { id: 'CNTL' }, { id: 'TEST' }]],
    singleEvent: EMS_SIDE_EVENTS.key(n),
    eventPrefix: `g6k.ems${n}.k.`,
    keyWidth: 0.02,
    keyHeight: 0.011,
    gap: 0.0045,
    legendHeight: 0.0021,
    zone,
  });
  const fx = 0.016;
  const kstep = 0.0245;
  sub.add(fk, fx, by);
  sub.label('CIRCUIT BREAKER', fx + kstep + 0.01, by - 0.0048, { height: 0.0021, zone });
  sub.label('SYSTEM', fx + kstep * 5.5 + 0.01, by - 0.0048, { height: 0.0021, zone });
  // EMER CNTL (red border, "BUS" caption) and BRT up / down (right).
  const ex = fx + kstep * 7 + 0.008;
  const red = new THREE.Mesh(env.geometry.get('g6k.ems.emer_border', () => new THREE.PlaneGeometry(0.029, 0.018)), env.materials.get('paintRed'));
  red.userData.cockpitStatic = true;
  sub.addObject(red, ex + 0.011, by + 0.0055, { z: 0.0004 });
  const ek = new KeyPad(env, {
    id: `g6k.side.ems${n}_emer`,
    label: `EMS CDU ${n} EMER CNTL`,
    rows: [[{ id: 'EMER', label: 'EMER\nCNTL' }]],
    singleEvent: EMS_SIDE_EVENTS.key(n),
    eventPrefix: `g6k.ems${n}.k.`,
    keyWidth: 0.022,
    keyHeight: 0.011,
    legendHeight: 0.0021,
    zone,
  });
  sub.add(ek, ex, by);
  sub.label('BUS', ex + 0.011, by - 0.0048, { height: 0.0021, zone });
  const bk = new KeyPad(env, {
    id: `g6k.side.ems${n}_brt`,
    label: `EMS CDU ${n} BRT`,
    rows: [[{ id: 'BRT+', label: '▲' }], [{ id: 'BRT-', label: '▼' }]],
    singleEvent: EMS_SIDE_EVENTS.key(n),
    eventPrefix: `g6k.ems${n}.k.`,
    keyWidth: 0.011,
    keyHeight: 0.008,
    gap: 0.002,
    legendHeight: 0.0024,
    zone,
  });
  sub.add(bk, U.w - 0.021, by - 0.013);
  sub.label('BRT', U.w - 0.03, by - 0.009, { height: 0.0021, zone });
  sub.label(`EMS ${n}`, 0.016, U.h - 0.006, { height: 0.0019, zone });
}
