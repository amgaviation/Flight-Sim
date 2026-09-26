/**
 * Runtime platform detection and the Electron bridge.
 *
 * The simulator runs in three hosts:
 *   - the Vite dev server (`npm run dev`, `import.meta.env.DEV`),
 *   - a static browser build (`npm run build && npm run preview`),
 *   - Electron (`electron/main.cjs` loads `dist/` through the privileged
 *     `app://` scheme; `electron/preload.cjs` exposes `window.amg`).
 *
 * Nothing else in the app should sniff user agents: ask this module.
 */
import pkg from '../../package.json';

/** Result of a main-process HTTP GET (Electron only). */
export interface BridgeHttpResult {
  ok: boolean;
  status: number;
  statusText: string;
  contentType: string;
  body: string;
}

/**
 * API exposed by `electron/preload.cjs` through `contextBridge` as
 * `window.amg`. Every call is a narrow IPC request; the renderer never gets
 * Node access (contextIsolation on, nodeIntegration off).
 */
export interface AmgBridge {
  readonly isElectron: true;
  /** process.platform of the main process ('win32', 'linux', 'darwin'). */
  readonly platform: string;
  readonly versions: { electron: string; chrome: string; node: string; app: string };
  /** HTTP GET performed by the main process (no CORS). Only allow-listed hosts are served. */
  httpGet(url: string, opts?: { timeoutMs?: number; headers?: Record<string, string> }): Promise<BridgeHttpResult>;
  toggleFullscreen(): Promise<boolean>;
  setFullscreen(on: boolean): Promise<boolean>;
  isFullscreen(): Promise<boolean>;
  quit(): void;
}

declare global {
  interface Window {
    amg?: AmgBridge;
  }
}

/** The Electron bridge, or null in a plain browser. */
export function getBridge(): AmgBridge | null {
  if (typeof window === 'undefined') return null;
  const b = window.amg;
  return b && b.isElectron === true ? b : null;
}

export function isElectron(): boolean {
  return getBridge() !== null;
}

/** True when served by the Vite dev server (proxy `/proxy/*` routes exist). */
export function isDevServer(): boolean {
  try {
    return import.meta.env?.DEV === true;
  } catch {
    return false;
  }
}

/** Short host description for the about box / debug HUD. */
export function platformLabel(): string {
  const b = getBridge();
  if (b) return `Electron ${b.versions.electron} (${b.platform})`;
  return isDevServer() ? 'Browser (dev server)' : 'Browser';
}

/** App version (package.json, or the Electron app version when packaged). */
export function appVersion(): string {
  const b = getBridge();
  if (b?.versions.app) return b.versions.app;
  return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
}

/** Fullscreen toggle that works in Electron (window fullscreen) and browsers (Fullscreen API). */
export async function toggleFullscreen(): Promise<boolean> {
  const b = getBridge();
  if (b) return b.toggleFullscreen();
  if (typeof document === 'undefined') return false;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return false;
    }
    await document.documentElement.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}
