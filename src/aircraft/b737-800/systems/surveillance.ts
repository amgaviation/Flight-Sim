/**
 * Boeing 737-800 surveillance and radio audio glue (FCOM 5.10 "Communications", 11.30 / 15 "Weather radar",
 * 15.20 "TCAS"):
 *
 *  - `B738TcasDisplay` (runs after the TCAS block): the traffic list the NDs draw. ABOVE / NORM / BELOW
 *    limit the displayed altitude band of non-threat traffic (NORM +/-2,700 ft, ABOVE +9,900 / -2,700 ft,
 *    BELOW +2,700 / -9,900 ft; TAs and RAs are always shown). The TEST position of the ATC/TCAS mode
 *    selector runs the ~8 s TCAS self test: the ND shows TCAS TEST and the test pattern, then the aural
 *    "TCAS SYSTEM TEST OK" (FCOM 15.20).
 *  - `createWxrOverlay` (ND weather hook): procedural precipitation returns from the environment
 *    (env.precip / env.cloud_cover), shaped by the WXR panel: TILT masks the returns by beam elevation
 *    (3.5 deg pencil beam, 4/3-earth curvature), GAIN scales the displayed reflectivity (mid position =
 *    calibrated), WX+T adds magenta turbulence within 40 nm, MAP shows ground returns, TEST draws the
 *    test pattern. Nothing is drawn unless the radar is active (`wxr.active`, logic.ts); 'WXR FAIL' when
 *    WXR is selected without a working radar.
 *  - `B738RadioAudio` (runs after the avionics suite): the audio control panel mixer to the headset:
 *    marker beacon tones (MKR receiver level), the Morse idents of VHF NAV 1 / 2 and ADF 1 / 2 (receiver
 *    level, V/B/R filter: V = voice only removes the ident, B = both, R = range / ident only; ALT-NORM at
 *    ALT = degraded mode: receivers lost on that ACP), ADF TONE (BFO: continuous beat tone), the VHF NAV
 *    TEST (self test: LOC / GS pointers to the test deflection while held) and the TAT probe TEST
 *    (aspirated probe: the indicated TAT rises on the ground).
 *
 * SCOPE: no radar beam physics beyond the geometric tilt mask; no voice (ATIS) or COM audio; the
 * NAV TEST deflection is EST (one dot fly-right / fly-up).
 */
import type { SimContext, AudioApi } from '../../../core/SimContext';
import type { Subsystem } from '../../types';
import type { Tcas } from '../../../systems/warning';
import type { NdWeatherOverlay } from '../../../avionics/boeing-737';
import { ADC, NAV } from '../../../core/vars';
import { B738 } from '../vars';

// ---------------------------------------------------------------------------------------------- TCAS display

interface DispThreat {
  relBrgDeg: number;
  rangeNm: number;
  relAltFt: number;
  vsSign: number;
  level: number;
}

/**
 * TCAS test pattern (the standard TCAS II self-test display): RA (red square) at 3 o'clock 2 nm, 200 ft above;
 * TA (amber circle) at 9 o'clock 2 nm, 200 ft below; proximate traffic (filled diamond) at 1 o'clock 3.6 nm,
 * 1,000 ft below, descending; other traffic (open diamond) at 11 o'clock 3.6 nm, 1,000 ft above, climbing
 * (Honeywell / Collins TCAS II pilot guides "Self test"; EST for the exact figures on the NG CDS).
 */
const TEST_PATTERN: readonly DispThreat[] = [
  { relBrgDeg: 90, rangeNm: 2, relAltFt: 200, vsSign: 0, level: 3 },
  { relBrgDeg: -90, rangeNm: 2, relAltFt: -200, vsSign: 0, level: 2 },
  { relBrgDeg: 30, rangeNm: 3.6, relAltFt: -1000, vsSign: -1, level: 1 },
  { relBrgDeg: -30, rangeNm: 3.6, relAltFt: 1000, vsSign: 1, level: 0 },
];
/** Self-test duration (s), EST ~8 s (FCOM: "the test lasts approximately 8 seconds"). */
export const TCAS_TEST_S = 8;

export class B738TcasDisplay implements Subsystem {
  readonly name = 'b738.tcas_display';
  /** Filtered traffic for the NDs (reused array, B737TrafficSource). */
  readonly threats: DispThreat[] = [];
  private testT = -1;
  private prevSw = false;

  constructor(
    private readonly vars: SimContext['vars'],
    private readonly audio: AudioApi | undefined,
    private readonly tcas: Tcas,
  ) {}

  update(dt: number): void {
    const v = this.vars;
    const sw = v.get('ac.b738.tcas_test_sw') !== 0;
    if (sw && !this.prevSw && this.testT < 0 && v.get('tcas.ra') === 0) this.testT = 0;
    this.prevSw = sw;
    this.threats.length = 0;
    if (this.testT >= 0) {
      this.testT += dt;
      if (this.testT >= TCAS_TEST_S) {
        this.testT = -1;
        const ok = v.get('fail.tcas') === 0;
        this.audio?.callout(ok ? 'TCAS SYSTEM TEST OK' : 'TCAS SYSTEM TEST FAIL', 5);
        v.set('tcas.test_result', ok ? 1 : -1);
      } else {
        for (const t of TEST_PATTERN) this.threats.push(t);
        v.setString('tcas.status', 'TCAS TEST');
      }
    }
    v.set('tcas.test', this.testT >= 0 ? 1 : 0);
    if (this.testT >= 0) return;
    const above = v.get('tcas.band_above_ft', 2700);
    const below = v.get('tcas.band_below_ft', 2700);
    for (const t of this.tcas.threats) {
      if (t.level < 2 && Number.isFinite(t.relAltFt) && (t.relAltFt > above || t.relAltFt < -below)) continue;
      this.threats.push(t);
    }
  }

  reset(): void {
    this.testT = -1;
    this.prevSw = this.vars.get('ac.b738.tcas_test_sw') !== 0;
  }
}

// ---------------------------------------------------------------------------------------------- weather radar

const WX_MAX = 256;
/** Antenna half beam width (deg): 3.5 deg pencil beam of a 30-in flat plate at X band (EST). */
const HALF_BEAM_DEG = 1.75;
/** Scan sector half angle (deg): +/-90 deg (EST: 180 deg scan). */
const SCAN_DEG = 90;
/** Turbulence detection range in WX+T (nm), FCOM: 40 nm. */
const TURB_NM = 40;
/** ND reflectivity colours: green, yellow, red, magenta (turbulence / MAP strongest). */
const WX_COL = ['', 'rgba(0,200,0,0.85)', 'rgba(230,220,0,0.9)', 'rgba(230,0,0,0.9)', 'rgba(230,0,230,0.9)'];

function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Weather radar returns for the ND weather hook (see the file header). */
export function createWxrOverlay(ctx: Pick<SimContext, 'vars' | 'world'>): NdWeatherOverlay {
  const v = ctx.vars;
  const lat = new Float64Array(WX_MAX);
  const lon = new Float64Array(WX_MAX);
  const rad = new Float32Array(WX_MAX);
  const inten = new Float32Array(WX_MAX);
  const top = new Float32Array(WX_MAX);
  let n = 0;
  let frames = 0;
  let groundFt = 0;
  const build = (la0: number, lo0: number): void => {
    const precip = Math.max(0, Math.min(1, v.get('env.precip')));
    const cover = Math.max(0, Math.min(1, v.get('env.cloud_cover')));
    n = 0;
    const sp = 0.25; // grid (deg), ~15 nm
    const cosLat = Math.max(0.1, Math.cos((la0 * Math.PI) / 180));
    const span = 330 / 60;
    for (let i = Math.floor((la0 - span) / sp); i <= Math.ceil((la0 + span) / sp); i++)
      for (let j = Math.floor((lo0 - span / cosLat) / sp); j <= Math.ceil((lo0 + span / cosLat) / sp); j++) {
        if (hash(i, j) > precip * (0.25 + 0.35 * cover)) continue;
        const blobs = 3 + Math.floor(hash(j + 17, i - 5) * 4);
        for (let b = 0; b < blobs && n < WX_MAX; b++) {
          const k = n++;
          lat[k] = (i + 0.5 + (hash(i * 13 + b * 7, j * 5 - b * 3) - 0.5) * 0.7) * sp;
          lon[k] = (j + 0.5 + (hash(j * 11 - b, i * 3 + b * 17) - 0.5) * 0.7) * sp;
          rad[k] = 2 + 5 * hash(i + b * 31, j - b * 7);
          inten[k] = Math.min(1, precip * (0.4 + 0.8 * hash(i * 7 + b, j * 3 + b * 5)));
          // Cell tops (ft): EST 18,000-42,000 ft (stratiform to convective).
          top[k] = 18000 + 24000 * hash(i - b * 11, j + b * 13) * (0.5 + 0.5 * precip);
        }
      }
    try {
      groundFt = (ctx.world ? ctx.world.elevationAt(la0, lo0) : 0) * 3.28084;
    } catch {
      groundFt = 0;
    }
  };

  return (c2, geo) => {
    const active = v.get('wxr.active') !== 0;
    if (!active) return;
    const mode = Math.round(v.get(B738.wxrMode));
    const { cx, cy, pxPerNm, upDeg, rangeNm } = geo;
    const hdgT = v.get('ahrs1.hdg_true_deg', v.get('irs1.hdg_true_deg'));
    if (mode === 3) {
      // TEST: concentric green / yellow / red / magenta bands over the scan sector.
      const r0 = rangeNm * pxPerNm;
      for (let b = 0; b < 4; b++) {
        c2.fillStyle = WX_COL[b + 1];
        c2.beginPath();
        const a0 = ((hdgT - SCAN_DEG - upDeg - 90) * Math.PI) / 180;
        const a1 = ((hdgT + SCAN_DEG - upDeg - 90) * Math.PI) / 180;
        c2.arc(cx, cy, r0 * (0.5 + 0.12 * (b + 1)), a0, a1);
        c2.arc(cx, cy, r0 * (0.5 + 0.12 * b), a1, a0, true);
        c2.closePath();
        c2.fill();
      }
      return;
    }
    const la0 = v.get('gps.lat_deg');
    const lo0 = v.get('gps.lon_deg');
    // Returns rebuilt about once a second (the overlay is drawn at the display rate, <= 30 Hz).
    if (frames++ % 30 === 0) build(la0, lo0);
    const alt = v.get('adc1.press_alt_ft');
    const tilt = v.get(B738.wxrTilt);
    const gain = v.get(B738.wxrGain, 0.5);
    const gk = Math.pow(2, (gain - 0.5) * 3); // mid = calibrated; +/- ~2.8x at the stops (EST)
    const tanLo = Math.tan(((tilt - HALF_BEAM_DEG) * Math.PI) / 180);
    const tanHi = Math.tan(((tilt + HALF_BEAM_DEG) * Math.PI) / 180);
    const cosLat = Math.max(0.1, Math.cos((la0 * Math.PI) / 180));
    const beamAt = (rNm: number, tn: number): number => alt + rNm * 6076 * tn - 0.662 * rNm * rNm;
    // Ground returns: MAP mode, and ground clutter in WX / WX+T where the beam hits the ground.
    const gScale = mode === 2 ? 1 : 0.5;
    for (let ri = 1; ri <= 24; ri++) {
      const r = (ri / 24) * rangeNm;
      if (beamAt(r, tanLo) > groundFt) continue;
      for (let ai = -SCAN_DEG; ai <= SCAN_DEG; ai += 5) {
        const hv = hash(Math.round(la0 * 20) + ri * 7 + ai, Math.round(lo0 * 20) + ai * 3);
        const lvl = Math.min(4, Math.floor(hv * 3.2 * gk * gScale + (mode === 2 ? 0.6 : 0)));
        if (lvl < 1) continue;
        c2.fillStyle = WX_COL[mode === 2 && lvl >= 3 ? 4 : Math.min(3, lvl)];
        const a = ((hdgT + ai - upDeg) * Math.PI) / 180;
        const px = cx + Math.sin(a) * r * pxPerNm;
        const py = cy - Math.cos(a) * r * pxPerNm;
        const s = Math.max(2, (rangeNm / 24) * pxPerNm * 0.8);
        c2.fillRect(px - s / 2, py - s / 2, s, s);
      }
    }
    if (mode === 2) return;
    for (let lvl = 1; lvl <= 4; lvl++) {
      c2.fillStyle = WX_COL[lvl];
      c2.beginPath();
      for (let k = 0; k < n; k++) {
        const dy = (lat[k] - la0) * 60;
        const dx = (lon[k] - lo0) * 60 * cosLat;
        const r = Math.hypot(dx, dy);
        if (r > rangeNm + rad[k] || r < 0.5) continue;
        const brg = (Math.atan2(dx, dy) * 180) / Math.PI;
        let rel = brg - hdgT;
        rel = ((((rel + 180) % 360) + 360) % 360) - 180;
        if (Math.abs(rel) > SCAN_DEG) continue;
        // Tilt mask: the beam must intersect the cell between the ground and the cell top.
        const lo = beamAt(r, tanLo);
        const hi = beamAt(r, tanHi);
        if (lo > top[k] || hi < groundFt) continue;
        const fill = Math.min(1, (top[k] - lo) / Math.max(1, hi - lo));
        const z = inten[k] * gk * fill;
        const zl = z > 0.7 ? 3 : z > 0.42 ? 2 : z > 0.18 ? 1 : 0;
        const turb = mode === 1 && zl >= 3 && r < TURB_NM;
        const l = turb ? 4 : zl;
        if (l < lvl || (lvl === 4 && !turb)) continue;
        const a = ((brg - upDeg) * Math.PI) / 180;
        const px = cx + Math.sin(a) * r * pxPerNm;
        const py = cy - Math.cos(a) * r * pxPerNm;
        const rr = rad[k] * pxPerNm * (1 - 0.18 * (lvl - 1));
        c2.moveTo(px + rr, py);
        c2.arc(px, py, rr, 0, Math.PI * 2);
      }
      c2.fill();
    }
  };
}

// ---------------------------------------------------------------------------------------------- radio audio

/** Morse dot (s) at ~7 wpm (PARIS: 1.2 s / wpm; AIM 1-1-3 "about 7 words per minute"), repeat periods EST. */
const DOT_S = 1.2 / 7;
const IDENT_PERIOD_S = { vor: 10, ndb: 8 } as const;
/** Headset level of an ident at full receiver volume (EST mix level). */
const IDENT_GAIN = 0.25;

/** True while the key is down `t` s into a Morse pattern ('.', '-', ' ' between letters). */
export function morseKey(pattern: string, t: number, dot = DOT_S): boolean {
  let at = 0;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern.charCodeAt(i);
    if (c === 32) {
      at += 2 * dot;
      continue;
    }
    const on = c === 45 ? 3 * dot : dot;
    if (t >= at && t < at + on) return true;
    at += on + dot;
    if (t < at) return false;
  }
  return false;
}

type Loop = ReturnType<AudioApi['loop']>;

interface IdentCh {
  rx: 'nav1' | 'nav2' | 'adf1' | 'adf2';
  morse: string;
  valid: string;
  bfo: string | null;
  period: number;
  t: number;
  loop: Loop | null;
  gain: number;
  out: string;
  lvl: string[];
}

/** NAV TEST deflection (fraction of full scale; 0.5 = one dot), EST. */
const NAV_TEST_DEFL = 0.5;
/** TAT TEST (aspirated probe on the ground): rise of the indicated TAT (degC) and time constant (s), EST. */
const TAT_TEST = { riseC: 12, tauS: 8 };
const ACP_DEGRADED = [1, 2, 3].map((a) => `ac.b738.acp${a}.degraded`);
const ACP_FILTER = [1, 2, 3].map((a) => `ac.b738.acp${a}.filter`);
const COM_ACTIVE = [NAV.comActive(1), NAV.comActive(2)];
const COM_PWR = ['com1.powered', 'com2.powered'];
const ACP_VHF_LVL = [1, 2].map((r) => [1, 2, 3].map((a) => `ac.b738.acp${a}.lvl_vhf${r}`));
const ADC_TAT = [ADC.tat(1), ADC.tat(2)];
const ADC_VALID = [ADC.valid(1), ADC.valid(2)];
const NAV_TEST = [1, 2].map((r) => ({ test: `nav${r}.test`, cdi: NAV.cdi(r), gs: NAV.gsDev(r), loc: NAV.isLoc(r) }));

export class B738RadioAudio implements Subsystem {
  readonly name = 'b738.radio_audio';
  private readonly ch: IdentCh[];
  private loopsTried = false;
  private readonly mk = [false, false, false];
  private tatBias = 0;
  private eltOn = false;

  constructor(
    private readonly vars: SimContext['vars'],
    private readonly audio: AudioApi | undefined,
  ) {
    const mk = (rx: IdentCh['rx'], morse: string, valid: string, bfo: string | null, period: number): IdentCh => ({
      rx,
      morse,
      valid,
      bfo,
      period,
      t: 0,
      loop: null,
      gain: 0,
      out: `ac.b738.ident_${rx}`,
      lvl: [1, 2, 3].map((a) => `ac.b738.acp${a}.lvl_${rx}`),
    });
    this.ch = [
      mk('nav1', NAV.morse(1), NAV.received(1), null, IDENT_PERIOD_S.vor),
      mk('nav2', NAV.morse(2), NAV.received(2), null, IDENT_PERIOD_S.vor),
      mk('adf1', NAV.adfMorse(1), NAV.adfValid(1), 'adf1.bfo', IDENT_PERIOD_S.ndb),
      mk('adf2', NAV.adfMorse(2), NAV.adfValid(2), 'adf2.bfo', IDENT_PERIOD_S.ndb),
    ];
  }

  /** Receiver level heard: the loudest ACP with the receiver on, the filter not at V, and not in ALT (degraded). */
  private level(c: IdentCh): number {
    const v = this.vars;
    let l = 0;
    for (let a = 0; a < 3; a++) {
      if (v.get(ACP_DEGRADED[a]) !== 0) continue;
      if (v.get(ACP_FILTER[a]) <= -0.5) continue; // V: voice only, ident filtered out
      const x = v.get(c.lvl[a]);
      if (x > l) l = x;
    }
    return l;
  }

  update(dt: number): void {
    const v = this.vars;
    if (!this.loopsTried && this.audio) {
      this.loopsTried = true;
      for (const c of this.ch) {
        try {
          c.loop = this.audio.loop('ident.1020');
        } catch {
          c.loop = null;
        }
      }
    }
    // ---- Idents (and ADF BFO tone).
    for (const c of this.ch) {
      c.t += dt;
      if (c.t >= c.period) c.t -= c.period;
      const lvl = v.get(c.valid) !== 0 ? this.level(c) : 0;
      const bfo = c.bfo !== null && v.get(c.bfo) !== 0;
      const pat = lvl > 0 ? v.getString(c.morse) : '';
      const key = bfo ? lvl > 0 : pat !== '' && morseKey(pat, c.t);
      const g = key ? lvl * IDENT_GAIN : 0;
      v.set(c.out, g);
      if (g !== c.gain) {
        c.gain = g;
        c.loop?.setGain(g);
      }
    }
    // ---- Marker beacon tones: the MKR receiver level (logic.ts nav.marker_volume) with any ACP not degraded.
    const mkrOn = v.get('nav.marker_volume') > 0.05 && v.get(NAV.markerPowered, 1) !== 0;
    this.tone(0, 'marker_outer', mkrOn && v.get(NAV.markerOuter) !== 0);
    this.tone(1, 'marker_middle', mkrOn && v.get(NAV.markerMiddle) !== 0);
    this.tone(2, 'marker_inner', mkrOn && v.get(NAV.markerInner) !== 0);
    v.set('ac.b738.marker_audio', this.mk[0] || this.mk[1] || this.mk[2] ? 1 : 0);
    // ---- ELT transmitting (logic.ts): heard as the swept tone on a VHF tuned to 121.5 MHz with its receiver level up
    // (the ramp / pre-flight ELT check). SCOPE: 406 MHz signal and SAR reception are not modelled.
    let elt = false;
    if (v.get('ac.b738.elt_transmitting') !== 0) {
      for (let r = 0; r < 2; r++) {
        if (Math.abs(v.get(COM_ACTIVE[r]) - 121.5) > 0.004 || v.get(COM_PWR[r]) === 0) continue;
        for (let a = 0; a < 3; a++) if (v.get(ACP_VHF_LVL[r][a]) > 0.05) elt = true;
      }
    }
    if (elt !== this.eltOn) {
      this.eltOn = elt;
      this.audio?.tone('elt.sweep', elt);
    }
    v.set('ac.b738.elt_audio', elt ? 1 : 0);
    // ---- VHF NAV TEST (held): LOC / GS pointers to the test deflection (EST: one dot fly right / fly up).
    for (const n of NAV_TEST) {
      if (v.get(n.test) === 0) continue;
      v.set(n.cdi, NAV_TEST_DEFL);
      if (v.get(n.loc) !== 0) v.set(n.gs, NAV_TEST_DEFL);
    }
    // ---- TAT TEST: aspirated probe (ground only; logic.ts tat_test_active) raises the indicated TAT.
    const tgt = v.get('ac.b738.tat_test_active') !== 0 ? TAT_TEST.riseC : 0;
    this.tatBias += (tgt - this.tatBias) * (1 - Math.exp(-dt / TAT_TEST.tauS));
    if (this.tatBias > 0.01) {
      for (let k = 0; k < 2; k++) if (v.get(ADC_VALID[k]) !== 0) v.set(ADC_TAT[k], v.get(ADC_TAT[k]) + this.tatBias);
    }
    v.set('ac.b738.tat_test_bias_c', this.tatBias);
  }

  private tone(i: number, id: string, on: boolean): void {
    if (this.mk[i] === on) return;
    this.mk[i] = on;
    this.audio?.tone(id, on);
  }

  dispose(): void {
    for (const c of this.ch) c.loop?.stop();
  }
}
