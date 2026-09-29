/**
 * Read-only auditor probe: QRH 2.7 OFF SCHED DESCENT — "Not landing at airport
 * of departure: FLT ALT indicator ... Reset to actual airplane altitude."
 * The light should extinguish once FLT ALT is reset. Logs actual behaviour.
 */
import { describe, it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { B738 } from '../../../../src/aircraft/b737-800/vars';
import { makeB738 } from '../helpers';

const log = (...a: unknown[]) => appendFileSync('/tmp/ref/b737/offsched.log', a.map(String).join(' ') + '\n');

describe('off sched descent probe', () => {
  it('light after FLT ALT reset to actual altitude', () => {
    const r = makeB738({ state: 'cruise', air: { altFtMsl: 32000, iasKt: 270 } });
    const v = r.vars;
    r.run(5);
    v.set(B738.fltAltFt, 35000); // preflight FLT ALT above the actual cruise level
    r.run(2);
    // Descend well below the max altitude reached (reposition, then settle).
    r.fdm.reposition({ lat: v.get('fdm.lat_deg') || 40.85, lon: v.get('fdm.lon_deg') || -74.06, altFtMsl: 25000, iasKt: 280, headingTrue: 6 });
    r.run(10);
    log('after descent: off_sched', v.get('ac.b738.off_sched_descent'), 'light', v.get(B738.lt.offSchedDescent), 'MC', v.get(B738.lt.masterCaution));
    // QRH step: FLT ALT reset to actual airplane altitude.
    v.set(B738.fltAltFt, 25000);
    r.run(5);
    log('after FLT ALT reset: off_sched', v.get('ac.b738.off_sched_descent'), 'light', v.get(B738.lt.offSchedDescent));
  });
});
