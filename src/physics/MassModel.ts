/**
 * Mass, centre of gravity and inertia from the empty aircraft, fuel tanks
 * (`fuel.tank{i}_kg` vars written by the fuel system) and payload stations.
 *
 * Inertia: the configured empty-aircraft tensor (about the empty CG) plus
 * point masses for fuel and payload, all transferred to the current CG with
 * the parallel-axis theorem. Product of inertia Ixz follows the aircraft
 * convention Ixz = integral(x z dm); the tensor is
 *     [ Ixx   0   -Ixz ]
 *     [  0   Iyy    0  ]
 *     [-Ixz   0   Izz  ]
 * (Ixy and Iyz from asymmetric fuel are neglected; a lateral CG offset from
 * fuel imbalance is still captured through the CG position itself.)
 */
import { Mat3, Vec3 } from '../core/linalg';
import type { SimVars } from '../core/SimVars';
import { FUEL } from '../core/vars';
import type { MassConfig } from './types';

export class MassModel {
  readonly cfg: MassConfig;
  /** Total mass (kg). */
  mass = 0;
  /** CG position (body m, datum frame). */
  readonly cg = new Vec3();
  /** Inertia tensor about the current CG (kg m^2). */
  readonly inertia = new Mat3();
  readonly inertiaInv = new Mat3();
  /** Fuel mass per tank (kg) used in the last update. */
  readonly tankMass: Float64Array;
  /** Payload mass per station (kg). */
  readonly stationMass: Float64Array;
  /** Total fuel (kg). */
  fuelMass = 0;
  private readonly tankVars: string[];
  private readonly vars: SimVars | null;
  private readonly lastTank: Float64Array;
  private dirty = true;

  constructor(cfg: MassConfig, vars: SimVars | null = null) {
    this.cfg = cfg;
    this.vars = vars;
    this.tankMass = new Float64Array(cfg.tanks.length);
    this.lastTank = new Float64Array(cfg.tanks.length).fill(NaN);
    this.stationMass = new Float64Array(cfg.stations.length);
    this.tankVars = cfg.tanks.map((_, i) => FUEL.tankKg(i));
    for (let i = 0; i < cfg.stations.length; i++) this.stationMass[i] = cfg.stations[i].defaultMass_kg;
    this.update();
  }

  /** Sets a payload station mass (kg), clamped to [0, maxMass_kg]. */
  setStationMass(index: number, kg: number): void {
    const st = this.cfg.stations[index];
    if (!st) return;
    const v = Math.min(st.maxMass_kg, Math.max(0, Number.isFinite(kg) ? kg : 0));
    if (v !== this.stationMass[index]) {
      this.stationMass[index] = v;
      this.dirty = true;
    }
  }

  /** Sets a tank's fuel mass directly (used when no SimVars are attached, e.g. tests). */
  setTankMass(index: number, kg: number): void {
    if (index < 0 || index >= this.tankMass.length) return;
    this.tankMass[index] = Math.min(this.cfg.tanks[index].capacity_kg, Math.max(0, kg));
    this.dirty = true;
  }

  /** CG in percent MAC (aft of the MAC leading edge). */
  cgPercentMac(mac_m: number): number {
    return ((this.cfg.macLeadingEdge_m - this.cg.x) / mac_m) * 100;
  }

  /**
   * Reads tank vars (if attached) and recomputes mass properties when
   * anything changed. Returns true if the mass properties changed.
   * Allocation-free.
   */
  update(): boolean {
    const tanks = this.cfg.tanks;
    if (this.vars) {
      for (let i = 0; i < tanks.length; i++) {
        const kg = this.vars.get(this.tankVars[i], 0);
        const v = kg < 0 ? 0 : kg > tanks[i].capacity_kg ? tanks[i].capacity_kg : kg;
        if (v !== this.lastTank[i]) {
          this.lastTank[i] = v;
          this.tankMass[i] = v;
          this.dirty = true;
        }
      }
    }
    if (!this.dirty) return false;
    this.dirty = false;

    const cfg = this.cfg;
    const me = cfg.emptyMass_kg;
    let m = me;
    let mx = me * cfg.emptyCg_m[0];
    let my = me * cfg.emptyCg_m[1];
    let mz = me * cfg.emptyCg_m[2];
    let fuel = 0;
    for (let i = 0; i < tanks.length; i++) {
      const k = this.tankMass[i];
      const p = tanks[i].position_m;
      m += k;
      fuel += k;
      mx += k * p[0];
      my += k * p[1];
      mz += k * p[2];
    }
    const st = cfg.stations;
    for (let i = 0; i < st.length; i++) {
      const k = this.stationMass[i];
      const p = st[i].position_m;
      m += k;
      mx += k * p[0];
      my += k * p[1];
      mz += k * p[2];
    }
    this.mass = m;
    this.fuelMass = fuel;
    const cx = mx / m;
    const cy = my / m;
    const cz = mz / m;
    this.cg.set(cx, cy, cz);

    // Empty-aircraft tensor transferred from the empty CG to the current CG.
    let dx = cfg.emptyCg_m[0] - cx;
    let dy = cfg.emptyCg_m[1] - cy;
    let dz = cfg.emptyCg_m[2] - cz;
    let ixx = cfg.Ixx + me * (dy * dy + dz * dz);
    let iyy = cfg.Iyy + me * (dx * dx + dz * dz);
    let izz = cfg.Izz + me * (dx * dx + dy * dy);
    let ixz = cfg.Ixz + me * dx * dz;
    // Point masses (fuel, payload) about the current CG.
    for (let pass = 0; pass < 2; pass++) {
      const n = pass === 0 ? tanks.length : st.length;
      for (let i = 0; i < n; i++) {
        const k = pass === 0 ? this.tankMass[i] : this.stationMass[i];
        if (k <= 0) continue;
        const p = pass === 0 ? tanks[i].position_m : st[i].position_m;
        dx = p[0] - cx;
        dy = p[1] - cy;
        dz = p[2] - cz;
        ixx += k * (dy * dy + dz * dz);
        iyy += k * (dx * dx + dz * dz);
        izz += k * (dx * dx + dy * dy);
        ixz += k * dx * dz;
      }
    }
    this.inertia.set(ixx, 0, -ixz, 0, iyy, 0, -ixz, 0, izz);
    this.inertiaInv.invertFrom(this.inertia);
    return true;
  }
}
