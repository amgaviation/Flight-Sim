import type { AircraftModule } from './types';

// Globbed so the catalog compiles before every aircraft folder exists.
const MODULES = import.meta.glob<{ default: AircraftModule }>('./*/index.ts');

function loader(id: string): () => Promise<AircraftModule> {
  return async () => {
    const imp = MODULES[`./${id}/index.ts`];
    if (!imp) throw new Error(`Aircraft module '${id}' is not built yet`);
    return (await imp()).default;
  };
}

export function isAvailable(id: string): boolean {
  return `./${id}/index.ts` in MODULES;
}

/**
 * Aircraft catalog. Each entry lazy-loads its module so the menu stays light.
 * Each aircraft folder exports `default` as an AircraftModule from `index.ts`.
 */
export interface CatalogEntry {
  id: string;
  name: string;
  avionics: string;
  load: () => Promise<AircraftModule>;
}

export const AIRCRAFT_CATALOG: CatalogEntry[] = [
  { id: 'citation-m2', name: 'Cessna Citation M2', avionics: 'Garmin G3000', load: loader('citation-m2') },
  { id: 'citation-longitude', name: 'Cessna Citation Longitude', avionics: 'Garmin G5000', load: loader('citation-longitude') },
  { id: 'g650', name: 'Gulfstream G650', avionics: 'Honeywell PlaneView II', load: loader('g650') },
  { id: 'g800', name: 'Gulfstream G800', avionics: 'Honeywell Symmetry', load: loader('g800') },
  { id: 'global6000', name: 'Bombardier Global 6000', avionics: 'Collins Pro Line Fusion (Global Vision)', load: loader('global6000') },
  { id: 'b737-800', name: 'Boeing 737-800', avionics: 'Boeing 737NG CDS / Smiths FMC', load: loader('b737-800') },
  { id: 'c172-steam', name: 'Cessna 172S Skyhawk (steam gauges)', avionics: 'Analog six-pack, KX 155A / KAP 140', load: loader('c172-steam') },
  { id: 'c172-g1000', name: 'Cessna 172S Skyhawk (G1000 NXi)', avionics: 'Garmin G1000 NXi / GFC 700', load: loader('c172-g1000') },
];
