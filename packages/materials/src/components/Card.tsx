import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, dp, mergeStyle, type CommonStyleProps } from '../utils/style';

export interface CardProps extends CommonStyleProps {
  title?: string;
  cardColor?: string;
}

/**
 * 卡片容器，演示具名插槽：header / body / footer 三个 slot 由设计器分别挂子节点。
 * body 没挂 slot 时退回普通子节点（children），兼容没有插槽能力的旧用法。
 */
function Card({ children, slotContent, ...props }: MaterialComponentProps<CardProps>) {
  const header = slotContent?.header;
  const body = slotContent?.body ?? children;
  const footer = slotContent?.footer;
  const showHeader = header || Boolean(props.title);

  return (
    <div
      style={mergeStyle(commonStyle(props), {
        backgroundColor: props.cardColor || '#ffffff',
        borderRadius: dp(12),
        overflow: 'hidden',
      })}
    >
      {showHeader ? (
        <div style={{ padding: dp(24), borderBottom: '1px solid #f0f0f0' }}>
          {props.title ? (
            <div style={{ fontSize: dp(32), fontWeight: 'bold', color: '#333', marginBottom: header ? dp(8) : 0 }}>
              {props.title}
            </div>
          ) : null}
          {header}
        </div>
      ) : null}
      <div style={{ padding: dp(24) }}>{body}</div>
      {footer ? (
        <div style={{ padding: dp(24), borderTop: '1px solid #f0f0f0' }}>{footer}</div>
      ) : null}
    </div>
  );
}

export const CardMaterial = defineMaterial<CardProps>({
  Component: Card,
  meta: defineMeta({
    name: 'Card',
    version: '1.0.0',
    title: '卡片',
    category: MATERIAL_CATEGORY.CONTAINER,
    icon: 'credit-card',
    description: '带 header/body/footer 三个具名插槽的卡片容器，各插槽可分别挂内容',
    isContainer: true,
    slots: ['header', 'body', 'footer'],
    defaultProps: { title: '卡片标题', cardColor: '#ffffff' },
    events: [],
    propsSchema: [
      prop({ key: 'title', label: '卡片标题', editor: 'string' }),
      styleProp({ key: 'cardColor', label: '背景色', editor: 'color' }),
      ...commonStyleSchema,
    ],
  }),
});
