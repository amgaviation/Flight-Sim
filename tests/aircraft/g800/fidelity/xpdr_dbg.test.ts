import { it } from 'vitest';
import { makeRig, casTexts } from '../helpers';
import { G800_VARS as V } from '../../../../src/aircraft/g800/vars';
it('xpdr / states with avionics', { timeout: 120000 }, () => {
  for (const s of ['ready_to_taxi', 'takeoff', 'cruise', 'approach'] as const) {
    const r = makeRig(s, { avionics: true, ...(s === 'cruise' ? { weightLb: 85000, air: { altFtMsl: 41000, iasKt: 250 } } : s === 'approach' ? { weightLb: 70000, air: { altFtMsl: 2500, iasKt: 170 } } : {}) });
    const v = r.vars; r.run(3);
    console.log('[DBG]', s, 'xpdr.mode', v.get('xpdr.mode'), 'code', v.get('xpdr.code'), 'baro1', v.get('adc1.baro_inhg'), 'std', v.get('adc1.baro_std'), 'ap', v.get('ap.engaged'), 'at', v.get('ap.at_engaged'), 'fd', v.get('ap.fd1_on'), 'yd', v.get('ap.yd_engaged'), 'ecl list', v.get('epic.ecl.list'), 'lights ldg/taxi/strobe/recog/logo', v.get(V.ltLandingL), v.get(V.ltTaxi), v.get(V.ltStrobe), v.get(V.ltRecog), v.get(V.ltLogo), 'sb', v.get(V.ltSeatbelt), 'ign', v.get(V.contIgn), 'press ldg elev', v.get(V.pressLdgElev), 'CAS', JSON.stringify(casTexts(r)));
  }
});
