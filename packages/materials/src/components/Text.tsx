import type { CSSProperties } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, mergeStyle, type CommonStyleProps } from '../utils/style';

export interface TextProps extends CommonStyleProps {
  content?: string;
  fontSize?: number;
  color?: string;
  fontWeight?: 'normal' | 'bold';
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number;
  letterSpacing?: number;
  /** 超出行数省略，0 表示不限制 */
  ellipsisRows?: number;
}

function Text({ children: _children, emit, ...props }: MaterialComponentProps<TextProps>) {
  const rows = props.ellipsisRows ?? 0;
  const style: CSSProperties = {
    fontSize: props.fontSize ? `${props.fontSize}px` : undefined,
    color: props.color || undefined,
    fontWeight: props.fontWeight ?? 'normal',
    textAlign: props.textAlign ?? 'left',
    lineHeight: props.lineHeight ?? 1.5,
    letterSpacing: props.letterSpacing ? `${props.letterSpacing}px` : undefined,
    ...(rows > 0
      ? {
          display: '-webkit-box',
          WebkitBoxOrient: 'vertical' as const,
          WebkitLineClamp: rows,
          overflow: 'hidden',
        }
      : null),
  };
  return (
    <div
      className="nca-text"
      style={mergeStyle(commonStyle(props), style)}
      onClick={() => emit?.('click')}
    >
      {props.content ?? ''}
    </div>
  );
}

export const TextMaterial = defineMaterial<TextProps>({
  Component: Text,
  meta: defineMeta({
    name: 'Text',
    version: '1.0.0',
    title: '文本',
    category: MATERIAL_CATEGORY.BASIC,
    icon: 'type',
    defaultProps: { content: '文本内容', fontSize: 28, color: '#333333', lineHeight: 1.5 },
    events: [{ name: 'click', label: '点击', payloadKeys: [] }],
    propsSchema: [
      prop({ key: 'content', label: '内容', editor: 'textarea', bindable: true }),
      styleProp({ key: 'fontSize', label: '字号', editor: 'number', min: 8, max: 200 }),
      styleProp({ key: 'color', label: '颜色', editor: 'color' }),
      styleProp({
        key: 'fontWeight',
        label: '字重',
        editor: 'radio',
        options: [
          { label: '常规', value: 'normal' },
          { label: '加粗', value: 'bold' },
        ],
      }),
      styleProp({
        key: 'textAlign',
        label: '对齐',
        editor: 'radio',
        options: [
          { label: '左', value: 'left' },
          { label: '中', value: 'center' },
          { label: '右', value: 'right' },
        ],
      }),
      styleProp({ key: 'lineHeight', label: '行高倍数', editor: 'number', min: 1, max: 4, step: 0.1 }),
      styleProp({ key: 'letterSpacing', label: '字间距', editor: 'number', min: 0 }),
      styleProp({
        key: 'ellipsisRows',
        label: '省略行数',
        editor: 'number',
        min: 0,
        max: 10,
        help: '0 表示不省略',
      }),
      ...commonStyleSchema,
    ],
  }),
});
