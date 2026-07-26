import { useState } from 'react';
import { Button, Card, Form, Input, Modal, Space, Table, Tag, message, Popconfirm } from 'antd';
import { CopyOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ACTIVITY_STATUS, PERMISSION, type ActivityStatus, type ActivitySummary } from '@nca/shared';
import { activityApi } from '../api';
import { useAuthStore } from '../stores/auth';

const STATUS_META: Record<ActivityStatus, { color: string; label: string }> = {
  [ACTIVITY_STATUS.DRAFT]: { color: 'default', label: '草稿' },
  [ACTIVITY_STATUS.PUBLISHED]: { color: 'success', label: '已发布' },
  [ACTIVITY_STATUS.OFFLINE]: { color: 'warning', label: '已下线' },
};

export function ActivityListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useAuthStore((s) => s.can);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{ title: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['activities', page, keyword],
    queryFn: () => activityApi.list({ page, pageSize: 10, keyword: keyword || undefined }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['activities'] });

  const createMutation = useMutation({
    mutationFn: (values: { title: string }) => activityApi.create(values),
    onSuccess: (activity) => {
      setCreating(false);
      form.resetFields();
      void message.success('活动已创建');
      void navigate({ to: '/designer/$activityId', params: { activityId: activity.id } });
    },
    onError: (err: Error) => void message.error(err.message),
  });

  const copyMutation = useMutation({
    mutationFn: (id: string) => activityApi.copy(id),
    onSuccess: () => {
      void message.success('已复制');
      void invalidate();
    },
    onError: (err: Error) => void message.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => activityApi.remove(id),
    onSuccess: () => {
      void message.success('已删除');
      void invalidate();
    },
    onError: (err: Error) => void message.error(err.message),
  });

  const columns = [
    {
      title: '活动名称',
      dataIndex: 'title',
      render: (title: string, row: ActivitySummary) => (
        <a onClick={() => void navigate({ to: '/activities/$activityId', params: { activityId: row.id } })}>
          {title}
        </a>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (status: ActivityStatus) => (
        <Tag color={STATUS_META[status].color}>{STATUS_META[status].label}</Tag>
      ),
    },
    {
      title: '线上版本',
      dataIndex: 'publishedVersion',
      width: 100,
      render: (v?: number) => (v ? `v${v}` : '—'),
    },
    { title: '负责人', dataIndex: 'ownerName', width: 120 },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (value: string) => new Date(value).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 260,
      render: (_: unknown, row: ActivitySummary) => (
        <Space size="small">
          {can(PERMISSION.ACTIVITY_EDIT) && (
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => void navigate({ to: '/designer/$activityId', params: { activityId: row.id } })}
            >
              设计
            </Button>
          )}
          {can(PERMISSION.ACTIVITY_EDIT) && (
            <Button type="link" size="small" icon={<CopyOutlined />} onClick={() => copyMutation.mutate(row.id)}>
              复制
            </Button>
          )}
          {can(PERMISSION.ACTIVITY_DELETE) && (
            <Popconfirm title="确认删除该活动？" onConfirm={() => removeMutation.mutate(row.id)}>
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="活动管理"
      extra={
        <Space>
          <Input.Search
            placeholder="搜索活动名称"
            allowClear
            style={{ width: 220 }}
            onSearch={(value) => {
              setKeyword(value);
              setPage(1);
            }}
          />
          {can(PERMISSION.ACTIVITY_EDIT) && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
              新建活动
            </Button>
          )}
        </Space>
      }
    >
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={data?.list ?? []}
        columns={columns}
        pagination={{
          current: page,
          pageSize: data?.pageSize ?? 10,
          total: data?.total ?? 0,
          onChange: setPage,
          showTotal: (total) => `共 ${total} 个活动`,
        }}
      />

      <Modal
        title="新建活动"
        open={creating}
        onCancel={() => setCreating(false)}
        onOk={() => void form.submit()}
        confirmLoading={createMutation.isPending}
        okText="创建并进入设计器"
      >
        <Form form={form} layout="vertical" onFinish={(values) => createMutation.mutate(values)}>
          <Form.Item
            name="title"
            label="活动名称"
            rules={[{ required: true, message: '请输入活动名称' }]}
          >
            <Input placeholder="如：七夕限定抽奖" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
