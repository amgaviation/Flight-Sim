/**
 * GTC Home screens (G3000 PG 190-02046-01 §1.3: 'Home' for MFD control,
 * 'PFD Home', 'NAV/COM Home'; Longitude OG 4-9 / 4-10):
 *  - Home (MFD): Map, Traffic, Weather, Direct-To, Flight Plan, PROC,
 *    Aircraft Systems, Checklist, Utilities, PERF, Waypoint Info, Nearest,
 *    Charts; Map / Traffic / Weather put that page on the controlled pane,
 *    touching again opens its settings.
 *  - PFD Home: Speed Bugs, Timers, Minimums, PFD Map Settings, Traffic Map,
 *    Sensors, PFD Settings, Nav Source, OBS, Bearing 1 / 2, CAS scroll
 *    (G5000 PFD CAS or reversionary mode).
 *  - NAV/COM Home: COM1 / COM2 (active, standby, MIC, MON), NAV1 / NAV2,
 *    ADF, transponder, Audio & Radios.
 */
import type { Rect } from '../../../common/draw/context';
import { fmtAdf, fmtCom, fmtNav, fmtSquawk } from '../../format';
import { NAV } from '../../../../core/vars';
import { BRG_SOURCE, G3K, NAV_SOURCE, PANE_CONTENT, PFD_MAP, vn, type GtcModeName } from '../../vars';
import type { GtcController, HomeFactory } from '../GtcController';
import { GtcPage, type KnobId } from '../GtcPage';
import type { ButtonOptions } from '../ui';
import { comKeypad, navKeypad, adfKeypad, XpdrPage, AudioRadiosPage, xpdrModeLabel } from './radios';
import { FlightPlanPage } from './fpl';
import { DirectToPage, ProcPage } from './proc';
import { MinimumsPage, PfdMapSettingsPage, PfdSettingsPage, SensorsPage, SpeedBugsPage, TimersPage } from './pfd';
import {
  ChecklistPage,
  MapSettingsPage,
  MessagesPage,
  NearestPage,
  PerfPage,
  SystemsPage,
  TrafficSettingsPage,
  UtilitiesPage,
  WaypointInfoPage,
  WeatherRadarPage,
  WeightFuelPage,
  fplPages,
  pfdPages,
  showOnPane,
  speedBugsCtor,
} from './mfd';

pfdPages.minimums = MinimumsPage;
pfdPages.timers = TimersPage;
fplPages.flightPlan = FlightPlanPage;
speedBugsCtor.ctor = SpeedBugsPage;

const NAV_LBL = ['FMS', 'NAV1', 'NAV2'];
const BRG_LBL = ['Off', 'NAV1', 'NAV2', 'FMS', 'ADF'];

export class MfdHomePage extends GtcPage {
  readonly title = 'Home';
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const sys = this.sys;
    const g5k = sys.cfg.variant === 'g5000';
    const pane = () => sys.gtcPane(gtc.g);
    const paneBtn = (label: string, icon: ButtonOptions['icon'], content: number, settings: () => GtcPage): ButtonOptions => ({
      label,
      icon,
      selected: () => {
        const p = pane();
        return !!p && sys.paneContent(p) === content;
      },
      onPress: () => {
        const p = pane();
        if (p && sys.paneContent(p) === content) gtc.push(settings());
        else showOnPane(gtc, content as never);
      },
    });
    const cells: ButtonOptions[] = [
      paneBtn('Map', 'map', PANE_CONTENT.navMap, () => new MapSettingsPage(gtc)),
      paneBtn('Traffic', 'traffic', PANE_CONTENT.traffic, () => new TrafficSettingsPage(gtc)),
      paneBtn('Weather', 'weather', PANE_CONTENT.weather, () => new WeatherRadarPage(gtc)),
      { label: 'Direct To', icon: 'direct', onPress: () => gtc.push(new DirectToPage(gtc)) },
      { label: 'Flight Plan', icon: 'fpl', onPress: () => gtc.push(new FlightPlanPage(gtc)) },
      { label: 'PROC', icon: 'proc', onPress: () => gtc.push(new ProcPage(gtc)) },
      { label: 'Aircraft Systems', icon: 'systems', onPress: () => gtc.push(new SystemsPage(gtc)) },
      { label: 'Checklist', icon: 'checklist', disabled: () => !sys.checklists.lists.length, onPress: () => gtc.push(new ChecklistPage(gtc)) },
      { label: 'Utilities', icon: 'utilities', onPress: () => gtc.push(new UtilitiesPage(gtc)) },
      g5k || sys.cfg.performance
        ? { label: 'PERF', icon: 'perf', onPress: () => gtc.push(new PerfPage(gtc)) }
        : { label: 'Weight and Fuel', icon: 'wf', onPress: () => gtc.push(new WeightFuelPage(gtc)) },
      { label: 'Waypoint Info', icon: 'waypoint', onPress: () => gtc.push(new WaypointInfoPage(gtc)) },
      { label: 'Nearest', icon: 'nearest', onPress: () => gtc.push(new NearestPage(gtc)) },
    ];
    const horizontal = r.w > r.h * 1.3;
    this.grid(r, horizontal ? 4 : 3, horizontal ? 3 : 4, cells, horizontal ? 14 : 9);
  }
  override onKnob(_k: KnobId, _clicks: number): boolean {
    return false;
  }
}

export class PfdHomePage extends GtcPage {
  readonly title = 'PFD Home';
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const sys = this.sys;
    const v = sys.vars;
    const s = gtc.g.side;
    const navSrc = vn(G3K.navSource, s);
    const obs = vn(G3K.obs, s);
    const b1 = vn(G3K.brg1Source, s);
    const b2 = vn(G3K.brg2Source, s);
    const map = vn(G3K.pfdMap, s);
    const trafficInset = vn(G3K.pfdTrafficInset, s);
    const casHere = () => sys.cfg.casLocation === 'pfd' || sys.isReversionary(s === 1 ? 'pfd1' : 'pfd2') || sys.isReversionary('mfd');
    const cells: ButtonOptions[] = [
      { label: 'Speed Bugs', icon: 'speed', onPress: () => gtc.push(new SpeedBugsPage(gtc)) },
      { label: 'Timers', icon: 'timer', onPress: () => gtc.push(new TimersPage(gtc)) },
      { label: 'Minimums', icon: 'mins', onPress: () => gtc.push(new MinimumsPage(gtc)) },
      { label: 'PFD Map Settings', icon: 'mappfd', onPress: () => gtc.push(new PfdMapSettingsPage(gtc)) },
      {
        label: 'Traffic Map',
        icon: 'traffic',
        annun: () => v.get(trafficInset) >= 0.5,
        onPress: () => {
          sys.toggleVar(trafficInset);
          if (v.get(trafficInset) >= 0.5 && v.get(map) === PFD_MAP.off) sys.setVar(map, PFD_MAP.inset);
        },
      },
      { label: 'Sensors', icon: 'sensors', onPress: () => gtc.push(new SensorsPage(gtc)) },
      { label: 'PFD Settings', icon: 'settings', onPress: () => gtc.push(new PfdSettingsPage(gtc)) },
      { label: 'Nav Source', value: () => NAV_LBL[v.get(navSrc) | 0] ?? 'FMS', valueColor: () => (v.get(navSrc) === NAV_SOURCE.fms ? '#ff40ff' : '#00e000'), onPress: () => sys.cycleNavSource(s) },
      { label: 'OBS', annun: () => v.get(obs) >= 0.5, disabled: () => v.get(navSrc) !== NAV_SOURCE.fms, onPress: () => sys.toggleObs(s) },
      { label: 'Bearing 1', value: () => BRG_LBL[v.get(b1) | 0] ?? 'Off', onPress: () => sys.cycleBearing(s, 1) },
      { label: 'Bearing 2', value: () => BRG_LBL[v.get(b2) | 0] ?? 'Off', onPress: () => sys.cycleBearing(s, 2) },
      { label: 'CAS Scroll Up', icon: 'up', disabled: () => !casHere(), onPress: () => sys.cas.scrollBy(-1, sys.casRows) },
      { label: 'CAS Scroll Down', icon: 'down', disabled: () => !casHere(), onPress: () => sys.cas.scrollBy(1, sys.casRows) },
      { label: 'Wx Radar Controls', icon: 'weather', onPress: () => gtc.push(new WeatherRadarPage(gtc)) },
      { label: 'Direct To', icon: 'direct', onPress: () => gtc.push(new DirectToPage(gtc)) },
    ];
    void BRG_SOURCE;
    const horizontal = r.w > r.h * 1.3;
    this.grid(r, horizontal ? 5 : 3, horizontal ? 3 : 5, cells, horizontal ? 12 : 8);
  }
}

export class NavComHomePage extends GtcPage {
  readonly title = 'NAV/COM Home';
  protected build(r: Rect): void {
    const gtc = this.gtc;
    const sys = this.sys;
    const v = sys.vars;
    const s = gtc.g.side;
    const mic = vn(G3K.micSelect, s);
    const w833 = () => v.get(G3K.comSpacing833) >= 0.5;
    const cells: (ButtonOptions | null)[] = [];
    for (const r1 of [1, 2] as const) {
      const mon = G3K.comMonitor(s, r1);
      cells.push(
        { label: r1 === 1 ? 'COM1 MIC' : 'COM2 MIC', annun: () => v.get(mic) === r1, onPress: () => sys.setMic(s, r1) },
        { label: r1 === 1 ? 'COM1' : 'COM2', value: () => fmtCom(sys.comActive(r1), w833()), valueColor: '#00e000', size: 17, onPress: () => sys.swapCom(r1) },
        { label: 'STBY', value: () => fmtCom(sys.comStandby(r1), w833()), size: 15, selected: () => gtc.comSel === r1, onPress: () => ((gtc.comSel = r1), gtc.push(comKeypad(gtc, r1))) },
        { label: 'MON', annun: () => v.get(mon) >= 0.5, disabled: () => v.get(mic) === r1, onPress: () => sys.toggleVar(mon) },
      );
    }
    for (let r1 = 1; r1 <= Math.min(2, sys.cfg.radios.nav); r1++) {
      const rr = r1 as 1 | 2;
      const act = vn(NAV.activeFreq, rr);
      const stb = vn(NAV.standbyFreq, rr);
      cells.push(
        null,
        { label: rr === 1 ? 'NAV1' : 'NAV2', value: () => fmtNav(v.get(act)), valueColor: '#00e000', size: 17, onPress: () => sys.swapNav(rr) },
        { label: 'STBY', value: () => fmtNav(v.get(stb)), size: 15, onPress: () => gtc.push(navKeypad(gtc, rr)) },
        null,
      );
    }
    cells.push(
      { label: 'XPDR', value: () => fmtSquawk(v.get(NAV.xpdrCode)), size: 17, onPress: () => gtc.push(new XpdrPage(gtc)) },
      { label: 'Mode', value: () => xpdrModeLabel(sys), onPress: () => gtc.push(new XpdrPage(gtc)) },
      { label: 'IDENT', annun: () => v.get(G3K.xpdrIdentS) > 0, onPress: () => sys.ident() },
      sys.cfg.radios.adf ? { label: 'ADF', value: () => fmtAdf(v.get(vn(NAV.adfActive, 1))), onPress: () => gtc.push(adfKeypad(gtc)) } : null,
      { label: 'Audio & Radios', icon: 'audio', onPress: () => gtc.push(new AudioRadiosPage(gtc)) },
    );
    const horizontal = r.w > r.h * 1.3;
    this.grid(r, 4, horizontal ? 5 : 6, cells, horizontal ? 10 : 6);
  }
  override onKnob(k: KnobId, clicks: number): boolean {
    void k;
    void clicks;
    return false;
  }
}

/** Home screen per control mode. */
export const homeFactory: HomeFactory = (gtc: GtcController, mode: GtcModeName): GtcPage => {
  if (mode === 'PFD') return new PfdHomePage(gtc);
  if (mode === 'NAVCOM') return new NavComHomePage(gtc);
  return new MfdHomePage(gtc);
};

/** Messages page factory for the controller's MSG button. */
export const messagesFactory = (gtc: GtcController): GtcPage => new MessagesPage(gtc);
