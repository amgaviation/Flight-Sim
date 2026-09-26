/**
 * Airway expansion: the fixes along `airway` from an entry fix to an exit fix.
 *
 * Airway segments carry coordinates, so duplicate idents (e.g. two 'ABC'
 * fixes on different continents, or an airway name reused in several
 * regions) are disambiguated by position: the entry node is the airway point
 * with the entry ident closest to the entry waypoint. The path is found by a
 * breadth-first search over the airway graph (respecting one-way segments),
 * which also handles branching airways.
 */
import type { NavDatabase, Waypoint } from '../types';
import { distanceNm } from '../../core/geo';

interface Node {
  ident: string;
  lat: number;
  lon: number;
  next: number[];
}

/** Maximum distance (nm) between the entry waypoint and the matching airway point (data sources differ slightly). */
const ENTRY_MATCH_NM = 25;

function nodeKey(ident: string, lat: number, lon: number): string {
  // ~1 km buckets merge the same fix coming from both segment ends.
  return `${ident}@${Math.round(lat * 100)},${Math.round(lon * 100)}`;
}

/**
 * Returns the waypoints after `entry` up to and including `exitIdent` along
 * `airway`. Throws with a readable message when the airway is unknown, does
 * not contain the entry fix, or does not lead to the exit fix.
 */
export function expandAirway(db: NavDatabase, airway: string, entry: Waypoint, exitIdent: string): Waypoint[] {
  const segs = db.airway(airway);
  if (segs.length === 0) throw new Error(`unknown airway ${airway}`);
  const nodes: Node[] = [];
  const index = new Map<string, number>();
  const nodeOf = (ident: string, lat: number, lon: number): number => {
    const k = nodeKey(ident, lat, lon);
    let i = index.get(k);
    if (i === undefined) {
      i = nodes.length;
      nodes.push({ ident, lat, lon, next: [] });
      index.set(k, i);
    }
    return i;
  };
  for (const s of segs) {
    if (s.fromLat === undefined || s.fromLon === undefined || s.toLat === undefined || s.toLon === undefined) continue;
    const a = nodeOf(s.from, s.fromLat, s.fromLon);
    const b = nodeOf(s.to, s.toLat, s.toLon);
    nodes[a].next.push(b);
    if (!s.oneWay) nodes[b].next.push(a);
  }
  const exit = exitIdent.trim().toUpperCase();
  // Entry node: nearest airway point with the entry ident.
  let start = -1;
  let bestD = Infinity;
  nodes.forEach((n, i) => {
    if (n.ident !== entry.ident) return;
    const d = Number.isFinite(entry.lat) ? distanceNm(entry.lat, entry.lon, n.lat, n.lon) : 0;
    if (d < bestD) {
      bestD = d;
      start = i;
    }
  });
  if (start < 0 || bestD > ENTRY_MATCH_NM) throw new Error(`${entry.ident} is not on ${airway}`);
  // BFS to the nearest (in hops) node with the exit ident.
  const prev = new Int32Array(nodes.length).fill(-1);
  const seen = new Uint8Array(nodes.length);
  const queue = [start];
  seen[start] = 1;
  let found = -1;
  for (let q = 0; q < queue.length && found < 0; q++) {
    const u = queue[q];
    for (const v of nodes[u].next) {
      if (seen[v]) continue;
      seen[v] = 1;
      prev[v] = u;
      if (nodes[v].ident === exit) {
        found = v;
        break;
      }
      queue.push(v);
    }
  }
  if (found < 0) throw new Error(`${airway} does not connect ${entry.ident} to ${exit}`);
  const path: number[] = [];
  for (let v = found; v !== start; v = prev[v]) path.push(v);
  path.reverse();
  return path.map((i) => waypointFor(db, nodes[i]));
}

/** Airway point -> waypoint, typed as VOR/NDB when a navaid with that ident sits there. */
function waypointFor(db: NavDatabase, n: Node): Waypoint {
  for (const nav of db.navaidsByIdent(n.ident)) {
    if (distanceNm(nav.lat, nav.lon, n.lat, n.lon) < 1) {
      const kind = nav.type === 'NDB' || nav.type === 'NDBDME' ? 'ndb' : nav.type === 'LOC' || nav.type === 'ILS' || nav.type === 'GS' ? 'fix' : 'vor';
      return { ident: n.ident, lat: nav.lat, lon: nav.lon, kind, navaid: nav };
    }
  }
  return { ident: n.ident, lat: n.lat, lon: n.lon, kind: 'fix' };
}
