/**
 * FMS text window model: 24 columns x 14 rows (title, six label / data line
 * pairs beside the line select positions 1L-6L / 1R-6R, scratchpad), the
 * Collins CDU page structure (FMS-3000 / FMS-6000 heritage) as shown in the
 * Pro Line Fusion FMS window. On the AFD the line select "keys" are hot
 * spots operated with the CCP cursor and ENTER (FSB BD-700-1A10 Rev 7: FMS
 * "Controlled at MKP, CTP, CCP and soft buttons on displays").
 *
 * Colours (EST, Collins FMS convention): labels small white / grey, data
 * large white, pilot entries cyan, active waypoint magenta, required entries
 * amber boxes, MOD titles white on a MOD page.
 */
export type FmsColor = 'white' | 'cyan' | 'green' | 'magenta' | 'amber' | 'grey';

export const FMS_COLS = 24;
export const FMS_ROWS = 14;
/** Amber box placeholder for required entries. */
export const BOX = '□';

export interface FmsSeg {
  text: string;
  col: number;
  color: FmsColor;
  small: boolean;
}

export type LskId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';
export const LSK_IDS: readonly LskId[] = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6'];

export class FmsScreen {
  title = '';
  titleColor: FmsColor = 'white';
  page = 1;
  pages = 1;
  readonly rows: FmsSeg[][] = [];
  scratch = '';
  scratchColor: FmsColor = 'white';

  constructor() {
    for (let i = 0; i < FMS_ROWS; i++) this.rows.push([]);
  }

  clear(): void {
    this.title = '';
    this.titleColor = 'white';
    this.page = 1;
    this.pages = 1;
    for (const r of this.rows) r.length = 0;
  }

  put(row: number, col: number, text: string, color: FmsColor = 'white', small = false): void {
    if (row < 0 || row >= FMS_ROWS || !text) return;
    this.rows[row].push({ text, col: Math.max(0, Math.min(FMS_COLS - 1, col)), color, small });
  }

  labelL(k: number, text: string, color: FmsColor = 'white'): void {
    this.put(2 * k - 1, 1, text, color, true);
  }
  labelR(k: number, text: string, color: FmsColor = 'white'): void {
    this.put(2 * k - 1, FMS_COLS - 1 - text.length, text, color, true);
  }
  labelC(k: number, text: string, color: FmsColor = 'white'): void {
    this.put(2 * k - 1, Math.floor((FMS_COLS - text.length) / 2), text, color, true);
  }
  dataL(k: number, text: string, color: FmsColor = 'white', small = false): void {
    this.put(2 * k, 0, text, color, small);
  }
  dataR(k: number, text: string, color: FmsColor = 'white', small = false): void {
    this.put(2 * k, FMS_COLS - text.length, text, color, small);
  }
  dataC(k: number, text: string, color: FmsColor = 'white', small = false): void {
    this.put(2 * k, Math.floor((FMS_COLS - text.length) / 2), text, color, small);
  }

  /** Plain text of one row (tests / debugging). */
  rowText(row: number): string {
    const chars = new Array<string>(FMS_COLS).fill(' ');
    for (const s of this.rows[row]) for (let i = 0; i < s.text.length && s.col + i < FMS_COLS; i++) chars[s.col + i] = s.text[i];
    return chars.join('').trimEnd();
  }

  /** Whole screen as text lines (tests). */
  text(): string[] {
    const out = [`${this.title}${this.pages > 1 ? ` ${this.page}/${this.pages}` : ''}`];
    for (let r = 1; r < FMS_ROWS - 1; r++) out.push(this.rowText(r));
    out.push(this.scratch);
    return out;
  }
}
