import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvTable, csvNumber } from '../../src/nav/data/csv';
import { arincLat, arincLon, arincMagVar, arincAltitude, arincCourse, approachRunway, routeKind, locKindFromCategory, parseCifp, CifpFixResolver, buildCifpProcedures } from '../../src/nav/data/arinc424';
import { parseNavDat, parseFixDat, parseAwyDat, splitGsField } from '../../src/nav/data/xplane';
import { normalizeSurface, serviceRangeNm, buildNavaids } from '../../src/nav/data/ourairports';
import { normRunway, matchAirport } from '../../src/nav/data/merge';
import { decodeAltitude, normalizeRunwayIdent, transitionServesRunway, approachName, decodeProcedureFile } from '../../src/nav/procedures';
import type { AirportRow } from '../../src/nav/data/format';

describe('CSV parser', () => {
  it('parses quoted fields, doubled quotes, embedded commas and newlines', () => {
    const rows = parseCsv('a,b,c\n"x, y","he said ""hi""","multi\nline"\n1,,3\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x, y', 'he said "hi"', 'multi\nline'],
      ['1', '', '3'],
    ]);
  });

  it('handles CRLF, BOM, trailing empty field and missing final newline', () => {
    expect(parseCsv('﻿id,name\r\n1,"A"\r\n2,')).toEqual([
      ['id', 'name'],
      ['1', 'A'],
      ['2', ''],
    ]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('\n\n')).toEqual([]);
  });

  it('keeps a lone empty quoted field and unicode', () => {
    expect(parseCsv('"",b\n"Zürich","São Paulo"')).toEqual([
      ['', 'b'],
      ['Zürich', 'São Paulo'],
    ]);
  });

  it('table access by header and numeric fields', () => {
    const t = parseCsvTable('"id","ident","elevation_ft"\n6523,"00A",11\n6524,"00AK",\n');
    expect(t.rows.length).toBe(2);
    expect(t.rows[0][t.col('ident')]).toBe('00A');
    expect(csvNumber(t.rows[0][t.col('elevation_ft')])).toBe(11);
    expect(csvNumber(t.rows[1][t.col('elevation_ft')])).toBeNaN();
    expect(() => t.col('nope')).toThrow();
  });
});

describe('OurAirports conversion', () => {
  it('normalises runway surfaces', () => {
    expect(normalizeSurface('ASPH-G')).toBe('A');
    expect(normalizeSurface('CONC')).toBe('C');
    expect(normalizeSurface('TURF')).toBe('G');
    expect(normalizeSurface('GRVL')).toBe('V');
    expect(normalizeSurface('GRAVEL')).toBe('V');
    expect(normalizeSurface('GRASS / SOD')).toBe('G');
    expect(normalizeSurface('WATER')).toBe('W');
    expect(normalizeSurface('DIRT')).toBe('D');
    expect(normalizeSurface('PEM')).toBe('A');
    expect(normalizeSurface('')).toBe('U');
  });

  it('service volumes follow AIM 1-1-8', () => {
    expect(serviceRangeNm('VORDME', 'BOTH', 'HIGH')).toBe(130);
    expect(serviceRangeNm('VORTAC', 'LO', 'MEDIUM')).toBe(40);
    expect(serviceRangeNm('VOR', 'TERMINAL', 'LOW')).toBe(25);
    expect(serviceRangeNm('VORDME', 'BOTH', 'LOW')).toBe(25);
    expect(serviceRangeNm('NDB', 'TERMINAL', 'LOW')).toBe(15);
    expect(serviceRangeNm('NDB', 'BOTH', 'HIGH')).toBe(75);
  });

  it('builds navaid rows with MHz / kHz and slaved variation', () => {
    const t = parseCsvTable(
      '"id","filename","ident","name","type","frequency_khz","latitude_deg","longitude_deg","elevation_ft","iso_country","dme_frequency_khz","dme_channel","dme_latitude_deg","dme_longitude_deg","dme_elevation_ft","slaved_variation_deg","magnetic_variation_deg","usageType","power","associated_airport"\n' +
        '1,"x","ABQ","Albuquerque","VORTAC",113200,35.04,-106.81,5740,"US",113200,"079X",,,,13.001,9.551,"BOTH","HIGH",\n' +
        '2,"y","GL","Aalborg","NDB",398,57.08,9.68,,"DK",,,,,,,2.1,"LO","MEDIUM",\n',
    );
    const rows = buildNavaids(t);
    expect(rows[0][2]).toBe('VORTAC');
    expect(rows[0][6]).toBeCloseTo(113.2, 6);
    expect(rows[0][8]).toBeCloseTo(13.0, 2); // slaved variation wins for VORs
    expect(rows[0][7]).toBe(130);
    expect(rows[0][15]).toBe('79X');
    expect(rows[1][6]).toBe(398);
    expect(rows[1][8]).toBeCloseTo(2.1, 6);
  });

  it('matches airports by alternate codes and position', () => {
    const rows = [
      ['KJFK', 'JFK', 'L', 40.64, -73.78, 13, 'US', '', 'JFK', 'KJFK', 'JFK', 'KJFK', [], [], null],
      ['1G4', 'Grand Canyon W', 'S', 35.99, -113.82, 4813, 'US', '', 'GCW', 'K1G4', '1G4', '', [], [], null],
    ] as unknown as AirportRow[];
    const byCode = new Map<string, number[]>([
      ['KJFK', [0]],
      ['JFK', [0]],
      ['1G4', [1]],
      ['K1G4', [1]],
      ['GCW', [1]],
    ]);
    expect(matchAirport(rows, byCode, 'K1G4', 35.99, -113.82)).toBe(1);
    expect(matchAirport(rows, byCode, 'JFK')).toBe(0);
    expect(matchAirport(rows, byCode, 'KJFK', 10, 10)).toBe(-1); // too far
    expect(normRunway('4L')).toBe('04L');
    expect(normRunway('RW09')).toBe('09');
  });
});

describe('X-Plane nav/fix/awy parsing', () => {
  it('nav.dat 810 rows', () => {
    const text = [
      'I',
      '810 Version - data cycle 2013.10, build 20131334',
      '',
      '3  40.78422200 -073.86846100     14 11380 130   -12.0 LGA  LA GUARDIA VOR-DME',
      '4  40.65099200 -073.76295000     13 11090  18      30.664 IHIQ KJFK 04L ILS-cat-I',
      '6  40.62424200 -073.78281700     10 11090  10  300030.664 IHIQ KJFK 04L GS',
      '7  40.69463900 -073.86863900     13     0   0     120.863 ---- KJFK 13L OM',
      '2  38.08777778 -077.32491667      0   396  50    0.0 APH  A P HILL NDB',
      '99',
    ].join('\n');
    const r = parseNavDat(text);
    expect(r.length).toBe(5);
    expect(r[0]).toMatchObject({ code: 3, ident: 'LGA', freq: 113.8, rangeNm: 130, extra: -12, name: 'LA GUARDIA VOR-DME' });
    expect(r[1]).toMatchObject({ code: 4, ident: 'IHIQ', airport: 'KJFK', runway: '04L', freq: 110.9 });
    expect(r[4]).toMatchObject({ code: 2, freq: 396 });
    const gs = splitGsField(r[2].extra);
    expect(gs.angleDeg).toBeCloseTo(3.0, 9);
    expect(gs.courseTrue).toBeCloseTo(30.664, 6);
  });

  it('fix.dat and awy.dat', () => {
    expect(parseFixDat('I\n600 Version\n 40.234583 -073.394378 WAVEY\n99\n')).toEqual([{ ident: 'WAVEY', lat: 40.234583, lon: -73.394378 }]);
    const a = parseAwyDat('SBY    38.345006 -075.510588 VILLS  39.301010 -075.110519 2 180 450 J209-J79\n');
    expect(a[0].names).toEqual(['J209', 'J79']);
    expect(a[0].level).toBe(2);
    expect(a[0].baseFt).toBe(18000);
    expect(a[0].topFt).toBe(45000);
  });
});

describe('ARINC 424 (FAA CIFP) decoding', () => {
  it('fields', () => {
    expect(arincLat('N40372318')).toBeCloseTo(40 + 37 / 60 + 23.18 / 3600, 9);
    expect(arincLon('W073470505')).toBeCloseTo(-(73 + 47 / 60 + 5.05 / 3600), 9);
    expect(arincLat('N4037231815')).toBeCloseTo(40 + 37 / 60 + 23.1815 / 3600, 9);
    expect(arincLon('W07347050525')).toBeCloseTo(-(73 + 47 / 60 + 5.0525 / 3600), 9);
    expect(arincLat('S3356')).toBeNaN();
    expect(arincMagVar('W0130')).toBeCloseTo(-13, 9);
    expect(arincMagVar('E0134')).toBeCloseTo(13.4, 9);
    expect(arincAltitude('FL180')).toBe(18000);
    expect(arincAltitude('05000')).toBe(5000);
    expect(arincAltitude('     ')).toBeNaN();
    expect(arincCourse('2718')).toEqual({ deg: 271.8, isTrue: false });
    expect(arincCourse('271T')).toEqual({ deg: 271, isTrue: true });
    expect(approachRunway('I06-Z')).toBe('06');
    expect(approachRunway('R04LY')).toBe('04L');
    expect(approachRunway('RNV-A')).toBe('');
    expect(routeKind('D', '4')).toBe('runway');
    expect(routeKind('D', '0')).toBeNull();
    expect(routeKind('E', '3')).toBe('runway');
    expect(routeKind('F', 'A')).toBe('transition');
    expect(routeKind('F', 'R')).toBe('final');
    expect(locKindFromCategory('3')).toEqual({ kind: 'ILS', hasGs: true, category: 'III' });
    expect(locKindFromCategory('0').kind).toBe('LOC');
  });

  it('parses real records into procedures', () => {
    const lines = [
      'HDR04                                 CODED INSTRUMENT FLIGHT PROCEDURES VOLUME 2609  EFFECTIVE 03 SEP 2026                         ',
      'SUSAP KTEBK6ATEB     0     069YHN40510037W074033900W012000008         1800018000C    MNAR    TETERBORO                     291552504',
      'SUSAP KTEBK6GRW06    0070000600 N40504820W074041310         -0030500009000055150R                                          294962601',
      'SUSAP KTEBK6CVINGS K60    W     N40423670W074161250                       W0126     NAR           VINGS                    293222308',
      'SUSAP KTEBK6CTORBY K60    W     N40480000W074080250                       W0126     NAR           TORBY                    293222308',
      'SUSAP KTEBK6FR06-Y R      010VINGSK6PC0E  I    IF                                   02000     18000                 A JS   294502601',
      'SUSAP KTEBK6FR06-Y R      020TORBYK6PC1E  F 010TF                                 + 01300                 RW06  K6PGA JS   294532405',
      'SUSAP KTEBK6FR06-Y R      020TORBYK6PC2WALPV       N          ALNAV                                                   JS   294542405',
      'SUSAP KTEBK6FR06-Y R      030RW06 K6PG0GY M 031TF                                   00058             -300          A JS   294552204',
      'SUSAP KTEBK6FR06-Y R      040         0  M     CA                     0601        + 01000                           A JS   294562308',
      'SUSAP KTEBK6FR06-Y R      070VINGSK6PC0EE  R   HM                     27180040    + 03000                           A JS   294592308',
    ].map((l) => l.padEnd(132, ' '));
    const d = parseCifp(lines.join('\n'));
    expect(d.cycle).toBe('2609');
    expect(d.airports.get('KTEB')!.magVar).toBeCloseTo(-12, 6);
    expect(d.airports.get('KTEB')!.transitionAltFt).toBe(18000);
    expect(d.runways.get('KTEB|RW06')!.thresholdElevFt).toBe(9);
    expect(d.procedures.length).toBe(5); // continuation record skipped
    const res = new CifpFixResolver(d);
    const procs = buildCifpProcedures(d, res);
    const p = procs.get('KTEB')!.procedures[0];
    expect(p.ident).toBe('R06-Y');
    expect(p.rw).toBe('06');
    const legs = p.routes[0].legs;
    expect(legs[0]).toMatchObject({ t: 'IF', f: 'VINGS', ad: '@', a1: 2000 });
    expect(legs[1]).toMatchObject({ t: 'TF', f: 'TORBY', ad: '+', a1: 1300, w: 'E  F' });
    expect(legs[2]).toMatchObject({ t: 'TF', f: 'RW06', fk: 'R', fo: 1, va: -3 });
    expect(legs[3]).toMatchObject({ t: 'CA', c: 60.1, a1: 1000 });
    expect(legs[4]).toMatchObject({ t: 'HM', td: 'R', c: 271.8, d: 4 });
    expect(res.unresolved).toBe(0);
    // Decoded into the typed model: final legs up to the MAP, then the missed approach.
    const file = { format: 'amg-navdata/procedures' as const, version: 1, icao: 'KTEB', cifpIdent: 'KTEB', cycle: '2609', magVar: -12, procedures: procs.get('KTEB')!.procedures };
    const ap = decodeProcedureFile(file, 'KTEB');
    const r = ap.approaches[0];
    expect(r.name).toBe('RNAV (GPS) Y RWY 06');
    expect(r.finalLegs.length).toBe(3);
    expect(r.missedLegs.length).toBe(2);
    expect(r.finalLegs[1].faf).toBe(true);
    expect(r.finalLegs[2].map).toBe(true);
    expect(r.finalLegs[2].verticalAngleDeg).toBe(3);
    expect(r.missedLegs[0].missedStart).toBe(true);
    expect(r.glidepathDeg).toBe(3);
  });

  it('altitude descriptions and runway helpers', () => {
    expect(decodeAltitude('+', 3000, undefined)).toMatchObject({ kind: 'atOrAbove', lowerFt: 3000 });
    expect(decodeAltitude('-', 5000, undefined)).toMatchObject({ kind: 'atOrBelow', upperFt: 5000 });
    expect(decodeAltitude('B', 9000, 7000)).toMatchObject({ kind: 'between', lowerFt: 7000, upperFt: 9000 });
    expect(decodeAltitude('@', 2000, undefined)).toMatchObject({ kind: 'at', lowerFt: 2000, upperFt: 2000 });
    expect(decodeAltitude('G', 1800, 1800)).toMatchObject({ kind: 'at', glideslopeFt: 1800 });
    expect(decodeAltitude('+', undefined, undefined)).toBeUndefined();
    expect(normalizeRunwayIdent('RW4L')).toBe('04L');
    expect(transitionServesRunway('04B', '04R')).toBe(true);
    expect(transitionServesRunway('ALL', '22')).toBe(true);
    expect(transitionServesRunway('04L', '04R')).toBe(false);
    expect(approachName('R', 'R04LY', '04L')).toBe('RNAV (GPS) Y RWY 04L');
    expect(approachName('V', 'VOR-A', '')).toBe('VOR-A');
  });
});
