/**
 * Preload (sandboxed, context isolated): exposes a narrow `window.amg` bridge
 * to the renderer. See src/platform/env.ts (AmgBridge) for the typed surface.
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('app:info');

contextBridge.exposeInMainWorld('amg', {
  isElectron: true,
  platform: String(info.platform),
  versions: {
    electron: String(info.versions.electron),
    chrome: String(info.versions.chrome),
    node: String(info.versions.node),
    app: String(info.versions.app),
  },
  httpGet: (url, opts) => ipcRenderer.invoke('http:get', String(url), opts ? { timeoutMs: Number(opts.timeoutMs) || undefined } : undefined),
  toggleFullscreen: () => ipcRenderer.invoke('win:toggleFullscreen'),
  setFullscreen: (on) => ipcRenderer.invoke('win:setFullscreen', !!on),
  isFullscreen: () => ipcRenderer.invoke('win:isFullscreen'),
  quit: () => ipcRenderer.send('app:quit'),
});
