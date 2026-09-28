/**
 * G800 touch-screen-controller applications added to the shared Symmetry TSC
 * set (src/avionics/honeywell-epic/touch/tscPages.ts) on every TSC:
 *
 *  - FLT CTL: AUTOBRAKE RTO / OFF / LOW / MED / HIGH ("Three levels of deceleration
 *    on landing - Low, Medium and High, and a single Rejected Takeoff (RTO) mode
 *    selected via TSC 1-4", code450 G700/G800 landing gear study sheets), GROUND
 *    SPOILERS ARM, ROLL TRIM LWD / RWD and YAW TRIM AUTO CENTER. BJT500: the only
 *    switch on the Symmetry pedestal is the flight-control reset, and no roll-trim
 *    or rudder-centre hardware is visible in the G500 / G600 photographs, so these
 *    functions are touch functions here (EST page layout).
 *  - ECB: the electronic circuit breakers (BJT500: "45 percent replaced by
 *    electronic circuit breakers"): every network breaker not on the overhead CB
 *    panels (cbTable.ts). Tap = open (pull) / close (reset) the ECB; tripped ECBs show
 *    amber TRIP. Same vars as a mechanical breaker (`cb.<load>`, `cb.<load>_tripped`).
 *
 *  - AUDIO (function fix round 1): MIC select VHF 1 / 2 / 3, HF 1 / 2, PA and the receivers (on / off, volume) for
 *    the TSC's side (TSC 1 / 2 pilot, TSC 3 / 4 copilot). BJT500: no hardware audio panels on Symmetry; the audio
 *    control is a touch function. EST layout. The HOME tile shows the selected MIC.
 *  - TAWS (function fix round 1): TERR INHIBIT, GPWS INHIBIT, FLAP OVERRIDE, G/S CANCEL and TAWS TEST (Honeywell
 *    EGPWS crew functions; EST location - a touch page, no hardware in the G500 / G600 photographs).
 * OHPTS TEST page (function fix round 1; C450S fire: "Fire Test switch ... on any OHPTS"): FIRE TEST and LAMP TEST,
 * added as a TEST tab to every overhead touch screen.
 *
 * The HOME page is re-laid out 5 x 3 to add the application tiles.
 * Plain data + callbacks (no Three.js); installed by createSystems.ts.
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import type { EpicSuite } from '../../../avionics/honeywell-epic/suite';
import { TSC_H, TSC_TITLE_H, TSC_W } from '../../../avionics/honeywell-epic/touch/tscPages';
import { cell, type TouchPage, type TouchWidget } from '../../../avionics/honeywell-epic/logic/touch';
import { G800_VARS as V, AUTOBRAKE, AUDIO_RX, MIC_LABEL } from '../vars';
import { CB_LEGEND, electronicBreakers } from '../cbTable';

const TOP = TSC_TITLE_H + 8;
const ECB_PER_PAGE = 20;

function fltCtlPage(v: SimVars): TouchPage {
  const w: TouchWidget[] = [];
  w.push({ id: 'fc.ab.title', kind: 'label', x: 20, y: TOP + 4, w: 760, h: 28, label: 'AUTOBRAKE', size: 18 });
  const ab: [string, number][] = [
    ['RTO', AUTOBRAKE.RTO],
    ['OFF', AUTOBRAKE.OFF],
    ['LOW', AUTOBRAKE.LOW],
    ['MED', AUTOBRAKE.MED],
    ['HIGH', AUTOBRAKE.HIGH],
  ];
  ab.forEach(([label, val], i) => {
    w.push({ id: `fc.ab.${label}`, kind: 'toggle', ...cell(20, TOP + 36, 760, 70, 5, 1, i, 0, 10), label, size: 20, on: () => v.get(V.autobrake) === val, tap: () => v.set(V.autobrake, val) });
  });
  w.push({ id: 'fc.splr.title', kind: 'label', x: 20, y: TOP + 122, w: 360, h: 28, label: 'GROUND SPOILERS', size: 18 });
  w.push({ id: 'fc.splr.arm', kind: 'toggle', x: 20, y: TOP + 154, w: 170, h: 70, label: 'ARM', size: 20, on: () => v.get(V.gndSplrArm) === 1, tap: () => v.set(V.gndSplrArm, v.get(V.gndSplrArm) === 1 ? 0 : 1) });
  w.push({ id: 'fc.roll.title', kind: 'label', x: 420, y: TOP + 122, w: 360, h: 28, label: 'ROLL TRIM', size: 18 });
  // Momentary: the trim runs while the key is held (spring-return rocker equivalent).
  w.push({ id: 'fc.roll.lwd', kind: 'button', x: 420, y: TOP + 154, w: 170, h: 70, label: 'L WING DN', size: 18, press: (d) => v.set(V.rollTrimSw, d ? -1 : 0) });
  w.push({ id: 'fc.roll.rwd', kind: 'button', x: 610, y: TOP + 154, w: 170, h: 70, label: 'R WING DN', size: 18, press: (d) => v.set(V.rollTrimSw, d ? 1 : 0) });
  w.push({ id: 'fc.yaw.title', kind: 'label', x: 20, y: TOP + 240, w: 360, h: 28, label: 'YAW TRIM', size: 18 });
  w.push({ id: 'fc.yaw.ctr', kind: 'button', x: 20, y: TOP + 272, w: 260, h: 70, label: 'AUTO CENTER', size: 18, press: (d) => v.set(V.yawTrimCenter, d ? 1 : 0) });
  w.push({
    id: 'fc.yaw.pos',
    kind: 'value',
    x: 300,
    y: TOP + 272,
    w: 200,
    h: 70,
    label: 'RUDDER TRIM',
    sub: () => {
      const u = v.get('trim.yaw_units');
      return Math.abs(u) < 0.005 ? '0.0' : `${u < 0 ? 'NL' : 'NR'} ${Math.abs(u * 10).toFixed(1)}`;
    },
  });
  return { id: 'FLTCTL', title: 'Flight Controls / Brakes', widgets: w };
}

function ecbPages(v: SimVars, names: string[], show: (id: string) => void): TouchPage[] {
  const pages: TouchPage[] = [];
  const n = Math.max(1, Math.ceil(names.length / ECB_PER_PAGE));
  for (let p = 0; p < n; p++) {
    const w: TouchWidget[] = [];
    names.slice(p * ECB_PER_PAGE, (p + 1) * ECB_PER_PAGE).forEach((name, i) => {
      const cbv = `cb.${name}`;
      const trip = `cb.${name}_tripped`;
      w.push({
        id: `ecb.${name}`,
        kind: 'toggle',
        ...cell(20, TOP + 4, 760, 340, 5, 4, i % 5, Math.floor(i / 5), 8),
        label: CB_LEGEND[name] ?? name.toUpperCase(),
        sub: () => (v.get(trip) !== 0 ? 'TRIP' : v.get(cbv, 1) !== 0 ? 'IN' : 'OUT'),
        on: () => v.get(cbv, 1) !== 0,
        fault: () => v.get(trip) !== 0,
        size: 14,
        tap: () => {
          if (v.get(cbv, 1) !== 0) v.set(cbv, 0);
          else {
            v.set(cbv, 1);
            v.set(trip, 0);
          }
        },
      });
    });
    const id = p === 0 ? 'ECB' : `ECB${p + 1}`;
    if (n > 1) {
      w.push({ id: `ecb.prev${p}`, kind: 'button', x: 20, y: TSC_H - 70, w: 170, h: 56, label: 'PREV', size: 18, disabled: () => p === 0, tap: () => show(p === 1 ? 'ECB' : `ECB${p}`) });
      w.push({ id: `ecb.next${p}`, kind: 'button', x: TSC_W - 190, y: TSC_H - 70, w: 170, h: 56, label: 'NEXT', size: 18, disabled: () => p === n - 1, tap: () => show(`ECB${p + 2}`) });
      w.push({ id: `ecb.pg${p}`, kind: 'label', x: 300, y: TSC_H - 60, w: 200, h: 40, label: `${p + 1} / ${n}`, size: 18 });
    }
    pages.push({ id, title: 'Electronic Circuit Breakers', widgets: w });
  }
  return pages;
}

function audioPage(v: SimVars, side: 1 | 2): TouchPage {
  const w: TouchWidget[] = [];
  w.push({ id: 'au.mic.title', kind: 'label', x: 20, y: TOP + 2, w: 760, h: 24, label: 'MIC SELECT', size: 16 });
  for (let m = 1; m <= 6; m++) {
    w.push({ id: `au.mic.${m}`, kind: 'toggle', ...cell(20, TOP + 28, 760, 58, 6, 1, m - 1, 0, 8), label: MIC_LABEL[m], size: 18, on: () => v.get(V.micSel(side)) === m, tap: () => v.set(V.micSel(side), m) });
  }
  w.push({ id: 'au.rx.title', kind: 'label', x: 20, y: TOP + 96, w: 760, h: 24, label: 'RECEIVERS', size: 16 });
  const y0 = TOP + 122;
  const h0 = TSC_H - y0 - 10;
  AUDIO_RX.forEach((name, r) => {
    const c = cell(20, y0, 760, h0, 5, 2, r % 5, Math.floor(r / 5), 10);
    const on = V.rxOn(side, r);
    const vol = V.rxVol(side, r);
    w.push({
      id: `au.rx.${r}`,
      kind: 'toggle',
      x: c.x,
      y: c.y,
      w: c.w,
      h: c.h - 52,
      label: name,
      sub: () => `${Math.round(v.get(vol) * 100)} %`,
      size: 16,
      on: () => v.get(on) !== 0,
      tap: () => v.set(on, v.get(on) !== 0 ? 0 : 1),
    });
    const kw = (c.w - 6) / 2;
    w.push({ id: `au.rx.${r}.dec`, kind: 'key', x: c.x, y: c.y + c.h - 46, w: kw, h: 46, label: '−', size: 20, tap: () => v.set(vol, Math.max(0, Math.round((v.get(vol) - 0.1) * 10) / 10)) });
    w.push({ id: `au.rx.${r}.inc`, kind: 'key', x: c.x + kw + 6, y: c.y + c.h - 46, w: kw, h: 46, label: '+', size: 20, tap: () => v.set(vol, Math.min(1, Math.round((v.get(vol) + 0.1) * 10) / 10)) });
  });
  return { id: 'AUDIO', title: side === 1 ? 'Audio - Pilot' : 'Audio - Copilot', widgets: w };
}

function tawsPage(v: SimVars, events: EventBus): TouchPage {
  const w: TouchWidget[] = [];
  const tog = (id: string, label: string, name: string, x: number, y: number): void => {
    w.push({ id, kind: 'toggle', x, y, w: 230, h: 80, label, sub: () => (v.get(name) !== 0 ? 'INHIBIT' : 'NORMAL'), size: 18, on: () => v.get(name) !== 0, guarded: true, tap: () => v.set(name, v.get(name) !== 0 ? 0 : 1) });
  };
  tog('taws.terr', 'TERR INHIBIT', V.tawsTerrInh, 20, TOP + 20);
  tog('taws.gpws', 'GPWS INHIBIT', V.tawsGpwsInh, 285, TOP + 20);
  w.push({ id: 'taws.flap', kind: 'toggle', x: 550, y: TOP + 20, w: 230, h: 80, label: 'FLAP OVERRIDE', sub: () => (v.get(V.tawsFlapOvrd) !== 0 ? 'OVRD' : 'NORMAL'), size: 18, on: () => v.get(V.tawsFlapOvrd) !== 0, guarded: true, tap: () => v.set(V.tawsFlapOvrd, v.get(V.tawsFlapOvrd) !== 0 ? 0 : 1) });
  w.push({ id: 'taws.gs', kind: 'button', x: 20, y: TOP + 130, w: 230, h: 80, label: 'G/S CANCEL', size: 18, fault: () => v.get('taws.gs_light') !== 0, tap: () => events.emit('taws.gs_cancel') });
  w.push({ id: 'taws.test', kind: 'button', x: 285, y: TOP + 130, w: 230, h: 80, label: 'TAWS TEST', size: 18, tap: () => events.emit('taws.test') });
  w.push({ id: 'taws.status', kind: 'value', x: 550, y: TOP + 130, w: 230, h: 80, label: 'STATUS', sub: () => (v.get('taws.inop') !== 0 ? 'TAWS FAIL' : v.get('taws.terr_inop') !== 0 ? 'TERR INOP' : 'NORMAL'), fault: () => v.get('taws.inop') !== 0 || v.get('taws.terr_inop') !== 0 });
  return { id: 'TAWS', title: 'TAWS', widgets: w };
}

/** OHPTS TEST page (FIRE TEST / LAMP TEST, both momentary) and its tab on every overhead page. */
function installOhptsTest(logic: import('../../../avionics/honeywell-epic/logic/touch').TouchScreenLogic, v: SimVars): void {
  if (logic.has('TEST')) return;
  const tabsOf = (p: TouchPage): TouchWidget[] => p.widgets.filter((x) => x.kind === 'tab');
  const first = logic.pages.find((p) => tabsOf(p).length > 0);
  if (!first) return;
  const proto = tabsOf(first);
  const y = proto[0].y;
  const h = proto[0].h;
  const n = proto.length + 1;
  const place = (t: TouchWidget, i: number): void => void Object.assign(t, cell(8, y, TSC_W - 16, h, n, 1, i, 0, 6));
  const testTab = (active: boolean): TouchWidget => ({ id: 'tab.TEST', kind: 'tab', x: 0, y: 0, w: 0, h: 0, label: 'TEST', size: 15, on: () => active, tap: () => void logic.show('TEST') });
  for (const p of logic.pages) {
    const tabs = tabsOf(p);
    if (tabs.length === 0) continue;
    tabs.forEach(place);
    const t = testTab(false);
    place(t, n - 1);
    p.widgets.push(t);
  }
  const w: TouchWidget[] = proto.map((t, i) => {
    const c: TouchWidget = { ...t, on: () => false };
    place(c, i);
    return c;
  });
  const tt = testTab(true);
  place(tt, n - 1);
  w.push(tt);
  w.push({ id: 'test.fire', kind: 'button', x: 60, y: y + h + 60, w: 300, h: 110, label: 'FIRE TEST', sub: 'PUSH AND HOLD', size: 22, fault: () => v.get('fire.test') !== 0, press: (d) => v.set(V.fireTest, d ? 1 : 0) });
  w.push({ id: 'test.lamp', kind: 'button', x: 440, y: y + h + 60, w: 300, h: 110, label: 'LAMP TEST', sub: 'PUSH AND HOLD', size: 22, on: () => v.get('alert.annun_test') !== 0, press: (d) => v.set('alert.annun_test', d ? 1 : 0) });
  logic.addPage({ id: 'TEST', title: 'System Test', widgets: w });
}

/** Adds the FLT CTL, ECB, AUDIO and TAWS applications to every TSC and the TEST page to every OHPTS (idempotent). */
export function installG800TscApps(suite: EpicSuite, vars: SimVars, breakers: readonly string[]): void {
  const ecb = electronicBreakers(breakers);
  suite.tscLogic.forEach((logic, idx) => {
    if (logic.has('FLTCTL')) return;
    const side: 1 | 2 = idx <= 1 ? 1 : 2; // TSC 1 / 2 pilot, TSC 3 / 4 copilot (TSC_POSITIONS)
    const show = (id: string) => void logic.show(id);
    logic.addPage(fltCtlPage(vars));
    for (const p of ecbPages(vars, ecb, show)) logic.addPage(p);
    logic.addPage(audioPage(vars, side));
    logic.addPage(tawsPage(vars, suite.events));
    const home = logic.pages.find((p) => p.id === 'HOME');
    if (!home) return;
    const tiles = home.widgets.filter((x) => x.kind === 'tile');
    tiles.push({ id: 'home.FLTCTL', kind: 'tile', x: 0, y: 0, w: 0, h: 0, label: 'Flight Controls', size: 20, tap: () => show('FLTCTL') });
    tiles.push({ id: 'home.ECB', kind: 'tile', x: 0, y: 0, w: 0, h: 0, label: 'ECB', size: 20, tap: () => show('ECB') });
    tiles.push({ id: 'home.AUDIO', kind: 'tile', x: 0, y: 0, w: 0, h: 0, label: 'Audio', sub: () => `MIC ${MIC_LABEL[Math.round(vars.get(V.micSel(side)))] ?? ''}`, size: 20, tap: () => show('AUDIO') });
    tiles.push({ id: 'home.TAWS', kind: 'tile', x: 0, y: 0, w: 0, h: 0, label: 'TAWS', size: 20, tap: () => show('TAWS') });
    tiles.forEach((t, i) => Object.assign(t, cell(20, TOP + 6, TSC_W - 40, TSC_H - TOP - 20, 5, 3, i % 5, Math.floor(i / 5), 14)));
    home.widgets = [...home.widgets.filter((x) => x.kind !== 'tile'), ...tiles];
  });
  for (const logic of suite.ohptsLogic) installOhptsTest(logic, vars);
  // QA / debug hook (screenshot scripts: window.__sim.emit): show a page on TSC n (0..3) or OHPTS n (0..2).
  suite.events.on('g800.tsc.show', (p) => {
    const q = p as { tsc?: number; ohpts?: number; page?: string } | undefined;
    if (!q?.page) return;
    if (q.tsc !== undefined) suite.tscLogic[q.tsc]?.show(q.page);
    if (q.ohpts !== undefined) suite.ohptsLogic[q.ohpts]?.show(q.page);
  });
}
