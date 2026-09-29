/**
 * G800 overhead circuit-breaker panels: two lettered / numbered grids (rows A-G, columns 1-6) at the aft end of the
 * overhead, facing down, with engraved group outlines (FLIGHT INSTRUMENTS, APU, LDG GEAR / DOOR CTRL, COM / NAV,
 * ELECTRICAL) and red-ringed breakers (G600 BL7C0705 crop p_cb; G500 BL7C0670 c_ovhd). The assignment of the
 * modelled loads to groups / cells is in cbTable.ts (EST). The other breakers are electronic (ECB page on the TSCs,
 * systems/tscApps.ts).
 *
 * Every breaker is a pullable `CircuitBreaker` on the network's `cb.<load>` / `cb.<load>_tripped` vars: pulling one
 * removes power from its load; an overcurrent trip pops it with the white band showing.
 */
import type { Panel } from '../../../../cockpit/CockpitBuilder';
import type * as THREE from 'three';
import { CircuitBreaker } from '../../../../cockpit/controls';
import { CB_COLS, CB_LEGEND, CB_OVHD_LEFT, CB_OVHD_RIGHT, CB_ROWS, cbCell, type CbGridGroup } from '../../cbTable';
import type { G800CockpitContext } from '../context';
import { OVHD } from './layout';

export function buildOverheadBreakers(c: G800CockpitContext, ov: Panel, paint: THREE.Material): CircuitBreaker[] {
  const { env, sys } = c;
  const ratings = new Map(sys.elec.breakerNames().map((x) => [x.name, x.ratingA] as [string, number]));
  const out: CircuitBreaker[] = [];
  const cb = OVHD.cb;
  const x0 = 0.02;
  const y0 = 0.02;
  const dx = (cb.w - x0 - 0.008) / CB_COLS;
  const dy = (cb.h - y0 - 0.006) / CB_ROWS.length;
  for (const [side, groups] of [
    ['l', CB_OVHD_LEFT],
    ['r', CB_OVHD_RIGHT],
  ] as [string, CbGridGroup[]][]) {
    const p = ov.subPanel({ name: `g800.cb_${side}`, x: side === 'l' ? -cb.u : cb.u, y: cb.v, width: cb.w, height: cb.h, origin: 'top-left', material: paint, thickness: 0.004, radius: 0.006, screws: { kind: 'dzus', diameter: 0.005, inset: 0.006, pitch: 0.3 } });
    // Grid coordinates: column numbers across the top, row letters down the left edge.
    for (let col = 0; col < CB_COLS; col++) p.label(String(col + 1), x0 + (col + 0.5) * dx, 0.009, { height: 0.0026, weight: 700 });
    CB_ROWS.forEach((r, i) => p.label(r, 0.009, y0 + (i + 0.4) * dy, { height: 0.0026, weight: 700 }));
    for (const g of groups) {
      // Engraved outline around the group's cells, title on its lower edge.
      const gx0 = x0 + g.cols[0] * dx + 0.002;
      const gx1 = x0 + (g.cols[1] + 1) * dx - 0.002;
      const gy0 = y0 + g.rows[0] * dy - 0.001;
      const gy1 = y0 + (g.rows[1] + 1) * dy - 0.002;
      const lw = 0.0007;
      p.line(gx0, gy0, gx1, gy0, lw);
      p.line(gx0, gy1, gx1, gy1, lw);
      p.line(gx0, gy0, gx0, gy1, lw);
      p.line(gx1, gy0, gx1, gy1, lw);
      p.label(g.title, (gx0 + gx1) / 2, gy1 - 0.0025, { height: 0.0022, weight: 700 });
      g.items.forEach((name, i) => {
        const [row, col] = cbCell(g, i);
        const x = x0 + (col + 0.5) * dx;
        const y = y0 + (row + 0.36) * dy;
        const legend = CB_LEGEND[name] ?? name.toUpperCase();
        out.push(
          p.add(
            // Red collar rings and amp numerals on the caps (fix round 1 L08; p_cb.jpg).
            new CircuitBreaker(env, { id: `g800.cb.${name}`, label: `CB ${legend}`, var: `cb.${name}`, trippedVar: `cb.${name}_tripped`, rating: ratings.get(name) ?? '', diameter: 0.0095, collar: 'round', ring: 'red' }),
            x,
            y,
          ) as CircuitBreaker,
        );
        p.label(legend, x, y + 0.0095, { height: 0.0019, weight: 700 });
      });
    }
  }
  return out;
}
