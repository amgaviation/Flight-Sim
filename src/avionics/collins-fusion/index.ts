/**
 * Collins Pro Line Fusion (Bombardier Global Vision Flight Deck) avionics
 * suite. See docs/modules/avionics-collins-fusion.md.
 */
export * from './vars';
export * from './config';
export { createFusionSuite, FusionSuite, type FusionSuiteHost } from './suite';
export * from './cockpit';
export { LayoutManager, AFD_W, AFD_H, SLOT_RECTS, allowedIn, defaultLayout, MENU_CONTENTS, type ShownWindow, type AfdSelection } from './logic/layout';
export { CursorLogic, CCP_GAIN, CURSOR_IDLE_S, AFD_ORIGINS, REACHABLE, type CursorRouter } from './logic/cursor';
export { FcpLogic, FCP_BUTTONS, FCP_KNOBS, FCP_LIGHTS, MAX_SEL_ALT_FT, EDM_ALT_FT, type ApproachInfo } from './logic/fcp';
export { CtpLogic, CtpPage, CTP_KEYS, RADIO_LINES, XPDR_MODES, stepCom, stepNav, stepAdf, stepSquawk } from './logic/ctp';
export { SourceSelector } from './logic/sources';
export { FusionCas, CAS_COLORS, GLOBAL_CAS_TEXTS } from './logic/cas';
export { ChecklistLogic, isNonNormal } from './logic/checklist';
export { SynopticReadouts, DEFAULT_READOUT_BINDINGS } from './logic/readouts';
export { MkpLogic, MKP_KEYS } from './logic/mkp';
export * from './fms';
export { AdaptiveFlightDisplay, drawFusionCursor, type FusionWindowSet } from './displays/afd';
export { CtpDisplay, CTP_W, CTP_H, CTP_ROWS } from './displays/ctpDisplay';
export { IesiDisplay, IESI_W, IESI_H } from './displays/iesi';
export { PfdRenderer } from './displays/pfd';
export { HotSpots, type WindowRenderer, type MenuItem, type FusionServices } from './displays/window';
