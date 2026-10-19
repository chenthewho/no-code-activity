import { ROOT_NODE_ID } from '@nca/shared';
import type { FinalDsl } from './schema/dsl';
import type { JsonValue } from './schema/primitives';

/** 看起来是图片的 props 键名。按键名判断而不是按扩展名：CDN 图片地址常常不带扩展名 */
const IMAGE_KEY = /(^|[a-z])(src|image|img|bg|background|cover|avatar|banner|poster|icon)/i;
const IMAGE_URL = /^(https?:)?\/\/|^\//;

/** 首屏关键图片最多预加载几张：再多就是在跟首屏 JS 抢带宽了 */
const DEFAULT_LIMIT = 4;

function imageUrlsIn(value: JsonValue, keyHint: boolean, out: string[]): void {
  if (typeof value === 'string') {
    if (keyHint && IMAGE_URL.test(value) && !value.includes('{{')) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    // 轮播这类列表只有第一项在首屏
    if (value.length > 0) imageUrlsIn(value[0]!, keyHint, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value))
      imageUrlsIn(child, keyHint || IMAGE_KEY.test(key), out);
  }
}

/**
 * 发布时自动标出首屏关键图片（assets[].critical），渲染器启动时据此预加载。
 *
 * 按渲染顺序从 ROOT 深度优先找前几张静态图片地址；弹窗、隐藏节点、条件/循环节点跳过——
 * 它们首屏不一定出现，预加载了反而跟真正的首屏资源抢带宽。运营手工标过的保留不动。
 */
export function withCriticalAssets(dsl: FinalDsl, limit = DEFAULT_LIMIT): FinalDsl {
  const existing = new Set(dsl.assets.map((a) => a.url));
  const found: string[] = [];
  if (dsl.meta.theme.backgroundImage) found.push(dsl.meta.theme.backgroundImage);

  const visit = (id: string): void => {
    if (found.length >= limit) return;
    const node = dsl.craftJson[id];
    if (!node || node.hidden || node.control?.if || node.control?.loop) return;
    if (node.type.resolvedName === 'Modal') return;
    imageUrlsIn(node.props as JsonValue, false, found);
    for (const child of node.nodes) visit(child);
    for (const slot of Object.values(node.linkedNodes)) visit(slot);
  };
  visit(ROOT_NODE_ID);

  const fresh = [...new Set(found)].filter((url) => !existing.has(url)).slice(0, limit);
  if (fresh.length === 0) return dsl;
  return {
    ...dsl,
    assets: [
      ...dsl.assets,
      ...fresh.map((url, i) => ({
        id: `auto_critical_${i + 1}`,
        url,
        type: 'image' as const,
        critical: true,
      })),
    ],
  };
}
