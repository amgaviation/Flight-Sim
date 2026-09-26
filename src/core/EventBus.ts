/**
 * Discrete command events (button presses, key bindings, FMS keystrokes).
 *
 * State belongs in SimVars; momentary actions go through here. Event names use
 * the same dotted style as vars, e.g. `ap.hdg_sel_push`, `fmc.l.key.EXEC`,
 * `sim.pause_toggle`.
 */
export type EventHandler = (payload?: unknown) => void;

export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();
  private readonly wildcard = new Set<(name: string, payload?: unknown) => void>();

  on(name: string, fn: EventHandler): () => void {
    let set = this.handlers.get(name);
    if (!set) this.handlers.set(name, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  once(name: string, fn: EventHandler): () => void {
    const off = this.on(name, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  /** Receives every event; used by recorders and debug overlays. */
  onAny(fn: (name: string, payload?: unknown) => void): () => void {
    this.wildcard.add(fn);
    return () => this.wildcard.delete(fn);
  }

  emit(name: string, payload?: unknown): void {
    const set = this.handlers.get(name);
    if (set) for (const fn of [...set]) fn(payload);
    for (const fn of this.wildcard) fn(name, payload);
  }

  clear(): void {
    this.handlers.clear();
    this.wildcard.clear();
  }
}
