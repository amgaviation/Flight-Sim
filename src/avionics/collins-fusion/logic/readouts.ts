/**
 * Synoptic page readouts: named values the SYSTEMS window draws, bound to
 * the aircraft's system outputs through `FusionSuiteConfig.synopticBindings`
 * (systems/util Binding: var name, expression, number or function).
 *
 * Every key below has a default binding that follows the systems library
 * naming (`elec.<id>_v`, `hyd.<sys>_psi`, `fuel.<pump>_on`, `pneu.<src>_psi`,
 * `press.cabin_alt_ft`, ...) with Global component ids taken from the Global
 * Express training manuals (GEN 1-4, APU GEN, RAT GEN, AC BUS 1-4, AC ESS,
 * TRU 1 / 2, ESS TRU 1 / 2, DC BUS 1 / 2, DC ESS, BATT BUS, DC EMER, AV
 * BATT, APU BATT; hydraulic systems 1-3 with pumps 1A / 1B / 2A / 2B / 3A /
 * 3B and the RAT pump; fuel L / CTR / R / AFT tanks). The aircraft maps its
 * actual ids with `synopticBindings`; an unbound key whose default var was
 * never written reads NaN and the page draws dashes (invalid data).
 */
import type { SimVars } from '../../../core/SimVars';
import { compileBinding, type Binding, type Evaluator } from '../../../systems/util/binding';

const KG_TO_LB = 2.20462;

function buildDefaults(): Record<string, Binding> {
  const d: Record<string, Binding> = {};
  // ---------------------------------------------------------------- AC electrical
  for (let n = 1; n <= 4; n++) {
    d[`gen${n}.v`] = `elec.gen${n}_v`;
    d[`gen${n}.kva`] = `elec.gen${n}_kva`;
    d[`gen${n}.hz`] = `elec.gen${n}_hz`;
    d[`gen${n}.online`] = `elec.gen${n}_online`;
    d[`gen${n}.fail`] = `elec.gen${n}_tripped`;
    d[`gen${n}.off`] = `ac.elec.gen${n}_sw == 0`;
    d[`acbus${n}.powered`] = `elec.ac_bus${n}_powered`;
    d[`acbus${n}.v`] = `elec.ac_bus${n}_v`;
    d[`acbus${n}.shed`] = `elec.ac_bus${n}_shed`;
    d[`acbus${n}.manoff`] = `ac.elec.ac_bus${n}_isol`;
  }
  d['apugen.v'] = 'elec.apu_gen_v';
  d['apugen.kva'] = 'elec.apu_gen_kva';
  d['apugen.hz'] = 'elec.apu_gen_hz';
  d['apugen.online'] = 'elec.apu_gen_online';
  d['rat.v'] = 'elec.rat_gen_v';
  d['rat.hz'] = 'elec.rat_gen_hz';
  d['rat.online'] = 'elec.rat_gen_online';
  d['rat.deployed'] = 'ac.rat.deployed';
  d['extac.v'] = 'elec.ext_ac_v';
  d['extac.kva'] = 'elec.ext_ac_kva';
  d['extac.avail'] = 'elec.ext_ac_avail';
  d['extac.online'] = 'elec.ext_ac_online';
  d['acess.powered'] = 'elec.ac_ess_powered';
  d['acess.v'] = 'elec.ac_ess_v';
  // ---------------------------------------------------------------- DC electrical
  for (const t of ['tru1', 'tru2', 'ess_tru1', 'ess_tru2']) {
    d[`${t}.v`] = `elec.${t}_v`;
    d[`${t}.a`] = `elec.${t}_amps`;
    d[`${t}.online`] = `elec.${t}_online`;
  }
  for (const b of ['dc_bus1', 'dc_bus2', 'dc_ess', 'batt_bus', 'dc_emer', 'av_batt_dir', 'apu_batt_dir']) {
    d[`${b}.powered`] = `elec.${b}_powered`;
    d[`${b}.v`] = `elec.${b}_v`;
  }
  d['dc_bus1.shed'] = 'elec.dc_bus1_shed';
  d['dc_bus2.shed'] = 'elec.dc_bus2_shed';
  for (const b of ['av_batt', 'apu_batt']) {
    d[`${b}.v`] = `elec.${b}_v`;
    d[`${b}.a`] = `elec.${b}_amps`;
    d[`${b}.temp`] = `elec.${b}_temp_c`;
    d[`${b}.chgr_fail`] = `elec.${b}_chgr_fail`;
  }
  d['extdc.avail'] = 'elec.ext_dc_avail';
  d['extdc.online'] = 'elec.ext_dc_online';
  // ---------------------------------------------------------------- hydraulics
  for (let n = 1; n <= 3; n++) {
    d[`hyd${n}.psi`] = `hyd.sys${n}_psi`;
    d[`hyd${n}.qty`] = `hyd.sys${n}_qty_pct`;
    d[`hyd${n}.temp`] = `hyd.sys${n}_temp_c`;
  }
  for (const p of ['1a', '1b', '2a', '2b', '3a', '3b']) {
    d[`pump${p}.on`] = `hyd.pump${p}_on`;
    d[`pump${p}.lowpress`] = `hyd.pump${p}_lowpress`;
    d[`pump${p}.cmd`] = p.endsWith('a') && p !== '3a' ? 1 : `ac.hyd.pump${p}_sw`;
  }
  d['pumprat.on'] = 'hyd.pumprat_on';
  d['hydsov1.open'] = 'hyd.sov1_open';
  d['hydsov2.open'] = 'hyd.sov2_open';
  d['brk.ob.psi'] = 'brakes.accum_psi';
  d['brk.ib.psi'] = 'hyd.sys3_psi';
  // ---------------------------------------------------------------- fuel
  // Quantities default to the FDM tank vars (lb). Index order as GLOBAL6000_AIRFRAME.tanks.
  d['fuel.l.lb'] = `fuel.tank0_kg * ${KG_TO_LB}`;
  d['fuel.c.lb'] = `fuel.tank1_kg * ${KG_TO_LB}`;
  d['fuel.r.lb'] = `fuel.tank2_kg * ${KG_TO_LB}`;
  d['fuel.aft.lb'] = `fuel.tank3_kg * ${KG_TO_LB}`;
  d['fuel.total.lb'] = `fuel.total_kg * ${KG_TO_LB}`;
  d['fuel.used.lb'] = `fuel.used_kg * ${KG_TO_LB}`;
  d['fuel.l.temp'] = 'fuel.l_main_temp_c';
  d['fuel.r.temp'] = 'fuel.r_main_temp_c';
  d['fuel.eng1.temp'] = 'fuel.eng1_inlet_temp_c';
  d['fuel.eng2.temp'] = 'fuel.eng2_inlet_temp_c';
  for (const p of ['pri_l1', 'pri_l2', 'pri_r1', 'pri_r2', 'aux_l', 'aux_r', 'ctr_xfer1', 'ctr_xfer2', 'aft_xfer1', 'aft_xfer2']) {
    d[`fuel.${p}.on`] = `fuel.${p}_on`;
    d[`fuel.${p}.lowpress`] = `fuel.${p}_lowpress`;
  }
  d['fuel.xfeed.open'] = 'fuel.xfeed_open';
  d['fuel.sov1.open'] = 'fuel.sov1_open';
  d['fuel.sov2.open'] = 'fuel.sov2_open';
  d['fuel.apu.on'] = 'fuel.apu_on';
  d['fuel.eng1.on'] = 'eng1.fuel_on';
  d['fuel.eng2.on'] = 'eng2.fuel_on';
  // ---------------------------------------------------------------- bleed / ECS / pressurisation
  d['bleed.l.psi'] = 'pneu.eng1_psi';
  d['bleed.r.psi'] = 'pneu.eng2_psi';
  d['bleed.apu.psi'] = 'apu.bleed_psi';
  d['bleed.l.open'] = 'pneu.eng1_valve_open';
  d['bleed.r.open'] = 'pneu.eng2_valve_open';
  d['bleed.apu.open'] = 'pneu.apu_valve_open';
  d['bleed.iso.open'] = 'pneu.iso_open';
  d['bleed.l.trip'] = 'pneu.eng1_trip';
  d['bleed.r.trip'] = 'pneu.eng2_trip';
  d['pack.l.on'] = 'pneu.pack_l_on';
  d['pack.r.on'] = 'pneu.pack_r_on';
  d['pack.l.out'] = 'pneu.pack_l_outlet_c';
  d['pack.r.out'] = 'pneu.pack_r_outlet_c';
  d['start.1.valve'] = 'pneu.start1_valve_open';
  d['start.2.valve'] = 'pneu.start2_valve_open';
  for (let z = 1; z <= 3; z++) {
    d[`zone${z}.temp`] = `pneu.zone${z}_temp_c`;
    d[`zone${z}.target`] = `ac.ecs.zone${z}_temp_c`;
  }
  d['cabin.alt'] = 'press.cabin_alt_ft';
  d['cabin.rate'] = 'press.cabin_rate_fpm';
  d['cabin.dp'] = 'press.diff_psi';
  d['cabin.ldg'] = 'press.ldg_elev_ft';
  d['cabin.outflow'] = 'press.outflow_pos';
  d['cabin.auto_fail'] = 'press.auto_fail';
  // ---------------------------------------------------------------- anti-ice
  d['ice.wing.l'] = 'ice.wing_l_protected';
  d['ice.wing.r'] = 'ice.wing_r_protected';
  d['ice.cowl.l'] = 'eng1.anti_ice';
  d['ice.cowl.r'] = 'eng2.anti_ice';
  d['ice.detected'] = 'ice.detected';
  d['ice.ws.l'] = 'ice.windshield_l_protected';
  d['ice.ws.r'] = 'ice.windshield_r_protected';
  d['ice.probes'] = 'ice.pitot1_protected';
  d['ice.wing.l.sw'] = 'ac.ice.wing_sw';
  d['ice.cowl.l.sw'] = 'ac.ice.cowl_l_sw';
  d['ice.cowl.r.sw'] = 'ac.ice.cowl_r_sw';
  // ---------------------------------------------------------------- doors (1 = open / not locked)
  for (const id of ['pax', 'emer', 'bag', 'aft_eqpt', 'svc_large', 'svc_small']) d[`door.${id}`] = `ac.door.${id}_open`;
  // ---------------------------------------------------------------- flight controls (-1..1, + = TE down / right)
  d['fc.ail.l'] = 'surf.aileron';
  d['fc.ail.r'] = '-surf.aileron';
  d['fc.elev.l'] = 'surf.elevator';
  d['fc.elev.r'] = 'surf.elevator';
  d['fc.rud'] = 'surf.rudder';
  d['fc.spl.l'] = 'max(surf.spoiler_left, surf.speedbrake)';
  d['fc.spl.r'] = 'max(surf.spoiler_right, surf.speedbrake)';
  d['fc.gnd'] = 'surf.ground_spoilers';
  d['fc.rtl'] = 'fcs.rudder_limit';
  // ---------------------------------------------------------------- status page
  d['oxy.psi'] = 'oxy.crew_psi';
  d['brk.temp.l'] = 'brakes.temp_left_c';
  d['brk.temp.r'] = 'brakes.temp_right_c';
  // Four brake units (outboard / inboard, BTMS); default to the per-side temperature.
  d['brk.temp.lo'] = 'brakes.temp_left_c';
  d['brk.temp.li'] = 'brakes.temp_left_c';
  d['brk.temp.ri'] = 'brakes.temp_right_c';
  d['brk.temp.ro'] = 'brakes.temp_right_c';
  d['apu.rpm'] = 'apu.n_pct';
  d['apu.egt'] = 'apu.egt_c';
  d['apu.running'] = 'apu.running';
  d['eng1.oilqty'] = 'ac.eng1.oil_qty_qt';
  d['eng2.oilqty'] = 'ac.eng2.oil_qty_qt';
  return d;
}

export const DEFAULT_READOUT_BINDINGS: Readonly<Record<string, Binding>> = buildDefaults();

export class SynopticReadouts {
  private readonly evals = new Map<string, Evaluator>();
  /** Default var names of keys bound to a plain var (NaN when that var was never written). */
  private readonly plainVar = new Map<string, string>();

  constructor(
    private readonly vars: SimVars,
    overrides: Readonly<Record<string, Binding>> = {},
  ) {
    const all: Record<string, Binding> = { ...DEFAULT_READOUT_BINDINGS, ...overrides };
    const plain = /^[A-Za-z_][A-Za-z0-9_.]*$/;
    for (const [k, b] of Object.entries(all)) {
      try {
        this.evals.set(k, compileBinding(vars, b, NaN));
      } catch {
        this.evals.set(k, () => NaN);
      }
      if (typeof b === 'string' && plain.test(b)) this.plainVar.set(k, b);
    }
  }

  /** Value of a readout key; NaN when unbound or its source var was never written. */
  v(key: string): number {
    const pv = this.plainVar.get(key);
    if (pv !== undefined && !this.vars.has(pv)) return NaN;
    const e = this.evals.get(key);
    return e ? e() : NaN;
  }

  /** True/false/null (null = invalid data). */
  b(key: string): boolean | null {
    const x = this.v(key);
    return Number.isFinite(x) ? x >= 0.5 : null;
  }

  has(key: string): boolean {
    return this.evals.has(key);
  }
}
