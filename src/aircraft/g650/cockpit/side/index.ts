/**
 * Gulfstream G650 side consoles (contract in ../context.ts; dossier §8 / §9.10).
 *
 * Each console top (outboard of the seat, between the armrest and the sidewall) carries, forward to aft:
 *  - the cursor control device (PlaneView CCD, Epic `addCcd`, ids `epic.ccd{1,2}.*`) at the forward end of
 *    the armrest (BJT G500 pilot report: on the G450 / G550 / G650 "the CCDs live ... on the outboard ledge"),
 *    and the audio control panel (ACP) outboard of it (EST position; the Primus Epic ACPs are on the
 *    emergency / flight-instrument buses, LUC electrical);
 *  - the map light dimmer (`ac.g650.light.map_l/_r`, the map light in the side-window header);
 *  - the crew oxygen mask stowage box with the mask regulator (N / 100 % / EMER) and the flow indicator;
 *  - pilot side only: the VEST LTS ORIDE switchlight (vestibule / companionway lights off).
 * The pilot's console also has the nosewheel tiller at its forward end (built by the main cockpit).
 *
 * SCOPE / EST: positions and sizes from photographs; one mask regulator var (`ac.g650.oxy.mask_mode`) is
 * shared by both masks (the OxygenSystem crew-mask model has a single mode binding), so both selectors
 * show and set the same mode; ACP audio is state only (systems/audio.ts).
 */
import * as THREE from 'three';
import { AnnunciatorLight, RotaryKnob, SelectorKnob } from '../../../../cockpit/controls';
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import { CanvasDisplay, type DisplayCanvas } from '../../../../avionics/common/CanvasDisplay';
import type { Ctx2D } from '../../../../avionics/common/draw/context';
import type { SimVars } from '../../../../core/SimVars';
import { trimBoxGeometry } from '../../../../cockpit/geometry/structure';
import { addCcd } from '../../../../avionics/honeywell-epic/cockpit';
import { ACP_CHANNELS, G650_VARS as V, type AcpChannel } from '../../vars';
import { CONSOLE } from '../layout';
import { seg, type G650CockpitContext } from '../context';
import { SwitchLight, sl } from '../overhead/parts';
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

/**
 * ACP display window (right-console photograph Flickr 52948762561: the PlaneView ACP has a display window
 * above the key field). Shows the selected transmitter, the keyed state and the receiver volumes as a bar
 * row. EST format (the real page layout is not published). Powered from the audio panel's bus.
 */
class AcpDisplay extends CanvasDisplay {
  private readonly v: SimVars;
  private readonly n: 1 | 2;
  constructor(n: 1 | 2, vars: SimVars, canvas?: DisplayCanvas) {
    super({ id: `g650.acp${n}.display`, width: 256, height: 96, vars, refreshHz: 5, powerVar: 'elec.acp_powered', brightnessVar: null, canvas, background: '#04120a' });
    this.v = vars;
    this.n = n;
    this.watch(V.acpTx(n), 0);
    this.watch(V.acpKeyed(n), 0);
    for (const ch of ACP_CHANNELS) this.watch(V.acpVol(n, ch), 0.02);
  }
  protected draw(ctx: Ctx2D): void {
    const tx = this.v.get(V.acpTx(this.n));
    const keyed = this.v.get(V.acpKeyed(this.n));
    ctx.fillStyle = '#5ee08a';
    ctx.font = 'bold 20px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const name = MIC.find(([k]) => k === tx)?.[1] ?? 'NONE';
    ctx.fillText(`TX ${name}`, 8, 16);
    if (keyed > 0) {
      ctx.textAlign = 'right';
      ctx.fillText('MIC', 248, 16);
    } else if (keyed < 0) {
      ctx.textAlign = 'right';
      ctx.fillText('INT', 248, 16);
    }
    ctx.font = '12px monospace';
    ctx.textAlign = 'center';
    ACP_CHANNELS.forEach((ch, i) => {
      const x = 22 + i * 34;
      const vol = this.v.get(V.acpVol(this.n, ch));
      ctx.fillStyle = '#2c5c40';
      ctx.fillRect(x - 6, 38, 12, 34);
      ctx.fillStyle = '#5ee08a';
      ctx.fillRect(x - 6, 38 + (1 - vol) * 34, 12, vol * 34);
      ctx.fillText(CH_LABEL[ch], x, 84);
    });
  }
}

/**
 * Audio control panel (EST Primus Epic ACP layout, right-console photograph Flickr 52948762561: a display
 * window over a field of full-size keys and knobs): display, MIC select keys, receiver volume knobs.
 */
function buildAcp(c: G650CockpitContext, parent: Panel, x: number, y: number, n: 1 | 2): void {
  const { env } = c;
  const W = 0.125;
  const H = 0.205;
  const p = parent.subPanel({ name: `g650.acp${n}`, x, y, width: W, height: H, origin: 'top-left', material: 'panelDark', thickness: 0.006, screws: { kind: 'dzus', diameter: 0.005, inset: 0.005, positions: [[0.005, 0.005], [W - 0.005, 0.005], [0.005, H - 0.005], [W - 0.005, H - 0.005]] } });
  p.label(`AUDIO ${n}`, W / 2, 0.011, { height: 0.0026, weight: 800 });
  // ---- display window
  const disp = new AcpDisplay(n, c.ctx.vars, c.canvas?.(256, 96));
  p.display(disp, W / 2, 0.031, 0.085, 0.032, { bezel: { border: 0.003, depth: 0.003, material: 'bezel' }, display: { glass: true, powerVar: 'elec.acp_powered' } });
  // ---- MIC select keys (full-size square keys, 2 rows of 3)
  p.label('MIC', W / 2, 0.055, { height: 0.002 });
  const mic = V.acpMic(n);
  MIC.forEach(([k, name], i) => {
    const kx = 0.03 + (i % 3) * 0.033;
    const ky = 0.072 + Math.floor(i / 3) * 0.026;
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
        width: 0.028,
        height: 0.02,
        layout: 'stack',
        segments: [{ text: name, color: 'green', var: V.acpTx(n), test: (t: number) => t === k }],
      }),
      kx,
      ky,
    );
  });
  // ---- receiver volume knobs (4 + 3)
  p.label('VOLUME', W / 2, 0.116, { height: 0.002 });
  ACP_CHANNELS.forEach((ch, i) => {
    const row = i < 4 ? 0 : 1;
    const col = row === 0 ? i : i - 4;
    const kx = row === 0 ? 0.019 + col * 0.029 : 0.0335 + col * 0.029;
    const ky = 0.134 + row * 0.037;
    p.add(
      new RotaryKnob(env, {
        id: `g650.acp${n}.vol_${ch}`,
        label: `ACP ${n} ${CH_LABEL[ch]} VOLUME`,
        cap: 'knurled',
        diameter: 0.014,
        height: 0.011,
        outer: { var: V.acpVol(n, ch), min: 0, max: 1, step: 0.05, initial: ch === 'mkr' || ch === 'adf' ? 0 : 0.5, angleRange: [-135, 135], format: (t) => `${Math.round(t * 100)} %` },
      }),
      kx,
      ky,
    );
    p.label(CH_LABEL[ch], kx, ky + 0.0125, { height: 0.0017 });
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
  buildAcp(c, p, X(0.235), 0.12, side);

  // ---- quilted armrest pad and filler trim panels (right-console photograph Flickr 52948762561: a multi-
  // panel console with a quilted armrest pad and blank trim plates filling the top; EST sizes).
  {
    const padG = trimBoxGeometry(0.09, 0.03, 0.34, 0.013);
    b.trackGeometry(padG);
    const pad = new THREE.Mesh(padG, env.materials.get('leather'));
    pad.name = `g650.side${side}.armrest_pad`;
    pad.userData.cockpitStatic = true;
    // trimBox axes: x = width, y = thickness, z = length; lay the length along the console (panel y).
    pad.rotation.x = Math.PI / 2;
    p.addObject(pad, X(0.06), 0.55, { z: 0.014 });
    p.subPanel({ name: `g650.side${side}.filler_fwd`, x: X(0.24), y: 0.7, width: 0.22, height: 0.16, material: 'panelDark', screws: { kind: 'dzus', diameter: 0.005, inset: 0.006 }, radius: 0.006 });
    p.subPanel({ name: `g650.side${side}.filler_aft`, x: X(0.18), y: 0.9, width: 0.3, height: 0.12, material: 'panelDark', screws: { kind: 'dzus', diameter: 0.005, inset: 0.006 }, radius: 0.006 });
  }

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

  // ---- VEST LTS ORIDE (pilot console; G650 training material: "on the side console panel ... alternate means
  // for turning off the vestibule or companionway lights ... blue ON"). EST: pilot side, between ACP and mask.
  if (side === 1) {
    sl(env, p, { id: 'g650.side.vest_oride', label: 'VEST LTS ORIDE (vestibule lights off)', var: V.vestOride, name: 'VEST LTS\nORIDE', segments: [seg.on('ON', 'cyan', V.vestOride)] }, X(0.2), 0.3);
    // Flight-deck door controls (EST: cabin photographs show a cockpit divider/door; no public lock-panel
    // source found, so the keys and their placement are estimated - dossier §13). DOOR toggles the aft
    // bulkhead door leaf (shell.ts animates V.doorCockpit); LOCK latches it closed (audio/logic state).
    sl(env, p, { id: 'g650.side.door', label: 'COCKPIT DOOR open/close', var: V.doorCockpit, name: 'DOOR', segments: [seg.on('OPEN', 'cyan', V.doorCockpit)] }, X(0.335), 0.3);
    sl(env, p, { id: 'g650.side.door_lock', label: 'COCKPIT DOOR LOCK', var: V.doorLockSw, name: 'DOOR\nLOCK', segments: [seg.on('LOCKED', 'cyan', V.doorLocked)] }, X(0.47), 0.3);
  }

  // ---- oxygen mask stowage, regulator, flow indicator.
  const mask = new G650MaskStowage(env, { id: `g650.side.mask_${tag}`, label: `${who} OXYGEN MASK`, var: side === 1 ? V.oxyMaskL : V.oxyMaskR });
  p.add(mask, X(0.235), 0.42);
  p.add(
    new SelectorKnob(env, {
      id: `g650.side.mask_mode_${tag}`,
      // Each EROS mask has its own N / 100 % / EMERGENCY regulator (LUC oxygen): per-side var.
      var: side === 1 ? V.oxyMaskModeL : V.oxyMaskModeR,
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
