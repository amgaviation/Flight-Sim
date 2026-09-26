// Entry point. The app shell (src/ui, src/render) replaces this bootstrap.
import { AIRCRAFT_CATALOG } from './aircraft/registry';

const app = document.getElementById('app')!;
app.textContent = `AMG Flight Simulator — ${AIRCRAFT_CATALOG.length} aircraft`;
