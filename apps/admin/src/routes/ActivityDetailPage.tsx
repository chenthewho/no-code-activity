import { Button, Card, Descriptions, Popconfirm, Space, Table, Tag, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ACTIVITY_STATUS, PERMISSION } from '@nca/shared';
import { activityApi, type VersionItem } from '../api';
import { useAuthStore } from '../stores/auth';

export function ActivityDetailPage() {
  const { activityId } = useParams({ from: '/authed/activities/$activityId' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);

  const { data: activity } = useQuery({
    queryKey: ['activity', activityId],
    queryFn: () => activityApi.detail(activityId),
  });

  const { data: versions = [] } = useQuery({
    queryKey: ['versions', activityId],
    queryFn: () => activityApi.versions(activityId),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['activity', activityId] });
    void queryClient.invalidateQueries({ queryKey: ['versions', activityId] });
  };

  const rollbackMutation = useMutation({
    mutationFn: (version: number) => activityApi.rollback(activityId, version),
    onSuccess: (result) => {
      void message.success(`已回滚至 v${result.version}`);
      refresh();
    },
    onError: (err: Error) => void message.error(err.message),
  });

  const statusMutation = useMutation({
    mutationFn: (status: 'published' | 'offline') => activityApi.changeStatus(activityId, status),
    onSuccess: () => {
      void message.success('状态已更新');
      refresh();
    },
    onError: (err: Error) => void message.error(err.message),
  });

  const columns = [
    {
      title: '版本',
      dataIndex: 'version',
      width: 100,
      render: (version: number) => (
        <Space>
          v{version}
          {activity?.publishedVersion === version && <Tag color="success">线上</Tag>}
        </Space>
      ),
    },
    { title: '发布说明', dataIndex: 'changelog', render: (v?: string) => v || '—' },
    {
      title: '发布时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (value: string) => new Date(value).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 140,
      render: (_: unknown, row: VersionItem) =>
        can(PERMISSION.ACTIVITY_PUBLISH) && activity?.publishedVersion !== row.version ? (
          <Popconfirm
            title={`确认将线上版本切回 v${row.version}？`}
            onConfirm={() => rollbackMutation.mutate(row.version)}
          >
            <a>回滚到此版本</a>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title={activity?.title ?? '活动详情'}
        extra={
          <Space>
            {can(PERMISSION.ACTIVITY_EDIT) && (
              <Button
                onClick={() => void navigate({ to: '/designer/$activityId', params: { activityId } })}
              >
                进入设计器
              </Button>
            )}
            {can(PERMISSION.ACTIVITY_PUBLISH) && activity?.status === ACTIVITY_STATUS.PUBLISHED && (
              <Popconfirm title="下线后 C 端将无法访问" onConfirm={() => statusMutation.mutate('offline')}>
                <Button danger>下线</Button>
              </Popconfirm>
            )}
            {can(PERMISSION.ACTIVITY_PUBLISH) && activity?.status === ACTIVITY_STATUS.OFFLINE && (
              <Button type="primary" onClick={() => statusMutation.mutate('published')}>
                重新上线
              </Button>
            )}
          </Space>
        }
      >
        <Descriptions column={2} size="small">
          <Descriptions.Item label="状态">{activity?.status}</Descriptions.Item>
          <Descriptions.Item label="线上版本">
            {activity?.publishedVersion ? `v${activity.publishedVersion}` : '未发布'}
          </Descriptions.Item>
          <Descriptions.Item label="负责人">{activity?.ownerName}</Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {activity?.updatedAt ? new Date(activity.updatedAt).toLocaleString('zh-CN') : '—'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="发布历史">
        <Table rowKey="id" dataSource={versions} columns={columns} pagination={false} size="small" />
      </Card>
    </Space>
  );
}
