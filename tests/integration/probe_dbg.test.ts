import { beforeAll, it } from 'vitest';
import { NavDatabaseImpl } from '../../src/nav/NavDatabase';
import { createFileLoader } from '../../src/nav/data/nodeLoader';
import { destinationPoint, distanceNm } from '../../src/core/geo';
import { glidePathAbeamAlongNm, locDeviation, FT_PER_NM } from '../../src/nav/radios/geometry';
const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
beforeAll(async () => { await db.load(); }, 60000);
it('dbg', () => {
  const ils = db.runway('EGLL', '27L')!.ils!;
  const abeam = glidePathAbeamAlongNm(ils.locLat, ils.locLon, ils.courseTrue, ils.gsLat!, ils.gsLon!);
  const p = destinationPoint(ils.locLat, ils.locLon, ils.courseTrue + 180, abeam + 0.3);
  const out: any[] = [];
  (db as any).collectOnFreq(ils.freqMhz, p.lat, p.lon, 40, out);
  for (const n of out) {
    const d: any = {};
    locDeviation(n.lat, n.lon, n.courseTrue ?? 0, p.lat, p.lon, d);
    console.log(n.ident, n.type, n.airport, n.runway, n.elevationFt, 'dist', d.distNm.toFixed(2), 'back', d.backCourse, 'off', d.offCourseDeg.toFixed(1));
  }
});
