/**
 * Mouse-yoke mode: the pointer position over the 3D view flies the
 * aircraft. Pointer above centre = push (nose down), below = pull, left/right
 * = roll. A small on-screen indicator shows the yoke position; the cockpit
 * interaction manager is disabled by the app while the mode is on so clicks
 * do not operate switches.
 */

/** Fraction of the half-width/half-height that gives full deflection. EST: comfortable mouse travel. */
const FULL_DEFLECTION_FRAC = 0.75;
/** Centre deadzone (fraction of full deflection). */
const DEADZONE = 0.03;

export class MouseYoke {
  active = false;
  /** -1..1, + = nose up (pointer below centre). */
  pitch = 0;
  /** -1..1, + = right. */
  roll = 0;
  private readonly el: HTMLElement;
  private indicator: HTMLDivElement | null = null;
  private dot: HTMLDivElement | null = null;
  private readonly onMove = (e: PointerEvent) => this.move(e.clientX, e.clientY);

  constructor(el: HTMLElement) {
    this.el = el;
  }

  setActive(on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    if (typeof window === 'undefined') return;
    if (on) {
      window.addEventListener('pointermove', this.onMove, { passive: true });
      this.ensureIndicator();
      this.indicator!.style.display = 'block';
    } else {
      window.removeEventListener('pointermove', this.onMove);
      this.pitch = 0;
      this.roll = 0;
      if (this.indicator) this.indicator.style.display = 'none';
    }
  }

  toggle(): boolean {
    this.setActive(!this.active);
    return this.active;
  }

  /** Maps a pointer position (client px) to yoke deflection. Exposed for tests. */
  move(clientX: number, clientY: number): void {
    const r = this.el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const nx = (clientX - (r.left + r.width / 2)) / ((r.width / 2) * FULL_DEFLECTION_FRAC);
    const ny = (clientY - (r.top + r.height / 2)) / ((r.height / 2) * FULL_DEFLECTION_FRAC);
    this.roll = shape(nx);
    this.pitch = shape(ny);
    if (this.dot) {
      this.dot.style.transform = `translate(${(this.roll * 40).toFixed(1)}px, ${(this.pitch * 40).toFixed(1)}px)`;
    }
  }

  private ensureIndicator(): void {
    if (this.indicator || typeof document === 'undefined') return;
    const ind = document.createElement('div');
    ind.className = 'amg-mouse-yoke';
    ind.title = 'Mouse yoke active (Y to release)';
    const dot = document.createElement('div');
    dot.className = 'amg-mouse-yoke-dot';
    ind.appendChild(dot);
    const label = document.createElement('div');
    label.className = 'amg-mouse-yoke-label';
    label.textContent = 'MOUSE YOKE';
    ind.appendChild(label);
    (this.el.parentElement ?? document.body).appendChild(ind);
    this.indicator = ind;
    this.dot = dot;
  }

  dispose(): void {
    this.setActive(false);
    this.indicator?.remove();
    this.indicator = null;
    this.dot = null;
  }
}

function shape(v: number): number {
  const c = Math.max(-1, Math.min(1, v));
  const a = Math.abs(c);
  if (a < DEADZONE) return 0;
  return (Math.sign(c) * (a - DEADZONE)) / (1 - DEADZONE);
}
