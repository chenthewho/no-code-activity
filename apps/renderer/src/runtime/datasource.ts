import type { DataSource } from '@nca/dsl';
import { evaluateBinding, type ExpressionContext } from './expression';
import { resolveValue } from './props-parser';

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

export async function fetchDataSource(
  ds: DataSource,
  ctx: ExpressionContext,
  signal?: AbortSignal,
): Promise<DataSourceState> {
  if (ds.type === 'static') {
    return { loading: false, data: ds.data };
  }

  if (ds.type === 'computed') {
    try {
      return { loading: false, data: evaluateBinding(ds.expression, ctx) };
    } catch (err) {
      return { loading: false, data: ds.fallback ?? null, error: String(err) };
    }
  }

  try {
    const params = resolveValue(ds.params, ctx) as Record<string, unknown>;
    const url = new URL(evaluateBinding(ds.url, ctx) as string, window.location.origin);
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
