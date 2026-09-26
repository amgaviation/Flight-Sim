/**
 * Boeing 737NG avionics suite: Common Display System, FMC / CDUs, MCP +
 * AFDS. See docs/modules/avionics-boeing-737.md.
 */
export { createB737Suite, B737Suite, type B737SuiteHost } from './suite';
export { resolveB737Config, DEFAULT_DISPLAY_VARS, type B737Config, type ResolvedB737Config, type B737PowerConfig, type B737DisplayVars, type B737AfdsConfig, type B737TrafficSource, type NdWeatherOverlay } from './config';
export * from './vars';
export { addDisplayUnits, addMcp, addEfisPanel, addDisengageLights, addDisplaySelect, addDuBrightness, addCentreControls, addCdu, addTransferSwitches, B737_HW, B737_DU_LAYOUT } from './cockpit';
export { B737Afds, BANK_POSITIONS, flapPlacardKt } from './afds/Afds';
export { B737Fmc } from './fmc/Fmc';
export { Cdu } from './fmc/Cdu';
export { CduDisplay, CDU_W, CDU_H } from './fmc/CduDisplay';
export { CdsLogic } from './cds/CdsLogic';
export { EfisPanels } from './cds/EfisPanels';
export { DisplayUnit } from './cds/DisplayUnit';
export { McpWindowDisplay, MCP_WINDOW_KINDS, mcpWindowId, type McpWindowKind } from './mcp/McpWindow';
export * from './data/b738';
export * from './data/cfm56';
export * from './data/perf';
