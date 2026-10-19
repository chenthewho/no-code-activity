import type { PageConfig } from '@nca/dsl';

export interface ViewportInput {
  width: number;
  height: number;
  designWidth: PageConfig['designWidth'];
  adaptMode: PageConfig['adaptMode'];
}

export interface ViewportResult {
  /** 根字号：1rem = 100 设计像素 */
  rootFontSize: number;
  /** 非空时页面收成这么宽的一列居中显示 */
  frameWidth: number | null;
}

/** 宽于这个值的设计稿视为横版稿（如 SDK 横屏专属页面按 1334 出稿） */
const LANDSCAPE_DESIGN_MIN = 1000;
/** 横屏里放竖版稿时，列宽不小于主流手机竖屏宽，否则文字小到没法读 */
const MIN_COLUMN = 375;

/**
 * 页面适配。
 *
 * 竖屏：按视口宽等比缩放（上限两倍稿宽，避免 PC 上拉伸失真）。
 * 横屏里放竖版稿（SDK 横屏、PC 浏览器、平板横置）：按视口高收成一列 9:16 的手机宽
 * 居中显示——照旧按宽度缩放的话，一张 750 的稿子会被放大到横屏全宽，首屏只剩个头图。
 * 横版稿在横屏里照常按宽度缩放。fixed 模式不缩放。
 */
export function computeViewport({
  width,
  height,
  designWidth,
  adaptMode,
}: ViewportInput): ViewportResult {
  if (adaptMode === 'fixed') return { rootFontSize: 100, frameWidth: null };

  if (width > height && designWidth < LANDSCAPE_DESIGN_MIN) {
    const column = Math.round(
      Math.min(width, Math.max(Math.min(width, MIN_COLUMN), (height * 9) / 16)),
    );
    return { rootFontSize: (column / designWidth) * 100, frameWidth: column };
  }

  const basis = Math.min(width, designWidth * 2);
  return { rootFontSize: (basis / designWidth) * 100, frameWidth: null };
}
