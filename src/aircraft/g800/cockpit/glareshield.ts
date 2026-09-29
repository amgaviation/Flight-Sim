/**
 * G800 glareshield pod (G600 BL7C0704 g600_gp / g600_gp_l / g600_gp_mid, BL7C0705 g6_gpend): one rounded pod standing
 * proud of the stitched glareshield, holding outboard to inboard on each side:
 *  - a column of three stacked square switchlights separated by engraved lines: WARN INHIBIT (top; code450 G700 taxi
 *    checklist "WARN INHIBIT . . . INHIBIT"), MASTER WARN (middle, legend read from the photograph), GS INHIBIT
 *    (bottom). EST: the Symmetry pod has no separate MASTER CAUTION key, so MASTER WARN lights red for a warning and
 *    amber for a caution and acknowledges both (press = cas.ack_warning, release = cas.ack_caution);
 *  - the SFD (ESIS touch standby display) with its inboard bezel controls: a round MENU button and a BARO knob
 *    (push = STD). The BARO knob sets that side's PFD barometric setting (Epic guidance events baro{s}); the Symmetry GP
 *    has no BARO knobs;
 *  - the guidance-panel core (addSymmetryGuidancePanel below): SPEED | LATERAL | AUTOFLIGHT | VERTICAL | ALTITUDE, each
 *    with a header (BJT500: "a logical layout clearly marking and separating speed, lateral, autopilot, vertical, and
 *    altitude controls"; "button lights are separate from the button").
 * Pod positions EST, scaled from the DU band in the photographs (layout.ts GLARE_FACE / GLARE_POD).
 */
import * as THREE from 'three';
import { AnnunciatorLight, PushButton, RotaryKnob, Thumbwheel } from '../../../cockpit/controls';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { EPIC_EVENTS, EPIC_VARS } from '../../../avionics/honeywell-epic/vars';
import { GP_LIGHTS, type GpControl } from '../../../avionics/honeywell-epic/logic/guidance';
import type { EpicSuite } from '../../../avionics/honeywell-epic/suite';
import type { GpWindowKind } from '../../../avionics/honeywell-epic/displays/gpDisplay';
import { roundedBox } from '../../../cockpit/geometry/primitives';
import { G800_VARS as V } from '../vars';
import type { G800CockpitContext } from './context';
import { GLARE_FACE, GLARE_POD } from './layout';

/** SFD size in the pod (the ESIS display, EST 0.11 m wide in the photographs; keeps the 480 x 420 canvas aspect). */
const SFD = { w: 0.108, h: 0.0945 };

export function buildGlareshield(c: G800CockpitContext): void {
  const { b, env, suite } = c;
  const f = GLARE_FACE;
  const G = GLARE_POD;
  const face = b.panel({ name: 'g800.glare', center_m: f.center_m, facing: 'aft', tiltDeg: f.tiltDeg, width: f.width, height: f.height, material: 'panelDark', screws: false, radius: 0.04 });
  // Pod shell: a rounded body behind the face so the pod stands proud of the glareshield (EST 45 mm deep).
  const shell = new THREE.Mesh(roundedBox(f.width + 0.012, f.height + 0.012, 0.045, 0.04), env.materials.get('glareshield'));
  shell.userData.cockpitStatic = true;
  b.trackGeometry(shell.geometry);
  face.addObject(shell, 0, 0, { z: -0.024 });
  if (suite) {
    addSymmetryGuidancePanel(c, face, suite);
    for (const side of [1, 2] as const) {
      const sg = side === 1 ? -1 : 1;
      const sfd = suite.standby[side - 1];
      if (sfd) face.display(sfd, sg * G.sfdU, 0, SFD.w, SFD.h, { bezel: { border: 0.007, material: 'bezelGloss' } });
      // Bezel controls on the inboard side: MENU (round) above, BARO knob (push = STD) below.
      face.add(
        new PushButton(env, { id: `g800.gs.sfd_menu${side}`, label: `SFD ${side} MENU`, mode: 'momentary', event: V.sfdMenuEvent(side), style: 'round', width: 0.012, engraved: 'MENU', engravedHeight: 0.0016 }),
        sg * G.bezelU,
        0.022,
      );
      face.add(
        new RotaryKnob(env, {
          id: `g800.gs.baro${side}`,
          label: `BARO ${side}`,
          cap: 'knurled',
          diameter: 0.016,
          outer: { incEvent: EPIC_EVENTS.gp(`baro${side}_inc`), decEvent: EPIC_EVENTS.gp(`baro${side}_dec`), label: 'BARO' },
          push: { event: EPIC_EVENTS.gp(`baro${side}_push`), label: 'STD' },
        }),
        sg * G.bezelU,
        -0.014,
      );
      face.label('BARO', sg * G.bezelU, 0.004, { height: 0.0018 });
    }
  }
  // End columns: WARN INHIBIT / MASTER WARN / GS INHIBIT with engraved separators.
  for (const side of [1, 2] as const) {
    const sg = side === 1 ? -1 : 1;
    const s = side === 1 ? 'l' : 'r';
    const x = sg * G.endU;
    const pitch = 0.03;
    face.add(
      new PushButton(env, {
        id: `g800.gs.warn_inh_${s}`,
        label: `WARN INHIBIT (${s.toUpperCase()})`,
        var: V.warnInhibit,
        mode: 'toggle',
        style: 'korry',
        unlitTint: 0.38, // faint legend when unlit (fix round 1 L11)
        width: 0.018,
        height: 0.018,
        layout: 'stack',
        segments: [{ text: 'INHIBIT', color: 'white', var: V.warnInhibit }],
      }),
      x,
      pitch,
    );
    face.add(
      new PushButton(env, {
        id: `g800.gs.mwarn_${s}`,
        label: `MASTER WARN (${s.toUpperCase()})`,
        mode: 'momentary',
        event: 'cas.ack_warning',
        releaseEvent: 'cas.ack_caution',
        style: 'korry',
        unlitTint: 0.38,
        width: 0.018,
        height: 0.018,
        layout: 'stack',
        segments: [
          { text: 'WARN', color: 'red', var: 'alert.master_warning' },
          { text: 'CAUT', color: 'amber', var: 'alert.master_caution' },
        ],
      }),
      x,
      0,
    );
    face.add(
      new PushButton(env, {
        id: `g800.gs.gs_inh_${s}`,
        label: `GS INHIBIT (${s.toUpperCase()})`,
        mode: 'momentary',
        event: 'taws.gs_cancel',
        style: 'korry',
        unlitTint: 0.38,
        width: 0.018,
        height: 0.018,
        layout: 'stack',
        segments: [{ text: 'GS', color: 'amber', var: 'taws.gs_light' }],
      }),
      x,
      -pitch,
    );
    for (const dy of [pitch / 2, -pitch / 2]) face.line(x - 0.013, dy, x + 0.013, dy, 0.0008);
    face.label('WARN\nINHIBIT', x - sg * 0.02, pitch, { height: 0.0017 });
    face.label('MASTER\nWARN', x - sg * 0.02, 0, { height: 0.0017 });
    face.label('GS\nINHIBIT', x - sg * 0.02, -pitch, { height: 0.0017 });
  }
}

/** Symmetry guidance panel keys: id, legend, x (m from the core's left edge), GP control (Epic event). */
const KEYS: readonly [string, string, number, number, GpControl][] = [
  ['man', 'MAN', 0.036, 0.076, 'man'],
  ['hdg_btn', 'HDG/\nTRK', 0.105, 0.076, 'hdg_btn'],
  ['nav', 'LNAV', 0.145, 0.078, 'nav'],
  ['ap', 'AUTO', 0.185, 0.018, 'ap'],
  ['pfdcmd', 'XFR', 0.185, 0.047, 'pfdcmd'],
  ['apr', 'APR', 0.185, 0.078, 'apr'],
  ['vnav', 'VNAV', 0.226, 0.078, 'vnav'],
  ['vs_btn', 'VS', 0.262, 0.076, 'vs_btn'],
  ['flch', 'FLCH', 0.298, 0.078, 'flch'],
  ['alt_btn', 'HOLD', 0.334, 0.076, 'alt_btn'],
];

/**
 * Symmetry guidance-panel core (G600 BL7C0704 crop g600_gp_mid): SPEED (IAS window, knob, MAN key), LATERAL (HDG window,
 * knob with HDG / TRK marks, HDG/TRK key), LNAV, AUTOFLIGHT (AUTO key, green coupling arrow, XFR key, APR; bracketed),
 * VNAV, VERTICAL (window, wheel, key), FLCH, ALTITUDE (FT window, knob, HOLD key). Light bars sit above the keys, separate
 * from them. Mapping onto the Epic guidance events: AUTO = AP engage, XFR = PFD coupling transfer (the arrow shows the
 * coupled side), LNAV = NAV, HOLD = ALT, VERTICAL key = VS, HDG/TRK = HDG (SCOPE: track mode not modelled; FD, BC,
 * LO BANK and FPA are on the TSC GUIDANCE page; the A/T ENG / DISENG buttons are on the power levers).
 * Legend engraving 3 mm white on dark keys so it reads in daylight.
 */
function addSymmetryGuidancePanel(c: G800CockpitContext, face: Panel, suite: EpicSuite): Panel {
  const { env } = c;
  const W = GLARE_POD.coreW;
  const H = 0.092;
  const gp = face.subPanel({ name: `${suite.cfg.idPrefix}.gp`, width: W, height: H, x: 0, y: 0, origin: 'top-left', material: 'panelDark', thickness: 0.005, radius: 0.006 });
  const pfx = `${suite.cfg.idPrefix}.gp`;
  const ev = (id: string) => EPIC_EVENTS.gp(id);
  const win: readonly [GpWindowKind, number, string][] = [
    ['speed', 0.036, 'SPEED'],
    ['heading', 0.105, 'LATERAL'],
    ['vsfpa', 0.262, 'VERTICAL'],
    ['altitude', 0.334, 'ALTITUDE'],
  ];
  for (const [k, x, title] of win) {
    const d = suite.gpWindows.find((g) => g.kind === k);
    if (d) gp.display(d, x, 0.022, 0.05, 0.018, { bezel: false });
    gp.label(title, x, 0.006, { height: 0.0026, weight: 700 });
  }
  gp.label('AUTOFLIGHT', 0.185, 0.006, { height: 0.0026, weight: 700 });
  // AUTOFLIGHT brackets (engraved) and the VERTICAL / ALTITUDE separators.
  gp.line(0.163, 0.034, 0.207, 0.034, 0.0012);
  gp.line(0.163, 0.061, 0.207, 0.061, 0.0012);
  gp.line(0.16, 0.012, 0.16, 0.07, 0.0008);
  gp.line(0.21, 0.012, 0.21, 0.07, 0.0008);
  gp.line(0.316, 0.012, 0.316, 0.07, 0.0008);
  // Knobs (encoders to the guidance logic).
  // Knurled knob caps with backlit arc markings beside them (fix round 1 L14; BL7C0704 crop gpcore:
  // knurled knobs, 'FULL SCALE UP' arc at the ALT knob, HDG / TRK arc at LATERAL).
  const knob = (id: string, label: string, x: number, push: string | null, pushLabel: string, inner?: { id: string; label: string }) =>
    gp.add(
      new RotaryKnob(env, {
        id: `${pfx}.${id}`,
        label,
        cap: 'knurled',
        diameter: 0.017,
        outer: { incEvent: ev(`${id}_inc`), decEvent: ev(`${id}_dec`), label },
        inner: inner ? { incEvent: ev(`${inner.id}_inc`), decEvent: ev(`${inner.id}_dec`), label: inner.label } : undefined,
        push: push ? { event: ev(push), label: pushLabel } : undefined,
      }),
      x,
      0.047,
    );
  knob('spd', 'SPEED', 0.036, 'spd_push', 'IAS / MACH');
  knob('hdg', 'LATERAL (HDG)', 0.105, 'hdg_push', 'SYNC');
  gp.label('HDG', 0.087, 0.059, { height: 0.0018 });
  gp.label('TRK', 0.123, 0.059, { height: 0.0018 });
  gp.add(new Thumbwheel(env, { id: `${pfx}.vs`, label: 'VERTICAL wheel', channel: { incEvent: ev('vs_inc'), decEvent: ev('vs_dec'), label: 'VS' }, diameter: 0.02, width: 0.009, orientation: 'vertical' }), 0.262, 0.047);
  knob('alt', 'ALTITUDE', 0.334, null, '', { id: 'alt_fine', label: 'ALT 100 FT' });
  // 'FULL SCALE UP' arc marking at the ALT knob (backlit panel label; BL7C0704 crop gpcore).
  gp.label('FULL SCALE UP', 0.334, 0.0625, { height: 0.0016, weight: 700 });
  // Keys with separate light bars above them.
  for (const [id, legend, x, y, ctl] of KEYS) {
    const light = GP_LIGHTS[ctl];
    gp.add(
      new PushButton(env, {
        id: `${pfx}.${id}`,
        label: legend.replace('\n', ''),
        style: 'mcp',
        mode: 'momentary',
        event: ev(ctl),
        width: 0.018,
        height: 0.011,
        engraved: legend,
        engravedHeight: 0.003,
        engravedColor: '#f2f2f2',
        capMaterial: 'plasticBlack',
        lightBar: light ? { var: light, color: 'green' } : undefined,
      }),
      x,
      y,
    );
  }
  // Coupling arrow (green) between AUTO and XFR: left = pilot side coupled, right = copilot side.
  for (const [dir, test] of [
    ['<', (v: number) => v !== 2],
    ['>', (v: number) => v === 2],
  ] as const) {
    gp.add(
      new AnnunciatorLight(env, {
        id: `g800.gs.cpl_${dir === '<' ? 'l' : 'r'}`,
        label: `COUPLED SIDE ${dir === '<' ? 'LEFT' : 'RIGHT'}`,
        width: 0.008,
        height: 0.006,
        bezel: false,
        segments: [{ text: dir, color: 'green', var: EPIC_VARS.coupleSide, test }],
      }),
      dir === '<' ? 0.177 : 0.193,
      0.0335,
    );
  }
  return gp;
}
