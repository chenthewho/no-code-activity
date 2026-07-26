import type { CraftNode } from '@nca/dsl';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type TransformMode =
  | { kind: 'resize'; handle: ResizeHandle }
  | { kind: 'move' };

export interface TransformSession {
  nodeId: string;
  mode: TransformMode;
  /** 起手时的指针位置与元素盒子，全程以它为基准计算增量 */
  startX: number;
  startY: number;
  startBox: Box;
  /** 绝对定位节点起手时的 top/left（设计稿像素） */
  startTop: number;
  startLeft: number;
  box: Box;
}

/**
 * 画布的 CSS 像素 ↔ 设计稿像素换算比例。
 *
 * 渲染器把根字号设为「100 × 视口宽 / 设计稿宽」，即 1rem = 100 设计像素，
 * 于是 1 设计像素 = rootFontSize / 100 个 CSS 像素。拖拽拿到的是 CSS 像素，
 * 写回 props 的必须是设计稿像素，否则在不同宽度的画布上拖出来的值会不一样。
 */
export function canvasScale(): number {
  const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(root) && root > 0 ? root / 100 : 1;
}

export function toDesignPx(cssPx: number, scale = canvasScale()): number {
  return Math.round(cssPx / scale);
}

const MIN_SIZE = 8;

/** 依据手柄方向把指针增量换算成新的盒子 */
export function applyResize(session: TransformSession, x: number, y: number): Box {
  if (session.mode.kind !== 'resize') return session.startBox;

  const dx = x - session.startX;
  const dy = y - session.startY;
  const { top, left, width, height } = session.startBox;
  const handle = session.mode.handle;

  let nextWidth = width;
  let nextHeight = height;
  let nextTop = top;
  let nextLeft = left;

  if (handle.includes('e')) nextWidth = width + dx;
  if (handle.includes('w')) {
    nextWidth = width - dx;
    nextLeft = left + dx;
  }
  if (handle.includes('s')) nextHeight = height + dy;
  if (handle.includes('n')) {
    nextHeight = height - dy;
    nextTop = top + dy;
  }

  // 尺寸夹到最小值时，位置也要跟着停住，否则元素会一边缩到 0 一边继续滑
  if (nextWidth < MIN_SIZE) {
    if (handle.includes('w')) nextLeft = left + width - MIN_SIZE;
    nextWidth = MIN_SIZE;
  }
  if (nextHeight < MIN_SIZE) {
    if (handle.includes('n')) nextTop = top + height - MIN_SIZE;
    nextHeight = MIN_SIZE;
  }

  return { top: nextTop, left: nextLeft, width: nextWidth, height: nextHeight };
}

export function applyMove(session: TransformSession, x: number, y: number): Box {
  const dx = x - session.startX;
  const dy = y - session.startY;
  return {
    ...session.startBox,
    top: session.startBox.top + dy,
    left: session.startBox.left + dx,
  };
}

/** 绝对定位的节点才谈得上「拖到任意位置」，流式节点拖动的语义是重排 */
export function isAbsolute(node: CraftNode | undefined): boolean {
  return node?.props?.position === 'absolute';
}

/**
 * 把一次拖拽的结果整理成要写回的 props。
 * 只回传真正变了的字段，避免给不涉及的属性平白写上一个值。
 */
export function buildPatch(
  session: TransformSession,
  finalBox: Box,
  node: CraftNode | undefined,
): Record<string, number> {
  const scale = canvasScale();
  const patch: Record<string, number> = {};

  if (session.mode.kind === 'resize') {
    if (Math.abs(finalBox.width - session.startBox.width) >= 1) {
      patch.width = toDesignPx(finalBox.width, scale);
    }
    if (Math.abs(finalBox.height - session.startBox.height) >= 1) {
      patch.height = toDesignPx(finalBox.height, scale);
    }
  }

  // 位置只对绝对定位节点有意义；流式节点靠重排而不是坐标
  if (isAbsolute(node)) {
    const dTop = finalBox.top - session.startBox.top;
    const dLeft = finalBox.left - session.startBox.left;
    if (Math.abs(dTop) >= 1) patch.top = session.startTop + toDesignPx(dTop, scale);
    if (Math.abs(dLeft) >= 1) patch.left = session.startLeft + toDesignPx(dLeft, scale);
  }

  return patch;
}

export const HANDLES: { key: ResizeHandle; cursor: string; x: number; y: number }[] = [
  { key: 'nw', cursor: 'nwse-resize', x: 0, y: 0 },
  { key: 'n', cursor: 'ns-resize', x: 0.5, y: 0 },
  { key: 'ne', cursor: 'nesw-resize', x: 1, y: 0 },
  { key: 'e', cursor: 'ew-resize', x: 1, y: 0.5 },
  { key: 'se', cursor: 'nwse-resize', x: 1, y: 1 },
  { key: 's', cursor: 'ns-resize', x: 0.5, y: 1 },
  { key: 'sw', cursor: 'nesw-resize', x: 0, y: 1 },
  { key: 'w', cursor: 'ew-resize', x: 0, y: 0.5 },
];
