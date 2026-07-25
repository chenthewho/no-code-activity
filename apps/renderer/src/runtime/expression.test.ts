import { describe, expect, it, vi } from 'vitest';
import { evaluateBinding, evaluateExpression, ExpressionError } from './expression';

const ctx = {
  state: { count: 3, joined: false, name: '张三' },
  dataSource: { rank: [{ name: 'A', score: 10 }, { name: 'B', score: 8 }] },
  meta: { title: '七夕活动', endTime: '2026-08-20T00:00:00Z' },
  query: { channel: 'wechat' },
};

describe('evaluateExpression', () => {
  it('取嵌套属性与数组下标', () => {
    expect(evaluateExpression('state.count', ctx)).toBe(3);
    expect(evaluateExpression('dataSource.rank[0].name', ctx)).toBe('A');
    expect(evaluateExpression('dataSource.rank.length', ctx)).toBe(2);
  });

  it('算术与字符串拼接', () => {
    expect(evaluateExpression('state.count * 2 + 1', ctx)).toBe(7);
    expect(evaluateExpression("'你好，' + state.name", ctx)).toBe('你好，张三');
  });

  it('比较、逻辑与三元', () => {
    expect(evaluateExpression('state.count > 2 && !state.joined', ctx)).toBe(true);
    expect(evaluateExpression("state.joined ? '已参与' : '未参与'", ctx)).toBe('未参与');
    expect(evaluateExpression("query.missing ?? '默认值'", ctx)).toBe('默认值');
  });

  it('运算优先级正确', () => {
    expect(evaluateExpression('1 + 2 * 3', ctx)).toBe(7);
    expect(evaluateExpression('(1 + 2) * 3', ctx)).toBe(9);
    expect(evaluateExpression('2 + 3 > 4 === true', ctx)).toBe(true);
  });

  it('未知标识符解析为 undefined，不会落到全局对象', () => {
    expect(evaluateExpression('window', ctx)).toBeUndefined();
    expect(evaluateExpression('globalThis', ctx)).toBeUndefined();
    expect(evaluateExpression('document', ctx)).toBeUndefined();
  });

  it('不支持函数调用', () => {
    expect(() => evaluateExpression('alert(1)', ctx)).toThrow(ExpressionError);
    expect(() => evaluateExpression('state.name.toUpperCase()', ctx)).toThrow(ExpressionError);
  });

  it('拒绝原型链逃逸', () => {
    expect(() => evaluateExpression('state.constructor', ctx)).toThrow(/禁止访问属性/);
    expect(() => evaluateExpression('state.__proto__', ctx)).toThrow(/禁止访问属性/);
    expect(() => evaluateExpression("state['constructor']", ctx)).toThrow(/禁止访问属性/);
  });

  it('取不到继承来的方法', () => {
    expect(evaluateExpression('state.toString', ctx)).toBeUndefined();
    expect(evaluateExpression('state.hasOwnProperty', ctx)).toBeUndefined();
  });

  it('不支持赋值语句', () => {
    expect(() => evaluateExpression('state.count = 99', ctx)).toThrow(ExpressionError);
  });
});

describe('evaluateBinding', () => {
  it('整串绑定保留原始类型', () => {
    expect(evaluateBinding('{{ dataSource.rank }}', ctx)).toEqual(ctx.dataSource.rank);
    expect(evaluateBinding('{{ state.count }}', ctx)).toBe(3);
    expect(evaluateBinding('{{ state.joined }}', ctx)).toBe(false);
  });

  it('混排绑定拼接为字符串', () => {
    expect(evaluateBinding('当前 {{ state.count }} 人参与', ctx)).toBe('当前 3 人参与');
  });

  it('无绑定原样返回', () => {
    expect(evaluateBinding('纯文本', ctx)).toBe('纯文本');
  });

  it('空值渲染为空字符串而非 undefined 字样', () => {
    expect(evaluateBinding('值：{{ state.missing }}', ctx)).toBe('值：');
  });

  it('单个绑定写错只降级为 undefined，不抛出中断渲染', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(evaluateBinding('{{ state.. }}', ctx)).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
