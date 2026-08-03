import type { CSSProperties } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, dp, mergeStyle, type CommonStyleProps } from '../utils/style';

export interface InviteRecordProps extends CommonStyleProps {
  /** 通常绑定 {{ dataSource.invites }} */
  data?: Record<string, unknown>[];
  nameKey?: string;
  avatarKey?: string;
  timeKey?: string;
  statusKey?: string;
  showAvatar?: boolean;
  maxCount?: number;
  showSummary?: boolean;
  /** 汇总文案，{count} 会被替换成邀请人数 */
  summaryText?: string;
  /** 总数，留空则取列表长度——分页时列表只有首页，总数得由接口给 */
  total?: number | string;
  emptyText?: string;
  rowHeight?: number;
  color?: string;
  fontSize?: number;
  statusColor?: string;
  timeColor?: string;
}

/** 汇总里的人数：接口给了总数就用总数，否则退回当前列表长度 */
function resolveTotal(total: unknown, fallback: number): number {
  const n = typeof total === 'string' ? Number(total) : total;
  return typeof n === 'number' && Number.isFinite(n) ? n : fallback;
}

function InviteRecord({
  children: _children,
  emit,
  ...props
}: MaterialComponentProps<InviteRecordProps>) {
  const raw = Array.isArray(props.data) ? props.data : [];
  const max = props.maxCount && props.maxCount > 0 ? props.maxCount : raw.length;
  const list = raw.slice(0, max);

  const nameKey = props.nameKey || 'name';
  const avatarKey = props.avatarKey || 'avatar';
  const timeKey = props.timeKey || 'time';
  const statusKey = props.statusKey || 'status';

  const color = props.color || '#333333';
  const fontSize = dp(props.fontSize ?? 26);
  const rowStyle: CSSProperties = { height: dp(props.rowHeight ?? 96), color, fontSize };

  const summary = props.showSummary !== false && (
    <div className="nca-invite-record__summary" style={{ color, fontSize }}>
      {(props.summaryText ?? '已邀请 {count} 位好友').replace(
        '{count}',
        String(resolveTotal(props.total, raw.length)),
      )}
    </div>
  );

  if (list.length === 0) {
    return (
      <div className="nca-invite-record" style={mergeStyle(commonStyle(props), {})}>
        {summary}
        <div className="nca-invite-record__empty">{props.emptyText ?? '还没有好友接受邀请'}</div>
      </div>
    );
  }

  return (
    <div className="nca-invite-record" style={mergeStyle(commonStyle(props), {})}>
      {summary}
      {list.map((item, i) => (
        <div
          key={String(item.id ?? item[nameKey] ?? i)}
          className="nca-invite-record__row"
          style={rowStyle}
          onClick={() => emit?.('itemClick', { index: i, item })}
        >
          {props.showAvatar !== false &&
            (item[avatarKey] ? (
              <img className="nca-invite-record__avatar" src={String(item[avatarKey])} alt="" />
            ) : (
              <span className="nca-invite-record__avatar nca-invite-record__avatar--empty" />
            ))}
          <span className="nca-invite-record__name">{String(item[nameKey] ?? '')}</span>
          {item[timeKey] ? (
            <span
              className="nca-invite-record__time"
              style={{ color: props.timeColor || '#999999' }}
            >
              {String(item[timeKey])}
            </span>
          ) : null}
          {item[statusKey] ? (
            <span
              className="nca-invite-record__status"
              style={{ color: props.statusColor || '#52c41a' }}
            >
              {String(item[statusKey])}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export const InviteRecordMaterial = defineMaterial<InviteRecordProps>({
  Component: InviteRecord,
  meta: defineMeta({
    name: 'InviteRecord',
    version: '1.0.0',
    title: '邀请记录',
    category: MATERIAL_CATEGORY.BUSINESS,
    icon: 'team',
    description: '按数据源渲染已邀请的好友，含人数汇总，字段名可映射',
    defaultProps: {
      nameKey: 'name',
      avatarKey: 'avatar',
      timeKey: 'time',
      statusKey: 'status',
      showAvatar: true,
      showSummary: true,
      summaryText: '已邀请 {count} 位好友',
      emptyText: '还没有好友接受邀请',
      rowHeight: 96,
      color: '#333333',
      fontSize: 26,
      statusColor: '#52c41a',
      timeColor: '#999999',
    },
    events: [{ name: 'itemClick', label: '点击某一条', payloadKeys: ['index', 'item'] }],
    propsSchema: [
      prop({
        key: 'data',
        label: '数据源',
        editor: 'dataSource',
        bindable: true,
        help: '数组，每项 { name, avatar, time, status }',
      }),
      prop({ key: 'nameKey', label: '昵称字段', editor: 'string' }),
      prop({
        key: 'avatarKey',
        label: '头像字段',
        editor: 'string',
        visibleWhen: '{{ props.showAvatar }}',
      }),
      prop({ key: 'timeKey', label: '时间字段', editor: 'string' }),
      prop({ key: 'statusKey', label: '状态字段', editor: 'string' }),
      prop({ key: 'showAvatar', label: '显示头像', editor: 'boolean' }),
      prop({ key: 'maxCount', label: '最多展示', editor: 'number', min: 0, max: 200 }),
      prop({ key: 'showSummary', label: '显示人数汇总', editor: 'boolean' }),
      prop({
        key: 'summaryText',
        label: '汇总文案',
        editor: 'string',
        visibleWhen: '{{ props.showSummary }}',
        help: '{count} 会被替换成邀请人数',
      }),
      prop({
        key: 'total',
        label: '邀请总数',
        editor: 'string',
        bindable: true,
        placeholder: '{{ dataSource.invites.total }}',
        help: '留空则按当前列表长度算；接口分页时务必绑定',
        visibleWhen: '{{ props.showSummary }}',
      }),
      prop({ key: 'emptyText', label: '空态文案', editor: 'string' }),
      styleProp({ key: 'rowHeight', label: '行高', editor: 'number', min: 40 }),
      styleProp({ key: 'color', label: '文字颜色', editor: 'color' }),
      styleProp({ key: 'fontSize', label: '字号', editor: 'number', min: 8, max: 100 }),
      styleProp({ key: 'timeColor', label: '时间颜色', editor: 'color' }),
      styleProp({ key: 'statusColor', label: '状态颜色', editor: 'color' }),
      ...commonStyleSchema,
    ],
  }),
});
