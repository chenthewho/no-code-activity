import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Statistic, Table, Tooltip, Typography } from 'antd';
import type { CraftJson } from '@nca/dsl';
import { getMaterial } from '@nca/materials';
import { analyticsApi, activityApi, type AnalyticsReport } from '../api';

interface Props {
  activityId: string;
  /** 线上版本：用它的 DSL 把节点 id 翻译成运营认得的组件名 */
  publishedVersion?: number | null;
}

type NodeRow = AnalyticsReport['byNode'][number];

/** 曝光为 0（多是上线逐节点曝光之前的老数据）时比率没有意义 */
function rate(count: number, exposures: number): string {
  return exposures > 0 ? `${((count / exposures) * 100).toFixed(1)}%` : '—';
}

/**
 * 活动埋点报表：PV / 点击 / 转化 + 逐组件曝光、点击率、转化率 + 近 7 天 PV 趋势。
 * 数据来自 C 端曝光/点击/转化埋点，运营看活动效果用。
 */
export function AnalyticsReportCard({ activityId, publishedVersion }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics', activityId],
    queryFn: () => analyticsApi.report(activityId, 7),
  });
  // 取不到（没有活动查看权限、或还没发布）就退回显示节点 id，不影响报表本身
  const { data: published } = useQuery({
    queryKey: ['version-dsl', activityId, publishedVersion],
    queryFn: () => activityApi.versionDsl(activityId, publishedVersion!),
    enabled: Boolean(publishedVersion),
    retry: false,
  });
  const nodes = useMemo(
    () => ((published?.dsl as { craftJson?: CraftJson } | undefined)?.craftJson ?? {}) as CraftJson,
    [published],
  );

  const nodeColumns = [
    {
      title: '组件',
      dataIndex: 'nodeId',
      ellipsis: true,
      render: (nodeId: string) => {
        const node = nodes[nodeId];
        const label = node ? (node.displayName ?? getMaterial(node.type.resolvedName)?.meta.title ?? node.type.resolvedName) : null;
        return label ? (
          <Tooltip title={nodeId}>{label}</Tooltip>
        ) : (
          <Typography.Text type="secondary">{nodeId}</Typography.Text>
        );
      },
    },
    { title: '曝光', dataIndex: 'exposures', width: 70 },
    { title: '点击', dataIndex: 'clicks', width: 70 },
    {
      title: <Tooltip title="点击次数 ÷ 曝光人次，同一人多次点击会累计">点击率</Tooltip>,
      width: 80,
      render: (_: unknown, row: NodeRow) => rate(row.clicks, row.exposures),
    },
    {
      title: '转化率',
      width: 80,
      render: (_: unknown, row: NodeRow) => (row.converts > 0 ? rate(row.converts, row.exposures) : '—'),
    },
  ];

  return (
    <Card title="数据报表" extra={<span style={{ color: '#8c8c8c', fontSize: 12 }}>近 7 天</span>} loading={isLoading}>
      <Row gutter={32} style={{ marginBottom: 16 }}>
        <Col>
          <Statistic title="浏览量 (PV)" value={data?.pageViews ?? 0} />
        </Col>
        <Col>
          <Statistic title="点击次数" value={data?.clicks ?? 0} />
        </Col>
        <Col>
          <Statistic title="转化次数" value={data?.converts ?? 0} />
        </Col>
      </Row>

      <Row gutter={24}>
        <Col span={16}>
          <div style={{ marginBottom: 8, color: '#8c8c8c', fontSize: 13 }}>组件效果（绑了事件的组件与业务组件）</div>
          <Table
            rowKey="nodeId"
            size="small"
            dataSource={data?.byNode ?? []}
            columns={nodeColumns}
            pagination={false}
            locale={{ emptyText: '暂无组件数据' }}
          />
        </Col>
        <Col span={8}>
          <div style={{ marginBottom: 8, color: '#8c8c8c', fontSize: 13 }}>每日 PV</div>
          {(data?.trend.length ?? 0) === 0 ? (
            <div style={{ color: '#bbb', padding: 12 }}>暂无浏览数据</div>
          ) : (
            (data?.trend ?? []).map((t) => (
              <div
                key={t.date}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '6px 0',
                  borderBottom: '1px solid #f0f0f0',
                  fontSize: 13,
                }}
              >
                <span>{t.date}</span>
                <span style={{ color: '#1677ff' }}>{t.pageViews} 次</span>
              </div>
            ))
          )}
        </Col>
      </Row>
    </Card>
  );
}
