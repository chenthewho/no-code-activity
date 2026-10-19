import { migrateDsl, validateFinalDsl, type FinalDsl } from '@nca/dsl';
import { describeUpgrade, knownMaterialNames, materialVersions, upgradeMaterials } from '@nca/materials';

export interface LoadResult {
  dsl: FinalDsl;
  warnings: string[];
}

/**
 * 加载并校验 DSL。
 *
 * 校验策略与服务端刻意不同：服务端在发布时用严格模式把关，
 * 这里是最后一道防线，目标是「尽可能把页面渲染出来」——
 * 结构错误直接抛出走错误页，warning 只记录不阻断。
 */
export async function loadDsl(url: string, signal?: AbortSignal): Promise<LoadResult> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`DSL 加载失败：HTTP ${response.status}`);
  }
  const raw: unknown = await response.json();
  return parseDsl(raw);
}

export function parseDsl(raw: unknown): LoadResult {
  const migrated = migrateDsl(raw);
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
    throw new Error(`DSL 校验失败\n${detail}`);
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
