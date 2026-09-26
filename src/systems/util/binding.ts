/**
 * Bindings: data-driven value sources that aircraft configs use to wire
 * system blocks to switches, other systems' outputs and automatic logic.
 *
 * A `Binding` is compiled ONCE (at block construction) into an `Evaluator`
 * closure that is then called every update without allocating:
 *
 *   number | boolean     constant (true = 1, false = 0)
 *   string               expression over SimVars, e.g.
 *                          'ac.elec.batt_sw'                       (plain var)
 *                          'elec.main_bus_v >= 24.5'               (comparison -> 0/1)
 *                          'ac.gen1_sw == 1 && eng1.n2_pct > 45'
 *                          'cb.avn1 ?? 1'                          (var with default when missing)
 *                          'clamp(ac.panel_knob * elec.dc1_powered, 0, 1)'
 *                          'ac.boost_sw == 2 || (ac.boost_sw == 1 && fuel.eng1_lowpress)'
 *   (vars) => number     arbitrary callback (must not allocate)
 *
 * Expression grammar (C-like precedence, all values are numbers, true = 1):
 *
 *   expr     := cond
 *   cond     := or ( '?' expr ':' expr )?
 *   or       := and ( '||' and )*
 *   and      := eq ( '&&' eq )*
 *   eq       := rel ( ('==' | '!=') rel )*
 *   rel      := add ( ('<' | '<=' | '>' | '>=') add )*
 *   add      := mul ( ('+' | '-') mul )*
 *   mul      := unary ( ('*' | '/' | '%') unary )*
 *   unary    := ('!' | '-' | '+') unary | primary
 *   primary  := NUMBER | 'true' | 'false' | '(' expr ')'
 *             | IDENT '(' args ')'                   function call
 *             | VAR ( '??' NUMBER )?                 SimVar read (default 0, or the literal after ??)
 *   VAR      := [A-Za-z_][A-Za-z0-9_.]*              dotted SimVar name
 *
 * Functions: min(a, b, ...), max(a, b, ...), abs(x), sign(x), floor(x),
 * ceil(x), round(x), sqrt(x), clamp(x, lo, hi), clamp01(x),
 * step(x, edge) (x >= edge ? 1 : 0), between(x, lo, hi) (lo <= x <= hi),
 * lerp(a, b, t), remap(x, x0, x1, y0, y1) (clamped linear map),
 * bool(x) (x != 0 ? 1 : 0), eq(a, b, tol) (|a - b| <= tol).
 *
 * `&&`, `||`, `!` and comparisons return 0/1; `&&`/`||` short-circuit.
 * Syntax errors throw at compile time with the offending expression, so a
 * bad aircraft config fails loudly when the aircraft loads.
 */
import type { SimVars } from '../../core/SimVars';

/** A value source (see file header). */
export type Binding = number | boolean | string | ((vars: SimVars) => number);

/** Compiled binding: call every update. Never allocates. */
export type Evaluator = () => number;

/** Compiles a binding. `undefined` compiles to the constant `fallback`. */
export function compileBinding(vars: SimVars, binding: Binding | undefined, fallback = 0): Evaluator {
  if (binding === undefined) return () => fallback;
  if (typeof binding === 'number') {
    const k = binding;
    return () => k;
  }
  if (typeof binding === 'boolean') {
    const k = binding ? 1 : 0;
    return () => k;
  }
  if (typeof binding === 'function') {
    const fn = binding;
    return () => fn(vars);
  }
  return compileExpression(vars, binding);
}

/** Compiles a binding as a boolean test (non-zero = true). */
export function compileCondition(vars: SimVars, binding: Binding | undefined, fallback = false): () => boolean {
  const ev = compileBinding(vars, binding, fallback ? 1 : 0);
  return () => ev() !== 0;
}

/** Returns the SimVar names an expression reads (for documentation, debugging and tests). */
export function expressionVars(source: string): string[] {
  const out = new Set<string>();
  const toks = tokenize(source);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind === 'ident' && !(toks[i + 1]?.kind === 'op' && toks[i + 1].text === '(') && t.text !== 'true' && t.text !== 'false') {
      out.add(t.text);
    }
  }
  return [...out];
}

// ---------------------------------------------------------------- tokenizer

interface Token {
  kind: 'num' | 'ident' | 'op' | 'end';
  text: string;
  value: number;
  pos: number;
}

const OPS2 = ['&&', '||', '==', '!=', '<=', '>=', '??'];
const OPS1 = '()!-+*/%<>?:,';

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    // Number: 12, 1.5, .5, 1e-3
    if ((c >= '0' && c <= '9') || (c === '.' && i + 1 < n && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      let j = i;
      while (j < n && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++;
      if (j < n && (src[j] === 'e' || src[j] === 'E')) {
        let k = j + 1;
        if (k < n && (src[k] === '+' || src[k] === '-')) k++;
        if (k < n && src[k] >= '0' && src[k] <= '9') {
          j = k;
          while (j < n && src[j] >= '0' && src[j] <= '9') j++;
        }
      }
      const text = src.slice(i, j);
      const value = Number(text);
      if (!Number.isFinite(value)) throw new Error(`Binding expression: bad number '${text}' at ${i} in "${src}"`);
      out.push({ kind: 'num', text, value, pos: i });
      i = j;
      continue;
    }
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_') {
      let j = i + 1;
      while (j < n) {
        const d = src[j];
        if ((d >= 'A' && d <= 'Z') || (d >= 'a' && d <= 'z') || (d >= '0' && d <= '9') || d === '_' || d === '.') j++;
        else break;
      }
      let text = src.slice(i, j);
      // A trailing dot is never part of a var name.
      while (text.endsWith('.')) text = text.slice(0, -1);
      out.push({ kind: 'ident', text, value: 0, pos: i });
      i += text.length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (OPS2.includes(two)) {
      out.push({ kind: 'op', text: two, value: 0, pos: i });
      i += 2;
      continue;
    }
    if (OPS1.includes(c)) {
      out.push({ kind: 'op', text: c, value: 0, pos: i });
      i++;
      continue;
    }
    throw new Error(`Binding expression: unexpected character '${c}' at ${i} in "${src}"`);
  }
  out.push({ kind: 'end', text: '', value: 0, pos: n });
  return out;
}

// ---------------------------------------------------------------- parser/compiler

type Fn = () => number;

class Parser {
  private i = 0;
  constructor(
    private readonly toks: Token[],
    private readonly vars: SimVars,
    private readonly src: string,
  ) {}

  parse(): Fn {
    const e = this.cond();
    if (this.peek().kind !== 'end') this.fail(`unexpected '${this.peek().text}'`);
    return e;
  }

  private peek(): Token {
    return this.toks[this.i];
  }

  private next(): Token {
    return this.toks[this.i++];
  }

  private isOp(text: string): boolean {
    const t = this.toks[this.i];
    return t.kind === 'op' && t.text === text;
  }

  private expect(text: string): void {
    if (!this.isOp(text)) this.fail(`expected '${text}' but found '${this.peek().text || 'end'}'`);
    this.i++;
  }

  private fail(msg: string): never {
    throw new Error(`Binding expression: ${msg} at ${this.peek().pos} in "${this.src}"`);
  }

  private cond(): Fn {
    const c = this.or();
    if (!this.isOp('?')) return c;
    this.i++;
    const a = this.cond();
    this.expect(':');
    const b = this.cond();
    return () => (c() !== 0 ? a() : b());
  }

  private or(): Fn {
    let l = this.and();
    while (this.isOp('||')) {
      this.i++;
      const a = l;
      const b = this.and();
      l = () => (a() !== 0 || b() !== 0 ? 1 : 0);
    }
    return l;
  }

  private and(): Fn {
    let l = this.eq();
    while (this.isOp('&&')) {
      this.i++;
      const a = l;
      const b = this.eq();
      l = () => (a() !== 0 && b() !== 0 ? 1 : 0);
    }
    return l;
  }

  private eq(): Fn {
    let l = this.rel();
    for (;;) {
      if (this.isOp('==')) {
        this.i++;
        const a = l;
        const b = this.rel();
        l = () => (a() === b() ? 1 : 0);
      } else if (this.isOp('!=')) {
        this.i++;
        const a = l;
        const b = this.rel();
        l = () => (a() !== b() ? 1 : 0);
      } else return l;
    }
  }

  private rel(): Fn {
    let l = this.add();
    for (;;) {
      const t = this.peek();
      if (t.kind !== 'op') return l;
      const a = l;
      if (t.text === '<') {
        this.i++;
        const b = this.add();
        l = () => (a() < b() ? 1 : 0);
      } else if (t.text === '<=') {
        this.i++;
        const b = this.add();
        l = () => (a() <= b() ? 1 : 0);
      } else if (t.text === '>') {
        this.i++;
        const b = this.add();
        l = () => (a() > b() ? 1 : 0);
      } else if (t.text === '>=') {
        this.i++;
        const b = this.add();
        l = () => (a() >= b() ? 1 : 0);
      } else return l;
    }
  }

  private add(): Fn {
    let l = this.mul();
    for (;;) {
      const a = l;
      if (this.isOp('+')) {
        this.i++;
        const b = this.mul();
        l = () => a() + b();
      } else if (this.isOp('-')) {
        this.i++;
        const b = this.mul();
        l = () => a() - b();
      } else return l;
    }
  }

  private mul(): Fn {
    let l = this.unary();
    for (;;) {
      const a = l;
      if (this.isOp('*')) {
        this.i++;
        const b = this.unary();
        l = () => a() * b();
      } else if (this.isOp('/')) {
        this.i++;
        const b = this.unary();
        l = () => {
          const d = b();
          return d === 0 ? 0 : a() / d;
        };
      } else if (this.isOp('%')) {
        this.i++;
        const b = this.unary();
        l = () => {
          const d = b();
          return d === 0 ? 0 : a() % d;
        };
      } else return l;
    }
  }

  private unary(): Fn {
    if (this.isOp('!')) {
      this.i++;
      const a = this.unary();
      return () => (a() === 0 ? 1 : 0);
    }
    if (this.isOp('-')) {
      this.i++;
      const a = this.unary();
      return () => -a();
    }
    if (this.isOp('+')) {
      this.i++;
      return this.unary();
    }
    return this.primary();
  }

  private primary(): Fn {
    const t = this.next();
    if (t.kind === 'num') {
      const k = t.value;
      return () => k;
    }
    if (t.kind === 'op' && t.text === '(') {
      const e = this.cond();
      this.expect(')');
      return e;
    }
    if (t.kind === 'ident') {
      if (t.text === 'true') return () => 1;
      if (t.text === 'false') return () => 0;
      if (this.isOp('(')) {
        this.i++;
        const args: Fn[] = [];
        if (!this.isOp(')')) {
          for (;;) {
            args.push(this.cond());
            if (this.isOp(',')) {
              this.i++;
              continue;
            }
            break;
          }
        }
        this.expect(')');
        return this.call(t.text, args);
      }
      const name = t.text;
      const vars = this.vars;
      if (this.isOp('??')) {
        this.i++;
        let neg = false;
        if (this.isOp('-')) {
          neg = true;
          this.i++;
        }
        const d = this.next();
        if (d.kind !== 'num' && !(d.kind === 'ident' && (d.text === 'true' || d.text === 'false'))) {
          this.fail(`'??' must be followed by a number literal`);
        }
        const dv = d.kind === 'num' ? (neg ? -d.value : d.value) : d.text === 'true' ? 1 : 0;
        return () => vars.get(name, dv);
      }
      return () => vars.get(name, 0);
    }
    this.i--;
    return this.fail(`unexpected '${t.text || 'end of expression'}'`);
  }

  private call(name: string, a: Fn[]): Fn {
    const arity = (n: number): void => {
      if (a.length !== n) this.fail(`${name}() takes ${n} argument(s), got ${a.length}`);
    };
    switch (name) {
      case 'min':
      case 'max': {
        if (a.length < 1) this.fail(`${name}() needs at least one argument`);
        let f = a[0];
        for (let k = 1; k < a.length; k++) {
          const x = f;
          const y = a[k];
          f = name === 'min' ? () => Math.min(x(), y()) : () => Math.max(x(), y());
        }
        return f;
      }
      case 'abs': {
        arity(1);
        const x = a[0];
        return () => Math.abs(x());
      }
      case 'sign': {
        arity(1);
        const x = a[0];
        return () => Math.sign(x());
      }
      case 'floor': {
        arity(1);
        const x = a[0];
        return () => Math.floor(x());
      }
      case 'ceil': {
        arity(1);
        const x = a[0];
        return () => Math.ceil(x());
      }
      case 'round': {
        arity(1);
        const x = a[0];
        return () => Math.round(x());
      }
      case 'sqrt': {
        arity(1);
        const x = a[0];
        return () => Math.sqrt(Math.max(0, x()));
      }
      case 'bool': {
        arity(1);
        const x = a[0];
        return () => (x() !== 0 ? 1 : 0);
      }
      case 'clamp': {
        arity(3);
        const [x, lo, hi] = a;
        return () => {
          const v = x();
          const l = lo();
          const h = hi();
          return v < l ? l : v > h ? h : v;
        };
      }
      case 'clamp01': {
        arity(1);
        const x = a[0];
        return () => {
          const v = x();
          return v < 0 ? 0 : v > 1 ? 1 : v;
        };
      }
      case 'step': {
        arity(2);
        const [x, e] = a;
        return () => (x() >= e() ? 1 : 0);
      }
      case 'between': {
        arity(3);
        const [x, lo, hi] = a;
        return () => {
          const v = x();
          return v >= lo() && v <= hi() ? 1 : 0;
        };
      }
      case 'lerp': {
        arity(3);
        const [p, q, t] = a;
        return () => {
          const u = t();
          const p0 = p();
          return p0 + (q() - p0) * u;
        };
      }
      case 'remap': {
        arity(5);
        const [x, x0, x1, y0, y1] = a;
        return () => {
          const lo = x0();
          const hi = x1();
          if (hi === lo) return y0();
          let u = (x() - lo) / (hi - lo);
          u = u < 0 ? 0 : u > 1 ? 1 : u;
          return y0() + (y1() - y0()) * u;
        };
      }
      case 'eq': {
        arity(3);
        const [p, q, tol] = a;
        return () => (Math.abs(p() - q()) <= tol() ? 1 : 0);
      }
      default:
        return this.fail(`unknown function '${name}'`);
    }
  }
}

/** Compiles an expression string (see file header) into an allocation-free evaluator. */
export function compileExpression(vars: SimVars, source: string): Evaluator {
  const src = source.trim();
  if (src.length === 0) throw new Error('Binding expression: empty expression');
  const p = new Parser(tokenize(src), vars, src);
  return p.parse();
}

// ---------------------------------------------------------------- expression builders

/**
 * Small helpers that build expression strings, so aircraft configs read
 * naturally and stay serializable:
 *
 *   closed: expr.and(expr.on('ac.elec.batt_sw'), expr.powered('elec.hot_batt_v', 18))
 *     -> '(ac.elec.batt_sw != 0) && (elec.hot_batt_v >= 18)'
 */
export const expr = {
  /** `name != 0`. */
  on: (name: string): string => `(${name} != 0)`,
  /** `name == 0`. */
  off: (name: string): string => `(${name} == 0)`,
  /** `name == value` (multi-position switches). */
  is: (name: string, value: number): string => `(${name} == ${value})`,
  /** Bus/load is powered: `voltVar >= minV`. */
  powered: (voltVar: string, minV: number): string => `(${voltVar} >= ${minV})`,
  /** Var with a default when it has never been written, e.g. circuit breakers (1 = in). */
  withDefault: (name: string, fallback: number): string => `(${name} ?? ${fallback})`,
  and: (...parts: string[]): string => parts.map((p) => `(${p})`).join(' && '),
  or: (...parts: string[]): string => parts.map((p) => `(${p})`).join(' || '),
  not: (part: string): string => `!(${part})`,
  gt: (name: string, v: number): string => `(${name} > ${v})`,
  ge: (name: string, v: number): string => `(${name} >= ${v})`,
  lt: (name: string, v: number): string => `(${name} < ${v})`,
  le: (name: string, v: number): string => `(${name} <= ${v})`,
} as const;
