import type { CSSProperties } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, dp, mergeStyle, type CommonStyleProps } from '../utils/style';

export interface RewardListProps extends CommonStyleProps {
  /** 通常绑定 {{ dataSource.rewards }} */
  data?: Record<string, unknown>[];
  nameKey?: string;
  imageKey?: string;
  descKey?: string;
  /** 状态字段，取值 ready / received / locked，缺省按 ready 处理 */
  statusKey?: string;
  layout?: 'list' | 'grid';
  columns?: number;
  maxCount?: number;
  showButton?: boolean;
  readyText?: string;
  receivedText?: string;
  lockedText?: string;
  emptyText?: string;
  color?: string;
  fontSize?: number;
  descColor?: string;
  descFontSize?: number;
  cardColor?: string;
  cardRadius?: number;
  buttonColor?: string;
  buttonTextColor?: string;
}

type RewardStatus = 'ready' | 'received' | 'locked';

function readStatus(value: unknown): RewardStatus {
  return value === 'received' || value === 'locked' ? value : 'ready';
}

/**
 * 奖励列表。
 *
 * 领没领到手是服务端说了算，物料只按 status 字段渲染三种态，
 * 点「领取」也只抛事件——库存扣减、防重复领取都必须在接口那侧做。
 */
function RewardList({
  children: _children,
  emit,
  ...props
}: MaterialComponentProps<RewardListProps>) {
  const raw = Array.isArray(props.data) ? props.data : [];
  const max = props.maxCount && props.maxCount > 0 ? props.maxCount : raw.length;
  const list = raw.slice(0, max);

  const nameKey = props.nameKey || 'name';
  const imageKey = props.imageKey || 'image';
  const descKey = props.descKey || 'desc';
  const statusKey = props.statusKey || 'status';

  const grid = props.layout === 'grid';
  const columns = Math.max(1, Math.min(5, props.columns ?? 3));

  const color = props.color || '#333333';
  const fontSize = dp(props.fontSize ?? 26);
  const cardStyle: CSSProperties = {
    backgroundColor: props.cardColor || '#ffffff',
    borderRadius: dp(props.cardRadius ?? 12),
    color,
    fontSize,
  };
  const descStyle: CSSProperties = {
    color: props.descColor || '#999999',
    fontSize: dp(props.descFontSize ?? 22),
  };

  if (list.length === 0) {
    return (
      <div className="nca-reward nca-reward--empty" style={commonStyle(props)}>
        {props.emptyText ?? '暂无奖励'}
      </div>
    );
  }

  const statusText = (status: RewardStatus) => {
    if (status === 'received') return props.receivedText ?? '已领取';
    if (status === 'locked') return props.lockedText ?? '未达成';
    return props.readyText ?? '领取';
  };

  return (
    <div
      className={`nca-reward nca-reward--${grid ? 'grid' : 'list'}`}
      style={mergeStyle(
        commonStyle(props),
        grid ? { gridTemplateColumns: `repeat(${columns}, 1fr)` } : {},
      )}
    >
      {list.map((item, i) => {
        const status = readStatus(item[statusKey]);
        return (
          <div
            key={String(item.id ?? item[nameKey] ?? i)}
            className={`nca-reward__card nca-reward__card--${status}`}
            style={cardStyle}
            onClick={() => emit?.('itemClick', { index: i, item })}
          >
            {item[imageKey] ? (
              <img className="nca-reward__img" src={String(item[imageKey])} alt="" />
            ) : (
              <span className="nca-reward__img nca-reward__img--empty" />
            )}
            <div className="nca-reward__info">
              <span className="nca-reward__name">{String(item[nameKey] ?? '')}</span>
              {item[descKey] ? (
                <span className="nca-reward__desc" style={descStyle}>
                  {String(item[descKey])}
                </span>
              ) : null}
            </div>
            {props.showButton !== false && (
              <button
                type="button"
                className="nca-reward__btn"
                disabled={status !== 'ready'}
                style={{
                  backgroundColor: status === 'ready' ? props.buttonColor || '#ff4d4f' : '#e8e8e8',
                  color: status === 'ready' ? props.buttonTextColor || '#ffffff' : '#999999',
                  fontSize: dp(props.descFontSize ?? 22),
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (status !== 'ready') return;
                  emit?.('receive', { index: i, item });
                }}
              >
                {statusText(status)}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const RewardListMaterial = defineMaterial<RewardListProps>({
  Component: RewardList,
  meta: defineMeta({
    name: 'RewardList',
    version: '1.0.0',
    title: '奖励列表',
    category: MATERIAL_CATEGORY.BUSINESS,
    icon: 'gift-box',
    description: '按数据源渲染奖励，支持已领取/未达成三态，点领取抛 receive 事件',
    defaultProps: {
      nameKey: 'name',
      imageKey: 'image',
      descKey: 'desc',
      statusKey: 'status',
      layout: 'list',
      columns: 3,
      showButton: true,
      readyText: '领取',
      receivedText: '已领取',
      lockedText: '未达成',
      emptyText: '暂无奖励',
      color: '#333333',
      fontSize: 26,
      descColor: '#999999',
      descFontSize: 22,
      cardColor: '#ffffff',
      cardRadius: 12,
      buttonColor: '#ff4d4f',
      buttonTextColor: '#ffffff',
    },
    events: [
      { name: 'receive', label: '点击领取', payloadKeys: ['index', 'item'] },
      { name: 'itemClick', label: '点击某一项', payloadKeys: ['index', 'item'] },
    ],
    propsSchema: [
      prop({
        key: 'data',
        label: '数据源',
        editor: 'dataSource',
        bindable: true,
        help: '数组，每项 { name, image, desc, status }；status 取 ready / received / locked',
      }),
      prop({ key: 'nameKey', label: '名称字段', editor: 'string' }),
      prop({ key: 'imageKey', label: '图片字段', editor: 'string' }),
      prop({ key: 'descKey', label: '描述字段', editor: 'string' }),
      prop({ key: 'statusKey', label: '状态字段', editor: 'string' }),
      prop({
        key: 'layout',
        label: '排列方式',
        editor: 'radio',
        options: [
          { label: '竖排列表', value: 'list' },
          { label: '网格', value: 'grid' },
        ],
      }),
      prop({
        key: 'columns',
        label: '列数',
        editor: 'number',
        min: 1,
        max: 5,
        visibleWhen: "{{ props.layout === 'grid' }}",
      }),
      prop({ key: 'maxCount', label: '最多展示', editor: 'number', min: 0, max: 200 }),
      prop({ key: 'showButton', label: '显示领取按钮', editor: 'boolean' }),
      prop({
        key: 'readyText',
        label: '可领取文案',
        editor: 'string',
        visibleWhen: '{{ props.showButton }}',
      }),
      prop({
        key: 'receivedText',
        label: '已领取文案',
        editor: 'string',
        visibleWhen: '{{ props.showButton }}',
      }),
      prop({
        key: 'lockedText',
        label: '未达成文案',
        editor: 'string',
        visibleWhen: '{{ props.showButton }}',
      }),
      prop({ key: 'emptyText', label: '空态文案', editor: 'string' }),
      styleProp({ key: 'cardColor', label: '卡片底色', editor: 'color' }),
      styleProp({ key: 'cardRadius', label: '卡片圆角', editor: 'number', min: 0 }),
      styleProp({ key: 'color', label: '名称颜色', editor: 'color' }),
      styleProp({ key: 'fontSize', label: '名称字号', editor: 'number', min: 8, max: 100 }),
      styleProp({ key: 'descColor', label: '描述颜色', editor: 'color' }),
      styleProp({ key: 'descFontSize', label: '描述字号', editor: 'number', min: 8, max: 100 }),
      styleProp({ key: 'buttonColor', label: '按钮底色', editor: 'color' }),
      styleProp({ key: 'buttonTextColor', label: '按钮文字色', editor: 'color' }),
      ...commonStyleSchema,
    ],
  }),
});
