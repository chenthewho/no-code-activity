import type { FinalDsl } from '@nca/dsl';
import { getMaterial } from '@nca/materials';
import { MATERIAL_CATEGORY, ROOT_NODE_ID } from '@nca/shared';
import { trackAnalytics } from './analytics';

/**
 * 逐节点曝光：组件有一半进入视口（比视口还高的组件，占满半屏也算）记一次，
 * 每次访问每个节点只记一次——和点击、转化一除，就是这个组件的点击率、转化率。
 *
 * 只给「值得算转化」的节点上报：绑了事件的组件，以及业务组件（抽奖、表单、预约……）。
 * 纯展示的文字图片每个都报一遍，埋点量会翻几十倍，报表里也没人看。
 *
 * 后台标签页里打开的页面，等切回前台、人真的看到了再记。
 */

export function exposureTargets(dsl: FinalDsl): Set<string> {
  const ids = new Set(dsl.events.map((binding) => binding.nodeId));
  for (const [id, node] of Object.entries(dsl.craftJson)) {
    if (getMaterial(node.type.resolvedName)?.meta.category === MATERIAL_CATEGORY.BUSINESS) ids.add(id);
  }
  // 页面本身的曝光就是 PV，由 RuntimeProvider 单独记
  ids.delete(ROOT_NODE_ID);
  return ids;
}

const exposed = new Set<string>();
/** 被观察的元素 → 节点 id；循环渲染时同一个节点有多个元素，任一被看到即算 */
const targets = new Map<Element, string>();
/** 后台标签页里已经进入视口、等切回前台再记的 */
const waiting = new Map<Element, string>();
let observer: IntersectionObserver | null = null;

function seen(entry: IntersectionObserverEntry): boolean {
  if (!entry.isIntersecting) return false;
  const viewport = entry.rootBounds?.height ?? window.innerHeight;
  return entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= viewport / 2;
}

function record(nodeId: string): void {
  if (exposed.has(nodeId)) return;
  exposed.add(nodeId);
  trackAnalytics('expose', nodeId);
}

function onVisibilityChange(): void {
  if (document.visibilityState !== 'visible') return;
  for (const nodeId of waiting.values()) record(nodeId);
  waiting.clear();
}

function ensureObserver(): IntersectionObserver | null {
  if (observer) return observer;
  if (typeof IntersectionObserver === 'undefined') return null;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const nodeId = targets.get(entry.target);
        if (!nodeId || exposed.has(nodeId)) continue;
        if (!seen(entry)) {
          waiting.delete(entry.target);
        } else if (document.visibilityState === 'hidden') {
          waiting.set(entry.target, nodeId);
        } else {
          record(nodeId);
        }
      }
    },
    // 比例阈值之外再细分几档：比视口还高的组件 ratio 到不了 0.5，要靠可见高度判断
    { threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
  );
  document.addEventListener('visibilitychange', onVisibilityChange);
  return observer;
}

/** 开始观察一个节点的根元素，返回停止观察的函数 */
export function observeExposure(el: Element, nodeId: string): () => void {
  if (exposed.has(nodeId)) return () => {};
  const io = ensureObserver();
  if (!io) return () => {};
  targets.set(el, nodeId);
  io.observe(el);
  return () => {
    targets.delete(el);
    waiting.delete(el);
    io.unobserve(el);
  };
}

/** 只给测试用：清掉本次访问已记过的曝光 */
export function resetExposure(): void {
  observer?.disconnect();
  observer = null;
  exposed.clear();
  targets.clear();
  waiting.clear();
  if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
}
