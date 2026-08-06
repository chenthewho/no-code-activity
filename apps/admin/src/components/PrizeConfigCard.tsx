import { useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Space, Table, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { prizeApi, type PrizeInput, type PrizeItem } from '../api';
import { ImagePicker } from './designer/ImagePicker';

interface Props {
  activityId: string;
  canEdit: boolean;
}

interface FormValues {
  name: string;
  image?: string;
  /** 万分比，10000 表示 100% */
  probability: number;
  total: number;
  limitPerUser: number;
  sort: number;
}

/**
 * 活动奖品配置：列表 + 新增/编辑/删除。
 * 概率是万分比；所有奖品概率之和不足 10000 的部分就是「未中奖」区间。
 */
export function PrizeConfigCard({ activityId, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PrizeItem | null>(null);
  const [form] = Form.useForm<FormValues>();

  const { data: prizes = [] } = useQuery({
    queryKey: ['prizes', activityId],
    queryFn: () => prizeApi.list(activityId),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['prizes', activityId] });

  const saveMutation = useMutation({
    mutationFn: (values: FormValues) =>
      editing ? prizeApi.update(editing.id, values) : prizeApi.create({ ...values, activityId }),
    onSuccess: () => {
      void message.success(editing ? '奖品已更新' : '奖品已创建');
      setOpen(false);
      setEditing(null);
      refresh();
    },
    onError: (err: Error) => void message.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => prizeApi.remove(id),
    onSuccess: () => {
      void message.success('奖品已删除');
      refresh();
    },
    onError: (err: Error) => void message.error(err.message),
  });

  const openEditor = (prize?: PrizeItem) => {
    if (prize) {
      setEditing(prize);
      form.setFieldsValue({
        name: prize.name,
        image: prize.image,
        probability: prize.probability,
        total: prize.total,
        limitPerUser: prize.limitPerUser,
        sort: prize.sort,
      });
    } else {
      setEditing(null);
      form.resetFields();
    }
    setOpen(true);
  };

  const columns = [
    { title: '排序', dataIndex: 'sort', width: 64 },
    {
      title: '图片',
      dataIndex: 'image',
      width: 72,
      render: (src?: string) =>
        src ? (
          <img src={src} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }} />
        ) : (
          '—'
        ),
    },
    { title: '名称', dataIndex: 'name' },
    {
      title: '概率',
      dataIndex: 'probability',
      width: 110,
      render: (v: number) => `${((v / 100).toFixed(2))}%`,
    },
    { title: '总量', dataIndex: 'total', width: 70 },
    { title: '剩余', dataIndex: 'remaining', width: 70 },
    {
      title: '单用户限次',
      dataIndex: 'limitPerUser',
      width: 96,
      render: (v: number) => (v === 0 ? '不限' : v),
    },
    {
      title: '操作',
      width: 120,
      render: (_: unknown, row: PrizeItem) =>
        canEdit ? (
          <Space>
            <a onClick={() => openEditor(row)}>编辑</a>
            <Popconfirm title="删除后不可恢复" onConfirm={() => removeMutation.mutate(row.id)}>
              <a style={{ color: '#ff4d4f' }}>删除</a>
            </Popconfirm>
          </Space>
        ) : null,
    },
  ];

  return (
    <Card
      title="奖品配置"
      extra={
        canEdit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>
            新增奖品
          </Button>
        )
      }
    >
      <Table rowKey="id" dataSource={prizes} columns={columns} pagination={false} size="small" />
      <Modal
        title={editing ? '编辑奖品' : '新增奖品'}
        open={open}
        onOk={() => form.submit()}
        onCancel={() => setOpen(false)}
        confirmLoading={saveMutation.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
          <Form.Item name="name" label="奖品名称" rules={[{ required: true, message: '请输入奖品名称' }]}>
            <Input maxLength={60} />
          </Form.Item>
          <Form.Item name="image" label="奖品图片">
            <ImagePicker />
          </Form.Item>
          <Form.Item
            name="probability"
            label="中奖概率"
            initialValue={0}
            extra="万分比，10000 表示 100%；全部奖品之和小于 10000 的部分就是「未中奖」区间"
            rules={[{ required: true, message: '请输入概率' }]}
          >
            <InputNumber min={0} max={10000} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="total" label="库存总量" initialValue={0} rules={[{ required: true, message: '请输入库存' }]}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="limitPerUser"
            label="单用户可中上限"
            initialValue={0}
            extra="0 表示不限"
            rules={[{ required: true, message: '请输入限次' }]}
          >
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="sort" label="排序" initialValue={0}>
            <InputNumber min={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
