/**
 * 737-800 main instrument panel: Captain P1, centre P2 and F/O P3 on one
 * flat panel (layout.ts MIP), plus the standby magnetic compass on the
 * windshield centre post and the manual gear extension handle in the floor.
 *
 * Contents (dossier §10.12 / §10.13; FCOM 10.10, 14.10, 15.20):
 *  P1 / P3: outboard (PFD) and inboard (ND) DUs; clock with CHR push and ET
 *    HLD / RUN / RESET switch; TAKEOFF CONFIG and CABIN ALTITUDE warning
 *    lights; A/P, A/T, FMC P/RST lights (+ disengage light TEST on P1);
 *    MAIN PANEL DUs / LOWER DU selectors and DU brightness; Captain LIGHTS
 *    TEST / BRT / DIM switch and NOSE WHEEL STEERING ALT / NORM switch;
 *    PANEL, BACKGROUND, AFDS FLOOD, GLARESHIELD FLOOD dimmers; SPEEDBRAKE
 *    ARMED / DO NOT ARM, STAB OUT OF TRIM, SPEEDBRAKE EXTENDED lights;
 *    BELOW G/S P-INHIBIT switch-lights; F/O GPWS panel (FLAP / GEAR / TERR
 *    INHIBIT, SYS TEST, INOP); HYD BRAKE PRESS gauge.
 *  P2: upper and lower DUs; ISFD (APP, HP/IN, -, +, RST, BARO knob with STD
 *    push); gear lever with the six gear lights and the lock override;
 *    AUTO BRAKE selector, AUTO BRAKE DISARM and ANTISKID INOP; flap
 *    position indicator with LE FLAPS TRANSIT / EXT and FLAP LOAD RELIEF;
 *    MFD / N1 SET / SPD REF / FUEL FLOW (suite centre controls).
 * Positions are EST from 737NG flight-deck photographs (layout.ts).
 */
import { GearHandle, GuardedSwitch, PushButton, RotaryKnob, SelectorKnob, TBarHandle } from '../../../cockpit/controls';
import { MagneticCompass } from '../../../avionics/analog';
import { addCentreControls, addDisengageLights, addDisplaySelect, addDisplayUnits, addDuBrightness } from '../../../avionics/boeing-737';
import { DISPLAY_VARS } from '../../../cockpit/types';
import { B738, B738_DISPLAY_IDS } from '../vars';
import type { B738CockpitContext } from './context';
import { CK, seg } from './context';
import { annunciator, dimmer, toggle } from './common';
import { ClockDisplay, DialDisplay, FLAP_DIAL, IsfdDisplay } from './displays';
import { COMPASS, DU_ROW_V, DU_U, FLOOR_Z, LOWER_DU_V, MIP } from './layout';

export function buildMainPanel(c: B738CockpitContext): void {
  const { b, env, ctx, sys } = c;
  const vars = ctx.vars;
  const p = b.panel({ name: 'b738.mip', ...MIP, origin: 'center', material: 'panel', screws: { kind: 'dzus', diameter: 0.008, pitch: 0.25 } });
  const suite = sys.suite;

  // ---------------------------------------------------------------- display units
  if (suite.du.length) {
    addDisplayUnits(
      p,
      suite,
      suite.du.map((d) => [DU_U[d.du], d.du === 'lower' ? LOWER_DU_V : DU_ROW_V] as const),
    );
  }

  // ---------------------------------------------------------------- Captain / F/O outboard strips
  for (const s of [1, 2] as const) {
    const sg = s === 1 ? -1 : 1;
    const ux = sg * 0.8;
    const pfx = `b738.mip${s}`;
    if (!c.headless) {
      const clk = new ClockDisplay(vars, `b738_clock${s}`, s);
      p.roundInstrument(clk, ux, 0.165, '2ATI');
      c.onDispose(() => clk.dispose());
    }
    p.add(new PushButton(env, { id: `${pfx}.chr`, label: `CLOCK ${s} CHR`, style: 'small', mode: 'momentary', var: B738.clockChr(s), engraved: 'CHR', engravedHeight: 0.0016 }), ux - 0.036, 0.19);
    toggle(env, p, { id: `${pfx}.et`, label: `CLOCK ${s} ET`, var: B738.clockEt(s), positions: ['HLD', 'RUN', 'RESET'], values: [-1, 0, 1], initial: 1, springs: { 2: 1 }, orientation: 'horizontal', scale: 0.6 }, ux, 0.118, 'ET');
    annunciator(env, p, `${pfx}.to_config`, 'TAKEOFF CONFIG', [seg.on(['TAKEOFF', 'CONFIG'], 'red', B738.lt.takeoffConfig)], ux, 0.087, 0.03, 0.016);
    annunciator(env, p, `${pfx}.cabin_alt`, 'CABIN ALTITUDE', [seg.on(['CABIN', 'ALTITUDE'], 'red', B738.lt.cabinAltitude)], ux, 0.066, 0.03, 0.016);
    addDisengageLights(b, p, ux, 0.035, s);
    // Lower band: display select, DU brightness, panel dimmers.
    addDisplaySelect(b, p, sg * 0.785, -0.045, s);
    addDuBrightness(b, p, sg * 0.8 - 0.015, -0.1, s === 1 ? ['capt_out', 'capt_in'] : ['fo_in', 'fo_out'], 0.03);
    p.label(s === 1 ? 'OUTBD   INBD' : 'INBD   OUTBD', sg * 0.8, -0.083, { height: 0.0019 });
    p.label('DU BRIGHTNESS', sg * 0.8, -0.12, { height: 0.0019 });
    dimmer(env, p, `${pfx}.panel_lt`, s === 1 ? 'CAPT PANEL LIGHTS' : 'F/O PANEL LIGHTS', B738.panelLt(s), sg * 0.7, -0.16, 'PANEL');
    // Inboard column between the ND and P2.
    const ic = sg * 0.285;
    if (s === 1) {
      annunciator(env, p, `${pfx}.sb_armed`, 'SPEEDBRAKE ARMED', [seg.on(['SPEED BRAKE', 'ARMED'], 'green', B738.lt.speedbrakeArmed)], ic, 0.185, 0.034, 0.016);
      annunciator(env, p, `${pfx}.sb_dna`, 'SPEEDBRAKE DO NOT ARM', [seg.on(['SPEED BRAKE', 'DO NOT ARM'], 'amber', B738.lt.speedbrakeDoNotArm)], ic, 0.163, 0.034, 0.016);
      annunciator(env, p, `${pfx}.stab_oot`, 'STAB OUT OF TRIM', [seg.on(['STAB OUT', 'OF TRIM'], 'amber', B738.lt.stabOutOfTrim)], ic, 0.141, 0.034, 0.016);
    } else {
      annunciator(env, p, `${pfx}.sb_ext`, 'SPEEDBRAKE EXTENDED', [seg.on(['SPEED BRAKE', 'EXTENDED'], 'amber', B738.lt.speedbrakeExtended)], ic, 0.185, 0.034, 0.016);
    }
    p.add(
      new PushButton(env, {
        id: `${pfx}.below_gs`,
        label: 'BELOW G/S P-INHIBIT',
        style: 'korry',
        width: 0.03,
        height: 0.02,
        mode: 'momentary',
        var: B738.belowGs(s),
        segments: [{ text: ['BELOW G/S', 'P-INHIBIT'], color: 'amber', var: B738.lt.belowGs, style: 'legend' }],
      }),
      ic,
      s === 1 ? 0.112 : 0.155,
    );
  }

  // ---------------------------------------------------------------- Captain lower controls
  toggle(env, p, { id: 'b738.mip1.lights', label: 'LIGHTS', var: B738.lightsTest, positions: ['DIM', 'BRT', 'TEST'], values: [-1, 0, 1], initial: 1 }, -0.69, -0.045, 'LIGHTS');
  p.add(
    new GuardedSwitch(env, {
      id: 'b738.mip1.nws',
      label: 'NOSE WHEEL STEERING',
      var: B738.nwsSw,
      positions: ['ALT', 'NORM'],
      values: [0, 1],
      initial: 1,
      labels: { name: 'NOSE WHEEL STEERING', positions: true, height: 0.0019 },
      guard: { color: 'red', guardedPosition: 1 },
    }),
    -0.63,
    -0.045,
  );
  dimmer(env, p, 'b738.mip1.background', 'BACKGROUND', B738.backgroundLt, -0.66, -0.16, 'BACKGROUND');
  dimmer(env, p, 'b738.mip1.afds_flood', 'AFDS FLOOD', B738.afdsFlood, -0.62, -0.16, 'AFDS');
  dimmer(env, p, 'b738.mip1.gs_flood', 'GLARESHIELD FLOOD', B738.glareshieldFlood, -0.58, -0.16, 'FLOOD');
  // Centre controls (MFD ENG / SYS / C/R, N1 SET, SPD REF, FUEL FLOW) under the Captain ND, inboard of the column.
  addCentreControls(b, p, -0.33, -0.05);

  // ---------------------------------------------------------------- P2: ISFD
  {
    const iu = -0.19;
    const iv = 0.125;
    const isfd = p.subPanel({ name: 'b738.isfd', x: iu, y: iv, width: 0.1, height: 0.125, origin: 'center', material: 'bezel', thickness: 0.012 });
    if (!c.headless) {
      const d = new IsfdDisplay(vars, B738_DISPLAY_IDS.isfd);
      isfd.display(d, 0, 0.017, 0.078, 0.078, { bezel: false });
      c.onDispose(() => d.dispose());
    }
    const btn = (id: string, legend: string, x: number, o: Partial<ConstructorParameters<typeof PushButton>[1]>) =>
      isfd.add(new PushButton(env, { id: `b738.mip.isfd_${id}`, label: `ISFD ${legend}`, style: 'small', width: 0.011, height: 0.008, engraved: legend, engravedHeight: 0.0017, ...o }), x, -0.042);
    btn('app', 'APP', -0.036, { mode: 'cycle', values: [0, 1, 2], stateNames: ['OFF', 'ILS', 'B-CRS'], var: B738.isfdApp });
    btn('hpa', 'HP/IN', -0.022, { mode: 'toggle', stateNames: ['IN', 'HPA'], var: B738.isfdHpa });
    const brt = DISPLAY_VARS.brightness(B738_DISPLAY_IDS.isfd);
    const bump = (d: number) => (x: number) => {
      if (x !== 0) vars.set(brt, Math.max(0.1, Math.min(1, vars.get(brt, 1) + d)));
    };
    btn('dim', '-', -0.008, { mode: 'momentary', var: 'ac.b738.ck.isfd_dim', onChange: bump(-0.1) });
    btn('brt', '+', 0.006, { mode: 'momentary', var: 'ac.b738.ck.isfd_brt', onChange: bump(0.1) });
    btn('rst', 'RST', 0.02, { mode: 'momentary', var: B738.isfdRst });
    isfd.add(
      new RotaryKnob(env, {
        id: 'b738.mip.isfd_baro',
        label: 'ISFD BARO',
        cap: 'knurled',
        diameter: 0.012,
        // Baro setting of the ISFD's own air data (adc3), push = STD (FCOM 10.10).
        outer: { var: 'adc3.baro_inhg', min: 28.0, max: 31.0, step: 0.01, initial: 29.92, accel: { fastStep: 0.1 }, label: 'BARO', format: (v) => `${v.toFixed(2)} IN` },
        push: { var: B738.isfdStd, mode: 'momentary', label: 'STD' },
      }),
      0.038,
      -0.04,
    );
  }

  // ---------------------------------------------------------------- P2: flap indicator and LE lights (left of the lower DU)
  annunciator(env, p, 'b738.mip.le_transit', 'LE FLAPS TRANSIT', [seg.on(['LE FLAPS', 'TRANSIT'], 'amber', B738.lt.leFlapsTransit)], -0.19, 0.05, 0.03, 0.014);
  annunciator(env, p, 'b738.mip.le_ext', 'LE FLAPS EXT', [seg.on(['LE FLAPS', 'EXT'], 'green', B738.lt.leFlapsExt)], -0.19, 0.033, 0.03, 0.014);
  if (!c.headless) {
    const flaps = new DialDisplay({
      id: 'b738_flap_ind',
      vars,
      powerVar: 'elec.ac_stby_powered',
      angle: FLAP_DIAL.angle,
      ticks: FLAP_DIAL.marks.map((m) => ({ v: m, label: String(m) })),
      needles: [
        { var: B738.lt.flapGauge('l'), color: '#f2f2f2', tag: 'L', width: 8 },
        { var: B738.lt.flapGauge('r'), color: '#f2f2f2', tag: 'R', width: 8 },
      ],
      title: ['FLAPS'],
      titleY: 186,
    });
    p.roundInstrument(flaps, -0.19, -0.022, '2ATI');
    c.onDispose(() => flaps.dispose());
  }
  annunciator(env, p, 'b738.mip.flap_load_relief', 'FLAP LOAD RELIEF', [seg.on(['FLAP LOAD', 'RELIEF'], 'amber', B738.lt.flapLoadRelief)], -0.19, -0.068, 0.03, 0.014);

  // ---------------------------------------------------------------- P2: gear lever and lights (right of the upper DU)
  const legs: [0 | 1 | 2, string][] = [
    [1, 'LEFT'],
    [0, 'NOSE'],
    [2, 'RIGHT'],
  ];
  legs.forEach(([leg, name], i) => {
    const x = 0.135 + i * 0.03;
    annunciator(env, p, `b738.mip.gear_red${leg}`, `${name} GEAR (red)`, [seg.on([name, 'GEAR'], 'red', B738.lt.gearRed(leg))], x, 0.142, 0.026, 0.013);
    annunciator(env, p, `b738.mip.gear_green${leg}`, `${name} GEAR (green)`, [seg.on([name, 'GEAR'], 'green', B738.lt.gearGreen(leg))], x, 0.125, 0.026, 0.013);
  });
  p.add(
    new GearHandle(env, {
      id: 'b738.mip.gear',
      label: 'LANDING GEAR',
      var: B738.gearLever,
      positions: ['DN', 'OFF', 'UP'],
      values: [1, 0.5, 0],
      initial: 0,
      // Lever lock solenoid: UP blocked with weight on wheels unless the override trigger is held (FCOM 14.20).
      inhibit: (to, _from, v) => !(to === 2 && v.get('gear.handle_lock') !== 0),
      length: 0.075,
    }),
    0.165,
    0.052,
  );
  p.add(new PushButton(env, { id: 'b738.mip.gear_ovrd', label: 'GEAR LEVER LOCK OVERRIDE', style: 'small', width: 0.008, height: 0.008, mode: 'momentary', var: B738.gearLockOvrd, capMaterial: 'knobRed' }), 0.212, 0.09);
  p.label('OVRD', 0.212, 0.1, { height: 0.0017 });
  p.label('LANDING GEAR', 0.165, 0.16, { height: 0.0022 });

  // ---------------------------------------------------------------- P2: autobrake (right of the lower DU)
  annunciator(env, p, 'b738.mip.antiskid_inop', 'ANTISKID INOP', [seg.on(['ANTISKID', 'INOP'], 'amber', B738.lt.antiskidInop)], 0.155, 0.02, 0.03, 0.014);
  annunciator(env, p, 'b738.mip.ab_disarm', 'AUTO BRAKE DISARM', [seg.on(['AUTO BRAKE', 'DISARM'], 'amber', B738.lt.autoBrakeDisarm)], 0.2, 0.02, 0.03, 0.014);
  p.add(
    new SelectorKnob(env, {
      id: 'b738.mip.autobrake',
      label: 'AUTO BRAKE',
      var: B738.autobrake,
      positions: [
        { value: -1, label: 'RTO', gated: true },
        { value: 0, label: 'OFF' },
        { value: 1, label: '1' },
        { value: 2, label: '2' },
        { value: 3, label: '3' },
        { value: 4, label: 'MAX' },
      ],
      initial: 1,
      diameter: 0.016,
      labelHeight: 0.0019,
      title: 'AUTO BRAKE',
    }),
    0.178,
    -0.05,
  );

  // ---------------------------------------------------------------- P3: brake pressure gauge, GPWS panel
  if (!c.headless) {
    const bp = new DialDisplay({
      id: 'b738_brake_press',
      vars,
      powerVar: null, // direct-reading (accumulator pressure transmitter, EST mechanical-look gauge)
      angle: (v) => -135 + (Math.max(0, Math.min(4000, v)) / 4000) * 270,
      ticks: [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000].map((v) => (v % 1000 === 0 ? { v, label: String(v / 1000) } : { v, major: false })),
      needles: [{ var: B738.lt.hydBrakePsi, color: '#f2f2f2' }],
      title: ['BRAKE', 'PRESS', 'PSI x 1000'],
      titleY: 158,
      quantum: 20,
    });
    p.roundInstrument(bp, 0.3, -0.07, '2ATI');
    c.onDispose(() => bp.dispose());
  }
  {
    const g = p.subPanel({ name: 'b738.gpws', x: 0.5, y: -0.06, width: 0.15, height: 0.06, origin: 'center', material: 'panel' });
    g.label('GROUND PROXIMITY', 0, 0.024, { height: 0.0021 });
    const guarded = (id: string, name: string, v: string, x: number) =>
      g.add(
        new GuardedSwitch(env, {
          id: `b738.mip.gpws_${id}`,
          label: `GPWS ${name} INHIBIT`,
          var: v,
          positions: ['NORMAL', 'INHIBIT'],
          values: [0, 1],
          initial: 0,
          labels: { name: `${name} INHIBIT`, positions: false, height: 0.0017 },
          guard: { color: 'red', guardedPosition: 0 },
        }),
        x,
        -0.01,
      );
    guarded('flap', 'FLAP', B738.gpwsFlapInh, -0.05);
    guarded('gear', 'GEAR', B738.gpwsGearInh, -0.015);
    guarded('terr', 'TERR', B738.gpwsTerrInh, 0.02);
    annunciator(env, g, 'b738.mip.gpws_inop', 'GPWS INOP', [seg.on('INOP', 'amber', B738.lt.gpwsInop)], 0.055, 0.008, 0.02, 0.012);
    g.add(new PushButton(env, { id: 'b738.mip.gpws_test', label: 'GPWS SYS TEST', style: 'round', width: 0.01, height: 0.01, mode: 'momentary', var: B738.gpwsTest, engraved: 'TEST', engravedHeight: 0.0015 }), 0.055, -0.015);
  }

  // ---------------------------------------------------------------- standby compass on the windshield centre post
  // (Canvas-painted card: not built headless.)
  if (!c.headless) {
    const compass = new MagneticCompass({ id: 'b738.compass', vars, lightVar: CK.panelLight, width: 0.07 });
    b.place(compass, { center_m: COMPASS, facing: 'aft', tiltDeg: 10 });
  }

  // ---------------------------------------------------------------- manual gear extension handles (F/O floor access door, dossier §10.13)
  const floor = b.panel({ name: 'b738.gear_manual', center_m: [14.05, 0.92, FLOOR_Z - 0.005], facing: 'up', width: 0.2, height: 0.16, material: 'panelDark', screws: false });
  floor.add(
    new TBarHandle(env, {
      id: 'b738.mip.gear_manual_ext',
      label: 'MANUAL GEAR EXTENSION',
      var: B738.gearManualExt,
      style: 'tbar',
      material: 'knobRed',
      pullLength: 0.06,
    }),
    0,
    0,
  );
  floor.label('MANUAL GEAR EXTENSION', 0, 0.06, { height: 0.003 });
}
