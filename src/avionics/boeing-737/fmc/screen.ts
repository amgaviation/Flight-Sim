/**
 * CDU screen buffer: 14 lines x 24 characters (Smiths/GE 737 FMC CDU):
 *   line 0      page title (large) and page number (small, right)
 *   lines 1-12  six label (small font) / data (large font) pairs, the data
 *               lines are addressed by the line select keys 1L-6L / 1R-6R
 *   line 13     scratchpad
 * Each cell carries a character, a colour, a small-font flag and a
 * reverse-video flag (modified data is shown highlighted on the NG CDU).
 */

export enum CduColor {
  White = 0,
  Cyan = 1,
  Green = 2,
  Magenta = 3,
  Amber = 4,
}

export const CDU_ROWS = 14;
export const CDU_COLS = 24;
/** Box character used for required entries (rendered as an outlined box). */
export const BOX = '□';
/** Degree sign. */
export const DEGREE = '°';

export interface PutOpts {
  color?: CduColor;
  small?: boolean;
  reverse?: boolean;
}

export class CduScreen {
  readonly chars: string[] = new Array<string>(CDU_ROWS * CDU_COLS).fill(' ');
  readonly color = new Uint8Array(CDU_ROWS * CDU_COLS);
  readonly small = new Uint8Array(CDU_ROWS * CDU_COLS);
  readonly reverse = new Uint8Array(CDU_ROWS * CDU_COLS);

  clear(): void {
    this.chars.fill(' ');
    this.color.fill(0);
    this.small.fill(0);
    this.reverse.fill(0);
  }

  /** Writes `s` at (row, col); characters beyond the line are dropped. */
  put(row: number, col: number, s: string, o: PutOpts = {}): void {
    if (row < 0 || row >= CDU_ROWS) return;
    // Label rows (odd rows 1-11) default to the small font.
    const small = o.small ?? (row % 2 === 1 && row < 13);
    for (let i = 0; i < s.length; i++) {
      const c = col + i;
      if (c < 0 || c >= CDU_COLS) continue;
      const k = row * CDU_COLS + c;
      this.chars[k] = s[i];
      this.color[k] = o.color ?? CduColor.White;
      this.small[k] = small ? 1 : 0;
      this.reverse[k] = o.reverse ? 1 : 0;
    }
  }

  left(row: number, s: string, o?: PutOpts): void {
    this.put(row, 0, s, o);
  }

  right(row: number, s: string, o?: PutOpts): void {
    this.put(row, CDU_COLS - s.length, s, o);
  }

  center(row: number, s: string, o?: PutOpts): void {
    this.put(row, Math.floor((CDU_COLS - s.length) / 2), s, o);
  }

  /** Label line for data line k (1..6) on the left / right (small font, 1 column indent). */
  labelL(k: number, s: string, o?: PutOpts): void {
    this.put(2 * k - 1, 1, s, { small: true, ...o });
  }
  labelR(k: number, s: string, o?: PutOpts): void {
    this.put(2 * k - 1, CDU_COLS - 1 - s.length, s, { small: true, ...o });
  }
  dataL(k: number, s: string, o?: PutOpts): void {
    this.put(2 * k, 0, s, { small: false, ...o });
  }
  dataR(k: number, s: string, o?: PutOpts): void {
    this.put(2 * k, CDU_COLS - s.length, s, { small: false, ...o });
  }

  /** Title line: title centred-left (as on the CDU) and the page number "n/m" right. */
  title(s: string, page = 0, pages = 0, o?: PutOpts): void {
    const pn = pages > 0 ? `${page}/${pages}` : '';
    const start = Math.max(0, Math.floor((CDU_COLS - pn.length - s.length) / 2));
    this.put(0, start, s, { small: false, ...o });
    if (pn) this.put(0, CDU_COLS - pn.length, pn, { small: true });
  }

  /** Line of dashes (e.g. the separator above the bottom prompts). */
  dashes(row: number, from = 0, to = CDU_COLS): void {
    this.put(row, from, '-'.repeat(to - from), { small: true });
  }

  /** Text of one row (tests / debugging). */
  rowText(row: number): string {
    let s = '';
    for (let c = 0; c < CDU_COLS; c++) s += this.chars[row * CDU_COLS + c];
    return s;
  }

  /** Whole screen as text lines (tests). */
  lines(): string[] {
    const out: string[] = [];
    for (let r = 0; r < CDU_ROWS; r++) out.push(this.rowText(r));
    return out;
  }

  /** Cheap content hash for redraw detection. */
  hash(): number {
    let h = 2166136261;
    for (let i = 0; i < this.chars.length; i++) {
      h ^= this.chars[i].charCodeAt(0) + 31 * (this.color[i] + 7 * this.small[i] + 13 * this.reverse[i]);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
}
