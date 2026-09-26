/**
 * System data bindings for the synoptic pages, overhead touch-page
 * readouts and engine windows: a flat map `key -> Binding` (systems/util
 * binding: var name, expression string, number or function).
 *
 * The defaults below use the systems-library output names
 * (docs/modules/systems-power.md, systems-control.md) with component ids
 * matching the G650 architecture described there: two IDGs + APU
 * generator + RAT + GPU, L/R MAIN and ESS AC/DC buses, five TRUs, two
 * NiCd batteries; left and right hydraulic systems with an auxiliary
 * electric pump and a PTU; left / right wing tanks; two packs and three
 * (G800: four) temperature zones. An aircraft maps its own ids through
 * `EpicSuiteConfig.synopticBindings`. String values use the `str:` prefix
 * (read with `getString`). Unbound keys read NaN (drawn as dashes).
 */
import type { SimVars } from '../../../core/SimVars';
import { compileBinding, type Binding, type Evaluator } from '../../../systems/util/binding';

export const DEFAULT_SYSTEM_BINDINGS: Readonly<Record<string, Binding>> = {
  // ---------------- AC power
  'gen.l.online': 'elec.idg1_online',
  'gen.r.online': 'elec.idg2_online',
  'gen.apu.online': 'elec.apu_gen_online',
  'gen.rat.online': 'elec.rat_online',
  'gen.gpu.online': 'elec.gpu_online',
  'gen.gpu.avail': 'elec.gpu_avail',
  'gen.l.load': 'elec.idg1_load_pct',
  'gen.r.load': 'elec.idg2_load_pct',
  'gen.apu.load': 'elec.apu_gen_load_pct',
  'gen.l.v': 'elec.idg1_v',
  'gen.r.v': 'elec.idg2_v',
  'gen.apu.v': 'elec.apu_gen_v',
  'gen.l.hz': 'elec.idg1_hz',
  'gen.r.hz': 'elec.idg2_hz',
  'gen.apu.hz': 'elec.apu_gen_hz',
  'bus.l_main_ac': 'elec.l_main_ac_powered',
  'bus.r_main_ac': 'elec.r_main_ac_powered',
  'bus.l_ess_ac': 'elec.l_ess_ac_powered',
  'bus.r_ess_ac': 'elec.r_ess_ac_powered',
  'bus.emer_ac': 'elec.emer_ac_powered',
  'tie.ac': 'elec.ac_tie_closed',
  // ---------------- DC power
  'bus.l_main_dc': 'elec.l_main_dc_powered',
  'bus.r_main_dc': 'elec.r_main_dc_powered',
  'bus.l_ess_dc': 'elec.l_ess_dc_powered',
  'bus.r_ess_dc': 'elec.r_ess_dc_powered',
  'bus.emer_dc': 'elec.emer_dc_powered',
  'bus.l_main_dc.v': 'elec.l_main_dc_v',
  'bus.r_main_dc.v': 'elec.r_main_dc_v',
  'bus.l_ess_dc.v': 'elec.l_ess_dc_v',
  'bus.r_ess_dc.v': 'elec.r_ess_dc_v',
  'bus.emer_dc.v': 'elec.emer_dc_v',
  'tru.l_main': 'elec.l_main_tru_online',
  'tru.r_main': 'elec.r_main_tru_online',
  'tru.l_ess': 'elec.l_ess_tru_online',
  'tru.r_ess': 'elec.r_ess_tru_online',
  'tru.emer': 'elec.emer_tru_online',
  'tru.l_main.a': 'elec.l_main_tru_amps',
  'tru.r_main.a': 'elec.r_main_tru_amps',
  'batt.l.v': 'elec.batt_l_v',
  'batt.r.v': 'elec.batt_r_v',
  'batt.l.a': 'elec.batt_l_amps',
  'batt.r.a': 'elec.batt_r_amps',
  'batt.l.temp': 'elec.batt_l_temp_c',
  'batt.r.temp': 'elec.batt_r_temp_c',
  'tie.dc': 'elec.dc_tie_closed',
  // ---------------- hydraulics (3000 psi systems)
  'hyd.l.psi': 'hyd.left_psi',
  'hyd.r.psi': 'hyd.right_psi',
  'hyd.l.qty': 'hyd.left_qty',
  'hyd.r.qty': 'hyd.right_qty',
  'hyd.l.edp': 'hyd.edp_l_on',
  'hyd.r.edp': 'hyd.edp_r_on',
  'hyd.aux.on': 'hyd.aux_on',
  'hyd.aux.psi': 'hyd.aux_on ? hyd.right_psi : 0',
  'hyd.ptu.on': 'hyd.ptu_active',
  'hyd.ptu.psi': 'hyd.ptu_active ? hyd.right_psi : 0',
  'hyd.l.low': 'hyd.left_lowpress',
  'hyd.r.low': 'hyd.right_lowpress',
  // ---------------- fuel (kg in the sim, lb on the displays)
  'fuel.l.kg': 'fuel.tank0_kg',
  'fuel.r.kg': 'fuel.tank1_kg',
  'fuel.total.kg': 'fuel.total_kg',
  'fuel.l.temp': 'fuel.left_temp_c',
  'fuel.r.temp': 'fuel.right_temp_c',
  'fuel.boost_l.on': 'fuel.boost_l_on',
  'fuel.boost_r.on': 'fuel.boost_r_on',
  'fuel.boost_l.low': 'fuel.boost_l_lowpress',
  'fuel.boost_r.low': 'fuel.boost_r_lowpress',
  'fuel.xflow.open': 'fuel.xflow_open',
  'fuel.feed_l': 'eng1.fuel_on',
  'fuel.feed_r': 'eng2.fuel_on',
  'fuel.imbalance.kg': 'fuel.imbalance_kg',
  'fuel.l.low': 'fuel.left_low',
  'fuel.r.low': 'fuel.right_low',
  // ---------------- bleed / ECS / pressurization
  'bleed.l.open': 'pneu.bleed_l_valve_open',
  'bleed.r.open': 'pneu.bleed_r_valve_open',
  'bleed.apu.open': 'pneu.apu_bleed_valve_open',
  'bleed.iso.open': 'pneu.iso_open',
  'bleed.l.psi': 'pneu.l_duct_psi',
  'bleed.r.psi': 'pneu.r_duct_psi',
  'pack.l.on': 'pneu.pack_l_on',
  'pack.r.on': 'pneu.pack_r_on',
  'pack.l.out': 'pneu.pack_l_outlet_c',
  'pack.r.out': 'pneu.pack_r_outlet_c',
  'zone.1.temp': 'pneu.cockpit_temp_c',
  'zone.2.temp': 'pneu.fwd_cabin_temp_c',
  'zone.3.temp': 'pneu.aft_cabin_temp_c',
  'zone.4.temp': 'pneu.mid_cabin_temp_c',
  'press.cabin_alt': 'press.cabin_alt_ft',
  'press.rate': 'press.cabin_rate_fpm',
  'press.diff': 'press.diff_psi',
  'press.ldg_elev': 'press.ldg_elev_ft',
  'press.outflow': 'press.outflow_pos',
  'press.mode': 'press.mode',
  'press.warn': 'press.cabin_alt_warn',
  // ---------------- doors (0 closed .. 1 open)
  'door.main': 'ac.door.main',
  'door.baggage': 'ac.door.baggage',
  'door.ext_baggage': 'ac.door.ext_baggage',
  'door.emer_exit': 'ac.door.emer_exit',
  'door.service': 'ac.door.service',
  'door.fuel': 'ac.door.fuel',
  // ---------------- flight controls
  'fc.elevator': 'surf.elevator',
  'fc.aileron': 'surf.aileron',
  'fc.rudder': 'surf.rudder',
  'fc.spoiler_l': 'surf.spoiler_left',
  'fc.spoiler_r': 'surf.spoiler_right',
  'fc.gnd_spoilers': 'surf.ground_spoilers',
  'fc.flaps': 'surf.flaps_deg',
  'fc.stab': 'trim.pitch_units',
  'fc.ail_trim': 'surf.aileron_trim',
  'fc.rud_trim': 'surf.rudder_trim',
  'fc.mode': 'fbw.mode_code',
  'fc.gnd_spoiler_armed': 'spoilers.armed',
  // weight on wheels (squat switches: main L / nose / main R; combined = air/ground logic)
  'wow.l': 'gear.wow1',
  'wow.n': 'gear.wow0',
  'wow.r': 'gear.wow2',
  'wow.combined': 'gear.air_ground',
  // ---------------- ice protection
  'ice.detected': 'ice.detected',
  'ice.wing_l': 'ice.wing_l_protected',
  'ice.wing_r': 'ice.wing_r_protected',
  'ice.cowl_l': 'ice.cowl_l_protected',
  'ice.cowl_r': 'ice.cowl_r_protected',
  'ice.wshld_l': 'ice.wshld_l_protected',
  'ice.wshld_r': 'ice.wshld_r_protected',
  'ice.probes': 'ice.pitot1_protected',
  'ice.airframe': 'ice.airframe',
  'ice.tat': 'adc1.tat_c',
  // ---------------- brakes
  'brk.l.psi': 'brakes.psi_left',
  'brk.r.psi': 'brakes.psi_right',
  'brk.accum': 'brakes.accum_psi',
  'brk.l.temp': 'brakes.temp_left_c',
  'brk.r.temp': 'brakes.temp_right_c',
  'brk.park': 'brakes.parking_set',
  'brk.antiskid_inop': 'brakes.antiskid_inop',
  'brk.autobrake': 'str:brakes.autobrake_mode',
  // ---------------- APU
  'apu.n': 'apu.n_pct',
  'apu.egt': 'apu.egt_c',
  'apu.avail': 'apu.avail',
  'apu.running': 'apu.running',
  'apu.door': 'apu.door_pos',
  'apu.bleed.psi': 'apu.bleed_psi',
  'apu.fault': 'apu.fault',
  // ---------------- engine start (per engine: .1 / .2)
  'start.1.valve': 'pneu.ats_l_valve_open',
  'start.2.valve': 'pneu.ats_r_valve_open',
  'start.1.status': 'str:fadec.eng1.start_status',
  'start.2.status': 'str:fadec.eng2.start_status',
  'start.1.ign': 'eng1.ignition',
  'start.2.ign': 'eng2.ignition',
  // ---------------- oxygen
  'oxy.crew.psi': 'oxy.crew_psi',
};

/** Compiles bindings lazily by key; unknown keys evaluate to NaN. */
export class SystemReadouts {
  private readonly bindings: Record<string, Binding>;
  private readonly cache = new Map<string, Evaluator>();
  private readonly strCache = new Map<string, string>();

  constructor(
    private readonly vars: SimVars,
    overrides?: Readonly<Record<string, Binding>>,
  ) {
    this.bindings = { ...DEFAULT_SYSTEM_BINDINGS, ...(overrides ?? {}) };
  }

  /** Numeric value of `key` (NaN when unbound or not a number). */
  get(key: string): number {
    let f = this.cache.get(key);
    if (!f) {
      const b = this.bindings[key];
      if (b === undefined || (typeof b === 'string' && b.startsWith('str:'))) f = NAN_EVAL;
      else {
        try {
          f = compileBinding(this.vars, b, NaN);
        } catch {
          f = NAN_EVAL;
        }
      }
      this.cache.set(key, f);
    }
    return f();
  }

  /** Boolean (non-zero, finite). */
  on(key: string): boolean {
    const x = this.get(key);
    return Number.isFinite(x) && x !== 0;
  }

  /** True when `key` is bound to something. */
  bound(key: string): boolean {
    return this.bindings[key] !== undefined;
  }

  /** String value for `str:` bindings ('' when unbound). */
  str(key: string): string {
    let n = this.strCache.get(key);
    if (n === undefined) {
      const b = this.bindings[key];
      n = typeof b === 'string' && b.startsWith('str:') ? b.slice(4) : '';
      this.strCache.set(key, n);
    }
    return n ? this.vars.getString(n) : '';
  }
}

const NAN_EVAL: Evaluator = () => NaN;
