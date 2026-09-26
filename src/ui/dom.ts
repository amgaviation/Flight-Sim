/**
 * Tiny DOM helpers for the HTML overlay UI (no framework).
 *
 *   h('div', { class: 'row', onclick: () => ... }, [h('span', {}, 'text')])
 */

export type Child = Node | string | number | null | undefined | false;
export type Props = Record<string, unknown> & { class?: string; style?: string | Partial<CSSStyleDeclaration> };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, children: Child | Child[] = []): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else Object.assign(el.style, v);
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'dataset' && typeof v === 'object') {
      for (const [dk, dv] of Object.entries(v as Record<string, string>)) el.dataset[dk] = dv;
    } else if (k in el && typeof v !== 'string') {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child | Child[]): void {
  const list = Array.isArray(children) ? children : [children];
  for (const c of list) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Labeled form row. */
export function field(label: string, control: Child, hint?: string): HTMLLabelElement {
  return h('label', { class: 'amg-field' }, [h('span', { class: 'amg-field-label' }, label), control, hint ? h('span', { class: 'amg-hint' }, hint) : null]);
}

/** Number input bound to a getter/setter. */
export function numberInput(value: number, opts: { min?: number; max?: number; step?: number; onChange: (v: number) => void; width?: string }): HTMLInputElement {
  const el = h('input', { type: 'number', value: String(value), min: opts.min, max: opts.max, step: opts.step ?? 1, class: 'amg-input', style: opts.width ? { width: opts.width } : undefined });
  el.addEventListener('change', () => {
    const v = Number(el.value);
    if (Number.isFinite(v)) opts.onChange(Math.min(opts.max ?? Infinity, Math.max(opts.min ?? -Infinity, v)));
  });
  return el;
}

export function select<T extends string | number>(options: { value: T; label: string }[], value: T, onChange: (v: T) => void): HTMLSelectElement {
  const el = h(
    'select',
    { class: 'amg-input' },
    options.map((o) => h('option', { value: String(o.value), selected: o.value === value }, o.label)),
  );
  el.addEventListener('change', () => {
    const o = options.find((x) => String(x.value) === el.value);
    if (o) onChange(o.value);
  });
  return el;
}

export function slider(value: number, opts: { min: number; max: number; step: number; onInput: (v: number) => void; format?: (v: number) => string }): HTMLElement {
  const out = h('span', { class: 'amg-slider-value' }, opts.format ? opts.format(value) : String(value));
  const el = h('input', { type: 'range', min: opts.min, max: opts.max, step: opts.step, value: String(value), class: 'amg-slider' });
  el.addEventListener('input', () => {
    const v = Number(el.value);
    out.textContent = opts.format ? opts.format(v) : String(v);
    opts.onInput(v);
  });
  return h('span', { class: 'amg-slider-wrap' }, [el, out]);
}

export function button(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  return h('button', { class: `amg-btn ${cls}`.trim(), type: 'button', onclick: onClick }, label);
}

export function tabs(names: string[], render: (i: number) => HTMLElement, initial = 0): HTMLElement {
  const bar = h('div', { class: 'amg-tabs' });
  const body = h('div', { class: 'amg-tab-body' });
  const btns = names.map((n, i) =>
    h('button', { class: 'amg-tab', type: 'button', onclick: () => show(i) }, n),
  );
  append(bar, btns);
  function show(i: number): void {
    btns.forEach((b, j) => b.classList.toggle('active', j === i));
    clear(body);
    body.appendChild(render(i));
  }
  show(initial);
  return h('div', { class: 'amg-tabbed' }, [bar, body]);
}
