/**
 * Honeywell Primus Epic flight deck suite for Gulfstream aircraft:
 * PlaneView II (G650 / G650ER) and Symmetry (G500 / G600 / G700 / G800).
 * Reference: docs/modules/avionics-honeywell-epic.md.
 */
export * from './config';
export * from './vars';
export * from './style';
export { EpicSuite, createEpicSuite, TSC_POSITIONS, OHPTS_DEFAULT_PAGES, type EpicSuiteHost } from './suite';
export * from './cockpit';
// Logic (testable without canvases).
export * from './logic/windows';
export * from './logic/cursor';
export * from './logic/guidance';
export * from './logic/controller';
export * from './logic/cas';
export * from './logic/checklist';
export * from './logic/bindings';
export * from './logic/touch';
export * from './logic/overhead';
export * from './fms';
// Displays.
export type { EpicServices, WindowFormat } from './displays/window';
export { EpicWindow } from './displays/window';
export { EpicDisplayUnit, createWindow, DU_W, DU_H, MAIN_W, SIXTH_W, SIXTH_H } from './displays/du';
export { PfdWindow, fmaText } from './displays/pfd';
export { MapWindow } from './displays/mapWindow';
export { EngineWindow, Engine2Window, DIAL_EPIC, resolveEngineNames, type EngineVarNames } from './displays/engineWindows';
export { CasWindowEpic, ChecklistWindow, WptListWindow, BlankWindow } from './displays/sixthWindows';
export { SynopticWindow } from './displays/synoptics';
export { SyntheticVision } from './displays/svs';
export { McduDisplay, drawCduScreen, CDU_COLORS } from './displays/mcduDisplay';
export { SmcDisplay, SfdDisplay, StandbyInstrument } from './displays/standby';
export { GpWindowDisplay, GP_WINDOW_KINDS, type GpWindowKind } from './displays/gpDisplay';
export { TouchDisplay, drawWidget } from './displays/touchDisplay';
export * from './displays/styles';
export { buildTscPages, TSC_W, TSC_H, TSC_TITLE_H, type TscServices } from './touch/tscPages';
