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
}

function Container({ children, ...props }: MaterialComponentProps<ContainerProps>) {
  const layout: CSSProperties = {
    display: 'flex',
    flexDirection: props.direction ?? 'column',
    justifyContent: props.justify ?? 'flex-start',
    alignItems: props.align ?? 'stretch',
    gap: props.gap ? dp(props.gap) : undefined,
    flexWrap: props.wrap ? 'wrap' : undefined,
    /**
     * 没显式指定时兜底 relative——自由摆放的子元素要以「它所在的容器」为参照系。
     * 容器若是 static，子元素的坐标会一路上溯到某个祖先甚至整页，
     * 于是「拖到容器里的这个位置」和最终落点对不上。
     * relative 本身不改变流式布局，加上没有副作用。
     */
    position: props.position ? undefined : 'relative',
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
      // 定位方式 / top / left / zIndex 已由 commonStyleSchema 统一提供
      ...commonStyleSchema,
    ],
  }),
});
