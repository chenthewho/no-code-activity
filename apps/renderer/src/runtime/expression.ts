/**
 * 受限表达式求值器。
 *
 * DSL 里的 {{ }} 绑定必须能求值，但绝不能用 eval / new Function：
 * DSL 由运营在设计器里拼装、经数据库与 CDN 多跳传输，任何一环被污染
 * 都会变成 C 端任意代码执行。这里自己实现一个只支持「取值 + 比较 +
 * 算术 + 三元」的解析器，语法上就没有调用函数和访问全局对象的能力。
 *
 * 支持：a.b.c、a[0]、字面量、+ - * / %、== != === !== > >= < <=、&& || !、?: 、()
 * 不支持（有意为之）：函数调用、赋值、new、可选链之外的成员写入、任何标识符解析到上下文之外
 */

export type ExpressionContext = Record<string, unknown>;

type TokenType = 'num' | 'str' | 'ident' | 'punct';
interface Token {
  type: TokenType;
  value: string;
}

const PUNCTUATORS = [
  '===',
  '!==',
  '==',
  '!=',
  '>=',
  '<=',
  '&&',
  '||',
  '??',
  '(',
  ')',
  '[',
  ']',
  '.',
  ',',
  '+',
  '-',
  '*',
  '/',
  '%',
  '>',
  '<',
  '!',
  '?',
  ':',
];

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i] as string;

    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let value = '';
      i++;
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          value += input[i + 1];
          i += 2;
          continue;
        }
        value += input[i];
        i++;
      }
      if (i >= input.length) throw new ExpressionError('字符串未闭合');
      i++;
      tokens.push({ type: 'str', value });
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(input[i + 1] ?? ''))) {
      let value = '';
      while (i < input.length && /[0-9.]/.test(input[i] as string)) {
        value += input[i];
        i++;
      }
      tokens.push({ type: 'num', value });
      continue;
    }

    if (/[A-Za-z_$]/.test(ch)) {
      let value = '';
      while (i < input.length && /[A-Za-z0-9_$]/.test(input[i] as string)) {
        value += input[i];
        i++;
      }
      tokens.push({ type: 'ident', value });
      continue;
    }

    const punct = PUNCTUATORS.find((p) => input.startsWith(p, i));
    if (punct) {
      tokens.push({ type: 'punct', value: punct });
      i += punct.length;
      continue;
    }

    throw new ExpressionError(`无法识别的字符 "${ch}"`);
  }

  return tokens;
}

export class ExpressionError extends Error {}

/** 禁止访问的属性名，堵住原型链逃逸 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

class Parser {
  private pos = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly ctx: ExpressionContext,
  ) {}

  parse(): unknown {
    const value = this.ternary();
    if (this.pos < this.tokens.length) {
      throw new ExpressionError(`表达式尾部有多余内容："${this.tokens[this.pos]?.value}"`);
    }
    return value;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private eat(value: string): boolean {
    const token = this.peek();
    if (token && token.type === 'punct' && token.value === value) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expect(value: string): void {
    if (!this.eat(value)) {
      throw new ExpressionError(`缺少 "${value}"`);
    }
  }

  private ternary(): unknown {
    const cond = this.logicalOr();
    if (this.eat('?')) {
      const truthy = this.ternary();
      this.expect(':');
      const falsy = this.ternary();
      return cond ? truthy : falsy;
    }
    return cond;
  }

  private logicalOr(): unknown {
    let left = this.logicalAnd();
    for (;;) {
      if (this.eat('||')) {
        const right = this.logicalAnd();
        left = left || right;
      } else if (this.eat('??')) {
        const right = this.logicalAnd();
        left = left ?? right;
      } else {
        return left;
      }
    }
  }

  private logicalAnd(): unknown {
    let left = this.equality();
    while (this.eat('&&')) {
      const right = this.equality();
      left = left && right;
    }
    return left;
  }

  private equality(): unknown {
    let left = this.relational();
    for (;;) {
      if (this.eat('===') || this.eat('==')) {
        left = left === this.relational();
      } else if (this.eat('!==') || this.eat('!=')) {
        left = left !== this.relational();
      } else {
        return left;
      }
    }
  }

  private relational(): unknown {
    let left = this.additive();
    for (;;) {
      if (this.eat('>=')) left = (left as number) >= (this.additive() as number);
      else if (this.eat('<=')) left = (left as number) <= (this.additive() as number);
      else if (this.eat('>')) left = (left as number) > (this.additive() as number);
      else if (this.eat('<')) left = (left as number) < (this.additive() as number);
      else return left;
    }
  }

  private additive(): unknown {
    let left = this.multiplicative();
    for (;;) {
      if (this.eat('+')) {
        const right = this.multiplicative();
        left =
          typeof left === 'string' || typeof right === 'string'
            ? String(left ?? '') + String(right ?? '')
            : (left as number) + (right as number);
      } else if (this.eat('-')) {
        left = (left as number) - (this.multiplicative() as number);
      } else {
        return left;
      }
    }
  }

  private multiplicative(): unknown {
    let left = this.unary();
    for (;;) {
      if (this.eat('*')) left = (left as number) * (this.unary() as number);
      else if (this.eat('/')) left = (left as number) / (this.unary() as number);
      else if (this.eat('%')) left = (left as number) % (this.unary() as number);
      else return left;
    }
  }

  private unary(): unknown {
    if (this.eat('!')) return !this.unary();
    if (this.eat('-')) return -(this.unary() as number);
    if (this.eat('+')) return Number(this.unary());
    return this.member();
  }

  private member(): unknown {
    let value = this.primary();
    for (;;) {
      if (this.eat('.')) {
        const token = this.peek();
        if (!token || token.type !== 'ident') throw new ExpressionError('. 后需要属性名');
        this.pos++;
        value = readProperty(value, token.value);
      } else if (this.eat('[')) {
        const key = this.ternary();
        this.expect(']');
        value = readProperty(value, String(key));
      } else {
        return value;
      }
    }
  }

  private primary(): unknown {
    const token = this.peek();
    if (!token) throw new ExpressionError('表达式不完整');

    if (token.type === 'num') {
      this.pos++;
      return Number(token.value);
    }
    if (token.type === 'str') {
      this.pos++;
      return token.value;
    }
    if (token.type === 'punct' && token.value === '(') {
      this.pos++;
      const value = this.ternary();
      this.expect(')');
      return value;
    }
    if (token.type === 'ident') {
      this.pos++;
      switch (token.value) {
        case 'true':
          return true;
        case 'false':
          return false;
        case 'null':
          return null;
        case 'undefined':
          return undefined;
        default:
          // 标识符只能解析到显式传入的上下文，取不到就是 undefined，
          // 永远不会落到 window / globalThis
          return readProperty(this.ctx, token.value);
      }
    }
    throw new ExpressionError(`无法解析的记号 "${token.value}"`);
  }
}

function readProperty(target: unknown, key: string): unknown {
  if (target === null || target === undefined) return undefined;
  if (FORBIDDEN_KEYS.has(key)) {
    throw new ExpressionError(`禁止访问属性 ${key}`);
  }
  if (typeof target === 'string' || Array.isArray(target)) {
    if (key === 'length') return target.length;
    const index = Number(key);
    if (Number.isInteger(index)) return (target as unknown[])[index];
    return undefined;
  }
  if (typeof target !== 'object') return undefined;
  // 只读自有属性，继承来的方法（toString / valueOf …）一律取不到
  if (!Object.prototype.hasOwnProperty.call(target, key)) return undefined;
  return (target as Record<string, unknown>)[key];
}

/** 求值单个表达式（不含 {{ }} 包裹） */
export function evaluateExpression(source: string, ctx: ExpressionContext): unknown {
  return new Parser(tokenize(source), ctx).parse();
}

const FULL_BINDING = /^\s*\{\{([\s\S]+?)\}\}\s*$/;
const INLINE_BINDING = /\{\{([\s\S]+?)\}\}/g;

/**
 * 解析可能含 {{ }} 的字符串。
 * 整串就是一个绑定时返回原始类型（数组/对象/布尔不会被转成字符串），
 * 混排时按模板拼接成字符串。
 */
export function evaluateBinding(source: string, ctx: ExpressionContext): unknown {
  const full = FULL_BINDING.exec(source);
  if (full) {
    return safeEval(full[1] as string, ctx);
  }
  if (!source.includes('{{')) return source;
  return source.replace(INLINE_BINDING, (_match, expr: string) => {
    const value = safeEval(expr, ctx);
    return value === undefined || value === null ? '' : String(value);
  });
}

function safeEval(expr: string, ctx: ExpressionContext): unknown {
  try {
    return evaluateExpression(expr, ctx);
  } catch (err) {
    // 单个绑定写错不该让整页白屏，降级为 undefined 并留下告警
    if (typeof console !== 'undefined') {
      console.warn(`[nca] 表达式求值失败：{{${expr}}}`, err);
    }
    return undefined;
  }
}

export function hasBinding(value: unknown): value is string {
  return typeof value === 'string' && value.includes('{{');
}
