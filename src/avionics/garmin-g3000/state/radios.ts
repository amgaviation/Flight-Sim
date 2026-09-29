/**
 * Radio tuning rules for the GTC: COM (25 kHz and 8.33 kHz channels), NAV,
 * ADF and transponder codes. Pure functions, unit tested
 * (tests/avionics/garmin-g3000/radios.test.ts).
 *
 * Sources:
 *  - VHF COM band 118.000-136.975 MHz (25 kHz) / 118.000-136.990 (8.33 kHz
 *    channel names), ICAO Annex 10 Vol V §4.1.2; Garmin G3000 PG 190-02046-01
 *    §4.2 "COM Frequency Tuning": large knob MHz, small knob kHz, push = swap
 *    (transfer) active/standby; COM channel spacing 25 or 8.33 kHz selectable.
 *  - VHF NAV 108.00-117.95 MHz in 50 kHz steps (ICAO Annex 10 Vol I §3.3).
 *  - ADF 190-1799.5 kHz in 0.5 kHz steps (G3000 PG §4.3 "ADF/DME Tuning").
 *  - Mode A/C codes: four octal digits 0000-7777; VFR code 1200 (US);
 *    IDENT (SPI) is transmitted for about 18 s (DO-181E §2.2.19: 18 ± 1 s).
 */

export const COM_MIN_MHZ = 118.0;
export const COM_MAX_MHZ_25 = 136.975;
export const COM_MAX_MHZ_833 = 136.99;
export const NAV_MIN_MHZ = 108.0;
export const NAV_MAX_MHZ = 117.95;
export const ADF_MIN_KHZ = 190;
export const ADF_MAX_KHZ = 1799.5;
/** Seconds the IDENT (SPI) pulse is transmitted (DO-181E 18 ± 1 s). */
export const IDENT_S = 18;
export const VFR_CODE = 1200;

/** kHz offsets (within one 25 kHz block) of 8.33 kHz channel NAMES: .000 .005 .010 .015 (the 25 kHz channel is .000). */
const CH833 = [0, 5, 10, 15];

function wrap(v: number, lo: number, hi: number): number {
  const span = hi - lo + 1;
  return ((((v - lo) % span) + span) % span) + lo;
}

/** Integer kHz of a MHz value (avoids float drift). */
function khz(mhz: number): number {
  return Math.round(mhz * 1000);
}

/**
 * Steps a COM frequency with the large (MHz) or small (kHz) knob. MHz wraps
 * 118..136; kHz wraps inside the current MHz. `spacing833` steps through the
 * 8.33 kHz channel names, otherwise 25 kHz channels.
 */
export function stepCom(mhz: number, clicks: number, knob: 'outer' | 'inner', spacing833 = false): number {
  let k = khz(Number.isFinite(mhz) && mhz >= COM_MIN_MHZ ? mhz : COM_MIN_MHZ);
  const whole = Math.floor(k / 1000);
  let frac = k - whole * 1000;
  if (knob === 'outer') {
    const w = wrap(whole + clicks, 118, 136);
    k = w * 1000 + frac;
    return k / 1000;
  }
  if (!spacing833) {
    let ch = Math.round(frac / 25);
    ch = wrap(ch + clicks, 0, 39);
    frac = ch * 25;
  } else {
    // 160 channel names per MHz: 40 blocks x 4 names.
    const block = Math.floor(frac / 25);
    const within = frac - block * 25;
    let idx = block * 4 + Math.max(0, CH833.indexOf(within));
    idx = wrap(idx + clicks, 0, 159);
    frac = Math.floor(idx / 4) * 25 + CH833[idx % 4];
  }
  return (whole * 1000 + frac) / 1000;
}

/** True when `mhz` is a valid COM channel (name) for the spacing. */
export function isValidCom(mhz: number, spacing833 = false): boolean {
  const k = khz(mhz);
  if (k < 118000) return false;
  if (k > (spacing833 ? 136990 : 136975)) return false;
  const within = (k % 1000) % 25;
  return spacing833 ? CH833.includes(within) : within === 0;
}

/**
 * Parses COM keypad digits ("12345" -> 123.450, "1182" -> 118.200, "118275" -> 118.275).
 * Returns NaN if the result is not a valid channel.
 */
export function parseComDigits(digits: string, spacing833 = false): number {
  const d = digits.replace(/[^0-9]/g, '');
  if (d.length < 3) return NaN;
  const mhzPart = Number(d.slice(0, 3));
  const fd = d.slice(3);
  let frac: number;
  if (fd.length <= 2) {
    // 25 kHz channels are displayed with two decimals: "123.47" is the channel 123.475,
    // so two typed kHz digits ending in 2 or 7 complete with a 5.
    const two = Number((fd + '00').slice(0, 2));
    frac = two * 10 + (!spacing833 && (two % 10 === 2 || two % 10 === 7) ? 5 : 0);
  } else frac = Number(fd.slice(0, 3));
  const mhz = mhzPart + frac / 1000;
  return isValidCom(mhz, spacing833) ? Math.round(mhz * 1000) / 1000 : NaN;
}

/** Steps a NAV frequency: MHz wraps 108..117, kHz in 50 kHz steps wraps 00..95. */
export function stepNav(mhz: number, clicks: number, knob: 'outer' | 'inner'): number {
  let c = Math.round((Number.isFinite(mhz) && mhz >= NAV_MIN_MHZ ? mhz : NAV_MIN_MHZ) * 100);
  const whole = Math.floor(c / 100);
  let frac = c - whole * 100;
  if (knob === 'outer') {
    c = wrap(whole + clicks, 108, 117) * 100 + frac;
  } else {
    frac = wrap(Math.round(frac / 5) + clicks, 0, 19) * 5;
    c = whole * 100 + frac;
  }
  return c / 100;
}

export function isValidNav(mhz: number): boolean {
  const c = Math.round(mhz * 100);
  return c >= 10800 && c <= 11795 && c % 5 === 0;
}

/** "11090" -> 110.90, "1109" -> 110.90, "11175" -> 111.75. NaN when invalid. */
export function parseNavDigits(digits: string): number {
  const d = digits.replace(/[^0-9]/g, '');
  if (d.length < 3) return NaN;
  const mhz = Number(d.slice(0, 3)) + Number((d.slice(3) + '00').slice(0, 2)) / 100;
  return isValidNav(mhz) ? Math.round(mhz * 100) / 100 : NaN;
}

/** Steps an ADF frequency: outer 100 kHz, inner 0.5 kHz (clamped to the band). */
export function stepAdf(khzValue: number, clicks: number, knob: 'outer' | 'inner'): number {
  const v = Number.isFinite(khzValue) && khzValue >= ADF_MIN_KHZ ? khzValue : ADF_MIN_KHZ;
  const step = knob === 'outer' ? 100 : 0.5;
  return Math.min(ADF_MAX_KHZ, Math.max(ADF_MIN_KHZ, Math.round((v + clicks * step) * 2) / 2));
}

/** "3505" -> 350.5 ("3505" means 350.5 kHz), "1799" -> 1799. */
export function parseAdfDigits(digits: string): number {
  const d = digits.replace(/[^0-9.]/g, '');
  if (!d) return NaN;
  let v = Number(d);
  if (!d.includes('.') && d.length === 4 && v > ADF_MAX_KHZ) v = v / 10;
  return v >= ADF_MIN_KHZ && v <= ADF_MAX_KHZ ? Math.round(v * 2) / 2 : NaN;
}

/** True when every digit is octal (0-7) and the code has at most four digits. */
export function isValidSquawk(code: string): boolean {
  return /^[0-7]{1,4}$/.test(code);
}

/** Code digits -> number (as the four-digit decimal representation, e.g. "0452" -> 452). */
export function parseSquawk(code: string): number {
  if (!isValidSquawk(code)) return NaN;
  return Number(code.padStart(4, '0'));
}

/**
 * Transponder mode labels by mode code (`xpdr.mode`: 0 off, 1 stby, 2 on,
 * 3 alt, 4 TA only, 5 TA/RA). G3000 GTC "Transponder" screen: STBY / ON / ALT
 * (Mode S with altitude reporting); with TCAS II the GTS 8000 adds TA ONLY and
 * TA/RA (G5000 CRG 190-02538-02 "Transponder/Mode Selection").
 */
export const XPDR_MODE_LABELS = ['OFF', 'STBY', 'ON', 'ALT', 'TA ONLY', 'TA/RA'] as const;
