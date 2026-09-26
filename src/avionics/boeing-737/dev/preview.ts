/**
 * Development preview of the 737NG CDS (not bundled): renders the display
 * units side by side from a scripted flight state so the formats can be
 * screenshotted and compared with flight deck photographs.
 *
 *   npx vite --port 5199  ->  /src/avionics/boeing-737/dev/preview.html?state=cruise
 */
import { SimVars } from '../../../core/SimVars';
import { EventBus } from '../../../core/EventBus';
import { ADC, AP, GPS, NAV } from '../../../core/vars';
import { resolveB737Config } from '../config';
import { EfisPanels } from '../cds/EfisPanels';
import { CdsLogic } from '../cds/CdsLogic';
import { DisplayUnit } from '../cds/DisplayUnit';
import { B737_VARS, DU_IDS } from '../vars';
import { createNavDatabase } from '../../../nav/NavDatabase';
import { Fms } from '../../../nav/fms/Fms';
import { B737Fmc } from '../fmc/Fmc';
import { Cdu } from '../fmc/Cdu';
import { CduDisplay } from '../fmc/CduDisplay';

const q = new URLSearchParams(location.search);
const state = q.get('state') ?? 'cruise';

const vars = new SimVars();
const events = new EventBus();
const cfg = resolveB737Config({});
const efis = new EfisPanels({ vars, events }, [1, 2]);
const cds = new CdsLogic({ vars, events }, cfg);
const nav = createNavDatabase({ baseUrl: '/data/' });
const fms = new Fms({ vars, events, nav }, { style: 'boeing', engineCount: 2 });
const fmc = new B737Fmc({ vars, events, cfg, fms });
fmc.zfwKg = 55000;
fmc.v1Sel = 142;
fmc.vrSel = 144;
fmc.v2Sel = 150;
fmc.vrefSel = 141;
fmc.vrefFlaps = 30;
const cdus = [new Cdu(fmc, 1, events), new Cdu(fmc, 2, events)];
const cduDisplays = q.get('cdu') !== null ? cdus.map((c) => new CduDisplay(c, { canvas: 'dom' })) : [];
const traffic = { threats: [{ relBrgDeg: 30, rangeNm: 8, relAltFt: 800, vsSign: -1, level: 2 }, { relBrgDeg: -40, rangeNm: 14, relAltFt: -1200, vsSign: 0, level: 0 }] };
const world = { elevationAt: (lat: number, lon: number) => Math.max(0, 900 * Math.sin(lat * 40) * Math.cos(lon * 35) + 300) };
const env = { vars, cfg, efis, fms, fmc, nav, world, audio: null, traffic, weather: null };
const duSel = q.get('dus');
const dus = DU_IDS.filter((d) => !duSel || duSel.split(',').includes(d)).map((d) => new DisplayUnit(env, d, { canvas: 'dom', bootS: 0 }));

function setState(t: number): void {
  const approach = state === 'approach';
  const alt = approach ? 1450 : 12860;
  for (const s of [1, 2]) {
    vars.set(ADC.valid(s), 1);
    vars.set(ADC.ahrsValid(s), 1);
    vars.set(ADC.pitch(s), approach ? -1.8 : 2.2 + Math.sin(t) * 0.3);
    vars.set(ADC.bank(s), approach ? -4 : 8);
    vars.set(ADC.heading(s), approach ? 42 : 275);
    vars.set(ADC.ias(s), approach ? 146 : 279);
    vars.set(ADC.mach(s), approach ? 0.23 : 0.53);
    vars.set(ADC.baroAlt(s), alt);
    vars.set(ADC.vs(s), approach ? -760 : -1950);
    vars.set(ADC.tas(s), approach ? 150 : 340);
    vars.set(ADC.baroSetting(s), 29.92);
    vars.set(`adc${s}.ias_rate_kts`, approach ? -0.3 : 1.2);
    vars.set(`adc${s}.aoa_deg`, approach ? 5.5 : 2.5);
  }
  vars.set('stall.aoa_norm', approach ? 0.42 : 0.2);
  for (const e of [1, 2]) {
    const start = state === 'start' && e === 2;
    const off = state === 'start' && e === 1;
    vars.set(`eng${e}.running`, off || start ? 0 : 1);
    vars.set(`eng${e}.n1_pct`, off ? 0 : start ? 19.7 : approach ? 58.2 + e * 0.3 : 86.3 - e * 0.1);
    vars.set(`eng${e}.n2_pct`, off ? 0 : start ? 59.4 : approach ? 82.1 : 93.8 + e * 0.1);
    vars.set(`eng${e}.itt_c`, off ? 22 : start ? 421 : approach ? 612 : 777 + e * 5);
    vars.set(`eng${e}.ff_pph`, off ? 0 : start ? 640 : approach ? 1600 : 2380 + e * 20);
    vars.set(`eng${e}.oil_press_psi`, off ? 0 : start ? 29 : 47);
    vars.set(`eng${e}.oil_temp_c`, off ? 18 : start ? 49 : 96);
    vars.set(`eng${e}.vib_n1`, off ? 0 : e === 1 ? 0.1 : 0.7);
    vars.set(`eng${e}.starter`, start ? 1 : 0);
    vars.set(`ac.eng${e}.oil_qty`, e === 1 ? 14 : 16);
  }
  vars.set('adc1.tat_c', approach ? 12 : -20);
  vars.setString('fadec.rating', state === 'start' ? 'TO' : approach ? 'GA' : 'CRZ');
  vars.set('fadec.assumed_temp_c', state === 'start' ? 38 : -99);
  vars.set('fadec.n1_limit_pct', approach ? 97.2 : 94.2);
  vars.setString('ap.at_mode', approach ? 'MCP SPD' : 'FMC SPD');
  vars.set('fuel.tank0_kg', state === 'start' ? 2190 : 2960);
  vars.set('fuel.tank1_kg', state === 'start' ? 2200 : 3000);
  vars.set('fuel.tank2_kg', approach ? 0 : 4200);
  vars.set('hyd.a_psi', 3020);
  vars.set('hyd.b_psi', 2990);
  vars.set('hyd.a_qty', 0.98);
  vars.set('hyd.b_qty', 0.72);
  vars.set('surf.aileron', 0.15);
  vars.set('surf.elevator', -0.1);
  vars.set('surf.rudder', 0.05);
  vars.set(GPS.valid, 1);
  vars.set(GPS.gs, approach ? 140 : 330);
  vars.set(GPS.trackMag, approach ? 40 : 272);
  vars.set(GPS.trackTrue, approach ? 26 : 258);
  vars.set(GPS.magVar, -14);
  vars.set('ra1.valid', approach ? 1 : 0);
  vars.set('ra1.alt_ft', 1430);
  vars.set('ra2.valid', approach ? 1 : 0);
  vars.set('ra2.alt_ft', 1430);
  vars.set('gear.air_ground', 0);
  vars.set('surf.flaps_deg', approach ? 30 : 0);
  vars.set(AP.selAltitude, approach ? 3000 : 12000);
  vars.set(AP.selHeading, approach ? 42 : 275);
  vars.set(AP.selSpeed, approach ? 146 : 279);
  vars.set(B737_VARS.mcpSpdCursorKt, approach ? 146 : 279);
  vars.set(AP.fdOn(1), 1);
  vars.set(AP.fdOn(2), 1);
  vars.set('ap.fd_pitch_valid', 1);
  vars.set('ap.fd_roll_valid', 1);
  vars.set(AP.fdPitch, approach ? -2.2 : 1.0);
  vars.set(AP.fdBank, approach ? -2 : 5);
  vars.setString(B737_VARS.fmaAt, approach ? 'MCP SPD' : 'ARM');
  vars.setString(B737_VARS.fmaRoll, approach ? 'VOR/LOC' : 'HDG SEL');
  vars.setString(B737_VARS.fmaPitch, approach ? 'G/S' : 'VNAV PTH');
  vars.setString(B737_VARS.fmaRollArmed, approach ? 'ROLLOUT' : '');
  vars.setString(B737_VARS.fmaPitchArmed, approach ? 'FLARE' : '');
  vars.setString(B737_VARS.fmaStatus, approach ? 'LAND 3' : 'CMD');
  if (approach) {
    vars.set(NAV.isLoc(1), 1);
    vars.set(NAV.received(1), 1);
    vars.set(NAV.cdi(1), 0.1);
    vars.set(NAV.gsValid(1), 1);
    vars.set(NAV.gsDev(1), -0.15);
    vars.set(NAV.dmeValid(1), 1);
    vars.set(NAV.dmeNm(1), 4.2);
    vars.setString(NAV.ident(1), 'IBOS');
    vars.set(AP.selCourse(1), 35);
    vars.set(NAV.markerOuter, Math.sin(t * 3) > 0 ? 1 : 0);
    vars.set(B737_VARS.efisMinsRadioFt(1), 200);
  } else {
    vars.set(B737_VARS.efisMinsRef(1), 1);
    vars.set(B737_VARS.efisMinsBaroFt(1), 277);
    vars.set(ADC.baroStd(1), 1);
    vars.set(B737_VARS.efisBaroHpa(1), 1);
    vars.set(B737_VARS.efisBaroPresel(1), 1011 / 33.8639);
  }
}

async function prepare(): Promise<void> {
  await nav.load();
  vars.set(GPS.lat, state === 'approach' ? 42.30 : 41.1);
  vars.set(GPS.lon, state === 'approach' ? -71.05 : -73.6);
  vars.set(GPS.magVar, -14);
  vars.set('env.time_utc_h', 14.3);
  const r = await fms.loadRoute(state === 'approach' ? 'KJFK KBOS' : 'KTEB/24 DIXIE MERIT HFD PUT BOS KBOS');
  fms.plans.exec();
  fms.plans.active.cruiseAltFt = 24000;
  void r;
  vars.set(B737_VARS.efisMapButton(1, 'arpt'), 1);
  vars.set(B737_VARS.efisMapButton(1, 'sta'), 1);
  vars.set(B737_VARS.efisMapButton(1, 'wpt'), 1);
  vars.set(B737_VARS.efisMapButton(2, 'terr'), 1);
  vars.set(B737_VARS.efisTfc(1), 1);
  vars.set(B737_VARS.efisTfc(2), 1);
  vars.set(B737_VARS.efisRange(1), 3);
  vars.set(B737_VARS.efisRange(2), 3);
  vars.set(B737_VARS.efisVorAdf(1, 1), 1);
  vars.set(B737_VARS.efisVorAdf(2, 2), -1);
  const mfd = q.get('mfd');
  if (mfd) vars.set(B737_VARS.mfdFormat, Number(mfd));
  const mode2 = q.get('mode2');
  if (mode2) vars.set(B737_VARS.efisMode(2), Number(mode2));
  if (q.get('ctr2')) vars.set(B737_VARS.efisCtr(2), 1);
}
await prepare();
setState(0);
// Optional CDU key script: cdu=<comma separated keys>, 'T:text' types text.
const script = q.get('cdu');
if (script) {
  for (const tok of script.split(',')) {
    if (tok.startsWith('T:')) for (const ch of tok.slice(2)) cdus[0].key(ch === ' ' ? 'SP' : ch);
    else cdus[0].key(tok);
    for (let i = 0; i < 3; i++) {
      fms.update(0.05);
      fmc.update(0.05);
    }
    await new Promise((r) => setTimeout(r, 30));
  }
}
const panel = document.getElementById('panel')!;
for (const d of cduDisplays) {
  const wrap = document.createElement('div');
  wrap.className = 'unit';
  const l = document.createElement('span');
  l.className = 'lbl';
  l.textContent = `CDU ${d.cdu.side}`;
  wrap.appendChild(l);
  const c = d.canvas as HTMLCanvasElement;
  c.style.width = q.get('cw') ?? '560px';
  c.id = `cdu${d.cdu.side}`;
  wrap.appendChild(c);
  panel.appendChild(wrap);
}
for (const d of dus) {
  const wrap = document.createElement('div');
  wrap.className = 'unit';
  const l = document.createElement('span');
  l.className = 'lbl';
  l.textContent = d.du;
  wrap.appendChild(l);
  const c = d.canvas as HTMLCanvasElement;
  c.style.width = q.get('w') ?? '400px';
  wrap.appendChild(c);
  panel.appendChild(wrap);
}
let t = 0;
for (let i = 0; i < 90; i++) {
  t += 1 / 30;
  setState(t);
  efis.update(1 / 30);
  cds.update(1 / 30);
  fms.update(1 / 30);
  fmc.update(1 / 30);
  for (const d of dus) d.render(1 / 30);
  for (const d of cduDisplays) d.render(1 / 30);
}
(window as unknown as { __ready: boolean }).__ready = true;
