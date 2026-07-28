import type { CraftNode, JsonValue } from '@nca/dsl';

export type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

/** 文档坐标系（含滚动量）下的盒子，覆盖层据此以 absolute 绘制 */
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
  /**
   * 起手时元素在包含块内的实际偏移（CSS 像素），从 DOM 量出来而不是读 props。
   * 读 props 只在「已经摆放过」时才对：刚切成绝对定位、top/left 还是空的时候，
   * 以 0 为基准算出来的位移会把元素直接甩到容器左上角。
   */
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

const px = (value: string): number => parseFloat(value) || 0;

/**
 * 元素当前在其包含块内的偏移，即「若此刻改成绝对定位，要写多少 top/left 才原地不动」。
 *
 * 三处修正缺一不可：
 * - 包含块的参照是内边距边，而 getBoundingClientRect 给的是边框边；
 * - 绝对定位下 top/left 定位的是外边距边，所以要把自身 margin 扣掉；
 * - 没有定位祖先时参照系是初始包含块，也就是文档原点，得算上滚动量。
 */
export function offsetInContainingBlock(el: HTMLElement): { top: number; left: number } {
  const rect = el.getBoundingClientRect();
  const own = getComputedStyle(el);
  const marginTop = px(own.marginTop);
  const marginLeft = px(own.marginLeft);
  const parent = el.offsetParent;

  if (!(parent instanceof HTMLElement)) {
    return {
      top: rect.top + window.scrollY - marginTop,
      left: rect.left + window.scrollX - marginLeft,
    };
  }

  const parentRect = parent.getBoundingClientRect();
  const parentStyle = getComputedStyle(parent);
  return {
    top: rect.top - parentRect.top - px(parentStyle.borderTopWidth) - marginTop,
    left: rect.left - parentRect.left - px(parentStyle.borderLeftWidth) - marginLeft,
  };
}

/**
 * 把一个流式节点转成自由摆放，且视觉上原地不动。
 *
 * 必须先量后写：绝对定位会让元素同时脱离文档流并收缩到内容宽度。
 * 只写 position 不补坐标和宽度的话，元素当场跳位又变窄——
 * 运营看到的就是「一选绝对定位页面就乱了」，于是再也不敢用。
 */
export function freeLayoutPatch(
  el: HTMLElement,
  node: CraftNode | undefined,
): Record<string, JsonValue> {
  const scale = canvasScale();
  const offset = offsetInContainingBlock(el);
  const patch: Record<string, JsonValue> = {
    position: 'absolute',
    top: toDesignPx(offset.top, scale),
    left: toDesignPx(offset.left, scale),
  };

  // 宽度没填过才冻结当前渲染宽度，避免覆盖运营自己写的 100% / auto
  const width = node?.props?.width;
  if (width === undefined || width === null || width === '') {
    patch.width = toDesignPx(el.getBoundingClientRect().width, scale);
  }
  return patch;
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
    // 先在 CSS 像素域里把起点和位移加完再换算，只舍入一次
    if (Math.abs(dTop) >= 1) patch.top = toDesignPx(session.startTop + dTop, scale);
    if (Math.abs(dLeft) >= 1) patch.left = toDesignPx(session.startLeft + dLeft, scale);
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
