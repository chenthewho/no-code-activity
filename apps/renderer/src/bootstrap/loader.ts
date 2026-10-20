import { migrateDsl, validateFinalDsl, type FinalDsl } from '@nca/dsl';
import { describeUpgrade, knownMaterialNames, materialVersions, upgradeMaterials } from '@nca/materials';

export interface LoadResult {
  dsl: FinalDsl;
  warnings: string[];
  /** 服务端这次给的发布版本（响应头 X-NCA-Version），灰度期间埋点与监控据此区分新旧版 */
  version?: number;
}

/** 预取与正常请求拿到的同一种东西：DSL 原文 + 版本号 */
interface FetchedDsl {
  raw: unknown;
  version?: number;
}

/** DSL 没拉下来（网络、404、活动未发布）。与「拉下来了但不合法」分开上报，排查方向完全不同 */
export class DslLoadError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DslLoadError';
  }
}

/** DSL 结构损坏或版本高于渲染器 */
export class DslInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DslInvalidError';
  }
}

declare global {
  interface Window {
    /** index.html 里的内联脚本在 JS 下载期间就开始拉 DSL，见 vite.config.ts 的 dslPrefetch */
    __NCA_DSL_PREFETCH__?: { url: string; promise: Promise<{ data: unknown; version: string | null }> };
  }
}

/**
 * 复用与 url 匹配的预取请求。不取走：StrictMode 下加载 effect 会跑两遍，两遍都该复用
 * 同一个请求；预取失败了才清掉，让之后的加载重新发请求。
 */
function takePrefetch(url: string): Promise<{ data: unknown; version: string | null }> | null {
  const prefetch = window.__NCA_DSL_PREFETCH__;
  if (!prefetch || prefetch.url !== url) return null;
  prefetch.promise.catch(() => {
    if (window.__NCA_DSL_PREFETCH__ === prefetch) delete window.__NCA_DSL_PREFETCH__;
  });
  return prefetch.promise;
}

function parseVersion(value: string | null | undefined): number | undefined {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

async function fetchDsl(url: string, signal?: AbortSignal, headers: Record<string, string> = {}): Promise<FetchedDsl> {
  const prefetched = takePrefetch(url);
  if (prefetched) {
    try {
      const { data, version } = await prefetched;
      return { raw: data, version: parseVersion(version) };
    } catch (err) {
      const status = Number(/HTTP (\d+)/.exec((err as Error).message)?.[1]) || undefined;
      throw new DslLoadError(`DSL 加载失败：${(err as Error).message}`, status);
    }
  }
  let response: Response;
  try {
    response = await fetch(url, { signal, headers });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new DslLoadError(`DSL 加载失败：${(err as Error).message}`);
  }
  if (!response.ok) throw new DslLoadError(`DSL 加载失败：HTTP ${response.status}`, response.status);
  try {
    return { raw: await response.json(), version: parseVersion(response.headers.get('X-NCA-Version')) };
  } catch {
    throw new DslLoadError('DSL 加载失败：返回的不是合法 JSON', response.status);
  }
}

/**
 * 加载并校验 DSL。
 *
 * 校验策略与服务端刻意不同：服务端在发布时用严格模式把关，
 * 这里是最后一道防线，目标是「尽可能把页面渲染出来」——
 * 结构错误直接抛出走错误页，warning 只记录不阻断。
 */
export async function loadDsl(
  url: string,
  signal?: AbortSignal,
  headers?: Record<string, string>,
): Promise<LoadResult> {
  const { raw, version } = await fetchDsl(url, signal, headers);
  return { ...parseDsl(raw), version };
}

export function parseDsl(raw: unknown): LoadResult {
  let migrated: ReturnType<typeof migrateDsl>;
  try {
    migrated = migrateDsl(raw);
  } catch (err) {
    throw new DslInvalidError((err as Error).message);
  }
  // 用 draft 口径：渲染器的职责是「尽量把页面渲染出来」，不是把关。
  // 「某个动作还没填完」不该让设计器画布变空白，更不该让线上活动页白屏——
  // 完整性由发布环节负责拦截，这里只拒绝结构性损坏。
  const result = validateFinalDsl(migrated.dsl, {
    knownMaterials: knownMaterialNames,
    mode: 'draft',
  });

  if (!result.success) {
    const detail = result.issues
      .filter((i) => i.level === 'error')
      .map((i) => `${i.path}: ${i.message}`)
      .join('\n');
    throw new DslInvalidError(`DSL 校验失败\n${detail}`);
  }

  const warnings = result.issues.map((i) => `${i.path}: ${i.message}`);
  if (migrated.applied.length > 0) {
    warnings.push(`已迁移 DSL 版本：${migrated.applied.join(' → ')}`);
  }
  // 物料层面的迁移：发布快照里的 props 按搭建当时的物料版本写，渲染前升到当前形状
  const upgraded = upgradeMaterials(result.data, materialVersions);
  warnings.push(...describeUpgrade(upgraded.report));
  return { dsl: upgraded.dsl, warnings };
}

/**
 * 预加载首屏关键图片。
 * 只等 critical 资源，且设了超时——图片 CDN 抖动不该把整页卡在加载态。
 */
export async function preloadCriticalImages(dsl: FinalDsl, timeoutMs = 3000): Promise<void> {
  const urls = dsl.assets.filter((a) => a.critical && a.type === 'image').map((a) => a.url);
  if (urls.length === 0) return;

  // 同时挂 <link rel=preload>：在支持的浏览器里能和 JS 执行并行、且优先级更高
  for (const url of urls) {
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = url;
    link.setAttribute('fetchpriority', 'high');
    document.head.appendChild(link);
  }

  await Promise.race([
    Promise.all(
      urls.map(
        (url) =>
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve();
            img.src = url;
          }),
      ),
    ),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}
