/**
 * Bombardier Global 6000 check ride, headless: one continuous flight from
 * cold & dark at Teterboro (KTEB) to Pittsburgh (KPIT) and back to cold &
 * dark, flown only through the cockpit controls (G6K_VARS), the Pro Line
 * Fusion FCP / CTP / MKP events the 3D panels emit, FMS-window line selects
 * (CCP cursor ENTER) and the yoke, pedals, tiller and toe brakes.
 *
 *   KTEB/24  ->  RAV (Ravine VORTAC)  ->  NASTY (I28R transition)  ->  ILS 28R KPIT, cruise FL350
 *
 * Phases (checklists.ts, dossier §5 / §12): COCKPIT PREPARATION (BATT MASTER,
 * EMER LIGHTS ARM, APU battery start, APU GEN, hydraulic pumps, IRS NAV, fuel
 * panel, STALL PUSHER, WINDSHIELD HEAT) -> BEFORE START / ENGINE START (APU
 * BLEED, XBLEED AUTO, ENG RUN + START right then left) -> AFTER START (APU
 * OFF, VFGs, 3 x 3,000 psi) -> FMS on the MKP / FMS window (FPLN, DEP/ARR,
 * PERF INIT, TAKEOFF REF) -> taxi (NOSE STEER, handwheel) -> take-off (A/T,
 * TOGA, slats / flaps 6) -> AP, LNAV, FLC, VNAV climb, baro STD -> cruise
 * FL350 M0.85 -> VNAV descent -> APPR (nav-to-nav LOC transfer, LOC / GS) ->
 * AP disconnect at 200 ft (no autoland on the Global, GXAF) -> hand flare ->
 * rollout (ground lift dumping, piggy-back reversers, autobrake MED) -> taxi
 * clear -> shutdown -> cold & dark.
 *
 * Every step asserts annunciations / CAS / FMA and physically sensible numbers.
 */
import { describe, expect, it } from 'vitest';
import { NavDatabaseImpl } from '../../../../src/nav/NavDatabase';
import { createFileLoader } from '../../../../src/nav/data/nodeLoader';
import { alongTrackNm, crossTrackNm, destinationPoint, distanceNm } from '../../../../src/core/geo';
import { FDM, INPUT } from '../../../../src/core/vars';
import { G6K_VARS as V } from '../../../../src/aircraft/global6000/vars';
import { G6K_LIMITS, vSpeeds, mmoAt } from '../../../../src/aircraft/global6000/data';
import { G6K_CHECKLISTS } from '../../../../src/aircraft/global6000/checklists';
import { FUSION_VARS } from '../../../../src/avionics/collins-fusion/vars';
import { makeFlightRig, casActive, fma, press, fcp, ctp, mkp, type, lsk, settle, bearingTo, wrap180, type FlightRig } from './flightRig';

const LBKG = 0.45359237;
/** GXAF / approach.test.ts: AP disconnected at the 200 ft Cat I decision height (no autoland). */
const AP_OFF_FT = 200;
const LOG: string[] = [];
function log(r: FlightRig, what: string): void {
  const v = r.vars;
  LOG.push(
    `[${(r.t / 60).toFixed(1).padStart(5)} min] ${what} | ${v.get(FDM.altMsl).toFixed(0)} ft ${v.get(FDM.ias).toFixed(0)} KIAS M${v.get(FDM.mach).toFixed(2)} VS ${v.get(FDM.vs).toFixed(0)} | N1 ${v.get('eng1.n1_pct').toFixed(1)}/${v.get('eng2.n1_pct').toFixed(1)} | ${fma(r)} sel ${v.get('ap.sel_alt_ft')}/${v.get('ap.sel_spd_kt')} | CAS ${casActive(r).join(',')}`,
  );
}

/** Items of a checklist (checklists.ts) whose live auto-check fails. */
function checklistFails(r: FlightRig, title: string): string[] {
  const c = G6K_CHECKLISTS.find((x) => x.title === title)!;
  return c.items.filter((i) => i.check && !i.check(r.vars)).map((i) => `${title}: ${i.challenge}`);
}

/**
 * Shows the FMS window page on which a line matches (label row text, data row
 * text) and returns that line number (1-5), paging with NEXT; -1 if none.
 */
function findLine(r: FlightRig, match: (label: string, data: string) => boolean): number {
  const w = r.sys.suite!.fmsWin[0];
  for (let p = 0; p < 6; p++) {
    w.render();
    for (let k = 1; k <= 5; k++) if (match(w.screen.rowText(2 * k - 1), w.screen.rowText(2 * k))) return k;
    mkp(r, 'NEXT');
  }
  return -1;
}

/** FCP SPD knob to `kt` (turning the knob selects MAN speed). */
function setSpd(r: FlightRig, kt: number): void {
  const v = r.vars;
  if (v.get('ap.spd_is_mach')) fcp(r, 'spd_push'); // IAS / MACH
  const d = Math.round(kt - v.get('ap.sel_spd_kt'));
  if (d !== 0) fcp(r, d > 0 ? 'spd_inc' : 'spd_dec', Math.abs(d));
}
/** FCP ALT knob to `ft` (1,000 ft steps). */
function setAlt(r: FlightRig, ft: number): void {
  const d = Math.round((ft - r.vars.get('ap.sel_alt_ft')) / 1000);
  if (d !== 0) fcp(r, d > 0 ? 'alt_inc' : 'alt_dec', Math.abs(d));
}
/** FCP HDG knob to `deg`. */
function setHdg(r: FlightRig, deg: number): void {
  const d = Math.round(wrap180(deg - r.vars.get('ap.sel_hdg_deg')));
  if (d !== 0) fcp(r, d > 0 ? 'hdg_inc' : 'hdg_dec', Math.abs(d));
}

/** Ground steering + speed controller (pilot on the NOSE STEER handwheel, toe brakes and thrust levers). */
function taxiStep(r: FlightRig, tgtLat: number, tgtLon: number, gsKt: number): void {
  const v = r.vars;
  const err = wrap180(bearingTo(r, tgtLat, tgtLon) - v.get(FDM.headingTrue));
  v.set(V.tiller3d, Math.max(-1, Math.min(1, err / 30)));
  const e = gsKt - v.get(FDM.gs);
  const lever = Math.max(0, Math.min(0.3, 0.05 + 0.02 * e));
  v.set(V.tla(1), lever);
  v.set(V.tla(2), lever);
  const brake = e < -2 ? Math.min(1, -0.1 * e) : 0;
  v.set(INPUT.brakeLeft, brake);
  v.set(INPUT.brakeRight, brake);
}

function stopOnGround(r: FlightRig): void {
  const v = r.vars;
  v.set(V.tla(1), 0);
  v.set(V.tla(2), 0);
  v.set(V.tiller3d, 0);
  r.run(40, () => {
    v.set(INPUT.brakeLeft, 0.6);
    v.set(INPUT.brakeRight, 0.6);
    return v.get(FDM.gs) < 0.3;
  });
}

/** Crew FLIGHT SPOILER technique in a descent: 1/2 when > 15 kt fast, retract near the target or below 1,500 ft. */
function speedbrakeStep(r: FlightRig): void {
  const v = r.vars;
  const fast = v.get(FDM.ias) - v.get('ap.sel_spd_kt');
  const sb = v.get(V.flightSpoiler);
  if (fast > 15 && v.get(FDM.vs) < -300 && v.get(FDM.altAgl) > 1500 && v.get(V.flapLever) < 3) v.set(V.flightSpoiler, 0.5);
  else if (sb > 0 && (fast < 5 || v.get(FDM.altAgl) < 1500 || v.get(V.flapLever) >= 3)) v.set(V.flightSpoiler, 0);
}

describe('Global 6000 check ride KTEB -> KPIT (full normal procedure)', () => {
  it('flies cold & dark to cold & dark through the cockpit controls', { timeout: 2_400_000 }, async () => {
    const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
    await db.load();
    const kteb = db.airport('KTEB')!;
    const kpit = db.airport('KPIT')!;
    const rw24 = kteb.runways.find((x) => x.ident === '24')!;
    const rw28r = kpit.runways.find((x) => x.ident === '28R')!;
    expect(rw24 && rw28r).toBeTruthy();
    expect(rw28r.ils).toBeTruthy();
    // Ramp spot: 200 m right of the 24 centre line, 300 m down the runway, facing the runway.
    const along = destinationPoint(rw24.lat, rw24.lon, rw24.headingTrue, 300 / 1852);
    const far = destinationPoint(rw24.lat, rw24.lon, rw24.headingTrue, 2);
    const ramp = destinationPoint(along.lat, along.lon, rw24.headingTrue + 90, 200 / 1852);
    // 2 crew in the BOW + 4 passengers and bags (1,200 lb), 20,000 lb fuel -> ~73,500 lb ramp weight.
    const fuelLb = 20000;
    const payloadLb = 1200;
    const r = makeFlightRig({ db, origin: kteb, dest: kpit, start: { lat: ramp.lat, lon: ramp.lon, headingTrue: rw24.headingTrue - 90 }, fuelLb, payloadLb });
    const v = r.vars;
    const sys = r.sys;
    const suite = sys.suite!;
    const pilot = r.pilot;
    try {
      // ================================================================ 1. cold & dark
      r.run(1);
      expect(v.get('elec.dc_ess_powered')).toBe(0);
      expect(v.get('elec.dc_emer_powered')).toBe(1); // hot battery direct buses
      expect(v.get('eng1.running') + v.get('eng2.running')).toBe(0);
      expect(v.get('display.fusion.afd1.power')).toBe(0);
      expect(v.get(V.battMaster)).toBe(0);
      log(r, 'cold & dark');

      // ================================================================ 2. COCKPIT PREPARATION: power-up
      v.set(V.battMaster, 1);
      v.set(V.emerLights, 1); // ARM
      v.set(V.parkBrake, 1);
      for (const d of ['pax', 'emer', 'bag'] as const) v.set(V.door(d), 0);
      r.run(3);
      expect(v.get('elec.batt_bus_v')).toBeGreaterThan(23);
      expect(v.get('elec.dc_ess_powered')).toBe(1); // emergency tie contactor
      expect(v.get('elec.ac_bus1_powered')).toBe(0);
      expect(casActive(r)).toContain('BATTERY EMER PWR ON'); // DC ESS on the batteries
      log(r, 'BATT MASTER on');

      // ---- APU: RUN (door, BIT), START (spring back to RUN), from the APU battery
      v.set(V.apuSw, 1);
      r.run(11);
      v.set(V.apuSw, 2);
      r.run(1.5);
      v.set(V.apuSw, 1);
      let minApuBatt = 99;
      let apuT = NaN;
      r.run(90, (t) => {
        minApuBatt = Math.min(minApuBatt, v.get('elec.apu_batt_dir_v'));
        if (isNaN(apuT) && v.get('elec.apu_gen_online') === 1) apuT = t;
        return !isNaN(apuT) && t > apuT + 3;
      });
      expect(apuT).toBeLessThan(70);
      expect(minApuBatt).toBeGreaterThan(12); // starter dip, relays hold (QA lesson)
      expect(minApuBatt).toBeLessThan(24.5);
      for (const n of [1, 2, 3, 4]) expect(v.get(`elec.ac_bus${n}_powered`)).toBe(1);
      expect(v.get('elec.ac_ess_powered')).toBe(1);
      expect(v.get('elec.dc_ess_v')).toBeGreaterThan(27);
      expect(casActive(r)).not.toContain('BATTERY EMER PWR ON');
      for (const d of ['afd1', 'afd2', 'afd3', 'afd4', 'iesi']) expect(v.get(`display.fusion.${d}.power`)).toBe(1);
      log(r, `APU GEN on line (${apuT.toFixed(0)} s), min APU batt ${minApuBatt.toFixed(1)} V`);

      // ---- hydraulics, IRS, fuel, pushers, windshield heat, pressurization
      for (const p of ['1b', '2b', '3b'] as const) v.set(V.hydPump(p), 1); // AUTO
      v.set(V.hydPump('3a'), 2); // ON
      for (const n of [1, 2, 3] as const) v.set(V.irsMode(n), 2); // NAV
      for (const s of ['l', 'r'] as const) {
        v.set(V.priPumps(s), 1);
        v.set(V.auxPump(s), 1);
        v.set(V.recirc(s), 1);
      }
      v.set(V.xfeed, 0);
      v.set(V.aftXfer, 1);
      v.set(V.wingXfer, 1);
      v.set(V.pusher(1), 1);
      v.set(V.pusher(2), 1);
      v.set(V.wshldL, 1);
      v.set(V.wshldR, 1);
      v.set(V.pressAutoMan, 0);
      v.set(V.ldgElevFms, 1);
      v.set(V.crewOxy, 1);
      v.set(V.paxOxy, 1);
      v.set(V.gearHandle, 1);
      r.run(8);
      expect(v.get('hyd.sys3_psi')).toBeGreaterThan(2800); // 3A on the APU generator
      // ---- BEFORE START: beacon, nav lights, signs, APU BLEED / XBLEED AUTO
      v.set(V.ltBeacon, 1);
      v.set(V.ltNav, 1);
      v.set(V.seatBelts, 1);
      v.set(V.noSmoking, 1);
      v.set(V.apuBleed, 1);
      v.set(V.xbleed, 1);
      for (const s of ['l', 'r'] as const) v.set(V.engBleed(s), 1);
      r.run(5);
      expect(v.get('pneu.l_duct_psi')).toBeGreaterThan(30);
      expect(checklistFails(r, 'COCKPIT PREPARATION')).toEqual([]);
      expect(checklistFails(r, 'BEFORE START')).toEqual([]);
      expect(casActive(r, 'warning')).toEqual([]);
      log(r, 'before start');

      // ================================================================ 3. ENGINE START: right, then left
      for (const side of [2, 1] as const) {
        v.set(V.engRun(side), 1);
        r.run(0.5);
        press(r, V.engStart(side));
        let peak = 0;
        let idleT = NaN;
        const t0 = r.t;
        r.run(90, (t) => {
          peak = Math.max(peak, v.get(`eng${side}.itt_c`));
          if (isNaN(idleT) && v.get(`eng${side}.running`)) idleT = t;
          return !isNaN(idleT) && t > idleT + 10;
        });
        expect(v.get(`eng${side}.running`)).toBe(1);
        expect(v.get(`fadec.eng${side}.abort`)).toBe(0);
        expect(peak).toBeLessThan(G6K_LIMITS.ittStartGroundC); // TCDS 700 C ground start
        expect(r.t - t0).toBeLessThan(75);
        log(r, `engine ${side} started in ${idleT.toFixed(0)} s, peak ITT ${peak.toFixed(0)} C`);
      }
      expect(checklistFails(r, 'ENGINE START')).toEqual([]);
      // ---- AFTER START: APU off (engine bleeds carry the packs), NOSE STEER armed
      v.set(V.apuSw, 0);
      r.run(100); // GXAPU: 60 s unloaded cooldown, then spool-down
      expect(v.get('apu.running')).toBe(0);
      for (const n of [1, 2, 3, 4]) {
        expect(v.get(`elec.gen${n}_online`)).toBe(1);
        expect(v.get(`elec.acb${n}_src`)).toBe(1); // each AC bus on its own VFG
      }
      for (const n of [1, 2, 3]) expect(v.get(`hyd.sys${n}_psi`)).toBeGreaterThan(2800);
      expect(v.get('elec.dc_ess_v')).toBeGreaterThan(27);
      for (const i of [1, 2]) {
        expect(v.get(`eng${i}.n2_pct`)).toBeGreaterThan(G6K_LIMITS.n2IdleMinPct);
        expect(v.get(`eng${i}.oil_press_psi`)).toBeGreaterThan(G6K_LIMITS.oilPressCautionPsi);
      }
      expect(casActive(r, 'warning')).toEqual([]);
      const startCautions = casActive(r, 'caution').filter((c) => !/IRS|ALIGN/.test(c));
      LOG.push('cautions after start: ' + casActive(r, 'caution').join(','));
      expect(startCautions).toEqual([]);
      log(r, 'engines running, APU off');

      // ================================================================ 4. IRS alignment
      r.run(900, () => [1, 2, 3].every((n) => v.get(`ahrs${n}.valid`) === 1) && v.get('adc1.valid') === 1);
      for (const n of [1, 2, 3]) expect(v.get(`ahrs${n}.valid`)).toBe(1);
      log(r, 'IRS aligned');

      // ================================================================ 5. FMS: FPLN, DEPARTURE, route, ARRIVAL, PERF INIT, TAKEOFF REF
      const w = suite.fmsWin[0];
      mkp(r, 'FPLN');
      r.run(0.2);
      expect(w.pageId).toBe('FPLN');
      type(r, 'KTEB');
      lsk(r, 'L1');
      type(r, 'KPIT');
      lsk(r, 'R1');
      r.run(0.5);
      expect(w.screen.title).toBe('MOD FPLN');
      expect(v.get(FUSION_VARS.execLight)).toBe(1);
      // DEP/ARR on the ground opens DEPARTURE: runway 24.
      mkp(r, 'DEPARR');
      r.run(0.2);
      expect(w.pageId).toBe('DEP');
      await settle(r);
      const rwys = [...new Set(sys.fms.plans.displayed.origin!.runways.map((x) => x.ident))].sort();
      const rk = rwys.indexOf('24');
      expect(rk).toBeGreaterThanOrEqual(0);
      for (let p = 0; p < Math.floor(rk / 5); p++) mkp(r, 'NEXT');
      lsk(r, `L${(rk % 5) + 1}` as 'L1');
      r.run(0.2);
      expect(sys.fms.plans.displayed.departureRunway).toBe('24');
      // Enroute: RAV (Ravine VORTAC; JST and HAR resolve to the KJST / KCXY airports first, see the dossier) on the first free VIA / TO row.
      mkp(r, 'FPLN');
      r.run(0.2);
      // The first free VIA / TO row (TO shows dashes) of the FPLN pages.
      const free = findLine(r, (label, data) => label.includes('VIA') && data.trimEnd().endsWith('-----'));
      expect(free).toBeGreaterThan(0);
      type(r, 'RAV');
      lsk(r, `R${free}` as 'R1');
      r.run(0.3);
      expect(w.scratchText).toBe('');
      expect(sys.fms.plans.displayed.legs.some((l) => l.fix?.ident === 'RAV')).toBe(true);
      // ARRIVAL: ILS 28R via NASTY.
      mkp(r, 'DEPARR');
      r.run(0.2);
      lsk(r, 'R6'); // ARRIVAL>
      expect(w.pageId).toBe('ARR');
      await settle(r, 400);
      const procs = suite.fmsHost.procedures('KPIT');
      expect(procs).toBeTruthy();
      const aIdx = procs!.approaches.findIndex((a) => a.ident === 'I28R');
      expect(aIdx).toBeGreaterThanOrEqual(0);
      for (let p = 0; p < Math.floor(aIdx / 5); p++) mkp(r, 'NEXT');
      lsk(r, `L${(aIdx % 5) + 1}` as 'L1');
      r.run(0.2);
      const tIdx = ['VECTORS', ...procs!.approaches[aIdx].transitions.map((t) => t.name)].indexOf('NASTY');
      expect(tIdx).toBeGreaterThan(0);
      lsk(r, `L${tIdx + 1}` as 'L1');
      r.run(0.2);
      expect(sys.fms.plans.displayed.approach?.ident).toBe('I28R');
      // Close the route discontinuity: FPLN, DEL key, line select on the DISCONTINUITY row.
      mkp(r, 'FPLN');
      r.run(0.2);
      for (let guard = 0; guard < 3 && sys.fms.plans.displayed.legs.some((l) => l.type === 'DISCO'); guard++) {
        const k = findLine(r, (label) => label.includes('DISCONTINUITY'));
        expect(k).toBeGreaterThan(0);
        mkp(r, 'DEL');
        lsk(r, `L${k}` as 'L1');
        r.run(0.2);
      }
      expect(sys.fms.plans.displayed.legs.some((l) => l.type === 'DISCO')).toBe(false);
      mkp(r, 'EXEC');
      r.run(1);
      expect(suite.fmsHost.modPending).toBe(false);
      expect(v.get(FUSION_VARS.execLight)).toBe(0);
      const legs = sys.fms.plans.active.legs.map((l) => l.fix?.ident ?? l.type);
      LOG.push('plan: ' + legs.join(' '));
      expect(legs).toContain('RAV');
      expect(legs).toContain('NASTY');
      expect(legs).toContain('KERRS');
      expect(sys.fms.plans.active.approach?.ident).toBe('I28R');
      // PERF INIT: BOW, payload, cruise FL350, CONFIRM INIT.
      mkp(r, 'PERF');
      r.run(0.2);
      expect(w.pageId).toBe('PERF');
      type(r, String(G6K_LIMITS.bowLb / 1000));
      lsk(r, 'L1');
      type(r, String(payloadLb / 1000));
      lsk(r, 'L2');
      type(r, 'FL350');
      lsk(r, 'R1');
      lsk(r, 'R5');
      r.run(0.5);
      if (suite.fmsHost.modPending) mkp(r, 'EXEC');
      r.run(2);
      expect(suite.fmsHost.perf.confirmed).toBe(true);
      expect(v.get('fms.crz_alt_ft')).toBe(35000);
      const gwFms = suite.fmsHost.gwLb();
      const grossLb = v.get('fdm.mass_kg') / LBKG;
      LOG.push(`FMS GWT ${gwFms.toFixed(0)} lb vs actual ${grossLb.toFixed(0)} lb`);
      expect(Math.abs(gwFms - grossLb)).toBeLessThan(1500);
      const planNm = v.get('fms.dist_to_dest_nm');
      LOG.push(`fms: next ${v.getString('fms.next_wpt')} dist ${planNm.toFixed(1)} nm crz ${v.get('fms.crz_alt_ft')}`);
      expect(planNm).toBeGreaterThan(280);
      expect(planNm).toBeLessThan(360);
      // TAKEOFF REF: V-speeds for the actual weight, flaps 6.
      const sp = vSpeeds(grossLb);
      const v1 = Math.round(sp.v1);
      const vr = Math.round(sp.vr);
      const v2 = Math.round(sp.v2);
      w.show('TOLD');
      type(r, String(v1));
      lsk(r, 'L1');
      type(r, String(vr));
      lsk(r, 'L2');
      type(r, String(v2));
      lsk(r, 'L3');
      type(r, '6');
      lsk(r, 'R2');
      expect(v.get(FUSION_VARS.vspd('v1'))).toBe(v1);
      expect(v.get(FUSION_VARS.vspd('v2'))).toBe(v2);
      // FCP: FDs on, initial altitude 10,000 ft, runway heading, V2 + 10.
      setAlt(r, 10000);
      setHdg(r, Math.round(rw24.headingTrue - v.get('fdm.mag_var_deg')));
      setSpd(r, v2 + 10);
      expect(v.get('ap.sel_alt_ft')).toBe(10000);
      LOG.push(`gross ${grossLb.toFixed(0)} lb, V1/VR/V2 ${v1}/${vr}/${v2}`);
      log(r, 'avionics set up');

      // ================================================================ 6. taxi
      v.set(V.flapLever, 2); // slats / flaps 6
      v.set(V.nwsArm, 1);
      v.set(V.ltTaxi, 1);
      r.run(20);
      expect(v.get('surf.flaps_deg')).toBeCloseTo(6, 0);
      expect(v.get('surf.slats')).toBeGreaterThan(0.99);
      expect(checklistFails(r, 'AFTER START').filter((x) => !x.includes('Stab trim'))).toEqual([]);
      // Stab trim into the green band with the control-wheel trim switches (EST take-off setting ~7.5 units).
      r.run(20, () => {
        const u = v.get('trim.pitch_units');
        v.set(V.yokeTrim(1), u < 7.3 ? 1 : u > 7.8 ? -1 : 0);
        return u >= 7.3 && u <= 7.8;
      });
      v.set(V.yokeTrim(1), 0);
      r.run(0.5);
      expect(checklistFails(r, 'AFTER START')).toEqual([]);
      v.set(V.parkBrake, 0);
      r.run(2);
      expect(casActive(r)).not.toContain('PARK BRAKE ON');
      const rwAlong = () => alongTrackNm(rw24.lat, rw24.lon, far.lat, far.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      const rwCross = () => crossTrackNm(rw24.lat, rw24.lon, far.lat, far.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      let taxiMaxGs = 0;
      r.run(300, () => {
        const p = destinationPoint(rw24.lat, rw24.lon, rw24.headingTrue, (rwAlong() + 70) / 1852);
        taxiStep(r, p.lat, p.lon, Math.abs(rwCross()) > 30 ? 12 : 7);
        taxiMaxGs = Math.max(taxiMaxGs, v.get(FDM.gs));
        return Math.abs(rwCross()) < 2 && Math.abs(wrap180(v.get(FDM.headingTrue) - rw24.headingTrue)) < 2;
      });
      stopOnGround(r);
      const xt = Math.abs(rwCross());
      LOG.push(`lined up ${xt.toFixed(1)} m off the centre line, hdg ${v.get(FDM.headingTrue).toFixed(1)}, max taxi GS ${taxiMaxGs.toFixed(0)}`);
      expect(taxiMaxGs).toBeLessThan(25);
      expect(xt).toBeLessThan(15);
      expect(v.get('fdm.crashed')).toBe(0);
      log(r, 'lined up 24');

      // ================================================================ 7. BEFORE TAKEOFF / take-off
      v.set(V.ltLdgL, 1);
      v.set(V.ltLdgR, 1);
      v.set(V.ltLdgNose, 1);
      v.set(V.ltStrobe, 1);
      v.set(V.ltTaxi, 0);
      r.run(1);
      expect(checklistFails(r, 'BEFORE TAKEOFF')).toEqual([]);
      expect(casActive(r, 'warning')).toEqual([]);
      expect(casActive(r, 'caution')).toEqual([]);
      fcp(r, 'fd1');
      fcp(r, 'at'); // A/T engaged (armed on the ground)
      fcp(r, 'toga'); // TO/GA: TO / TO flight director modes, A/T TO
      fcp(r, 'nav'); // LNAV armed for after take-off
      LOG.push('takeoff FMA ' + fma(r));
      expect(v.getString('ap.vert_active')).toBe('TO');
      expect(v.getString('ap.lat_armed')).toContain('LNAV');
      expect(v.get('ap.at_engaged')).toBe(1);
      expect(v.getString('fadec.rating')).toBe('TO');
      v.set(INPUT.brakeLeft, 1);
      v.set(INPUT.brakeRight, 1);
      r.run(20, () => v.get('eng1.n1_pct') > 80 && v.get('eng2.n1_pct') > 80);
      v.set(INPUT.brakeLeft, 0);
      v.set(INPUT.brakeRight, 0);
      const brakeRelease = { lat: v.get(FDM.lat), lon: v.get(FDM.lon) };
      let liftoffFt = NaN;
      pilot.startTakeoff({ vrKt: vr, courseTrueDeg: rw24.headingTrue, lat: rw24.lat, lon: rw24.lon, pitchDeg: 11, gearUp: false });
      let n1To = 0;
      let holdSeen = false;
      let gearUpAgl = NaN;
      let tocw = false;
      r.run(90, () => {
        if (isNaN(liftoffFt) && !isNaN(pilot.log.liftoffIasKt)) liftoffFt = distanceNm(brakeRelease.lat, brakeRelease.lon, v.get(FDM.lat), v.get(FDM.lon)) * 6076.1;
        if (v.getString('ap.at_mode') === 'HOLD') holdSeen = true;
        if (v.get('alert.takeoff_config')) tocw = true;
        n1To = Math.max(n1To, v.get('eng1.n1_pct'));
        if (v.get(FDM.ias) > 100 && Math.abs(r.t * 4 - Math.round(r.t * 4)) < 0.01) LOG.push(`DBG to ias ${v.get(FDM.ias).toFixed(0)} pitch ${v.get(FDM.pitch).toFixed(1)} aoa ${v.get('fdm.aoa_deg').toFixed(1)} elev ${v.get('surf.elevator').toFixed(2)} in ${v.get(INPUT.pitch).toFixed(2)} gnd ${v.get('gear.air_ground')} trim ${v.get('trim.pitch_units').toFixed(2)} agl ${v.get(FDM.altAgl).toFixed(0)}`);
        const agl = v.get(FDM.altAgl);
        if (isNaN(gearUpAgl) && agl > 50 && v.get(FDM.vs) > 300) {
          gearUpAgl = agl;
          v.set(V.gearHandle, 0);
        }
        return agl > 500;
      });
      pilot.stop();
      LOG.push(`takeoff: rotate ${pilot.log.rotateIasKt.toFixed(0)} liftoff ${pilot.log.liftoffIasKt.toFixed(0)} KIAS at ${liftoffFt.toFixed(0)} ft, max N1 ${n1To.toFixed(1)}, max dev ${pilot.log.maxGroundDeviationM.toFixed(1)} m, max pitch ${pilot.log.maxPitchDeg.toFixed(1)}`);
      log(r, '500 ft AGL');
      expect(tocw).toBe(false);
      expect(holdSeen).toBe(true);
      expect(n1To).toBeGreaterThan(88);
      expect(n1To).toBeLessThanOrEqual(G6K_LIMITS.n1TakeoffPct + 0.1);
      // ~73,000 lb: lift-off well inside the MTOW take-off distance (SPEC 6,476 ft) and the 7,000 ft KTEB 24.
      expect(liftoffFt).toBeLessThan(4500);
      expect(pilot.log.liftoffIasKt).toBeLessThan(v2 + 15);
      expect(pilot.log.maxGroundDeviationM).toBeLessThan(5);
      expect(pilot.log.maxPitchDeg).toBeLessThan(18);

      // ================================================================ 8. AFTER TAKEOFF: AP, LNAV, FLC, slats / flaps up, VNAV climb
      v.set(INPUT.pitch, 0);
      v.set(INPUT.roll, 0);
      v.set(INPUT.yaw, 0);
      fcp(r, 'ap');
      expect(v.get('ap.engaged')).toBe(1);
      r.run(30, () => v.getString('ap.lat_active') === 'LNAV');
      log(r, 'AP on');
      expect(v.getString('ap.lat_active')).toBe('LNAV');
      setSpd(r, v2 + 20);
      fcp(r, 'flc');
      r.run(15);
      expect(v.get('gear.up_locked')).toBe(1);
      r.run(90, () => v.get(FDM.ias) > v2 + 15);
      v.set(V.flapLever, 1); // 0 OUT (slats only)
      setSpd(r, 200);
      r.run(90, () => v.get(FDM.ias) > 190);
      v.set(V.flapLever, 0); // 0 IN
      v.set(V.ltLdgNose, 0);
      setSpd(r, 250);
      r.run(40);
      expect(v.getString('ap.vert_active')).toBe('FLC');
      expect(v.get('surf.slats')).toBeLessThan(0.05);
      expect(checklistFails(r, 'AFTER TAKEOFF')).toEqual([]);
      log(r, 'clean, FLC');
      setAlt(r, 35000); // cleared FL350
      fcp(r, 'spd_man'); // FMS speed
      fcp(r, 'vnav');
      r.run(2);
      log(r, 'VNAV');
      expect(v.getString('ap.vert_active')).toMatch(/^V/);
      let maxBank = 0;
      let maxIas = 0;
      let ldgOff = false;
      let cabinMax = 0;
      let maxMachOver = -1;
      const climbT0 = r.t;
      r.run(2700, () => {
        maxBank = Math.max(maxBank, Math.abs(v.get(FDM.bank)));
        maxIas = Math.max(maxIas, v.get(FDM.ias));
        const alt = v.get(FDM.altMsl);
        maxMachOver = Math.max(maxMachOver, v.get(FDM.mach) - mmoAt(alt));
        cabinMax = Math.max(cabinMax, v.get('press.cabin_alt_ft'));
        if (Math.round(r.t) % 60 === 0 && Math.abs(r.t - Math.round(r.t)) < 0.01) LOG.push(`DBG climb ${alt.toFixed(0)} ias ${v.get(FDM.ias).toFixed(0)} M${v.get(FDM.mach).toFixed(3)} vs ${v.get(FDM.vs).toFixed(0)} ${fma(r)} rating ${v.getString('fadec.rating')} sel ${v.get('ap.sel_spd_kt')}/${v.get('ap.sel_mach')} cabin ${v.get('press.cabin_alt_ft').toFixed(0)}`);
        if (!ldgOff && alt > 10000) {
          ldgOff = true;
          v.set(V.ltLdgL, 0);
          v.set(V.ltLdgR, 0);
          v.set(V.seatBelts, 1);
        }
        if (alt > 18000 && v.get('adc1.baro_std') === 0) {
          ctp(r, 1, 'baro_push');
          ctp(r, 2, 'baro_push');
        }
        return Math.abs(alt - 35000) < 60 && /ALT/.test(v.getString('ap.vert_active')) && !/CAP/.test(v.getString('ap.vert_active'));
      });
      log(r, `level FL350 after ${((r.t - climbT0) / 60).toFixed(1)} min, cabin max ${cabinMax.toFixed(0)} ft`);
      expect(Math.abs(v.get('adc1.alt_ft') - 35000)).toBeLessThan(150);
      expect(maxBank).toBeLessThan(30);
      expect(maxIas).toBeLessThan(G6K_LIMITS.vmoKt);
      expect(maxMachOver).toBeLessThan(0);
      expect(Math.abs(v.get('fms.xtk_nm'))).toBeLessThan(1);
      expect(v.get('adc1.baro_std')).toBe(1);
      expect(v.get('adc2.baro_std')).toBe(1);
      expect(r.t - climbT0).toBeLessThan(30 * 60);
      expect(casActive(r, 'warning')).toEqual([]);
      expect(casActive(r, 'caution')).toEqual([]);

      // ================================================================ 9. cruise FL350 M0.85
      r.run(180);
      log(r, 'cruise');
      expect(v.getString('ap.lat_active')).toBe('LNAV');
      expect(Math.abs(v.get('adc1.alt_ft') - 35000)).toBeLessThan(65); // RVSM
      expect(v.getString('fadec.rating')).toBe('CRZ');
      const crzMach = v.get(FDM.mach);
      const ffCrz = v.get('eng1.ff_pph') + v.get('eng2.ff_pph');
      LOG.push(`cruise FL350 M${crzMach.toFixed(3)} ${v.get(FDM.tas).toFixed(0)} KTAS ${ffCrz.toFixed(0)} pph at ${(v.get('fdm.mass_kg') / LBKG).toFixed(0)} lb, cabin ${v.get('press.cabin_alt_ft').toFixed(0)} ft dP ${v.get('press.diff_psi').toFixed(2)}`);
      expect(crzMach).toBeGreaterThan(0.83);
      expect(crzMach).toBeLessThan(mmoAt(35000));
      // AOPA: 3,200 lb/h at FL410 M0.85 ~78,000 lb; FL350 costs more (EST band).
      expect(ffCrz).toBeGreaterThan(3000);
      expect(ffCrz).toBeLessThan(4800);
      // AOPA: 4,500 ft cabin at FL450; lower at FL350.
      expect(v.get('press.cabin_alt_ft')).toBeLessThan(4500);
      expect(v.get('press.diff_psi')).toBeGreaterThan(8);
      const fuel0 = v.get('fuel.total_kg');
      r.run(60);
      const burn = (fuel0 - v.get('fuel.total_kg')) / LBKG;
      expect(burn * 60).toBeGreaterThan(0.9 * ffCrz); // the tanks decrement at the engine flow
      expect(burn * 60).toBeLessThan(1.1 * ffCrz);

      // ================================================================ 10. descent: VNAV path
      setAlt(r, 5000);
      let pathSeen = false;
      let maxDesIas = 0;
      let maxDesMachOver = -1;
      r.run(3000, () => {
        speedbrakeStep(r);
        if (v.getString('ap.vert_active') === 'VPATH') pathSeen = true;
        maxDesIas = Math.max(maxDesIas, v.get(FDM.ias));
        maxDesMachOver = Math.max(maxDesMachOver, v.get(FDM.mach) - mmoAt(v.get(FDM.altMsl)));
        if (Math.round(r.t) % 60 === 0 && Math.abs(r.t - Math.round(r.t)) < 0.01) LOG.push(`DBG des ${v.get(FDM.altMsl).toFixed(0)} ias ${v.get(FDM.ias).toFixed(0)} vs ${v.get(FDM.vs).toFixed(0)} ${fma(r)} dist ${v.get('fms.dist_to_dest_nm').toFixed(0)} sb ${v.get(V.flightSpoiler)}`);
        if (v.get(FDM.altMsl) < 17500 && v.get('adc1.baro_std') === 1) {
          ctp(r, 1, 'baro_push');
          ctp(r, 2, 'baro_push');
        }
        return pathSeen && v.get('fms.dist_to_dest_nm') < 35;
      });
      log(r, 'descending, 35 nm to go');
      expect(pathSeen).toBe(true);
      expect(maxDesIas).toBeLessThan(G6K_LIMITS.vmoKt);
      expect(maxDesMachOver).toBeLessThan(0);
      expect(v.get('adc1.baro_std')).toBe(0);
      expect(checklistFails(r, 'DESCENT')).toEqual([]);

      // ================================================================ 11. approach: ILS 28R
      const wLand = v.get('fdm.mass_kg') / LBKG;
      const vref = Math.round(vSpeeds(wLand).vref);
      const vapp = vref + 5;
      w.show('LDG');
      type(r, String(vref));
      lsk(r, 'L1');
      type(r, String(vapp));
      lsk(r, 'L2');
      expect(v.get(FUSION_VARS.vspd('vref'))).toBe(vref);
      v.set(V.autobrake, 2); // MED
      v.set(V.ltLdgL, 1);
      v.set(V.ltLdgR, 1);
      v.set(V.seatBelts, 2);
      setSpd(r, 210);
      r.run(600, () => {
        speedbrakeStep(r);
        if (Math.abs(r.t * 0.1 - Math.round(r.t * 0.1)) < 0.001) LOG.push(`DBG slow ${v.get(FDM.altMsl).toFixed(0)} sel ${v.get('ap.sel_alt_ft')} ias ${v.get(FDM.ias).toFixed(0)} vs ${v.get(FDM.vs).toFixed(0)} ${fma(r)} dist ${v.get('fms.dist_to_dest_nm').toFixed(1)} next ${v.getString('fms.next_wpt')} tgt ${v.get('fms.vnav_tgt_alt_ft')} dev ${v.get('fms.vnav_dev_ft').toFixed(0)} thr ${distanceNm(v.get(FDM.lat), v.get(FDM.lon), rw28r.lat, rw28r.lon).toFixed(1)} sb ${v.get(V.flightSpoiler)}`);
        return v.get(FDM.ias) < 222;
      });
      v.set(V.flapLever, 1); // 0 OUT (VFE 225)
      setSpd(r, 190);
      r.run(120, () => {
        speedbrakeStep(r);
        return v.get(FDM.ias) < G6K_LIMITS.vfe6Kt - 10;
      });
      v.set(V.flapLever, 2); // 6 (VFE 210)
      log(r, 'slats out, flaps 6, 190 kt');
      r.run(900, () => {
        speedbrakeStep(r);
        if (Math.abs(r.t * 0.1 - Math.round(r.t * 0.1)) < 0.001) LOG.push(`DBG pre ${v.get(FDM.altMsl).toFixed(0)} sel ${v.get('ap.sel_alt_ft')} ias ${v.get(FDM.ias).toFixed(0)} vs ${v.get(FDM.vs).toFixed(0)} ${fma(r)} dist ${v.get('fms.dist_to_dest_nm').toFixed(1)} next ${v.getString('fms.next_wpt')} tgt ${v.get('fms.vnav_tgt_alt_ft')} dev ${v.get('fms.vnav_dev_ft')?.toFixed?.(0)} thr ${distanceNm(v.get(FDM.lat), v.get(FDM.lon), rw28r.lat, rw28r.lon).toFixed(1)}`);
        return v.get('fms.dist_to_dest_nm') < 20;
      });
      setSpd(r, 180);
      fcp(r, 'appr');
      r.run(1);
      log(r, 'APPR');
      expect(v.get('nav1.active_mhz')).toBeCloseTo(rw28r.ils!.freqMhz, 2); // nav-to-nav transfer
      expect(v.get(FUSION_VARS.navSource(1))).toBe(1); // PFD NAV SRC -> LOC1
      expect(v.get('ap.nav_source')).toBe(1);
      expect(v.getString('ap.lat_armed') + v.getString('ap.lat_active')).toContain('LOC');
      expect(v.getString('ap.vert_armed') + v.getString('ap.vert_active')).toContain('GS');
      let locT = NaN;
      let gsT = NaN;
      let maxLoc = 0;
      let maxGs = 0;
      let gearDn = false;
      let flaps30 = false;
      let maxFlapOverspeed = -Infinity;
      r.run(900, () => {
        speedbrakeStep(r);
        const lat = v.getString('ap.lat_active');
        const vfe = [340, G6K_LIMITS.vseKt, G6K_LIMITS.vfe6Kt, G6K_LIMITS.vfe16Kt, G6K_LIMITS.vfe30Kt][v.get(V.flapLever)];
        maxFlapOverspeed = Math.max(maxFlapOverspeed, v.get(FDM.ias) - vfe);
        if (isNaN(locT) && lat.startsWith('LOC')) {
          locT = r.t;
          setSpd(r, 165);
        }
        if (!isNaN(locT) && v.get(V.flapLever) < 3 && v.get(FDM.ias) < G6K_LIMITS.vfe16Kt - 20) v.set(V.flapLever, 3);
        if (!gearDn && !isNaN(locT) && v.get('nav1.gs_dev') < 0.6 && v.get(FDM.ias) < G6K_LIMITS.vloExtKt - 10) {
          gearDn = true;
          v.set(V.gearHandle, 1);
          v.set(V.ltLdgNose, 1);
        }
        if (isNaN(gsT) && v.getString('ap.vert_active') === 'GS') {
          gsT = r.t;
          setAlt(r, 5000); // missed-approach altitude
        }
        if (!flaps30 && gearDn && !isNaN(gsT) && v.get(FDM.ias) < G6K_LIMITS.vfe30Kt - 10) {
          flaps30 = true;
          v.set(V.flapLever, 4);
          setSpd(r, vapp);
        }
        const ra = v.get('ra1.alt_ft');
        if (Math.abs(r.t * 0.1 - Math.round(r.t * 0.1)) < 0.001) LOG.push(`DBG app ra ${ra.toFixed(0)} ias ${v.get(FDM.ias).toFixed(0)} sel ${v.get('ap.sel_spd_kt')} vs ${v.get(FDM.vs).toFixed(0)} flap ${v.get(V.flapLever)}/${v.get('surf.flaps_deg').toFixed(0)} gear ${v.get('gear.down_locked')} n1 ${v.get('eng1.n1_pct').toFixed(1)} tla ${v.get(V.tla(1)).toFixed(2)} ${fma(r)} gs ${v.get('nav1.gs_dev').toFixed(2)} sb ${v.get(V.flightSpoiler)}`);
        if (!isNaN(gsT) && ra > 250 && r.t > gsT + 20) {
          maxLoc = Math.max(maxLoc, Math.abs(v.get('nav1.cdi')));
          maxGs = Math.max(maxGs, Math.abs(v.get('nav1.gs_dev')));
        }
        return !isNaN(gsT) && ra < 1000 && ra > 0;
      });
      log(r, '1000 ft RA, stabilized');
      expect(isNaN(locT)).toBe(false);
      expect(isNaN(gsT)).toBe(false);
      expect(v.get('gear.down_locked')).toBe(1);
      expect(v.get('surf.flaps_deg')).toBeGreaterThan(29);
      expect(Math.abs(v.get(FDM.ias) - vapp)).toBeLessThan(8);
      expect(v.get(FDM.vs)).toBeLessThan(-450);
      expect(v.get(FDM.vs)).toBeGreaterThan(-1000);
      expect(maxLoc).toBeLessThan(0.5);
      expect(maxGs).toBeLessThan(0.5);
      expect(maxFlapOverspeed).toBeLessThan(0); // flaps / gear never above VFE / VLO
      expect(casActive(r, 'warning')).toEqual([]);
      expect(checklistFails(r, 'APPROACH')).toEqual([]);
      expect(checklistFails(r, 'LANDING')).toEqual([]);

      // ================================================================ 12. AP off at 200 ft (AP/SP DISC on the wheel), hand flare
      r.run(120, () => v.get('ra1.alt_ft') < AP_OFF_FT);
      // The 3D AP/SP DISC button writes its var and emits ap.disc (cockpit/flightControls.ts).
      r.events.emit('ap.disc');
      press(r, V.yokeDisc(1), 0.2);
      r.run(0.2);
      expect(v.get('ap.engaged')).toBe(0);
      log(r, 'AP disconnected');
      const thetaRef = v.get(FDM.pitch);
      let pInt = 0;
      let retardSeen = false;
      let tdVs = NaN;
      let tdIas = NaN;
      let tdDistFt = NaN;
      const thr = { lat: rw28r.lat, lon: rw28r.lon };
      const far2 = destinationPoint(rw28r.lat, rw28r.lon, rw28r.headingTrue, 2);
      const clAlong = () => alongTrackNm(thr.lat, thr.lon, far2.lat, far2.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      const clCross = () => crossTrackNm(thr.lat, thr.lon, far2.lat, far2.lon, v.get(FDM.lat), v.get(FDM.lon)) * 1852;
      r.run(60, () => {
        const ra = v.get('ra1.alt_ft');
        if (v.getString('ap.at_mode') === 'RETARD') retardSeen = true;
        // Glide path to 50 ft, then a flare to ~150 fpm (pilot: pitch attitude + sink rate on the yoke).
        const vsTgt = ra > 50 ? -700 : -Math.max(120, 700 * (ra / 50) * 0.9);
        const thetaCmd = thetaRef + Math.max(-3, Math.min(6, 0.004 * (vsTgt - v.get(FDM.vs)) + (ra < 50 ? 2.5 * (1 - ra / 50) : 0)));
        const e = thetaCmd - v.get(FDM.pitch);
        pInt = Math.max(-0.5, Math.min(0.5, pInt + (e * 0.02) / 60));
        v.set(INPUT.pitch, Math.max(-1, Math.min(1, 0.12 * e + pInt - 0.05 * v.get(FDM.q))));
        const bankCmd = Math.max(-5, Math.min(5, -0.05 * clCross() - 0.5 * wrap180(v.get(FDM.trackTrue) - rw28r.headingTrue)));
        v.set(INPUT.roll, Math.max(-1, Math.min(1, 0.05 * (bankCmd - v.get(FDM.bank)))));
        if (v.get('gear.air_ground') === 1) {
          tdVs = v.get(FDM.vs);
          tdIas = v.get(FDM.ias);
          tdDistFt = clAlong() / 0.3048;
          return true;
        }
      });
      log(r, 'touchdown');
      LOG.push(`touchdown ${tdVs.toFixed(0)} fpm, ${tdIas.toFixed(0)} KIAS (VAPP ${vapp}), ${tdDistFt.toFixed(0)} ft past the threshold, ${clCross().toFixed(1)} m off centre`);
      expect(retardSeen).toBe(true);
      expect(tdVs).toBeGreaterThan(-600);
      expect(tdIas).toBeGreaterThan(vapp - 20);
      expect(tdIas).toBeLessThan(vapp + 5);
      expect(tdDistFt).toBeGreaterThan(300);
      expect(tdDistFt).toBeLessThan(3000);
      expect(v.get('fdm.crashed')).toBe(0);

      // ================================================================ 13. rollout: GLD, reversers, autobrake MED
      let maxGsp = 0;
      let maxRevN1 = 0;
      let abSeen = false;
      let stopDistFt = NaN;
      v.set(V.tla(1), 0);
      v.set(V.tla(2), 0);
      r.run(90, (t) => {
        maxGsp = Math.max(maxGsp, v.get('surf.ground_spoilers'));
        if (v.get('brakes.autobrake_active')) abSeen = true;
        v.set(INPUT.pitch, t < 3 ? -0.1 : 0);
        v.set(INPUT.roll, 0);
        const p = destinationPoint(thr.lat, thr.lon, rw28r.headingTrue, (clAlong() + 150) / 1852);
        const err = wrap180(bearingTo(r, p.lat, p.lon) - v.get(FDM.headingTrue));
        v.set(INPUT.yaw, Math.max(-0.3, Math.min(0.3, err / 10)));
        const ias = v.get(FDM.ias);
        // Piggy-back reverse levers: MAX REV to 80 kt, IDLE REV, stowed by 40 kt (EST technique).
        const rev = ias > 80 ? 1 : ias > 40 ? 0.1 : 0;
        v.set(V.revLever(1), rev);
        v.set(V.revLever(2), rev);
        if (rev > 0.5) maxRevN1 = Math.max(maxRevN1, v.get('eng1.n1_pct'));
        if (v.get(FDM.gs) < 25) {
          stopDistFt = clAlong() / 0.3048;
          return true;
        }
      });
      v.set(V.revLever(1), 0);
      v.set(V.revLever(2), 0);
      log(r, 'rollout 25 kt');
      LOG.push(`rollout: ground spoilers ${maxGsp.toFixed(2)}, max reverse N1 ${maxRevN1.toFixed(1)}, autobrake ${abSeen}, 25 kt at ${stopDistFt.toFixed(0)} ft past the threshold (runway ${rw28r.lengthFt} ft)`);
      expect(maxGsp).toBeGreaterThan(0.9);
      expect(maxRevN1).toBeGreaterThan(50);
      expect(maxRevN1).toBeLessThanOrEqual(G6K_LIMITS.revN1Pct + 0.5); // TCDS: FADEC limits reverse N1 to 70 %
      expect(abSeen).toBe(true);
      // SPEC landing distance 2,236 ft (from 50 ft, typical weight): the ground roll to 25 kt fits well inside it.
      expect(stopDistFt - tdDistFt).toBeLessThan(2600);
      expect(Math.abs(clCross())).toBeLessThan(10);
      r.run(3);
      expect(v.get('ap.at_engaged')).toBe(0);

      // ================================================================ 14. after landing, taxi clear, shutdown
      v.set(INPUT.yaw, 0);
      v.set(INPUT.brakeLeft, 0.3); // pedal braking disarms the autobrake
      v.set(INPUT.brakeRight, 0.3);
      r.run(1);
      v.set(V.autobrake, 0);
      v.set(V.flapLever, 0);
      v.set(V.ltLdgL, 0);
      v.set(V.ltLdgR, 0);
      v.set(V.ltLdgNose, 0);
      v.set(V.ltStrobe, 0);
      v.set(V.ltTaxi, 1);
      const exit = destinationPoint(thr.lat, thr.lon, rw28r.headingTrue, (clAlong() + 120) / 1852);
      const ramp2 = destinationPoint(exit.lat, exit.lon, rw28r.headingTrue + 90, 250 / 1852);
      const exitAlong = alongTrackNm(thr.lat, thr.lon, far2.lat, far2.lon, exit.lat, exit.lon) * 1852;
      r.run(300, () => {
        const tgt = clAlong() < exitAlong - 20 ? exit : ramp2;
        taxiStep(r, tgt.lat, tgt.lon, 12);
        return distanceNm(v.get(FDM.lat), v.get(FDM.lon), ramp2.lat, ramp2.lon) < 0.02;
      });
      stopOnGround(r);
      log(r, 'parked');
      expect(Math.abs(clCross())).toBeGreaterThan(150);
      v.set(V.parkBrake, 1);
      v.set(INPUT.brakeLeft, 0);
      v.set(INPUT.brakeRight, 0);
      v.set(V.ltTaxi, 0);
      // APU for the shutdown (ground power), engines cool 2 min (EST), ENG RUN OFF.
      v.set(V.apuSw, 1);
      r.run(11);
      v.set(V.apuSw, 2);
      r.run(1.5);
      v.set(V.apuSw, 1);
      r.run(80, () => v.get('apu.avail') === 1);
      expect(v.get('apu.avail')).toBe(1);
      r.run(40);
      v.set(V.engRun(1), 0);
      v.set(V.engRun(2), 0);
      r.run(60);
      log(r, 'engines stopped');
      expect(v.get('eng1.running') + v.get('eng2.running')).toBe(0);
      expect(v.get('elec.apu_gen_online')).toBe(1);
      expect(v.get('elec.ac_bus1_powered')).toBe(1);
      expect(casActive(r, 'warning')).toEqual([]);
      // Securing: IRS OFF, APU OFF, lights / signs OFF, EMER LIGHTS OFF, BATT MASTER OFF.
      for (const n of [1, 2, 3] as const) v.set(V.irsMode(n), 0);
      v.set(V.apuSw, 0);
      r.run(90);
      expect(v.get('apu.running')).toBe(0);
      for (const k of [V.ltBeacon, V.ltNav, V.seatBelts, V.noSmoking, V.emerLights, V.wshldL, V.wshldR]) v.set(k, 0);
      for (const p of ['1b', '2b', '3a', '3b'] as const) v.set(V.hydPump(p), 0);
      v.set(V.battMaster, 0);
      r.run(5);
      log(r, 'cold & dark');
      expect(v.get('elec.dc_ess_powered')).toBe(0);
      expect(v.get('elec.batt_bus_powered')).toBe(0);
      expect(v.get('display.fusion.afd1.power')).toBe(0);
      expect(v.get('fdm.crashed')).toBe(0);
    } finally {
      // eslint-disable-next-line no-console
      console.log(LOG.join('\n'));
    }
  });
});
