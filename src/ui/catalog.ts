/**
 * Aircraft list for the menus: the user catalog (src/aircraft/registry.ts)
 * plus the hidden development test jet, which is offered only when no real
 * aircraft module is built yet (or when requested explicitly by id).
 */
import { AIRCRAFT_CATALOG, isAvailable, type CatalogEntry } from '../aircraft/registry';
import type { AircraftModule } from '../aircraft/types';

export const TEST_AIRCRAFT_ID = '_test-jet';

export const TEST_ENTRY: CatalogEntry = {
  id: TEST_AIRCRAFT_ID,
  name: 'Test Jet (development)',
  avionics: 'Test PFD / demo cockpit',
  load: async (): Promise<AircraftModule> => (await import('../aircraft/_test/index')).default,
};

export interface MenuAircraft extends CatalogEntry {
  available: boolean;
}

/** Entries shown in the aircraft picker. */
export function menuAircraft(): MenuAircraft[] {
  const list: MenuAircraft[] = AIRCRAFT_CATALOG.map((e) => ({ ...e, available: isAvailable(e.id) }));
  if (!list.some((e) => e.available)) list.push({ ...TEST_ENTRY, available: true });
  return list;
}

/** Looks an aircraft up by id, including the hidden test jet. */
export function findAircraft(id: string): MenuAircraft | undefined {
  if (id === TEST_AIRCRAFT_ID) return { ...TEST_ENTRY, available: true };
  const e = AIRCRAFT_CATALOG.find((x) => x.id === id);
  return e ? { ...e, available: isAvailable(e.id) } : undefined;
}

/** Default aircraft: first available catalog entry, else the test jet. */
export function defaultAircraftId(): string {
  return menuAircraft().find((e) => e.available)?.id ?? TEST_AIRCRAFT_ID;
}
