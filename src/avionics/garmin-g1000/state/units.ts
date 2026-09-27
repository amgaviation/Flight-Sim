/**
 * Power, boot and failure state of the G1000 NXi line-replaceable units
 * (PG 190-02177-02 §1.1 / §1.3 "System Power-on"): each unit follows its
 * power binding (aircraft bus + breaker) and `fail.g1k.<unit>`; after power
 * is applied it runs its power-on self test for `bootS` before it is "up".
 * Publishes `g1k.<unit>.powered / .booting / .up` and `display.<gdu>.power`.
 */
import type { SimVars } from '../../../core/SimVars';
import { compileBinding, type Evaluator } from '../../../systems/util/binding';
import type { G1000Resolved } from '../config';
import { G1K, G1K_UNITS, type G1kUnit } from '../vars';

interface Unit {
  id: G1kUnit;
  power: Evaluator;
  bootS: number;
  left: number;
  powered: boolean;
  /** Power binding true (regardless of a failure). */
  supplied: boolean;
  up: boolean;
  /** Seconds since the unit came up (0 while down). */
  upS: number;
  failVar: string;
  poweredVar: string;
  bootingVar: string;
  upVar: string;
  displayPowerVar: string | null;
}

export class UnitManager {
  private readonly units = new Map<G1kUnit, Unit>();
  private readonly list: Unit[] = [];
  /** Power-on transitions seen this update (consumed by the system). */
  readonly justPowered = new Set<G1kUnit>();

  constructor(private readonly vars: SimVars, cfg: G1000Resolved) {
    const boot = (u: G1kUnit): number => {
      switch (u) {
        case 'pfd':
        case 'mfd':
          return cfg.bootS.gdu;
        case 'gia1':
        case 'gia2':
          return cfg.bootS.gia;
        case 'adahrs':
          return 1; // alignment itself is modelled by the ADAHRS sensor (ahrs1.aligning)
        case 'xpdr':
          return cfg.bootS.xpdr;
        case 'gma':
          return cfg.bootS.gma;
        case 'servos':
          return cfg.bootS.servos;
        default:
          return 1;
      }
    };
    for (const id of G1K_UNITS) {
      const u: Unit = {
        id,
        power: compileBinding(vars, cfg.power[id], 1),
        bootS: boot(id),
        left: 0,
        powered: false,
        supplied: false,
        up: false,
        upS: 0,
        failVar: `fail.g1k.${id}`,
        poweredVar: G1K.unitPowered(id),
        bootingVar: G1K.unitBooting(id),
        upVar: G1K.unitUp(id),
        displayPowerVar: id === 'pfd' || id === 'mfd' ? `display.${id}.power` : null,
      };
      this.units.set(id, u);
      this.list.push(u);
    }
  }

  update(dt: number): void {
    const v = this.vars;
    this.justPowered.clear();
    for (const u of this.list) {
      u.supplied = u.power() >= 0.5;
      const p = u.supplied && v.get(u.failVar) < 0.5;
      if (p && !u.powered) {
        u.left = u.bootS;
        this.justPowered.add(u.id);
      }
      u.powered = p;
      if (p && u.left > 0) u.left -= dt;
      const up = p && u.left <= 0;
      u.upS = up ? u.upS + dt : 0;
      u.up = up;
      v.set(u.poweredVar, p ? 1 : 0);
      v.set(u.bootingVar, p && !up ? 1 : 0);
      v.set(u.upVar, up ? 1 : 0);
      if (u.displayPowerVar) v.set(u.displayPowerVar, p ? 1 : 0);
    }
  }

  up(id: G1kUnit): boolean {
    return this.units.get(id)?.up ?? false;
  }

  powered(id: G1kUnit): boolean {
    return this.units.get(id)?.powered ?? false;
  }

  /** Power present at the unit (bus and breaker), even if the unit itself failed. */
  supplied(id: G1kUnit): boolean {
    return this.units.get(id)?.supplied ?? false;
  }

  /** Unit failed (`fail.g1k.<unit>`). */
  failed(id: G1kUnit): boolean {
    const u = this.units.get(id);
    return !!u && this.vars.get(u.failVar) >= 0.5;
  }

  booting(id: G1kUnit): boolean {
    const u = this.units.get(id);
    return !!u && u.powered && !u.up;
  }

  /** 0..1 progress of the power-on self test. */
  bootProgress(id: G1kUnit): number {
    const u = this.units.get(id);
    if (!u || !u.powered) return 0;
    return u.bootS > 0 ? Math.min(1, Math.max(0, 1 - u.left / u.bootS)) : 1;
  }

  /** Seconds since the unit came up. */
  upSeconds(id: G1kUnit): number {
    return this.units.get(id)?.upS ?? 0;
  }

  /** Skips every boot timer (state presets / tests). */
  forceBooted(): void {
    const v = this.vars;
    for (const u of this.list) {
      u.left = 0;
      u.supplied = u.power() >= 0.5;
      u.powered = u.supplied && v.get(u.failVar) < 0.5;
      u.up = u.powered;
      u.upS = u.up ? 60 : 0;
      // Publish at once so systems updated before the suite (radio power) see the units up.
      v.set(u.poweredVar, u.powered ? 1 : 0);
      v.set(u.bootingVar, 0);
      v.set(u.upVar, u.up ? 1 : 0);
      if (u.displayPowerVar) v.set(u.displayPowerVar, u.powered ? 1 : 0);
    }
  }
}
