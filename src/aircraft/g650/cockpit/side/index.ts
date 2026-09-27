/**
 * Gulfstream G650 side consoles (contract in ../context.ts; dossier §8 / §9.10).
 *
 * Each console top (outboard of the seat, between the armrest and the sidewall) carries, forward to aft:
 *  - the cursor control device (PlaneView CCD, Epic `addCcd`, ids `epic.ccd{1,2}.*`) at the forward end of
 *    the armrest (BJT G500 pilot report: on the G450 / G550 / G650 "the CCDs live ... on the outboard ledge"),
 *    and the audio control panel (ACP) outboard of it (EST position; the Primus Epic ACPs are on the
 *    emergency / flight-instrument buses, LUC electrical);
 *  - the map light dimmer (`ac.g650.light.map_l/_r`, the map light in the side-window header);
 *  - the crew oxygen mask stowage box with the mask regulator (N / 100 % / EMER) and the flow indicator.
 * The pilot's console also has the nosewheel tiller at its forward end (built by the main cockpit).
 *
 * SCOPE / EST: positions and sizes from photographs; one mask regulator var (`ac.g650.oxy.mask_mode`) is
 * shared by both masks (the OxygenSystem crew-mask model has a single mode binding), so both selectors
 * show and set the same mode; ACP audio is state only (systems/audio.ts).
 */
import { AnnunciatorLight, RotaryKnob, SelectorKnob } from '../../../../cockpit/controls';
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import { addCcd } from '../../../../avionics/honeywell-epic/cockpit';
import { ACP_CHANNELS, G650_VARS as V, type AcpChannel } from '../../vars';
import { CONSOLE } from '../layout';
import type { G650CockpitContext } from '../context';
import { SwitchLight } from '../overhead/parts';
import { G650MaskStowage } from './mask';

/** Console top panel: inboard edge (|y|), outboard edge, forward / aft x (EST, clear of the armrest pad and tiller). */
export const SIDE = { yIn: 0.885, yOut: 1.25, xFwd: 14.15, xAft: 13.15 } as const;

const MIC: [number, string][] = [
  [1, 'VHF 1'],
  [2, 'VHF 2'],
  [3, 'VHF 3'],
  [4, 'HF 1'],
  [5, 'HF 2'],
  [6, 'PA'],
];
const CH_LABEL: Record<AcpChannel, string> = { vhf1: 'VHF1', vhf2: 'VHF2', vhf3: 'VHF3', nav1: 'NAV1', nav2: 'NAV2', adf: 'ADF', mkr: 'MKR' };

/** Audio control panel (EST Primus Epic ACP layout): MIC select keys and receiver volume knobs. */
function buildAcp(c: G650CockpitContext, parent: Panel, x: number, y: number, n: 1 | 2): void {
  const { env } = c;
  const W = 0.1;
  const H = 0.14;
  const p = parent.subPanel({ name: `g650.acp${n}`, x, y, width: W, height: H, origin: 'top-left', material: 'panelDark', thickness: 0.006, screws: { kind: 'dzus', diameter: 0.005, inset: 0.005, positions: [[0.005, 0.005], [W - 0.005, 0.005], [0.005, H - 0.005], [W - 0.005, H - 0.005]] } });
  p.label(`AUDIO ${n}`, W / 2, 0.011, { height: 0.0026, weight: 800 });
  p.label('MIC', W / 2, 0.021, { height: 0.002 });
  const mic = V.acpMic(n);
  MIC.forEach(([k, name], i) => {
    const kx = 0.02 + (i % 3) * 0.03;
    const ky = 0.033 + Math.floor(i / 3) * 0.018;
    p.add(
      new SwitchLight(env, {
        id: `g650.acp${n}.mic_${k}`,
        label: `ACP ${n} MIC ${name}`,
        var: mic,
        values: [0, 1, 2, 3, 4, 5, 6],
        next: () => k,
        initial: 1,
        stateNames: ['NONE', ...MIC.map((m) => m[1])],
        style: 'korry',
        width: 0.024,
        height: 0.012,
        layout: 'stack',
        segments: [{ text: name, color: 'green', var: V.acpTx(n), test: (t: number) => t === k }],
      }),
      kx,
      ky,
    );
  });
  p.label('VOLUME', W / 2, 0.066, { height: 0.002 });
  ACP_CHANNELS.forEach((ch, i) => {
    const row = i < 4 ? 0 : 1;
    const col = row === 0 ? i : i - 4;
    const kx = row === 0 ? 0.016 + col * 0.0227 : 0.027 + col * 0.0227;
    const ky = 0.083 + row * 0.03;
    p.add(
      new RotaryKnob(env, {
        id: `g650.acp${n}.vol_${ch}`,
        label: `ACP ${n} ${CH_LABEL[ch]} VOLUME`,
        cap: 'knurled',
        diameter: 0.0105,
        height: 0.009,
        outer: { var: V.acpVol(n, ch), min: 0, max: 1, step: 0.05, initial: ch === 'mkr' || ch === 'adf' ? 0 : 0.5, angleRange: [-135, 135], format: (t) => `${Math.round(t * 100)} %` },
      }),
      kx,
      ky,
    );
    p.label(CH_LABEL[ch], kx, ky + 0.0105, { height: 0.0017 });
  });
}

function buildConsole(c: G650CockpitContext, side: 1 | 2): void {
  const { b, env, suite } = c;
  const s = side === 1 ? -1 : 1;
  const w = SIDE.yOut - SIDE.yIn;
  const len = SIDE.xFwd - SIDE.xAft;
  const yc = s * (SIDE.yIn + SIDE.yOut) / 2;
  const p = b.panel({
    name: `g650.side${side}`,
    center_m: [(SIDE.xFwd + SIDE.xAft) / 2, yc, CONSOLE.topZ - 0.001],
    facing: 'up',
    width: w,
    height: len,
    origin: 'top-left',
    material: 'panelDark',
    screws: false,
    radius: 0.01,
  });
  // Panel x runs along body +y: the inboard edge is at x = w on the left console and x = 0 on the right one.
  const X = (dIn: number) => (side === 1 ? w - dIn : dIn);
  const tag = side === 1 ? 'l' : 'r';
  const who = side === 1 ? 'PILOT' : 'COPILOT';

  // ---- CCD (forward, inboard) and ACP (outboard).
  if (suite) addCcd(b, p, X(0.07), 0.09, suite, side);
  buildAcp(c, p, X(0.235), 0.09, side);

  // ---- map light dimmer.
  p.add(
    new RotaryKnob(env, {
      id: `g650.side.map_${tag}`,
      label: `${who} MAP LIGHT`,
      cap: 'dimmer',
      diameter: 0.016,
      outer: { var: side === 1 ? V.ltMapL : V.ltMapR, min: 0, max: 1, step: 0.05, angleRange: [-135, 135], format: (t) => (t < 0.01 ? 'OFF' : `${Math.round(t * 100)} %`) },
    }),
    X(0.07),
    0.225,
  );
  p.label('MAP LT', X(0.07), 0.205, { height: 0.0024 });
  p.label('OFF     BRT', X(0.07), 0.245, { height: 0.0018 });

  // ---- oxygen mask stowage, regulator, flow indicator.
  const mask = new G650MaskStowage(env, { id: `g650.side.mask_${tag}`, label: `${who} OXYGEN MASK`, var: side === 1 ? V.oxyMaskL : V.oxyMaskR });
  p.add(mask, X(0.235), 0.42);
  p.add(
    new SelectorKnob(env, {
      id: `g650.side.mask_mode_${tag}`,
      var: V.oxyMaskMode,
      label: 'MASK REGULATOR (N / 100 % / EMER)',
      cap: 'pointer',
      diameter: 0.014,
      labelHeight: 0.0019,
      positions: [
        { value: 0, label: 'N', angle: -50 },
        { value: 1, label: '100%', angle: 0 },
        { value: 2, label: 'EMER', angle: 50 },
      ],
      initial: 0,
      title: 'MASK',
    }),
    X(0.08),
    0.4,
  );
  p.add(
    new AnnunciatorLight(env, {
      id: `g650.side.mask_flow_${tag}`,
      label: `${who} OXYGEN FLOW indicator`,
      width: 0.018,
      height: 0.011,
      segments: [{ text: ['O2', 'FLOW'], color: 'green', var: side === 1 ? 'oxy.pilot_flowing' : 'oxy.copilot_flowing' }],
    }),
    X(0.08),
    0.46,
  );
}

export function buildSideConsoles(c: G650CockpitContext): void {
  buildConsole(c, 1);
  buildConsole(c, 2);
}
