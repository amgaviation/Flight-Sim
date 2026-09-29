/**
 * Global 6000 centre pedestal, Global Vision layout (photos N835GL crop c_ped,
 * EB190582 crops e_ped_mid / e_ped_aft / e_ped_l / e_acp; AOPA 2012: "brushed
 * chrome accents on the power levers as well as the flap, spoiler and parking
 * brake handles"). 0.54 m wide between tan-leather side rails
 * (layout.ts PEDESTAL); the steep forward face carries AFD 3 (mainPanel.ts).
 * Top surface, forward to aft:
 *
 *  MKP 1 (u -0.17) | quadrant channel (~0.14 m): FLIGHT SPOILER slot on the
 *  left with the RETRACT arrow, two thrust levers with brushed-chrome drum
 *  grips side by side, MAX THRUST gate placard between them, IDLE REV /
 *  MAX REV marks for the piggy-back reverse levers, EVENT button at the
 *  forward end | MKP 2 (u +0.17);
 *  CCP 1 / 2 palm rests aft of the MKPs; ENGINE RUN L / R (ON / OFF, lift to
 *  move) at the aft end of the quadrant;
 *  ACP 1 / 2 (fix round 2, photos e_acp / e_ped_aft; GX PTG 18): seven
 *  transmitter select keys (VHF1..3, HF1 / 2, SAT, PA), fourteen receiver
 *  volume knobs (push in = off, pull out = on: VHF1..3, HF1 / 2, SAT, PA, NAV1 / 2,
 *  ADF1 / 2, MKR, DME1 / 2), R/T - IC toggle, ID / BOTH / VOICE filter, MKR HI /
 *  LO, MASK / BOOM and SPKR (systems/audioControl.ts: Morse idents, marker
 *  tones, keyed radio);
 *  left: reversion panel (GX PTG 16: DISPLAYS NORM / REV, TUNE VHF / NORM /
 *  DSPL, L / R PFD ADC and IRS keys, AFCS 1/2 key -> Fusion RSP vars,
 *  systems/reversion.ts) above the display dimmers (L / CTR / R DSPL and the
 *  LWR DSPL knob for AFD 3); centre: PARK/EMER BRAKE in a
 *  recessed gate and the SLAT/FLAP lever (SLAT IN / OUT, FLAP 0 / 0 / 6 / 16
 *  / 30); right: COCKPIT LIGHTS (AREA, OVHD / CB / L / CTR / R INTEG, PBA DIM /
 *  BRT, EYE REF, MASTER INTEG ON / AUTO / OFF, FOOT);
 *  aft section (not shown in the photographs, EST positions): STAB CH 1 / 2
 *  (unguarded PBAs, PUSH OFF/RESET), AIL trim, RUD trim; GND LIFT DUMPING
 *  3-position switch (MANUAL ARM / AUTO / OFF); IRS 1 / 2 / 3.
 *  FLIGHT SPOILER detents: 0 (gate) / 1/4 / 1/2 / 3/4 / FULL / MAX (gate).
 *  aft face: RAT manual deploy handle, landing-gear manual release handle.
 *
 * Moved off the pedestal by the Vision layout: EPR / N1 MODE (overhead ENGINE),
 * EMER DC PWR (overhead ELECTRICAL), TAWS G/S / FLAPS / TERRAIN (main panel),
 * AUTOBRAKE (GEAR AND BRAKES), the EMS CDU (main-panel wings). LAMP TEST is a
 * TEST CONTROL page entry of the EMS CDU (GX PTG 15-19), not a pedestal switch.
 */
import * as THREE from 'three';
import { Lever, PushButton, RotaryKnob, SelectorKnob, TBarHandle, ToggleSwitch } from '../../../cockpit/controls';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { INPUT } from '../../../core/vars';
import { addCcpVision, addMkpVision } from '../../../avionics/collins-fusion';
import { G6K_ACP_CH, G6K_EVENTS, G6K_VARS as V } from '../vars';
import { FSL_FULL } from '../systems/logic';
import { TLA } from '../systems/engines';
import { seg, ZONE, type G6kCockpitContext } from './context';
import { PEDESTAL, FLOOR_Z } from './layout';
import { pba } from './mainPanel';
import { g6kFinish } from './finish';

const OPEN: [number, number] = [0, 1];
const SHUT: [number, number] = [0, 0];

function topPlacement() {
  const P = PEDESTAL;
  const dx = P.topFwd[0] - P.topAft[0];
  const dz = P.topAft[1] - P.topFwd[1];
  return {
    center_m: [(P.topFwd[0] + P.topAft[0]) / 2, 0, (P.topFwd[1] + P.topAft[1]) / 2] as [number, number, number],
    tiltDeg: -THREE.MathUtils.radToDeg(Math.atan2(dz, dx)),
    length: Math.hypot(dx, dz),
  };
}

/** Dimmer knob 0..1 with a pointer, name below, DIM / BRT (or OFF / BRT) legends. */
function dimmer(c: G6kCockpitContext, p: Panel, id: string, label: string, v: string, x: number, y: number, name: string, lo = 'DIM'): void {
  const z = ZONE.centre;
  p.add(
    new RotaryKnob(c.env, {
      id,
      label,
      cap: 'pointer',
      diameter: 0.015,
      zone: z,
      outer: { var: v, min: 0, max: 1, step: 0.05, angleRange: [-140, 140], label, format: (x) => (x <= 0.001 ? 'OFF' : x >= 0.999 ? 'BRT' : `${Math.round(x * 100)} %`) },
    }),
    x,
    y,
  );
  p.label(name, x, y - 0.0145, { height: 0.0024, zone: z });
  p.label(lo, x - 0.012, y + 0.011, { height: 0.0016, zone: z });
  p.label('BRT', x + 0.012, y + 0.011, { height: 0.0016, zone: z });
}

/** Sub-panel on the pedestal top with dzus fasteners. */
function plate(p: Panel, name: string, x0: number, y0: number, w: number, h: number): Panel {
  return p.subPanel({ name, x: x0 + w / 2, y: y0 + h / 2, width: w, height: h, origin: 'top-left', material: 'panel', screws: { kind: 'dzus', diameter: 0.006, inset: 0.007, pitch: 0.2 } });
}

/** ACP row and reversion / cockpit-lights row (m aft of the pedestal's forward edge, photo e_ped_aft proportions). */
const ACP_Y = 0.335;
const ACP_H = 0.078;
const REV_Y = 0.418;

/** ACP channel legends (knob rows) and the transmitter key legends. */
const ACP_ROW1 = ['vhf1', 'vhf2', 'vhf3', 'hf1', 'hf2', 'sat', 'pa'] as const;
const ACP_ROW2 = ['nav1', 'nav2', 'adf1', 'adf2', 'mkr', 'dme1', 'dme2'] as const;
const ACP_NAME: Record<(typeof G6K_ACP_CH)[number], string> = {
  vhf1: 'VHF1', vhf2: 'VHF2', vhf3: 'VHF3', hf1: 'HF1', hf2: 'HF2', sat: 'SAT', pa: 'PA',
  nav1: 'NAV1', nav2: 'NAV2', adf1: 'ADF1', adf2: 'ADF2', mkr: 'MKR', dme1: 'DME1', dme2: 'DME2',
};

/**
 * Audio control panel (photo EB190582 e_ped_aft: seven columns; square transmitter keys with a lamp above; two rows of
 * push / pull volume knobs VHF1 VHF2 VHF3 HF1 HF2 SAT (PA, EST: legend illegible) and NAV1 NAV2 ADF1 ADF2 MKR DME1
 * (DME2); bottom row R/T - IC, ID / BOTH / V, MKR HI / LO (bat handles), MASK, SPKR). Knob push toggles the audio
 * (pulled out = on), turning sets the volume. systems/audioControl.ts consumes the vars.
 */
function buildAcp(c: G6kCockpitContext, p: Panel, s: 1 | 2): void {
  const { env } = c;
  const z = ZONE.centre;
  const w = s === 1 ? 0.17 : 0.185;
  const pitch = (w - 0.02) / 7;
  const x = (k: number) => 0.01 + pitch * (k + 0.5);
  for (let k = 0; k < 7; k++) {
    // Transmitter select key with a green lamp bar (lit while that transmitter is selected).
    p.add(
      new PushButton(env, {
        id: `g6k.ped.acp${s}.mic_${ACP_ROW1[k]}`,
        label: `ACP ${s} ${ACP_NAME[ACP_ROW1[k]]} MIC`,
        var: V.acpMic(s),
        mode: 'toggle',
        values: [k, k],
        style: 'korry',
        width: 0.0085,
        height: 0.0075,
        layout: 'stack',
        segments: [{ text: '▬', color: 'green', var: V.acpMic(s), test: (x2: number) => x2 === k }],
      }),
      x(k),
      0.009,
    );
    for (const [row, list] of [[0.028, ACP_ROW1], [0.049, ACP_ROW2]] as const) {
      const ch = list[k];
      p.add(
        new RotaryKnob(env, {
          id: `g6k.ped.acp${s}.${ch}`,
          label: `ACP ${s} ${ACP_NAME[ch]}`,
          cap: 'pointer',
          diameter: 0.0105,
          height: 0.009,
          zone: z,
          outer: { var: V.acpVol(s, ch), min: 0, max: 1, step: 0.05, angleRange: [-130, 130], label: `${ACP_NAME[ch]} VOL`, format: (v) => `${Math.round(v * 100)} %` },
          push: { var: V.acpSel(s, ch), mode: 'toggle', label: 'PULL ON / PUSH OFF' },
        }),
        x(k),
        row,
      );
      p.label(ACP_NAME[ch], x(k), row - 0.0085, { height: 0.0018, zone: z });
    }
  }
  const by = 0.068;
  p.add(new ToggleSwitch(env, { id: `g6k.ped.acp${s}.rt_ic`, label: `ACP ${s} R/T - IC`, var: V.acpRtIc(s), positions: ['IC', '', 'R/T'], values: [-1, 0, 1], initial: 1, springs: { 0: 1, 2: 1 }, labels: { positions: true, height: 0.0016, zone: z }, scale: 0.6 }), x(0), by);
  p.add(
    new SelectorKnob(env, {
      id: `g6k.ped.acp${s}.filter`,
      var: V.acpFilter(s),
      label: `ACP ${s} ID / BOTH / VOICE`,
      cap: 'bar',
      diameter: 0.0105,
      labelHeight: 0.0016,
      labelZone: z,
      positions: [
        { value: 0, label: 'ID', angle: -40 },
        { value: 1, label: 'BOTH', angle: 0 },
        { value: 2, label: 'V', angle: 40 },
      ],
      initial: 1,
    }),
    x(1),
    by,
  );
  p.add(new ToggleSwitch(env, { id: `g6k.ped.acp${s}.mkr_sens`, label: `ACP ${s} MKR HI / LO SENS`, var: V.acpMkrHi(s), positions: ['LO', 'HI'], values: [0, 1], initial: 1, labels: { positions: true, height: 0.0016, zone: z }, scale: 0.6 }), x(2), by);
  p.add(new PushButton(env, { id: `g6k.ped.acp${s}.mask`, label: `ACP ${s} MASK`, var: V.acpMask(s), mode: 'toggle', style: 'round', width: 0.0095, capMaterial: 'plasticBlack' }), x(4), by);
  p.label('MASK', x(4), by - 0.0085, { height: 0.0018, zone: z });
  p.add(
    new RotaryKnob(env, {
      id: `g6k.ped.acp${s}.spkr`,
      label: `ACP ${s} SPKR`,
      cap: 'pointer',
      diameter: 0.0105,
      zone: z,
      outer: { var: V.acpSpkr(s), min: 0, max: 1, step: 0.05, angleRange: [-130, 130], label: 'SPKR', format: (v) => (v <= 0.001 ? 'OFF' : `${Math.round(v * 100)} %`) },
    }),
    x(5),
    by,
  );
  p.label('SPKR', x(5), by - 0.0085, { height: 0.0018, zone: z });
  p.label(`ACP ${s}`, w - 0.012, ACP_H - 0.004, { height: 0.0016, zone: z });
}

/**
 * Reversion panel (aft-left of the pedestal, photo EB190582 e_ped_l): L DSPL / CTR DSPL / R DSPL dimmers (OFF - BRT),
 * DISPLAYS NORM / REV rotary with the LWR DSPL dimmer, TUNE rotary (VHF / NORM / DSPL), and the switchlights
 * L PFD [ADC] [IRS], AFCS [1/2], R PFD [ADC] [IRS] (Collins Fusion RSP vars; systems/reversion.ts).
 */
function buildReversion(c: G6kCockpitContext, p: Panel): void {
  const { env } = c;
  const z = ZONE.centre;
  const dx = [0.035, 0.085, 0.135];
  (['l', 'c', 'r'] as const).forEach((zz, k) => dimmer(c, p, `g6k.ped.display_${zz}`, `${zz === 'l' ? 'L' : zz === 'c' ? 'CTR' : 'R'} DSPL`, V.ltDisplay(zz), dx[k], 0.035, `${zz === 'l' ? 'L' : zz === 'c' ? 'CTR' : 'R'} DSPL`, 'OFF'));
  dimmer(c, p, 'g6k.ped.display_lwr', 'LWR DSPL', V.ltDisplayLwr, dx[1], 0.103, 'LWR DSPL', 'OFF');
  // Engraved boxes round DISPLAYS / LWR DSPL and TUNE (photo).
  p.line(0.008, 0.062, 0.108, 0.062, 0.0005, z);
  p.line(0.108, 0.062, 0.108, 0.128, 0.0005, z);
  p.line(0.108, 0.128, 0.062, 0.128, 0.0005, z);
  p.line(0.112, 0.062, 0.162, 0.062, 0.0005, z);
  const big = (id: string, label: string, v: string, x: number, positions: { value: number; label: string; angle: number }[], title: string) => {
    p.add(new SelectorKnob(env, { id, var: v, label, cap: 'bar', diameter: 0.02, labelRadius: 0.019, labelHeight: 0.0019, labelZone: z, positions, initial: 1 }), x, 0.098);
    p.label(title, x, 0.069, { height: 0.0024, zone: z });
  };
  big('g6k.ped.displays', 'DISPLAYS NORM / REV', V.displaysRev, dx[0], [
    { value: 0, label: 'NORM', angle: 0 },
    { value: 1, label: 'REV', angle: 50 },
  ], 'DISPLAYS');
  big('g6k.ped.tune', 'TUNE (VHF / NORM / DSPL)', V.tuneSel, dx[2], [
    { value: 1, label: 'VHF', angle: -50 },
    { value: 0, label: 'NORM', angle: 0 },
    { value: 2, label: 'DSPL', angle: 50 },
  ], 'TUNE');
  // Switchlights (Korry, white legends lit while reverted).
  const ky = 0.172;
  const key = (id: string, label: string, v: string, x: number, text: string, lit: (x: number) => boolean, values?: [number, number]) =>
    p.add(
      new PushButton(env, { id, label, var: v, mode: 'toggle', values, style: 'korry', width: 0.018, height: 0.012, layout: 'stack', segments: [{ text, color: 'white', var: v, test: lit }], zone: z }),
      x,
      ky,
    );
  key('g6k.ped.rev_adc1', 'L PFD ADC (X-SIDE)', V.rspAdc(1), 0.024, 'ADC', (x) => x >= 0.5);
  key('g6k.ped.rev_irs1', 'L PFD IRS (IRS 3)', V.rspAtt(1), 0.05, 'IRS', (x) => x >= 0.5);
  key('g6k.ped.rev_afcs', 'AFCS 1/2', V.rspAfcs, 0.085, '1/2', (x) => x === 2, [1, 2]);
  key('g6k.ped.rev_adc2', 'R PFD ADC (X-SIDE)', V.rspAdc(2), 0.12, 'ADC', (x) => x >= 0.5);
  key('g6k.ped.rev_irs2', 'R PFD IRS (IRS 3)', V.rspAtt(2), 0.146, 'IRS', (x) => x >= 0.5);
  p.label('[ L PFD ]', 0.037, ky - 0.012, { height: 0.0021, zone: z });
  p.label('AFCS', 0.085, ky - 0.012, { height: 0.0021, zone: z });
  p.label('[ R PFD ]', 0.133, ky - 0.012, { height: 0.0021, zone: z });
}

export function buildPedestal(c: G6kCockpitContext): void {
  const { b, env, suite } = c;
  const P = PEDESTAL;
  const R = P.row;
  const fin = g6kFinish(env);
  const zc = ZONE.centre;
  const tp = topPlacement();
  const W = P.width;
  const cx = W / 2;
  const ped = b.panel({ name: 'pedestal', center_m: tp.center_m, facing: 'up', tiltDeg: tp.tiltDeg, width: W, height: tp.length, origin: 'top-left', material: fin.charcoal, screws: false });
  const ux = (u: number) => cx + u;

  // ---- MKP 1 / 2 and CCP 1 / 2
  if (suite) {
    for (const s of [1, 2] as const) {
      const u = (s === 1 ? -1 : 1) * P.mkpU;
      addMkpVision(b, ped, ux(u), R.mkp, suite, s, { zone: zc, canvas: c.canvas });
      addCcpVision(b, ped, ux(u), R.ccp + 0.01, suite, s, { zone: zc, canvas: c.canvas, pttVar: V.yokePtt(s) });
    }
  }

  // ---- quadrant channel (u -0.07 .. +0.07): spoiler slot, thrust levers, ENGINE RUN
  const quad = plate(ped, 'quadrant', ux(-0.072), 0.004, 0.144, 0.325);
  quad.label('FLIGHT', 0.02, 0.268, { height: 0.0026, zone: zc });
  quad.label('SPOILER', 0.02, 0.274, { height: 0.0026, zone: zc });
  quad.label('R', 0.036, 0.13, { height: 0.0034, zone: zc });
  quad.label('E', 0.036, 0.138, { height: 0.0034, zone: zc });
  quad.label('T', 0.036, 0.146, { height: 0.0034, zone: zc });
  quad.label('↑', 0.036, 0.118, { height: 0.007, zone: zc });
  // Thrust lever gate placard (MAX THRUST) and the reverse marks (photo e_ped_mid).
  quad.placard({ text: 'MAX\nTHRUST', height: 0.0024, style: 'engraved', zone: zc }, 0.093, 0.105);
  quad.label('IDLE', 0.093, 0.185, { height: 0.0022, zone: zc });
  quad.label('REV', 0.093, 0.19, { height: 0.0022, zone: zc });
  quad.label('MAX REV', 0.093, 0.225, { height: 0.0022, zone: zc });
  // EVENT (flight-data recorder event marker) at the forward end. SCOPE: no recorder model (count V.fdrEventCount).
  quad.add(new PushButton(env, { id: 'g6k.ped.event', label: 'EVENT (FDR event marker)', var: V.fdrEvent, mode: 'momentary', style: 'round', width: 0.009, capMaterial: 'plasticBlack' }), 0.093, 0.012);
  quad.label('EVENT', 0.093, 0.0045, { height: 0.0019, zone: zc });

  // Thrust levers (GX_01_018: one MAX detent; IDLE; the minimum take-off position TLA.toMin stays in the FADEC logic,
  // engines.ts, with no pedestal marking: photo). Brushed-chrome drum grips side by side (photo c_ped).
  const tlDetents = [
    { value: 0, label: '' },
    { value: 1, label: '', kind: 'gate' as const, direction: 'increasing' as const },
  ];
  const drumG = env.geometry.get('g6k.tl.drum', () => new THREE.CylinderGeometry(0.018, 0.018, 0.038, 28).rotateZ(Math.PI / 2));
  const L = 0.14;
  const tlU = [0.0, 0.04];
  for (const i of [1, 2] as const) {
    const s = i === 1 ? 'L' : 'R';
    const revVar = V.revLever(i);
    const lv = ped.add(
      new Lever(env, {
        id: `g6k.ped.tl${i}`,
        var: V.tla(i),
        label: `${s} THRUST LEVER`,
        min: 0,
        max: 1,
        detents: tlDetents,
        softWidth: 0.01,
        step: 0.02,
        travel: { kind: 'arc', minDeg: -32, maxDeg: 26, pivotDepth: 0.06 },
        armLength: L,
        armWidth: 0.013,
        knob: 'ball',
        knobScale: 0.4,
        knobMaterial: 'chrome',
        armMaterial: 'plasticBlack',
        detentLabels: false,
        axis: { var: INPUT.throttle(i), map: (a) => a },
        // Mechanical interlock: the thrust lever cannot leave IDLE while its reverse lever is raised.
        limit: (vars) => (vars.get(revVar) > 0.02 ? SHUT : OPEN),
        format: (v) => (v <= TLA.idle ? 'IDLE' : v >= 0.995 ? 'MAX' : `${Math.round(v * 45)}° TLA`),
      }),
      ux(tlU[i - 1]),
      0.2,
    );
    lv.handle.userData.cockpitDynamic = true;
    const drum = new THREE.Mesh(drumG, env.materials.get('chrome'));
    drum.position.set(0, 0, L + 0.004);
    lv.handle.add(drum);
    const out = i === 1 ? -1 : 1;
    const onHandle = (ctl: PushButton | Lever, pos: [number, number, number], rot: THREE.Euler) => {
      ctl.object.position.set(...pos);
      ctl.object.rotation.copy(rot);
      lv.handle.add(ctl.object);
      for (const h of ctl.hitTargets) h.userData.hitPriority = 1;
      b.add(ctl);
    };
    // A/T disconnect on the outboard end of each drum (thumb), TO/GA on the front of the drum (fingers) (GXAF).
    onHandle(
      new PushButton(env, { id: `g6k.ped.at_disc${i}`, label: `A/T DISC (${s})`, mode: 'momentary', event: G6K_EVENTS.atDisc, style: 'small', width: 0.01, capMaterial: 'knobRed' }),
      [out * 0.0195, 0, L + 0.004],
      new THREE.Euler(0, (out * Math.PI) / 2, 0),
    );
    onHandle(
      new PushButton(env, { id: `g6k.ped.toga${i}`, label: `TO/GA (${s})`, mode: 'momentary', event: G6K_EVENTS.toga, style: 'small', width: 0.009, capMaterial: 'plasticBlack' }),
      [0, 0.0185, L + 0.004],
      new THREE.Euler(-Math.PI / 2, 0, 0),
    );
    // Piggy-back reverse lever on the front of the thrust lever: lifted up and aft, only at IDLE and on the ground
    // (dossier §12.4; FADEC limits reverse N1 to 70 %, engines.ts). 0 stowed, ~0.1 IDLE REV, 1 MAX REV.
    const rev = new Lever(env, {
      id: `g6k.ped.rev${i}`,
      var: revVar,
      label: `${s} REVERSE LEVER`,
      min: 0,
      max: 1,
      detents: [
        { value: 0, label: '' },
        { value: 0.1, label: '' },
        { value: 1, label: '' },
      ],
      softWidth: 0.02,
      step: 0.1,
      travel: { kind: 'arc', minDeg: 6, maxDeg: -70, pivotDepth: 0 },
      armLength: 0.065,
      armWidth: 0.008,
      armThickness: 0.005,
      knob: 'reverser',
      knobScale: 0.6,
      armMaterial: 'chrome',
      slot: false,
      detentLabels: false,
      limit: (vars) => (vars.get(V.tla(i)) <= TLA.idle + 0.01 && vars.get('gear.air_ground') !== 0 ? OPEN : SHUT),
      format: (v) => (v < 0.02 ? 'STOWED' : v < 0.15 ? 'IDLE REV' : `REV ${Math.round(v * 100)} %`),
    });
    onHandle(rev, [0, 0.02, L * 0.5], new THREE.Euler(0, 0, 0));
  }

  // ---- FLIGHT SPOILER lever in its own slot at the left edge of the quadrant (RETRACT arrow). Scale 0 / 1/4 / 1/2 /
  // 3/4 / FULL / MAX (photo EB190582 e_ped_mid / e_acp). GX PTG 10-44: the lever is latched at 0 (the unlatch selector on
  // top of the lever must be pressed to leave 0) and gated FULL -> MAX; soft detents between. logic.ts schedule:
  // 0 .. FULL (0.9) proportional inboard MFS, MAX adds the outboard MFS with the flaps at 0.
  ped.add(
    new Lever(env, {
      id: 'g6k.ped.spoiler',
      var: V.flightSpoiler,
      label: 'FLIGHT SPOILER',
      min: 0,
      max: 1,
      detents: [
        { value: 0, label: '0', kind: 'gate', direction: 'increasing' },
        { value: 0.25, label: '1/4' },
        { value: 0.5, label: '1/2' },
        { value: 0.75, label: '3/4' },
        { value: FSL_FULL, label: 'FULL' },
        { value: 1, label: 'MAX', kind: 'gate', direction: 'increasing' },
      ],
      softWidth: 0.02,
      step: 0.05,
      travel: { kind: 'arc', minDeg: 24, maxDeg: -26, pivotDepth: 0.04 },
      armLength: 0.12,
      armMaterial: 'plasticBlack',
      knob: 'speedbrake',
      knobMaterial: 'chrome',
      detentLabels: 'left',
      labelHeight: 0.0022,
    }),
    ux(-0.05),
    0.17,
  );

  // ---- ENGINE RUN L / R (lift-lock toggles ON / OFF) at the aft end of the quadrant (photo e_acp).
  quad.label('ENGINE RUN', 0.093, 0.318, { height: 0.0026, zone: zc });
  for (const i of [1, 2] as const) {
    const s = i === 1 ? 'L' : 'R';
    quad.add(
      new ToggleSwitch(env, {
        id: `g6k.ped.run${i}`,
        var: V.engRun(i),
        label: `ENGINE RUN ${s}`,
        positions: ['OFF', 'ON'],
        values: [0, 1],
        leverLock: true,
        labels: { name: s, positions: true, height: 0.0022, zone: zc },
        scale: 1.05,
      }),
      i === 1 ? 0.073 : 0.113,
      0.29,
    );
  }

  // ---- ACP 1 / 2 (audio control panels) aft of the CCPs, either side of the PARK/EMER BRAKE / SLAT/FLAP (photo
  // e_ped_aft), and the reversion panel below ACP 1 (photo e_ped_l).
  buildAcp(c, plate(ped, 'acp1', ux(-0.265), ACP_Y, 0.17, ACP_H), 1);
  buildAcp(c, plate(ped, 'acp2', ux(0.08), ACP_Y, 0.185, ACP_H), 2);
  buildReversion(c, plate(ped, 'reversion', ux(-0.265), REV_Y, 0.17, 0.2));

  // ---- PARK/EMER BRAKE (centre, recessed gate between ACP 1 and the flap lever; caption on both sides, photo)
  const gate = plate(ped, 'park_gate', ux(-0.092), R.acp - 0.055, 0.09, 0.28);
  const recess = new THREE.Mesh(env.geometry.get('g6k.park.recess', () => new THREE.BoxGeometry(0.052, 0.2, 0.004)), env.materials.get('panelDark'));
  recess.userData.cockpitStatic = true;
  gate.addObject(recess, 0.045, 0.13, { z: 0.001 });
  gate.label('PARK/EMER', 0.012, 0.245, { height: 0.0019, zone: zc });
  gate.label('BRAKE', 0.012, 0.252, { height: 0.0022, zone: zc });
  gate.label('PARK/EMER', 0.078, 0.245, { height: 0.0019, zone: zc });
  gate.label('BRAKE', 0.078, 0.252, { height: 0.0022, zone: zc });
  const park = gate.add(
    new Lever(env, {
      id: 'g6k.ped.park_brake',
      var: V.parkBrake,
      label: 'PARK/EMER BRAKE',
      min: 0,
      max: 1,
      detents: [
        { value: 0, label: '' },
        { value: 1, label: '', kind: 'gate', direction: 'increasing' },
      ],
      softWidth: 0.02,
      step: 0.1,
      // Pulled aft (toward the crew) to brake / park: + angle toward the panel's -v (aft on the pedestal frame).
      travel: { kind: 'arc', minDeg: -14, maxDeg: 30, pivotDepth: 0.03 },
      armLength: 0.11,
      armWidth: 0.012,
      armMaterial: 'chrome',
      knob: 'ball',
      knobScale: 0.3,
      knobMaterial: 'plasticBlack',
      slot: false,
      detentLabels: false,
      format: (v) => (v >= 0.95 ? 'PARK (locked)' : v < 0.02 ? 'OFF' : `EMER ${Math.round(v * 100)} %`),
    }),
    0.045,
    0.12,
  );
  // Vertical T-grip: black grip with a red band over a chrome base (photo e_ped_l).
  park.handle.userData.cockpitDynamic = true;
  const gripG = env.geometry.get('g6k.park.grip', () => new THREE.CylinderGeometry(0.009, 0.009, 0.075, 16).rotateX(Math.PI / 2));
  const bandG = env.geometry.get('g6k.park.band', () => new THREE.CylinderGeometry(0.0093, 0.0093, 0.005, 16).rotateX(Math.PI / 2));
  const grip = new THREE.Mesh(gripG, env.materials.get('plasticBlack'));
  grip.position.set(0, 0, 0.11 + 0.035);
  const band = new THREE.Mesh(bandG, env.materials.get('knobRed'));
  band.position.set(0, 0, 0.11 + 0.004);
  park.handle.add(grip, band);

  // ---- SLAT/FLAP lever (aft of ENGINE RUN, right of the PARK/EMER BRAKE recess; photo e_ped_aft):
  // two-column scale SLAT (IN / OUT) and FLAP (0 / 0 / 6 / 16 / 30), gates at 0 OUT and 6 (dossier §12.4, GXFC).
  const fl = plate(ped, 'slat_flap', ux(0.0), R.acp - 0.055, 0.07, 0.28);
  const rows = [0.05, 0.095, 0.14, 0.185, 0.23];
  const slat = ['IN', 'OUT', 'OUT', 'OUT', 'OUT'];
  const flap = ['0', '0', '6', '16', '30'];
  rows.forEach((ry, i) => {
    fl.label(slat[i], 0.012, ry, { height: 0.0024, zone: zc });
    fl.label(flap[i], 0.06, ry, { height: 0.0024, zone: zc });
  });
  fl.label('SLAT', 0.012, 0.265, { height: 0.0026, zone: zc });
  fl.label('FLAP', 0.06, 0.265, { height: 0.0026, zone: zc });
  fl.add(
    new Lever(env, {
      id: 'g6k.ped.flaps',
      var: V.flapLever,
      label: 'SLAT/FLAP',
      min: 0,
      max: 4,
      discrete: true,
      detents: [
        { value: 0, label: '' },
        { value: 1, label: '', kind: 'gate' },
        { value: 2, label: '', kind: 'gate' },
        { value: 3, label: '' },
        { value: 4, label: '' },
      ],
      // 0 IN at the forward end, 30 at the aft end of the slot (photo).
      travel: { kind: 'arc', minDeg: 34, maxDeg: -34, pivotDepth: 0.16 },
      armLength: 0.1,
      armMaterial: 'chrome',
      knob: 'flap',
      knobMaterial: 'plasticBlack',
      slot: { width: 0.012, plateWidth: 0.02 },
      detentLabels: false,
      format: (v) => ['0 IN (slats in)', '0 OUT (slats out)', '6', '16', '30'][Math.round(v)] ?? String(v),
    }),
    0.036,
    0.14,
  );

  // ---- COCKPIT LIGHTS (right; photo e_ped_aft): AREA, OVHD / CB INTEG; L / CTR / R INTEG; PBA, EYE REF, MASTER INTEG,
  // FOOT (GX PTG 15-11 .. 15-13).
  const lp = plate(ped, 'cockpit_lights', ux(0.08), REV_Y, 0.185, 0.2);
  const lx = [0.035, 0.0925, 0.15];
  dimmer(c, lp, 'g6k.ped.area', 'AREA (FLOOR / CEILING)', V.ltArea, lx[0], 0.035, 'AREA', 'OFF');
  dimmer(c, lp, 'g6k.ped.integral_ovhd', 'OVHD INTEG', V.ltIntegral('ovhd'), lx[1], 0.035, 'OVHD INTEG');
  dimmer(c, lp, 'g6k.ped.integral_cb', 'CB INTEG', V.ltIntegral('cb'), lx[2], 0.035, 'CB INTEG');
  dimmer(c, lp, 'g6k.ped.integral_l', 'L INTEG', V.ltIntegral('l'), lx[0], 0.09, 'L INTEG');
  dimmer(c, lp, 'g6k.ped.integral_c', 'CTR INTEG', V.ltIntegral('c'), lx[1], 0.09, 'CTR INTEG');
  dimmer(c, lp, 'g6k.ped.integral_r', 'R INTEG', V.ltIntegral('r'), lx[2], 0.09, 'R INTEG');
  const tx = [0.025, 0.07, 0.115, 0.16];
  const ty = 0.155;
  const tog = (id: string, label: string, v: string, x: number, positions: string[], values: number[], initial: number, name: string) =>
    lp.add(new ToggleSwitch(env, { id, label, var: v, positions, values, initial, labels: { name, positions: true, height: 0.0017, zone: zc }, scale: 0.7 }), x, ty);
  tog('g6k.ped.pba_dim', 'PBA DIM / BRT', V.ltPbaDim, tx[0], ['DIM', 'BRT'], [0, 1], 1, 'PBA');
  tog('g6k.ped.eye_ref', 'EYE REF', V.ltEyeRef, tx[1], ['OFF', 'ON'], [0, 1], 0, 'EYE REF');
  tog('g6k.ped.master_integ', 'MASTER INTEG', V.ltMaster, tx[2], ['OFF', 'AUTO', 'ON'], [0, 1, 2], 2, 'MASTER INTEG');
  tog('g6k.ped.foot', 'FOOT LIGHTS', V.ltFoot, tx[3], ['OFF', 'ON'], [0, 1], 0, 'FOOT');

  // ---- aft section (EST positions: not in the photographs)
  const ap = plate(ped, 'aft_controls', ux(-0.26), R.aft - 0.035, 0.52, 0.2);
  // TRIM: STAB CH 1 / CH 2 disconnect (guarded), AIL trim split switch, RUD trim rotary.
  const ty2 = 0.045;
  ap.label('STAB TRIM', 0.07, ty2 - 0.028, { height: 0.0026, zone: zc });
  // GX PTG 10-24 (GX_10_020): STAB CH 1 / CH 2 "PUSH OFF/RESET" switchlights, not guarded, normally dark; white OFF
  // legend while selected (the channel is disconnected; STAB CH n OFF status).
  for (const n of [1, 2] as const) {
    const x = n === 1 ? 0.045 : 0.095;
    pba(c, ap, { id: `g6k.ped.stab_ch${n}`, label: `STAB CH ${n}`, v: V.stabCh(n), x, y: ty2, segments: [seg.on('OFF', 'white', V.stabCh(n))], name: `CH ${n}`, nameBelow: true, zone: zc });
  }
  ap.label('PUSH OFF/RESET', 0.07, ty2 + 0.02, { height: 0.0019, zone: zc });
  ap.add(
    new ToggleSwitch(env, {
      id: 'g6k.ped.ail_trim',
      var: V.ailTrimSw,
      label: 'AIL TRIM',
      positions: ['LWD', '', 'RWD'],
      values: [-1, 0, 1],
      initial: 1,
      springs: { 0: 1, 2: 1 },
      orientation: 'horizontal',
      labels: { name: 'AIL TRIM', positions: true, height: 0.0022, zone: zc },
      scale: 0.9,
    }),
    0.19,
    ty2,
  );
  ap.add(
    new SelectorKnob(env, {
      id: 'g6k.ped.rud_trim',
      var: V.rudTrimSw,
      label: 'RUD TRIM',
      cap: 'bar',
      diameter: 0.018,
      labelHeight: 0.0022,
      labelZone: zc,
      positions: [
        { value: -1, label: 'NL', angle: -45, spring: 1 },
        { value: 0, label: '', angle: 0 },
        { value: 1, label: 'NR', angle: 45, spring: 1 },
      ],
      initial: 1,
      title: 'RUD TRIM',
    }),
    0.3,
    ty2,
  );
  // GND LIFT DUMPING (GX PTG 10-50, GX_10_049): one three-position switch MANUAL ARM / AUTO / OFF.
  ap.label('GND LIFT', 0.43, ty2 - 0.03, { height: 0.0026, zone: zc });
  ap.label('DUMPING', 0.43, ty2 - 0.025, { height: 0.0026, zone: zc });
  ap.add(
    new ToggleSwitch(env, {
      id: 'g6k.ped.gld',
      var: V.gldSw,
      label: 'GND LIFT DUMPING',
      positions: ['OFF', 'AUTO', 'MANUAL ARM'],
      values: [2, 0, 1],
      initial: 1,
      labels: { positions: true, height: 0.0021, zone: zc },
      scale: 0.9,
    }),
    0.43,
    ty2,
  );
  // IRS 1 / 2 / 3 mode selectors.
  const iy = 0.14;
  for (const n of [1, 2, 3] as const) {
    ap.add(
      new SelectorKnob(env, {
        id: `g6k.ped.irs${n}`,
        var: V.irsMode(n),
        label: `IRS ${n}`,
        cap: 'pointer',
        diameter: 0.016,
        labelHeight: 0.0021,
        labelZone: zc,
        positions: [
          { value: 0, label: 'OFF', angle: -60 },
          { value: 1, label: 'ALN', angle: -20 },
          { value: 2, label: 'NAV', angle: 20 },
          { value: 3, label: 'ATT', angle: 60 },
        ],
        initial: 0,
        title: `IRS ${n}`,
      }),
      0.14 + (n - 1) * 0.12,
      iy,
    );
  }

  // ---- aft face of the pedestal (facing aft, toward the cabin): RAT manual deploy and landing-gear manual release.
  const aftH = FLOOR_Z - P.topAft[1];
  const aft = b.panel({ name: 'ped_aft', center_m: [P.topAft[0] - 0.003, 0, P.topAft[1] + aftH / 2], facing: 'fwd', width: W - 0.02, height: aftH - 0.02, material: 'panelDark', screws: false });
  aft.add(new TBarHandle(env, { id: 'g6k.ped.rat_deploy', label: 'RAT MANUAL DEPLOY', var: V.ratDeploy, style: 'tbar', legend: 'RAT', material: 'paintYellow', scale: 1.1 }), 0.1, 0.1);
  aft.label('RAT DEPLOY - PULL', 0.1, 0.155, { height: 0.0027 });
  aft.add(new TBarHandle(env, { id: 'g6k.ped.gear_release', label: 'LDG GEAR MANUAL RELEASE', var: V.gearManRelease, style: 'tbar', legend: 'GEAR', material: 'knobRed', scale: 1.1 }), -0.1, 0.1);
  aft.label('LDG GEAR MAN REL', -0.1, 0.155, { height: 0.0027 });
}
