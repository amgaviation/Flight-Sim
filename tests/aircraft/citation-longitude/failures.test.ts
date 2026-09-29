/**
 * Key failures produce the right CAS messages and system reactions
 * (OG Section 3, 5, 13; fire protection EST).
 */
import { describe, expect, it } from 'vitest';
import { makeRig, type Rig } from './helpers';
import { LON_VARS as V } from '../../../src/aircraft/citation-longitude/vars';

const posted = (r: Rig) => r.sys.cas.list.filter((e) => e.active).map((e) => `${e.level}:${e.text}`);

describe('Citation Longitude failures -> CAS', () => {
  it('generator failure: GEN FAIL L, bus tie closes automatically, left buses stay powered', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 35000, iasKt: 260 } });
    const v = r.vars;
    r.run(5);
    expect(v.get('elec.bus_tie_closed')).toBe(0);
    r.sys.failures.trigger('elec.gen_l');
    r.run(8);
    expect(v.get('elec.gen_l_online')).toBe(0);
    expect(posted(r)).toContain('caution:GEN FAIL L');
    expect(v.get('alert.master_caution')).toBe(1);
    expect(v.get('elec.bus_tie_closed')).toBe(1); // OG 5-6: primary source on one side only -> tie
    expect(v.get('elec.mission_l_v')).toBeGreaterThan(26);
    expect(v.get('elec.main_l_powered')).toBe(1);
    // White BUS TIE CLOSED while one side has no generator.
    expect(posted(r)).toContain('advisory:BUS TIE CLOSED');
    // Deselecting the other generator too (both off with engines running) -> red GENS OFF.
    v.set(V.genR, 0);
    r.run(3);
    expect(posted(r)).toContain('warning:GENS OFF');
    expect(v.get('alert.master_warning')).toBe(1);
  });

  it('hydraulic system A leak: HYD PRESS LOW A, rudder standby takes over, B keeps pressure', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 30000, iasKt: 270 } });
    const v = r.vars;
    r.run(5);
    r.sys.failures.trigger('hyd.a.leak');
    r.run(240);
    expect(v.get('hyd.a_psi')).toBeLessThan(1500);
    expect(posted(r)).toContain('caution:HYD PRESS LOW A');
    expect(v.get(V.rssActive)).toBe(1); // OG 13-3: RSS powers the rudder on loss of system A
    expect(v.get('hyd.rss_psi')).toBeGreaterThan(2500);
    expect(v.get('hyd.b_psi')).toBeGreaterThan(2500);
    expect(posted(r)).not.toContain('caution:RUDDER FAIL A-B');
    // Rudder standby OFF as well -> RUDDER FAIL A-B and YAW DAMPER FAIL A/B (OG 15-3).
    v.set(V.rudderStby, 0);
    r.run(20);
    expect(posted(r)).toContain('caution:RUDDER STANDBY OFF');
    expect(posted(r)).toContain('caution:RUDDER FAIL A-B');
    expect(posted(r)).toContain('caution:YAW DAMPER FAIL A/B');
  });

  it('engine fire: ENG FIRE L warning; ENG FIRE switchlight shuts fuel/hydraulics/bleed; bottle extinguishes', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 25000, iasKt: 280 } });
    const v = r.vars;
    r.run(5);
    r.sys.failures.trigger('fire.eng1');
    r.run(3);
    expect(v.get('fire.eng1_warn')).toBe(1);
    expect(posted(r)).toContain('warning:ENG FIRE L');
    expect(v.get('alert.master_warning')).toBe(1);
    r.events.emit('cas.ack_warning');
    r.run(0.5);
    expect(v.get('alert.master_warning')).toBe(0);
    // Crew: push the L ENG FIRE switchlight (arms the bottles, closes the firewall valves), discharge bottle 1.
    v.set(V.fireEngL, 1);
    r.run(1);
    expect(v.get('fuel.eng1_on')).toBe(0);
    expect(v.get('pneu.eng1_valve_open')).toBe(0);
    v.set(V.bottle1, 1);
    r.run(0.5);
    v.set(V.bottle1, 0);
    r.run(10);
    if (v.get('fire.eng1_warn')) {
      v.set(V.bottle2, 1); // second shot (probabilistic extinguishing)
      r.run(0.5);
      v.set(V.bottle2, 0);
      r.run(10);
    }
    expect(v.get('fire.bottle1_discharged')).toBe(1);
    expect(v.get('eng1.running')).toBe(0);
    expect(posted(r)).toContain('warning:ENGINE FAIL L'); // FADEC: RUN selected, engine stopped
    expect(v.get('eng2.running')).toBe(1);
  });

  it('engine flameout: ENGINE FAIL R; RUN/STOP to STOP -> ENGINE SHUTDOWN R', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 30000, iasKt: 270 } });
    const v = r.vars;
    r.run(5);
    r.sys.fuel.setTankKg('right', 0); // right tank empty (no crossfeed selected): flameout
    r.run(15);
    expect(v.get('eng2.running')).toBe(0);
    expect(posted(r)).toContain('warning:ENGINE FAIL R');
    v.set(V.runR, 0);
    r.run(3);
    expect(posted(r)).not.toContain('warning:ENGINE FAIL R');
    expect(posted(r)).toContain('advisory:ENGINE SHUTDOWN R');
  });

  it('cabin altitude: loss of pressurization posts CABIN ALTITUDE (amber > 8,500 ft, red > 9,800 ft)', { timeout: 120000 }, () => {
    const r = makeRig('cruise', { weightLb: 34000, avionics: false, air: { altFtMsl: 41000, iasKt: 240 } });
    const v = r.vars;
    r.run(5);
    expect(v.get('press.cabin_alt_ft')).toBeLessThan(6000);
    r.sys.failures.trigger('press.decompression');
    r.run(60);
    expect(v.get('press.cabin_alt_ft')).toBeGreaterThan(9800);
    expect(posted(r)).toContain('warning:CABIN ALTITUDE');
    expect(v.get('press.pax_masks')).toBe(1);
  });
});
