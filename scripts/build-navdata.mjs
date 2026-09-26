#!/usr/bin/env node
/**
 * build-navdata.mjs - regenerates the navigation database in public/data/.
 *
 *   npm run navdata                       (= node scripts/build-navdata.mjs)
 *   node scripts/build-navdata.mjs [--offline] [--refresh] [--no-cifp]
 *        [--procedures all|major|none] [--cache DIR] [--out DIR]
 *
 * Requirements
 *   - Node >= 22.18: the parsers live in src/nav/data/*.ts and are imported
 *     through Node's native TypeScript type stripping (no build step, no deps).
 *   - Network through a proxy: Node's built-in fetch() ignores HTTPS_PROXY
 *     unless NODE_USE_ENV_PROXY=1 is set (Node >= 22.21 / 24.5). When
 *     HTTPS_PROXY is set and NODE_USE_ENV_PROXY is not, this script re-executes
 *     itself with NODE_USE_ENV_PROXY=1 so `npm run navdata` works behind a
 *     proxy. A custom proxy CA is picked up from NODE_EXTRA_CA_CERTS.
 *
 * Sources (downloads are cached in .cache/navdata/; --offline uses the cache
 * only, --refresh forces new downloads):
 *   - OurAirports (public domain): airports.csv, runways.csv, navaids.csv,
 *     airport-frequencies.csv from https://davidmegginson.github.io/ourairports-data/
 *   - FlightGear fgdata Navaids (GPL v2, X-Plane 810/600/640 formats by Robin
 *     A. Peel): nav.dat.gz, fix.dat.gz, awy.dat.gz (GitLab raw, SourceForge
 *     mirror as fallback). Data cycle 2013.10: used for worldwide ILS, markers,
 *     fixes and airways.
 *   - FAA CIFP (public domain, ARINC 424-18): the current AIRAC cycle zip from
 *     https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/
 *     Supplies current US localizers/glideslopes, enroute fixes, airways and
 *     every SID/STAR/approach (public/data/procedures/<ICAO>.json.gz).
 *
 * Outputs (gzipped JSON; formats in src/nav/data/format.ts):
 *   airports.json.gz navaids.json.gz ils.json.gz fixes.json.gz airways.json.gz
 *   meta.json procedures/index.json procedures/<ident>.json.gz
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync, inflateRawSync } from 'node:zlib';

// Re-exec with the env proxy enabled for fetch() (see header).
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(r.status ?? 1);
}

const { parseCsvTable } = await import('../src/nav/data/csv.ts');
const { buildAirports, buildNavaids } = await import('../src/nav/data/ourairports.ts');
const { parseNavDat, parseFixDat, parseAwyDat, xplaneCycle } = await import('../src/nav/data/xplane.ts');
const { parseCifp, CifpFixResolver, buildCifpProcedures, buildCifpAirways, buildCifpLocalizers } = await import(
  '../src/nav/data/arinc424.ts'
);
const { matchAirport, buildFgIls, mergeLocalizers, mergeFixes, fgAirwayRows, mergeAirways, distNm } = await import(
  '../src/nav/data/merge.ts'
);
const { NAVDATA_FORMAT_VERSION } = await import('../src/nav/data/format.ts');

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------------ options
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const OFFLINE = args.includes('--offline');
const REFRESH = args.includes('--refresh');
const NO_CIFP = args.includes('--no-cifp');
const PROCEDURES = opt('--procedures', 'all'); // all | major | none
const CACHE = resolve(ROOT, opt('--cache', '.cache/navdata'));
const OUT = resolve(ROOT, opt('--out', 'public/data'));
const MAX_CACHE_AGE_MS = 7 * 24 * 3600 * 1000;

const OURAIRPORTS = 'https://davidmegginson.github.io/ourairports-data/';
const FG_MIRRORS = [
  'https://gitlab.com/flightgear/fgdata/-/raw/next/Navaids/',
  'https://gitlab.com/flightgear/fgdata/-/raw/release/2024.1/Navaids/',
  'https://sourceforge.net/p/flightgear/fgdata/ci/next/tree/Navaids/{file}?format=raw',
];
const CIFP_PAGE = 'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/download/';
const CIFP_BASE = 'https://aeronav.faa.gov/Upload_313-d/cifp/';

const log = (...a) => console.log('[navdata]', ...a);

// ------------------------------------------------------------------ download
async function fetchBuffer(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'amg-flight-sim-navdata/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error(`${url}: ${lastErr?.message ?? lastErr}`);
}

/** Returns the file from cache or downloads it from the first working URL. */
async function cached(name, urls, validate = () => true) {
  const path = join(CACHE, name);
  const fresh = existsSync(path) && (OFFLINE || (!REFRESH && Date.now() - statSync(path).mtimeMs < MAX_CACHE_AGE_MS));
  if (fresh) return readFileSync(path);
  if (OFFLINE) throw new Error(`--offline and ${name} is not cached`);
  const errors = [];
  for (const url of urls) {
    try {
      log(`download ${url}`);
      const buf = await fetchBuffer(url);
      if (!validate(buf)) throw new Error('unexpected content');
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(path, buf);
      return buf;
    } catch (e) {
      errors.push(String(e.message ?? e));
    }
  }
  if (existsSync(path)) {
    log(`WARNING: using stale cache for ${name} (${errors.join('; ')})`);
    return readFileSync(path);
  }
  throw new Error(`could not download ${name}: ${errors.join('; ')}`);
}

const isGzip = (b) => b.length > 2 && b[0] === 0x1f && b[1] === 0x8b;
const isZip = (b) => b.length > 4 && b.readUInt32LE(0) === 0x04034b50;

/** Minimal ZIP reader (no ZIP64): returns the named entry's bytes. */
function unzipEntry(zip, predicate) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip: end of central directory not found');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let k = 0; k < count; k++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central directory');
    const method = zip.readUInt16LE(p + 10);
    const csize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const localOff = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (!predicate(name)) continue;
    const lnl = zip.readUInt16LE(localOff + 26);
    const lel = zip.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lnl + lel;
    const data = zip.subarray(start, start + csize);
    if (method === 0) return { name, data: Buffer.from(data) };
    if (method === 8) return { name, data: inflateRawSync(data) };
    throw new Error(`zip: unsupported compression method ${method}`);
  }
  return null;
}

/** Current CIFP zip URL: discovered from the FAA download page, else computed from the AIRAC schedule. */
async function cifpUrls() {
  const urls = [];
  try {
    const html = (await fetchBuffer(CIFP_PAGE)).toString('utf8');
    const found = [...new Set([...html.matchAll(/https?:\/\/[^"'\s>]*CIFP_(\d{6})\.zip/g)].map((m) => m[0]))];
    // Keep the newest cycle that is already effective (YYMMDD <= today).
    const today = new Date();
    const ymd = (d) => Number(`${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`);
    const eff = found
      .map((u) => ({ u, d: Number(/CIFP_(\d{6})/.exec(u)[1]) }))
      .filter((x) => x.d <= ymd(today))
      .sort((a, b) => b.d - a.d);
    for (const x of eff) urls.push(x.u);
  } catch (e) {
    log(`CIFP page not reachable (${e.message}); computing the AIRAC date`);
  }
  // AIRAC cycles are 28 days apart; 2609 became effective 2026-09-03 (FAA CIFP header).
  const ref = Date.UTC(2026, 8, 3);
  const n = Math.floor((Date.now() - ref) / (28 * 86400000));
  for (const k of [n, n - 1]) {
    const d = new Date(ref + k * 28 * 86400000);
    const s = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    urls.push(`${CIFP_BASE}CIFP_${s}.zip`);
  }
  return [...new Set(urls)];
}

// ------------------------------------------------------------------ helpers
function writeGz(rel, obj) {
  const path = join(OUT, rel);
  mkdirSync(dirname(path), { recursive: true });
  const buf = gzipSync(Buffer.from(JSON.stringify(obj)), { level: 9 });
  writeFileSync(path, buf);
  return buf.length;
}

const mb = (n) => `${(n / 1048576).toFixed(2)} MB`;

// ------------------------------------------------------------------ build
async function main() {
  const t0 = Date.now();
  mkdirSync(OUT, { recursive: true });
  const sources = [];

  // --- OurAirports
  const csv = {};
  for (const f of ['airports', 'runways', 'navaids', 'airport-frequencies']) {
    const buf = await cached(`${f}.csv`, [`${OURAIRPORTS}${f}.csv`], (b) => b.subarray(0, 5).toString() === '"id",');
    csv[f] = parseCsvTable(buf.toString('utf8'));
  }
  sources.push({ name: 'OurAirports', url: OURAIRPORTS, license: 'Public domain', date: new Date().toISOString().slice(0, 10) });
  const ap = buildAirports(csv.airports, csv.runways, csv['airport-frequencies']);
  const navaids = buildNavaids(csv.navaids);
  log(`airports ${ap.rows.length} (skipped closed ${ap.skipped.closed}, balloonports ${ap.skipped.balloonport}), navaids ${navaids.length}`);

  const mapAirport = (code, lat, lon) => {
    const i = matchAirport(ap.rows, ap.byCode, code, lat, lon, 15);
    return i >= 0 ? ap.rows[i][0] : '';
  };

  // --- FlightGear
  const fg = {};
  for (const f of ['nav', 'fix', 'awy']) {
    const file = `${f}.dat.gz`;
    const buf = await cached(file, FG_MIRRORS.map((m) => (m.includes('{file}') ? m.replace('{file}', file) : m + file)), isGzip);
    fg[f] = gunzipSync(buf).toString('latin1');
  }
  const fgCycle = xplaneCycle(fg.nav);
  sources.push({ name: 'FlightGear fgdata Navaids (X-Plane 810/600/640)', url: FG_MIRRORS[0], license: 'GPL-2.0', cycle: fgCycle });
  const navRecs = parseNavDat(fg.nav);
  const fgIls = buildFgIls(navRecs, mapAirport);
  const fgFixes = parseFixDat(fg.fix);
  const fgAirways = fgAirwayRows(parseAwyDat(fg.awy));
  log(`FlightGear cycle ${fgCycle}: localizers ${fgIls.localizers.length}, markers ${fgIls.markers.length}, fixes ${fgFixes.length}, airway segments ${fgAirways.length}`);

  // --- FAA CIFP
  let cifp = null;
  let cifpMeta = null;
  if (!NO_CIFP) {
    try {
      const urls = await cifpUrls();
      let zipBuf = null;
      let usedUrl = '';
      for (const u of urls) {
        try {
          zipBuf = await cached(u.split('/').pop(), [u], isZip);
          usedUrl = u;
          break;
        } catch (e) {
          log(`CIFP ${u}: ${e.message}`);
        }
      }
      if (!zipBuf) throw new Error('no CIFP zip reachable');
      const entry = unzipEntry(zipBuf, (n) => /FAACIFP18$/i.test(n));
      if (!entry) throw new Error('FAACIFP18 not found in zip');
      cifp = parseCifp(entry.data.toString('latin1'));
      cifpMeta = { cycle: cifp.cycle, effective: cifp.effective, url: usedUrl };
      sources.push({ name: 'FAA CIFP', url: usedUrl, license: 'Public domain (US Government work)', cycle: cifp.cycle, date: cifp.effective });
      log(`CIFP ${cifp.cycle} (${cifp.effective}): airports ${cifp.airports.size}, procedure legs ${cifp.procedures.length}, localizers ${cifp.localizers.length}`);
    } catch (e) {
      log(`WARNING: CIFP unavailable (${e.message}); US procedures and current US ILS/fix/airway data will be missing`);
      cifp = null;
    }
  }

  // --- merge ILS / fixes / airways
  let localizers = fgIls.localizers;
  let markers = fgIls.markers;
  let fixes = fgFixes.map((f) => ({ ident: f.ident, lat: f.lat, lon: f.lon, region: '' }));
  let airways = fgAirways;
  const cifpToDb = new Map();
  let procFiles = [];
  if (cifp) {
    // CIFP airport ident -> database ident.
    for (const a of cifp.airports.values()) {
      const i = matchAirport(ap.rows, ap.byCode, a.ident, a.lat, a.lon, 5);
      if (i >= 0) {
        cifpToDb.set(a.ident, ap.rows[i][0]);
        if (Number.isFinite(a.transitionAltFt) && a.transitionAltFt > 0) ap.rows[i][14] = a.transitionAltFt;
      }
    }
    const cifpLoc = buildCifpLocalizers(cifp)
      .map((r) => {
        const id = cifpToDb.get(r[0]);
        if (!id) return null;
        r[0] = id;
        return r;
      })
      .filter(Boolean);
    const m = mergeLocalizers(fgIls.localizers, cifpLoc, fgIls.markers);
    localizers = m.localizers;
    markers = m.markers;
    const res = new CifpFixResolver(cifp);
    fixes = mergeFixes(
      fgFixes,
      cifp.enrouteWaypoints.map((w) => ({ ident: w.ident, lat: w.lat, lon: w.lon, region: w.region })),
      cifp.terminalWaypoints.map((w) => ({ ident: w.ident, lat: w.lat, lon: w.lon, region: w.region })),
    );
    airways = mergeAirways(fgAirways, buildCifpAirways(cifp, res));

    // --- procedures
    if (PROCEDURES !== 'none') {
      const procs = buildCifpProcedures(cifp, res);
      const typeOf = new Map(ap.rows.map((r) => [r[0], r[2]]));
      let unmapped = 0;
      for (const [cifpId, p] of procs) {
        const id = cifpToDb.get(cifpId);
        if (!id) {
          unmapped++;
          continue;
        }
        if (PROCEDURES === 'major' && !['L', 'M'].includes(typeOf.get(id))) continue;
        procFiles.push({ id, cifpId, p });
      }
      log(`procedures for ${procFiles.length} airports (CIFP airports not matched to OurAirports: ${unmapped}; unresolved fix references: ${res.unresolved})`);
    }
  }
  log(`merged: localizers ${localizers.length}, markers ${markers.length}, fixes ${fixes.length}, airway segments ${airways.length}`);

  // --- write
  const sizes = {};
  sizes['airports.json.gz'] = writeGz('airports.json.gz', { format: 'amg-navdata/airports', version: NAVDATA_FORMAT_VERSION, rows: ap.rows });
  sizes['navaids.json.gz'] = writeGz('navaids.json.gz', { format: 'amg-navdata/navaids', version: NAVDATA_FORMAT_VERSION, rows: navaids });
  sizes['ils.json.gz'] = writeGz('ils.json.gz', { format: 'amg-navdata/ils', version: NAVDATA_FORMAT_VERSION, localizers, markers });
  sizes['fixes.json.gz'] = writeGz('fixes.json.gz', {
    format: 'amg-navdata/fixes',
    version: NAVDATA_FORMAT_VERSION,
    ident: fixes.map((f) => f.ident),
    lat: fixes.map((f) => f.lat),
    lon: fixes.map((f) => f.lon),
    region: fixes.map((f) => f.region),
  });
  sizes['airways.json.gz'] = writeGz('airways.json.gz', { format: 'amg-navdata/airways', version: NAVDATA_FORMAT_VERSION, rows: airways });

  // Procedures: rewrite the folder so removed airports disappear.
  const procDir = join(OUT, 'procedures');
  if (existsSync(procDir)) for (const f of readdirSync(procDir)) rmSync(join(procDir, f));
  let procBytes = 0;
  const index = {};
  for (const { id, cifpId, p } of procFiles) {
    procBytes += writeGz(`procedures/${id}.json.gz`, {
      format: 'amg-navdata/procedures',
      version: NAVDATA_FORMAT_VERSION,
      icao: id,
      cifpIdent: cifpId,
      cycle: cifp.cycle,
      magVar: p.magVar,
      procedures: p.procedures,
    });
    index[id] = p.procedures.length;
  }
  if (procFiles.length > 0) {
    mkdirSync(procDir, { recursive: true });
    writeFileSync(
      join(procDir, 'index.json'),
      JSON.stringify({ format: 'amg-navdata/procedures-index', version: NAVDATA_FORMAT_VERSION, cycle: cifp.cycle, airports: index }),
    );
  }
  sizes['procedures/*'] = procBytes;

  const counts = {
    airports: ap.rows.length,
    runways: ap.rows.reduce((n, r) => n + r[12].length, 0),
    navaids: navaids.length,
    localizers: localizers.length,
    markers: markers.length,
    fixes: fixes.length,
    airwaySegments: airways.length,
    procedureAirports: procFiles.length,
  };
  const meta = {
    format: 'amg-navdata/meta',
    version: NAVDATA_FORMAT_VERSION,
    generated: new Date().toISOString(),
    sources,
    counts,
    cifp: cifpMeta,
    sizes,
  };
  writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  const total = Object.values(sizes).reduce((a, b) => a + b, 0);
  for (const [k, v] of Object.entries(sizes)) log(`  ${k.padEnd(18)} ${mb(v)}`);
  log(`total ${mb(total)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  // Sanity: sample distance check so gross parse errors fail loudly.
  const jfk = ap.rows.find((r) => r[0] === 'KJFK');
  if (jfk && distNm(jfk[3], jfk[4], 40.64, -73.78) > 5) throw new Error('KJFK position sanity check failed');
}

main().catch((e) => {
  console.error('[navdata] FAILED:', e);
  process.exit(1);
});
