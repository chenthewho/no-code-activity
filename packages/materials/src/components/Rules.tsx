import { useState, type CSSProperties } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, dp, mergeStyle, type CommonStyleProps } from '../utils/style';

export interface RulesProps extends CommonStyleProps {
  /** inline：直接铺在页面上；dialog：收成一个入口按钮，点开才看 */
  mode?: 'inline' | 'dialog';
  title?: string;
  /** 规则正文，一行一条 */
  content?: string;
  /** 自动给每条加序号 */
  ordered?: boolean;
  entryText?: string;
  dialogTitle?: string;
  closeText?: string;
  titleColor?: string;
  titleFontSize?: number;
  color?: string;
  fontSize?: number;
  lineHeight?: number;
  buttonColor?: string;
  buttonImage?: string;
  buttonTextColor?: string;
}

/** 一行一条，顺手滤掉空行——运营在文本框里敲回车分段是常态 */
function toLines(content: string | undefined): string[] {
  if (!content) return [];
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * 活动规则。
 *
 * 两种形态都留着：规则短就直接铺在页面底部，长了（十几条的抽奖规则很常见）
 * 就收成一个入口按钮，否则一页全是小字，主行动点被挤到屏幕外。
 */
function Rules({
  children: _children,
  emit,
  editing,
  ...props
}: MaterialComponentProps<RulesProps>) {
  const [open, setOpen] = useState(false);
  const lines = toLines(props.content);

  const fontSize = dp(props.fontSize ?? 24);
  const color = props.color || '#999999';
  const bodyStyle: CSSProperties = { color, fontSize, lineHeight: props.lineHeight ?? 1.8 };
  const titleStyle: CSSProperties = {
    color: props.titleColor || '#333333',
    fontSize: dp(props.titleFontSize ?? 30),
  };

  const list =
    lines.length === 0 ? (
      <div className="nca-rules__empty">请填写活动规则</div>
    ) : (
      <div className="nca-rules__list" style={bodyStyle}>
        {lines.map((line, i) => (
          <p key={i} className="nca-rules__item">
            {props.ordered !== false && <span className="nca-rules__index">{i + 1}.</span>}
            {line}
          </p>
        ))}
      </div>
    );

  if (props.mode !== 'dialog') {
    return (
      <div className="nca-rules" style={mergeStyle(commonStyle(props), {})}>
        {props.title !== '' && (
          <div className="nca-rules__title" style={titleStyle}>
            {props.title ?? '活动规则'}
          </div>
        )}
        {list}
      </div>
    );
  }

  return (
    <>
      <div className="nca-rules nca-rules--entry" style={mergeStyle(commonStyle(props), {})}>
        <button
          type="button"
          className="nca-rules__btn"
          style={{
            backgroundImage: props.buttonImage ? `url(${props.buttonImage})` : undefined,
            backgroundColor: props.buttonImage ? 'transparent' : props.buttonColor || 'transparent',
            color: props.buttonTextColor || color,
            fontSize,
          }}
          onClick={() => {
            emit?.('open');
            // 编辑态不弹：画布里的点击本就被交互层拦着，弹出来也只会挡住页面
            if (!editing) setOpen(true);
          }}
        >
          {props.entryText ?? '活动规则'}
        </button>
      </div>
      {open && (
        <div className="nca-dialog" onClick={() => setOpen(false)}>
          <div className="nca-dialog__panel" onClick={(e) => e.stopPropagation()}>
            <div className="nca-dialog__title">
              {props.dialogTitle ?? props.title ?? '活动规则'}
            </div>
            <div className="nca-rules__scroll">{list}</div>
            <div className="nca-dialog__footer">
              <button
                type="button"
                className="nca-dialog__btn nca-dialog__btn--primary"
                style={{
                  backgroundColor: props.buttonColor || undefined,
                  color: props.buttonTextColor || undefined,
                }}
                onClick={() => {
                  setOpen(false);
                  emit?.('close');
                }}
              >
                {props.closeText ?? '我知道了'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export const RulesMaterial = defineMaterial<RulesProps>({
  Component: Rules,
  meta: defineMeta({
    name: 'Rules',
    version: '1.0.0',
    title: '活动规则',
    category: MATERIAL_CATEGORY.BUSINESS,
    icon: 'file-text',
    description: '一行一条的活动规则，可直接铺在页面上，也可收成按钮点开看',
    defaultProps: {
      mode: 'inline',
      title: '活动规则',
      ordered: true,
      entryText: '活动规则',
      closeText: '我知道了',
      color: '#999999',
      fontSize: 24,
      lineHeight: 1.8,
      titleColor: '#333333',
      titleFontSize: 30,
    },
    events: [
      { name: 'open', label: '点击查看规则', payloadKeys: [] },
      { name: 'close', label: '关闭规则弹窗', payloadKeys: [] },
    ],
    propsSchema: [
      prop({
        key: 'mode',
        label: '展示形态',
        editor: 'radio',
        options: [
          { label: '直接铺开', value: 'inline' },
          { label: '按钮点开', value: 'dialog' },
        ],
      }),
      prop({
        key: 'content',
        label: '规则正文',
        editor: 'textarea',
        bindable: true,
        help: '一行一条，空行会被忽略',
      }),
      prop({ key: 'ordered', label: '自动编号', editor: 'boolean' }),
      prop({
        key: 'title',
        label: '标题',
        editor: 'string',
        visibleWhen: "{{ props.mode === 'inline' }}",
      }),
      prop({
        key: 'entryText',
        label: '入口按钮文案',
        editor: 'string',
        visibleWhen: "{{ props.mode === 'dialog' }}",
      }),
      prop({
        key: 'dialogTitle',
        label: '弹窗标题',
        editor: 'string',
        visibleWhen: "{{ props.mode === 'dialog' }}",
      }),
      prop({
        key: 'closeText',
        label: '关闭按钮文案',
        editor: 'string',
        visibleWhen: "{{ props.mode === 'dialog' }}",
      }),
      styleProp({ key: 'color', label: '正文颜色', editor: 'color' }),
      styleProp({ key: 'fontSize', label: '正文字号', editor: 'number', min: 8, max: 100 }),
      styleProp({ key: 'lineHeight', label: '行高', editor: 'number', min: 1, max: 4, step: 0.1 }),
      styleProp({
        key: 'titleColor',
        label: '标题颜色',
        editor: 'color',
        visibleWhen: "{{ props.mode === 'inline' }}",
      }),
      styleProp({
        key: 'titleFontSize',
        label: '标题字号',
        editor: 'number',
        min: 8,
        max: 120,
        visibleWhen: "{{ props.mode === 'inline' }}",
      }),
      styleProp({
        key: 'buttonImage',
        label: '按钮图',
        editor: 'image',
        visibleWhen: "{{ props.mode === 'dialog' }}",
      }),
      styleProp({ key: 'buttonColor', label: '按钮底色', editor: 'color' }),
      styleProp({ key: 'buttonTextColor', label: '按钮文字色', editor: 'color' }),
      ...commonStyleSchema,
    ],
  }),
});
