import type { CSSProperties } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop } from '../utils/schema';
import { commonStyle, dp, mergeStyle, type CommonStyleProps } from '../utils/style';

export interface ContainerProps extends CommonStyleProps {
  direction?: 'row' | 'column';
  justify?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | 'space-around';
  align?: 'flex-start' | 'center' | 'flex-end' | 'stretch';
  gap?: number;
  wrap?: boolean;
  position?: 'static' | 'relative' | 'absolute';
  top?: number;
  left?: number;
  zIndex?: number;
}

function Container({ children, ...props }: MaterialComponentProps<ContainerProps>) {
  const layout: CSSProperties = {
    display: 'flex',
    flexDirection: props.direction ?? 'column',
    justifyContent: props.justify ?? 'flex-start',
    alignItems: props.align ?? 'stretch',
    gap: props.gap ? dp(props.gap) : undefined,
    flexWrap: props.wrap ? 'wrap' : undefined,
    position: props.position === 'static' ? undefined : props.position,
    top: props.top === undefined ? undefined : dp(props.top),
    left: props.left === undefined ? undefined : dp(props.left),
    zIndex: props.zIndex,
  };
  return (
    <div className="nca-container" style={mergeStyle(commonStyle(props), layout)}>
      {children}
    </div>
  );
}

export const ContainerMaterial = defineMaterial<ContainerProps>({
  Component: Container,
  meta: defineMeta({
    name: 'Container',
    version: '1.0.0',
    title: '容器',
    category: MATERIAL_CATEGORY.CONTAINER,
    icon: 'box',
    description: 'Flex 布局容器，用于分组与定位子元素',
    isContainer: true,
    defaultProps: { direction: 'column', justify: 'flex-start', align: 'stretch', gap: 0 },
    events: [{ name: 'click', label: '点击', payloadKeys: [] }],
    propsSchema: [
      prop({
        key: 'direction',
        label: '排列方向',
        editor: 'radio',
        options: [
          { label: '纵向', value: 'column' },
          { label: '横向', value: 'row' },
        ],
      }),
      prop({
        key: 'justify',
        label: '主轴对齐',
        editor: 'select',
        options: [
          { label: '起始', value: 'flex-start' },
          { label: '居中', value: 'center' },
          { label: '末尾', value: 'flex-end' },
          { label: '两端', value: 'space-between' },
          { label: '环绕', value: 'space-around' },
        ],
      }),
      prop({
        key: 'align',
        label: '交叉轴对齐',
        editor: 'select',
        options: [
          { label: '起始', value: 'flex-start' },
          { label: '居中', value: 'center' },
          { label: '末尾', value: 'flex-end' },
          { label: '拉伸', value: 'stretch' },
        ],
      }),
      prop({ key: 'gap', label: '子元素间距', editor: 'number', min: 0 }),
      prop({ key: 'wrap', label: '自动换行', editor: 'boolean' }),
      prop({
        key: 'position',
        label: '定位方式',
        editor: 'select',
        options: [
          { label: '默认', value: 'static' },
          { label: '相对', value: 'relative' },
          { label: '绝对', value: 'absolute' },
        ],
      }),
      prop({
        key: 'top',
        label: '距顶部',
        editor: 'number',
        visibleWhen: "{{ props.position === 'absolute' }}",
      }),
      prop({
        key: 'left',
        label: '距左侧',
        editor: 'number',
        visibleWhen: "{{ props.position === 'absolute' }}",
      }),
      prop({ key: 'zIndex', label: '层级', editor: 'number' }),
      ...commonStyleSchema,
    ],
  }),
});
