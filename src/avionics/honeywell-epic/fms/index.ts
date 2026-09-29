/**
 * Honeywell NG FMS MCDU (PlaneView II) / TSC FMS app (Symmetry): page set.
 * See fms/mcdu.ts for the key model and docs/modules/avionics-honeywell-epic.md.
 */
import type { CduPage } from './mcdu';
import { NAV_PAGES } from './pagesNav';
import { PERF_PAGES } from './pagesPerf';
import { RADIO_PAGES } from './pagesRadio';

export * from './cdu';
export * from './mcdu';
export { NAV_PAGES, FPL_PAGE, DIRECT_PAGE, HOLD_PAGE, shortProc } from './pagesNav';
export { PERF_PAGES } from './pagesPerf';
export { RADIO_PAGES } from './pagesRadio';

/** Every MCDU page. */
export const EPIC_CDU_PAGES: readonly CduPage[] = [...NAV_PAGES, ...PERF_PAGES, ...RADIO_PAGES];

/** Function key -> page id. */
export const EPIC_KEY_PAGES: Readonly<Record<string, string>> = {
  FPL: 'FPL',
  NAV: 'NAV_INDEX',
  PERF: 'PERF_INDEX',
  PROG: 'PROG',
  DIR: 'DIR',
  RADIO: 'RADIO',
  MSG: 'MSG',
  DLK: 'DLK',
  MENU: 'MENU',
};
