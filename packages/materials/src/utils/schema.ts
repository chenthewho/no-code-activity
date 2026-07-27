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

/** 布局分区的通用项，各物料按需展开，保证设置器体验一致 */
const layoutProp = (item: Parameters<typeof styleProp>[0]): PropSchemaItem => ({
  ...styleProp(item),
  section: 'layout',
});

/** 只在「自由摆放」下才有意义的坐标项，跟着定位方式一起显隐 */
const whenAbsolute = "{{ props.position === 'absolute' }}";

export const commonStyleSchema: PropSchemaItem[] = [
  layoutProp({
    key: 'position',
    label: '定位方式',
    editor: 'select',
    options: [
      { label: '跟随排版', value: 'static' },
      { label: '相对偏移', value: 'relative' },
      { label: '自由摆放', value: 'absolute' },
    ],
  }),
  layoutProp({ key: 'top', label: '距顶部', editor: 'number', visibleWhen: whenAbsolute }),
  layoutProp({ key: 'left', label: '距左侧', editor: 'number', visibleWhen: whenAbsolute }),
  layoutProp({ key: 'zIndex', label: '层级', editor: 'number' }),
  layoutProp({ key: 'width', label: '宽度', editor: 'string', placeholder: '如 100% / 375' }),
  layoutProp({ key: 'height', label: '高度', editor: 'string', placeholder: '如 auto / 200' }),
  layoutProp({ key: 'margin', label: '外边距', editor: 'spacing' }),
  layoutProp({ key: 'padding', label: '内边距', editor: 'spacing' }),
  styleProp({ key: 'backgroundColor', label: '背景色', editor: 'color' }),
  layoutProp({ key: 'borderRadius', label: '圆角', editor: 'number', min: 0, max: 999 }),
  layoutProp({ key: 'opacity', label: '透明度', editor: 'number', min: 0, max: 1, step: 0.05 }),
];
