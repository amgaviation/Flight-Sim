/**
 * Node-only file loader for `NavDatabaseImpl` (tests and scripts). Reads the
 * generated files from a directory (default `public/data`). Never import this
 * from browser code: it pulls in `node:fs`.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { NavDataFileLoader } from '../NavDatabase';

export function createFileLoader(dir: string): NavDataFileLoader {
  return async (file: string) => {
    try {
      return new Uint8Array(await readFile(join(dir, file)));
    } catch {
      return undefined;
    }
  };
}
