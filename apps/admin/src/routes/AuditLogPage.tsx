import { useState } from 'react';
import { Card, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { auditApi, type AuditLogItem } from '../api';

const ACTION_LABELS: Record<string, string> = {
  'activity.create': '创建活动',
  'activity.update': '更新活动',
  'activity.remove': '删除活动',
  'activity.copy': '复制活动',
  'activity.publish': '发布活动',
  'activity.rollback': '回滚版本',
  'activity.status': '上线/下线',
  'template.create': '另存模板',
  'template.favorite': '收藏模板',
  'template.disable': '下架模板',
  'prize.create': '新建奖品',
  'prize.update': '更新奖品',
  'prize.remove': '删除奖品',
  'channel.create': '新建渠道',
  'channel.remove': '删除渠道',
};

/** 操作审计：谁在何时对哪个资源做了什么，请求体可展开复盘 */
export function AuditLogPage() {
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', page],
    queryFn: () => auditApi.list({ page, pageSize }),
  });

  const columns = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作人',
      dataIndex: 'username',
      width: 100,
      render: (v?: string, row?: AuditLogItem) => v ?? `用户${row?.userId.slice(-6) ?? ''}`,
    },
    {
      title: '操作',
      dataIndex: 'action',
      width: 120,
      render: (v: string) => <Tag color="blue">{ACTION_LABELS[v] ?? v}</Tag>,
    },
    {
      title: '资源',
      dataIndex: 'targetType',
      width: 160,
      render: (v?: string, row?: AuditLogItem) => (v ? `${v}/${row?.targetId}` : '—'),
    },
    { title: 'IP', dataIndex: 'ip', width: 130, render: (v?: string) => v ?? '—' },
    {
      title: '请求体',
      dataIndex: 'detail',
      render: (v?: unknown) =>
        v !== undefined && v !== null ? (
          <Typography.Text ellipsis copyable style={{ fontSize: 12 }}>
            {JSON.stringify(v).slice(0, 200)}
          </Typography.Text>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <Card title="操作审计">
      <Table
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={data?.rows ?? []}
        columns={columns}
        pagination={{ current: page, pageSize, total: data?.total ?? 0, onChange: setPage }}
      />
    </Card>
  );
}
