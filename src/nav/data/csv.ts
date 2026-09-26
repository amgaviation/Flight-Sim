/**
 * RFC 4180 CSV parser used by `scripts/build-navdata.mjs` for the OurAirports
 * exports (quoted fields, doubled quotes, embedded commas/newlines, CRLF or
 * LF line endings, optional UTF-8 BOM).
 *
 * This module is imported directly by Node (native TypeScript type stripping)
 * from the build script, so it must stay free of runtime relative imports and
 * of TypeScript-only runtime syntax (enums, namespaces, parameter properties).
 */

/**
 * Parses CSV text into rows of string fields. Empty trailing lines are
 * dropped. A field is returned exactly as written (no trimming, no type
 * conversion); quoted fields have their surrounding quotes removed and `""`
 * collapsed to `"`.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  const n = text.length;
  // Skip a UTF-8 byte-order mark.
  if (n > 0 && text.charCodeAt(0) === 0xfeff) i = 1;
  let inQuotes = false;
  // True once the current field has had any content or quotes (distinguishes
  // an empty last line from a row with a single empty field).
  let fieldStarted = false;

  while (i < n) {
    const c = text.charCodeAt(i);
    if (inQuotes) {
      if (c === 34 /* " */) {
        if (i + 1 < n && text.charCodeAt(i + 1) === 34) {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      // Copy a run of ordinary characters in one slice (fast path).
      let j = i + 1;
      while (j < n && text.charCodeAt(j) !== 34) j++;
      field += text.slice(i, j);
      i = j;
      continue;
    }
    if (c === 44 /* , */) {
      row.push(field);
      field = '';
      fieldStarted = true;
      i++;
      continue;
    }
    if (c === 10 /* \n */ || c === 13 /* \r */) {
      if (fieldStarted || field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
      }
      row = [];
      field = '';
      fieldStarted = false;
      // Treat CRLF as one line break.
      if (c === 13 && i + 1 < n && text.charCodeAt(i + 1) === 10) i += 2;
      else i++;
      continue;
    }
    if (c === 34 && field.length === 0) {
      inQuotes = true;
      fieldStarted = true;
      i++;
      continue;
    }
    // Unquoted run up to the next delimiter.
    let j = i + 1;
    while (j < n) {
      const d = text.charCodeAt(j);
      if (d === 44 || d === 10 || d === 13) break;
      j++;
    }
    field += text.slice(i, j);
    fieldStarted = true;
    i = j;
  }
  if (fieldStarted || field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** A parsed CSV table with a header row. */
export interface CsvTable {
  header: string[];
  rows: string[][];
  /** Column index by header name; throws when the column is missing. */
  col(name: string): number;
}

/** Parses CSV text whose first row is a header. */
export function parseCsvTable(text: string): CsvTable {
  const all = parseCsv(text);
  const header = all.length > 0 ? all[0] : [];
  const index = new Map<string, number>();
  header.forEach((h, k) => index.set(h.trim(), k));
  return {
    header,
    rows: all.slice(1),
    col(name: string): number {
      const k = index.get(name);
      if (k === undefined) throw new Error(`CSV column '${name}' not found (have: ${header.join(', ')})`);
      return k;
    },
  };
}

/** Parses a numeric CSV field; returns `NaN` for empty or non-numeric text. */
export function csvNumber(s: string | undefined): number {
  if (s === undefined) return NaN;
  const t = s.trim();
  if (t.length === 0) return NaN;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}
