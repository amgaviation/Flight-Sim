/**
 * Identifier helpers shared by the system blocks. Component ids become part
 * of SimVar names (`elec.<id>_v`, `fail.elec.<id>`), so they are restricted
 * to `[A-Za-z0-9_]` and must be unique within a block.
 */

const ID_RE = /^[A-Za-z0-9_]+$/;

/** Throws if `id` is not a valid component id. `what` names the config section for the message. */
export function checkId(id: string, what: string): void {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw new Error(`${what}: invalid id '${String(id)}' (use letters, digits and '_')`);
  }
}

/** Tracks ids within one block and throws on duplicates. */
export class IdRegistry {
  private readonly ids = new Map<string, string>();

  constructor(private readonly block: string) {}

  add(id: string, kind: string): void {
    checkId(id, `${this.block} ${kind}`);
    const prev = this.ids.get(id);
    if (prev !== undefined) throw new Error(`${this.block}: duplicate id '${id}' (${kind}; already used by a ${prev})`);
    this.ids.set(id, kind);
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  kindOf(id: string): string | undefined {
    return this.ids.get(id);
  }
}

/** Failure var name for a failure id: `fail.<id>` (see failures/FailureManager). */
export function failVar(failureId: string): string {
  return `fail.${failureId}`;
}
