/**
 * Global 6000 main instrument panel (dossier §10 / §12.3; FSB appendix 6:
 * four AFD-6520 15.1 in landscape displays in a T): AFD 1 (pilot PFD), AFD 2
 * (upper centre, EICAS / systems), AFD 4 (copilot PFD) across the top, AFD 3
 * (lower centre) below AFD 2; the IESI standby left of AFD 3 (FSB "Same
 * Integrated Electronic Standby (IESI) Instrument"); the landing-gear panel
 * right of AFD 3 (gear handle with the three position lights above it, DN LCK
 * REL, HORN MUTED, NOSE STEER, BTMS OVHT WARN RESET: GXLG, dossier §12.3).
 * The GXAG airspeed-limitation placard sits under the pilot's PFD.
 */
import { AnnunciatorLight, GearHandle, PushButton } from '../../../cockpit/controls';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { addAfds, addIesi } from '../../../avionics/collins-fusion';
import { G6K_VARS as V } from '../vars';
import { CK, seg, ZONE, type G6kCockpitContext } from './context';
import { AFD_POS, GEAR_PANEL, IESI_POS, MAIN_PANEL } from './layout';

/** Korry-style switchlight (Bombardier PBA) with an engraved name above it. */
export function pba(
  c: G6kCockpitContext,
  panel: Panel,
  o: { id: string; label: string; v: string; x: number; y: number; segments: ReturnType<typeof seg.eq>[]; name?: string; mode?: 'toggle' | 'momentary'; size?: number; nameBelow?: boolean; zone?: string },
): PushButton {
  const s = o.size ?? 0.0165;
  const btn = panel.add(new PushButton(c.env, { id: o.id, label: o.label, var: o.v, mode: o.mode ?? 'toggle', style: 'korry', width: s, height: s, layout: 'stack', segments: o.segments }), o.x, o.y);
  if (o.name !== '') panel.label(o.name ?? o.label, o.x, o.y + (o.nameBelow ? -1 : 1) * (s / 2 + 0.005), { height: 0.0027, zone: o.zone });
  return btn;
}

export function buildMainPanel(c: G6kCockpitContext): Panel {
  const { b, suite } = c;
  const mp = MAIN_PANEL;
  const main = b.panel({ name: 'main', center_m: mp.center_m, facing: 'aft', tiltDeg: mp.tiltDeg, width: mp.width, height: mp.height, material: 'panel', radius: 0.014, screws: { kind: 'hex', diameter: 0.0035, pitch: 0.3 } });
  if (suite) {
    addAfds(main, suite, AFD_POS);
    addIesi(b, main, IESI_POS[0], IESI_POS[1], suite);
  }
  main.label('STBY', IESI_POS[0], IESI_POS[1] + 0.058, { height: 0.0024 });
  buildGearPanel(c, main);
  // GXAG airspeed limitation placard (VMO / MMO, VLO / VLE, VFE; dossier §3) under the pilot's PFD.
  main.placard(
    {
      text: 'VMO 300 KIAS BELOW 8000 FT  340 KIAS ABOVE 8000 FT\nMMO .89 TO 35000 FT  .88 AT 41000  .858 AT 47000  .842 AT 51000\nVLO 200  VLE 250 KIAS   VFE SLATS 225  6° 210  16° 210  30° 185',
      height: 0.0021,
      style: 'engraved',
      zone: ZONE.left,
    },
    AFD_POS[0][0],
    -0.045,
  );
  main.placard({ text: 'THIS AIRPLANE MUST BE OPERATED IN COMPLIANCE\nWITH THE AIRPLANE FLIGHT MANUAL', height: 0.002, style: 'engraved', zone: ZONE.right }, AFD_POS[3][0], -0.045);
  return main;
}

function buildGearPanel(c: G6kCockpitContext, main: Panel): void {
  const { env } = c;
  const G = GEAR_PANEL;
  const p = main.subPanel({ name: 'gear_panel', x: G.u, y: G.v, width: G.w, height: G.h, origin: 'top-left', material: 'panel', screws: { kind: 'dzus', diameter: 0.006, inset: 0.007 } });
  p.label('LDG GEAR', G.w / 2, 0.012, { height: 0.003 });
  // Position lights (GXLG: three green DOWN-and-locked, red in transit / disagree), above the handle.
  const lt = (id: string, text: string, i: number, x: number) =>
    p.add(
      new AnnunciatorLight(env, {
        id,
        label: `GEAR ${text}`,
        width: 0.02,
        height: 0.014,
        layout: 'stack',
        segments: [seg.on(text, 'green', `gear.green${i}`), seg.on('', 'red', `gear.red${i}`)],
      }),
      x,
      0.03,
    );
  lt('g6k.mp.gear_lt_l', 'L', 1, G.w / 2 - 0.028);
  lt('g6k.mp.gear_lt_n', 'NOSE', 0, G.w / 2);
  lt('g6k.mp.gear_lt_r', 'R', 2, G.w / 2 + 0.028);
  // Landing gear handle (wheel knob, 14 CFR 25.781): DN = 1 / UP = 0; the LGECU handle solenoid locks it down on
  // the ground (LandingGear gear.handle_lock; DN LCK REL overrides).
  p.add(
    new GearHandle(env, {
      id: 'g6k.mp.gear',
      var: V.gearHandle,
      label: 'LDG GEAR',
      positions: ['DN', 'UP'],
      values: [1, 0],
      inhibit: (to, _from, v) => !(to === 1 && v.get('gear.handle_lock') !== 0),
      lights: [{ var: CK.gearRed, color: 'red' }],
      length: 0.075,
    }),
    G.w / 2 - 0.02,
    0.11,
  );
  const x2 = G.w - 0.028;
  pba(c, p, { id: 'g6k.mp.dn_lck_rel', label: 'DN LCK REL', v: V.gearDnLckRel, x: x2, y: 0.075, mode: 'momentary', segments: [seg.on('', 'white', V.gearDnLckRel)], name: 'DN LCK REL' });
  pba(c, p, { id: 'g6k.mp.horn_mute', label: 'GEAR HORN MUTED', v: V.hornMute, x: x2, y: 0.12, segments: [seg.on('MUTED', 'white', V.hornMuteEff)], name: 'HORN' });
  pba(c, p, {
    id: 'g6k.mp.nose_steer',
    label: 'NOSE STEER',
    v: V.nwsArm,
    x: 0.03,
    y: 0.19,
    segments: [seg.eq('OFF', 'white', V.nwsArm, 0), seg.on('FAIL', 'amber', 'fail.steer')],
    name: 'NOSE STEER',
  });
  pba(c, p, { id: 'g6k.mp.btms_reset', label: 'BTMS OVHT WARN RESET', v: V.btmsReset, x: G.w / 2, y: 0.19, mode: 'momentary', segments: [seg.on('OVHT', 'red', V.btmsWarn)], name: 'BTMS RESET' });
}
