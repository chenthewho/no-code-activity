import type { DataSource } from '@nca/dsl';
import { evaluateBinding, type ExpressionContext } from './expression';
import { resolveValue } from './props-parser';
import { API_BASE } from './api';

export interface DataSourceState {
  loading: boolean;
  data: unknown;
  error?: string;
}

export type DataSourceMap = Record<string, DataSourceState>;

/** 数据源初始态：先用 fallback 兜底，组件首帧就有东西可渲染，不会闪空白 */
export function initDataSourceState(sources: DataSource[]): DataSourceMap {
  const map: DataSourceMap = {};
  for (const ds of sources) {
    map[ds.id] = {
      loading: ds.type === 'http' && ds.autoLoad,
      data: ds.type === 'static' ? ds.data : (ds.fallback ?? null),
    };
  }
  return map;
}

/**
 * computed 数据源求值。由运行时在每次构建表达式上下文时现算，而不是挂载时算一次存起来——
 * 它依赖的 state、其它数据源、登录用户一变，读到的就是新值。
 */
export function evaluateComputed(
  ds: Extract<DataSource, { type: 'computed' }>,
  ctx: ExpressionContext,
): unknown {
  try {
    // 表达式写错或依赖还没就绪时求出 undefined（求值器不抛错），同样退回 fallback
    const value = evaluateBinding(ds.expression, ctx);
    return value === undefined ? (ds.fallback ?? null) : value;
  } catch {
    return ds.fallback ?? null;
  }
}

export async function fetchDataSource(
  ds: DataSource,
  ctx: ExpressionContext,
  signal?: AbortSignal,
): Promise<DataSourceState> {
  if (ds.type === 'static') {
    return { loading: false, data: ds.data };
  }

  if (ds.type === 'computed') {
    return { loading: false, data: evaluateComputed(ds, ctx) };
  }

  try {
    const params = resolveValue(ds.params, ctx) as Record<string, unknown>;
    // 相对 URL（如 /runtime/activities/:id/prizes）基于 API_BASE 解析，
    // 让数据源能打到 API 服务端而不是 renderer 自己的源
    const url = new URL(evaluateBinding(ds.url, ctx) as string, API_BASE);
    if (ds.method === 'GET') {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }

    const response = await fetch(url.toString(), {
      method: ds.method,
      signal,
      headers: { 'Content-Type': 'application/json', ...ds.headers },
      body:
        ds.method === 'POST'
          ? JSON.stringify(resolveValue(ds.body ?? params, ctx))
          : undefined,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json: unknown = await response.json();
    // transform 表达式在 response 命名空间上求值，让运营能裁到真正要的那一层
    const data = ds.transform ? evaluateBinding(ds.transform, { ...ctx, response: json }) : json;
    return { loading: false, data };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { loading: false, data: ds.fallback ?? null };
    }
    // 接口挂了就回落到 fallback，活动页其它部分照常可用
    console.error(`[nca] 数据源 ${ds.id} 请求失败`, err);
    return { loading: false, data: ds.fallback ?? null, error: String(err) };
  }
}

/** 把 { id: state } 摊平成表达式里可直接写 dataSource.xxx 的形状 */
export function toExpressionData(map: DataSourceMap): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [id, state] of Object.entries(map)) {
    result[id] = state.data;
  }
  return result;
}
