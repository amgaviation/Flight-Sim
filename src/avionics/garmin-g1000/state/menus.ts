/**
 * Softkey menus of the G1000 NXi (PG 190-02177-02 §1.4 Table 1-3 "PFD
 * Softkeys", Table 1-4 "MFD 'Map - Navigation Map' Page Softkeys", Table 3-1
 * "Engine Display Softkeys", §4.4 transponder softkeys, §5 / §8 page
 * softkeys).
 *
 * PFD top level (PG Figure 1-10): CAS | Map/HSI | TFC Map | PFD Opt | OBS |
 * CDI | DME (ADF/DME with an ADF) | XPDR | Ident | Tmr/Ref | Nearest | Alerts.
 * The Alerts key (position 12) is on every PFD level; sub-levels end with
 * Back at position 11. Key positions inside the sub-levels that the PG lists
 * without figures are EST (Garmin convention: options left to right, Back at
 * 11) and marked below.
 *
 * MFD: every page has its own softkeys; the navigation map level 1 is
 * Engine | - | Map Opt | ... | Detail | Charts | Checklist. The Engine sub
 * levels (Engine / Lean / System / GAL REM) control the EIS strip.
 */
import { FMS } from '../../../core/vars';
import type { G1000System } from './System';
import { fill12, type SoftkeyDef, type SoftkeyMenu } from './softkeys';
import { ALERTS_KEY_LABELS } from './alerts';
import { AirportInfoPage, ChecklistPage, FplPage, GpsStatusPage, SystemSetupPage } from './pages';
import { CDI_SOURCE, EIS_PAGE, G1K, MAP_AWY, MAP_TER, PFD_MAP, WIND_OPTION, type GduId } from '../vars';

const back: SoftkeyDef = { label: 'Back', back: true };

/** Alerts key: flashing 'Warning' (red) / 'Caution' (amber) / 'Advisory' / 'Message', else 'Alerts' (PG §1.3). */
function alertsKey(sys: G1000System): SoftkeyDef {
  return {
    label: () => ALERTS_KEY_LABELS[sys.alerts.keyState] ?? 'Alerts',
    flashing: () => sys.alerts.keyState > 0,
    inverse: () => sys.alerts.keyInverse,
    color: () => (sys.alerts.keyState === 4 ? '#ff0000' : sys.alerts.keyState === 3 ? '#ffd200' : ''),
    press: () => {
      if (sys.alerts.pressAlertsKey()) sys.togglePfdWindow('alerts');
    },
  };
}

function toggle(sys: G1000System, label: string, name: string): SoftkeyDef {
  return { label, annun: () => sys.vars.get(name) >= 0.5, press: () => sys.toggleVar(name) };
}

function option(sys: G1000System, label: string, name: string, value: number): SoftkeyDef {
  return { label, annun: () => sys.vars.get(name) === value, press: () => sys.setVar(name, value) };
}

const DETAIL_LABELS = ['Detail All', 'Detail 3', 'Detail 2', 'Detail 1'];
const TER_LABELS = ['TER Off', 'Topo', 'REL'];
const AWY_LABELS = ['AWY Off', 'AWY On', 'AWY LO', 'AWY HI'];

/** PFD format softkeys for one GDU (the MFD GDU uses them in reversionary mode). */
export function buildPfdMenus(sys: G1000System, gdu: GduId): Record<string, SoftkeyMenu> {
  const v = sys.vars;
  const alerts = alertsKey(sys);
  const casScroll = (): boolean => sys.alerts.cas.list.length > 12;
  const rev = (): boolean => sys.isReversionary(gdu);
  const hasDme = sys.cfg.radios.dme;
  const hasAdf = sys.cfg.radios.adf;
  const top = fill12([
    // Key 1: CAS scroll when there are more CAS messages than the window holds (PG Table 1-3); in
    // reversionary mode the EIS Engine keys are reached here (EST, reversionary PFD + EIS).
    { label: () => (casScroll() ? 'CAS' : rev() ? 'Engine' : ''), disabled: () => !casScroll() && !rev(), press: () => sys.pfdKeys[gdu].goTo(casScroll() ? 'cas' : 'engine') },
    { label: 'Map/HSI', menu: 'map' },
    {
      label: 'TFC Map',
      annun: () => v.get(G1K.pfdMap) === PFD_MAP.insetTraffic || v.get(G1K.pfdMap) === PFD_MAP.hsiTraffic,
      disabled: () => sys.cfg.traffic === 'none',
      press: () => {
        const m = v.get(G1K.pfdMap);
        sys.setPfdMap(m === PFD_MAP.insetTraffic || m === PFD_MAP.hsiTraffic ? PFD_MAP.off : m === PFD_MAP.hsi ? PFD_MAP.hsiTraffic : PFD_MAP.insetTraffic);
      },
    },
    { label: 'PFD Opt', menu: 'opt' },
    {
      label: () => (v.get(FMS.suspended) >= 0.5 && v.get(G1K.obs) < 0.5 ? 'SUSP' : 'OBS'),
      annun: () => v.get(G1K.obs) >= 0.5 || v.get(FMS.suspended) >= 0.5,
      disabled: () => sys.cdiSource !== CDI_SOURCE.gps || v.get(FMS.activeLegIndex, -1) < 0,
      press: () => sys.toggleObs(),
    },
    { label: 'CDI', press: () => sys.cycleCdi() },
    hasDme || hasAdf ? { label: hasAdf ? 'ADF/DME' : 'DME', press: () => sys.togglePfdWindow('dme') } : null,
    { label: 'XPDR', menu: 'xpdr', disabled: () => !sys.units.up('xpdr') },
    { label: 'Ident', press: () => sys.ident(), disabled: () => !sys.units.up('xpdr') },
    { label: 'Tmr/Ref', press: () => sys.togglePfdWindow('tmrref') },
    { label: 'Nearest', press: () => sys.togglePfdWindow('nearest') },
    alerts,
  ]);
  const cas = fill12([
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    { label: 'CAS Up', press: () => sys.alerts.cas.scrollBy(-1, 12) },
    { label: 'CAS Dn', press: () => sys.alerts.cas.scrollBy(1, 12) },
    back,
    alerts,
  ]);
  // Map/HSI (Table 1-3 level 2): Layout, Detail, Traffic, TER, WX LGND, NEXRAD, METAR, Lightning. Positions EST.
  const map = fill12([
    null,
    { label: 'Layout', menu: 'layout' },
    { label: () => DETAIL_LABELS[v.get(G1K.pfdMapDetail) | 0] ?? 'Detail', press: () => sys.cycleVar(G1K.pfdMapDetail, 4) },
    toggle(sys, 'Traffic', G1K.pfdMapTraffic),
    { label: () => TER_LABELS[v.get(G1K.pfdMapTer) | 0] ?? 'TER', annun: () => v.get(G1K.pfdMapTer) > 0, press: () => sys.cycleVar(G1K.pfdMapTer, 3) },
    // SCOPE: no datalink weather source (FIS-B via the GTX 345R): the keys switch the overlays whose
    // 'no data' state the map legend shows.
    toggle(sys, 'WX LGND', 'g1k.pfd.wx_lgnd'),
    toggle(sys, 'NEXRAD', 'g1k.pfd.nexrad'),
    toggle(sys, 'METAR', 'g1k.pfd.metar'),
    toggle(sys, 'Lightning', 'g1k.pfd.lightning'),
    null,
    back,
    alerts,
  ]);
  const layout = fill12([
    null,
    option(sys, 'Map Off', G1K.pfdMap, PFD_MAP.off),
    option(sys, 'Inset Map', G1K.pfdMap, PFD_MAP.inset),
    option(sys, 'HSI Map', G1K.pfdMap, PFD_MAP.hsi),
    { ...option(sys, 'Inset Trfc', G1K.pfdMap, PFD_MAP.insetTraffic), disabled: () => sys.cfg.traffic === 'none' },
    { ...option(sys, 'HSI Trfc', G1K.pfdMap, PFD_MAP.hsiTraffic), disabled: () => sys.cfg.traffic === 'none' },
    null,
    null,
    null,
    null,
    back,
    alerts,
  ]);
  // PFD Opt: SVT | - | Wind | DME | Bearing 1 | - | Bearing 2 | - | ALT Units | STD Baro | Back | Alerts (EST positions).
  const opt = fill12([
    { label: 'SVT', menu: 'svt', disabled: () => sys.cfg.terrain !== 'SVT' },
    null,
    { label: 'Wind', menu: 'wind' },
    hasDme ? toggle(sys, 'DME', G1K.dmeWindow) : null,
    { label: 'Bearing 1', annun: () => v.get(G1K.brg1Source) > 0, press: () => sys.cycleBearing(1) },
    null,
    { label: 'Bearing 2', annun: () => v.get(G1K.brg2Source) > 0, press: () => sys.cycleBearing(2) },
    null,
    { label: 'ALT Units', menu: 'altunits' },
    { label: 'STD Baro', press: () => sys.stdBaro() },
    back,
    alerts,
  ]);
  const svt = fill12([
    toggle(sys, 'Pathways', G1K.svtPathways),
    toggle(sys, 'Terrain', G1K.svt),
    toggle(sys, 'HDG LBL', G1K.svtHdgLabels),
    toggle(sys, 'APT Sign', G1K.svtAptSigns),
    null,
    null,
    null,
    null,
    null,
    null,
    back,
    alerts,
  ]);
  const wind = fill12([
    null,
    null,
    option(sys, 'Off', G1K.windOption, WIND_OPTION.off),
    option(sys, 'Option 1', G1K.windOption, WIND_OPTION.option1),
    option(sys, 'Option 2', G1K.windOption, WIND_OPTION.option2),
    option(sys, 'Option 3', G1K.windOption, WIND_OPTION.option3),
    null,
    null,
    null,
    null,
    back,
    alerts,
  ]);
  const altunits = fill12([
    null,
    null,
    null,
    null,
    null,
    toggle(sys, 'Meters', G1K.metersOverlay),
    null,
    option(sys, 'IN', G1K.baroHpa, 0),
    option(sys, 'HPA', G1K.baroHpa, 1),
    null,
    back,
    alerts,
  ]);
  // XPDR (PG Figure 4-14): - | - | Standby | On | ALT | - | VFR | Code | Ident | - | Back | Alerts.
  const mode = (m: 1 | 2 | 3): (() => boolean) => () => v.get('xpdr.mode') === m;
  const xpdr = fill12([
    null,
    null,
    { label: 'Standby', annun: mode(1), press: () => sys.setXpdrMode(1) },
    { label: 'On', annun: mode(2), press: () => sys.setXpdrMode(2) },
    { label: 'ALT', annun: mode(3), press: () => sys.setXpdrMode(3) },
    null,
    { label: 'VFR', press: () => sys.xpdr.vfr() },
    {
      label: 'Code',
      press: () => {
        sys.xpdr.beginEntry();
        sys.pfdKeys[gdu].goTo('code');
      },
    },
    { label: 'Ident', press: () => sys.ident() },
    null,
    back,
    alerts,
  ]);
  // Code: 0-7 | Ident | BKSP | Back | Alerts (PG Table 1-3).
  const code: (SoftkeyDef | null)[] = [];
  for (let d = 0; d <= 7; d++) code.push({ label: String(d), press: () => sys.xpdr.digit(d) });
  code.push({ label: 'Ident', press: () => sys.ident() });
  code.push({ label: 'BKSP', press: () => sys.xpdr.backspace() });
  code.push({
    label: 'Back',
    press: () => {
      sys.xpdr.cancelEntry();
      sys.pfdKeys[gdu].goTo('xpdr');
    },
  });
  code.push(alerts);
  const eng = engineMenus(sys, (m) => sys.pfdKeys[gdu].goTo(m));
  return {
    top,
    cas,
    map,
    layout,
    opt,
    svt,
    wind,
    altunits,
    xpdr,
    code: fill12(code),
    engine: withAlerts(eng.engine, alerts),
    lean: withAlerts(eng.lean, alerts),
    system: withAlerts(eng.system, alerts),
    galrem: withAlerts(eng.galrem, alerts),
  };
}

function withAlerts(m: SoftkeyMenu, alerts: SoftkeyDef): SoftkeyMenu {
  const out = m.slice();
  out[11] = alerts;
  return out;
}

/**
 * Engine softkeys (PG Table 3-1): Engine | Lean | System; Lean: CYL SLCT,
 * Assist; System: RST Fuel, GAL REM -> -10 / -1 / +1 / +10 GAL, 35 / 53 GAL.
 * Positions inside the levels EST.
 */
function engineMenus(sys: G1000System, goTo: (m: string) => void): { engine: SoftkeyMenu; lean: SoftkeyMenu; system: SoftkeyMenu; galrem: SoftkeyMenu } {
  const v = sys.vars;
  const page = (p: number, m: string): SoftkeyDef => ({
    label: p === EIS_PAGE.engine ? 'Engine' : p === EIS_PAGE.lean ? 'Lean' : 'System',
    annun: () => v.get(G1K.eisPage) === p,
    press: () => {
      v.set(G1K.eisPage, p);
      if (m) goTo(m);
    },
  });
  // CYL SLCT is disabled while a CHT / EGT caution or warning is shown (PG §3, Lean page).
  const cylSlct: SoftkeyDef = {
    label: 'CYL SLCT',
    disabled: () => sys.alerts.cas.list.some((m) => m.level === 'warning'),
    press: () => {
      const n = sys.cfg.eis.egt.cylinders.length;
      v.set(G1K.eisCylSel, ((v.get(G1K.eisCylSel) | 0) % n) + 1);
    },
  };
  const engine = fill12([page(EIS_PAGE.engine, 'engine'), page(EIS_PAGE.lean, 'lean'), page(EIS_PAGE.system, 'system'), null, null, null, null, null, null, null, back, null]);
  const lean = fill12([
    page(EIS_PAGE.engine, 'engine'),
    page(EIS_PAGE.lean, 'lean'),
    page(EIS_PAGE.system, 'system'),
    null,
    null,
    null,
    null,
    null,
    cylSlct,
    { label: 'Assist', annun: () => v.get(G1K.eisLeanAssist) >= 0.5, press: () => sys.toggleVar(G1K.eisLeanAssist) },
    back,
    null,
  ]);
  const system = fill12([
    page(EIS_PAGE.engine, 'engine'),
    page(EIS_PAGE.lean, 'lean'),
    page(EIS_PAGE.system, 'system'),
    null,
    null,
    null,
    null,
    null,
    { label: 'RST Fuel', press: () => sys.fuel.resetFuel() },
    { label: 'GAL REM', menu: 'galrem' },
    back,
    null,
  ]);
  const presets = sys.cfg.eis.totalizer.presetsGal;
  const galrem = fill12([
    { label: '-10 GAL', press: () => sys.fuel.adjust(-10) },
    { label: '-1 GAL', press: () => sys.fuel.adjust(-1) },
    { label: '+1 GAL', press: () => sys.fuel.adjust(1) },
    { label: '+10 GAL', press: () => sys.fuel.adjust(10) },
    null,
    presets[0] !== undefined ? { label: `${presets[0]} GAL`, press: () => sys.fuel.preset(presets[0]) } : null,
    presets[1] !== undefined ? { label: `${presets[1]} GAL`, press: () => sys.fuel.preset(presets[1]) } : null,
    null,
    null,
    null,
    back,
    null,
  ]);
  return { engine, lean, system, galrem };
}

/** MFD softkeys: a root per page (Page.softkeys) plus the shared Engine / Map Opt levels. */
export function buildMfdMenus(sys: G1000System): Record<string, SoftkeyMenu> {
  const v = sys.vars;
  const mfd = (): G1000System['mfd'] => sys.mfd;
  const engineKey: SoftkeyDef = { label: 'Engine', menu: 'engine' };
  const checklistKey: SoftkeyDef = { label: 'Checklist', disabled: () => sys.checklists.lists.length === 0, press: () => mfd().openOverlay('checklist') };
  // SCOPE: no chart database (ChartView / FliteCharts are options): the Charts key is subdued.
  const chartsKey: SoftkeyDef = { label: 'Charts', disabled: () => true };
  const detail: SoftkeyDef = { label: () => DETAIL_LABELS[v.get(G1K.mfdMapDetail) | 0] ?? 'Detail', press: () => sys.cycleVar(G1K.mfdMapDetail, 4) };
  const eng = engineMenus(sys, (m) => sys.mfdKeys.goTo(m));
  const nav = fill12([engineKey, null, { label: 'Map Opt', menu: 'mapopt' }, null, null, null, null, null, null, detail, chartsKey, checklistKey]);
  // Map Opt (Table 1-4): Traffic | Inset | TER | AWY | STRMSCP | NEXRAD | XM LTNG | METAR | Legend. Positions EST.
  const mapopt = fill12([
    { ...toggle(sys, 'Traffic', G1K.mfdMapTraffic), disabled: () => sys.cfg.traffic === 'none' },
    // SCOPE: the VSD inset (vertical situation display) is not drawn; the key keeps its state.
    toggle(sys, 'Inset', 'g1k.mfd.vsd'),
    { label: () => TER_LABELS[v.get(G1K.mfdMapTer) | 0] ?? 'TER', annun: () => v.get(G1K.mfdMapTer) !== MAP_TER.off, press: () => sys.cycleVar(G1K.mfdMapTer, 3) },
    { label: () => AWY_LABELS[v.get(G1K.mfdMapAwy) | 0] ?? 'AWY', annun: () => v.get(G1K.mfdMapAwy) !== MAP_AWY.off, press: () => sys.cycleVar(G1K.mfdMapAwy, 4) },
    toggle(sys, 'STRMSCP', 'g1k.mfd.stormscope'),
    toggle(sys, 'NEXRAD', 'g1k.mfd.nexrad'),
    toggle(sys, 'XM LTNG', 'g1k.mfd.lightning'),
    toggle(sys, 'METAR', 'g1k.mfd.metar'),
    toggle(sys, 'Legend', 'g1k.mfd.wx_lgnd'),
    null,
    back,
    null,
  ]);
  // Traffic map (PG §6 "Traffic Map Page", ADS-B): ALT Mode (Above / Normal / Below / Unrestricted), Motion. Positions EST.
  const ALT_MODES = ['ALT Normal', 'ALT Above', 'ALT Below', 'ALT UNRES'];
  const traffic = fill12([
    engineKey,
    null,
    null,
    null,
    null,
    { label: () => (v.get(G1K.trafficMode) >= 0.5 ? 'Operate' : 'Standby'), annun: () => v.get(G1K.trafficMode) >= 0.5, press: () => sys.toggleVar(G1K.trafficMode) },
    null,
    null,
    { label: () => ALT_MODES[v.get('g1k.traffic.alt_mode') | 0] ?? 'ALT Mode', press: () => sys.cycleVar('g1k.traffic.alt_mode', 4) },
    { label: () => ['Motion Off', 'Absolute', 'Relative'][v.get('g1k.traffic.motion') | 0] ?? 'Motion', press: () => sys.cycleVar('g1k.traffic.motion', 3) },
    null,
    checklistKey,
  ]);
  const terrain = fill12([
    engineKey,
    null,
    null,
    null,
    null,
    { label: () => (v.get('g1k.terrain.arc') >= 0.5 ? 'View Arc' : 'View 360'), press: () => sys.toggleVar('g1k.terrain.arc') },
    null,
    null,
    null,
    toggle(sys, 'Legend', 'g1k.terrain.legend'),
    null,
    checklistKey,
  ]);
  const aptInfo = (): AirportInfoPage => sys.mfd.airportInfo;
  const procFor = (kind: 'approach' | 'arrival' | 'departure'): SoftkeyDef => ({
    label: kind === 'approach' ? 'APR' : kind === 'arrival' ? 'STAR' : 'DP',
    disabled: () => !aptInfo().apt,
    press: () => sys.openProcLoading('mfd', kind, aptInfo().ident),
  });
  const wptApt = fill12([
    engineKey,
    null,
    null,
    null,
    null,
    { label: 'Info-1', annun: () => aptInfo().view === 'info1', press: () => (aptInfo().view = 'info1') },
    { label: 'Info-2', annun: () => aptInfo().view === 'info2', press: () => (aptInfo().view = 'info2') },
    procFor('departure'),
    procFor('arrival'),
    procFor('approach'),
    // SCOPE: no datalink weather: WX subdued.
    { label: 'WX', disabled: () => true },
    checklistKey,
  ]);
  const wpt = fill12([engineKey, null, null, null, null, null, null, null, null, null, null, checklistKey]);
  const aux = fill12([engineKey, null, null, null, null, null, null, null, null, null, null, checklistKey]);
  const gps = (): GpsStatusPage | null => (sys.mfd.page instanceof GpsStatusPage ? sys.mfd.page : null);
  const auxGps = fill12([
    engineKey,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    { label: 'GPS1', annun: () => v.get(G1K.gpsStatusRx) < 1.5, press: () => gps() && v.set(G1K.gpsStatusRx, 1) },
    { label: 'GPS2', annun: () => v.get(G1K.gpsStatusRx) >= 1.5, press: () => gps() && v.set(G1K.gpsStatusRx, 2) },
    checklistKey,
  ]);
  const setup = (): SystemSetupPage => sys.mfd.setup;
  const auxSetup = fill12([
    engineKey,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    { label: 'Setup 1', annun: () => setup().setup === 1, press: () => setup().setSetup(1) },
    { label: 'Setup 2', annun: () => setup().setup === 2, press: () => setup().setSetup(2) },
    checklistKey,
  ]);
  // FPL (PG §5.6 / §5.7): ... | Cncl VNV (Enbl VNV) | ... | ACT Leg | ... Positions EST.
  const fplPage = (): FplPage => sys.mfd.fpl;
  const fpl = fill12([
    engineKey,
    null,
    null,
    null,
    null,
    {
      label: () => (v.get(G1K.vnvEnabled) >= 0.5 ? 'Cncl VNV' : 'Enbl VNV'),
      press: () => sys.toggleVar(G1K.vnvEnabled),
    },
    null,
    null,
    { label: 'ACT Leg', disabled: () => !fplPage().form.active || fplPage().cursorLeg() < 0, press: () => fplPage().activateLeg() },
    null,
    chartsKey,
    checklistKey,
  ]);
  const nrst = fill12([engineKey, null, null, null, null, null, null, null, null, null, null, checklistKey]);
  const procload = fill12([engineKey, null, null, null, null, null, null, null, null, null, null, null]);
  const cl = (): ChecklistPage => sys.mfd.checklist;
  // Checklist page (PG §8 "Electronic Checklists"): ... | Check / Uncheck | Exit | EMER. Positions EST.
  const checklist = fill12([
    engineKey,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    {
      label: () => (sys.checklists.isChecked(cl().form.row) ? 'Uncheck' : 'Check'),
      press: () => cl().toggleItem(),
    },
    { label: 'Exit', press: () => mfd().closeOverlay() },
    { label: 'EMER', press: () => cl().emergency() },
  ]);
  return {
    nav,
    mapopt,
    traffic,
    terrain,
    wpt_apt: wptApt,
    wpt,
    aux,
    aux_gps: auxGps,
    aux_setup: auxSetup,
    fpl,
    nrst,
    procload,
    checklist,
    engine: eng.engine,
    lean: eng.lean,
    system: eng.system,
    galrem: eng.galrem,
  };
}
