import { beforeAll, it } from 'vitest';
import { NavDatabaseImpl } from '../../src/nav/NavDatabase';
import { createFileLoader } from '../../src/nav/data/nodeLoader';
import { destinationPoint, distanceNm, initialBearing, crossTrackNm } from '../../src/core/geo';
import { glideslope } from '../../src/nav/radios/geometry';
const db = new NavDatabaseImpl({ loader: createFileLoader('public/data'), magVarYear: 2026.7 });
beforeAll(async () => { await db.load(); }, 60000);
it('gs geometry', () => {
  for (const [a, rw] of [['KSFO', '28R'], ['KJFK', '04R'], ['KDEN', '16R'], ['EGLL', '27L'], ['KTEB', '19']]) {
    const ils = db.runway(a, rw)!.ils!;
    const far = destinationPoint(ils.locLat, ils.locLon, ils.courseTrue + 180, 12);
    const off = crossTrackNm(far.lat, far.lon, ils.locLat, ils.locLon, ils.gsLat!, ils.gsLon!) * 6076;
    const out = { elevationDeg: 0, dev: 0, devDeg: 0, carrier: 0, azimuthOffDeg: 0, distNm: 0 };
    let lastValidH = 0;
    for (let d = 3; d >= 0.05; d -= 0.01) {
      // on the centre line, d nm before the GS abeam point, on the 3 deg path
      const along = distanceNm(ils.locLat, ils.locLon, ils.gsLat!, ils.gsLon!);
      const p = destinationPoint(ils.locLat, ils.locLon, ils.courseTrue + 180, along + d);
      const h = (ils.gsElevFt ?? 0) + d * 6076 * Math.tan((3 * Math.PI) / 180);
      glideslope(ils.gsLat!, ils.gsLon!, ils.gsElevFt ?? 0, ils.gsAngleDeg ?? 3, ils.courseTrue, p.lat, p.lon, h, out);
      if (out.azimuthOffDeg <= 8) lastValidH = h - (ils.gsElevFt ?? 0);
    }
    console.log(a, rw, 'GS antenna lateral offset ft', off.toFixed(0), 'GS flags below (ft above GS antenna)', lastValidH.toFixed(0));
  }
});
