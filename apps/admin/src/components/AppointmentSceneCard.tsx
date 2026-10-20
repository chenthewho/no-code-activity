import { useState } from 'react';
import {
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { appointmentApi, type AppointmentSceneItem } from '../api';

interface Props {
  activityId: string;
  canEdit: boolean;
}

interface FormValues {
  sceneId: string;
  name: string;
  range?: [Dayjs | null, Dayjs | null];
  capacity?: number | null;
  sort: number;
}

const fmt = (value: string | null) => (value ? dayjs(value).format('MM-DD HH:mm') : '');

/** 与服务端同一口径：开场即截止；只设了结束时间的到结束为止 */
function closed(scene: AppointmentSceneItem): boolean {
  const cutoff = scene.startAt ?? scene.endAt;
  return Boolean(cutoff && dayjs().isAfter(cutoff));
}

/**
 * 预约场次（时段）：每场的时间与名额。名额与开场截止由服务端执行，页面上的预约组件自动读这里的配置。
 * 一个场次都不配时，预约按组件上的场次编码记录、不限名额（早期活动的行为）。
 */
export function AppointmentSceneCard({ activityId, canEdit }: Props) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AppointmentSceneItem | null>(null);
  const [form] = Form.useForm<FormValues>();

  const { data: scenes = [] } = useQuery({
    queryKey: ['appointment-scenes', activityId],
    queryFn: () => appointmentApi.list(activityId),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['appointment-scenes', activityId] });
  const onError = (err: Error) => void message.error(err.message);

  const save = useMutation({
    mutationFn: async () => {
      const values = await form.validateFields();
      const [start, end] = values.range ?? [];
      const body = {
        name: values.name,
        startAt: start?.isValid() ? start.toISOString() : null,
        endAt: end?.isValid() ? end.toISOString() : null,
        capacity: values.capacity ?? null,
        sort: values.sort ?? 0,
      };
      return editing
        ? appointmentApi.update(editing.id, body)
        : appointmentApi.create({ ...body, activityId, sceneId: values.sceneId });
    },
    onSuccess: () => {
      void message.success(editing ? '场次已更新' : '场次已创建');
      setOpen(false);
      setEditing(null);
      refresh();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => appointmentApi.remove(id),
    onSuccess: () => {
      void message.success('场次已删除');
      refresh();
    },
    onError,
  });

  const openForm = (scene: AppointmentSceneItem | null) => {
    setEditing(scene);
    form.setFieldsValue(
      scene
        ? {
            sceneId: scene.sceneId,
            name: scene.name,
            range: [scene.startAt ? dayjs(scene.startAt) : null, scene.endAt ? dayjs(scene.endAt) : null] as [
              Dayjs | null,
              Dayjs | null,
            ],
            capacity: scene.capacity,
            sort: scene.sort,
          }
        : { sceneId: `scene_${scenes.length + 1}`, name: '', range: undefined, capacity: null, sort: scenes.length },
    );
    setOpen(true);
  };

  const columns = [
    { title: '场次', dataIndex: 'name' },
    { title: '编码', dataIndex: 'sceneId', width: 130 },
    {
      title: '时间',
      width: 200,
      render: (_: unknown, s: AppointmentSceneItem) =>
        s.startAt || s.endAt ? `${fmt(s.startAt)} ~ ${fmt(s.endAt)}` : '不限',
    },
    {
      title: '已约 / 名额',
      width: 170,
      render: (_: unknown, s: AppointmentSceneItem) =>
        s.capacity === null ? (
          `${s.booked} / 不限`
        ) : (
          <Space size={8}>
            <span>
              {s.booked} / {s.capacity}
            </span>
            <Progress
              percent={Math.round((s.booked / s.capacity) * 100)}
              size="small"
              showInfo={false}
              style={{ width: 60, margin: 0 }}
            />
          </Space>
        ),
    },
    {
      title: '状态',
      width: 80,
      render: (_: unknown, s: AppointmentSceneItem) =>
        closed(s) ? (
          <Tag>已截止</Tag>
        ) : s.capacity !== null && s.booked >= s.capacity ? (
          <Tag color="warning">已约满</Tag>
        ) : (
          <Tag color="success">可预约</Tag>
        ),
    },
    ...(canEdit
      ? [
          {
            title: '操作',
            width: 120,
            render: (_: unknown, s: AppointmentSceneItem) => (
              <Space>
                <a onClick={() => openForm(s)}>编辑</a>
                {s.booked === 0 && (
                  <Popconfirm title="删除该场次？" onConfirm={() => remove.mutate(s.id)}>
                    <a>删除</a>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <Card
      title="预约场次"
      extra={
        canEdit && (
          <Button icon={<PlusOutlined />} onClick={() => openForm(null)}>
            新增场次
          </Button>
        )
      }
    >
      <Table
        rowKey="id"
        size="small"
        dataSource={scenes}
        columns={columns}
        pagination={false}
        locale={{ emptyText: '未配置场次：预约组件按自身的场次编码记录，不限名额' }}
      />
      <Modal
        title={editing ? '编辑场次' : '新增场次'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => save.mutate()}
        confirmLoading={save.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="sceneId"
            label="场次编码"
            extra="预约组件「单个场次」模式填这个编码；建好后不可修改"
            rules={[
              { required: true, message: '请填写场次编码' },
              { pattern: /^[A-Za-z0-9_-]{1,64}$/, message: '只能用字母、数字、下划线、连字符' },
            ]}
          >
            <Input disabled={Boolean(editing)} />
          </Form.Item>
          <Form.Item name="name" label="场次名称" rules={[{ required: true, message: '请填写场次名称' }]}>
            <Input placeholder="如：10 月 25 日 下午场" maxLength={60} />
          </Form.Item>
          <Form.Item name="range" label="场次时间" extra="开场即停止预约；不填表示不限时段">
            <DatePicker.RangePicker showTime allowEmpty={[true, true]} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="capacity"
            label="名额"
            extra={editing?.booked ? `已有 ${editing.booked} 人预约，名额不能少于这个数` : '不填表示不限'}
          >
            <InputNumber min={Math.max(1, editing?.booked ?? 0)} precision={0} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="sort" label="排序" extra="越小越靠前">
            <InputNumber min={0} precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
