import type { CSSProperties } from 'react';
import { MATERIAL_CATEGORY } from '@nca/shared';
import { defineMaterial, type MaterialComponentProps } from '../types';
import { commonStyleSchema, defineMeta, prop, styleProp } from '../utils/schema';
import { commonStyle, dp, mergeStyle, type CommonStyleProps } from '../utils/style';

export interface RankListProps extends CommonStyleProps {
  /** 通常绑定 {{ dataSource.rank }} */
  data?: Record<string, unknown>[];
  nameKey?: string;
  scoreKey?: string;
  avatarKey?: string;
  maxCount?: number;
  showAvatar?: boolean;
  /** 前三名用奖牌样式 */
  highlightTop3?: boolean;
  rowHeight?: number;
  color?: string;
  fontSize?: number;
  emptyText?: string;
}

const MEDALS = ['🥇', '🥈', '🥉'];

function RankList({ children: _children, emit, ...props }: MaterialComponentProps<RankListProps>) {
  const raw = Array.isArray(props.data) ? props.data : [];
  const max = props.maxCount && props.maxCount > 0 ? props.maxCount : raw.length;
  const list = raw.slice(0, max);

  const nameKey = props.nameKey || 'name';
  const scoreKey = props.scoreKey || 'score';
  const avatarKey = props.avatarKey || 'avatar';

  const rowStyle: CSSProperties = {
    height: dp(props.rowHeight ?? 96),
    color: props.color || '#333333',
    fontSize: dp(props.fontSize ?? 28),
  };

  if (list.length === 0) {
    return (
      <div className="nca-rank nca-rank--empty" style={commonStyle(props)}>
        {props.emptyText ?? '暂无数据'}
      </div>
    );
  }

  return (
    <div className="nca-rank" style={mergeStyle(commonStyle(props), {})}>
      {list.map((item, i) => {
        const medal = props.highlightTop3 !== false && i < 3 ? MEDALS[i] : undefined;
        return (
          <div
            key={String(item.id ?? item[nameKey] ?? i)}
            className="nca-rank__row"
            style={rowStyle}
            onClick={() => emit?.('itemClick', { index: i, item })}
          >
            <span className="nca-rank__index">{medal ?? i + 1}</span>
            {props.showAvatar !== false && (
              <img className="nca-rank__avatar" src={String(item[avatarKey] ?? '')} alt="" />
            )}
            <span className="nca-rank__name">{String(item[nameKey] ?? '')}</span>
            <span className="nca-rank__score">{String(item[scoreKey] ?? '')}</span>
          </div>
        );
      })}
    </div>
  );
}

export const RankListMaterial = defineMaterial<RankListProps>({
  Component: RankList,
  meta: defineMeta({
    name: 'RankList',
    version: '1.0.0',
    title: '榜单',
    category: MATERIAL_CATEGORY.BUSINESS,
    icon: 'trophy',
    description: '绑定数据源渲染排行榜，字段名可映射',
    defaultProps: {
      nameKey: 'name',
      scoreKey: 'score',
      avatarKey: 'avatar',
      maxCount: 10,
      showAvatar: true,
      highlightTop3: true,
      rowHeight: 96,
    },
    events: [{ name: 'itemClick', label: '点击某一行', payloadKeys: ['index', 'item'] }],
    propsSchema: [
      prop({
        key: 'data',
        label: '数据源',
        editor: 'dataSource',
        bindable: true,
        help: '绑定返回数组的数据源，如 {{ dataSource.rank }}',
      }),
      prop({ key: 'nameKey', label: '名称字段', editor: 'string' }),
      prop({ key: 'scoreKey', label: '分数字段', editor: 'string' }),
      prop({
        key: 'avatarKey',
        label: '头像字段',
        editor: 'string',
        visibleWhen: '{{ props.showAvatar }}',
      }),
      prop({ key: 'maxCount', label: '最多展示', editor: 'number', min: 0, max: 200 }),
      prop({ key: 'showAvatar', label: '显示头像', editor: 'boolean' }),
      prop({ key: 'highlightTop3', label: '前三名奖牌', editor: 'boolean' }),
      prop({ key: 'emptyText', label: '空态文案', editor: 'string' }),
      styleProp({ key: 'rowHeight', label: '行高', editor: 'number', min: 40 }),
      styleProp({ key: 'fontSize', label: '字号', editor: 'number', min: 8, max: 100 }),
      styleProp({ key: 'color', label: '文字颜色', editor: 'color' }),
      ...commonStyleSchema,
    ],
  }),
});
