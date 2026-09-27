/** Shared set-up for the G1000 NXi suite tests (real navigation database, headless suite, optional real Afcs). */
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import type { AudioApi } from '../../../src/core/SimContext';
import { ADC, FDM, GPS } from '../../../src/core/vars';
import { NavDatabaseImpl } from '../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../src/nav/data/nodeLoader';
import { Afcs } from '../../../src/systems/autopilot';
import { G1000Suite } from '../../../src/avionics/garmin-g1000/Suite';
import type { G1000Config } from '../../../src/avionics/garmin-g1000/config';
import { C172S_NXI } from '../../../src/avionics/garmin-g1000/presets';
import { AFCS_GFC700_NXI } from '../../../src/avionics/garmin-g1000/state/afcs';
import { G1K_EVENTS, type GduId } from '../../../src/avionics/garmin-g1000/vars';

let db: NavDatabaseImpl | null = null;

/** Loads the navigation database once per test file. */
export async function loadDb(): Promise<NavDatabaseImpl> {
  if (!db) {
    db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
    await db.load();
  }
  return db;
}

/** Records audio calls. */
export class AudioLog implements AudioApi {
  readonly played: string[] = [];
  readonly callouts: string[] = [];
  readonly tones = new Map<string, boolean>();
  play(id: string): void {
    this.played.push(id);
  }
  loop(): { setGain(g: number): void; setRate(r: number): void; stop(): void } {
    return { setGain: () => undefined, setRate: () => undefined, stop: () => undefined };
  }
  callout(text: string): void {
    this.callouts.push(text);
  }
  tone(id: string, on: boolean): void {
    this.tones.set(id, on);
  }
}

export interface Rig {
  vars: SimVars;
  events: EventBus;
  audio: AudioLog;
  suite: G1000Suite;
  afcs: Afcs | null;
  /** Places the aircraft (truth + sensor vars). */
  place(lat: number, lon: number, altFt: number, hdgMag: number, iasKt?: number): void;
  step(seconds: number, dt?: number): void;
  /** Emits a bezel event on a GDU. */
  key(g: GduId, name: keyof typeof G1K_EVENTS | string, payload?: unknown): void;
  /** Turns an encoder (signed clicks). */
  turn(event: string, clicks: number): void;
}

/**
 * Headless suite (no canvases). Every unit powered unless `cfg.power` says
 * otherwise; `withAfcs` adds the shared Afcs with the NXi preset wired to
 * the GIA 1 / servo units like the aircraft does.
 */
export function makeRig(nav: NavDatabaseImpl, cfg: Partial<G1000Config> = {}, withAfcs = false): Rig {
  const vars = new SimVars();
  const events = new EventBus();
  const audio = new AudioLog();
  const suite = new G1000Suite({ vars, events, nav, audio }, { ...C172S_NXI, power: {}, aglFt: 3000, ...cfg }, { noDisplays: true });
  const afcs = withAfcs ? new Afcs({ vars, events }, { ...AFCS_GFC700_NXI, ...suite.afcsWiring() }) : null;
  const rig: Rig = {
    vars,
    events,
    audio,
    suite,
    afcs,
    place(lat, lon, altFt, hdgMag, iasKt = 110) {
      vars.set(FDM.lat, lat);
      vars.set(FDM.lon, lon);
      vars.set(FDM.altMsl, altFt);
      vars.set(FDM.gs, iasKt);
      vars.set(FDM.trackTrue, hdgMag - 13);
      vars.set(FDM.headingTrue, hdgMag - 13);
      vars.set(ADC.valid(1), 1);
      vars.set(ADC.ahrsValid(1), 1);
      vars.set(ADC.baroAlt(1), altFt);
      vars.set(ADC.ias(1), iasKt);
      vars.set(ADC.tas(1), iasKt * 1.05);
      vars.set(ADC.heading(1), hdgMag);
      vars.set(ADC.headingTrue(1), hdgMag - 13);
      vars.set(ADC.pitch(1), 2);
      vars.set(ADC.bank(1), 0);
      vars.set('gear.air_ground', altFt > 500 ? 0 : 1);
      suite.radios?.gps?.forceAcquired();
      vars.set(GPS.valid, 1);
    },
    step(seconds, dt = 1 / 30) {
      for (let t = 0; t < seconds - 1e-9; t += dt) {
        for (const s of suite.systems) s.update(dt);
        afcs?.update(dt);
      }
    },
    key(g, name, payload) {
      const e = (G1K_EVENTS as unknown as Record<string, (g: GduId) => string>)[name];
      events.emit(typeof e === 'function' ? e(g) : name, payload);
    },
    turn(event, clicks) {
      events.emit(event, clicks);
    },
  };
  return rig;
}

/** Labels of the softkeys currently shown on a GDU. */
export function softkeyLabels(rig: Rig, g: GduId): string[] {
  const sk = rig.suite.system.softkeysOf(g);
  const out: string[] = [];
  for (let i = 0; i < 12; i++) out.push(sk.label(i));
  return out;
}

/** Presses the softkey with `label` on a GDU (throws when missing). */
export function pressSoftkey(rig: Rig, g: GduId, label: string): void {
  const labels = softkeyLabels(rig, g);
  const i = labels.indexOf(label);
  if (i < 0) throw new Error(`No softkey '${label}' on ${g}: ${labels.join(' | ')}`);
  rig.events.emit(G1K_EVENTS.softkey(g, i + 1));
}
