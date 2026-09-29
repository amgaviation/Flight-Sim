/**
 * Entry point (dev server, browser build and Electron): boots the app shell.
 * URL parameters can launch a flight directly (see src/ui/launch.ts), e.g.
 *   ?aircraft=_test-jet&airport=KTEB&runway=01&state=takeoff&autotest=1
 */
import { App } from './App';

const root = document.getElementById('app');
if (!root) throw new Error('#app element missing');
const app = new App(root);
app.start(window.location.search).catch((e: unknown) => {
  console.error('[AMG] start failed', e);
  root.textContent = `AMG Flight Simulator failed to start: ${e instanceof Error ? e.message : String(e)}`;
});
