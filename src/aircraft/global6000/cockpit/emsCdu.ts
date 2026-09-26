/**
 * Global 6000 EMS CDU (Electrical Management System control display unit),
 * the pedestal unit that holds the electrical EMER CNTL functions and the
 * TEST functions of the dossier inventory (§12.1 / §12.4):
 *
 *  - EMER CNTL page: line keys toggle MAN OFF (manual isolation) of AC BUS 1-4
 *    (L1-L4) and DC BUS 1, DC BUS 2, DC ESS, BATT BUS (R1-R4)
 *    (`ac.elec.ac_bus{n}_isol`, `ac.elec.<bus>_isol`: BusPowerControl and the
 *    Fusion AC / DC synoptics read them; status CAS "... MAN OFF").
 *  - TEST page: L1 FIRE TEST and L2 STALL TEST, held while the key is held
 *    (`V.fireTest` -> FireProtection test, `V.stallTest` -> StallWarning test).
 *
 * Sources: GXEL (the EMS CDUs host the electrical power management: circuit
 * breaker / SSPC control and bus EMER control), GXFP (fire detection test from
 * the EMS CDU), dossier §12. SCOPE: the unit's circuit-breaker (SSPC) pages,
 * BRT keys and second unit are not modelled; page layout, key names and colours
 * are EST (no public drawing): white titles, green NORM, amber MAN OFF, cyan
 * prompts.
 */
import type { SimVars } from '../../../core/SimVars';
import type { EventBus } from '../../../core/EventBus';
import { CanvasDisplay, type DisplayCanvas } from '../../../avionics/common/CanvasDisplay';
import type { Ctx2D } from '../../../avionics/common/draw/context';
import { KeyPad } from '../../../cockpit/controls';
import type { KeyDef } from '../../../cockpit/controls/logic/MiscLogic';
import type { Panel } from '../../../cockpit/CockpitBuilder';
import { G6K_VARS as V } from '../vars';
import { CK, type G6kCockpitContext } from './context';

export const EMS_EVENTS = {
  key: 'g6k.ems.key',
  prefix: 'g6k.ems.k.',
} as const;


const AC_ISOL = ([1, 2, 3, 4] as const).map((n) => V.acBusIsol(n));
const DC_ISOL = (['dc_bus1', 'dc_bus2', 'dc_ess', 'batt_bus'] as const).map((b) => V.dcBusIsol(b));
export const EMS_LINES = {
  emer: { left: ['AC BUS 1', 'AC BUS 2', 'AC BUS 3', 'AC BUS 4'], right: ['DC BUS 1', 'DC BUS 2', 'DC ESS BUS', 'BATT BUS'] },
  test: { left: ['FIRE TEST', 'STALL TEST', '', ''], right: ['', '', '', ''] },
};

/** Page / key logic (no Three.js): subscribes to the keypad events. */
export class EmsCduLogic {
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly vars: SimVars,
    events: EventBus,
  ) {
    if (!vars.has(CK.emsPage)) vars.set(CK.emsPage, 0);
    this.offs.push(events.on(EMS_EVENTS.key, (id) => this.press(String(id))));
    for (const k of ['L1', 'L2']) this.offs.push(events.on(`${EMS_EVENTS.prefix}${k}:up`, () => this.release(k)));
  }

  get powered(): boolean {
    const v = this.vars;
    return v.get('elec.dc_ess_powered') !== 0 || v.get('elec.batt_bus_powered') !== 0;
  }

  get page(): number {
    return this.vars.get(CK.emsPage);
  }

  press(id: string): void {
    if (!this.powered) return;
    const v = this.vars;
    if (id === 'EMER') v.set(CK.emsPage, 0);
    else if (id === 'TEST') v.set(CK.emsPage, 1);
    const side = id[0];
    const n = Number(id.slice(1)) - 1;
    if ((side !== 'L' && side !== 'R') || !(n >= 0 && n < 4)) return;
    if (this.page === 0) {
      const name = side === 'L' ? AC_ISOL[n] : DC_ISOL[n];
      v.set(name, v.get(name) !== 0 ? 0 : 1);
    } else if (side === 'L' && n === 0) v.set(V.fireTest, 1);
    else if (side === 'L' && n === 1) v.set(V.stallTest, 1);
  }

  release(id: string): void {
    if (id === 'L1' && this.vars.get(V.fireTest) !== 0) this.vars.set(V.fireTest, 0);
    if (id === 'L2' && this.vars.get(V.stallTest) !== 0) this.vars.set(V.stallTest, 0);
  }

  dispose(): void {
    for (const o of this.offs) o();
    this.offs.length = 0;
  }
}

const W = 320;
const H = 240;
const ROW_Y = [62, 102, 142, 182];

/** EMS CDU screen (320 x 240 logical px, EST). */
export class EmsCduDisplay extends CanvasDisplay {
  private readonly v: SimVars;

  constructor(vars: SimVars, canvas?: 'dom' | 'offscreen' | DisplayCanvas) {
    super({ id: 'g6k.ems_cdu', width: W, height: H, vars, canvas, refreshHz: 5, powerVar: CK.emsPower, bootTimeS: 2 });
    this.v = vars;
    this.animating = true;
  }

  protected draw(ctx: Ctx2D): void {
    const v = this.v;
    const page = v.get(CK.emsPage);
    ctx.textBaseline = 'middle';
    ctx.font = '600 20px "Arial Narrow", Arial, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(page === 0 ? 'EMER CNTL' : 'TEST', W / 2, 20);
    ctx.fillStyle = '#00d8ff';
    ctx.font = '600 12px "Arial Narrow", Arial, sans-serif';
    ctx.fillText(page === 0 ? 'BUS MAN OFF / NORM' : 'HOLD KEY TO TEST', W / 2, 40);
    const lines = page === 0 ? EMS_LINES.emer : EMS_LINES.test;
    for (let i = 0; i < 4; i++) {
      const y = ROW_Y[i];
      ctx.font = '600 14px "Arial Narrow", Arial, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      if (lines.left[i]) ctx.fillText(lines.left[i], 8, y - 9);
      ctx.textAlign = 'right';
      if (lines.right[i]) ctx.fillText(lines.right[i], W - 8, y - 9);
      ctx.font = '600 15px "Arial Narrow", Arial, sans-serif';
      if (page === 0) {
        const l = v.get(AC_ISOL[i]) !== 0;
        const r = v.get(DC_ISOL[i]) !== 0;
        ctx.textAlign = 'left';
        ctx.fillStyle = l ? '#ffb000' : '#00e000';
        ctx.fillText(l ? '<MAN OFF' : '<NORM', 8, y + 10);
        ctx.textAlign = 'right';
        ctx.fillStyle = r ? '#ffb000' : '#00e000';
        ctx.fillText(r ? 'MAN OFF>' : 'NORM>', W - 8, y + 10);
      } else if (i < 2) {
        const on = v.get(i === 0 ? V.fireTest : V.stallTest) !== 0;
        ctx.textAlign = 'left';
        ctx.fillStyle = on ? '#00e000' : '#00d8ff';
        ctx.fillText(on ? '<IN PROG' : '<TEST', 8, y + 10);
      }
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9aa0a6';
    ctx.font = '600 12px "Arial Narrow", Arial, sans-serif';
    ctx.fillText('EMER         TEST', W / 2, 226);
  }

  protected override drawBoot(ctx: Ctx2D, p: number): void {
    ctx.fillStyle = '#fff';
    ctx.font = '600 18px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('EMS CDU', W / 2, 110);
    ctx.fillStyle = '#00d8ff';
    ctx.fillRect(80, 135, 160 * p, 6);
  }
}

/**
 * EMS CDU unit on a panel, centred at (x, y) in the panel's convention: screen
 * with four line keys each side, EMER / TEST page keys below. Returns the logic.
 */
export function addEmsCdu(c: G6kCockpitContext, parent: Panel, x: number, y: number, canvas?: 'dom' | 'offscreen' | DisplayCanvas | null): EmsCduLogic {
  const { env } = c;
  const w = 0.13;
  const h = 0.115;
  const p = parent.subPanel({ name: 'g6k.ems_cdu', x, y, width: w, height: h, origin: 'top-left', material: 'panelDark', thickness: 0.008 });
  const sw = 0.084;
  const sh = 0.063;
  const sy = 0.008;
  if (canvas !== null) p.display(new EmsCduDisplay(c.ctx.vars, canvas), w / 2, sy + sh / 2, sw, sh, { bezel: false });
  const rows = (side: 'L' | 'R'): KeyDef[][] => [1, 2, 3, 4].map((n) => [{ id: `${side}${n}`, label: '', style: 'lsk' }]);
  const pitch = ((ROW_Y[1] - ROW_Y[0]) / H) * sh;
  const keyH = 0.0055;
  const top = sy + ((ROW_Y[0] + 10) / H) * sh - keyH / 2;
  for (const side of ['L', 'R'] as const) {
    const kp = new KeyPad(env, {
      id: `g6k.ems.lsk_${side.toLowerCase()}`,
      label: `EMS CDU ${side === 'L' ? 'left' : 'right'} line keys`,
      rows: rows(side),
      singleEvent: EMS_EVENTS.key,
      eventPrefix: EMS_EVENTS.prefix,
      releaseEvents: true,
      keyWidth: 0.0095,
      keyHeight: keyH,
      gap: pitch - keyH,
    });
    p.add(kp, side === 'L' ? 0.0035 : w - 0.0035 - kp.width, top);
  }
  const fk = new KeyPad(env, {
    id: 'g6k.ems.pages',
    label: 'EMS CDU page keys',
    rows: [[{ id: 'EMER' }, { id: 'TEST' }]],
    singleEvent: EMS_EVENTS.key,
    eventPrefix: EMS_EVENTS.prefix,
    keyWidth: 0.022,
    keyHeight: 0.0085,
    gap: 0.02,
    legendHeight: 0.0022,
  });
  p.add(fk, w / 2 - fk.width / 2, sy + sh + 0.012);
  p.label('EMS CDU', w / 2, h - 0.009, { height: 0.0022 });
  return new EmsCduLogic(c.ctx.vars, c.ctx.events);
}
