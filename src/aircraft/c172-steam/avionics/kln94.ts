/**
 * Bendix/King KLN 94 IFR GPS (POH 172SPHUS Supplement 19; KLN 94 Pilot's Guide
 * 006-18207-0000 ORS 01-03, chapters 3-6).
 *
 * Front panel (Pilot's Guide Figure 3-1): On/Off/Brightness knob (push ON), right outer knob
 * (page type / cursor move), right inner knob (page number / character, pull = SCAN), MSG,
 * OBS, ALT, NRST, D-> (direct to), CLR, ENT, CRSR, RNG, MNU and PROC buttons.
 *
 * Modelled behaviour:
 *  - Turn-on (Pilot's Guide 3.2): Power-On page (ORS 03), Self Test page (baro field, Pass, OK?
 *    -> ENT), Initialization page (OK? -> ENT), Database page (Acknowledge? -> ENT), then NAV 1.
 *    The receiver (nav/Radios GpsReceiver) acquires while the pages are shown; NAV ready
 *    once it has a fix.
 *  - Page types on the page bar (3.4.1): APT VOR NDB INT USR ACT NAV FPL SET AUX, selected with
 *    the right outer knob, page numbers with the inner knob. Implemented pages: APT 1 (airport
 *    identification), NAV 1 (from/to, CDI, DIS, GS, ETE, BRG), NAV 2 (present position), NAV 4
 *    (moving map, RNG in/out), FPL 0 (active flight plan), SET 1 (initialization), AUX 1
 *    (status). Other page slots show their title (SCOPE).
 *  - Cursor (CRSR) data entry on APT 1, D->, FPL 0: outer knob moves the cursor, inner knob
 *    selects characters; the database fills the remaining characters (3.4.2).
 *  - D-> (3.9): waypoint page with the ident under the cursor; ENT confirms, ENT again goes
 *    direct from present position (shared FMS directTo).
 *  - NRST (3.11): nearest airports list; the inner knob moves the selection, D-> goes direct.
 *  - MSG: message page; the 'M' prompt flashes on a new message (3.5).
 *  - OBS (5.5): toggles LEG / OBS; in OBS mode the course to the active waypoint (a course-to-fix
 *    leg in the FMS) comes from the #1 CDI OBS while the NAV/GPS switch is in GPS, and is set
 *    digitally on the KLN 94 while it is in NAV (Supplement 19 Fig 2 item 4): on a NAV page with the
 *    cursor on (CRSR), the right inner knob changes the course 1 deg and the outer knob 10 deg per
 *    click (EST: the pilot's guide selects the OBS course with the cursor and the right knobs).
 *  - ALT (6): altitude page with the baro setting (inner knob).
 *  - PROC (6.2): approach selection for the destination; ENT loads it into the flight plan.
 *    Approach ARM within 30 nm of the destination with an approach loaded, ACTV from 2 nm
 *    before the final approach fix (Supplement 19 Fig 1 items 4-5).
 *  - CDI scaling (3.2 NOTE / Supplement 19): 5 nm full scale in LEG en route, 1 nm when the
 *    approach is armed, 0.3 nm when active.
 *
 * Outputs: gps.powered (GPS receiver), the CDI source values used by the NAV/GPS mux
 * (`ac.kln94.cdi`, `.to_from`, `.cdi_valid`, `.dtk_deg`), KLN.* annunciations.
 * SCOPE: user waypoints, VOR/NDB/INT pages, fuel/air data AUX pages, SID/STAR loading, VNAV,
 * the data-card update and the take-home mode are not modelled; the map shows the route,
 * the active leg and nearby airports only.
 */
import type { Subsystem } from '../../types';
import type { SimContext } from '../../../core/SimContext';
import type { Airport, NavDatabase, Procedure, Waypoint } from '../../../nav/types';
import type { Fms } from '../../../nav/fms/Fms';
import { FMS, GPS } from '../../../core/vars';
import { clamp, wrap360 } from '../../../core/math';
import { distanceNm, initialBearing } from '../../../core/geo';
import { EV, KLN, KLN_KEYS, type KlnKey } from '../vars';
import { onEncoder, onEvent, wrapInt } from './util';

export const KLN_PAGE_TYPES = ['APT', 'VOR', 'NDB', 'INT', 'USR', 'ACT', 'NAV', 'FPL', 'SET', 'AUX'] as const;
/** Page numbers available per type (Pilot's Guide 3.4.1 table). */
const PAGE_COUNT = [8, 2, 1, 2, 4, 1, 4, 26, 14, 14];
/** Map ranges (nm), RNG button steps. */
export const KLN_RANGES = [1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 60, 80, 120, 160, 240, 320, 480, 1000];
const CHARS = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Power-On page duration (s): Pilot's Guide section 1 step 2 "For about 50 seconds". */
export const KLN_POWER_ON_S = 50;

export type KlnScreen = 'off' | 'poweron' | 'selftest' | 'init' | 'database' | 'pages' | 'dto' | 'nrst' | 'msg' | 'alt' | 'proc';

export interface KlnMessage {
  text: string;
  read: boolean;
}

export class Kln94Logic implements Subsystem {
  readonly name = 'kln94';
  on = false;
  screen: KlnScreen = 'off';
  private screenT = 0;
  typeIndex = 6; // NAV
  readonly pageNum: number[] = [1, 1, 1, 1, 0, 1, 1, 0, 1, 1];
  cursor = false;
  /** Ident being edited (D->, APT 1, FPL insert) and the character position under the cursor. */
  entry = '';
  entryPos = 0;
  /** Waypoint shown for confirmation (D-> second step) or on APT 1. */
  wpt: Waypoint | null = null;
  apt: Airport | null = null;
  dtoConfirm = false;
  nearest: Airport[] = [];
  nrstIndex = 0;
  readonly messages: KlnMessage[] = [];
  msgIndex = 0;
  obsMode = false;
  apr = 0;
  rangeIndex = 5;
  baroInHg = 29.92;
  approaches: Procedure[] = [];
  procIndex = 0;
  procLoading = false;
  /** FPL 0 cursor row (index into the plan legs, or legs.length = insert at the end). */
  fplRow = 0;
  navReady = false;
  /** CDI output for the NAV/GPS mux (+ = fly right), TO/FROM, validity, desired track (mag). */
  cdi = 0;
  toFrom = 0;
  cdiValid = false;
  private lastObs = NaN;
  private raimMsg = false;
  private readonly offs: (() => void)[] = [];
  private readonly v: SimContext['vars'];

  constructor(
    ctx: Pick<SimContext, 'vars' | 'events'>,
    private readonly db: NavDatabase,
    readonly fms: Fms,
    private readonly powerVar: string,
    /** Course set on the #1 CDI OBS (OBS mode input). */
    private readonly obsVar: string,
  ) {
    this.v = ctx.vars;
    for (const k of KLN_KEYS) onEvent(ctx.events, EV.klnKey(k), () => this.key(k), this.offs);
    onEncoder(ctx.events, EV.klnOuter, (s) => this.outer(s), this.offs);
    onEncoder(ctx.events, EV.klnInner, (s) => this.inner(s), this.offs);
  }

  get pageType(): (typeof KLN_PAGE_TYPES)[number] {
    return KLN_PAGE_TYPES[this.typeIndex];
  }

  private get dbReady(): boolean {
    return !!this.db && (this.db as { ready?: boolean }).ready === true;
  }

  private pos(): { lat: number; lon: number } {
    return { lat: this.v.get(GPS.lat), lon: this.v.get(GPS.lon) };
  }

  addMessage(text: string): void {
    if (this.messages.some((m) => m.text === text)) return;
    this.messages.unshift({ text, read: false });
    if (this.messages.length > 8) this.messages.length = 8;
  }
  removeMessage(text: string): void {
    const i = this.messages.findIndex((m) => m.text === text);
    if (i >= 0) this.messages.splice(i, 1);
  }

  // ------------------------------------------------------------------ controls
  private key(k: KlnKey): void {
    if (!this.on) return;
    switch (this.screen) {
      case 'selftest':
      case 'init':
      case 'database':
        if (k === 'ent') this.advanceStartup();
        return;
      case 'poweron':
        return;
    }
    switch (k) {
      case 'msg':
        if (this.screen === 'msg') {
          this.screen = 'pages';
          for (const m of this.messages) m.read = true;
        } else if (this.messages.length) {
          this.screen = 'msg';
          this.msgIndex = 0;
        }
        return;
      case 'obs':
        this.obsMode = !this.obsMode;
        this.lastObs = NaN;
        if (!this.obsMode) this.reLeg();
        return;
      case 'alt':
        this.screen = this.screen === 'alt' ? 'pages' : 'alt';
        return;
      case 'nrst':
        if (this.screen === 'nrst') {
          this.screen = 'pages';
          return;
        }
        this.nearest = this.dbReady ? this.db.airportsNear(this.pos().lat, this.pos().lon, 100, 9) : [];
        this.nrstIndex = 0;
        this.screen = 'nrst';
        return;
      case 'dto': {
        let ident = '';
        if (this.screen === 'nrst' && this.nearest[this.nrstIndex]) ident = this.nearest[this.nrstIndex].icao;
        else if (this.pageType === 'APT' && this.apt) ident = this.apt.icao;
        else ident = this.v.getString(FMS.nextWptIdent);
        this.screen = 'dto';
        this.entry = ident.replace(/[^A-Z0-9]/g, '');
        this.entryPos = 0;
        this.cursor = true;
        this.dtoConfirm = false;
        this.wpt = null;
        return;
      }
      case 'clr':
        if (this.screen === 'dto' || this.screen === 'nrst' || this.screen === 'alt' || this.screen === 'proc' || this.screen === 'msg') {
          this.screen = 'pages';
          this.cursor = false;
          return;
        }
        if (this.cursor && this.pageType === 'FPL' && this.fplRow < this.fms.plans.active.legs.length) {
          const row = this.fplRow;
          this.fms.plans.apply((p) => p.deleteLeg(row));
          return;
        }
        if (this.cursor) this.entry = '';
        return;
      case 'ent':
        this.enter();
        return;
      case 'crsr':
        if (this.screen !== 'pages') return;
        this.cursor = !this.cursor;
        if (this.cursor) {
          this.entryPos = 0;
          if (this.pageType === 'APT') this.entry = this.apt?.icao ?? 'K';
          if (this.pageType === 'FPL') {
            this.fplRow = this.fms.plans.active.legs.length;
            this.entry = '';
          }
        }
        return;
      case 'rng_up':
        this.rangeIndex = Math.min(KLN_RANGES.length - 1, this.rangeIndex + 1);
        this.goMap();
        return;
      case 'rng_dn':
        this.rangeIndex = Math.max(0, this.rangeIndex - 1);
        this.goMap();
        return;
      case 'mnu':
        this.goMap();
        return;
      case 'proc':
        this.openProc();
        return;
    }
  }

  private goMap(): void {
    if (this.screen !== 'pages') return;
    this.typeIndex = 6;
    this.pageNum[6] = 4;
    this.cursor = false;
  }

  private openProc(): void {
    this.screen = 'proc';
    this.approaches = [];
    this.procIndex = 0;
    const dest = this.fms.plans.active.destination;
    const load = this.db.loadProcedures;
    if (!dest || !this.dbReady || !load) return;
    this.procLoading = true;
    void load.call(this.db, dest.icao).then((p) => {
      this.procLoading = false;
      this.approaches = p?.approaches ?? [];
    });
  }

  private advanceStartup(): void {
    if (this.screen === 'selftest') this.screen = 'init';
    else if (this.screen === 'init') this.screen = 'database';
    else if (this.screen === 'database') {
      this.screen = 'pages';
      this.typeIndex = 6;
      this.pageNum[6] = 1;
    }
    this.screenT = 0;
  }

  private enter(): void {
    if (this.screen === 'dto') {
      if (!this.dtoConfirm) {
        const w = this.resolve(this.entry);
        if (!w) return;
        this.wpt = w;
        this.dtoConfirm = true;
        return;
      }
      if (this.wpt && this.navReady) {
        this.fms.directTo(this.wpt);
        this.obsMode = false;
      }
      this.screen = 'pages';
      this.typeIndex = 6;
      this.pageNum[6] = 1;
      this.cursor = false;
      this.dtoConfirm = false;
      return;
    }
    if (this.screen === 'proc') {
      const ap = this.approaches[this.procIndex];
      if (ap) this.fms.plans.apply((p) => p.setApproach(ap));
      this.screen = 'pages';
      this.typeIndex = 7;
      this.pageNum[7] = 0;
      return;
    }
    if (this.screen === 'pages' && this.cursor && this.pageType === 'FPL') {
      const w = this.resolve(this.entry);
      if (!w) return;
      const plan = this.fms.plans.active;
      const at = this.fplRow;
      const originApt = !plan.origin && at === 0 && w.kind === 'airport' ? this.db.airport(w.airport ?? w.ident) : undefined;
      if (originApt) this.fms.plans.apply((p) => p.setOrigin(originApt));
      else this.fms.plans.apply((p) => (at >= p.legs.length ? p.appendEnrouteWaypoint(w) : p.insertWaypoint(at, w)));
      this.fplRow = this.fms.plans.active.legs.length;
      this.entry = '';
      return;
    }
    if (this.screen === 'pages' && this.cursor && this.pageType === 'APT') {
      this.cursor = false;
    }
  }

  private resolve(ident: string): Waypoint | null {
    const id = ident.trim();
    if (!id || !this.dbReady) return null;
    const p = this.pos();
    const r = this.db.resolve(id, p.lat, p.lon);
    return r.length ? r[0] : null;
  }

  /** Digital OBS course entry (OBS mode, NAV/GPS switch in NAV): `deg` per click. Returns true when handled. */
  private digitalObs(steps: number, deg: number): boolean {
    if (!this.obsMode || this.v.get(KLN.obsAnalog) > 0.5 || this.screen !== 'pages' || !this.cursor || this.pageType !== 'NAV') return false;
    const crs = Math.round(this.v.get(this.obsVar));
    this.v.set(this.obsVar, wrap360(crs + steps * deg));
    return true;
  }

  private outer(steps: number): void {
    if (!this.on) return;
    if (this.digitalObs(steps, 10)) return;
    if (this.screen === 'alt') {
      this.baroInHg = clamp(Math.round((this.baroInHg + steps * 0.1) * 100) / 100, 28.1, 31.0);
      return;
    }
    if (this.screen === 'nrst') {
      this.nrstIndex = clamp(this.nrstIndex + steps, 0, Math.max(0, this.nearest.length - 1));
      return;
    }
    if (this.screen === 'proc') {
      this.procIndex = clamp(this.procIndex + steps, 0, Math.max(0, this.approaches.length - 1));
      return;
    }
    if (this.screen === 'msg') {
      this.msgIndex = clamp(this.msgIndex + steps, 0, Math.max(0, this.messages.length - 1));
      return;
    }
    if (this.cursor || this.screen === 'dto') {
      if (this.pageType === 'FPL' && this.screen === 'pages' && this.entry === '') {
        this.fplRow = clamp(this.fplRow + steps, 0, this.fms.plans.active.legs.length);
        return;
      }
      this.entryPos = clamp(this.entryPos + steps, 0, 4);
      return;
    }
    if (this.screen !== 'pages') return;
    this.typeIndex = wrapInt(this.typeIndex + steps, 0, KLN_PAGE_TYPES.length - 1);
  }

  private inner(steps: number): void {
    if (!this.on) return;
    if (this.digitalObs(steps, 1)) return;
    if (this.screen === 'alt') {
      this.baroInHg = clamp(Math.round((this.baroInHg + steps * 0.01) * 100) / 100, 28.1, 31.0);
      return;
    }
    if (this.screen === 'nrst') {
      this.nrstIndex = clamp(this.nrstIndex + steps, 0, Math.max(0, this.nearest.length - 1));
      return;
    }
    if (this.screen === 'proc') {
      this.procIndex = clamp(this.procIndex + steps, 0, Math.max(0, this.approaches.length - 1));
      return;
    }
    if (this.cursor || this.screen === 'dto') {
      // Character entry: the database completes the identifier (3.4.2 step 6).
      const chars = this.entry.padEnd(this.entryPos + 1, ' ').split('');
      const c = CHARS.indexOf(chars[this.entryPos] ?? ' ');
      chars[this.entryPos] = CHARS[wrapInt((c < 0 ? 0 : c) + steps, 0, CHARS.length - 1)];
      const typed = chars.slice(0, this.entryPos + 1).join('').trimEnd();
      this.entry = this.complete(typed);
      this.dtoConfirm = false;
      if (this.pageType === 'APT' && this.screen === 'pages' && this.dbReady) this.apt = this.db.airport(this.entry) ?? null;
      return;
    }
    if (this.screen !== 'pages') return;
    // PULL SCAN (Pilot's Guide 3.4.5): with the right inner knob pulled out on a waypoint page it
    // scans through the database; here the airports around present position, nearest first.
    if (this.v.get(KLN.scan) > 0.5 && this.pageType === 'APT' && this.dbReady) {
      const p = this.pos();
      const list = this.db.airportsNear(p.lat, p.lon, 150, 25);
      if (list.length) {
        const i = this.apt ? list.findIndex((a) => a.icao === this.apt!.icao) : -1;
        this.apt = list[wrapInt((i < 0 ? -1 : i) + steps, 0, list.length - 1)];
        this.entry = this.apt.icao;
      }
      return;
    }
    const t = this.typeIndex;
    const lo = t === 4 || t === 7 ? 0 : 1;
    this.pageNum[t] = wrapInt(this.pageNum[t] + steps, lo, lo + PAGE_COUNT[t] - 1);
  }

  /** First database identifier starting with `prefix` (3.4.2: "the KLN 94 automatically fills in"). */
  private complete(prefix: string): string {
    if (!prefix || !this.dbReady) return prefix;
    const p = this.pos();
    const a = this.db.searchAirports(prefix, 1)[0];
    if (a && a.icao.startsWith(prefix)) return a.icao;
    const w = this.db.resolve(prefix, p.lat, p.lon)[0];
    return w ? w.ident : prefix;
  }

  /** Re-flies the active waypoint as a LEG (great circle from present position) after OBS mode. */
  private reLeg(): void {
    const plan = this.fms.plans.active;
    if (plan.activeLegIndex >= 0) this.fms.activateLeg(plan.activeLegIndex);
  }

  // ------------------------------------------------------------------ update
  update(dt: number): void {
    const v = this.v;
    const on = v.get(this.powerVar) > 0.5 && v.get(KLN.power, 1) > 0.5;
    if (on && !this.on) {
      this.screen = 'poweron';
      this.screenT = 0;
      this.cursor = false;
    }
    if (!on) this.screen = 'off';
    this.on = on;
    v.set(GPS.powered, on ? 1 : 0);
    v.set(KLN.on, on ? 1 : 0);
    // SCAN annunciation (inner knob pulled) for the page display.
    v.set('ac.kln94.scan_active', on && v.get(KLN.scan) > 0.5 ? 1 : 0);
    if (!on) {
      this.cdiValid = false;
      this.publish();
      return;
    }
    this.screenT += dt;
    // Pilot's Guide 006-18207-0000 section 1 step 2: "For about 50 seconds the Power On Page is
    // displayed while the unit runs a self-test. ... Afterwards, the Self-test Page is displayed."
    if (this.screen === 'poweron' && this.screenT > KLN_POWER_ON_S) {
      this.screen = 'selftest';
      this.screenT = 0;
    }
    const gpsValid = v.get(GPS.valid) > 0.5;
    const startup = this.screen === 'poweron' || this.screen === 'selftest' || this.screen === 'init' || this.screen === 'database';
    this.navReady = gpsValid && !startup;
    if (!startup && !gpsValid && !this.raimMsg) {
      this.addMessage('RAIM NOT AVAILABLE');
      this.raimMsg = true;
    } else if (gpsValid && this.raimMsg) {
      this.removeMessage('RAIM NOT AVAILABLE');
      this.raimMsg = false;
    }

    // OBS mode: course from the #1 CDI OBS to the active waypoint.
    if (this.obsMode && this.navReady) {
      const obs = Math.round(v.get(this.obsVar));
      if (obs !== this.lastObs) {
        this.lastObs = obs;
        const plan = this.fms.plans.active;
        if (plan.activeLegIndex >= 0) this.fms.directTo(plan.activeLegIndex, obs);
      }
    }

    // Approach arming / activation.
    const plan = this.fms.plans.active;
    const hasApproach = !!plan.approachProcedure;
    const dest = plan.destination;
    let destNm = Infinity;
    if (dest && gpsValid) destNm = distanceNm(v.get(GPS.lat), v.get(GPS.lon), dest.lat, dest.lon);
    const prevApr = this.apr;
    this.apr = hasApproach && this.navReady ? (v.get(FMS.approachActive) > 0.5 ? 2 : destNm <= 30 ? 1 : 0) : 0;
    if (this.apr === 1 && prevApr === 0) this.addMessage('APR ARM');

    // CDI output: LEG 5 nm, APR ARM 1 nm, ACTV 0.3 nm full scale.
    const scale = this.apr === 2 ? 0.3 : this.apr === 1 ? 1 : 5;
    const lnav = v.get(FMS.lnavValid) > 0.5;
    this.cdiValid = this.navReady && lnav && plan.activeLegIndex >= 0;
    this.cdi = this.cdiValid ? clamp(-v.get(FMS.xtkNm) / scale, -1, 1) : 0;
    this.toFrom = this.cdiValid ? v.get(FMS.toFrom) || 1 : 0;
    v.set('ac.kln94.self_test', this.screen === 'selftest' ? 1 : 0);
    if (this.screen === 'selftest') {
      // Pilot's Guide 3.2 step 2: during the Self Test page an interfaced CDI shows "a half scale
      // deviation to the right" and FROM.
      this.cdiValid = true;
      this.cdi = 0.5;
      this.toFrom = -1;
    }
    this.publish();
  }

  /** Distance / bearing from present position to a point (display helpers). */
  distTo(lat: number, lon: number): number {
    return distanceNm(this.v.get(GPS.lat), this.v.get(GPS.lon), lat, lon);
  }
  brgTo(lat: number, lon: number): number {
    return wrap360(initialBearing(this.v.get(GPS.lat), this.v.get(GPS.lon), lat, lon) - this.v.get(GPS.magVar));
  }

  private publish(): void {
    const v = this.v;
    let unread = false;
    for (let i = 0; i < this.messages.length; i++) if (!this.messages[i].read) unread = true;
    v.set(KLN.msg, this.on && this.messages.length ? (unread ? 1 : 2) : 0);
    v.set(KLN.wpt, this.on && v.get(FMS.wptAlert) > 0.5 ? 1 : 0);
    v.set(KLN.obsMode, this.obsMode ? 1 : 0);
    v.set(KLN.apr, this.apr);
    v.set(KLN.navReady, this.navReady ? 1 : 0);
    v.set(KLN.cdi, this.cdi);
    v.set(KLN.toFrom, this.toFrom);
    v.set(KLN.cdiValid, this.cdiValid ? 1 : 0);
  }

  /** State presets: unit on, pages acknowledged, receiver already acquired. */
  setReady(): void {
    this.on = this.v.get(this.powerVar) > 0.5 && this.v.get(KLN.power, 1) > 0.5;
    this.screen = this.on ? 'pages' : 'off';
    this.typeIndex = 6;
    this.pageNum[6] = 1;
  }

  reset(): void {
    this.lastObs = NaN;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
  }
}
