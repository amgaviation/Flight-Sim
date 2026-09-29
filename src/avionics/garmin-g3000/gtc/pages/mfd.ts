/**
 * MFD (display pane) control screens (G3000 PG 190-02046-01 §5 "Flight
 * Management", §6 "Hazard Avoidance", §3 "Engine & Airframe Systems";
 * Longitude OG 4-10 "MFD Garmin Touch Controller"): Map Settings, Traffic
 * Settings, Weather Radar, TAWS Settings, Aircraft Systems (synoptics and
 * system controls), Checklist, Nearest, Waypoint Info, Utilities (Trip
 * Planning, GPS Status, Avionics Settings, Initialization), Weight & Fuel,
 * PERF (takeoff / landing data -> PFD V-speed bugs), Messages, Charts.
 */
import type { Rect } from '../../../common/draw/context';
import { box, line } from '../../../common/draw/context';
import { fmtFixed, fmtInt } from '../../../common/format';
import { ADC, NAV } from '../../../../core/vars';
import { KG_TO_LB } from '../../../../core/units';
import { wrap360 } from '../../../../core/math';
import type { SynopticControl } from '../../gdu/synoptic';
import { nearestItems } from '../../gdu/panes/TextPanes';
import { fmtThousands, join2 } from '../../format';
import { G3K_PALETTE, TF } from '../../gdu/style';
import { G3K, PANE_CONTENT, vn, type PaneContent, type PaneId } from '../../vars';
import type { GtcController } from '../GtcController';
import { GtcPage, type BarButton, type KnobId } from '../GtcPage';
import { GTC_COLORS, type ButtonOptions } from '../ui';
import { AlphaKeypadPage, ListSelectPage, NumericKeypadPage } from './keypads';
import { mapSettingCells } from './pfd';
import { directToCtor } from './fpl';

const P = G3K_PALETTE;

/** Pane selected by the GTC (or the first of its panes). */
function selPane(gtc: GtcController): PaneId {
  return gtc.sys.gtcPane(gtc.g) ?? gtc.g.panes[0];
}

/** Shows `c` on the controlled pane. */
export function showOnPane(gtc: GtcController, c: PaneContent, synoptic?: number): void {
  const p = gtc.sys.gtcPane(gtc.g);
  if (p) gtc.sys.setPaneContent(p, c, synoptic);
}

export class MapSettingsPage extends GtcPage {
  readonly title = 'Map Settings';
  protected build(r: Rect): void {
    const sys = this.sys;
    const p = selPane(this.gtc);
    const cells: ButtonOptions[] = [
      { label: 'Range -', onPress: () => sys.paneRangeStep(p, -1) },
      { label: 'Range +', onPress: () => sys.paneRangeStep(p, 1) },
      {
        label: 'Map Pointer',
        annun: () => sys.pointers[p].active,
        onPress: () => this.gtc.togglePointer(),
      },
      ...mapSettingCells(this.gtc, p),
    ];
    const horizontal = r.w > r.h * 1.3;
    this.grid(r, horizontal ? 4 : 3, horizontal ? 3 : 4, cells, 8);
  }
}

const ALT_RANGE = ['Normal', 'Above', 'Below', 'Unrestricted'];

export class TrafficSettingsPage extends GtcPage {
  readonly title = 'Traffic Settings';
  protected build(r: Rect): void {
    const sys = this.sys;
    const v = sys.vars;
    const tcas = sys.cfg.traffic === 'TCAS2';
    const mode = (m: number, label: string): ButtonOptions => ({ label, selected: () => v.get(NAV.xpdrMode) === m, annun: () => v.get(NAV.xpdrMode) === m, onPress: () => sys.setXpdrMode(m) });
    const cells: ButtonOptions[] = tcas ? [mode(1, 'Standby'), mode(4, 'TA Only'), mode(5, 'TA/RA')] : [mode(1, 'Standby'), mode(3, 'Operate')];
    cells.push({ label: 'Altitude Range', value: () => ALT_RANGE[v.get(G3K.trafficAltRange) | 0], onPress: () => sys.cycleVar(G3K.trafficAltRange, [0, 1, 2, 3]) });
    cells.push({ label: 'Traffic Map', onPress: () => showOnPane(this.gtc, PANE_CONTENT.traffic) });
    const horizontal = r.w > r.h * 1.3;
    this.grid({ x: r.x, y: r.y, w: r.w, h: Math.min(r.h, horizontal ? 260 : 360) }, horizontal ? 3 : 2, horizontal ? 2 : 3, cells, 10);
  }
}

/** Weather radar controls (state only: no radar returns are modelled, SCOPE). */
export class WeatherRadarPage extends GtcPage {
  readonly title = 'Weather Radar Settings';
  protected build(r: Rect): void {
    const rad = this.sys.radar;
    const bump = (): void => {
      this.sys.revision++;
    };
    const modeBtn = (m: 'STBY' | 'WX' | 'GND', label: string): ButtonOptions => ({
      label,
      selected: () => rad.on && rad.mode === m,
      annun: () => rad.on && rad.mode === m,
      onPress: () => {
        rad.on = true;
        rad.mode = m;
        bump();
      },
    });
    const cells: ButtonOptions[] = [
      {
        label: 'Radar',
        value: () => (rad.on ? 'On' : 'Off'),
        annun: () => rad.on,
        onPress: () => {
          rad.on = !rad.on;
          bump();
        },
      },
      modeBtn('STBY', 'Standby'),
      modeBtn('WX', 'Weather'),
      modeBtn('GND', 'Ground Map'),
      { label: 'Tilt Up', value: () => join2(fmtFixed(rad.tiltDeg, 2), '°'), onPress: () => ((rad.tiltDeg = Math.min(15, rad.tiltDeg + 0.25)), bump()) },
      { label: 'Tilt Down', onPress: () => ((rad.tiltDeg = Math.max(-15, rad.tiltDeg - 0.25)), bump()) },
      { label: 'Gain +', value: () => fmtFixed(rad.gain, 1), onPress: () => ((rad.gain = Math.min(5, rad.gain + 0.5)), bump()) },
      { label: 'Gain -', onPress: () => ((rad.gain = Math.max(-5, rad.gain - 0.5)), bump()) },
      { label: 'Show Radar', onPress: () => showOnPane(this.gtc, PANE_CONTENT.weather) },
    ];
    const horizontal = r.w > r.h * 1.3;
    this.grid(r, horizontal ? 3 : 3, horizontal ? 3 : 3, cells, 8);
  }
}

export class TawsPage extends GtcPage {
  readonly title = 'TAWS Settings';
  protected build(r: Rect): void {
    const sys = this.sys;
    const v = sys.vars;
    const tog = (label: string, name: string): ButtonOptions => ({ label, annun: () => v.get(name) >= 0.5, onPress: () => sys.toggleVar(name) });
    const cells: ButtonOptions[] = [
      tog('TAWS Inhibit', G3K.tawsInhibitTerrain),
      tog('GPWS Inhibit', G3K.tawsInhibitGpws),
      tog('Flap Override', G3K.tawsFlapOverride),
      { label: 'GS Inhibit', onPress: () => sys.events?.emit('taws.gs_cancel') },
      { label: 'TAWS Test', onPress: () => sys.events?.emit('taws.test') },
      { label: 'TAWS Map', onPress: () => showOnPane(this.gtc, PANE_CONTENT.taws) },
    ];
    this.grid({ x: r.x, y: r.y, w: r.w, h: Math.min(r.h, 330) }, 2, 3, cells, 10);
  }
}

// ------------------------------------------------------------------ aircraft systems

export class SystemsPage extends GtcPage {
  readonly title = 'Aircraft Systems';
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const sys = this.sys;
    const pages = sys.cfg.synoptics;
    if (!pages.length) {
      this.text(r.x + r.w / 2, r.y + r.h / 2, 'No system pages', 20, P.white, 'center');
      return;
    }
    const cols = r.w > r.h * 1.3 ? 4 : 3;
    const rows = Math.ceil(pages.length / cols);
    const cells: ButtonOptions[] = pages.map((d, i) => ({
      label: d.label ?? d.title,
      icon: 'systems' as const,
      selected: () => {
        const p = sys.gtcPane(gtc.g);
        return !!p && sys.paneContent(p) === PANE_CONTENT.synoptics && (sys.vars.get(vn(G3K.paneSynoptic, p)) | 0) === i;
      },
      onPress: () => {
        sys.ui.synoptic = i;
        showOnPane(gtc, PANE_CONTENT.synoptics, i);
        if (d.controls?.length) gtc.push(new SynopticControlsPage(gtc, i));
      },
    }));
    this.grid({ x: r.x, y: r.y, w: r.w, h: Math.min(r.h, rows * 130) }, cols, rows, cells, 8);
  }
}

/** System controls of one synoptic page (e.g. fuel pumps, cabin temperature, pressurization). */
export class SynopticControlsPage extends GtcPage {
  constructor(gtc: GtcController, readonly index: number) {
    super(gtc);
  }
  get title(): string {
    return this.sys.cfg.synoptics[this.index]?.title ?? 'Systems';
  }
  protected build(r: Rect): void {
    const def = this.sys.cfg.synoptics[this.index];
    const ctrls = def?.controls ?? [];
    const cells = ctrls.map((c) => controlButton(this.gtc, c));
    const cols = r.w > r.h * 1.3 ? 4 : 2;
    const rows = Math.max(1, Math.ceil(cells.length / cols));
    this.grid({ x: r.x, y: r.y, w: r.w, h: Math.min(r.h, rows * 110) }, cols, rows, cells, 8);
  }
}

/** Button for a SynopticControl. */
export function controlButton(gtc: GtcController, c: SynopticControl): ButtonOptions {
  const sys = gtc.sys;
  const v = sys.vars;
  switch (c.kind) {
    case 'toggle':
      return { label: c.label, value: () => (v.get(c.var!) >= 0.5 ? 'On' : 'Off'), annun: () => v.get(c.var!) >= 0.5, onPress: () => sys.toggleVar(c.var!) };
    case 'cycle': {
      const vals = c.values ?? [0, 1];
      return {
        label: c.label,
        value: () => {
          const i = vals.indexOf(v.get(c.var!));
          return c.valueLabels?.[i] ?? fmtInt(v.get(c.var!));
        },
        onPress: () => sys.cycleVar(c.var!, vals),
      };
    }
    case 'button':
      return { label: c.label, onPress: () => sys.events?.emit(c.event!, c.payload) };
    case 'number':
      return {
        label: c.label,
        value: () => join2(fmtFixed(v.get(c.var!), c.decimals ?? 0), c.unit ?? ''),
        onPress: () =>
          gtc.push(
            new NumericKeypadPage(gtc, {
              title: c.label,
              maxDigits: 6,
              decimal: (c.decimals ?? 0) > 0,
              sign: (c.min ?? 0) < 0,
              unit: c.unit,
              onEnter: (b) => {
                const n = Number(b);
                if (!b || !Number.isFinite(n) || n < (c.min ?? -Infinity) || n > (c.max ?? Infinity)) return false;
                sys.setVar(c.var!, c.step ? Math.round(n / c.step) * c.step : n);
                return true;
              },
            }),
          ),
      };
  }
}

// ------------------------------------------------------------------ checklist

export class ChecklistPage extends GtcPage {
  readonly title = 'Checklist';
  private readonly bar: BarButton[] = [
    { label: 'Check', icon: 'enter', press: () => this.check() },
    { label: 'Next List', icon: 'down', press: () => this.nextList() },
  ];
  private check(): void {
    this.sys.checklists.toggle();
    this.gtc.revision++;
  }
  private nextList(): void {
    this.sys.checklists.next();
    this.invalidate();
    this.gtc.revision++;
  }
  override onOpen(): void {
    // CAS-linked checklists: an active linked warning / caution pre-selects its list (cfg.casChecklists).
    if (this.sys.selectCasLinkedChecklist()) this.invalidate();
    showOnPane(this.gtc, PANE_CONTENT.checklist);
  }
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const cl = this.sys.checklists;
    const lists = cl.lists;
    if (!lists.length) {
      this.text(r.x + r.w / 2, r.y + r.h / 2, 'No checklists', 20, P.white, 'center');
      return;
    }
    this.button(r.x + 8, r.y + 4, r.w - 16, 56, {
      label: () => cl.current?.title ?? '',
      value: () => (cl.complete() ? 'Checklist Complete' : cl.current?.phase ?? ''),
      valueColor: () => (cl.complete() ? '#00e000' : P.cyan),
      onPress: () =>
        gtc.push(
          new ListSelectPage(gtc, 'Checklists', () => lists.map((l, i) => ({ label: l.title, sub: l.phase, value: cl.complete(i) ? 'Done' : '' })), (i) => {
            cl.select(i);
            this.invalidate();
            gtc.back();
          }),
        ),
    });
    const items = () => cl.current?.items ?? [];
    this.list(r.x + 6, r.y + 68, r.w - 12, r.h - 72, {
      count: () => items().length,
      rowH: 58,
      drawRow: (ctx, i, x, y, w, h) => {
        const it = items()[i];
        const checked = cl.isChecked(i);
        const cur = cl.cursor === i;
        box(ctx, x + 2, y + 2, w - 12, h - 4, cur ? '#24303a' : GTC_COLORS.button, cur ? GTC_COLORS.selected : GTC_COLORS.buttonEdge, cur ? 2 : 1, 3);
        box(ctx, x + 10, y + h / 2 - 11, 22, 22, '#000000', '#c0c4c8', 1.5, 2);
        if (checked) {
          line(ctx, x + 13, y + h / 2, x + 19, y + h / 2 + 7, '#00e000', 3);
          line(ctx, x + 19, y + h / 2 + 7, x + 30, y + h / 2 - 8, '#00e000', 3);
        }
        const col = checked ? '#00e000' : P.white;
        TF.draw(ctx, it.challenge, x + 42, y + h * 0.36, 17, col, 'left', 'middle');
        TF.draw(ctx, it.response, x + w - 20, y + h * 0.7, 16, checked ? '#00e000' : P.cyan, 'right', 'middle');
      },
      onRow: (i) => {
        cl.toggle(i);
        gtc.revision++;
      },
    });
  }
  override barButtons(): readonly BarButton[] {
    return this.bar;
  }
  override knobLabel(slot: 'upper' | 'lower' | 'center'): string | null {
    return slot === 'center' || slot === 'lower' ? 'Item\nPush: Check' : null;
  }
  override onKnob(k: KnobId, clicks: number): boolean {
    const cl = this.sys.checklists;
    if (k === 'center' || k === 'lower') cl.move(Math.sign(clicks));
    else if (k === 'centerPush' || k === 'lowerPush') cl.toggle();
    else return false;
    this.gtc.revision++;
    return true;
  }
}

// ------------------------------------------------------------------ nearest / waypoint info

type NearestKind = 'airport' | 'vor' | 'ndb' | 'int';

export class NearestPage extends GtcPage {
  readonly title = 'Nearest';
  private items: ReturnType<typeof nearestItems> = [];
  private t = 0;
  override onOpen(): void {
    showOnPane(this.gtc, PANE_CONTENT.nearest);
    this.t = 0;
  }
  override update(dt: number): void {
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 2;
      this.items = nearestItems(this.sys, this.sys.ui.nearestKind, 25);
      this.gtc.revision++;
    }
  }
  protected build(r: Rect): void {
    const sys = this.sys;
    const gtc = this.gtc;
    const tab = (k: NearestKind, label: string): ButtonOptions => ({
      label,
      icon: k,
      selected: () => sys.ui.nearestKind === k,
      onPress: () => {
        sys.ui.nearestKind = k;
        this.t = 0;
        showOnPane(gtc, PANE_CONTENT.nearest);
      },
    });
    this.grid({ x: r.x, y: r.y, w: r.w, h: 70 }, 4, 1, [tab('airport', 'Airport'), tab('vor', 'VOR'), tab('ndb', 'NDB'), tab('int', 'INT')], 6);
    this.list(r.x + 6, r.y + 76, r.w - 12, r.h - 80, {
      count: () => this.items.length,
      rowH: 56,
      drawRow: (ctx, i, x, y, w, h) => {
        const it = this.items[i];
        box(ctx, x + 2, y + 2, w - 12, h - 4, GTC_COLORS.button, GTC_COLORS.buttonEdge, 1, 3);
        TF.draw(ctx, it.ident, x + 14, y + h * 0.38, 20, P.cyan, 'left', 'middle');
        TF.draw(ctx, it.name.slice(0, 26), x + 14, y + h * 0.74, 13, P.white, 'left', 'middle');
        TF.draw(ctx, it.freq || it.extra, x + w - 20, y + h / 2, 17, P.white, 'right', 'middle');
      },
      onRow: (i) => {
        const it = this.items[i];
        if (!it) return;
        gtc.push(new NearestOptionsPage(gtc, { ident: it.ident, lat: it.lat, lon: it.lon, kind: sys.ui.nearestKind === 'int' ? 'fix' : sys.ui.nearestKind }));
      },
    });
  }
}

export class NearestOptionsPage extends GtcPage {
  override dialog = true;
  constructor(gtc: GtcController, readonly wpt: { ident: string; lat: number; lon: number; kind: 'airport' | 'vor' | 'ndb' | 'fix' }) {
    super(gtc);
  }
  get title(): string {
    return this.wpt.ident;
  }
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const sys = this.sys;
    const w = this.wpt;
    this.grid({ x: r.x, y: r.y, w: r.w, h: Math.min(r.h, 240) }, 2, 2, [
      {
        label: 'Direct To',
        icon: 'direct',
        onPress: () => {
          const p = new (directToCtor!)(gtc) as GtcPage & { target: unknown; legIndex: number };
          p.target = { ident: w.ident, lat: w.lat, lon: w.lon, kind: w.kind };
          p.legIndex = -1;
          gtc.replace(p);
        },
      },
      {
        label: 'Waypoint Info',
        onPress: () => {
          sys.ui.wptInfoIdent = w.ident;
          showOnPane(gtc, PANE_CONTENT.waypointInfo);
          gtc.back();
        },
      },
      {
        label: 'Tune Frequency',
        disabled: () => w.kind !== 'vor',
        onPress: () => {
          const n = sys.nav.navaidsByIdent(w.ident)[0];
          if (n) sys.setNavStandby(Math.min(gtc.g.side, sys.cfg.radios.nav), n.freq);
          gtc.back();
        },
      },
    ], 10);
  }
}

export class WaypointInfoPage extends GtcPage {
  readonly title = 'Waypoint Info';
  override onOpen(): void {
    showOnPane(this.gtc, PANE_CONTENT.waypointInfo);
  }
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const sys = this.sys;
    const pick = () =>
      gtc.push(
        new AlphaKeypadPage(gtc, {
          title: 'Waypoint Info',
          onEnter: (t) => {
            const found = sys.fpl?.resolve(t) ?? sys.nav.resolve(t, 0, 0);
            if (!found.length && !sys.nav.airport(t)) return false;
            sys.ui.wptInfoIdent = t;
            showOnPane(gtc, PANE_CONTENT.waypointInfo);
            gtc.back();
            return true;
          },
        }),
      );
    this.grid({ x: r.x, y: r.y, w: r.w, h: Math.min(r.h, 250) }, 2, 2, [
      { label: 'Airport', icon: 'airport', value: () => sys.ui.wptInfoIdent || 'Select', onPress: pick },
      { label: 'VOR', icon: 'vor', onPress: pick },
      { label: 'NDB', icon: 'ndb', onPress: pick },
      { label: 'INT', icon: 'int', onPress: pick },
    ], 10);
  }
}

// ------------------------------------------------------------------ utilities

export class UtilitiesPage extends GtcPage {
  readonly title = 'Utilities';
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const cells: ButtonOptions[] = [
      { label: 'Trip Planning', icon: 'trip', onPress: () => showOnPane(gtc, PANE_CONTENT.tripPlanning) },
      { label: 'GPS Status', icon: 'gps', onPress: () => showOnPane(gtc, PANE_CONTENT.gpsStatus) },
      { label: 'Avionics Settings', icon: 'avionics', onPress: () => gtc.push(new AvionicsSettingsPage(gtc)) },
      { label: 'Initialization', icon: 'init', onPress: () => gtc.push(new InitializationPage(gtc)) },
      { label: 'Weight and Fuel', icon: 'wf', onPress: () => gtc.push(new WeightFuelPage(gtc)) },
      { label: 'Minimums', icon: 'mins', onPress: () => gtc.push(new (pfdPages.minimums!)(gtc)) },
      { label: 'Timers', icon: 'timer', onPress: () => gtc.push(new (pfdPages.timers!)(gtc)) },
      { label: 'TAWS Settings', icon: 'taws', onPress: () => gtc.push(new TawsPage(gtc)) },
      { label: 'Charts', icon: 'charts', onPress: () => showOnPane(gtc, PANE_CONTENT.charts) },
    ];
    const horizontal = r.w > r.h * 1.3;
    this.grid(r, horizontal ? 5 : 3, horizontal ? 2 : 3, cells, 8);
  }
}

/** Filled by home.ts (keeps this module free of the PFD page imports). */
export const pfdPages: { minimums: (new (g: GtcController) => GtcPage) | null; timers: (new (g: GtcController) => GtcPage) | null } = { minimums: null, timers: null };

export class AvionicsSettingsPage extends GtcPage {
  readonly title = 'Avionics Settings';
  protected build(r: Rect): void {
    const sys = this.sys;
    const v = sys.vars;
    const tog = (label: string, name: string, on: string, off: string): ButtonOptions => ({ label, value: () => (v.get(name) >= 0.5 ? on : off), annun: () => v.get(name) >= 0.5, onPress: () => sys.toggleVar(name) });
    const cells: ButtonOptions[] = [
      tog('Sync Baro Pressure', G3K.baroSync, 'On', 'Off'),
      tog('COM Channel Spacing', G3K.comSpacing833, '8.33 kHz', '25 kHz'),
      tog('Nav Angle', G3K.navAngleTrue, 'True', 'Magnetic'),
      { label: 'Flight ID', value: () => v.getString(G3K.flightId) || '________', onPress: () => this.gtc.push(new AlphaKeypadPage(this.gtc, { title: 'Flight ID', maxLen: 8, onEnter: (t) => (v.setString(G3K.flightId, t), this.gtc.back(), true) })) },
    ];
    this.grid({ x: r.x, y: r.y, w: r.w, h: Math.min(r.h, 250) }, 2, 2, cells, 10);
  }
}

export class InitializationPage extends GtcPage {
  readonly title = 'Initialization';
  protected build(r: Rect): void {
    const sys = this.sys;
    const v = sys.vars;
    const fplDone = () => !!sys.fpl?.plan.destination && !!sys.fpl?.plan.origin;
    const wfDone = () => sys.wf.pax > 0 || sys.wf.crewStoresLb > 0 || sys.wf.cargoLb > 0;
    const task = (label: string, done: () => boolean, open: () => void): ButtonOptions => ({ label, value: () => (done() ? 'Complete' : 'Incomplete'), valueColor: () => (done() ? '#00e000' : P.amber), onPress: open });
    const cells: ButtonOptions[] = [
      task('Flight Plan', fplDone, () => this.gtc.push(new (fplPages.flightPlan!)(this.gtc))),
      task('Weight and Fuel', wfDone, () => this.gtc.push(new WeightFuelPage(this.gtc))),
      { label: 'Accept Initialization', annun: () => v.get(G3K.initAccepted) >= 0.5, onPress: () => sys.setVar(G3K.initAccepted, 1) },
      { label: 'Reset Initialization', onPress: () => sys.setVar(G3K.initAccepted, 0) },
    ];
    this.grid({ x: r.x, y: r.y, w: r.w, h: Math.min(r.h, 280) }, 2, 2, cells, 10);
  }
}

export const fplPages: { flightPlan: (new (g: GtcController) => GtcPage) | null } = { flightPlan: null };

// ------------------------------------------------------------------ weight & fuel

export class WeightFuelPage extends GtcPage {
  readonly title = 'Weight and Fuel';
  override onOpen(): void {
    showOnPane(this.gtc, PANE_CONTENT.weightFuel);
  }
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const wf = this.sys.wf;
    const lim = wf.limits;
    const lb = (n: number): string => (Number.isFinite(n) ? join2(fmtThousands(n), ' LB') : '_____ LB');
    const entry = (label: string, get: () => number, set: (n: number) => void, max: number, unit = 'LB'): ButtonOptions => ({
      label,
      value: () => (unit === 'LB' ? lb(get()) : fmtInt(get())),
      onPress: () =>
        gtc.push(
          new NumericKeypadPage(gtc, {
            title: label,
            maxDigits: 6,
            unit,
            onEnter: (b) => {
              const n = Number(b);
              if (!b || !(n >= 0 && n <= max)) return false;
              set(n);
              return true;
            },
          }),
        ),
    });
    const cells: ButtonOptions[] = [
      entry('Basic Operating Wt', () => wf.bowLb, (n) => (wf.bowLb = n), 200000),
      entry('Crew and Stores', () => wf.crewStoresLb, (n) => (wf.crewStoresLb = n), 5000),
      entry('Passengers', () => wf.pax, (n) => (wf.pax = Math.round(n)), lim.maxPax ?? 20, 'PAX'),
      entry('Lbs/Pax', () => wf.paxLb, (n) => (wf.paxLb = n), 400),
      entry('Cargo', () => wf.cargoLb, (n) => (wf.cargoLb = n), 20000),
      entry('Fuel Reserves', () => wf.reserveLb, (n) => (wf.reserveLb = n), 50000),
    ];
    const horizontal = r.w > r.h * 1.3;
    const top = { x: r.x, y: r.y, w: horizontal ? r.w * 0.6 : r.w, h: horizontal ? r.h : r.h * 0.6 };
    this.grid(top, 2, 3, cells, 8);
    const sx = horizontal ? r.x + r.w * 0.6 + 10 : r.x + 10;
    const sy = horizontal ? r.y + 10 : r.y + r.h * 0.6 + 6;
    const sw = horizontal ? r.w * 0.4 - 20 : r.w - 20;
    this.custom(sx, sy, sw, horizontal ? r.h - 20 : r.h * 0.4 - 10, (ctx, rr) => {
      box(ctx, rr.x, rr.y, rr.w, rr.h, '#000000', GTC_COLORS.buttonEdge, 1.2, 4);
      const rows: [string, number, boolean][] = [
        ['Zero Fuel Weight', wf.zfwLb, wf.over('zfw')],
        ['Fuel on Board', wf.fuelLb, false],
        ['Gross Weight', wf.grossLb, wf.over('gross')],
        ['Est Landing Weight', wf.landingLb, wf.over('landing')],
      ];
      const rh = Math.min(34, rr.h / 4.4);
      for (let i = 0; i < rows.length; i++) {
        const y = rr.y + rh * (i + 0.8);
        TF.draw(ctx, rows[i][0], rr.x + 10, y, 16, P.white, 'left', 'middle');
        TF.draw(ctx, lb(rows[i][1]), rr.x + rr.w - 10, y, 18, rows[i][2] ? P.amber : P.cyan, 'right', 'middle');
      }
    });
  }
}

// ------------------------------------------------------------------ PERF / TOLD

export class PerfPage extends GtcPage {
  readonly title = 'Performance';
  override onOpen(): void {
    showOnPane(this.gtc, PANE_CONTENT.told);
  }
  protected build(r: Rect): void {
    const gtc = this.gtc;
    this.grid({ x: r.x, y: r.y, w: r.w, h: Math.min(r.h, 250) }, 2, 2, [
      { label: 'Takeoff Data', icon: 'perf', onPress: () => gtc.push(new ToldPage(gtc, 'takeoff')) },
      { label: 'Landing Data', icon: 'perf', onPress: () => gtc.push(new ToldPage(gtc, 'landing')) },
      { label: 'Weight and Fuel', icon: 'wf', onPress: () => gtc.push(new WeightFuelPage(gtc)) },
      { label: 'Speed Bugs', icon: 'speed', onPress: () => gtc.push(new (speedBugsCtor.ctor!)(gtc)) },
    ], 10);
  }
}

export const speedBugsCtor: { ctor: (new (g: GtcController) => GtcPage) | null } = { ctor: null };

/**
 * Takeoff / Landing data (G5000 CRG "TOLD"): inputs auto-filled from the
 * flight plan runway and the current conditions (OAT from the ADC, altimeter
 * setting, gross / landing weight), Calculate (aircraft performance provider),
 * Send to PFD (V-speed bugs + N1 target).
 */
export class ToldPage extends GtcPage {
  constructor(gtc: GtcController, readonly phase: 'takeoff' | 'landing') {
    super(gtc);
  }
  get title(): string {
    return this.phase === 'takeoff' ? 'Takeoff Data' : 'Landing Data';
  }
  override onOpen(): void {
    showOnPane(this.gtc, PANE_CONTENT.told);
    this.autofill();
  }
  /** Fills the inputs from the flight plan and sensors (only fields still at their defaults). */
  autofill(): void {
    const sys = this.sys;
    const v = sys.vars;
    const told = sys.told;
    const plan = sys.fpl?.plan;
    const inp = this.phase === 'takeoff' ? told.inputs.takeoff : told.inputs.landing;
    const apt = this.phase === 'takeoff' ? plan?.origin : plan?.destination;
    const rwId = this.phase === 'takeoff' ? plan?.departureRunway : plan?.arrivalRunway;
    if (apt) {
      inp.airport = apt.icao;
      const rw = apt.runways.find((x) => x.ident === rwId) ?? null;
      if (rw) {
        inp.runway = rw.ident;
        inp.runwayLengthFt = rw.lengthFt;
        inp.runwayElevFt = rw.elevationFt || apt.elevationFt;
        inp.runwayHeadingMag = Math.round(wrap360(rw.headingTrue - (apt.magVar ?? 0)));
      } else inp.runwayElevFt = apt.elevationFt;
    }
    const adc = v.get(vn(G3K.adcSel, this.gtc.g.side), 1);
    const sat = v.get(vn(ADC.sat, adc), NaN);
    if (Number.isFinite(sat) && this.phase === 'takeoff') inp.oatC = Math.round(sat);
    const baro = v.get(vn(ADC.baroSetting, adc), NaN);
    if (Number.isFinite(baro)) inp.qnhInHg = Math.round(baro * 100) / 100;
    const w = this.phase === 'takeoff' ? sys.wf.grossLb : sys.wf.landingLb;
    if (Number.isFinite(w) && w > 0) inp.weightLb = Math.round(w);
  }
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const sys = this.sys;
    const told = sys.told;
    const to = this.phase === 'takeoff';
    const inp = to ? told.inputs.takeoff : told.inputs.landing;
    const prov = told.provider;
    const num = (label: string, get: () => string, set: (n: number) => void, digits: number, sign = false, unit = ''): ButtonOptions => ({
      label,
      value: get,
      onPress: () =>
        gtc.push(
          new NumericKeypadPage(gtc, {
            title: label,
            maxDigits: digits,
            sign,
            decimal: unit === 'IN',
            unit,
            onEnter: (b) => {
              const n = Number(b);
              if (!b || !Number.isFinite(n)) return false;
              set(n);
              return true;
            },
          }),
        ),
    });
    const flaps = to ? prov?.takeoffFlaps ?? [] : prov?.landingFlaps ?? [];
    const cells: ButtonOptions[] = [
      { label: 'Runway', value: () => (inp.airport ? join2(inp.airport, inp.runway ? join2(' RW', inp.runway) : '') : 'None'), onPress: () => this.autofill() },
      num('Wind Dir', () => join2(fmtInt(inp.windDirMag), '°'), (n) => (inp.windDirMag = wrap360(n)), 3),
      num('Wind Speed', () => join2(fmtInt(inp.windKt), ' KT'), (n) => (inp.windKt = Math.max(0, n)), 2),
      num('OAT', () => join2(fmtInt(inp.oatC), '°C'), (n) => (inp.oatC = n), 2, true, '°C'),
      num('Altimeter', () => join2(fmtFixed(inp.qnhInHg, 2), ' IN'), (n) => (inp.qnhInHg = n > 100 ? n / 100 : n), 4, false, 'IN'),
      num(to ? 'Takeoff Weight' : 'Landing Weight', () => join2(fmtThousands(inp.weightLb), ' LB'), (n) => (inp.weightLb = n), 6),
      { label: 'Flaps', value: () => inp.flaps || '-', disabled: () => flaps.length < 2, onPress: () => (inp.flaps = flaps[(flaps.indexOf(inp.flaps) + 1) % flaps.length]) },
      { label: 'Anti-Ice', value: () => (inp.antiIce ? 'On' : 'Off'), annun: () => inp.antiIce, onPress: () => (inp.antiIce = !inp.antiIce) },
      { label: 'Runway Cond', value: () => (inp.wet ? 'Wet' : 'Dry'), onPress: () => (inp.wet = !inp.wet) },
      {
        label: 'Calculate',
        disabled: () => !prov,
        onPress: () => {
          const res = to ? told.computeTakeoff() : told.computeLanding();
          if (!res) gtc.flash('Performance data unavailable');
        },
      },
      {
        label: 'Send to PFD',
        disabled: () => !(to ? told.takeoffResult : told.landingResult),
        onPress: () => {
          const res = to ? told.takeoffResult : told.landingResult;
          if (!res) return;
          sys.vspeeds.applyTold(res.vspeeds);
          if (to && told.takeoffResult?.n1Pct) sys.setVar(G3K.n1Target, told.takeoffResult.n1Pct);
          if (to) told.takeoffConfirmed = true;
          else told.landingConfirmed = true;
          gtc.flash('V-speeds sent to PFD');
        },
      },
    ];
    const horizontal = r.w > r.h * 1.3;
    this.grid(r, horizontal ? 4 : 3, horizontal ? 3 : 4, cells, 7);
    void KG_TO_LB;
  }
}

// ------------------------------------------------------------------ messages / charts

export class MessagesPage extends GtcPage {
  readonly title = 'Messages';
  override onOpen(): void {
    this.sys.messages.markAllRead();
  }
  protected build(r: Rect): void {
    const m = this.sys.messages;
    this.list(r.x + 6, r.y + 4, r.w - 12, r.h - 8, {
      count: () => m.list.length,
      rowH: 70,
      drawRow: (ctx, i, x, y, w, h) => {
        const it = m.list[i];
        box(ctx, x + 2, y + 2, w - 12, h - 4, GTC_COLORS.button, GTC_COLORS.buttonEdge, 1, 3);
        const dash = it.text.indexOf(' - ');
        const head = dash > 0 ? it.text.slice(0, dash) : it.text;
        const body = dash > 0 ? it.text.slice(dash + 3) : '';
        TF.draw(ctx, head, x + 12, y + h * 0.35, 18, it.active ? P.white : P.grey, 'left', 'middle');
        if (body) TF.draw(ctx, body, x + 12, y + h * 0.72, 14, it.active ? P.white : P.grey, 'left', 'middle');
      },
    });
    this.custom(r.x, r.y, r.w, r.h, (ctx) => {
      if (!m.list.length) TF.draw(ctx, 'No Messages', r.x + r.w / 2, r.y + r.h / 2, 20, P.white, 'center', 'middle');
    });
  }
}
