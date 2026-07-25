import { evaluateBinding, hasBinding, type ExpressionContext } from './expression';

/**
 * 递归解析 props 中的 {{ }} 绑定。
 * 对象与数组要深入处理——轮播的 items、榜单的字段映射都可能嵌套着绑定。
 */
export function resolveProps<T extends Record<string, unknown>>(
  props: T,
  ctx: ExpressionContext,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    result[key] = resolveValue(value, ctx);
  }
  return result;
}

export function resolveValue(value: unknown, ctx: ExpressionContext): unknown {
  if (hasBinding(value)) return evaluateBinding(value, ctx);
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, ctx));
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = resolveValue(v, ctx);
    }
    return result;
  }
  return value;
}

/** 条件求值：空表达式视为真，避免没配 if 的节点被误判为隐藏 */
export function resolveCondition(expr: string | undefined, ctx: ExpressionContext): boolean {
  if (!expr || expr.trim() === '') return true;
  return Boolean(evaluateBinding(expr, ctx));
}
