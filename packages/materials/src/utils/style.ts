import type { CSSProperties } from 'react';

/** 设计器 spacing 控件产出的四值结构 */
export interface Spacing {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/**
 * 设计稿像素 → CSS 长度。
 *
 * 输出 rem 而非 px 是整套移动端适配的关键：渲染器把根字号设成
 * `100 × 视口宽 / 设计稿宽`，于是 1rem 恒等于 100 个设计稿像素，
 * 换算不需要知道设计稿宽度，物料因此与具体稿子解耦。
 * 直接写 px 的话，750 的稿子搬到 390 的手机上就会整体放大近一倍。
 */
export function dp(value: number): string {
  return `${value / 100}rem`;
}

export function spacingToCss(value: Spacing | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return dp(value);
  const { top = 0, right = 0, bottom = 0, left = 0 } = value;
  return `${dp(top)} ${dp(right)} ${dp(bottom)} ${dp(left)}`;
}

/** 数值按设计稿像素换算；字符串原样透传，允许运营填 100% / auto / 50vw */
export function toSize(value: number | string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  return typeof value === 'number' ? dp(value) : value;
}

export interface CommonStyleProps {
  width?: number | string;
  height?: number | string;
  margin?: Spacing | number;
  padding?: Spacing | number;
  backgroundColor?: string;
  borderRadius?: number;
  opacity?: number;
}

/** 所有物料共用的样式段，保证「宽高/间距/圆角」在设置器里的行为一致 */
export function commonStyle(props: CommonStyleProps): CSSProperties {
  return {
    width: toSize(props.width),
    height: toSize(props.height),
    margin: spacingToCss(props.margin),
    padding: spacingToCss(props.padding),
    backgroundColor: props.backgroundColor || undefined,
    borderRadius: props.borderRadius ? dp(props.borderRadius) : undefined,
    opacity: props.opacity === undefined ? undefined : props.opacity,
  };
}

/** 合并样式，后者覆盖前者，并丢掉 undefined 以免覆盖有效值 */
export function mergeStyle(...styles: (CSSProperties | undefined)[]): CSSProperties {
  const result: CSSProperties = {};
  for (const style of styles) {
    if (!style) continue;
    for (const [key, value] of Object.entries(style)) {
      if (value !== undefined) {
        (result as Record<string, unknown>)[key] = value;
      }
    }
  }
  return result;
}
