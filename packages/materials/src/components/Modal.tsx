import type { CSSProperties } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { defineMeta, prop, styleProp } from '../utils/schema';
import { dp, toSize } from '../utils/style';

export interface ModalProps {
  /** 由运行时的弹窗管理器注入，DSL 里通过 modal.open / modal.close 动作控制 */
  visible?: boolean;
  width?: number | string;
  backgroundColor?: string;
  backgroundImage?: string;
  borderRadius?: number;
  padding?: number;
  maskClosable?: boolean;
  showClose?: boolean;
  closeIcon?: string;
  /** 关闭按钮相对弹窗的位置 */
  closePosition?: 'inside-top-right' | 'outside-bottom';
}

function Modal({ children, emit, editing, ...props }: MaterialComponentProps<ModalProps>) {
  const panelStyle: CSSProperties = {
    width: toSize(props.width) ?? dp(600),
    backgroundColor: props.backgroundImage ? 'transparent' : props.backgroundColor || '#ffffff',
    backgroundImage: props.backgroundImage ? `url(${props.backgroundImage})` : undefined,
    backgroundSize: '100% 100%',
    borderRadius: dp(props.borderRadius ?? 16),
    padding: dp(props.padding ?? 32),
  };

  const closeBtn = props.showClose !== false && (
    <button
      type="button"
      className={`nca-modal__close nca-modal__close--${props.closePosition ?? 'inside-top-right'}`}
      onClick={(e) => {
        e.stopPropagation();
        emit?.('close');
      }}
      aria-label="关闭"
    >
      {props.closeIcon ? <img src={props.closeIcon} alt="" /> : '×'}
    </button>
  );

  /**
   * 编辑态与运行时走同一套结构：弹窗浮在蒙层上，关掉时完全不占位。
   *
   * 早先编辑态是平铺进页面的，弹窗既撑开了页面高度，又盖住它下面的组件——
   * 演示活动里中奖弹窗正好压在抽奖按钮上，点按钮点到的是弹窗里的文字。
   * 显隐改由设计器的开关控制（编辑态下 visible 来自设计器而非动作）。
   */
  if (!props.visible) return null;

  return (
    <div
      className={`nca-modal nca-modal--overlay${editing ? ' nca-modal--editing' : ''}`}
      onClick={() => {
        // 编辑态点蒙层不关闭：开关在设计器手上，这里关了它会立刻再打开
        if (!editing && props.maskClosable !== false) emit?.('close');
      }}
    >
      {/* 根元素是整块蒙层，选中框该框住的是这个面板，不是整个画布 */}
      <div
        className="nca-modal__panel"
        data-nca-frame=""
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {closeBtn}
        {children}
      </div>
    </div>
  );
}

export const ModalMaterial = defineMaterial<ModalProps>({
  Component: Modal,
  meta: defineMeta({
    name: 'Modal',
    version: '1.0.0',
    title: '弹窗',
    category: MATERIAL_CATEGORY.CONTAINER,
    icon: 'square',
    description: '默认隐藏，由「打开弹窗」动作唤起；编辑时用画布右侧的开关展开',
    isContainer: true,
    defaultProps: {
      width: 600,
      backgroundColor: '#ffffff',
      borderRadius: 16,
      padding: 32,
      maskClosable: true,
      showClose: true,
      closePosition: 'inside-top-right',
    },
    events: [
      { name: 'close', label: '关闭时', payloadKeys: [] },
      { name: 'open', label: '打开时', payloadKeys: [] },
    ],
    propsSchema: [
      prop({ key: 'maskClosable', label: '点击蒙层关闭', editor: 'boolean' }),
      prop({ key: 'showClose', label: '显示关闭按钮', editor: 'boolean' }),
      prop({
        key: 'closePosition',
        label: '关闭按钮位置',
        editor: 'select',
        visibleWhen: '{{ props.showClose }}',
        options: [
          { label: '弹窗内右上角', value: 'inside-top-right' },
          { label: '弹窗外下方', value: 'outside-bottom' },
        ],
      }),
      prop({
        key: 'closeIcon',
        label: '关闭图标',
        editor: 'image',
        visibleWhen: '{{ props.showClose }}',
      }),
      styleProp({ key: 'width', label: '宽度', editor: 'string', placeholder: '600' }),
      styleProp({ key: 'backgroundColor', label: '背景色', editor: 'color' }),
      styleProp({ key: 'backgroundImage', label: '背景图', editor: 'image' }),
      styleProp({ key: 'borderRadius', label: '圆角', editor: 'number', min: 0 }),
      styleProp({ key: 'padding', label: '内边距', editor: 'number', min: 0 }),
    ],
  }),
});
