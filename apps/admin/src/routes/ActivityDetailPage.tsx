import { useEffect } from 'react';
import { Button, Card, DatePicker, Form, Input, Popconfirm, Space, Table, Tag, message } from 'antd';
import { DashboardOutlined, EditOutlined, SaveOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { ACTIVITY_STATUS, PERMISSION } from '@nca/shared';
import { activityApi, type VersionItem } from '../api';
import { ImagePicker } from '../components/designer/ImagePicker';
import { PrizeConfigCard } from '../components/PrizeConfigCard';
import { ChannelConfigCard } from '../components/ChannelConfigCard';
import { AnalyticsReportCard } from '../components/AnalyticsReportCard';
import { ActivityMemberCard } from '../components/ActivityMemberCard';
import { useAuthStore } from '../stores/auth';
import { ACCESS_LABEL, canEditActivity, canManageActivity } from '../utils/access';

const STATUS_META = {
  [ACTIVITY_STATUS.DRAFT]: { color: 'default', label: '草稿' },
  [ACTIVITY_STATUS.PUBLISHED]: { color: 'success', label: '已发布' },
  [ACTIVITY_STATUS.OFFLINE]: { color: 'warning', label: '已下线' },
} as const;

interface BasicInfoValues {
  title: string;
  cover?: string;
  range?: [dayjs.Dayjs, dayjs.Dayjs];
}

export function ActivityDetailPage() {
  const { activityId } = useParams({ from: '/authed/activities/$activityId' });
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);

  const [form] = Form.useForm<BasicInfoValues>();

  const { data: activity } = useQuery({
    queryKey: ['activity', activityId],
    queryFn: () => activityApi.detail(activityId),
  });

  const { data: versions = [] } = useQuery({
    queryKey: ['versions', activityId],
    queryFn: () => activityApi.versions(activityId),
  });

  // 功能权限（角色）与数据权限（对这个活动的访问级别）两者都满足才显示操作
  const editable = can(PERMISSION.ACTIVITY_EDIT) && canEditActivity(activity?.access);
  const publishable = can(PERMISSION.ACTIVITY_PUBLISH) && canEditActivity(activity?.access);

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

  // 详情到手后回填表单；用 useEffect 而不是 initialValues，
  // 因为数据是异步来的，initialValues 只在首次挂载生效
  useEffect(() => {
    if (!activity) return;
    form.setFieldsValue({
      title: activity.title,
      cover: activity.cover,
      range:
        activity.startTime && activity.endTime
          ? [dayjs(activity.startTime), dayjs(activity.endTime)]
          : undefined,
    });
  }, [activity, form]);

  const updateMutation = useMutation({
    mutationFn: (values: BasicInfoValues) =>
      activityApi.update(activityId, {
        title: values.title,
        cover: values.cover,
        // 选择器可能留下半截或非法值，无效就当没填，别把 Invalid Date 送上去
        startTime: values.range?.[0]?.isValid() ? values.range[0].toISOString() : undefined,
        endTime: values.range?.[1]?.isValid() ? values.range[1].toISOString() : undefined,
      }),
    onSuccess: () => {
      void message.success('基础信息已保存');
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
        publishable && activity?.publishedVersion !== row.version ? (
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
            {can(PERMISSION.MONITOR_VIEW) && activity?.publishedVersion && (
              <Button
                icon={<DashboardOutlined />}
                onClick={() => void navigate({ to: '/monitor', search: { activityId } })}
              >
                运行监控
              </Button>
            )}
            {editable && (
              <Button
                icon={<EditOutlined />}
                onClick={() => void navigate({ to: '/designer/$activityId', params: { activityId } })}
              >
                进入设计器
              </Button>
            )}
            {publishable && activity?.status === ACTIVITY_STATUS.PUBLISHED && (
              <Popconfirm title="下线后 C 端将无法访问" onConfirm={() => statusMutation.mutate('offline')}>
                <Button danger>下线</Button>
              </Popconfirm>
            )}
            {publishable && activity?.status === ACTIVITY_STATUS.OFFLINE && (
              <Button type="primary" onClick={() => statusMutation.mutate('published')}>
                重新上线
              </Button>
            )}
          </Space>
        }
      >
        <Space size={16} style={{ marginBottom: 16 }}>
          <span>
            <span style={{ color: '#8c8c8c' }}>状态：</span>
            {activity && (
              <Tag color={STATUS_META[activity.status].color}>{STATUS_META[activity.status].label}</Tag>
            )}
          </span>
          <span>
            <span style={{ color: '#8c8c8c' }}>线上版本：</span>
            {activity?.publishedVersion ? `v${activity.publishedVersion}` : '未发布'}
          </span>
          <span>
            <span style={{ color: '#8c8c8c' }}>负责人：</span>
            {activity?.ownerName ?? '—'}
          </span>
          {activity?.access && (
            <span>
              <span style={{ color: '#8c8c8c' }}>我的权限：</span>
              <Tag>{ACCESS_LABEL[activity.access]}</Tag>
            </span>
          )}
          <span>
            <span style={{ color: '#8c8c8c' }}>更新于：</span>
            {activity?.updatedAt ? new Date(activity.updatedAt).toLocaleString('zh-CN') : '—'}
          </span>
        </Space>

        <Form
          form={form}
          layout="vertical"
          disabled={!editable}
          onFinish={(values) => updateMutation.mutate(values)}
          style={{ maxWidth: 560 }}
        >
          <Form.Item name="title" label="活动名称" rules={[{ required: true, message: '请输入活动名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="range"
            label="活动时间"
            extra="倒计时组件绑定 {{ meta.endTime }} 时取这里的结束时间"
          >
            <DatePicker.RangePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="cover" label="活动封面">
            <ImagePicker />
          </Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            icon={<SaveOutlined />}
            loading={updateMutation.isPending}
          >
            保存基础信息
          </Button>
        </Form>
      </Card>

      <Card title="发布历史">
        <Table rowKey="id" dataSource={versions} columns={columns} pagination={false} size="small" />
      </Card>

      <ActivityMemberCard activityId={activityId} canManage={canManageActivity(activity?.access)} />

      <PrizeConfigCard activityId={activityId} canEdit={editable && can(PERMISSION.PRIZE_MANAGE)} />

      <ChannelConfigCard activityId={activityId} canEdit={editable && can(PERMISSION.CHANNEL_MANAGE)} />

      {can(PERMISSION.ANALYTICS_VIEW) && <AnalyticsReportCard activityId={activityId} />}
    </Space>
  );
}
