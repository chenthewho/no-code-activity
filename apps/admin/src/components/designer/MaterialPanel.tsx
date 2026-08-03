import { useMemo, useState } from 'react';
import { Collapse, Empty, Input, Select, Tooltip } from 'antd';
import {
  AppstoreOutlined,
  BorderOutlined,
  ClockCircleOutlined,
  DesktopOutlined,
  FontSizeOutlined,
  GiftOutlined,
  IdcardOutlined,
  MobileOutlined,
  PictureOutlined,
  PlaySquareOutlined,
  SearchOutlined,
  SelectOutlined,
  TrophyOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { MATERIAL_CATEGORY, type MaterialCategory } from '@nca/shared';
import type { MaterialMeta } from '@nca/dsl';
import { useDesignerStore } from '../../stores/designer';

const CATEGORY_LABEL: Record<MaterialCategory, string> = {
  [MATERIAL_CATEGORY.BASIC]: '基础组件',
  [MATERIAL_CATEGORY.CONTAINER]: '容器组件',
  [MATERIAL_CATEGORY.MEDIA]: '媒体组件',
  [MATERIAL_CATEGORY.BUSINESS]: '活动组件',
};

/** 物料图标。meta.icon 里存的是语义名，这里映射到具体图标组件 */
const ICONS: Record<string, ReactNode> = {
  Text: <FontSizeOutlined />,
  Button: <SelectOutlined />,
  Container: <BorderOutlined />,
  Modal: <AppstoreOutlined />,
  Image: <PictureOutlined />,
  Swiper: <PlaySquareOutlined />,
  Countdown: <ClockCircleOutlined />,
  RankList: <TrophyOutlined />,
  Lottery: <GiftOutlined />,
  Login: <UserOutlined />,
  BindRole: <IdcardOutlined />,
};

export function MaterialPanel({ metas }: { metas: MaterialMeta[] }) {
  const startDrag = useDesignerStore((s) => s.startDrag);
  const [keyword, setKeyword] = useState('');
  const [hostFilter, setHostFilter] = useState<string>('all');

  const grouped = useMemo(() => {
    // Page 是根容器，不该出现在工具箱里被再拖一个
    let usable = metas.filter((m) => m.name !== 'Page');

    const kw = keyword.trim().toLowerCase();
    if (kw) {
      usable = usable.filter(
        (m) =>
          m.title.toLowerCase().includes(kw) ||
          m.name.toLowerCase().includes(kw) ||
          (m.description ?? '').toLowerCase().includes(kw),
      );
    }
    if (hostFilter !== 'all') {
      usable = usable.filter((m) => !m.supportedHosts || m.supportedHosts.includes(hostFilter));
    }

    return Object.values(MATERIAL_CATEGORY)
      .map((category) => ({ category, items: usable.filter((m) => m.category === category) }))
      .filter((g) => g.items.length > 0);
  }, [metas, keyword, hostFilter]);

  return (
    <div style={{ padding: 8 }}>
      <Input
        allowClear
        size="small"
        placeholder="搜索组件"
        prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
        value={keyword}
        onChange={(e) => setKeyword(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <Select
        size="small"
        style={{ width: '100%', marginBottom: 8 }}
        value={hostFilter}
        onChange={setHostFilter}
        options={[
          { label: '全部投放端', value: 'all' },
          { label: '仅浏览器', value: 'browser' },
          { label: '仅 SDK 竖屏', value: 'sdk_portrait' },
          { label: '仅 SDK 横屏', value: 'sdk_landscape' },
        ]}
      />

      {grouped.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={keyword ? `没有匹配「${keyword}」的组件` : '暂无可用物料'}
          style={{ marginTop: 40 }}
        />
      ) : (
        <Collapse
          defaultActiveKey={grouped.map((g) => g.category)}
          ghost
          size="small"
          expandIconPosition="end"
          items={grouped.map((group) => ({
            key: group.category,
            label: <span style={{ fontSize: 13, fontWeight: 600 }}>{CATEGORY_LABEL[group.category]}</span>,
            styles: { body: { padding: '0 0 8px' } },
            children: (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {group.items.map((meta) => (
                  <MaterialCard
                    key={meta.name}
                    meta={meta}
                    onDragStart={() =>
                      startDrag({ materialName: meta.name, defaultProps: meta.defaultProps })
                    }
                  />
                ))}
              </div>
            ),
          }))}
        />
      )}
    </div>
  );
}

function MaterialCard({ meta, onDragStart }: { meta: MaterialMeta; onDragStart: () => void }) {
  const [hover, setHover] = useState(false);

  // 未声明 supportedHosts 视为全端可用
  const hosts = meta.supportedHosts ?? [];
  const showDesktop = hosts.length === 0 || hosts.some((h) => h.includes('pc') || h === 'browser');
  const showMobile = hosts.length === 0 || hosts.some((h) => h.includes('app') || h.includes('sdk'));

  return (
    <Tooltip title={meta.description ?? '拖到画布放置，或点击追加到末尾'} mouseEnterDelay={0.6}>
      <div
        onMouseDown={onDragStart}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
          height: 76,
          cursor: 'grab',
          background: hover ? '#f0f7ff' : '#fafafa',
          border: `1px solid ${hover ? '#91caff' : '#f0f0f0'}`,
          borderRadius: 8,
          transition: 'all .15s',
          userSelect: 'none',
        }}
      >
        {/* 端侧徽标：一眼看出该组件在哪些投放端可用 */}
        <div style={{ position: 'absolute', top: 4, right: 5, display: 'flex', gap: 3 }}>
          {showDesktop && <DesktopOutlined style={{ fontSize: 10, color: '#bfbfbf' }} />}
          {showMobile && <MobileOutlined style={{ fontSize: 10, color: '#bfbfbf' }} />}
        </div>
        <span style={{ fontSize: 18, color: hover ? '#1677ff' : '#595959' }}>
          {ICONS[meta.name] ?? <AppstoreOutlined />}
        </span>
        <span style={{ fontSize: 12, color: '#262626' }}>{meta.title}</span>
      </div>
    </Tooltip>
  );
}
