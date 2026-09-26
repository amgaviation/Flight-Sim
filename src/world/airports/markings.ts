/**
 * Runway marking layout per FAA AC 150/5340-1M "Standards for Airport
 * Markings" (pure data consumed by the runway shader). All values in feet,
 * measured from the landing threshold of each end ("ul") and laterally from
 * the centreline to the right of the landing direction ("v").
 *
 *  - Threshold stripes (2.5): 150 ft long, 5.75 ft wide and apart, starting
 *    20 ft from the threshold; the two stripes nearest the centreline are
 *    double spaced (11.5 ft); count by width per Table 2-2 (60 ft: 4,
 *    75: 6, 100: 8, 150: 12, 200: 16); non-standard widths keep the pattern
 *    until the outer stripe is within 4 ft of the edge.
 *  - Designation (2.3, Figures A-1..A-3, A-6): characters 60 ft tall (6 and 9
 *    63 ft with the 3 ft tip ignored), 20 ft wide (1: 7 ft, 4: 25 ft, 7: 23 ft),
 *    15 ft between numerals; 40 ft after the threshold stripes, letter nearer
 *    the threshold with 20 ft to the numerals, centreline 40 ft beyond.
 *    Visual runways: designation 20 ft from the threshold.
 *  - Centreline (2.4): 120 ft stripes, 80 ft gaps; width 36 in precision,
 *    18 in non-precision, 12 in visual; pattern adjusted to fit.
 *  - Aiming point (2.6): starts 1,020 ft; 150 ft long (100 ft when the
 *    runway is shorter than 4,200 ft); width 30/20/15/12 ft and inner spacing
 *    72/48/36/28.8 ft for 150/100/75/60 ft runways, proportional otherwise,
 *    inner spacing never below 30 ft except on runways narrower than 75 ft.
 *  - Touchdown zone (2.7, Tables 2-3/2-4): bar groups 3,2,2,1,1 starting at
 *    520, 1520, 2020, 2520, 3020 ft; bars 75 ft x 6 ft with 5 ft between bars,
 *    scaled by width/150 below 150 ft; groups removed near the midpoint.
 *  - Edge stripes (2.8): 3 ft on runways >= 100 ft wide, 1.5 ft otherwise.
 *  - Displaced threshold (2.9): 10 ft threshold bar, arrows and arrowheads.
 *  - Blast pads (2.10, Figure A-9): yellow chevrons at 45 deg, 3 ft wide,
 *    100 ft apart (50 ft when shorter than 250 ft).
 */
import { FT_TO_M } from '../geo';
import { splitDesignator, type RunwayModel } from './runwayModel';

export interface GlyphBox {
  /** Atlas character. */
  char: string;
  /** Box (ft) in end-local coordinates: ul range and v range covering the atlas cell. */
  s0: number;
  s1: number;
  t0: number;
  t1: number;
}

export interface EndMarkingLayout {
  /** 0 none, 1 visual, 2 non-precision, 3 precision. */
  cls: number;
  displacedFt: number;
  blastFt: number;
  stripesPerSide: number;
  /** Stripe width = gap (ft), normally 5.75. */
  stripeUnitFt: number;
  /** Aiming point: start (from threshold), length, width, inner half-spacing (ft); len 0 = none. */
  aimStartFt: number;
  aimLenFt: number;
  aimWidthFt: number;
  aimInnerHalfFt: number;
  /** Number of TDZ bar groups drawn (0..5, in order 3,2,2,1,1). */
  tdzGroups: number;
  tdzBarWFt: number;
  tdzGapFt: number;
  glyphs: GlyphBox[];
  /** ul (ft) where the centreline pattern may start (after the designation). */
  designationEndFt: number;
}

export interface RunwayMarkingLayout {
  lengthFt: number;
  widthFt: number;
  shoulderFt: number;
  edgeStripeFt: number;
  clWidthFt: number;
  /** Centreline pattern in runway s (ft from end A): start, length, period, stripe fraction. */
  clStartFt: number;
  clLengthFt: number;
  clPeriodFt: number;
  clStripeFrac: number;
  ends: [EndMarkingLayout, EndMarkingLayout];
}

/** Character widths (ft), AC 150/5340-1M Figure A-6 and Painting Note 2. */
export const GLYPH_WIDTH_FT: Record<string, number> = {
  '0': 20, '1': 7, '2': 20, '3': 20, '4': 25, '5': 20, '6': 20, '7': 23, '8': 20, '9': 20,
  I: 20, // numeral 1 used alone, with a horizontal stroke (Figure A-6 note 5)
  L: 20, C: 20, R: 20,
};
/** Atlas cell size (ft): glyphs drawn 2 ft from the left and 3 ft from the bottom. */
export const GLYPH_CELL_W_FT = 30;
export const GLYPH_CELL_H_FT = 66;
export const GLYPH_PAD_X_FT = 2;
export const GLYPH_PAD_Y_FT = 3;

const STANDARD_STRIPES: [number, number][] = [
  [60, 4],
  [75, 6],
  [100, 8],
  [150, 12],
  [200, 16],
];

/** Threshold stripe count and unit for a runway width (AC 150/5340-1M Table 2-2 and 2.5.5 items 2-3). */
export function thresholdStripes(widthFt: number): { perSide: number; unitFt: number } {
  for (const [w, n] of STANDARD_STRIPES) {
    if (Math.abs(widthFt - w) < 1) {
      // Painting Note 4: 75 ft runways reduce the unit to 5.5 ft to clear 36 in edge stripes.
      return { perSide: n / 2, unitFt: w === 75 ? 5.5 : 5.75 };
    }
  }
  // Non-standard: continue the pattern until the outer stripe is >= 4 ft from the edge, max 92 ft out.
  const lim = Math.min(widthFt / 2 - 4, 92);
  let perSide = 0;
  while (perSide < 8 && 11.5 * (perSide + 1) <= lim) perSide++;
  return { perSide: Math.max(1, perSide), unitFt: 5.75 };
}

/** Aiming point width and inner half-spacing (ft) (2.6.5 items 2-3 and Painting Note 5). */
export function aimingPointGeometry(widthFt: number): { widthFt: number; innerHalfFt: number } {
  if (widthFt >= 150) return { widthFt: 30, innerHalfFt: 36 };
  const k = widthFt / 150;
  let inner = 72 * k;
  if (widthFt >= 75) inner = Math.max(30, inner);
  return { widthFt: 30 * k, innerHalfFt: inner / 2 };
}

/**
 * Number of TDZ bar groups (0..5) for an end (Tables 2-3 / 2-4).
 * `bothPrecision`: both ends carry TDZ markings (case #2).
 */
export function tdzGroupCount(thresholdDistanceFt: number, bothPrecision: boolean): number {
  const D = thresholdDistanceFt;
  if (bothPrecision) {
    if (D >= 7990) return 5;
    if (D >= 6990) return 4;
    if (D >= 5990) return 3;
    if (D >= 4990) return 2;
    return D >= 4200 ? 1 : 0; // EST below the table's range
  }
  if (D >= 6065) return 5;
  if (D >= 5565) return 4;
  if (D >= 5065) return 3;
  if (D >= 4565) return 2;
  return D >= 4200 ? 1 : 0; // EST below the table's range
}

/** TDZ group start positions (ft from threshold) and bar counts. */
export const TDZ_GROUPS: readonly { startFt: number; bars: number }[] = [
  { startFt: 520, bars: 3 },
  { startFt: 1520, bars: 2 },
  { startFt: 2020, bars: 2 },
  { startFt: 2520, bars: 1 },
  { startFt: 3020, bars: 1 },
];

function classCode(m: RunwayModel['ends'][0]['markings']): number {
  return m === 'precision' ? 3 : m === 'nonprecision' ? 2 : m === 'visual' ? 1 : 0;
}

/** Lays out the designator glyph boxes for an end. Returns the ul where the designation ends. */
function layoutDesignator(ident: string, cls: number, widthFt: number, edgeFt: number, out: GlyphBox[]): number {
  const { digits, letter } = splitDesignator(ident);
  if (!digits) return cls >= 2 ? 170 : 20;
  const chars = digits === '1' ? ['I'] : digits.split('');
  let spacing = 15;
  let numW = chars.reduce((a, c) => a + GLYPH_WIDTH_FT[c], 0) + spacing * (chars.length - 1);
  // Painting Note 3: keep 2 ft from the edge (markings): first tighten spacing to 10 ft, then scale.
  const maxW = widthFt - 2 * (edgeFt + 2);
  if (numW > maxW) {
    spacing = 10;
    numW = chars.reduce((a, c) => a + GLYPH_WIDTH_FT[c], 0) + spacing * (chars.length - 1);
  }
  const scale = numW > maxW ? Math.max(0.3, maxW / numW) : 1;
  const H = 60 * scale;
  let ul = cls >= 2 ? 20 + 150 + 40 : 20; // after threshold stripes (A-1/A-2) or 20 ft (A-3)
  const place = (c: string, left: number, base: number) => {
    out.push({
      char: c,
      s0: base - GLYPH_PAD_Y_FT * scale,
      s1: base + (GLYPH_CELL_H_FT - GLYPH_PAD_Y_FT) * scale,
      t0: left - GLYPH_PAD_X_FT * scale,
      t1: left + (GLYPH_CELL_W_FT - GLYPH_PAD_X_FT) * scale,
    });
  };
  if (letter) {
    const lw = GLYPH_WIDTH_FT[letter] * scale;
    place(letter, -lw / 2, ul);
    ul += H + 20 * scale;
  }
  let x = (-numW * scale) / 2;
  for (const c of chars) {
    place(c, x, ul);
    x += (GLYPH_WIDTH_FT[c] + spacing) * scale;
  }
  ul += H;
  return ul;
}

/** Builds the full marking layout for a runway. */
export function runwayMarkingLayout(rw: RunwayModel): RunwayMarkingLayout {
  const lengthFt = rw.lengthM / FT_TO_M;
  const widthFt = rw.widthM / FT_TO_M;
  const shoulderFt = rw.shoulderM / FT_TO_M;
  const clsA = classCode(rw.ends[0].markings);
  const clsB = classCode(rw.ends[1].markings);
  const maxCls = Math.max(clsA, clsB);
  // Edge stripes: required on precision runways; EST also on large-airport instrument runways.
  const edgeStripeFt = maxCls === 3 || (maxCls === 2 && rw.airportType === 'large_airport') ? (widthFt >= 100 ? 3 : 1.5) : 0;
  const clWidthFt = maxCls === 3 ? 3 : maxCls === 2 ? 1.5 : 1;
  const dispA = rw.ends[0].displacedM / FT_TO_M;
  const dispB = rw.ends[1].displacedM / FT_TO_M;
  const thrDistFt = lengthFt - dispA - dispB;
  const bothPrecision = clsA === 3 && clsB === 3;
  const aim = aimingPointGeometry(widthFt);
  const k = Math.min(1, widthFt / 150);

  const ends = [0, 1].map((i): EndMarkingLayout => {
    const end = rw.ends[i];
    const cls = classCode(end.markings);
    const stripes = thresholdStripes(widthFt);
    const glyphs: GlyphBox[] = [];
    const designationEndFt = cls > 0 ? layoutDesignator(end.ident, cls, widthFt, edgeStripeFt, glyphs) : 0;
    // Aiming point: precision always; non-precision/visual on >= 4,200 ft runways (Table 2-1 notes 2/3).
    const hasAim = cls === 3 || (cls >= 1 && thrDistFt >= 4200 && (cls === 2 || rw.airportType !== 'small_airport'));
    const tdzGroups = cls === 3 ? tdzGroupCount(thrDistFt, bothPrecision) : 0;
    return {
      cls,
      displacedFt: end.displacedM / FT_TO_M,
      blastFt: end.blastPadM / FT_TO_M,
      stripesPerSide: cls >= 2 ? stripes.perSide : 0,
      stripeUnitFt: stripes.unitFt,
      aimStartFt: 1020,
      aimLenFt: hasAim ? (thrDistFt >= 4200 ? 150 : 100) : 0,
      aimWidthFt: aim.widthFt,
      aimInnerHalfFt: aim.innerHalfFt,
      tdzGroups,
      tdzBarWFt: 6 * k,
      tdzGapFt: 5 * k,
      glyphs,
      designationEndFt,
    };
  }) as [EndMarkingLayout, EndMarkingLayout];

  // Centreline between the two designations, 40 ft clear of each: n stripes
  // and n - 1 gaps in the 120:80 ratio, stretched uniformly to fit exactly.
  const startA = dispA + ends[0].designationEndFt + 40;
  const endB = lengthFt - (dispB + ends[1].designationEndFt + 40);
  const avail = Math.max(0, endB - startA);
  let n = Math.max(1, Math.round((avail + 80) / 200));
  let period = avail / (n - 0.4);
  // Reduced stripes >= 80 ft and gaps >= 40 ft (2.4.5 item 3): period >= 80 / 0.6.
  while (period < 80 / 0.6 && n > 1) {
    n--;
    period = avail / (n - 0.4);
  }
  const hasCl = Math.max(clsA, clsB) > 0 && avail > 120;
  return {
    lengthFt,
    widthFt,
    shoulderFt,
    edgeStripeFt,
    clWidthFt,
    clStartFt: startA,
    clLengthFt: hasCl ? avail : 0,
    clPeriodFt: period,
    clStripeFrac: 0.6,
    ends,
  };
}
