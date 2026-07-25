import type { CSSProperties } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, mergeStyle, toSize, type CommonStyleProps } from '../utils/style';

export interface ButtonProps extends CommonStyleProps {
  text?: string;
  /** 背景图按钮：营销活动最常见的形态，填了就盖掉纯色底 */
  backgroundImage?: string;
  color?: string;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  disabled?: boolean;
  disabledText?: string;
  shape?: 'round' | 'rect';
}

function Button({ children: _children, emit, ...props }: MaterialComponentProps<ButtonProps>) {
  const disabled = Boolean(props.disabled);
  const style: CSSProperties = {
    color: props.color || '#ffffff',
    fontSize: props.fontSize ? `${props.fontSize}px` : '30px',
    fontWeight: props.fontWeight ?? 'bold',
    backgroundImage: props.backgroundImage ? `url(${props.backgroundImage})` : undefined,
    backgroundSize: props.backgroundImage ? '100% 100%' : undefined,
    backgroundColor: props.backgroundImage ? 'transparent' : props.backgroundColor || '#1677ff',
    borderRadius:
      props.shape === 'rect' ? `${props.borderRadius ?? 8}px` : `${props.borderRadius ?? 999}px`,
    width: toSize(props.width) ?? '400px',
    height: toSize(props.height) ?? '88px',
    opacity: disabled ? 0.5 : props.opacity,
  };
  return (
    <button
      type="button"
      className="nca-button"
      disabled={disabled}
      style={mergeStyle(commonStyle(props), style)}
      onClick={() => {
        if (disabled) return;
        emit?.('click');
      }}
    >
      {disabled && props.disabledText ? props.disabledText : (props.text ?? '按钮')}
    </button>
  );
}

export const ButtonMaterial = defineMaterial<ButtonProps>({
  Component: Button,
  meta: defineMeta({
    name: 'Button',
    version: '1.0.0',
    title: '按钮',
    category: MATERIAL_CATEGORY.BASIC,
    icon: 'mouse-pointer',
    description: '活动主行动点，点击事件在「事件」面板里编排动作',
    defaultProps: {
      text: '立即参与',
      shape: 'round',
      backgroundColor: '#1677ff',
      color: '#ffffff',
      fontSize: 30,
      fontWeight: 'bold',
    },
    events: [{ name: 'click', label: '点击', payloadKeys: [] }],
    propsSchema: [
      prop({ key: 'text', label: '按钮文案', editor: 'string', bindable: true }),
      prop({ key: 'disabled', label: '禁用', editor: 'boolean', bindable: true }),
      prop({
        key: 'disabledText',
        label: '禁用文案',
        editor: 'string',
        bindable: true,
        visibleWhen: '{{ props.disabled }}',
      }),
      styleProp({
        key: 'shape',
        label: '形状',
        editor: 'radio',
        options: [
          { label: '胶囊', value: 'round' },
          { label: '圆角矩形', value: 'rect' },
        ],
      }),
      styleProp({ key: 'backgroundImage', label: '按钮图', editor: 'image', bindable: true }),
      styleProp({ key: 'color', label: '文字颜色', editor: 'color' }),
      styleProp({ key: 'fontSize', label: '字号', editor: 'number', min: 8, max: 120 }),
      styleProp({
        key: 'fontWeight',
        label: '字重',
        editor: 'radio',
        options: [
          { label: '常规', value: 'normal' },
          { label: '加粗', value: 'bold' },
        ],
      }),
      ...commonStyleSchema,
    ],
  }),
});
