/**
 * Procedures & checklists audit probes (read-only auditor, lens = procedures): executes the
 * POH 172SPHUS Rev 5 Section 4 normal checklists and the Supplement 15 KAP 140 preflight from
 * cold & dark through the cockpit control vars only, and logs every checklist auto-check at the
 * point the item is performed. Nothing real-world is asserted (the suite stays green); the audit
 * report quotes the logged values ([PROC] lines).
 */
import { describe, it } from 'vitest';
import { AP, ENG, SURF } from '../../../../src/core/vars';
import { ANN, ANN_SW, C172, DOOR, MAG } from '../../../../src/aircraft/c172s-common/vars';
import { KAP, KMA, KT, KX, KLN, KR, ST, EV } from '../../../../src/aircraft/c172-steam/vars';
import { C172_STEAM_CHECKLISTS } from '../../../../src/aircraft/c172-steam/checklists';
import type { InitialState } from '../../../../src/aircraft/types';
import { makeSteamRig, type SteamRig } from '../rig';

const log = (k: string, x: unknown): void => console.log(`[PROC] ${k}: ${JSON.stringify(x)}`);

function list(title: string) {
  const l = C172_STEAM_CHECKLISTS.find((c) => c.title === title);
  if (!l) throw new Error(`no checklist ${title}`);
  return l;
}
/** Evaluates item `idx` (or the first item whose challenge contains `match`) of a list. */
function chk(r: SteamRig, title: string, match: string | number, nth = 0): string {
  const l = list(title);
  let it;
  if (typeof match === 'number') it = l.items[match];
  else it = l.items.filter((i) => i.challenge.includes(match))[nth];
  if (!it) return `NO ITEM '${match}'`;
  if (!it.check) return 'no-check';
  return it.check(r.vars) ? 'PASS' : 'FAIL';
}
function evalAll(r: SteamRig, title: string): string[] {
  return list(title).items.map((i) => `${i.challenge.trim()} -> ${i.check ? (i.check(r.vars) ? 'PASS' : 'FAIL') : '-'}`);
}
function setRpm(r: SteamRig, target: number): number {
  const v = r.vars;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 12; i++) {
    const mid = 0.5 * (lo + hi);
    v.set(C172.throttle, mid);
    r.run(3);
    if (v.get(ENG.rpm(1)) < target) lo = mid;
    else hi = mid;
  }
  v.set(C172.throttle, 0.5 * (lo + hi));
  r.run(6);
  return v.get(ENG.rpm(1));
}

describe('c172-steam procedures probes', () => {
  it('lists, order and phases', () => {
    log('lists', C172_STEAM_CHECKLISTS.map((c) => `${c.phase} | ${c.title} (${c.items.length})`));
  });

  it('cold & dark -> preflight cabin -> before start -> start -> run-up -> KAP 140 preflight', () => {
    const r = makeSteamRig({ state: 'cold_dark' });
    const v = r.vars;
    r.run(1);
    const PC = 'Preflight Inspection — Cabin';
    log('cold_dark preflight cabin (as found)', evalAll(r, PC));
    // 4 Parking brake SET, 5 control lock REMOVE, 6 ignition OFF, 7 avionics OFF
    v.set(C172.controlLock, 0);
    // 8 master ON
    v.set(C172.masterBat, 1);
    v.set(C172.masterAlt, 1);
    r.run(2);
    log('ann lamps 2 s after MASTER ON (flash period)', ['oil_press', 'low_fuel_l', 'low_fuel_r', 'vac_l', 'vac_r', 'volts'].map((k) => v.get(`ac.c172.lamp.${k}`)));
    r.run(11);
    log('ann lamps 13 s after MASTER ON', ['oil_press', 'low_fuel_l', 'low_fuel_r', 'vac_l', 'vac_r', 'volts'].map((k) => v.get(`ac.c172.lamp.${k}`)));
    log('9 fuel quantity / low fuel check', chk(r, PC, 'Fuel Quantity'));
    // 10-12 avionics master ON, fan, OFF
    v.set(C172.avionicsBus1, 1);
    v.set(C172.avionicsBus2, 1);
    r.run(1);
    log('avionics ON on the ground, engine off: avn fan powered / sound plays', [v.get('elec.avn_fan_powered'), r.log.plays.slice(-6)]);
    log('avionics ON: KAP on / pft / KMA on / KX1 on (radios left OFF by cold preset)', [v.get(KAP.on), v.get(KAP.pft), v.get(KMA.on), v.get(KX(1).on)]);
    v.set(C172.avionicsBus1, 0);
    v.set(C172.avionicsBus2, 0);
    r.run(0.5);
    log('13 alt static OFF', chk(r, PC, 'Static Pressure'));
    // 14 ann TEST hold
    v.set(C172.annSwitch, ANN_SW.test);
    r.run(1);
    log('14 TST held: lamps + pitch trim lamp + annTest', [['oil_press', 'low_fuel_l', 'low_fuel_r', 'vac_l', 'vac_r', 'volts'].map((k) => v.get(`ac.c172.lamp.${k}`)), v.get(KAP.pitchTrimLamp), v.get(ST.annTest)]);
    v.set(C172.annSwitch, ANN_SW.day);
    r.run(0.5);
    log('16/17 selector BOTH / shutoff ON', [chk(r, PC, 'Fuel Selector'), chk(r, PC, 'Fuel Shutoff')]);
    // 18 flaps EXTEND
    v.set(C172.flapLever, 3);
    r.run(12);
    log('18 flaps extend -> surf.flaps_deg', v.get(SURF.flapsDeg));
    // 19 pitot heat ON 30 s
    v.set(C172.pitotHeat, 1);
    r.run(30);
    const pitotKeys = [...r.vars.keys()].filter((k) => /pitot/.test(k));
    log('19 pitot heat 30 s: pitot vars', pitotKeys.map((k) => `${k}=${v.get(k).toFixed(2)}`));
    v.set(C172.pitotHeat, 0);
    // 21 master OFF
    v.set(C172.masterBat, 0);
    v.set(C172.masterAlt, 0);
    r.run(1);
    log('preflight cabin end', evalAll(r, PC));
    log('trim position vs TAKEOFF', v.get('trim.pitch_units'));

    // BEFORE STARTING ENGINE
    const BS = 'Before Starting Engine';
    log('before start (flaps still 30 from preflight)', evalAll(r, BS));

    // STARTING ENGINE
    const SE = 'Starting Engine (With Battery)';
    v.set(C172.keyIn, 1);
    v.set(C172.throttle, 0.08);
    v.set(C172.mixture, 0);
    log('start items 1-2', [chk(r, SE, 0), chk(r, SE, 1)]);
    v.set(C172.masterBat, 1);
    v.set(C172.masterAlt, 1);
    v.set(C172.beacon, 1);
    r.run(1);
    v.set(C172.fuelPump, 1);
    v.set(C172.mixture, 1);
    let ffMax = 0;
    r.run(4, () => void (ffMax = Math.max(ffMax, v.get(ENG.fuelFlowGph(1)), v.get('ac.eng1.ff_ind_gph'))));
    log('prime: fuel flow gph during pump ON + mixture rich 4 s (gauge)', [ffMax, v.get(ENG.fuelFlowGph(1)), v.get(ENG.fuelFlowPph(1))]);
    v.set(C172.mixture, 0);
    v.set(C172.fuelPump, 0);
    v.set(C172.magneto, MAG.start);
    let started = false;
    r.run(10, () => {
      if (v.get(ENG.rpm(1)) > 450) v.set(C172.mixture, 1);
      if (v.get(ENG.running(1)) > 0.5 && v.get(ENG.rpm(1)) > 700) return (started = true);
      return false;
    });
    v.set(C172.magneto, MAG.both);
    v.set(C172.mixture, 1);
    r.run(20);
    log('started / rpm / oil psi', [started, v.get(ENG.rpm(1)), v.get(ENG.oilPressPsi(1))]);
    v.set(C172.avionicsBus1, 1);
    v.set(C172.avionicsBus2, 1);
    r.run(1);
    log('avionics ON after start; radios still OFF (cold preset knobs)', [v.get(KX(1).on), v.get(KX(2).on), v.get(KMA.on), v.get(KT.on), v.get(KR.on), v.get(KLN.on)]);
    // Radios ON
    v.set(KX(1).comVol, 0.6);
    v.set(KX(2).comVol, 0.6);
    v.set(KMA.power, 1);
    v.set(KT.mode, 1);
    v.set(KR.vol, 0.5);
    v.set(KLN.power, 1);
    v.set(C172.flapLever, 0);
    r.run(12);
    log('starting engine list', evalAll(r, SE));

    // Leaning for ground operations
    const r1200 = setRpm(r, 1200);
    let best = 0;
    let bestMix = 1;
    for (let m = 1; m >= 0.4; m -= 0.05) {
      v.set(C172.mixture, m);
      r.run(3);
      if (v.get(ENG.rpm(1)) > best) {
        best = v.get(ENG.rpm(1));
        bestMix = m;
      }
    }
    v.set(C172.mixture, bestMix);
    r.run(3);
    log('leaning for ground ops: 1200 rpm rich -> best rpm at mixture', [r1200, best, bestMix]);
    setRpm(r, 1000);

    // BEFORE TAKEOFF
    const BT = 'Before Takeoff';
    log('before takeoff as found (cold preset doors CLOSED not locked)', evalAll(r, BT));
    v.set(C172.doorLeft, DOOR.locked);
    v.set(C172.doorRight, DOOR.locked);
    v.set(C172.mixture, 1);
    const rpm1800 = setRpm(r, 1800);
    log('1800 rpm set', rpm1800);
    log('throttle 1800 check / vac check / vac inHg / amps', [chk(r, BT, 'Throttle', 0), chk(r, BT, 'Vacuum'), v.get('ac.vac.suction_inhg'), v.get('elec.batt_amps')]);
    v.set(C172.magneto, MAG.right);
    r.run(6);
    const rR = v.get(ENG.rpm(1));
    v.set(C172.magneto, MAG.both);
    r.run(5);
    v.set(C172.magneto, MAG.left);
    r.run(6);
    const rL = v.get(ENG.rpm(1));
    v.set(C172.magneto, MAG.both);
    r.run(5);
    log('mag check drops R/L', [rpm1800 - rR, rpm1800 - rL]);
    log('annunciators at 1800 (lamps)', ['oil_press', 'low_fuel_l', 'low_fuel_r', 'vac_l', 'vac_r', 'volts'].map((k) => v.get(`ac.c172.lamp.${k}`)));
    v.set(C172.throttle, 0);
    r.run(8);
    log('idle rpm', v.get(ENG.rpm(1)));
    setRpm(r, 1000);
    log('throttle idle/1000 check', chk(r, BT, 'CHECK IDLE'));

    // KAP 140 preflight (Supplement 15 Sec 4 A)
    const KP = 'KAP 140 Preflight (Perform Prior to Each Flight)';
    log('KAP preflight as found', evalAll(r, KP));
    const trim0 = v.get('trim.pitch_units');
    v.set(ST.metLeft, -1);
    r.run(3);
    log('MET LH DN alone 3 s: trim moved', v.get('trim.pitch_units') - trim0);
    v.set(ST.metLeft, 0);
    v.set(ST.metRight, 1);
    r.run(5.5);
    log('MET RH UP alone 5.5 s: trim moved / KAP.pt', [v.get('trim.pitch_units') - trim0, v.get(KAP.pt)]);
    v.set(ST.metRight, 0);
    r.run(0.5);
    v.set(ST.metLeft, -1);
    v.set(ST.metRight, -1);
    r.run(1);
    const t1 = v.get('trim.pitch_units');
    v.set(ST.apDisc, 1);
    r.run(1);
    const t2 = v.get('trim.pitch_units');
    v.set(ST.apDisc, 0);
    r.run(1);
    const t3 = v.get('trim.pitch_units');
    v.set(ST.metLeft, 0);
    v.set(ST.metRight, 0);
    log('MET both DN: moved / with DISC held / after release', [t1 - trim0, t2 - t1, t3 - t2]);
    r.run(0.5);
    // baro
    log('baro flash before', v.get(KAP.baroFlash));
    v.set(KAP.baro, 1);
    r.run(0.3);
    v.set(KAP.baro, 0);
    r.run(0.3);
    log('baro flash after BARO press', v.get(KAP.baroFlash));
    r.events.emit(EV.kap('ap'));
    r.run(0.5);
    log('AP engage on ground (single event)', v.get(AP.engaged));
    if (v.get(AP.engaged) < 0.5) {
      // Hold AP (the supplement's "press and hold" for the engage).
      for (let i = 0; i < 20; i++) {
        r.events.emit(EV.kap('ap'));
        r.run(1 / 30);
      }
      r.run(0.5);
      log('AP engage on ground (held)', v.get(AP.engaged));
    }
    log('KAP preflight after engage', evalAll(r, KP));
    v.set(ST.apDisc, 1);
    r.run(0.3);
    v.set(ST.apDisc, 0);
    r.run(0.5);
    log('after A/P DISC press: engaged / apFlash / disconnect tone', [v.get(AP.engaged), v.get(KAP.apFlash), r.log.toneOn.slice(-4)]);
    log('KAP preflight end', evalAll(r, KP));
    log('KAP before takeoff', evalAll(r, 'KAP 140 Before Takeoff'));
    log('KLN 94', evalAll(r, 'KLN 94 GPS Turn-On and Self Test'));
    v.set(C172.flapLever, 1);
    r.run(6);
    v.set(C172.parkingBrake, 0);
    r.run(0.5);
    log('before takeoff end', evalAll(r, BT));
    log('xpdr mode after manual radios ON (SBY) -- takeoff items have no XPDR ALT item', [v.get(KT.mode), v.get('xpdr.mode')]);
  });

  for (const s of ['cold_dark', 'ready_to_taxi', 'takeoff', 'cruise', 'approach'] as InitialState[]) {
    it(`preset ${s}: switch positions and checklist checks`, () => {
      const air = s === 'cruise' ? { altFtMsl: 6000, iasKt: 105 } : s === 'approach' ? { altFtMsl: 2000, iasKt: 80 } : undefined;
      const r = makeSteamRig({ state: s, air });
      const v = r.vars;
      r.run(3);
      const sw = {
        bat: v.get(C172.masterBat), alt: v.get(C172.masterAlt), avn1: v.get(C172.avionicsBus1), avn2: v.get(C172.avionicsBus2),
        mags: v.get(C172.magneto), key: v.get(C172.keyIn), thr: +v.get(C172.throttle).toFixed(3), mix: +v.get(C172.mixture).toFixed(3),
        pump: v.get(C172.fuelPump), sel: v.get(C172.fuelSelector), shutoff: v.get(C172.fuelShutoff), flapLever: v.get(C172.flapLever),
        flaps: +v.get(SURF.flapsDeg).toFixed(1), pbrake: v.get(C172.parkingBrake), lock: v.get(C172.controlLock),
        bcn: v.get(C172.beacon), nav: v.get(C172.nav), strobe: v.get(C172.strobe), land: v.get(C172.land), taxi: v.get(C172.taxi), pitot: v.get(C172.pitotHeat),
        doors: [v.get(C172.doorLeft), v.get(C172.doorRight)], xpdr: v.get(KT.mode), kma: v.get(KMA.power), kx1: v.get(KX(1).comVol), kln: v.get(KLN.power),
        ap: v.get(AP.engaged), rpm: Math.round(v.get(ENG.rpm(1))), trim: +v.get('trim.pitch_units').toFixed(3), altsel: v.get(AP.selAltitude),
        baroFlash: v.get(KAP.baroFlash), kapPft: v.get(KAP.pft), cabinHeat: v.get(C172.cabinHeat), cabinAir: v.get(C172.cabinAir),
        lamps: ['oil_press', 'low_fuel_l', 'low_fuel_r', 'vac_l', 'vac_r', 'volts'].map((k) => +v.get(`ac.c172.lamp.${k}`).toFixed(2)),
        battA: +v.get('elec.batt_amps').toFixed(1), vac: +v.get('ac.vac.suction_inhg').toFixed(2), ann: v.get(C172.annSwitch),
      };
      log(`${s} switches`, sw);
      const lists = s === 'cold_dark' ? ['Preflight Inspection — Cabin', 'Before Starting Engine', 'After Landing / Securing Airplane']
        : s === 'ready_to_taxi' ? ['Starting Engine (With Battery)', 'Before Takeoff', 'KAP 140 Preflight (Perform Prior to Each Flight)', 'KLN 94 GPS Turn-On and Self Test']
          : s === 'takeoff' ? ['Before Takeoff', 'Normal Takeoff', 'KAP 140 Before Takeoff']
            : s === 'cruise' ? ['Enroute Climb / Cruise']
              : ['Descent / Before Landing', 'Normal Landing', 'KAP 140 Approach (APR) and Glideslope Coupling (DG)'];
      for (const t of lists) log(`${s} :: ${t}`, evalAll(r, t));
    });
  }

  it('emergency list auto-checks are reachable with cockpit controls', () => {
    const r = makeSteamRig({ state: 'cruise', air: { altFtMsl: 6000, iasKt: 105 } });
    const v = r.vars;
    r.run(2);
    // VOLTS in flight: pull ALT FLD, confirm annunciator, then POH steps.
    v.set('cb.alt_fld', 0);
    r.run(20);
    log('ALT FLD pulled 20 s: volts lamp / batt amps / bus V', [v.get(ANN.lamp('volts')), v.get('elec.batt_amps'), v.get('elec.bus1_v')]);
    log('VOLTS list with CB pulled', evalAll(r, 'EMERGENCY — Low Voltage Annunciator (VOLTS) In Flight'));
    v.set('cb.alt_fld', 1);
    v.set(C172.masterAlt, 0);
    v.set(C172.masterBat, 0);
    r.run(0.5);
    v.set(C172.masterBat, 1);
    v.set(C172.masterAlt, 1);
    r.run(5);
    log('VOLTS list after reset', evalAll(r, 'EMERGENCY — Low Voltage Annunciator (VOLTS) In Flight'));
    log('Engine fire / electrical fire lists', [evalAll(r, 'EMERGENCY — Engine Fire In Flight'), evalAll(r, 'EMERGENCY — Electrical Fire In Flight')]);
    // KAP emergency: pull AUTO PILOT CB
    v.set('cb.autopilot', 0);
    r.run(0.5);
    log('AP malfunction list with AUTO PILOT CB pulled', evalAll(r, 'EMERGENCY — Autopilot, Autopilot Trim or Manual Electric Trim Malfunction'));
    log('icing list', evalAll(r, 'EMERGENCY — Inadvertent Icing Encounter'));
  });
});
