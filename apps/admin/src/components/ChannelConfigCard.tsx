import { useState } from 'react';
import { Button, Card, Form, Input, Modal, Popconfirm, Space, Table, message } from 'antd';
import { CopyOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { channelApi, type ChannelItem } from '../api';

interface Props {
  activityId: string;
  canEdit: boolean;
}

interface FormValues {
  name: string;
  code: string;
  /** 透传参数的 JSON 文本，如 {"utm_source":"wechat"} */
  paramsText?: string;
}

/**
 * 渠道管理：为活动建可跟踪的落地链接（?ch=code&params）。
 * 落地页 renderer 的表达式上下文里有 query，运营可用 {{ query.ch }} 做差异化展示。
 */
export function ChannelConfigCard({ activityId, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<FormValues>();

  const { data: channels = [] } = useQuery({
    queryKey: ['channels', activityId],
    queryFn: () => channelApi.list(activityId),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['channels', activityId] });

  const createMutation = useMutation({
    mutationFn: (values: FormValues) => {
      let params: Record<string, string | number | boolean> | undefined;
      if (values.paramsText?.trim()) {
        try {
          params = JSON.parse(values.paramsText) as Record<string, string | number | boolean>;
        } catch {
          return Promise.reject(new Error('透传参数不是合法的 JSON'));
        }
      }
      return channelApi.create({ activityId, name: values.name, code: values.code, params });
    },
    onSuccess: () => {
      void message.success('渠道已创建');
      setOpen(false);
      form.resetFields();
      refresh();
    },
    onError: (err: Error) => void message.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => channelApi.remove(id),
    onSuccess: () => {
      void message.success('渠道已删除');
      refresh();
    },
    onError: (err: Error) => void message.error(err.message),
  });

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      void message.success('链接已复制');
    } catch {
      void message.error('复制失败，请手动复制');
    }
  };

  const columns = [
    { title: '名称', dataIndex: 'name' },
    { title: '渠道码', dataIndex: 'code', width: 110, render: (v: string) => <code>{v}</code> },
    {
      title: '落地链接',
      dataIndex: 'link',
      ellipsis: true,
      render: (link: string) => (
        <Space>
          <span style={{ fontSize: 12, color: '#666' }}>{link}</span>
          <Button size="small" icon={<CopyOutlined />} onClick={() => void copy(link)}>
            复制
          </Button>
        </Space>
      ),
    },
    {
      title: '操作',
      width: 80,
      render: (_: unknown, row: ChannelItem) =>
        canEdit ? (
          <Popconfirm title="删除后该渠道链接失效" onConfirm={() => removeMutation.mutate(row.id)}>
            <a style={{ color: '#ff4d4f' }}>删除</a>
          </Popconfirm>
        ) : null,
    },
  ];

  return (
    <Card
      title="渠道链接"
      extra={
        canEdit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
            新建渠道
          </Button>
        )
      }
    >
      <Table rowKey="id" dataSource={channels} columns={columns} pagination={false} size="small" />
      <Modal
        title="新建渠道"
        open={open}
        onOk={() => form.submit()}
        onCancel={() => setOpen(false)}
        confirmLoading={createMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => createMutation.mutate(values)}
        >
          <Form.Item name="name" label="渠道名称" rules={[{ required: true, message: '请输入渠道名称' }]}>
            <Input maxLength={60} placeholder="如 微信好友 / 微博 / 短信" />
          </Form.Item>
          <Form.Item
            name="code"
            label="渠道码"
            rules={[
              { required: true, message: '请输入渠道码' },
              { pattern: /^[A-Za-z0-9_-]{1,40}$/, message: '只能包含字母/数字/_/-' },
            ]}
            extra="会拼进落地链接 ?ch= 参数，同一活动内唯一"
          >
            <Input maxLength={40} placeholder="如 wechat_friend" />
          </Form.Item>
          <Form.Item
            name="paramsText"
            label="透传参数（JSON）"
            extra="可空。透传到落地页 query，运营可用 {{ query.xxx }} 引用"
          >
            <Input.TextArea rows={3} placeholder='{"utm_source":"wechat"}' />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
