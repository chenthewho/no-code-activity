import type { CSSProperties } from 'react';

/** 设计器 spacing 控件产出的四值结构 */
export interface Spacing {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export function spacingToCss(value: Spacing | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return `${value}px`;
  const { top = 0, right = 0, bottom = 0, left = 0 } = value;
  return `${top}px ${right}px ${bottom}px ${left}px`;
}

/** 数值按设计稿 px 输出；字符串原样透传，允许运营填 100% / auto / 50vw */
export function toSize(value: number | string | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  return typeof value === 'number' ? `${value}px` : value;
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
    borderRadius: props.borderRadius ? `${props.borderRadius}px` : undefined,
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
