/**
 * Active Flight Plan screen and its dialogs (G3000 PG 190-02046-01 §5.6
 * "Flight Planning"; G5000 CRG 190-02538-02 "Flight Plan"):
 *  - list: origin, procedure headers, waypoints (active leg magenta),
 *    altitude constraints (cyan = crew entered), destination, "Add Enroute
 *    Waypoint"; Add Origin / Add Destination when empty;
 *  - Waypoint Options: Insert Before / After, Load Airway, Activate Leg,
 *    Direct To, Remove, Altitude Constraint, Hold, Waypoint Info;
 *  - Origin / Destination options (runway, departure / arrival / approach,
 *    remove), procedure header options (remove);
 *  - Flight Plan Options: cruise altitude, descent angle, delete plan.
 */
import type { Rect } from '../../../common/draw/context';
import { box, line } from '../../../common/draw/context';
import { fmtInt } from '../../../common/format';
import { wrap360 } from '../../../../core/math';
import type { AltitudeConstraint, Waypoint } from '../../../../nav/types';
import type { FplRow } from '../../state/FplEditor';
import { fmtDeg, fmtDist, join2 } from '../../format';
import { G3K_PALETTE, TF } from '../../gdu/style';
import { PANE_CONTENT } from '../../vars';
import type { GtcController } from '../GtcController';
import { GtcPage, type BarButton, type KnobId } from '../GtcPage';
import { GTC_COLORS, type ButtonOptions, type ListView } from '../ui';
import { AlphaKeypadPage, ListSelectPage, NumericKeypadPage } from './keypads';

const P = G3K_PALETTE;

/**
 * Waypoint identifier entry: alpha keypad, then the duplicates list when the
 * identifier matches several facilities (nearest first, PG §1.3 "Duplicate
 * Waypoints").
 */
export function enterWaypoint(gtc: GtcController, title: string, done: (w: Waypoint) => void, airportsOnly = false): void {
  const sys = gtc.sys;
  const fpl = sys.fpl;
  gtc.push(
    new AlphaKeypadPage(gtc, {
      title,
      maxLen: 7,
      hint: (t) => {
        if (!t || !fpl) return '';
        const a = fpl.airport(t);
        return a ? a.name : '';
      },
      onEnter: (text) => {
        if (!fpl) return false;
        let found: Waypoint[];
        if (airportsOnly) {
          const a = fpl.airport(text);
          found = a ? [{ ident: a.icao, lat: a.lat, lon: a.lon, kind: 'airport' }] : [];
        } else found = fpl.resolve(text);
        if (!found.length) return false;
        if (found.length === 1) {
          gtc.back();
          done(found[0]);
          return true;
        }
        const items = found.map((w) => ({ label: w.ident, sub: `${w.kind.toUpperCase()}  ${w.lat.toFixed(2)} ${w.lon.toFixed(2)}` }));
        gtc.replace(
          new ListSelectPage(gtc, 'Duplicate Waypoints', () => items, (i) => {
            gtc.back();
            done(found[i]);
          }),
        );
        return true;
      },
    }),
  );
}

export class FlightPlanPage extends GtcPage {
  readonly title = 'Active Flight Plan';
  private rows: FplRow[] = [];
  private ver = NaN;
  private listView: ListView | null = null;
  private readonly bar: BarButton[] = [
    { label: 'Up', icon: 'up', press: () => this.scroll(-3) },
    { label: 'Down', icon: 'down', press: () => this.scroll(3) },
  ];

  private refresh(): void {
    const fpl = this.sys.fpl;
    if (!fpl) return;
    const v = fpl.plan.version * 1000 + fpl.plan.activeLegIndex + this.sys.revision * 7;
    if (v === this.ver) return;
    this.ver = v;
    this.rows = fpl.rows();
    const p = fpl.plan;
    // Trailing action rows.
    if (!p.origin) this.rows.unshift({ kind: 'header', text: 'Add Origin', sub: 'action:origin', legIndex: -1, segment: null, active: false, from: false });
    this.rows.push({ kind: 'header', text: 'Add Enroute Waypoint', sub: 'action:enroute', legIndex: -1, segment: null, active: false, from: false });
    if (!p.destination) this.rows.push({ kind: 'header', text: 'Add Destination', sub: 'action:dest', legIndex: -1, segment: null, active: false, from: false });
  }

  override update(_dt: number): void {
    this.refresh();
  }

  private scroll(n: number): void {
    this.listView?.scroll(n);
    this.gtc.revision++;
  }

  protected build(r: Rect): void {
    this.refresh();
    const sys = this.sys;
    const fpl = sys.fpl;
    if (!fpl) {
      this.text(r.x + r.w / 2, r.y + r.h / 2, 'FMS NOT AVAILABLE', 20, P.amber, 'center');
      return;
    }
    const wide = r.w > 700;
    const btnH = 64;
    const listH = r.h - btnH - 12;
    // Column header.
    this.custom(r.x, r.y, r.w, 26, (ctx) => {
      TF.draw(ctx, 'Waypoint', r.x + 16, r.y + 13, 15, P.white, 'left', 'middle');
      TF.draw(ctx, 'DTK', r.x + r.w * (wide ? 0.46 : 0.52), r.y + 13, 15, P.white, 'right', 'middle');
      TF.draw(ctx, 'DIS', r.x + r.w * (wide ? 0.6 : 0.72), r.y + 13, 15, P.white, 'right', 'middle');
      TF.draw(ctx, 'ALT', r.x + r.w - 20, r.y + 13, 15, P.white, 'right', 'middle');
    });
    const rowH = wide ? 60 : 52;
    this.listView = this.list(r.x + 4, r.y + 28, r.w - 8, listH - 28, {
      count: () => this.rows.length,
      rowH,
      anchor: () => this.rows.findIndex((x) => x.active),
      drawRow: (ctx, i, x, y, w, h) => {
        const row = this.rows[i];
        const plan = fpl.plan;
        if (row.kind === 'header') {
          const action = row.sub.startsWith('action:');
          box(ctx, x + 2, y + 3, w - 12, h - 6, action ? GTC_COLORS.button : '#1b2a33', GTC_COLORS.buttonEdge, 1, 4);
          TF.draw(ctx, row.text, x + (action ? w / 2 : 14), y + h / 2, action ? 19 : 16, action ? P.white : P.cyan, action ? 'center' : 'left', 'middle');
          return;
        }
        box(ctx, x + 2, y + 3, w - 12, h - 6, GTC_COLORS.button, row.active ? P.magenta : GTC_COLORS.buttonEdge, row.active ? 2.5 : 1, 4);
        const col = row.active ? P.magenta : row.kind === 'disco' ? P.white : P.white;
        TF.draw(ctx, row.text, x + 16, y + h * 0.4, 21, col, 'left', 'middle');
        if (row.sub && row.kind !== 'disco') TF.draw(ctx, row.sub, x + 16, y + h * 0.75, 13, P.grey, 'left', 'middle');
        if (row.from) line(ctx, x + 6, y + h * 0.5, x + 6, y + h + h * 0.4, P.magenta, 2);
        const leg = row.legIndex >= 0 ? plan.legs[row.legIndex] : undefined;
        if (!leg || row.kind === 'disco') return;
        if (leg.geom.valid && row.legIndex > 0) {
          TF.draw(ctx, fmtDeg(wrap360(leg.geom.finalCourseTrue - (leg.magVar ?? 0))), x + w * (wide ? 0.46 : 0.52), y + h / 2, 18, col, 'right', 'middle');
          TF.draw(ctx, join2(fmtDist(leg.geom.lengthNm), 'NM'), x + w * (wide ? 0.6 : 0.72), y + h / 2, 18, col, 'right', 'middle');
        }
        const a = leg.altitude;
        box(ctx, x + w - 128, y + 8, 110, h - 16, '#1e2226', '#50565c', 1, 3);
        if (a) {
          const ft = a.kind === 'atOrBelow' ? a.upperFt : a.lowerFt;
          if (ft !== undefined) {
            const crew = !!leg.userConstraint;
            const cx = x + w - 73;
            TF.draw(ctx, fmtAlt(ft), cx, y + h / 2, 18, crew ? P.cyan : P.white, 'center', 'middle');
            if (a.kind === 'atOrAbove' || a.kind === 'between') line(ctx, cx - 36, y + h / 2 + 12, cx + 36, y + h / 2 + 12, crew ? P.cyan : P.white, 2);
            if (a.kind === 'atOrBelow' || a.kind === 'between') line(ctx, cx - 36, y + h / 2 - 12, cx + 36, y + h / 2 - 12, crew ? P.cyan : P.white, 2);
            if (a.kind === 'at') {
              line(ctx, cx - 36, y + h / 2 + 12, cx + 36, y + h / 2 + 12, crew ? P.cyan : P.white, 2);
              line(ctx, cx - 36, y + h / 2 - 12, cx + 36, y + h / 2 - 12, crew ? P.cyan : P.white, 2);
            }
          }
        } else TF.draw(ctx, '_____FT', x + w - 73, y + h / 2, 16, P.white, 'center', 'middle');
      },
      onRow: (i, px) => this.onRow(i, px, r),
    });
    const b = { x: r.x, y: r.y + r.h - btnH - 6, w: r.w, h: btnH + 6 };
    this.grid(b, 3, 1, [
      { label: 'Flight Plan Options', size: 16, onPress: () => this.gtc.push(new FplOptionsPage(this.gtc)) },
      { label: 'PROC', size: 18, onPress: () => this.gtc.push(new (procPageCtor!)(this.gtc)) },
      { label: 'Direct To', size: 18, onPress: () => this.gtc.push(new (directToCtor!)(this.gtc)) },
    ], 6);
  }

  private onRow(i: number, px: number, r: Rect): void {
    const row = this.rows[i];
    const gtc = this.gtc;
    const fpl = this.sys.fpl!;
    if (!row) return;
    if (row.sub === 'action:origin') enterWaypoint(gtc, 'Origin', (w) => fpl.setOrigin(w.ident), true);
    else if (row.sub === 'action:dest') enterWaypoint(gtc, 'Destination', (w) => fpl.setDestination(w.ident), true);
    else if (row.sub === 'action:enroute') enterWaypoint(gtc, 'Add Enroute Waypoint', (w) => fpl.appendEnroute(w));
    else if (row.kind === 'origin') gtc.push(new AirportOptionsPage(gtc, 'origin'));
    else if (row.kind === 'destination') gtc.push(new AirportOptionsPage(gtc, 'destination'));
    else if (row.kind === 'header' && row.segment) gtc.push(new SegmentOptionsPage(gtc, row.segment));
    else if (row.kind === 'disco') {
      fpl.deleteLeg(row.legIndex);
    } else if (row.kind === 'leg') {
      if (px > r.x + r.w - 140) gtc.push(altitudeConstraintPage(gtc, row.legIndex));
      else gtc.push(new WaypointOptionsPage(gtc, row.legIndex));
    }
    gtc.revision++;
  }

  override barButtons(): readonly BarButton[] {
    return this.bar;
  }

  override onKnob(k: KnobId, clicks: number): boolean {
    if (k === 'upperInner' || k === 'upperOuter') {
      this.scroll(Math.sign(clicks) * (k === 'upperOuter' ? 3 : 1));
      return true;
    }
    return false;
  }

  override knobLabel(slot: 'upper' | 'lower' | 'center'): string | null {
    return slot === 'upper' ? 'Scroll' : null;
  }
}

/** Altitude formatting for constraints ('FL240' above 18,000 ft, EST US transition level). */
export function fmtAlt(ft: number): string {
  if (ft >= 18000) return join2('FL', fmtInt(Math.round(ft / 100)));
  return join2(fmtInt(Math.round(ft)), 'FT');
}

// Set by proc.ts (avoids an import cycle).
export let procPageCtor: (new (gtc: GtcController) => GtcPage) | null = null;
export let directToCtor: (new (gtc: GtcController, legIndex?: number) => GtcPage) | null = null;
export function registerProcPages(proc: new (gtc: GtcController) => GtcPage, dto: new (gtc: GtcController, legIndex?: number) => GtcPage): void {
  procPageCtor = proc;
  directToCtor = dto;
}

export class WaypointOptionsPage extends GtcPage {
  override dialog = true;
  constructor(gtc: GtcController, readonly legIndex: number) {
    super(gtc);
  }
  get title(): string {
    const leg = this.sys.fpl?.plan.legs[this.legIndex];
    return leg?.fix?.ident ? join2(leg.fix.ident, ' Options') : 'Waypoint Options';
  }
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const sys = this.sys;
    const fpl = sys.fpl!;
    const i = this.legIndex;
    const leg = () => fpl.plan.legs[i];
    const horizontal = r.w > r.h * 1.3;
    const cells: ButtonOptions[] = [
      { label: 'Insert Before', onPress: () => enterWaypoint(gtc, 'Insert Before', (w) => (fpl.insertWaypoint(i, w), gtc.back())) },
      { label: 'Insert After', onPress: () => enterWaypoint(gtc, 'Insert After', (w) => (fpl.insertWaypoint(i, w, true), gtc.back())) },
      { label: 'Load Airway', disabled: () => !leg()?.fix || fpl.airwaysAt(leg()!.fix!.ident).length === 0, onPress: () => this.loadAirway() },
      { label: 'Activate Leg To', disabled: () => i <= 0 || fpl.plan.activeLegIndex === i, onPress: () => (fpl.activateLeg(i), gtc.back()) },
      { label: 'Direct To', icon: 'direct', onPress: () => gtc.replace(new (directToCtor!)(gtc, i)) },
      { label: 'Remove', onPress: () => (fpl.deleteLeg(i), gtc.back()) },
      { label: 'Altitude Constraint', onPress: () => gtc.replace(altitudeConstraintPage(gtc, i)) },
      { label: 'Hold', disabled: () => !leg()?.fix, onPress: () => (fpl.holdAt(i), gtc.back()) },
      {
        label: 'Waypoint Info',
        disabled: () => !leg()?.fix,
        onPress: () => {
          sys.ui.wptInfoIdent = leg()?.fix?.ident ?? '';
          const p = sys.gtcPane(gtc.g);
          if (p) sys.setPaneContent(p, PANE_CONTENT.waypointInfo);
          gtc.back();
        },
      },
    ];
    this.grid(r, horizontal ? 3 : 2, horizontal ? 3 : 5, cells, 10);
  }
  private loadAirway(): void {
    const gtc = this.gtc;
    const fpl = this.sys.fpl!;
    const leg = fpl.plan.legs[this.legIndex];
    if (!leg?.fix) return;
    const entry = leg.fix;
    const airways = fpl.airwaysAt(entry.ident);
    gtc.replace(
      new ListSelectPage(gtc, join2('Airways at ', entry.ident), () => airways.map((a) => ({ label: a })), (_i, it) => {
        const exits = fpl.airwayExits(it.label, entry);
        gtc.replace(
          new ListSelectPage(gtc, join2(it.label, ' Exit'), () => exits.map((e) => ({ label: e })), (_k, ex) => {
            if (!fpl.loadAirway(this.legIndex, it.label, ex.label)) gtc.flash(fpl.lastError || 'Airway error');
            gtc.back();
          }),
        );
      }),
    );
  }
}

/** Altitude constraint keypad with AT / AT or ABOVE / AT or BELOW / Remove. */
export function altitudeConstraintPage(gtc: GtcController, legIndex: number): NumericKeypadPage {
  const fpl = gtc.sys.fpl!;
  let kind: AltitudeConstraint['kind'] = 'at';
  const cur = fpl.plan.legs[legIndex]?.altitude;
  if (cur) kind = cur.kind;
  const sel = (k: AltitudeConstraint['kind'], label: string): ButtonOptions => ({ label, selected: () => kind === k, onPress: () => (kind = k) });
  return new NumericKeypadPage(gtc, {
    title: 'Altitude Constraint',
    initial: () => {
      const a = fpl.plan.legs[legIndex]?.altitude;
      const ft = a ? (a.kind === 'atOrBelow' ? a.upperFt : a.lowerFt) : undefined;
      return ft !== undefined ? fmtAlt(ft) : '_____FT';
    },
    maxDigits: 5,
    unit: 'FT',
    onEnter: (b) => {
      const ft = Number(b);
      if (!b || !Number.isFinite(ft) || ft < 0 || ft > 60000) return false;
      // Entries below 1000 with 3 digits are flight levels (Garmin: "FL" entry). EST convention.
      const alt = b.length <= 3 && ft >= 180 ? ft * 100 : ft;
      return fpl.setAltitudeConstraint(legIndex, kind, alt, alt);
    },
    extra: [sel('at', 'AT'), sel('atOrAbove', 'AT or ABOVE'), sel('atOrBelow', 'AT or BELOW'), { label: 'Remove', onPress: () => (fpl.setAltitudeConstraint(legIndex, null), gtc.back()) }],
  });
}

/** Origin / Destination options. */
export class AirportOptionsPage extends GtcPage {
  override dialog = true;
  constructor(gtc: GtcController, readonly which: 'origin' | 'destination') {
    super(gtc);
  }
  get title(): string {
    const p = this.sys.fpl?.plan;
    const a = this.which === 'origin' ? p?.origin : p?.destination;
    return a ? join2(a.icao, this.which === 'origin' ? ' - Origin' : ' - Destination') : this.which === 'origin' ? 'Origin' : 'Destination';
  }
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const fpl = this.sys.fpl!;
    const origin = this.which === 'origin';
    const apt = () => (origin ? fpl.plan.origin : fpl.plan.destination);
    const rwy = () => (origin ? fpl.plan.departureRunway : fpl.plan.arrivalRunway) ?? '';
    const cells: (ButtonOptions | null)[] = [
      {
        label: origin ? 'Departure Runway' : 'Arrival Runway',
        value: () => (rwy() ? join2('RW', rwy()) : 'Select'),
        onPress: () => {
          const a = apt();
          if (!a) return;
          const rws = a.runways.map((x) => ({ label: join2('RW', x.ident), sub: `${fmtInt(x.lengthFt)} FT`, value: x.ident }));
          gtc.push(new ListSelectPage(gtc, 'Select Runway', () => rws, (_i, it) => {
            if (origin) fpl.setDepartureRunway(it.value!);
            else fpl.setArrivalRunway(it.value!);
            gtc.back();
          }));
        },
      },
      origin
        ? { label: 'Select Departure', icon: 'proc', onPress: () => gtc.push(new (procSelectCtor!)(gtc, 'departure')) }
        : { label: 'Select Arrival', icon: 'proc', onPress: () => gtc.push(new (procSelectCtor!)(gtc, 'arrival')) },
      origin ? null : { label: 'Select Approach', icon: 'proc', onPress: () => gtc.push(new (procSelectCtor!)(gtc, 'approach')) },
      { label: origin ? 'Change Origin' : 'Change Destination', onPress: () => enterWaypoint(gtc, origin ? 'Origin' : 'Destination', (w) => (origin ? fpl.setOrigin(w.ident) : fpl.setDestination(w.ident)), true) },
      { label: origin ? 'Remove Origin' : 'Remove Destination', onPress: () => (origin ? fpl.removeOrigin() : fpl.removeDestination(), gtc.back()) },
      {
        label: 'Airport Info',
        onPress: () => {
          const a = apt();
          if (!a) return;
          this.sys.ui.wptInfoIdent = a.icao;
          const p = this.sys.gtcPane(gtc.g);
          if (p) this.sys.setPaneContent(p, PANE_CONTENT.waypointInfo);
        },
      },
    ];
    const horizontal = r.w > r.h * 1.3;
    this.grid(r, horizontal ? 3 : 2, horizontal ? 2 : 3, cells.filter((c) => c !== null), 10);
  }
}

export let procSelectCtor: (new (gtc: GtcController, kind: 'departure' | 'arrival' | 'approach') => GtcPage) | null = null;
export function registerProcSelect(c: new (gtc: GtcController, kind: 'departure' | 'arrival' | 'approach') => GtcPage): void {
  procSelectCtor = c;
}

/** Procedure header options (remove the procedure). */
export class SegmentOptionsPage extends GtcPage {
  override dialog = true;
  readonly title: string;
  constructor(gtc: GtcController, readonly seg: string) {
    super(gtc);
    this.title = seg === 'departure' ? 'Departure Options' : seg === 'arrival' ? 'Arrival Options' : seg === 'approach' || seg === 'missed' ? 'Approach Options' : 'Enroute Options';
  }
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const fpl = this.sys.fpl!;
    const cells: ButtonOptions[] = [];
    if (this.seg === 'departure') cells.push({ label: 'Remove Departure', onPress: () => (fpl.removeDeparture(), gtc.back()) }, { label: 'Select Departure', onPress: () => gtc.replace(new (procSelectCtor!)(gtc, 'departure')) });
    else if (this.seg === 'arrival') cells.push({ label: 'Remove Arrival', onPress: () => (fpl.removeArrival(), gtc.back()) }, { label: 'Select Arrival', onPress: () => gtc.replace(new (procSelectCtor!)(gtc, 'arrival')) });
    else if (this.seg === 'approach' || this.seg === 'missed')
      cells.push(
        { label: 'Remove Approach', onPress: () => (fpl.removeApproach(), gtc.back()) },
        { label: 'Activate Approach', onPress: () => (fpl.activateApproach(), gtc.back()) },
        { label: 'Activate Vectors to Final', onPress: () => (fpl.activateVtf(), gtc.back()) },
        { label: 'Activate Missed Approach', onPress: () => (fpl.activateMissedApproach(), gtc.back()) },
      );
    else cells.push({ label: 'Add Enroute Waypoint', onPress: () => enterWaypoint(gtc, 'Add Enroute Waypoint', (w) => fpl.appendEnroute(w)) });
    this.grid({ x: r.x, y: r.y, w: r.w, h: Math.min(r.h, 110 * Math.ceil(cells.length / 2)) }, 2, Math.ceil(cells.length / 2), cells, 10);
  }
}

/** Flight Plan Options: cruise altitude, descent angle (VNAV), delete flight plan. */
export class FplOptionsPage extends GtcPage {
  readonly title = 'Flight Plan Options';
  override dialog = true;
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const fpl = this.sys.fpl!;
    const cells: ButtonOptions[] = [
      {
        label: 'Cruise Altitude',
        value: () => (fpl.plan.cruiseAltFt > 0 ? fmtAlt(fpl.plan.cruiseAltFt) : '_____FT'),
        onPress: () =>
          gtc.push(
            new NumericKeypadPage(gtc, {
              title: 'Cruise Altitude',
              maxDigits: 5,
              unit: 'FT',
              onEnter: (b) => {
                const ft = Number(b);
                if (!b || !Number.isFinite(ft)) return false;
                const alt = b.length <= 3 && ft >= 180 ? ft * 100 : ft;
                if (alt < 1000 || alt > this.sys.cfg.afcs.maxSelAltFt) return false;
                fpl.setCruiseAltitude(alt);
                return true;
              },
            }),
          ),
      },
      {
        label: 'Descent Angle',
        value: () => join2(fpl.plan.descentFpaDeg.toFixed(1), '°'),
        onPress: () =>
          gtc.push(
            new NumericKeypadPage(gtc, {
              title: 'VNAV Descent Angle',
              maxDigits: 2,
              decimal: true,
              unit: '°',
              onEnter: (b) => {
                const d = Number(b);
                if (!(d >= 1 && d <= 6)) return false;
                fpl.setDescentAngle(d);
                return true;
              },
            }),
          ),
      },
      { label: 'Delete Flight Plan', onPress: () => (fpl.deletePlan(), gtc.back()) },
      { label: 'Activate Approach', disabled: () => !fpl.plan.approachProcedure, onPress: () => (fpl.activateApproach(), gtc.back()) },
    ];
    const horizontal = r.w > r.h * 1.3;
    this.grid({ x: r.x, y: r.y, w: r.w, h: Math.min(r.h, horizontal ? 260 : 330) }, 2, 2, cells, 10);
  }
}
