import type { MaterialMeta, PropSchemaItem } from '@nca/dsl';

type PropInput = Omit<PropSchemaItem, 'group' | 'bindable'> &
  Partial<Pick<PropSchemaItem, 'group' | 'bindable'>>;

/** 补齐 propsSchema 默认字段，让物料声明保持精简 */
export function prop(item: PropInput): PropSchemaItem {
  return { group: 'props', bindable: false, ...item };
}

export function styleProp(item: PropInput): PropSchemaItem {
  return prop({ ...item, group: 'style' });
}

type MetaInput = Omit<
  MaterialMeta,
  'isContainer' | 'slots' | 'propsSchema' | 'events' | 'defaultProps'
> &
  Partial<Pick<MaterialMeta, 'isContainer' | 'slots' | 'propsSchema' | 'events' | 'defaultProps'>>;

/**
 * 不走 zod.parse，避免物料包在运行时依赖 zod（渲染器体积敏感）。
 * 协议一致性由 materials.test.ts 在 CI 里用 materialMetaSchema 兜底。
 */
export function defineMeta(input: MetaInput): MaterialMeta {
  return {
    isContainer: false,
    slots: [],
    propsSchema: [],
    events: [],
    defaultProps: {},
    ...input,
  };
}

/** 宽高/间距/圆角等通用样式项，各物料按需展开，保证设置器体验一致 */
export const commonStyleSchema: PropSchemaItem[] = [
  styleProp({ key: 'width', label: '宽度', editor: 'string', placeholder: '如 100% / 375' }),
  styleProp({ key: 'height', label: '高度', editor: 'string', placeholder: '如 auto / 200' }),
  styleProp({ key: 'margin', label: '外边距', editor: 'spacing' }),
  styleProp({ key: 'padding', label: '内边距', editor: 'spacing' }),
  styleProp({ key: 'backgroundColor', label: '背景色', editor: 'color' }),
  styleProp({ key: 'borderRadius', label: '圆角', editor: 'number', min: 0, max: 999 }),
  styleProp({ key: 'opacity', label: '透明度', editor: 'number', min: 0, max: 1, step: 0.05 }),
];
