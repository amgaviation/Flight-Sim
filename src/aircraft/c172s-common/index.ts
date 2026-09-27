/**
 * Cessna 172S Skyhawk SP shared core for the c172-steam and c172-g1000 aircraft modules.
 * Not an aircraft module itself (no default export); see docs/aircraft/c172s.md §9 "Using the
 * shared core" for the integration recipe.
 */
export * from './data';
export * from './vars';
export * from './fdm';
export * from './meta';
export * from './createSystems';
export * from './states';
export * from './checklists';
export * from './inputMap';
export * from './systems/electrical';
export * from './systems/fuel';
export * from './systems/instruments';
export * from './systems/flight';
export * from './systems/lighting';
export * from './systems/logic';
export { createC172Exterior, type C172Exterior, type C172ExteriorOptions } from './exterior';
