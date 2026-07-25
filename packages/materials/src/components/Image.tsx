import type { CSSProperties } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, mergeStyle, type CommonStyleProps } from '../utils/style';

export interface ImageProps extends CommonStyleProps {
  src?: string;
  alt?: string;
  objectFit?: 'cover' | 'contain' | 'fill';
  /** 懒加载。首屏图应关掉，并在 DSL assets 里标 critical */
  lazy?: boolean;
}

function Image({ children: _children, emit, ...props }: MaterialComponentProps<ImageProps>) {
  const style: CSSProperties = {
    objectFit: props.objectFit ?? 'cover',
    display: 'block',
    width: props.width === undefined ? '100%' : undefined,
  };
  if (!props.src) {
    return <div className="nca-image nca-image--empty">图片</div>;
  }
  return (
    <img
      className="nca-image"
      src={props.src}
      alt={props.alt ?? ''}
      loading={props.lazy ? 'lazy' : 'eager'}
      style={mergeStyle(commonStyle(props), style)}
      onClick={() => emit?.('click')}
    />
  );
}

export const ImageMaterial = defineMaterial<ImageProps>({
  Component: Image,
  meta: defineMeta({
    name: 'Image',
    version: '1.0.0',
    title: '图片',
    category: MATERIAL_CATEGORY.MEDIA,
    icon: 'image',
    defaultProps: { objectFit: 'cover', lazy: true },
    events: [{ name: 'click', label: '点击', payloadKeys: [] }],
    propsSchema: [
      prop({ key: 'src', label: '图片', editor: 'image', bindable: true }),
      prop({ key: 'alt', label: '替代文本', editor: 'string', help: '图片加载失败时展示，利于无障碍' }),
      styleProp({
        key: 'objectFit',
        label: '填充方式',
        editor: 'select',
        options: [
          { label: '覆盖', value: 'cover' },
          { label: '包含', value: 'contain' },
          { label: '拉伸', value: 'fill' },
        ],
      }),
      prop({ key: 'lazy', label: '懒加载', editor: 'boolean', help: '首屏图片建议关闭' }),
      ...commonStyleSchema,
    ],
  }),
});
