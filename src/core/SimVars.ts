/**
 * Central simulation variable store.
 *
 * Every piece of simulation state that crosses a module boundary lives here:
 * pilot inputs, switch positions, system outputs, flight-model outputs.
 * Numeric values only (booleans are 0/1); a separate string table exists for
 * things like FMS scratchpad text or selected waypoint idents.
 *
 * Naming convention: lowercase dotted namespaces with a unit suffix whenever
 * the value has a physical unit, e.g. `fdm.ias_kt`, `eng1.n1_pct`,
 * `elec.bus.dc1_v`. Standard names shared by all aircraft are in `vars.ts`.
 * Aircraft-specific switches use the `ac.` prefix (e.g. `ac.ovhd.batt1_sw`).
 */
export type VarListener = (value: number, prev: number) => void;
export type StringListener = (value: string, prev: string) => void;

export class SimVars {
  private readonly values = new Map<string, number>();
  private readonly strings = new Map<string, string>();
  private readonly listeners = new Map<string, Set<VarListener>>();
  private readonly stringListeners = new Map<string, Set<StringListener>>();

  get(name: string, fallback = 0): number {
    const v = this.values.get(name);
    return v === undefined ? fallback : v;
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  getBool(name: string): boolean {
    return this.get(name) !== 0;
  }

  set(name: string, value: number): void {
    const prev = this.values.get(name);
    if (prev === value) return;
    this.values.set(name, value);
    const ls = this.listeners.get(name);
    if (ls) for (const fn of ls) fn(value, prev ?? 0);
  }

  setBool(name: string, value: boolean): void {
    this.set(name, value ? 1 : 0);
  }

  toggle(name: string): number {
    const v = this.getBool(name) ? 0 : 1;
    this.set(name, v);
    return v;
  }

  /** Adds `delta`, optionally clamped or wrapped to [min, max]. */
  add(name: string, delta: number, min?: number, max?: number, wrap = false): number {
    let v = this.get(name) + delta;
    if (min !== undefined && max !== undefined) {
      if (wrap) {
        const span = max - min;
        v = ((((v - min) % span) + span) % span) + min;
      } else {
        v = Math.min(max, Math.max(min, v));
      }
    }
    this.set(name, v);
    return v;
  }

  getString(name: string, fallback = ''): string {
    const v = this.strings.get(name);
    return v === undefined ? fallback : v;
  }

  setString(name: string, value: string): void {
    const prev = this.strings.get(name);
    if (prev === value) return;
    this.strings.set(name, value);
    const ls = this.stringListeners.get(name);
    if (ls) for (const fn of ls) fn(value, prev ?? '');
  }

  subscribe(name: string, fn: VarListener): () => void {
    let set = this.listeners.get(name);
    if (!set) this.listeners.set(name, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  subscribeString(name: string, fn: StringListener): () => void {
    let set = this.stringListeners.get(name);
    if (!set) this.stringListeners.set(name, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  keys(): IterableIterator<string> {
    return this.values.keys();
  }

  snapshot(): { values: Record<string, number>; strings: Record<string, string> } {
    return {
      values: Object.fromEntries(this.values),
      strings: Object.fromEntries(this.strings),
    };
  }

  restore(snap: { values: Record<string, number>; strings: Record<string, string> }): void {
    for (const [k, v] of Object.entries(snap.values)) this.set(k, v);
    for (const [k, v] of Object.entries(snap.strings)) this.setString(k, v);
  }

  clear(): void {
    this.values.clear();
    this.strings.clear();
  }
}
