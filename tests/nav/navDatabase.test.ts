import { describe, it, expect, beforeAll } from 'vitest';
import { NavDatabaseImpl, headingFromRunwayIdent, decodeDataFile } from '../../src/nav/NavDatabase';
import { createFileLoader } from '../../src/nav/data/nodeLoader';
import { distanceNm } from '../../src/core/geo';
import { gzipSync } from 'node:zlib';

const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });

beforeAll(async () => {
  await db.load();
}, 60000);

describe('NavDatabase loading', () => {
  it('loads every file and reports counts', () => {
    expect(db.ready).toBe(true);
    const c = db.counts;
    expect(c.airports).toBeGreaterThan(60000);
    expect(c.navaids).toBeGreaterThan(10000);
    expect(c.fixes).toBeGreaterThan(100000);
    expect(c.airwaySegments).toBeGreaterThan(50000);
    expect(db.meta?.sources.length).toBeGreaterThanOrEqual(2);
  });

  it('decodes gzip and plain payloads', async () => {
    const text = '{"a":1}';
    expect(await decodeDataFile(new Uint8Array(gzipSync(Buffer.from(text))))).toBe(text);
    expect(await decodeDataFile(new TextEncoder().encode(text))).toBe(text);
    expect(await decodeDataFile(text)).toBe(text);
  });
});

describe('airports and runways', () => {
  it('finds KJFK with paired runway ends, ILS and frequencies', () => {
    const a = db.airport('KJFK')!;
    expect(a).toBeDefined();
    expect(a.type).toBe('large_airport');
    expect(distanceNm(a.lat, a.lon, 40.6398, -73.7789)).toBeLessThan(1);
    const r04l = a.runways.find((r) => r.ident === '04L')!;
    const r22r = a.runways.find((r) => r.ident === '22R')!;
    expect(r04l.oppositeIdent).toBe('22R');
    expect(r22r.oppositeIdent).toBe('04L');
    expect(r04l.lengthFt).toBeGreaterThan(11000);
    expect(r04l.headingTrue).toBeGreaterThan(25);
    expect(r04l.headingTrue).toBeLessThan(35);
    expect(r04l.ils?.freqMhz).toBeCloseTo(110.9, 2);
    expect(r04l.ils?.gsAngleDeg).toBeCloseTo(3.0, 1);
    // Displaced threshold moves the landing threshold down the runway.
    expect(r04l.displacedFt).toBeGreaterThan(0);
    const d = distanceNm(r04l.lat, r04l.lon, r04l.thresholdLat!, r04l.thresholdLon!) * 6076.12;
    expect(d).toBeCloseTo(r04l.displacedFt, -1);
    expect(a.frequencies.some((f) => f.type === 'TWR')).toBe(true);
    expect(a.transitionAltitudeFt).toBe(18000);
    expect(a.magVar).toBeLessThan(-10);
    expect(a.magVar).toBeGreaterThan(-15);
  });

  it('matches secondary codes (IATA, GPS code)', () => {
    expect(db.airport('JFK')?.icao).toBe('KJFK');
    expect(db.runway('KJFK', '4L')?.ident).toBe('04L');
    expect(db.runway('KJFK', 'RW04L')?.ident).toBe('04L');
  });

  it('synthesises runways for airports without surveyed coordinates', () => {
    // Find an airport whose runways have no coordinates in the source.
    let found = false;
    for (const a of db.airportsNear(39.0, -98.0, 60, 200)) {
      const est = a.runways.find((r) => r.positionEstimated);
      if (est) {
        found = true;
        expect(Number.isFinite(est.lat)).toBe(true);
        expect(Number.isFinite(est.headingTrue)).toBe(true);
        expect(distanceNm(est.lat, est.lon, a.lat, a.lon)).toBeLessThan(2);
        break;
      }
    }
    expect(found).toBe(true);
  });

  it('designator headings', () => {
    expect(headingFromRunwayIdent('09L')).toEqual({ deg: 90, isTrue: false });
    expect(headingFromRunwayIdent('36')).toEqual({ deg: 360, isTrue: false });
    expect(headingFromRunwayIdent('NE')).toEqual({ deg: 45, isTrue: true });
    expect(headingFromRunwayIdent('H1')).toBeNull();
  });

  it('airportsNear is sorted and bounded', () => {
    const near = db.airportsNear(40.85, -74.06, 15, 10);
    expect(near.length).toBe(10);
    expect(near[0].icao).toBe('KTEB');
    for (let i = 1; i < near.length; i++) {
      expect(distanceNm(40.85, -74.06, near[i].lat, near[i].lon)).toBeGreaterThanOrEqual(
        distanceNm(40.85, -74.06, near[i - 1].lat, near[i - 1].lon) - 1e-9,
      );
    }
  });

  it('searchAirports ranks exact codes and names', () => {
    expect(db.searchAirports('KTEB')[0].icao).toBe('KTEB');
    expect(db.searchAirports('LHR')[0].icao).toBe('EGLL');
    const heathrow = db.searchAirports('heathrow', 5);
    expect(heathrow.some((a) => a.icao === 'EGLL')).toBe(true);
  });
});

describe('navaids, fixes, airways', () => {
  it('VORs carry frequency, class range and station declination', () => {
    const sax = db.navaidsByIdent('SAX').find((n) => n.type === 'VORTAC' || n.type === 'VORDME');
    expect(sax).toBeDefined();
    expect(sax!.freq).toBeCloseTo(115.7, 2);
    expect(sax!.rangeNm).toBeGreaterThanOrEqual(40);
    expect(Math.abs(sax!.magVar)).toBeLessThan(20);
  });

  it('navaidsOnFreq finds the localizer, glideslope and DME of an ILS', () => {
    const rw = db.runway('KTEB', '06')!;
    const f = rw.ils!.freqMhz;
    const on = db.navaidsOnFreq(f, 40.85, -74.06, 30);
    const types = new Set(on.filter((n) => n.airport === 'KTEB').map((n) => n.type));
    expect(types.has('ILS')).toBe(true);
    expect(types.has('GS')).toBe(true);
  });

  it('fixes near a position and by ident', () => {
    const f = db.fixesByIdent('MERIT');
    expect(f.length).toBeGreaterThan(0);
    const near = db.fixesNear(f[0].lat, f[0].lon, 1);
    expect(near.some((x) => x.ident === 'MERIT')).toBe(true);
  });

  it('airway segments carry coordinates', () => {
    const j209 = db.airway('J209');
    expect(j209.length).toBeGreaterThan(3);
    for (const s of j209) {
      expect(Number.isFinite(s.fromLat!)).toBe(true);
      expect(s.high).toBe(true);
    }
    expect(db.airwaysAt('SBY')).toContain('J209');
  });
});
