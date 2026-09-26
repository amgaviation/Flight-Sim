/**
 * System synoptic windows (1/6 and 2/3 formats).
 *
 * G550 OM 2A-31: the 2/3 and 1/6 windows can show "system synoptic
 * displays"; the G650 SMC "1/6 - 2/3" key selects them (see
 * logic/controller.ts). Pages: Summary, AC Power, DC Power, Hydraulics,
 * Fuel, ECS / Pressurization, Doors, Flight Controls, Ice Protection,
 * Brakes, APU / Bleed, Engine Start (the checklist names these systems:
 * code450 "Before Starting Engines Checklist"; G800 differences from
 * FAA FSB GVIII-G700 App. 4: four ECS zones, split wing / cowl anti-ice).
 *
 * The drawings are EST schematics (no public page drawings): lines and
 * components green when powered / pressurized / flowing, white or grey
 * when not, amber for faults; valves drawn in-line when open and across
 * the line when closed; quantities in lb, psi, deg C.
 * Values come from `SystemReadouts` bindings (logic/bindings.ts) so each
 * aircraft maps its own systems; unbound values show dashes.
 *
 * Every page is drawn in a 341 x 394 design space (the 1/6 window) and
 * scaled x2 for the 2/3 window (exactly twice the size, so one drawing
 * serves both formats).
 */
import { fmtFixed, fmtInt } from '../../common/format';
import type { Ctx2D } from '../../common/draw/context';
import { C, rect, text, textBold } from '../style';
import { WIN_NAMES, Win } from '../vars';
import { EpicWindow, type EpicServices } from './window';
import { resolveEngineNames, type EngineVarNames } from './engineWindows';

const DW = 341;
const DH = 394;
const LB = 2.20462;
const ON = C.green;
const OFF = '#8a9098';

export class SynopticWindow extends EpicWindow {
  readonly kind: Win;
  private ctx!: Ctx2D;
  private t = 0;
  private readonly nv: EngineVarNames;

  constructor(svc: EpicServices, du: number, side: 1 | 2, kind: Win) {
    super(svc, du, side);
    this.kind = kind;
    this.nv = resolveEngineNames(svc.cfg.engines.vars, svc.cfg.engines.count);
    this.animating = true;
  }

  override update(dt: number): void {
    this.t += dt;
  }

  draw(ctx: Ctx2D): void {
    this.frame(ctx, C.winBg);
    this.ctx = ctx;
    ctx.save();
    ctx.translate(this.x, this.y);
    const s = this.w / DW;
    ctx.scale(s, this.h / DH);
    textBold(ctx, WIN_NAMES[this.kind] ?? '', 8, 13, 15, C.white, 'left', 'middle');
    switch (this.kind) {
      case Win.SynSummary:
        this.summary();
        break;
      case Win.SynAcPower:
        this.acPower();
        break;
      case Win.SynDcPower:
        this.dcPower();
        break;
      case Win.SynHydraulics:
        this.hydraulics();
        break;
      case Win.SynFuel:
        this.fuel();
        break;
      case Win.SynEcs:
        this.ecs();
        break;
      case Win.SynDoors:
        this.doors();
        break;
      case Win.SynFlightControls:
        this.flightControls();
        break;
      case Win.SynIce:
        this.ice();
        break;
      case Win.SynBrakes:
        this.brakes();
        break;
      case Win.SynApuBleed:
        this.apuBleed();
        break;
      case Win.SynEngineStart:
        this.engineStart();
        break;
      default:
        break;
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- primitives

  private get ro() {
    return this.svc.readouts;
  }

  private on(key: string): boolean {
    return this.ro.on(key);
  }

  private num(key: string): number {
    return this.ro.get(key);
  }

  private ln(x0: number, y0: number, x1: number, y1: number, on: boolean, w = 3): void {
    const ctx = this.ctx;
    ctx.strokeStyle = on ? ON : OFF;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  /** Component box with a label: green outline when on, amber when faulted. */
  private comp(x: number, y: number, w: number, h: number, label: string, on: boolean, fault = false, size = 12): void {
    rect(this.ctx, x, y, w, h, C.black, fault ? C.amber : on ? ON : OFF, 2);
    text(this.ctx, label, x + w / 2, y + h / 2 + 1, size, fault ? C.amber : on ? C.white : OFF, 'center', 'middle');
  }

  /** Bus bar. */
  private bus(x: number, y: number, w: number, label: string, on: boolean): void {
    rect(this.ctx, x, y, w, 16, on ? ON : '#3a3f45', '', 1);
    text(this.ctx, label, x + w / 2, y + 9, 11, on ? C.black : C.white, 'center', 'middle');
  }

  /** Valve: circle with a bar in-line (open) or across (closed). */
  private valve(x: number, y: number, open: boolean, vertical: boolean, fault = false): void {
    const ctx = this.ctx;
    const col = fault ? C.amber : open ? ON : C.white;
    ctx.fillStyle = C.black;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    const inline = open !== !vertical; // vertical line open = vertical bar
    if (inline) {
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x, y + 8);
    } else {
      ctx.moveTo(x - 8, y);
      ctx.lineTo(x + 8, y);
    }
    ctx.stroke();
  }

  /** Pump symbol: circle with a triangle. */
  private pump(x: number, y: number, on: boolean, fault = false, label = ''): void {
    const ctx = this.ctx;
    const col = fault ? C.amber : on ? ON : C.white;
    ctx.fillStyle = C.black;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x + 6, y + 5);
    ctx.lineTo(x - 6, y + 5);
    ctx.closePath();
    ctx.fill();
    if (label) text(ctx, label, x, y + 20, 10, C.white, 'center', 'middle');
  }

  /** Numeric readout box. */
  private val(x: number, y: number, v: number, dec: 0 | 1 | 2, color: string = C.green, w = 46, unit = ''): void {
    rect(this.ctx, x - w / 2, y - 9, w, 18, C.black, '#5a6068', 1);
    text(this.ctx, Number.isFinite(v) ? (dec ? fmtFixed(v, dec) : fmtInt(v)) : '---', x + w / 2 - 4, y + 1, 13, Number.isFinite(v) ? color : C.white, 'right', 'middle');
    if (unit) text(this.ctx, unit, x + w / 2 + 3, y + 1, 10, C.white, 'left', 'middle');
  }

  private label(x: number, y: number, s: string, color: string = C.white, size = 11, align: 'left' | 'center' | 'right' = 'center'): void {
    text(this.ctx, s, x, y, size, color, align, 'middle');
  }

  // ---------------------------------------------------------------- pages

  private summary(): void {
    // Electrical sources.
    this.label(10, 36, 'ELEC', C.cyan, 11, 'left');
    this.comp(52, 27, 50, 18, 'L GEN', this.on('gen.l.online'));
    this.comp(108, 27, 50, 18, 'APU', this.on('gen.apu.online'));
    this.comp(164, 27, 50, 18, 'R GEN', this.on('gen.r.online'));
    this.comp(220, 27, 50, 18, 'GPU', this.on('gen.gpu.online'));
    this.comp(276, 27, 50, 18, 'RAT', this.on('gen.rat.online'));
    // Hydraulics.
    this.label(10, 70, 'HYD', C.cyan, 11, 'left');
    this.label(80, 62, 'Left', C.white, 11);
    this.label(250, 62, 'Right', C.white, 11);
    this.val(80, 80, this.round10(this.num('hyd.l.psi')), 0, this.psiColor('hyd.l.psi'));
    this.val(250, 80, this.round10(this.num('hyd.r.psi')), 0, this.psiColor('hyd.r.psi'));
    this.label(165, 80, this.on('hyd.aux.on') ? 'AUX ON' : this.on('hyd.ptu.on') ? 'PTU ON' : '', C.green, 11);
    // Fuel.
    this.label(10, 112, 'FUEL', C.cyan, 11, 'left');
    this.val(80, 112, this.lb('fuel.l.kg'), 0, this.on('fuel.l.low') ? C.amber : C.green, 56);
    this.val(165, 112, this.lb('fuel.total.kg'), 0, C.green, 60);
    this.val(250, 112, this.lb('fuel.r.kg'), 0, this.on('fuel.r.low') ? C.amber : C.green, 56);
    this.label(165, 128, 'Total lb', C.white, 10);
    // Pressurization.
    this.label(10, 152, 'PRESS', C.cyan, 11, 'left');
    this.label(80, 146, 'Cabin Alt', C.white, 10);
    this.label(165, 146, 'Rate', C.white, 10);
    this.label(250, 146, 'Diff', C.white, 10);
    this.val(80, 162, this.round10(this.num('press.cabin_alt')), 0, this.on('press.warn') ? C.red : C.green, 56);
    this.val(165, 162, this.round10(this.num('press.rate')), 0);
    this.val(250, 162, this.num('press.diff'), 1);
    // Doors.
    this.label(10, 190, 'DOORS', C.cyan, 11, 'left');
    const open = this.doorOpenCount();
    this.label(165, 190, open === 0 ? 'All Closed' : `${open} Open`, open === 0 ? C.green : C.amber, 13);
    // Brakes.
    this.label(10, 222, 'BRAKES', C.cyan, 11, 'left');
    this.val(120, 222, this.num('brk.l.temp'), 0, this.num('brk.l.temp') > 300 ? C.amber : C.green);
    this.val(210, 222, this.num('brk.r.temp'), 0, this.num('brk.r.temp') > 300 ? C.amber : C.green);
    this.label(290, 222, this.on('brk.park') ? 'PARK' : '', C.cyan, 12);
    // APU / ice / oxygen.
    this.label(10, 256, 'APU', C.cyan, 11, 'left');
    this.val(90, 256, this.num('apu.n'), 0, C.green, 46, '%');
    this.val(180, 256, this.num('apu.egt'), 0, C.green, 46, '°C');
    this.label(270, 256, this.on('apu.avail') ? 'AVAIL' : '', C.green, 12);
    this.label(10, 290, 'ICE', C.cyan, 11, 'left');
    this.label(165, 290, this.on('ice.detected') ? 'Ice Detected' : 'No Ice', this.on('ice.detected') ? C.cyan : C.white, 13);
    this.label(10, 324, 'OXY', C.cyan, 11, 'left');
    this.val(120, 324, this.round10(this.num('oxy.crew.psi')), 0, C.green, 56, 'psi');
    this.label(10, 358, 'FLT CTRL', C.cyan, 11, 'left');
    this.label(165, 358, this.fbwModeText(), this.num('fc.mode') > 0 ? C.amber : C.green, 13);
  }

  private acPower(): void {
    // Sources (top row).
    const srcs: readonly [string, string, number][] = AC_SOURCES;
    for (const [label, key, x] of srcs) {
      const on = this.on(`gen.${key}.online`);
      this.comp(x - 26, 32, 52, 24, label, on);
      if (key === 'l' || key === 'r' || key === 'apu') {
        this.val(x, 70, this.num(`gen.${key}.load`), 0, C.green, 40, '%');
        this.val(x, 90, this.num(`gen.${key}.v`), 0, C.green, 40, 'V');
        this.val(x, 110, this.num(`gen.${key}.hz`), 0, C.green, 40, 'Hz');
      }
    }
    // Main buses.
    const lm = this.on('bus.l_main_ac');
    const rm = this.on('bus.r_main_ac');
    this.ln(56, 120, 56, 160, lm);
    this.ln(284, 120, 284, 160, rm);
    this.ln(170, 120, 170, 150, this.on('gen.apu.online'));
    this.bus(20, 160, 130, 'L MAIN AC', lm);
    this.bus(190, 160, 130, 'R MAIN AC', rm);
    // AC tie.
    const tie = this.on('tie.ac');
    this.ln(150, 168, 190, 168, tie && (lm || rm));
    this.valve(170, 168, tie, false);
    this.label(170, 188, 'AC TIE', C.white, 10);
    // Essential buses.
    this.ln(85, 176, 85, 226, this.on('bus.l_ess_ac'));
    this.ln(255, 176, 255, 226, this.on('bus.r_ess_ac'));
    this.bus(20, 226, 130, 'L ESS AC', this.on('bus.l_ess_ac'));
    this.bus(190, 226, 130, 'R ESS AC', this.on('bus.r_ess_ac'));
    // Emergency AC and the RAT.
    const emer = this.on('bus.emer_ac');
    this.ln(170, 284, 170, 260, this.on('gen.rat.online'));
    this.ln(85, 242, 85, 292, emer);
    this.ln(85, 292, 110, 292, emer);
    this.bus(110, 284, 120, 'EMER AC', emer);
    this.label(170, 330, this.on('gen.gpu.avail') && !this.on('gen.gpu.online') ? 'GPU Available' : '', C.cyan, 12);
  }

  private dcPower(): void {
    // TRUs from the AC buses.
    const trus: readonly [string, string, number, number][] = TRUS;
    for (const [label, key, x, y] of trus) this.comp(x - 30, y, 60, 22, label, this.on(`tru.${key}`));
    this.val(40, 70, this.num('tru.l_main.a'), 0, C.green, 40, 'A');
    this.val(300, 70, this.num('tru.r_main.a'), 0, C.green, 40, 'A');
    const lm = this.on('bus.l_main_dc');
    const rm = this.on('bus.r_main_dc');
    this.ln(60, 56, 60, 100, this.on('tru.l_main'));
    this.ln(280, 56, 280, 100, this.on('tru.r_main'));
    this.bus(20, 100, 130, 'L MAIN DC', lm);
    this.bus(190, 100, 130, 'R MAIN DC', rm);
    this.val(85, 128, this.num('bus.l_main_dc.v'), 1, C.green, 44, 'V');
    this.val(255, 128, this.num('bus.r_main_dc.v'), 1, C.green, 44, 'V');
    const tie = this.on('tie.dc');
    this.ln(150, 108, 190, 108, tie && (lm || rm));
    this.valve(170, 108, tie, false);
    this.label(170, 128, 'DC TIE', C.white, 10);
    // Essential DC buses.
    this.ln(85, 140, 85, 170, this.on('bus.l_ess_dc'));
    this.ln(255, 140, 255, 170, this.on('bus.r_ess_dc'));
    this.bus(20, 170, 130, 'L ESS DC', this.on('bus.l_ess_dc'));
    this.bus(190, 170, 130, 'R ESS DC', this.on('bus.r_ess_dc'));
    this.val(85, 198, this.num('bus.l_ess_dc.v'), 1, C.green, 44, 'V');
    this.val(255, 198, this.num('bus.r_ess_dc.v'), 1, C.green, 44, 'V');
    // Emergency DC.
    this.bus(110, 226, 120, 'EMER DC', this.on('bus.emer_dc'));
    this.val(170, 254, this.num('bus.emer_dc.v'), 1, C.green, 44, 'V');
    // Batteries.
    for (let i = 0; i < 2; i++) {
      const k = i === 0 ? 'l' : 'r';
      const x = i === 0 ? 70 : 270;
      const a = this.num(`batt.${k}.a`);
      this.comp(x - 34, 282, 68, 22, i === 0 ? 'L BATT' : 'R BATT', Number.isFinite(this.num(`batt.${k}.v`)) && this.num(`batt.${k}.v`) > 18);
      this.ln(x, 282, x, 242, a < 0);
      this.val(x, 318, this.num(`batt.${k}.v`), 1, C.green, 48, 'V');
      this.val(x, 340, a, 0, a < -5 ? C.amber : C.green, 48, 'A');
      const tc = this.num(`batt.${k}.temp`);
      this.val(x, 362, tc, 0, tc > 60 ? C.amber : C.green, 48, '°C');
    }
  }

  private hydraulics(): void {
    const lp = this.num('hyd.l.psi');
    const rp = this.num('hyd.r.psi');
    const lOn = lp > 1500;
    const rOn = rp > 1500;
    // Reservoirs.
    this.tank(40, 40, 60, 70, this.num('hyd.l.qty'), 'Left');
    this.tank(240, 40, 60, 70, this.num('hyd.r.qty'), 'Right');
    // Engine driven pumps.
    this.ln(70, 110, 70, 170, lOn);
    this.ln(270, 110, 270, 170, rOn);
    this.pump(70, 140, this.on('hyd.l.edp'), this.on('hyd.l.low'), 'EDP');
    this.pump(270, 140, this.on('hyd.r.edp'), this.on('hyd.r.low'), 'EDP');
    // Aux pump (right system) and PTU between the systems.
    this.ln(210, 140, 270, 140, this.on('hyd.aux.on'));
    this.pump(210, 140, this.on('hyd.aux.on'), false, 'AUX');
    const ptu = this.on('hyd.ptu.on');
    this.ln(70, 204, 270, 204, ptu);
    this.comp(145, 194, 50, 20, 'PTU', ptu);
    // Pressure readouts.
    this.val(70, 172, this.round10(lp), 0, this.psiColor('hyd.l.psi'), 50, 'psi');
    this.val(270, 172, this.round10(rp), 0, this.psiColor('hyd.r.psi'), 50, 'psi');
    // Consumers (EST list from the G650 hydraulic architecture: dual systems powering flight controls).
    this.ln(70, 214, 70, 356, lOn);
    this.ln(270, 214, 270, 356, rOn);
    for (let i = 0; i < CONSUMERS.length; i++) {
      const y = 242 + i * 28;
      this.ln(70, y, 104, y, lOn);
      this.ln(236, y, 270, y, rOn);
      this.label(170, y, CONSUMERS[i], C.white, 11);
    }
  }

  private fuel(): void {
    const l = this.lb('fuel.l.kg');
    const r = this.lb('fuel.r.kg');
    const tot = this.lb('fuel.total.kg');
    // Wing tanks (EST split: each wing tank drawn as one box; hopper tank feeds the engine).
    this.wing(20, 60, 135, 90, true);
    this.wing(186, 60, 135, 90, false);
    this.val(80, 105, l, 0, this.on('fuel.l.low') ? C.amber : C.green, 62);
    this.val(260, 105, r, 0, this.on('fuel.r.low') ? C.amber : C.green, 62);
    this.label(80, 88, 'Left', C.white, 11);
    this.label(260, 88, 'Right', C.white, 11);
    // Boost pumps and feed lines.
    const bl = this.on('fuel.boost_l.on');
    const br = this.on('fuel.boost_r.on');
    this.pump(80, 180, bl, this.on('fuel.boost_l.low'), 'Boost');
    this.pump(260, 180, br, this.on('fuel.boost_r.low'), 'Boost');
    this.ln(80, 150, 80, 170, bl);
    this.ln(260, 150, 260, 170, br);
    this.ln(80, 190, 80, 290, bl && this.on('fuel.feed_l'));
    this.ln(260, 190, 260, 290, br && this.on('fuel.feed_r'));
    // Crossflow.
    const xf = this.on('fuel.xflow.open');
    this.ln(80, 230, 260, 230, xf && (bl || br));
    this.valve(170, 230, xf, false);
    this.label(170, 250, 'X-Flow', C.white, 10);
    // Engines.
    this.comp(50, 290, 60, 26, 'ENG 1', this.on('fuel.feed_l'));
    this.comp(230, 290, 60, 26, 'ENG 2', this.on('fuel.feed_r'));
    // Totals and temperatures.
    this.label(170, 336, 'Total Fuel', C.white, 11);
    this.val(170, 354, tot, 0, C.green, 70, 'lb');
    const tl = this.num('fuel.l.temp');
    const tr = this.num('fuel.r.temp');
    this.val(80, 354, tl, 0, tl < -37 ? C.amber : C.green, 40, '°C');
    this.val(260, 354, tr, 0, tr < -37 ? C.amber : C.green, 40, '°C');
    const imb = Math.abs(this.num('fuel.imbalance.kg')) * LB;
    if (imb > 1000) this.label(170, 380, 'Fuel Imbalance', C.amber, 12);
  }

  private ecs(): void {
    const zones = this.svc.cfg.airframe.ecsZones;
    // Bleed sources.
    const bl = this.on('bleed.l.open');
    const br = this.on('bleed.r.open');
    const ba = this.on('bleed.apu.open');
    this.comp(20, 34, 60, 20, 'L ENG', bl);
    this.comp(260, 34, 60, 20, 'R ENG', br);
    this.comp(140, 34, 60, 20, 'APU', ba);
    this.ln(50, 54, 50, 90, bl);
    this.ln(290, 54, 290, 90, br);
    this.ln(170, 54, 170, 90, ba);
    this.ln(50, 90, 290, 90, bl || br || ba, 3);
    this.valve(110, 90, this.on('bleed.iso.open'), false);
    // Packs.
    const pl = this.on('pack.l.on');
    const pr = this.on('pack.r.on');
    this.ln(90, 90, 90, 118, pl);
    this.ln(250, 90, 250, 118, pr);
    this.comp(60, 118, 60, 26, 'L PACK', pl);
    this.comp(220, 118, 60, 26, 'R PACK', pr);
    this.val(90, 160, this.num('pack.l.out'), 0, C.green, 40, '°C');
    this.val(250, 160, this.num('pack.r.out'), 0, C.green, 40, '°C');
    // Zones.
    this.label(170, 186, 'Zone Temperatures', C.white, 11);
    const zw = 320 / zones;
    for (let z = 0; z < zones; z++) {
      const x = 10 + zw * (z + 0.5);
      this.label(x, 204, ZONE_NAMES[zones === 4 ? 1 : 0][z], C.white, 10);
      this.val(x, 222, this.num(`zone.${z + 1}.temp`), 0, C.green, 42, '');
    }
    // Pressurization.
    this.label(170, 252, 'Cabin Pressure', C.cyan, 12);
    const rows: readonly [string, string, 0 | 1][] = PRESS_ROWS;
    for (let i = 0; i < rows.length; i++) {
      const y = 272 + i * 22;
      this.label(110, y, rows[i][0], C.white, 11, 'right');
      const val = this.num(rows[i][1]);
      this.val(170, y, rows[i][1] === 'press.cabin_alt' || rows[i][1] === 'press.rate' ? this.round10(val) : val, rows[i][2], rows[i][1] === 'press.cabin_alt' && this.on('press.warn') ? C.red : C.green, 60);
    }
    // Outflow valve position 0..1.
    const of = this.num('press.outflow');
    this.label(270, 272, 'Outflow', C.white, 10);
    rect(this.ctx, 250, 282, 40, 70, C.black, '#5a6068', 1);
    if (Number.isFinite(of)) rect(this.ctx, 252, 350 - 66 * Math.max(0, Math.min(1, of)), 36, 66 * Math.max(0, Math.min(1, of)), ON, '');
    const mode = this.ro.str('press.mode');
    this.label(270, 366, mode || 'AUTO', C.green, 11);
  }

  private doors(): void {
    const ctx = this.ctx;
    const af = this.svc.cfg.airframe;
    // Fuselage outline (plan view), length scaled from the airframe length (EST proportions).
    const len = Math.min(330, 250 + (af.lengthM - 25) * 8);
    const x0 = 170;
    const top = 40;
    const w = 56;
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, top);
    ctx.quadraticCurveTo(x0 + w / 2, top + 8, x0 + w / 2, top + 50);
    ctx.lineTo(x0 + w / 2, top + len - 60);
    ctx.lineTo(x0 + 8, top + len);
    ctx.lineTo(x0 - 8, top + len);
    ctx.lineTo(x0 - w / 2, top + len - 60);
    ctx.lineTo(x0 - w / 2, top + 50);
    ctx.quadraticCurveTo(x0 - w / 2, top + 8, x0, top);
    ctx.stroke();
    // Cabin windows.
    ctx.fillStyle = '#5a6068';
    for (let i = 0; i < af.windowsPerSide; i++) {
      const y = top + 70 + i * ((len - 150) / af.windowsPerSide);
      ctx.fillRect(x0 - w / 2 + 3, y, 4, 8);
      ctx.fillRect(x0 + w / 2 - 7, y, 4, 8);
    }
    const doors: readonly [string, string, number, number, 'L' | 'R'][] = DOORS;
    for (const [label, key, fy, _h, sideLR] of doors) {
      if (!this.ro.bound(key)) continue;
      const pos = this.num(key);
      const open = Number.isFinite(pos) && pos > 0.02;
      const y = top + fy * len;
      const xs = sideLR === 'L' ? x0 - w / 2 : x0 + w / 2;
      rect(ctx, sideLR === 'L' ? xs - 5 : xs - 1, y, 6, 20, open ? C.amber : ON, '');
      this.label(sideLR === 'L' ? xs - 12 : xs + 12, y + 10, label, open ? C.amber : C.white, 11, sideLR === 'L' ? 'right' : 'left');
    }
  }

  /**
   * Flight controls (G650ER photograph, DU #4 upper 1/6): "Pitch Trim" and
   * "Stab/Elev Position" scales, a front view of the aircraft with the
   * spoiler / aileron / rudder positions, flap angle, WOW indications.
   */
  private flightControls(): void {
    const ctx = this.ctx;
    // Pitch trim scale (NU top).
    this.label(62, 34, 'Pitch Trim', C.white, 11);
    this.vScale(34, 48, 70, this.num('fc.stab'), -1, 1, 'NU', 'ND');
    // Stab / elevator position.
    this.label(262, 34, 'Stab/Elev Position', C.white, 11);
    this.vScale(236, 48, 70, this.num('fc.stab'), -1, 1, 'NU', 'ND');
    this.vScale(282, 48, 70, this.num('fc.elevator'), -1, 1, 'UP', 'DN');
    // Front view: fuselage, wings with dihedral, engines, T-tail.
    const cx = 170;
    const cy = 176;
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, 16, 0, Math.PI * 2);
    ctx.moveTo(cx - 14, cy + 6);
    ctx.lineTo(cx - 150, cy - 4);
    ctx.moveTo(cx + 14, cy + 6);
    ctx.lineTo(cx + 150, cy - 4);
    ctx.moveTo(cx, cy - 16);
    ctx.lineTo(cx, cy - 62);
    ctx.moveTo(cx - 44, cy - 62);
    ctx.lineTo(cx + 44, cy - 62);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - 30, cy - 6, 9, 0, Math.PI * 2);
    ctx.moveTo(cx + 39, cy - 6);
    ctx.arc(cx + 30, cy - 6, 9, 0, Math.PI * 2);
    ctx.stroke();
    // Surfaces (green = position, deflection drawn from the neutral line; EST scale).
    const ail = this.num('fc.aileron');
    const sl = Math.max(this.num('fc.spoiler_l'), this.num('fc.gnd_spoilers'));
    const sr = Math.max(this.num('fc.spoiler_r'), this.num('fc.gnd_spoilers'));
    this.deflect(cx - 150, cy - 4, cx - 118, cy - 2, Number.isFinite(ail) ? ail * 14 : 0);
    this.deflect(cx + 118, cy - 2, cx + 150, cy - 4, Number.isFinite(ail) ? -ail * 14 : 0);
    this.deflect(cx - 100, cy - 1, cx - 60, cy + 2, Number.isFinite(sl) ? -Math.max(0, sl) * 16 : 0);
    this.deflect(cx + 60, cy + 2, cx + 100, cy - 1, Number.isFinite(sr) ? -Math.max(0, sr) * 16 : 0);
    const rud = this.num('fc.rudder');
    const rx = cx + (Number.isFinite(rud) ? Math.max(-1, Math.min(1, rud)) * 12 : 0);
    this.ln(cx, cy - 58, rx, cy - 34, true, 3);
    // Flaps and FBW mode.
    this.label(40, 226, 'Flaps', C.white, 11);
    this.val(92, 226, this.num('fc.flaps'), 0, C.green, 40, '°');
    this.label(334, 13, this.fbwModeText(), this.num('fc.mode') > 0 ? C.amber : C.green, 12, 'right');
    if (this.on('fc.gnd_spoiler_armed')) this.label(260, 226, 'Gnd Spoilers Armed', C.cyan, 11);
    // Aileron / rudder trim.
    this.label(12, 260, 'Ail Trim', C.white, 11, 'left');
    this.hBar(104, 260, this.num('fc.ail_trim'));
    this.label(180, 260, 'Rud Trim', C.white, 11, 'left');
    this.hBar(276, 260, this.num('fc.rud_trim'));
    // Weight-on-wheels (squat switch) indications.
    this.label(60, 312, 'WOWs', C.white, 12);
    for (let i = 0; i < 3; i++) {
      const on = this.on(WOW_KEYS[i]);
      this.comp(118 + i * 58, 302, 40, 20, WOW_LABELS[i], on);
    }
    this.label(110, 350, 'Combined WOW', C.white, 12);
    this.comp(176, 340, 40, 20, this.on('wow.combined') ? 'GND' : 'AIR', this.on('wow.combined'));
  }

  private vScale(x: number, y: number, h: number, v: number, lo: number, hi: number, top: string, bot: string): void {
    const ctx = this.ctx;
    rect(ctx, x - 3, y, 6, h, C.black, C.white, 1);
    this.label(x - 14, y + 4, top, C.white, 9);
    this.label(x - 14, y + h - 4, bot, C.white, 9);
    if (!Number.isFinite(v)) return;
    const f = (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo);
    const py = y + h - f * h;
    ctx.fillStyle = C.green;
    ctx.beginPath();
    ctx.moveTo(x + 4, py);
    ctx.lineTo(x + 14, py - 6);
    ctx.lineTo(x + 14, py + 6);
    ctx.closePath();
    ctx.fill();
  }

  private hBar(x: number, y: number, v: number): void {
    rect(this.ctx, x - 30, y - 2, 60, 4, '#3a3f45', '');
    const px = x + (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0) * 28;
    rect(this.ctx, px - 3, y - 8, 6, 16, ON, '');
  }

  /** Control surface segment from (x0,y0) to (x1,y1), trailing edge moved by `d` px (+ down). */
  private deflect(x0: number, y0: number, x1: number, y1: number, d: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = ON;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + d);
    ctx.lineTo(x1, y1 + d);
    ctx.stroke();
  }

  private ice(): void {
    const detected = this.on('ice.detected');
    this.label(170, 36, detected ? 'ICE DETECTED' : 'No Ice Detected', detected ? C.cyan : C.white, 13);
    const tat = this.num('ice.tat');
    this.label(250, 58, 'TAT', C.white, 11, 'right');
    this.val(290, 58, tat, 0, C.green, 44, '°C');
    const split = this.svc.cfg.airframe.splitAntiIce;
    const rows: readonly [string, string, string][] = split ? ICE_ROWS_SPLIT : ICE_ROWS;
    for (let i = 0; i < rows.length; i++) {
      const y = 90 + i * 34;
      this.label(170, y, rows[i][0], C.white, 12);
      const lk = rows[i][1];
      const rk = rows[i][2];
      if (lk) this.comp(40, y - 12, 70, 24, this.on(lk) ? 'ON' : 'OFF', this.on(lk));
      if (rk) this.comp(230, y - 12, 70, 24, this.on(rk) ? 'ON' : 'OFF', this.on(rk));
    }
  }

  /**
   * Brakes (G650ER photograph, DU #4 lower 1/6): brake pressure bars for the
   * four brakes (outboard / inboard, left / right) on a 0-3000 psi scale,
   * accumulator pressures (inboard / outboard) and brake temperatures.
   */
  private brakes(): void {
    const ctx = this.ctx;
    const lp = this.num('brk.l.psi');
    const rp = this.num('brk.r.psi');
    const top = 40;
    const h = 150;
    const bars: readonly [number, number][] = [
      [40, lp],
      [82, lp],
      [258, rp],
      [300, rp],
    ];
    this.label(170, 28, 'Brake Press', C.white, 11);
    for (const [x, p] of bars) {
      rect(ctx, x - 16, top, 32, h, C.black, C.white, 1.5);
      if (Number.isFinite(p)) {
        const f = Math.max(0, Math.min(1, p / 3000));
        rect(ctx, x - 14, top + h - 2 - (h - 4) * f, 28, (h - 4) * f, ON, '');
      }
    }
    for (let i = 0; i <= 3; i++) {
      const y = top + h - (i / 3) * h;
      this.label(170, y, BRK_SCALE[i], C.white, 11);
    }
    this.label(60, top + h + 14, 'Left', C.white, 11);
    this.label(170, top + h + 14, 'psi', C.white, 11);
    this.label(280, top + h + 14, 'Right', C.white, 11);
    // Accumulators.
    this.label(90, 240, 'Accumulators', C.white, 11);
    this.label(206, 232, 'Inbd', C.white, 10, 'right');
    this.val(246, 232, this.round10(this.num('brk.accum')), 0, C.green, 50);
    this.label(206, 252, 'Outbd', C.white, 10, 'right');
    this.val(246, 252, this.round10(this.num('brk.accum')), 0, C.green, 50);
    // Temperatures (hatched amber when hot, EST 300 C).
    this.label(170, 300, 'Temp °C', C.white, 10);
    const lt = this.num('brk.l.temp');
    const rt = this.num('brk.r.temp');
    const temps: readonly [number, number][] = [
      [40, lt],
      [82, lt],
      [258, rt],
      [300, rt],
    ];
    for (const [x, t] of temps) {
      const hot = t > 300;
      rect(ctx, x - 18, 286, 36, 26, hot ? C.amber : C.black, C.white, 1.5);
      text(ctx, Number.isFinite(t) ? fmtInt(t) : '--', x, 300, 12, hot ? C.black : C.green, 'center', 'middle');
    }
    if (this.on('brk.park')) this.comp(115, 330, 110, 22, 'PARKING BRAKE', true);
    if (this.on('brk.antiskid_inop')) this.label(170, 366, 'Antiskid Inop', C.amber, 12);
    const ab = this.ro.str('brk.autobrake');
    if (ab) this.label(170, 384, `Autobrake ${ab}`, C.green, 11);
  }

  private apuBleed(): void {
    const running = this.on('apu.running');
    this.comp(135, 34, 70, 26, 'APU', running, this.on('apu.fault'));
    this.label(80, 76, 'N %', C.white, 11, 'right');
    this.val(120, 76, this.num('apu.n'), 0);
    this.label(200, 76, 'EGT', C.white, 11, 'right');
    this.val(240, 76, this.num('apu.egt'), 0, C.green, 46, '°C');
    const door = this.num('apu.door');
    this.label(170, 100, Number.isFinite(door) ? (door > 0.95 ? 'Door Open' : door < 0.05 ? 'Door Closed' : 'Door In Transit') : '', C.white, 11);
    if (this.on('apu.avail')) this.label(170, 118, 'APU Available', C.green, 12);
    // Bleed manifold.
    const bl = this.on('bleed.l.open');
    const br = this.on('bleed.r.open');
    const ba = this.on('bleed.apu.open');
    this.comp(20, 150, 60, 22, 'L ENG', this.on('start.1.valve') || bl);
    this.comp(260, 150, 60, 22, 'R ENG', this.on('start.2.valve') || br);
    this.ln(50, 172, 50, 230, bl);
    this.ln(290, 172, 290, 230, br);
    this.valve(50, 200, bl, true);
    this.valve(290, 200, br, true);
    this.ln(170, 118 + 12, 170, 230, ba);
    this.valve(170, 176, ba, true);
    this.ln(50, 230, 290, 230, bl || br || ba);
    this.valve(110, 230, this.on('bleed.iso.open'), false);
    this.label(110, 250, 'Isolation', C.white, 10);
    this.val(50, 264, this.num('bleed.l.psi'), 0, C.green, 40, 'psi');
    this.val(290, 264, this.num('bleed.r.psi'), 0, C.green, 40, 'psi');
    this.val(170, 264, this.num('apu.bleed.psi'), 0, C.green, 40, 'psi');
    // Consumers.
    this.ln(90, 230, 90, 300, this.on('pack.l.on'));
    this.ln(250, 230, 250, 300, this.on('pack.r.on'));
    this.comp(60, 300, 60, 22, 'L PACK', this.on('pack.l.on'));
    this.comp(220, 300, 60, 22, 'R PACK', this.on('pack.r.on'));
    this.label(170, 346, 'Wing / Cowl Anti-Ice', C.white, 11);
    this.label(90, 366, this.on('ice.wing_l') ? 'WAI ON' : '', C.green, 11);
    this.label(250, 366, this.on('ice.wing_r') ? 'WAI ON' : '', C.green, 11);
  }

  private engineStart(): void {
    const nv = this.nv;
    const v = this.vars;
    for (let i = 0; i < 2; i++) {
      const x = i === 0 ? 90 : 250;
      this.label(x, 40, i === 0 ? 'Left' : 'Right', C.white, 13);
      const st = this.ro.str(START_KEYS[i][0]);
      const valve = this.on(START_KEYS[i][1]);
      const ign = this.on(START_KEYS[i][2]);
      this.comp(x - 40, 56, 80, 22, valve ? 'ST VALVE' : 'ST OFF', valve);
      this.comp(x - 40, 86, 80, 22, ign ? 'IGN' : 'IGN OFF', ign);
      this.label(x, 124, st, C.cyan, 12);
      const rows: readonly string[] = START_ROWS;
      for (let r = 0; r < rows.length; r++) {
        const y = 150 + r * 34;
        this.label(x, y - 12, rows[r], C.white, 10);
        const val = v.get(r === 0 ? nv.n2[i] : r === 1 ? nv.tgt[i] : r === 2 ? nv.n1[i] : r === 3 ? nv.ff[i] : nv.oilPress[i]);
        const lim = this.svc.cfg.engines.limits;
        const col = r === 1 && val > (v.get('gear.air_ground') !== 0 ? lim.tgtStartGroundC : lim.tgtStartFlightC) ? C.red : C.green;
        this.val(x, y + 6, val, r === 0 || r === 2 ? 1 : 0, col, 60);
      }
    }
    const air = this.num('bleed.l.psi');
    this.label(170, 330, 'Start Air', C.white, 11);
    this.val(170, 348, Number.isFinite(air) ? air : this.num('apu.bleed.psi'), 0, C.green, 44, 'psi');
  }

  // ---------------------------------------------------------------- helpers

  private surfBar(x: number, y: number, v: number, label: string): void {
    const ctx = this.ctx;
    rect(ctx, x - 3, y - 24, 6, 48, '#3a3f45', '');
    const d = Math.max(-1, Math.min(1, Number.isFinite(v) ? v : 0)) * 22;
    rect(ctx, x - 7, y - d - 2, 14, 4, ON, '');
    this.label(x, y + 34, label, C.white, 10);
  }

  private spoilers(x: number, y: number, v: number, left: boolean): void {
    const ext = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
    for (let i = 0; i < 3; i++) {
      const xx = x + (left ? -i : i) * 22;
      rect(this.ctx, xx - 9, y - 4, 18, 8, C.black, ext > 0.02 ? ON : C.white, 1.5);
      if (ext > 0.02) rect(this.ctx, xx - 9, y - 4 - ext * 12, 18, ext * 12, ON, '');
    }
  }

  private tank(x: number, y: number, w: number, h: number, frac: number, label: string): void {
    rect(this.ctx, x, y, w, h, C.black, C.white, 1.5);
    if (Number.isFinite(frac)) {
      const f = Math.max(0, Math.min(1, frac));
      rect(this.ctx, x + 2, y + h - 2 - (h - 4) * f, w - 4, (h - 4) * f, f < 0.25 ? C.amber : '#1d6fbf', '');
      this.label(x + w / 2, y + h / 2, fmtInt(f * 100), C.white, 12);
    }
    this.label(x + w / 2, y - 8, label, C.white, 11);
  }

  private wing(x: number, y: number, w: number, h: number, left: boolean): void {
    const ctx = this.ctx;
    ctx.strokeStyle = C.white;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (left) {
      ctx.moveTo(x + w, y);
      ctx.lineTo(x, y + h * 0.55);
      ctx.lineTo(x, y + h * 0.75);
      ctx.lineTo(x + w, y + h);
    } else {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h * 0.55);
      ctx.lineTo(x + w, y + h * 0.75);
      ctx.lineTo(x, y + h);
    }
    ctx.closePath();
    ctx.stroke();
  }

  private lb(key: string): number {
    const kg = this.num(key);
    return Number.isFinite(kg) ? Math.round((kg * LB) / 10) * 10 : NaN;
  }

  private round10(x: number): number {
    return Number.isFinite(x) ? Math.round(x / 10) * 10 : NaN;
  }

  private psiColor(key: string): string {
    const p = this.num(key);
    return Number.isFinite(p) && p < 1500 ? C.amber : C.green;
  }

  private doorOpenCount(): number {
    let n = 0;
    for (const d of DOORS) if (this.ro.bound(d[1]) && this.num(d[1]) > 0.02) n++;
    return n;
  }

  private fbwModeText(): string {
    const m = this.num('fc.mode');
    return !Number.isFinite(m) || m === 0 ? 'FCC Normal' : m === 1 ? 'FCC Alternate' : 'FCC Direct';
  }
}

const AC_SOURCES: readonly [string, string, number][] = [
  ['L GEN', 'l', 56],
  ['APU', 'apu', 170],
  ['R GEN', 'r', 284],
];
const TRUS: readonly [string, string, number, number][] = [
  ['L MAIN', 'l_main', 60, 34],
  ['L ESS', 'l_ess', 140, 34],
  ['R ESS', 'r_ess', 200, 34],
  ['R MAIN', 'r_main', 280, 34],
];
const CONSUMERS = ['Flight Controls', 'Landing Gear', 'Brakes', 'Spoilers', 'Reversers'] as const;
const ZONE_NAMES: readonly (readonly string[])[] = [
  ['Cockpit', 'Fwd Cabin', 'Aft Cabin'],
  ['Cockpit', 'Fwd Cabin', 'Mid Cabin', 'Aft Cabin'],
];
const PRESS_ROWS: readonly [string, string, 0 | 1][] = [
  ['Cabin Alt', 'press.cabin_alt', 0],
  ['Rate', 'press.rate', 0],
  ['Diff psi', 'press.diff', 1],
  ['Ldg Elev', 'press.ldg_elev', 0],
];
const DOORS: readonly [string, string, number, number, 'L' | 'R'][] = [
  ['Main Door', 'door.main', 0.14, 0, 'L'],
  ['Emer Exit', 'door.emer_exit', 0.46, 0, 'R'],
  ['Service', 'door.service', 0.2, 0, 'R'],
  ['Baggage', 'door.baggage', 0.72, 0, 'L'],
  ['Ext Baggage', 'door.ext_baggage', 0.8, 0, 'L'],
  ['Fuel', 'door.fuel', 0.6, 0, 'R'],
];
const ICE_ROWS: readonly [string, string, string][] = [
  ['Wing', 'ice.wing_l', 'ice.wing_r'],
  ['Cowl', 'ice.cowl_l', 'ice.cowl_r'],
  ['Windshield', 'ice.wshld_l', 'ice.wshld_r'],
  ['Probes', 'ice.probes', ''],
];
const ICE_ROWS_SPLIT: readonly [string, string, string][] = [
  ['Wing (L / R)', 'ice.wing_l', 'ice.wing_r'],
  ['Cowl (L / R)', 'ice.cowl_l', 'ice.cowl_r'],
  ['Windshield', 'ice.wshld_l', 'ice.wshld_r'],
  ['Probes', 'ice.probes', ''],
];
const WOW_KEYS = ['wow.l', 'wow.n', 'wow.r'] as const;
const WOW_LABELS = ['L', 'N', 'R'] as const;
const BRK_SCALE = ['0', '1000', '2000', '3000'] as const;
const START_KEYS = [
  ['start.1.status', 'start.1.valve', 'start.1.ign'],
  ['start.2.status', 'start.2.valve', 'start.2.ign'],
] as const;
const START_ROWS = ['HP %', 'TGT °C', 'LP %', 'FF pph', 'Oil psi'] as const;
