/**
 * PROC and Direct-To screens (G3000 PG 190-02046-01 §5.5 "Direct-to
 * Navigation", §5.8 "Procedures"):
 *  - PROC: Departure / Arrival / Approach selection, Activate Approach,
 *    Activate Vectors-To-Final, Activate Missed Approach;
 *  - procedure selection: airport, procedure, runway / transition lists,
 *    Load (and Load & Activate / Activate VTF for approaches); the selected
 *    procedure is previewed on the controlled display pane;
 *  - Direct-To: waypoint (identifier keypad or flight plan waypoint),
 *    optional course, Activate.
 */
import type { Rect } from '../../../common/draw/context';
import type { Procedure, Waypoint } from '../../../../nav/types';
import { fmtDeg, join2 } from '../../format';
import { G3K_PALETTE, TF } from '../../gdu/style';
import { PANE_CONTENT, type PaneContent, type PaneId } from '../../vars';
import { legIdent, type ProcKind } from '../../state/FplEditor';
import type { GtcController } from '../GtcController';
import { GtcPage, type BarButton } from '../GtcPage';
import { GTC_COLORS, type ButtonOptions } from '../ui';
import { box } from '../../../common/draw/context';
import { ListSelectPage, NumericKeypadPage, type ListItem } from './keypads';
import { enterWaypoint, registerProcPages, registerProcSelect } from './fpl';

const P = G3K_PALETTE;

export class ProcPage extends GtcPage {
  readonly title = 'Procedures';
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const fpl = this.sys.fpl;
    if (!fpl) return;
    const horizontal = r.w > r.h * 1.3;
    const cells: ButtonOptions[] = [
      { label: 'Departure', icon: 'proc', value: () => fpl.plan.sid?.ident ?? '', onPress: () => gtc.push(new ProcSelectPage(gtc, 'departure')) },
      { label: 'Arrival', icon: 'proc', value: () => fpl.plan.star?.ident ?? '', onPress: () => gtc.push(new ProcSelectPage(gtc, 'arrival')) },
      { label: 'Approach', icon: 'proc', value: () => fpl.plan.approachProcedure?.name ?? '', onPress: () => gtc.push(new ProcSelectPage(gtc, 'approach')) },
      { label: 'Activate Approach', disabled: () => !fpl.plan.approachProcedure, onPress: () => fpl.activateApproach() },
      { label: 'Activate Vectors to Final', disabled: () => !fpl.plan.approachProcedure, onPress: () => fpl.activateVtf() },
      { label: 'Activate Missed Approach', disabled: () => !fpl.plan.approachProcedure, onPress: () => fpl.activateMissedApproach() },
    ];
    this.grid(r, horizontal ? 3 : 2, horizontal ? 2 : 3, cells, 10);
  }
}

export class ProcSelectPage extends GtcPage {
  override dialog = true;
  airport = '';
  proc = '';
  transition = '';
  runway = '';
  private prevPane: { id: PaneId; content: PaneContent } | null = null;
  private readonly bar: BarButton[];

  constructor(gtc: GtcController, readonly kind: ProcKind) {
    super(gtc);
    const p = this.sys.fpl?.plan;
    this.airport = (kind === 'departure' ? p?.origin?.icao : p?.destination?.icao) ?? '';
    const sel = kind === 'departure' ? p?.sid : kind === 'arrival' ? p?.star : p?.approach;
    if (sel) {
      this.proc = sel.ident;
      this.transition = (kind === 'departure' ? sel.enrouteTransition : kind === 'arrival' ? sel.enrouteTransition : sel.enrouteTransition) ?? '';
    }
    this.runway = (kind === 'departure' ? p?.departureRunway : p?.arrivalRunway) ?? '';
    this.bar = [{ label: 'Load', icon: 'enter', press: () => this.load('load'), disabled: () => !this.proc }];
  }

  get title(): string {
    return this.kind === 'departure' ? 'Departure Selection' : this.kind === 'arrival' ? 'Arrival Selection' : 'Approach Selection';
  }

  private procList(): Procedure[] {
    const fpl = this.sys.fpl;
    if (!fpl || !this.airport) return [];
    const procs = fpl.procedures(this.airport);
    if (!procs) return [];
    return this.kind === 'departure' ? procs.sids : this.kind === 'arrival' ? procs.stars : procs.approaches;
  }

  private selected(): Procedure | undefined {
    return this.procList().find((p) => p.ident === this.proc);
  }

  override onOpen(): void {
    // Preview on the controlled pane (PG §5.8 "the selected procedure is shown on the display pane").
    const sys = this.sys;
    const p = sys.gtcPane(this.gtc.g);
    if (p && !this.prevPane) {
      this.prevPane = { id: p, content: sys.paneContent(p) };
      sys.setPaneContent(p, PANE_CONTENT.procedure);
    }
    this.updatePreview();
  }

  override onClose(): void {
    const sys = this.sys;
    if (this.prevPane) sys.setPaneContent(this.prevPane.id, this.prevPane.content);
    this.prevPane = null;
    sys.ui.procPreview = null;
  }

  private updatePreview(): void {
    this.sys.ui.procPreview = this.proc ? { airport: this.airport, kind: this.kind, ident: this.selected()?.name ?? this.proc, transition: this.transition || undefined } : null;
  }

  protected build(r: Rect): void {
    const gtc = this.gtc;
    const fpl = this.sys.fpl;
    if (!fpl) return;
    const k = this.kind;
    const items = (list: string[]): ListItem[] => list.map((x) => ({ label: x }));
    const cells: ButtonOptions[] = [
      {
        label: 'Airport',
        value: () => this.airport || 'Select',
        onPress: () =>
          enterWaypoint(
            gtc,
            'Airport',
            (w) => {
              this.airport = w.ident;
              this.proc = '';
              this.transition = '';
              this.updatePreview();
            },
            true,
          ),
      },
      {
        label: k === 'departure' ? 'Departure' : k === 'arrival' ? 'Arrival' : 'Approach',
        value: () => (this.proc ? (this.selected()?.name ?? this.proc) : this.airport && !fpl.procedures(this.airport) ? 'Loading...' : 'Select'),
        disabled: () => !this.airport,
        onPress: () =>
          gtc.push(
            new ListSelectPage(gtc, 'Select Procedure', () => this.procList().map((p) => ({ label: p.name, sub: p.ident, value: p.runways.join(' ') })), (_i, it) => {
              this.proc = it.sub!;
              this.transition = '';
              this.runway = k === 'approach' ? '' : this.runway;
              this.updatePreview();
              gtc.back();
            }, 'No procedures'),
          ),
      },
      {
        label: 'Transition',
        value: () => this.transition || (k === 'approach' ? 'Vectors' : 'None'),
        disabled: () => !this.selected(),
        onPress: () => {
          const p = this.selected();
          if (!p) return;
          const names = [k === 'approach' ? 'Vectors' : 'None', ...p.transitions.map((t) => t.name)];
          gtc.push(new ListSelectPage(gtc, 'Select Transition', () => items(names), (i, it) => {
            this.transition = i === 0 ? '' : it.label;
            this.updatePreview();
            gtc.back();
          }));
        },
      },
    ];
    if (k !== 'approach')
      cells.push({
        label: 'Runway',
        value: () => (this.runway ? join2('RW', this.runway) : 'Select'),
        disabled: () => !this.selected(),
        onPress: () => {
          const p = this.selected();
          if (!p) return;
          const names = p.runwayTransitions.map((t) => t.name).filter((n) => n !== 'ALL');
          const list = names.length ? names : p.runways;
          gtc.push(new ListSelectPage(gtc, 'Select Runway', () => list.map((n) => ({ label: join2('RW', n), value: n })), (_i, it) => {
            this.runway = it.value!;
            gtc.back();
          }, 'All runways'));
        },
      });
    cells.push({ label: 'Load', icon: 'enter', disabled: () => !this.proc, onPress: () => this.load('load') });
    if (k === 'approach') {
      cells.push({ label: 'Load and Activate', disabled: () => !this.proc, onPress: () => this.load('activate') });
      cells.push({ label: 'Activate Vectors to Final', disabled: () => !this.proc, onPress: () => this.load('vtf') });
    }
    const horizontal = r.w > r.h * 1.3;
    this.grid(r, 2, horizontal ? 3 : 4, cells, 10);
  }

  load(mode: 'load' | 'activate' | 'vtf'): void {
    const fpl = this.sys.fpl;
    if (!fpl || !this.proc) return;
    let ok = false;
    if (this.kind === 'departure') {
      if (fpl.plan.origin?.icao !== this.airport) fpl.setOrigin(this.airport);
      ok = fpl.loadDeparture(this.proc, this.runway || undefined, this.transition || undefined);
    } else if (this.kind === 'arrival') {
      if (fpl.plan.destination?.icao !== this.airport) fpl.setDestination(this.airport);
      ok = fpl.loadArrival(this.proc, this.transition || undefined, this.runway || undefined);
    } else ok = fpl.loadApproach(this.airport, this.proc, this.transition || undefined, mode);
    if (!ok) {
      this.gtc.flash(fpl.lastError || 'Unable to load');
      return;
    }
    this.gtc.back();
  }

  override barButtons(): readonly BarButton[] {
    return this.bar;
  }
}

export class DirectToPage extends GtcPage {
  readonly title = 'Direct To';
  override dialog = true;
  target: Waypoint | null = null;
  legIndex = -1;
  courseMag = NaN;
  private readonly bar: BarButton[];

  constructor(gtc: GtcController, legIndex?: number) {
    super(gtc);
    const fpl = this.sys.fpl;
    if (fpl) {
      const i = legIndex ?? fpl.plan.activeLegIndex;
      const leg = i >= 0 ? fpl.plan.legs[i] : undefined;
      if (leg?.fix) {
        this.legIndex = i;
        this.target = leg.fix;
      }
    }
    this.bar = [{ label: 'Activate', icon: 'enter', press: () => this.activate(), disabled: () => !this.target }];
  }

  activate(): boolean {
    const fpl = this.sys.fpl;
    if (!fpl || !this.target) return false;
    const crs = Number.isFinite(this.courseMag) ? this.courseMag : undefined;
    const ok = this.legIndex >= 0 ? fpl.directTo(this.legIndex, crs) : fpl.directTo(this.target, crs);
    if (!ok) {
      this.gtc.flash(fpl.lastError || 'Direct-To failed');
      return false;
    }
    this.gtc.back();
    return true;
  }

  protected build(r: Rect): void {
    const gtc = this.gtc;
    const fpl = this.sys.fpl;
    if (!fpl) return;
    const top = { x: r.x, y: r.y, w: r.w, h: Math.min(130, r.h * 0.28) };
    this.grid(top, 2, 1, [
      {
        label: 'Waypoint',
        value: () => this.target?.ident ?? '______',
        icon: 'direct',
        onPress: () =>
          enterWaypoint(gtc, 'Direct To', (w) => {
            this.target = w;
            this.legIndex = -1;
            // Prefer the flight plan instance of the waypoint (keeps the plan sequence).
            const i = fpl.plan.legs.findIndex((l) => l.fix?.ident === w.ident && Math.abs(l.fix.lat - w.lat) < 1e-4);
            if (i >= 0) this.legIndex = i;
            this.courseMag = NaN;
          }),
      },
      {
        label: 'Course',
        value: () => (Number.isFinite(this.courseMag) ? fmtDeg(this.courseMag) : 'Direct'),
        disabled: () => !this.target,
        onPress: () =>
          gtc.push(
            new NumericKeypadPage(gtc, {
              title: 'Direct-To Course',
              maxDigits: 3,
              unit: '°',
              onEnter: (b) => {
                const c = Number(b);
                if (!b || !(c >= 1 && c <= 360)) return false;
                this.courseMag = c;
                return true;
              },
            }),
          ),
      },
    ], 10);
    // Flight plan waypoints for quick selection.
    const ly = top.y + top.h + 30;
    this.text(r.x + 12, ly - 14, 'Flight Plan Waypoints', 15, P.white);
    const legs = () => fpl.plan.legs;
    this.list(r.x + 6, ly, r.w - 12, r.y + r.h - ly - 4, {
      count: () => legs().length,
      rowH: 48,
      drawRow: (ctx, i, x, y, w, h) => {
        const l = legs()[i];
        if (!l.fix) return;
        const sel = this.legIndex === i;
        box(ctx, x + 2, y + 3, w - 12, h - 6, GTC_COLORS.button, sel ? GTC_COLORS.selected : GTC_COLORS.buttonEdge, sel ? 2.5 : 1, 4);
        TF.draw(ctx, legIdent(l), x + 16, y + h / 2, 19, i === fpl.plan.activeLegIndex ? P.magenta : P.white, 'left', 'middle');
      },
      onRow: (i) => {
        const l = legs()[i];
        if (!l?.fix) return;
        this.target = l.fix;
        this.legIndex = i;
        this.courseMag = NaN;
        gtc.revision++;
      },
    });
  }

  override barButtons(): readonly BarButton[] {
    return this.bar;
  }
}

registerProcPages(ProcPage, DirectToPage);
registerProcSelect(ProcSelectPage);
