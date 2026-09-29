/**
 * CDU page registry (one set of page objects per CDU; pages are stateless,
 * per-CDU state lives in `Cdu.state`).
 */
import type { CduPage, PageId } from './common';
import { approachPage, identPage, indexPage, menuPage, n1Page, navDataPage, navStatusPage, perfInitPage, posPage, takeoffPage } from './initRef';
import { arrivalsPage, depArrPage, departuresPage, rtePage } from './route';
import { holdPage, legsPage, rteDataPage } from './legs';
import { clbPage, crzPage, desForecastPage, desPage, fixPage, progPage } from './perfPages';

export function createPages(): Map<PageId, CduPage> {
  const list: CduPage[] = [
    indexPage,
    identPage,
    posPage,
    perfInitPage,
    takeoffPage,
    approachPage,
    n1Page,
    navDataPage,
    navStatusPage,
    menuPage,
    rtePage,
    depArrPage,
    departuresPage,
    arrivalsPage,
    legsPage,
    rteDataPage,
    holdPage,
    clbPage,
    crzPage,
    desPage,
    desForecastPage,
    progPage,
    fixPage,
  ];
  return new Map(list.map((p) => [p.id, p]));
}

export type { CduPage, PageId, Lsk } from './common';
