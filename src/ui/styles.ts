/**
 * Overlay UI stylesheet (injected once). Dark "glass cockpit" styling:
 * near-black panels, thin borders, cyan selection, amber cautions. Nothing
 * covers the 3D view during flight except what the pilot opens.
 */
export const UI_CSS = `
:root {
  --amg-bg: rgba(8, 12, 17, 0.94);
  --amg-panel: #121922;
  --amg-panel2: #19222d;
  --amg-line: #2a3644;
  --amg-text: #d9e2ea;
  --amg-dim: #8796a5;
  --amg-accent: #45b8f0;
  --amg-accent2: #1c7fd6;
  --amg-amber: #ffb300;
  --amg-red: #ff4d4d;
  --amg-green: #38d27a;
  --amg-font: 'Segoe UI', 'Inter', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif;
  --amg-mono: 'Cascadia Mono', 'Consolas', 'DejaVu Sans Mono', ui-monospace, monospace;
}
#app { font-family: var(--amg-font); color: var(--amg-text); user-select: none; }
.amg-view { display: block; width: 100%; height: 100%; outline: none; }
.amg-layer { position: fixed; inset: 0; pointer-events: none; z-index: 10; }
.amg-layer > * { pointer-events: auto; }
.amg-screen { position: fixed; inset: 0; background: radial-gradient(ellipse at 30% 20%, #16222f 0%, #070a0e 70%); display: flex; flex-direction: column; z-index: 20; overflow: hidden; }
.amg-modal-bg { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 30; }
.amg-modal { background: var(--amg-bg); border: 1px solid var(--amg-line); border-radius: 6px; box-shadow: 0 12px 40px rgba(0,0,0,0.6); width: min(1100px, 94vw); max-height: 88vh; display: flex; flex-direction: column; }
.amg-modal-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; border-bottom: 1px solid var(--amg-line); }
.amg-modal-head h2 { margin: 0; font-size: 16px; letter-spacing: 0.12em; font-weight: 600; text-transform: uppercase; }
.amg-modal-body { padding: 14px 18px; overflow: auto; }
.amg-header { display: flex; align-items: baseline; gap: 16px; padding: 18px 28px 10px; border-bottom: 1px solid var(--amg-line); }
.amg-header h1 { margin: 0; font-size: 20px; letter-spacing: 0.28em; font-weight: 600; }
.amg-header .amg-sub { color: var(--amg-dim); font-size: 12px; letter-spacing: 0.1em; }
.amg-header .amg-spacer { flex: 1; }
.amg-cols { flex: 1; display: grid; grid-template-columns: minmax(280px, 1.05fr) minmax(320px, 1.2fr) minmax(300px, 1fr); gap: 14px; padding: 14px 28px; overflow: hidden; min-height: 0; }
.amg-col { background: rgba(18,25,34,0.82); border: 1px solid var(--amg-line); border-radius: 6px; display: flex; flex-direction: column; min-height: 0; }
.amg-col h3 { margin: 0; padding: 10px 14px; font-size: 12px; font-weight: 600; letter-spacing: 0.16em; color: var(--amg-dim); text-transform: uppercase; border-bottom: 1px solid var(--amg-line); }
.amg-col-body { padding: 10px 14px; overflow: auto; flex: 1; min-height: 0; }
.amg-footer { display: flex; align-items: center; gap: 12px; padding: 12px 28px 18px; border-top: 1px solid var(--amg-line); }
.amg-footer .amg-summary { flex: 1; color: var(--amg-dim); font-size: 13px; }
.amg-card { border: 1px solid var(--amg-line); background: var(--amg-panel); border-radius: 5px; padding: 9px 11px; margin-bottom: 8px; cursor: pointer; transition: border-color 0.12s, background 0.12s; }
.amg-card:hover { border-color: #3d5063; }
.amg-card.selected { border-color: var(--amg-accent); background: #132536; }
.amg-card.disabled { opacity: 0.45; cursor: not-allowed; }
.amg-card .amg-title { font-size: 14px; font-weight: 600; }
.amg-card .amg-meta { font-size: 12px; color: var(--amg-dim); margin-top: 3px; }
.amg-badge { display: inline-block; font-size: 10px; letter-spacing: 0.08em; padding: 1px 6px; border-radius: 3px; border: 1px solid var(--amg-line); color: var(--amg-dim); margin-left: 6px; vertical-align: middle; text-transform: uppercase; }
.amg-badge.ok { color: var(--amg-green); border-color: #245a3c; }
.amg-badge.warn { color: var(--amg-amber); border-color: #6a4d10; }
.amg-btn { font-family: var(--amg-font); font-size: 13px; color: var(--amg-text); background: var(--amg-panel2); border: 1px solid var(--amg-line); border-radius: 4px; padding: 6px 12px; cursor: pointer; }
.amg-btn:hover { border-color: var(--amg-accent); }
.amg-btn:disabled { opacity: 0.5; cursor: default; }
.amg-btn.primary { background: var(--amg-accent2); border-color: var(--amg-accent); color: #fff; font-weight: 600; letter-spacing: 0.12em; padding: 10px 28px; font-size: 15px; }
.amg-btn.small { padding: 3px 8px; font-size: 12px; }
.amg-btn.active { border-color: var(--amg-accent); color: var(--amg-accent); }
.amg-btn.danger { border-color: #6b2525; color: #ff9b9b; }
.amg-input { font-family: var(--amg-font); font-size: 13px; color: var(--amg-text); background: #0c1117; border: 1px solid var(--amg-line); border-radius: 4px; padding: 5px 8px; }
.amg-input:focus { outline: none; border-color: var(--amg-accent); }
input.amg-input[type=number] { width: 90px; }
.amg-search { width: 100%; box-sizing: border-box; font-size: 14px; padding: 8px 10px; }
.amg-field { display: grid; grid-template-columns: 150px 1fr; align-items: center; gap: 8px; margin: 6px 0; font-size: 13px; }
.amg-field-label { color: var(--amg-dim); }
.amg-hint { grid-column: 2; color: var(--amg-dim); font-size: 11px; }
.amg-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 6px 0; }
.amg-list-item { display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; border-radius: 4px; cursor: pointer; font-size: 13px; border: 1px solid transparent; }
.amg-list-item:hover { background: var(--amg-panel2); }
.amg-list-item.selected { border-color: var(--amg-accent); background: #132536; }
.amg-list-item .amg-dim { color: var(--amg-dim); font-size: 12px; }
.amg-section { font-size: 11px; color: var(--amg-dim); letter-spacing: 0.14em; text-transform: uppercase; margin: 12px 0 6px; }
.amg-seg { display: inline-flex; border: 1px solid var(--amg-line); border-radius: 4px; overflow: hidden; flex-wrap: wrap; }
.amg-seg button { background: transparent; border: 0; border-right: 1px solid var(--amg-line); color: var(--amg-text); padding: 6px 10px; font-size: 12px; cursor: pointer; font-family: var(--amg-font); }
.amg-seg button:last-child { border-right: 0; }
.amg-seg button.active { background: #173049; color: var(--amg-accent); }
.amg-mono { font-family: var(--amg-mono); font-size: 12px; }
.amg-metar { font-family: var(--amg-mono); font-size: 12px; background: #0b1016; border: 1px solid var(--amg-line); border-radius: 4px; padding: 8px; white-space: pre-wrap; word-break: break-word; }
.amg-slider-wrap { display: inline-flex; align-items: center; gap: 8px; }
.amg-slider { width: 160px; accent-color: var(--amg-accent); }
.amg-slider-value { font-family: var(--amg-mono); font-size: 12px; min-width: 56px; color: var(--amg-text); }
.amg-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--amg-line); flex-wrap: wrap; }
.amg-tab { background: transparent; border: 0; border-bottom: 2px solid transparent; color: var(--amg-dim); padding: 8px 12px; cursor: pointer; font-size: 13px; font-family: var(--amg-font); }
.amg-tab.active { color: var(--amg-text); border-bottom-color: var(--amg-accent); }
.amg-tab-body { padding-top: 12px; }
.amg-table { border-collapse: collapse; width: 100%; font-size: 12px; }
.amg-table td, .amg-table th { border-bottom: 1px solid #1d2733; padding: 5px 6px; text-align: left; }
.amg-table th { color: var(--amg-dim); font-weight: 500; letter-spacing: 0.06em; }
.amg-bar { position: relative; height: 10px; width: 180px; background: #0b1016; border: 1px solid var(--amg-line); border-radius: 2px; overflow: hidden; }
.amg-bar > div { position: absolute; top: 0; bottom: 0; background: var(--amg-accent); }
.amg-loading { position: fixed; inset: 0; background: #06090d; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; z-index: 40; }
.amg-loading h2 { margin: 0; letter-spacing: 0.3em; font-weight: 500; font-size: 18px; }
.amg-progress { width: 360px; height: 4px; background: #16202b; border-radius: 2px; overflow: hidden; }
.amg-progress > div { height: 100%; background: var(--amg-accent); width: 0%; transition: width 0.2s; }
.amg-loading .amg-step { color: var(--amg-dim); font-size: 13px; min-height: 18px; }
.amg-toast { position: fixed; left: 50%; top: 18px; transform: translateX(-50%); background: rgba(8,12,17,0.82); border: 1px solid var(--amg-line); border-radius: 4px; padding: 6px 14px; font-size: 13px; letter-spacing: 0.06em; z-index: 25; pointer-events: none; transition: opacity 0.4s; }
.amg-caption { position: fixed; left: 50%; bottom: 56px; transform: translateX(-50%); color: var(--amg-amber); font-family: var(--amg-mono); font-size: 16px; letter-spacing: 0.1em; text-shadow: 0 0 6px #000; z-index: 25; pointer-events: none; transition: opacity 0.5s; }
.amg-hud { position: fixed; left: 10px; top: 10px; background: rgba(0,0,0,0.6); border: 1px solid #1d2733; border-radius: 4px; padding: 6px 9px; font-family: var(--amg-mono); font-size: 11px; line-height: 1.45; white-space: pre; z-index: 24; pointer-events: none; color: #bfe3ff; }
.amg-fps { position: fixed; right: 10px; top: 8px; font-family: var(--amg-mono); font-size: 11px; color: #9fd3ff; text-shadow: 0 0 3px #000; z-index: 24; pointer-events: none; }
.amg-status { position: fixed; right: 12px; bottom: 10px; font-size: 12px; color: var(--amg-dim); background: rgba(0,0,0,0.45); padding: 3px 8px; border-radius: 3px; z-index: 24; pointer-events: none; letter-spacing: 0.05em; }
.amg-paused { position: fixed; left: 50%; top: 42%; transform: translate(-50%, -50%); font-size: 26px; letter-spacing: 0.4em; color: var(--amg-amber); text-shadow: 0 0 10px #000; z-index: 24; pointer-events: none; }
.amg-side { position: fixed; top: 60px; right: 12px; width: 380px; max-height: calc(100vh - 120px); background: var(--amg-bg); border: 1px solid var(--amg-line); border-radius: 6px; z-index: 26; display: flex; flex-direction: column; }
.amg-check { display: flex; gap: 8px; align-items: baseline; padding: 4px 2px; border-bottom: 1px dotted #223040; font-size: 13px; cursor: pointer; }
.amg-check .amg-dots { flex: 1; border-bottom: 1px dotted #33475b; transform: translateY(-4px); }
.amg-check.done { color: var(--amg-green); }
.amg-check.auto-ok .amg-resp { color: var(--amg-green); }
.amg-keys { columns: 2; column-gap: 28px; font-size: 12px; }
.amg-keys .amg-keyrow { display: flex; justify-content: space-between; gap: 10px; padding: 2px 0; break-inside: avoid; border-bottom: 1px solid #16202b; }
kbd { font-family: var(--amg-mono); font-size: 11px; background: #0b1016; border: 1px solid #33475b; border-bottom-width: 2px; border-radius: 3px; padding: 0 5px; color: #e8f1f8; margin-left: 3px; }
.amg-mouse-yoke { position: fixed; left: 50%; top: 50%; width: 96px; height: 96px; margin: -48px 0 0 -48px; border: 1px solid rgba(69,184,240,0.6); border-radius: 50%; pointer-events: none; z-index: 23; display: none; }
.amg-mouse-yoke-dot { position: absolute; left: 44px; top: 44px; width: 8px; height: 8px; border-radius: 50%; background: var(--amg-accent); }
.amg-mouse-yoke-label { position: absolute; top: 102px; width: 100%; text-align: center; font-size: 10px; letter-spacing: 0.12em; color: var(--amg-accent); }
.cockpit-tooltip { font-family: var(--amg-font) !important; }
.amg-error { color: var(--amg-red); font-size: 13px; }
.amg-ok { color: var(--amg-green); }
.amg-warn { color: var(--amg-amber); }
.amg-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; }
.amg-attrib { font-size: 10px; color: #5d6d7c; padding: 0 28px 8px; }
`;

let injected = false;

export function injectStyles(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const s = document.createElement('style');
  s.id = 'amg-ui-styles';
  s.textContent = UI_CSS;
  document.head.appendChild(s);
}
