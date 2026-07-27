import type { CSSProperties } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { defineMeta, styleProp } from '../utils/schema';
import { dp, toSize } from '../utils/style';

export interface PageProps {
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundRepeat?: 'no-repeat' | 'repeat' | 'repeat-y';
  backgroundSize?: 'cover' | 'contain' | '100% auto';
  minHeight?: number | string;
  paddingBottom?: number;
}

function Page({ children, ...props }: MaterialComponentProps<PageProps>) {
  const style: CSSProperties = {
    // 根容器兜住所有自由摆放的元素：顶层节点的 top/left 以整页左上角为原点
    position: 'relative',
    backgroundColor: props.backgroundColor || '#ffffff',
    backgroundImage: props.backgroundImage ? `url(${props.backgroundImage})` : undefined,
    backgroundRepeat: props.backgroundRepeat ?? 'no-repeat',
    backgroundSize: props.backgroundSize ?? '100% auto',
    minHeight: toSize(props.minHeight) ?? '100vh',
    paddingBottom: props.paddingBottom ? dp(props.paddingBottom) : undefined,
  };
  return (
    <div className="nca-page" style={style}>
      {children}
    </div>
  );
}

export const PageMaterial = defineMaterial<PageProps>({
  Component: Page,
  meta: defineMeta({
    name: 'Page',
    version: '1.0.0',
    title: '页面',
    category: MATERIAL_CATEGORY.CONTAINER,
    icon: 'layout',
    description: '活动页根容器，每份 DSL 有且仅有一个，不可删除',
    isContainer: true,
    defaultProps: {
      backgroundColor: '#ffffff',
      backgroundSize: '100% auto',
      backgroundRepeat: 'no-repeat',
    },
    propsSchema: [
      styleProp({ key: 'backgroundColor', label: '背景色', editor: 'color' }),
      styleProp({ key: 'backgroundImage', label: '背景图', editor: 'image', bindable: true }),
      styleProp({
        key: 'backgroundSize',
        label: '背景尺寸',
        editor: 'select',
        options: [
          { label: '宽度铺满', value: '100% auto' },
          { label: '覆盖', value: 'cover' },
          { label: '包含', value: 'contain' },
        ],
      }),
      styleProp({
        key: 'backgroundRepeat',
        label: '背景重复',
        editor: 'select',
        options: [
          { label: '不重复', value: 'no-repeat' },
          { label: '重复', value: 'repeat' },
          { label: '纵向重复', value: 'repeat-y' },
        ],
      }),
      styleProp({ key: 'minHeight', label: '最小高度', editor: 'string', placeholder: '100vh' }),
      styleProp({ key: 'paddingBottom', label: '底部留白', editor: 'number', min: 0 }),
    ],
  }),
});
