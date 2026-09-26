/**
 * Electron main process (Electron 44) for the Windows exe / desktop build.
 *
 * - Serves the Vite build (dist/) through a privileged `app://` scheme
 *   (standard + secure: a secure context for Gamepad, Cache Storage, WebAudio,
 *   module workers; fetch/CORS/stream support for the nav data and workers).
 *   URL: app://app/index.html
 * - Dev mode: loads VITE_DEV_SERVER_URL (npm run electron:dev).
 * - IPC `http:get` fetches allow-listed hosts (aviationweather.gov METARs) from
 *   the main process, which is not subject to browser CORS.
 * - One 1920x1080 window, menu bar hidden, F11 full screen, background
 *   throttling off (the sim keeps running when the window loses focus).
 * - Single instance lock; GPU blocklist ignored (older drivers still get WebGL2).
 */
'use strict';

const { app, BrowserWindow, protocol, net, ipcMain, Menu, shell, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const DEV_URL = process.env.VITE_DEV_SERVER_URL || '';
const DIST = path.resolve(__dirname, '..', 'dist');
const SCHEME = 'app';
const HOST = 'app';
const START_URL = `${SCHEME}://${HOST}/index.html`;

/** Hosts the renderer may fetch through IPC (live METARs only). */
const HTTP_ALLOW = new Set(['aviationweather.gov']);

/**
 * Content-Security-Policy for the packaged app. The world streams AWS Terrain
 * Tiles (terrarium PNGs) from S3 in module workers; styles are injected at run
 * time; canvases and blobs are used for textures.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' https://s3.amazonaws.com https://elevation-tiles-prod.s3.amazonaws.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  // Nav data is served as-is; NavDatabase detects gzip by its magic bytes.
  '.gz': 'application/octet-stream',
};

// Must run before the app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
  },
]);

// GPU: use the discrete GPU where there is a choice and do not refuse older drivers.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

let mainWindow = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(onReady);
}

function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('bad request', { status: 400 });
    }
    if (url.host !== HOST) return new Response('not found', { status: 404 });
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST + path.sep)) return new Response('forbidden', { status: 403 });
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
    const res = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers();
    headers.set('content-type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    headers.set('cache-control', 'no-cache');
    if (file.endsWith('.html')) headers.set('content-security-policy', CSP);
    return new Response(res.body, { status: 200, headers });
  });
}

function registerIpc() {
  ipcMain.on('app:info', (event) => {
    event.returnValue = {
      platform: process.platform,
      versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, app: app.getVersion() },
    };
  });

  ipcMain.handle('http:get', async (_event, rawUrl, opts) => {
    const u = new URL(String(rawUrl));
    if (u.protocol !== 'https:' || !HTTP_ALLOW.has(u.hostname)) throw new Error(`host not allowed: ${u.hostname}`);
    const timeoutMs = Math.min(30_000, Math.max(1000, Number(opts && opts.timeoutMs) || 12_000));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await net.fetch(u.toString(), {
        signal: ctl.signal,
        // aviationweather.gov asks clients to identify themselves with a custom User-Agent.
        headers: { 'User-Agent': `AMGFlightSimulator/${app.getVersion()} (desktop)`, Accept: 'application/json, text/plain, */*' },
      });
      const body = await res.text();
      return { ok: res.ok, status: res.status, statusText: res.statusText, contentType: res.headers.get('content-type') || '', body };
    } finally {
      clearTimeout(timer);
    }
  });

  const win = (event) => BrowserWindow.fromWebContents(event.sender);
  ipcMain.handle('win:toggleFullscreen', (event) => {
    const w = win(event);
    if (!w) return false;
    w.setFullScreen(!w.isFullScreen());
    return w.isFullScreen();
  });
  ipcMain.handle('win:setFullscreen', (event, on) => {
    const w = win(event);
    if (!w) return false;
    w.setFullScreen(!!on);
    return w.isFullScreen();
  });
  ipcMain.handle('win:isFullscreen', (event) => !!win(event)?.isFullScreen());
  ipcMain.on('app:quit', () => app.quit());
}

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#06090d',
    title: 'AMG Flight Simulator',
    autoHideMenuBar: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow && mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const wc = mainWindow.webContents;
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'F12' && (!app.isPackaged || process.env.AMG_DEVTOOLS === '1')) {
      wc.toggleDevTools();
      event.preventDefault();
    }
  });
  // Links open in the system browser; the app itself never navigates away.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    const ok = url.startsWith(`${SCHEME}://${HOST}/`) || (DEV_URL && url.startsWith(DEV_URL));
    if (!ok) event.preventDefault();
  });

  if (DEV_URL) void mainWindow.loadURL(DEV_URL);
  else void mainWindow.loadURL(START_URL);
}

function onReady() {
  Menu.setApplicationMenu(null);
  // Only the permissions the sim uses (full screen, pointer lock for yoke/lever drags).
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'fullscreen' || permission === 'pointerLock');
  });
  registerProtocol();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
