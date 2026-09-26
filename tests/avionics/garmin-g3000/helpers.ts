/** Shared set-up for the G3000 suite tests (real navigation database, headless suite). */
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { ADC, FDM } from '../../../src/core/vars';
import { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../src/nav/data/nodeLoader';
import { G3000Suite } from '../../../src/avionics/garmin-g3000/Suite';
import type { G3000Config } from '../../../src/avionics/garmin-g3000/config';
import { G3000_M2_LAYOUT } from '../../../src/avionics/garmin-g3000/presets';
import type { GtcController } from '../../../src/avionics/garmin-g3000/gtc/GtcController';
import { Button, type Widget } from '../../../src/avionics/garmin-g3000/gtc/ui';

let db: NavDatabaseImpl | null = null;

/** Loads the navigation database once per test file. */
export async function loadDb(): Promise<NavDatabaseImpl> {
  if (!db) {
    db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
    await db.load();
  }
  return db;
}

export interface Rig {
  vars: SimVars;
  events: EventBus;
  suite: G3000Suite;
  /** Places the aircraft (truth + sensor vars) and steps every suite system. */
  place(lat: number, lon: number, altFt: number, hdgMag: number, gsKt?: number): void;
  step(seconds: number, dt?: number): void;
}

/** Headless suite (no canvases) with sensors written directly. */
export function makeRig(nav: NavDatabaseImpl, cfg: Partial<G3000Config> = {}): Rig {
  const vars = new SimVars();
  const events = new EventBus();
  const suite = new G3000Suite({ vars, events, nav }, { ...G3000_M2_LAYOUT, aircraftId: 'test', ...cfg }, { noDisplays: true });
  let extra: { update(dt: number): void }[] = [];
  const rig: Rig = {
    vars,
    events,
    suite,
    place(lat, lon, altFt, hdgMag, gsKt = 150) {
      vars.set(FDM.lat, lat);
      vars.set(FDM.lon, lon);
      vars.set(FDM.altMsl, altFt);
      vars.set(FDM.gs, gsKt);
      vars.set(FDM.trackTrue, hdgMag - 14);
      vars.set(FDM.headingTrue, hdgMag - 14);
      for (const s of [1, 2]) {
        vars.set(ADC.valid(s), 1);
        vars.set(ADC.ahrsValid(s), 1);
        vars.set(ADC.baroAlt(s), altFt);
        vars.set(ADC.ias(s), gsKt);
        vars.set(ADC.heading(s), hdgMag);
        vars.set(ADC.headingTrue(s), hdgMag - 14);
      }
      vars.set('gear.air_ground', altFt > 100 ? 0 : 1);
      suite.radios?.gps?.forceAcquired();
    },
    step(seconds, dt = 1 / 30) {
      for (let t = 0; t < seconds - 1e-9; t += dt) {
        for (const s of suite.systems) s.update(dt);
        for (const e of extra) e.update(dt);
      }
    },
  };
  (rig as Rig & { addSystem(s: { update(dt: number): void }): void }).addSystem = (s) => {
    extra = [...extra, s];
  };
  return rig;
}

export function addSystem(rig: Rig, s: { update(dt: number): void }): void {
  (rig as Rig & { addSystem(s: { update(dt: number): void }): void }).addSystem(s);
}

/** Content rectangle of a vertical GTC 570 page. */
export const GTC_RECT = { x: 4, y: 134, w: 472, h: 392 };

function labelOf(w: Widget): string | null {
  if (!(w instanceof Button)) return null;
  const l = w.o.label;
  return typeof l === 'function' ? l() : l;
}

/** Labels of the visible buttons on the current page. */
export function labels(gtc: GtcController): string[] {
  const p = gtc.page;
  p.ensureBuilt(GTC_RECT);
  return p.widgets.filter((w) => w.visible()).map(labelOf).filter((x): x is string => x !== null);
}

/** Touches the button with `label` on the current page (throws when missing / disabled). */
export function tap(gtc: GtcController, label: string, nth = 0): void {
  const p = gtc.page;
  p.ensureBuilt(GTC_RECT);
  const bs = p.widgets.filter((w) => w.visible() && labelOf(w) === label) as Button[];
  const b = bs[nth];
  if (!b) throw new Error(`No button '${label}' on '${typeof p.title === 'function' ? p.title() : p.title}': ${labels(gtc).join(', ')}`);
  if (b.o.disabled?.()) throw new Error(`Button '${label}' is disabled`);
  b.press();
}

/** Presses a button-bar button of the page ('Enter', 'Load', 'Activate'...). */
export function bar(gtc: GtcController, label: string): void {
  const bb = gtc.page.barButtons()?.find((b) => (typeof b.label === 'function' ? b.label() : b.label) === label);
  if (!bb) throw new Error(`No bar button '${label}'`);
  bb.press();
}

/** Types keys on the current keypad page. */
export function keys(gtc: GtcController, s: string): void {
  const p = gtc.page as unknown as { key(k: string): void };
  for (const ch of s) p.key(ch);
}
