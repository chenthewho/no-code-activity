import { useQuery } from '@tanstack/react-query';
import { Card, Col, Row, Statistic, Table } from 'antd';
import { analyticsApi } from '../api';

interface Props {
  activityId: string;
}

/**
 * 活动埋点报表：PV / 点击 / 转化 + 点击 Top 节点 + 近 7 天 PV 趋势。
 * 数据来自 C 端曝光/点击/转化埋点，运营看活动效果用。
 */
export function AnalyticsReportCard({ activityId }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['analytics', activityId],
    queryFn: () => analyticsApi.report(activityId, 7),
  });

  const nodeColumns = [
    { title: '节点 id', dataIndex: 'nodeId', ellipsis: true },
    { title: '点击次数', dataIndex: 'clicks', width: 100 },
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
        <Col span={12}>
          <div style={{ marginBottom: 8, color: '#8c8c8c', fontSize: 13 }}>点击 Top 节点</div>
          <Table
            rowKey="nodeId"
            size="small"
            dataSource={data?.byNode ?? []}
            columns={nodeColumns}
            pagination={false}
            locale={{ emptyText: '暂无点击数据' }}
          />
        </Col>
        <Col span={12}>
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
