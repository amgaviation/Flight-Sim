import { describe, expect, it } from 'vitest';
import { SimVars } from '../../../src/core/SimVars';
import { EventBus } from '../../../src/core/EventBus';
import { AP, FMS, GPS, INPUT, NAV } from '../../../src/core/vars';
import { Afcs } from '../../../src/systems/autopilot/Afcs';
import { AFCS_B737_AFDS, AFCS_GFC700_G1000, AFCS_GFC700_G3000, AFCS_KAP140, AFCS_PRIMUS_EPIC } from '../../../src/systems/autopilot/presets';
import { AFCS_VARS, AtRequest } from '../../../src/systems/autopilot/vars';
import { ARM } from '../../../src/systems/autopilot/types';
import { TestPlant } from './plant';

const DT = 1 / 60;

function setup(preset = AFCS_GFC700_G3000, opts: ConstructorParameters<typeof TestPlant>[1] = {}) {
  const vars = new SimVars();
  const events = new EventBus();
  const plant = new TestPlant(vars, opts);
  const afcs = new Afcs({ vars, events }, { ...preset });
  const run = (s: number, each?: (t: number) => void): void =>
    plant.run(s, (t) => {
      each?.(t);
      afcs.update(DT);
    });
  return { vars, events, plant, afcs, run };
}

describe('AFCS basic engagement and roll/heading laws', () => {
  it('GFC 700: AP engages in ROL/PIT with FD on; ROL levels the wings below 6° bank', () => {
    const { vars, afcs, plant, run } = setup();
    plant.phi = 4;
    run(0.1);
    afcs.press('AP');
    expect(afcs.engaged).toBe(true);
    expect(afcs.lat).toBe('ROL');
    expect(afcs.vert).toBe('PIT');
    expect(vars.get(AP.fdOn(1))).toBe(1);
    run(20);
    expect(Math.abs(plant.phi)).toBeLessThan(0.5);
    expect(vars.getString(AP.lateralActive)).toBe('ROL');
    expect(vars.getString(AP.verticalActive)).toBe('PIT');
  });

  it('ROL holds an established bank above 6°', () => {
    const { afcs, plant, run } = setup();
    plant.phi = 15;
    run(0.1);
    afcs.press('AP');
    run(20);
    expect(plant.phi).toBeGreaterThan(13.5);
    expect(plant.phi).toBeLessThan(16.5);
  });

  it('HDG turns the short way to the bug within the bank limit and converges', () => {
    const { vars, afcs, plant, run } = setup(AFCS_GFC700_G1000);
    plant.psi = 0;
    run(0.1);
    afcs.press('AP');
    vars.set(AP.selHeading, 90);
    afcs.press('HDG');
    let maxBank = 0;
    run(90, () => {
      maxBank = Math.max(maxBank, Math.abs(plant.phi));
    });
    expect(maxBank).toBeLessThanOrEqual(22.5); // GFC 700 in the 172: 22°
    expect(Math.abs(plant.psi - 90)).toBeLessThan(1.5);
    expect(Math.abs(plant.phi)).toBeLessThan(1);
    // Left turn through north
    vars.set(AP.selHeading, 330);
    run(3);
    expect(plant.phi).toBeLessThan(-3);
  });

  it('half bank limits the bank angle', () => {
    const { vars, afcs, plant, run } = setup(AFCS_PRIMUS_EPIC);
    run(0.1);
    afcs.press('AP');
    afcs.press('HALF_BANK');
    vars.set(AP.selHeading, 120);
    afcs.press('HDG');
    let maxBank = 0;
    run(30, () => (maxBank = Math.max(maxBank, Math.abs(plant.phi))));
    expect(maxBank).toBeLessThan(14.5);
    expect(maxBank).toBeGreaterThan(12);
  });

  it('KAP 140 engages ROL + VS holding the vertical speed at engagement; UP adds 100 fpm per press', () => {
    const { vars, afcs, plant, run } = setup(AFCS_KAP140, { tasKt: 110 });
    plant.gamma = 2;
    plant.theta = 4;
    run(0.2);
    afcs.press('AP');
    expect(afcs.lat).toBe('ROL');
    expect(afcs.vert).toBe('VS');
    const vs0 = vars.get(AP.selVs);
    expect(Math.abs(vs0 - Math.round(vars.get('adc1.vs_fpm') / 100) * 100)).toBeLessThan(1);
    afcs.press('UP');
    afcs.press('UP');
    expect(vars.get(AP.selVs)).toBe(vs0 + 200);
    run(40);
    expect(Math.abs(vars.get('adc1.vs_fpm') - (vs0 + 200))).toBeLessThan(60);
  });
});

describe('AFCS vertical laws', () => {
  it('VS converges on the selected vertical speed', () => {
    const { vars, afcs, run } = setup(AFCS_GFC700_G3000, { n1: 75 });
    run(0.1);
    afcs.press('AP');
    afcs.press('VS');
    vars.set(AP.selVs, 1500);
    run(40);
    expect(Math.abs(vars.get('adc1.vs_fpm') - 1500)).toBeLessThan(50);
  });

  it('ALT holds the altitude at engagement against a disturbance', () => {
    const { vars, afcs, plant, run } = setup();
    run(0.1);
    afcs.press('AP');
    afcs.press('ALT');
    expect(afcs.altRef).toBe(5000);
    plant.theta += 3; // gust
    let maxDev = 0;
    run(60, (t) => {
      if (t > 1) maxDev = Math.max(maxDev, Math.abs(plant.alt - 5000));
    });
    expect(maxDev).toBeLessThan(80);
    expect(Math.abs(plant.alt - 5000)).toBeLessThan(10);
  });

  it('ALTS arms in VS toward the selected altitude, captures asymptotically and transitions to ALT', () => {
    const { vars, afcs, plant, run } = setup(AFCS_GFC700_G3000, { n1: 80 });
    vars.set(AP.selAltitude, 7000);
    run(0.1);
    afcs.press('AP');
    afcs.press('VS');
    vars.set(AP.selVs, 2000);
    run(1);
    expect(afcs.vertArmed & ARM.ALTS).toBe(ARM.ALTS);
    expect(vars.getString(AP.verticalArmed)).toContain('ALTS');
    const seen: string[] = [];
    let maxAlt = 0;
    run(150, () => {
      if (seen[seen.length - 1] !== afcs.vert) seen.push(afcs.vert);
      maxAlt = Math.max(maxAlt, plant.alt);
    });
    expect(seen).toEqual(['VS', 'ALTS', 'ALT']);
    expect(maxAlt - 7000).toBeLessThan(40);
    expect(Math.abs(plant.alt - 7000)).toBeLessThan(10);
    expect(vars.getString(AP.verticalActive)).toBe('ALT');
  });

  it('FLC holds the selected speed in a climb with fixed thrust (never descends)', () => {
    const { vars, afcs, plant, run } = setup(AFCS_GFC700_G3000, { n1: 85, tasKt: 200 });
    vars.set(AP.selAltitude, 20000);
    run(0.1);
    afcs.press('AP');
    afcs.press('FLC');
    expect(vars.get(AP.selSpeed)).toBe(200);
    vars.set(AP.selSpeed, 190);
    let minVs = Infinity;
    run(90, (t) => {
      if (t > 5) minVs = Math.min(minVs, vars.get('adc1.vs_fpm'));
    });
    expect(Math.abs(plant.tas - 190)).toBeLessThan(2);
    expect(minVs).toBeGreaterThan(0);
    expect(vars.get(AFCS_VARS.atRequest)).toBe(AtRequest.Thrust);
  });

  it('PIT follows the nose up/down wheel', () => {
    const { afcs, plant, run } = setup();
    run(0.1);
    afcs.press('AP');
    const p0 = afcs.pitchRef;
    afcs.press('UP', 4);
    expect(afcs.pitchRef).toBeCloseTo(p0 + 2, 5);
    run(15);
    expect(Math.abs(plant.theta - (p0 + 2))).toBeLessThan(0.3);
  });
});

describe('AFCS navigation capture', () => {
  it('LOC arms, captures inside the lead and tracks; GS arms, captures and tracks (Garmin APR)', () => {
    const { vars, afcs, plant, run } = setup(AFCS_GFC700_G3000, { tasKt: 150, x: -12, y: 1.5, hdgDeg: 120, altFt: 2600 });
    plant.enableIls(90, 1, 3);
    vars.set(AFCS_VARS.navSource, 1);
    vars.set(AP.selAltitude, 0);
    run(0.1);
    afcs.press('AP');
    vars.set(AP.selHeading, 120);
    afcs.press('HDG');
    afcs.press('ALT');
    afcs.press('APR');
    expect(afcs.latArmed).toBe('LOC');
    expect(afcs.vertArmed & ARM.GS).toBe(ARM.GS);
    expect(vars.getString(AP.lateralArmed)).toBe('LOC');
    let capX = NaN;
    let gsX = NaN;
    run(220, () => {
      if (Number.isNaN(capX) && afcs.lat === 'LOC') capX = plant.x;
      if (Number.isNaN(gsX) && afcs.vert === 'GS') gsX = plant.x;
    });
    expect(Number.isNaN(capX)).toBe(false);
    expect(Number.isNaN(gsX)).toBe(false);
    expect(gsX).toBeGreaterThan(capX);
    // Tracking: localizer and glideslope deviation small.
    expect(Math.abs(vars.get(NAV.cdi(1)))).toBeLessThan(0.1);
    expect(Math.abs(vars.get(NAV.gsDev(1)))).toBeLessThan(0.2);
    expect(vars.getString(AP.lateralActive)).toBe('LOC');
    expect(vars.getString(AP.verticalActive)).toBe('GS');
  });

  it('LOC tracking on GPS track holds no steady offset when the station declination differs from today\'s variation', () => {
    // Station declared 14.0 E, today's variation 12.8 E: the localizer's magnetic course is 1.2 deg
    // smaller than the true course (090 in the plant) expressed in today's magnetic reference.
    const track = (withStationVar: boolean) => {
      const { vars, afcs, plant, run } = setup(AFCS_GFC700_G3000, { tasKt: 150, x: -12, y: 0.4, hdgDeg: 100, altFt: 2600 });
      plant.enableIls(90, 1, 3);
      vars.set(AFCS_VARS.navSource, 1);
      vars.set(AP.selAltitude, 2600);
      vars.set(AP.selHeading, 100);
      const skew = () => {
        vars.set(NAV.locCourse(1), 90 - 1.2);
        vars.set(NAV.obs(1), 90 - 1.2);
        vars.set(GPS.magVar, 12.8);
        if (withStationVar) vars.set(NAV.stationMagVar(1), 14.0);
      };
      skew();
      run(0.1, skew);
      afcs.press('AP');
      afcs.press('HDG');
      afcs.press('ALT');
      afcs.press('NAV');
      let worst = 0;
      run(200, (t) => {
        skew();
        if (t > 120) worst = Math.max(worst, Math.abs(vars.get(NAV.devDeg(1))));
      });
      expect(afcs.lat).toBe('LOC');
      return worst;
    };
    // Without the declination the law flies the stale course: a steady offset remains.
    expect(track(false)).toBeGreaterThan(0.1);
    // With nav{r}.station_magvar_deg the course is referred to today's variation: centred.
    expect(track(true)).toBeLessThan(0.02);
  });

  it('LNAV follows the FMS roll command once captured', () => {
    const { vars, afcs, plant, run } = setup();
    vars.set(FMS.lnavValid, 1);
    vars.set(FMS.xtkNm, 0.3);
    vars.set(FMS.dtkMag, 0);
    vars.set(FMS.lnavBankCmd, 12);
    vars.set(AFCS_VARS.navSource, 0);
    run(0.1);
    afcs.press('AP');
    afcs.press('NAV');
    run(0.2);
    expect(afcs.lat).toBe('LNAV');
    expect(vars.getString(AP.lateralActive)).toBe('FMS');
    run(15);
    expect(Math.abs(plant.phi - 12)).toBeLessThan(0.5);
  });
});

describe('Boeing 737 AFDS', () => {
  it('CMD with no FD modes engages in CWS R / CWS P; column force becomes a rate command', () => {
    const { vars, afcs, plant, run } = setup(AFCS_B737_AFDS, { tasKt: 250 });
    run(0.1);
    afcs.press('CMD_A');
    expect(afcs.engaged).toBe(true);
    expect(afcs.lat).toBe('CWS');
    expect(afcs.vert).toBe('CWS');
    expect(vars.getString(AP.lateralActive)).toBe('CWS R');
    expect(vars.get(AFCS_VARS.forcePitch)).toBe(1);
    // Pilot rolls with force (input), then releases: bank held
    vars.set(INPUT.roll, 0.6);
    run(2);
    vars.set(INPUT.roll, 0);
    const b = plant.phi;
    expect(b).toBeGreaterThan(8);
    run(10);
    expect(Math.abs(plant.phi - b)).toBeLessThan(2.5);
  });

  it('override in CMD reverts the axis to CWS; the trim switch disconnects', () => {
    const { vars, afcs, run } = setup(AFCS_B737_AFDS, { tasKt: 250 });
    run(0.1);
    afcs.press('CMD_A');
    vars.set(AP.selHeading, 0);
    afcs.press('HDG');
    vars.set(AP.selAltitude, 5000);
    afcs.press('ALT');
    expect(afcs.vert).toBe('ALT');
    vars.set(INPUT.pitch, 0.5);
    run(0.5);
    expect(afcs.vert).toBe('CWS');
    expect(afcs.lat).toBe('HDG');
    vars.set(INPUT.pitch, 0);
    vars.set(INPUT.pitchTrimRate, 1);
    run(0.1);
    expect(afcs.engaged).toBe(false);
    expect(vars.get(AFCS_VARS.discWarn)).toBe(1);
    // Warning stays (Boeing) until reset by a second DISC press
    run(10);
    expect(vars.get(AFCS_VARS.discWarn)).toBe(1);
    afcs.press('DISC');
    expect(vars.get(AFCS_VARS.discWarn)).toBe(0);
  });

  it('dual-channel APP: FLARE armed below 1500 ft, FLARE at 50 ft RA, A/T retard requested', () => {
    const { vars, afcs, plant, run } = setup(AFCS_B737_AFDS, { tasKt: 145, x: -9, y: 0, hdgDeg: 90, altFt: 2860 });
    plant.enableIls(90, 1, 3);
    run(0.1);
    afcs.press('CMD_A');
    afcs.press('APP');
    expect(afcs.latArmed).toBe('LOC');
    afcs.press('CMD_B');
    expect(afcs.cmdA && afcs.cmdB).toBe(true);
    let flareArmedAt = NaN;
    let flareAt = NaN;
    let retardReq = false;
    let statusAt100 = '';
    run(260, () => {
      const ra = plant.alt;
      if (Number.isNaN(flareArmedAt) && (afcs.vertArmed & ARM.FLARE) !== 0) flareArmedAt = ra;
      if (Number.isNaN(flareAt) && afcs.vert === 'FLARE') flareAt = ra;
      if (vars.get(AFCS_VARS.atRequest) === AtRequest.Retard) retardReq = true;
      if (!statusAt100 && ra < 100) statusAt100 = vars.getString(AFCS_VARS.autoland);
      if (plant.alt <= 0) {
        plant.alt = 0;
        plant.gamma = 0;
      }
    });
    expect(afcs.channels).toBe(2);
    expect(flareArmedAt).toBeLessThan(1500);
    expect(flareAt).toBeLessThanOrEqual(50.5);
    expect(flareAt).toBeGreaterThan(40);
    expect(retardReq).toBe(true);
    expect(statusAt100).toBe('LAND 3');
  });

  it('TO/GA on the ground: 10° nose down below 60 kt, 15° nose up above; A/T takeoff request', () => {
    const { vars, afcs, plant, run } = setup(AFCS_B737_AFDS, { tasKt: 40, altFt: 0 });
    vars.set('gear.air_ground', 1);
    vars.set(AP.fdOn(1), 1);
    afcs.update(DT);
    vars.set('gear.air_ground', 1);
    afcs.press('TOGA');
    afcs.update(DT);
    expect(afcs.vert).toBe('TO');
    expect(afcs.lat).toBe('HDG');
    expect(vars.get(AFCS_VARS.atRequest)).toBe(AtRequest.Takeoff);
    for (let i = 0; i < 400; i++) afcs.update(DT);
    expect(afcs.pitchCmd).toBeCloseTo(-10, 0);
    vars.set('adc1.ias_kt', 80);
    for (let i = 0; i < 800; i++) afcs.update(DT);
    expect(afcs.pitchCmd).toBeCloseTo(15, 0);
    void plant;
  });
});
