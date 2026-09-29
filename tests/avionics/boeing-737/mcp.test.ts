import { describe, expect, it } from 'vitest';
import { makeSuite, type SuiteRig } from './helpers';
import { AP, FDM } from '../../../src/core/vars';
import { B737_EVENTS, B737_VARS, type McpButton } from '../../../src/avionics/boeing-737/vars';

/** Airborne, straight and level at `altFt`, 250 kt, heading 090, sensors valid. */
function fly(t: SuiteRig, altFt = 10000, vsFpm = 0): void {
  const v = t.vars;
  for (const s of [1, 2]) {
    v.set(`adc${s}.valid`, 1);
    v.set(`ahrs${s}.valid`, 1);
    v.set(`ahrs${s}.pitch_deg`, 2);
    v.set(`ahrs${s}.bank_deg`, 0);
    v.set(`ahrs${s}.hdg_mag_deg`, 90);
    v.set(`adc${s}.ias_kt`, 250);
    v.set(`adc${s}.mach`, 0.45);
    v.set(`adc${s}.tas_kt`, 290);
    v.set(`adc${s}.alt_ft`, altFt);
    v.set(`adc${s}.vs_fpm`, vsFpm);
  }
  v.set('ra1.valid', 0);
  v.set('ra2.valid', 0);
  v.set('gps.valid', 1);
  v.set('gps.gs_kt', 290);
  v.set('gps.trk_mag_deg', 90);
  v.set('gear.air_ground', 0);
  v.set('surf.flaps_deg', 0);
}

const press = (t: SuiteRig, b: McpButton) => {
  t.events.emit(B737_EVENTS.mcpButton(b));
  t.run(0.1);
};
const fma = (t: SuiteRig) => ({
  at: t.vars.getString(B737_VARS.fmaAt),
  roll: t.vars.getString(B737_VARS.fmaRoll),
  rollArmed: t.vars.getString(B737_VARS.fmaRollArmed),
  pitch: t.vars.getString(B737_VARS.fmaPitch),
  pitchArmed: t.vars.getString(B737_VARS.fmaPitchArmed),
  status: t.vars.getString(B737_VARS.fmaStatus),
});

async function airborne(altFt = 10000): Promise<SuiteRig> {
  const t = await makeSuite();
  t.suite.applyState('cruise');
  fly(t, altFt);
  t.vars.set(AP.selAltitude, altFt);
  t.vars.set(AP.selHeading, 90);
  t.vars.set(AP.selSpeed, 250);
  t.run(0.5);
  return t;
}

describe('737NG MCP knobs and windows', () => {
  it('speed / heading / altitude / course knobs step per FCOM and fill the windows', async () => {
    const t = await airborne();
    t.events.emit(B737_EVENTS.mcpSpdInc, 5);
    t.events.emit(B737_EVENTS.mcpHdgDec, 100);
    t.events.emit(B737_EVENTS.mcpAltInc, 20);
    t.events.emit(B737_EVENTS.mcpCrsInc(1), 45);
    t.run(0.1);
    expect(t.vars.get(AP.selSpeed)).toBe(255);
    expect(t.vars.get(AP.selHeading)).toBe(350);
    expect(t.vars.get(AP.selAltitude)).toBe(12000);
    expect(t.vars.get(AP.selCourse(1))).toBe(45);
    expect(t.vars.get('nav1.obs_deg')).toBe(45);
    expect(t.vars.getString(B737_VARS.mcpWinSpd)).toBe('255');
    expect(t.vars.getString(B737_VARS.mcpWinHdg)).toBe('350');
    expect(t.vars.getString(B737_VARS.mcpWinAlt)).toBe('12000');
    expect(t.vars.getString(B737_VARS.mcpWinCrs(1))).toBe('045');
    // V/S window blank until V/S engages.
    expect(t.vars.getString(B737_VARS.mcpWinVs)).toBe('');
  });

  it('bank angle selector steps through 10..30 deg', async () => {
    const t = await airborne();
    t.events.emit(B737_EVENTS.mcpBankInc, 3);
    t.run(0.05);
    expect(t.vars.get('ap.bank_sel_deg')).toBe(30);
    t.events.emit(B737_EVENTS.mcpBankDec, 10);
    t.run(0.05);
    expect(t.vars.get('ap.bank_sel_deg')).toBe(10);
  });

  it('C/O toggles IAS / Mach and the window shows .xx', async () => {
    const t = await airborne();
    press(t, 'co');
    expect(t.vars.get(AP.speedIsMach)).toBe(1);
    expect(t.vars.getString(B737_VARS.mcpWinSpd)).toMatch(/^\.\d\d$/);
  });

  it('an unpowered MCP ignores the knobs and blanks the windows', async () => {
    const t = await makeSuite({ power: { mcp: 'ac.test_mcp_pwr' } });
    t.run(0.1);
    t.events.emit(B737_EVENTS.mcpAltInc, 10);
    t.run(0.1);
    expect(t.vars.get(AP.selAltitude)).toBe(0);
    expect(t.vars.getString(B737_VARS.mcpWinAlt)).toBe('');
    t.vars.set('ac.test_mcp_pwr', 1);
    t.events.emit(B737_EVENTS.mcpAltInc, 10);
    t.run(0.1);
    expect(t.vars.get(AP.selAltitude)).toBe(1000);
  });
});

describe('737NG AFDS mode transitions', () => {
  it('F/D on: HDG SEL and ALT HOLD annunciate, button lights follow', async () => {
    const t = await airborne();
    t.vars.set(AP.selAltitude, 15000);
    press(t, 'hdgsel');
    press(t, 'althld');
    const f = fma(t);
    expect(f.roll).toBe('HDG SEL');
    expect(f.pitch).toBe('ALT HOLD');
    expect(f.status).toBe('FD');
    expect(t.vars.get(B737_VARS.mcpLight('hdgsel'))).toBe(1);
    expect(t.vars.get(B737_VARS.mcpLight('althld'))).toBe(1);
  });

  it('ALT HOLD at the MCP altitude does not light the ALT HLD switch (FCOM 4.10)', async () => {
    const t = await airborne();
    press(t, 'althld');
    expect(fma(t).pitch).toBe('ALT HOLD');
    expect(t.vars.get(B737_VARS.mcpLight('althld'))).toBe(0);
  });

  it('CMD A engages (status CMD, A/P light), DISENGAGE bar disconnects and inhibits', async () => {
    const t = await airborne();
    press(t, 'cmd_a');
    expect(t.vars.get(AP.engaged)).toBe(1);
    expect(fma(t).status).toBe('CMD');
    expect(t.vars.get(B737_VARS.mcpLight('cmd_a'))).toBe(1);
    t.vars.set(B737_VARS.mcpDisengageBar, 1);
    t.run(0.2);
    expect(t.vars.get(AP.engaged)).toBe(0);
    // A/P disengage light flashes red after the disconnect.
    let red = false;
    for (let i = 0; i < 20; i++) {
      t.run(0.05);
      if (t.vars.get(B737_VARS.apDiscLight) === 1) red = true;
    }
    expect(red).toBe(true);
    press(t, 'cmd_a');
    expect(t.vars.get(AP.engaged)).toBe(0);
    t.vars.set(B737_VARS.mcpDisengageBar, 0);
    press(t, 'cmd_b');
    expect(t.vars.get(AP.engaged)).toBe(1);
  });

  it('LVL CHG to a higher MCP altitude: MCP SPD pitch, then ALT ACQ near the target', async () => {
    const t = await airborne();
    press(t, 'cmd_a');
    t.vars.set(AP.selAltitude, 14000);
    press(t, 'lvlchg');
    expect(fma(t).pitch).toBe('MCP SPD');
    expect(t.vars.get(B737_VARS.mcpLight('lvlchg'))).toBe(1);
    // Climbing close to the selected altitude: capture.
    fly(t, 13800, 1500);
    t.run(0.5);
    expect(fma(t).pitch).toBe('ALT ACQ');
    fly(t, 14000, 0);
    t.run(6);
    expect(fma(t).pitch).toBe('ALT HOLD');
  });

  it('V/S engages with the current vertical speed, window opens and wheel steps 50 / 100 fpm', async () => {
    const t = await airborne();
    press(t, 'cmd_a');
    t.vars.set(AP.selAltitude, 5000);
    fly(t, 10000, -800);
    t.run(0.1);
    press(t, 'vs');
    expect(fma(t).pitch).toBe('V/S');
    expect(t.vars.getString(B737_VARS.mcpWinVs)).not.toBe('');
    t.vars.set(AP.selVs, -800);
    t.events.emit(B737_EVENTS.mcpVsUp, 2); // UP on the wheel = nose down
    t.run(0.05);
    expect(t.vars.get(AP.selVs)).toBe(-900);
    t.vars.set(AP.selVs, -1000);
    t.events.emit(B737_EVENTS.mcpVsUp, 1);
    t.run(0.05);
    expect(t.vars.get(AP.selVs)).toBe(-1100);
  });

  it('VOR LOC arms then captures; APP arms G/S and gives LAND 3 / FLARE / ROLLOUT with dual channels', async () => {
    const t = await airborne(3000);
    const v = t.vars;
    for (const r of [1, 2]) {
      v.set(`nav${r}.powered`, 1);
      v.set(`nav${r}.received`, 1);
      v.set(`nav${r}.is_loc`, 1);
      v.set(`nav${r}.cdi`, 1.5);
      v.set(`nav${r}.loc_course_deg`, 90);
      v.set(`nav${r}.gs_valid`, 1);
      v.set(`nav${r}.gs_dev`, 1.5);
      v.set(`ap.sel_crs${r}_deg`, 90);
    }
    press(t, 'cmd_a');
    press(t, 'hdgsel');
    press(t, 'app');
    let f = fma(t);
    expect(f.rollArmed).toBe('VOR/LOC');
    expect(f.pitchArmed).toContain('G/S');
    expect(t.vars.get(B737_VARS.mcpLight('app'))).toBe(1);
    // Second channel may be engaged once APP is armed (dual-channel approach).
    press(t, 'cmd_b');
    expect(t.vars.get(B737_VARS.mcpLight('cmd_a'))).toBe(1);
    expect(t.vars.get(B737_VARS.mcpLight('cmd_b'))).toBe(1);
    // Localizer and glideslope capture.
    for (const r of [1, 2]) {
      v.set(`nav${r}.cdi`, 0.05);
      v.set(`nav${r}.gs_dev`, 0.05);
    }
    t.run(1);
    f = fma(t);
    expect(f.roll).toBe('VOR/LOC');
    expect(f.pitch).toBe('G/S');
    // Below 1,500 ft RA: FLARE armed, LAND 3 status after the autoland checks.
    v.set('ra1.valid', 1);
    v.set('ra2.valid', 1);
    fly(t, 1400, -700);
    v.set('ra1.valid', 1);
    v.set('ra2.valid', 1);
    v.set('ra1.alt_ft', 1300);
    v.set('ra2.alt_ft', 1300);
    t.run(3);
    f = fma(t);
    expect(t.vars.get('ap.channels')).toBe(2);
    expect(f.pitchArmed).toContain('FLARE');
    expect(f.status).toMatch(/LAND 3|LAND 2/);
    expect(f.rollArmed).toBe('ROLLOUT');
  });

  it('VNAV and LNAV armed on the ground engage at 400 ft / 50 ft RA (FCOM)', async () => {
    // Instant GPS acquisition; the GPS receiver reads the FDM truth position.
    const t = await makeSuite({ radiosOptions: { navCount: 2, adfCount: 2, gps: { acquisitionS: 0 } } }, true);
    t.suite.applyState('takeoff');
    await t.suite.fms!.loadRoute('KTEB/24 DIXIE V1 HFD PUT BOS KBOS');
    t.suite.fms!.plans.exec();
    t.suite.fms!.plans.active.cruiseAltFt = 24000;
    t.vars.set(AP.selAltitude, 15000);
    t.vars.set('gear.air_ground', 1);
    t.vars.set(FDM.lat, 40.85);
    t.vars.set(FDM.lon, -74.06);
    t.vars.set(FDM.altMsl, 9);
    t.run(0.3);
    press(t, 'lnav');
    press(t, 'vnav');
    let f = fma(t);
    expect(f.rollArmed).toBe('LNAV');
    expect(f.pitchArmed).toContain('VNAV');
    expect(t.vars.get(B737_VARS.mcpLight('lnav'))).toBe(1);
    // 30 ft RA: still armed (LNAV engages at 50 ft, VNAV at 400 ft).
    fly(t, 40, 2000);
    t.vars.set('ra1.valid', 1);
    t.vars.set('ra1.alt_ft', 30);
    t.run(0.2);
    f = fma(t);
    expect(f.rollArmed).toBe('LNAV');
    expect(f.pitchArmed).toContain('VNAV');
    fly(t, 450, 2000);
    t.vars.set('ra1.valid', 1);
    t.vars.set('ra1.alt_ft', 450);
    t.run(0.5);
    f = fma(t);
    expect(f.roll).toBe('LNAV');
    expect(f.pitch).toBe('VNAV SPD');
    expect(f.pitchArmed).not.toContain('VNAV');
    expect(f.pitch.startsWith('VNAV')).toBe(true);
    // The IAS/MACH window blanks in VNAV; SPD INTV opens it.
    expect(t.vars.get(B737_VARS.mcpSpdBlank)).toBe(1);
    t.events.emit(B737_EVENTS.mcpSpdIntv);
    t.run(0.1);
    expect(t.vars.get(B737_VARS.mcpSpdBlank)).toBe(0);
    expect(t.vars.get(B737_VARS.mcpSpdIntv)).toBe(1);
  });

  it('A/T ARM, N1 and SPEED modes annunciate on the FMA', async () => {
    const t = await airborne();
    t.vars.set('ac.at_arm', 1);
    t.run(0.2);
    expect(t.vars.get(B737_VARS.mcpLight('at_arm'))).toBe(1);
    press(t, 'speed');
    t.run(0.2);
    expect(fma(t).at).toBe('MCP SPD');
    expect(t.vars.get(B737_VARS.mcpLight('speed'))).toBe(1);
    press(t, 'n1');
    t.run(0.2);
    expect(fma(t).at).toBe('N1');
  });

  it('disengage light TEST: position 1 amber, position 2 red', async () => {
    const t = await airborne();
    t.vars.set(B737_VARS.discLightTest, -1);
    t.run(0.05);
    expect(t.vars.get(B737_VARS.apDiscLight)).toBe(2);
    expect(t.vars.get(B737_VARS.atDiscLight)).toBe(2);
    t.vars.set(B737_VARS.discLightTest, 1);
    t.run(0.05);
    expect(t.vars.get(B737_VARS.apDiscLight)).toBe(1);
    t.vars.set(B737_VARS.discLightTest, 0);
    t.run(0.05);
    expect(t.vars.get(B737_VARS.apDiscLight)).toBe(0);
  });
});
