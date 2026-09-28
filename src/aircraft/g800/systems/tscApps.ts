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
 * The HOME page is re-laid out 4 x 3 to add the two application tiles.
 * Plain data + callbacks (no Three.js); installed by createSystems.ts.
 */
import type { SimVars } from '../../../core/SimVars';
import type { EpicSuite } from '../../../avionics/honeywell-epic/suite';
import { TSC_H, TSC_TITLE_H, TSC_W } from '../../../avionics/honeywell-epic/touch/tscPages';
import { cell, type TouchPage, type TouchWidget } from '../../../avionics/honeywell-epic/logic/touch';
import { G800_VARS as V, AUTOBRAKE } from '../vars';
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

/** Adds the FLT CTL and ECB applications to every TSC of the suite (idempotent). */
export function installG800TscApps(suite: EpicSuite, vars: SimVars, breakers: readonly string[]): void {
  const ecb = electronicBreakers(breakers);
  for (const logic of suite.tscLogic) {
    if (logic.has('FLTCTL')) continue;
    const show = (id: string) => void logic.show(id);
    logic.addPage(fltCtlPage(vars));
    for (const p of ecbPages(vars, ecb, show)) logic.addPage(p);
    const home = logic.pages.find((p) => p.id === 'HOME');
    if (!home) continue;
    const tiles = home.widgets.filter((x) => x.kind === 'tile');
    tiles.push({ id: 'home.FLTCTL', kind: 'tile', x: 0, y: 0, w: 0, h: 0, label: 'Flight Controls', size: 20, tap: () => show('FLTCTL') });
    tiles.push({ id: 'home.ECB', kind: 'tile', x: 0, y: 0, w: 0, h: 0, label: 'ECB', size: 20, tap: () => show('ECB') });
    tiles.forEach((t, i) => Object.assign(t, cell(20, TOP + 6, TSC_W - 40, TSC_H - TOP - 20, 4, 3, i % 4, Math.floor(i / 4), 16)));
    home.widgets = [...home.widgets.filter((x) => x.kind !== 'tile'), ...tiles];
  }
}
