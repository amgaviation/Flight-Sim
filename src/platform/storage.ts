/**
 * Persistent key/value storage (settings, input profiles, aircraft data).
 *
 * Backed by `localStorage` (per origin: `http://localhost:5173` in dev,
 * `app://app` in Electron, whose Chromium profile lives in the user's
 * AppData). Every access is wrapped in try/catch: private windows, disabled
 * storage or a full quota fall back to an in-memory map, so the app always
 * works, it just forgets on reload.
 *
 * Values are JSON. Keys are namespaced (`amgsim.<ns>.<key>`).
 */

export interface KeyValueStore {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
  /** Keys (without the namespace prefix) currently stored in this namespace. */
  keys(): string[];
  /** A child store (`<ns>.<sub>`). */
  child(sub: string): KeyValueStore;
}

/** Minimal Web Storage surface (lets tests pass a fake). */
export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export const STORAGE_ROOT = 'amgsim';

/** In-memory backend used when localStorage is unavailable. */
export class MemoryBackend implements StorageBackend {
  private readonly m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  key(i: number): string | null {
    return [...this.m.keys()][i] ?? null;
  }
  get length(): number {
    return this.m.size;
  }
}

let sharedMemory: MemoryBackend | null = null;

/** localStorage when usable, else a process-wide memory backend. */
export function defaultBackend(): StorageBackend {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      const probe = `${STORAGE_ROOT}.__probe`;
      localStorage.setItem(probe, '1');
      localStorage.removeItem(probe);
      return localStorage;
    }
  } catch {
    // fall through
  }
  return (sharedMemory ??= new MemoryBackend());
}

class NamespacedStore implements KeyValueStore {
  constructor(
    private readonly backend: StorageBackend,
    private readonly prefix: string,
  ) {}

  get<T>(key: string, fallback: T): T {
    try {
      const raw = this.backend.getItem(this.prefix + key);
      if (raw === null) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  set<T>(key: string, value: T): void {
    try {
      if (value === undefined) this.backend.removeItem(this.prefix + key);
      else this.backend.setItem(this.prefix + key, JSON.stringify(value));
    } catch {
      // Quota exceeded or storage disabled: settings stay in memory for this session only.
    }
  }

  remove(key: string): void {
    try {
      this.backend.removeItem(this.prefix + key);
    } catch {
      // ignore
    }
  }

  keys(): string[] {
    const out: string[] = [];
    try {
      for (let i = 0; i < this.backend.length; i++) {
        const k = this.backend.key(i);
        if (k && k.startsWith(this.prefix)) out.push(k.slice(this.prefix.length));
      }
    } catch {
      // ignore
    }
    return out;
  }

  child(sub: string): KeyValueStore {
    return new NamespacedStore(this.backend, `${this.prefix}${sub}.`);
  }
}

/** Store for namespace `ns` (`amgsim.<ns>.`). */
export function createStorage(ns: string, backend: StorageBackend = defaultBackend()): KeyValueStore {
  return new NamespacedStore(backend, `${STORAGE_ROOT}.${ns}.`);
}
