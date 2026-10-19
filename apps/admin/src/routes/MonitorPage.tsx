import { useState } from 'react';
import {
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, ReloadOutlined, SendOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { HOST_LABELS, PERMISSION, type HostType } from '@nca/shared';
import {
  monitorApi,
  type AlertRecord,
  type AlertRule,
  type AlertRuleInput,
  type MonitorMetric,
  type MonitorOverview,
} from '../api';
import { useAuthStore } from '../stores/auth';

const METRIC_LABEL: Record<MonitorMetric, string> = {
  dsl_invalid_rate: 'DSL 校验失败率',
  white_screen_rate: '白屏率',
  load_error_rate: '加载失败率',
  js_error_count: 'JS 错误数',
  publish_invalid_count: '发布校验失败次数',
};

const EVENT_LABEL: Record<string, { label: string; color: string }> = {
  load_error: { label: '加载失败', color: 'red' },
  dsl_invalid: { label: 'DSL 校验失败', color: 'magenta' },
  stall: { label: '加载超时', color: 'orange' },
  white_screen: { label: '白屏', color: 'volcano' },
  js_error: { label: 'JS 错误', color: 'gold' },
  publish_invalid: { label: '发布校验失败', color: 'purple' },
};

const WEBHOOK_OPTIONS = [
  { value: 'none', label: '不推送（只记录）' },
  { value: 'wecom', label: '企业微信机器人' },
  { value: 'feishu', label: '飞书机器人' },
  { value: 'dingtalk', label: '钉钉机器人' },
  { value: 'generic', label: '通用 Webhook（JSON）' },
];

const isRate = (metric: MonitorMetric) => metric.endsWith('_rate');
const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const formatValue = (metric: MonitorMetric, v: number) =>
  isRate(metric) ? pct(v) : String(Math.round(v));
const hostLabel = (host: string | null) => (host ? (HOST_LABELS[host as HostType] ?? host) : '—');

/**
 * 运行监控：活动页有没有挂。数字都按「访问次数」算——每次打开活动页，
 * 渲染器恰好上报一个结局（渲染成功 / 加载失败 / DSL 校验失败 / 超时）。
 */
export function MonitorPage() {
  const search = useSearch({ from: '/authed/monitor' });
  const navigate = useNavigate();
  const [hours, setHours] = useState(24);
  const activityId = search.activityId;

  const { data, isFetching, refetch } = useQuery({
    queryKey: ['monitor', hours, activityId],
    queryFn: () => monitorApi.overview(hours, activityId),
    refetchInterval: 60_000,
  });

  const setActivity = (id?: string) =>
    void navigate({ to: '/monitor', search: { activityId: id } });

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        title="运行监控"
        extra={
          <Space>
            {activityId && (
              <Tag closable onClose={() => setActivity(undefined)}>
                活动：
                {data?.topActivities.find((a) => a.activityId === activityId)?.title ?? activityId}
              </Tag>
            )}
            <Segmented
              value={hours}
              onChange={(v) => setHours(Number(v))}
              options={[
                { value: 1, label: '近 1 小时' },
                { value: 24, label: '近 24 小时' },
                { value: 168, label: '近 7 天' },
              ]}
            />
            <Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => void refetch()} />
          </Space>
        }
      >
        {data && <Overview data={data} />}
      </Card>

      <Card>
        <Tabs
          items={[
            {
              key: 'recent',
              label: '最近异常',
              children: data && <RecentTable data={data} onActivity={setActivity} />,
            },
            {
              key: 'top',
              label: '问题活动',
              children: data && <TopTable data={data} onActivity={setActivity} />,
            },
            { key: 'trend', label: '按小时', children: data && <TrendTable data={data} /> },
            { key: 'rules', label: '告警规则', children: <RulesPanel /> },
            { key: 'alerts', label: '告警记录', children: <AlertsTable /> },
          ]}
        />
      </Card>
    </Space>
  );
}

function Overview({ data }: { data: MonitorOverview }) {
  const { stats, rates, render } = data;
  const danger = (v: number, limit: number) => (v > limit ? { color: '#cf1322' } : undefined);
  return (
    <Row gutter={[16, 16]}>
      <Col span={4}>
        <Statistic title="访问次数" value={stats.attempts} />
      </Col>
      <Col span={4}>
        <Tooltip title={`基于最近 ${render.samples} 次成功渲染，从打开页面算起`}>
          <Statistic
            title="首屏渲染 P50 / P90"
            value={render.p50 === null ? '—' : `${render.p50} / ${render.p90} ms`}
          />
        </Tooltip>
      </Col>
      <Col span={4}>
        <Statistic
          title="DSL 校验失败率"
          value={pct(rates.dslInvalid)}
          valueStyle={danger(rates.dslInvalid, 0.01)}
        />
      </Col>
      <Col span={4}>
        <Tooltip title="渲染完成但首屏空白，或 8 秒内没渲染出来">
          <Statistic
            title="白屏率"
            value={pct(rates.whiteScreen)}
            valueStyle={danger(rates.whiteScreen, 0.05)}
          />
        </Tooltip>
      </Col>
      <Col span={4}>
        <Statistic
          title="加载失败率"
          value={pct(rates.loadError)}
          valueStyle={danger(rates.loadError, 0.05)}
        />
      </Col>
      <Col span={4}>
        <Statistic
          title="JS 错误 / 发布校验失败"
          value={`${stats.jsErrors} / ${stats.publishInvalid}`}
        />
      </Col>
    </Row>
  );
}

function RecentTable({
  data,
  onActivity,
}: {
  data: MonitorOverview;
  onActivity: (id: string) => void;
}) {
  return (
    <Table
      rowKey="id"
      size="small"
      dataSource={data.recent}
      pagination={false}
      locale={{ emptyText: '这段时间没有异常' }}
      columns={[
        {
          title: '时间',
          dataIndex: 'createdAt',
          width: 170,
          render: (v: string) => new Date(v).toLocaleString('zh-CN'),
        },
        {
          title: '类型',
          dataIndex: 'type',
          width: 120,
          render: (t: string) => (
            <Tag color={EVENT_LABEL[t]?.color}>{EVENT_LABEL[t]?.label ?? t}</Tag>
          ),
        },
        {
          title: '活动',
          dataIndex: 'activityId',
          width: 200,
          render: (id: string | null) =>
            id ? (
              <a onClick={() => onActivity(id)}>
                {data.topActivities.find((a) => a.activityId === id)?.title ?? id}
              </a>
            ) : (
              '—'
            ),
        },
        { title: '宿主', dataIndex: 'host', width: 110, render: hostLabel },
        {
          title: '信息',
          dataIndex: 'message',
          render: (v: string | null, row) => (
            <Typography.Text
              ellipsis={{ tooltip: row.detail ? JSON.stringify(row.detail, null, 2) : v }}
              style={{ maxWidth: 480 }}
            >
              {v ?? '—'}
            </Typography.Text>
          ),
        },
      ]}
    />
  );
}

function TopTable({
  data,
  onActivity,
}: {
  data: MonitorOverview;
  onActivity: (id: string) => void;
}) {
  return (
    <Table
      rowKey="activityId"
      size="small"
      dataSource={data.topActivities}
      pagination={false}
      locale={{ emptyText: '这段时间没有异常' }}
      columns={[
        {
          title: '活动',
          dataIndex: 'title',
          render: (title: string, row) => <a onClick={() => onActivity(row.activityId)}>{title}</a>,
        },
        { title: '异常次数', dataIndex: 'problems', width: 120 },
      ]}
    />
  );
}

function TrendTable({ data }: { data: MonitorOverview }) {
  const rows = [...data.trend].reverse();
  return (
    <Table
      rowKey="hour"
      size="small"
      dataSource={rows}
      pagination={{ pageSize: 24, hideOnSinglePage: true }}
      columns={[
        {
          title: '时段',
          dataIndex: 'hour',
          width: 180,
          render: (v: string) =>
            new Date(v).toLocaleString('zh-CN', {
              month: 'numeric',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            }),
        },
        { title: '访问', dataIndex: 'attempts' },
        { title: '白屏 / 超时', dataIndex: 'whiteScreens' },
        { title: 'DSL 校验失败', dataIndex: 'dslInvalid' },
        { title: '加载失败', dataIndex: 'loadErrors' },
        { title: 'JS 错误', dataIndex: 'jsErrors' },
      ]}
    />
  );
}

function RulesPanel() {
  const queryClient = useQueryClient();
  const canManage = useAuthStore((s) => s.can(PERMISSION.MONITOR_MANAGE));
  const [editing, setEditing] = useState<AlertRule | 'new' | null>(null);
  const [form] = Form.useForm<AlertRuleInput & { thresholdInput: number }>();
  const metric = Form.useWatch('metric', form) as MonitorMetric | undefined;
  const webhookType = Form.useWatch('webhookType', form);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: monitorApi.rules,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['alert-rules'] });
  const onError = (err: Error) => void message.error(err.message);

  const save = useMutation({
    mutationFn: async (values: AlertRuleInput & { thresholdInput: number }) => {
      const { thresholdInput, ...rest } = values;
      // 比率类在界面上按百分比填，存的是 0~1
      const body = {
        ...rest,
        threshold: isRate(values.metric) ? thresholdInput / 100 : thresholdInput,
      };
      if (editing === 'new') await monitorApi.createRule(body);
      else if (editing) await monitorApi.updateRule(editing.id, body);
    },
    onSuccess: () => {
      void message.success('告警规则已保存');
      setEditing(null);
      refresh();
    },
    onError,
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      monitorApi.updateRule(id, { enabled }),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({ mutationFn: monitorApi.removeRule, onSuccess: refresh, onError });
  const test = useMutation({
    mutationFn: monitorApi.testRule,
    onSuccess: () => void message.success('测试消息已发送，请到群里确认'),
    onError,
  });

  const open = (rule: AlertRule | 'new') => {
    setEditing(rule);
    if (rule === 'new') {
      form.setFieldsValue({
        name: '',
        metric: 'white_screen_rate',
        thresholdInput: 5,
        windowMinutes: 10,
        minSamples: 20,
        cooldownMinutes: 30,
        enabled: true,
        webhookType: 'none',
        webhookUrl: '',
      });
    } else {
      form.setFieldsValue({
        ...rule,
        webhookUrl: rule.webhookUrl ?? '',
        thresholdInput: isRate(rule.metric)
          ? Number((rule.threshold * 100).toFixed(4))
          : rule.threshold,
      });
    }
  };

  return (
    <>
      {canManage && (
        <Button
          type="primary"
          icon={<PlusOutlined />}
          style={{ marginBottom: 12 }}
          onClick={() => open('new')}
        >
          新建规则
        </Button>
      )}
      <Table
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={rules}
        pagination={false}
        columns={[
          { title: '规则', dataIndex: 'name' },
          {
            title: '条件',
            render: (_: unknown, r: AlertRule) =>
              `近 ${r.windowMinutes} 分钟 ${METRIC_LABEL[r.metric]} > ${formatValue(r.metric, r.threshold)}` +
              (isRate(r.metric) ? `（样本 ≥ ${r.minSamples}）` : ''),
          },
          {
            title: '通知',
            dataIndex: 'webhookType',
            width: 140,
            render: (t: string) => WEBHOOK_OPTIONS.find((o) => o.value === t)?.label ?? t,
          },
          {
            title: '上次触发',
            dataIndex: 'lastTriggeredAt',
            width: 170,
            render: (v: string | null) => (v ? new Date(v).toLocaleString('zh-CN') : '—'),
          },
          {
            title: '启用',
            dataIndex: 'enabled',
            width: 70,
            render: (enabled: boolean, r: AlertRule) => (
              <Switch
                size="small"
                checked={enabled}
                disabled={!canManage}
                onChange={(next) => toggle.mutate({ id: r.id, enabled: next })}
              />
            ),
          },
          ...(canManage
            ? [
                {
                  title: '操作',
                  width: 170,
                  render: (_: unknown, r: AlertRule) => (
                    <Space size="small">
                      <a onClick={() => open(r)}>编辑</a>
                      <Tooltip
                        title={r.webhookType === 'none' ? '先配置通知方式' : '发一条测试消息'}
                      >
                        <Button
                          type="link"
                          size="small"
                          icon={<SendOutlined />}
                          disabled={r.webhookType === 'none'}
                          loading={test.isPending && test.variables === r.id}
                          onClick={() => test.mutate(r.id)}
                        >
                          测试
                        </Button>
                      </Tooltip>
                      <Popconfirm title="删除该规则？" onConfirm={() => remove.mutate(r.id)}>
                        <a style={{ color: '#ff4d4f' }}>删除</a>
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />

      <Modal
        title={editing === 'new' ? '新建告警规则' : '编辑告警规则'}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={save.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
          <Form.Item name="name" label="规则名称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="metric" label="指标">
            <Select
              options={Object.entries(METRIC_LABEL).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Space align="start">
            <Form.Item
              name="thresholdInput"
              label={metric && isRate(metric) ? '阈值（%）' : '阈值（次）'}
              rules={[{ required: true }]}
            >
              <InputNumber min={0} step={metric && isRate(metric) ? 0.5 : 1} />
            </Form.Item>
            <Form.Item name="windowMinutes" label="统计窗口（分钟）">
              <InputNumber min={1} max={1440} />
            </Form.Item>
            <Form.Item name="cooldownMinutes" label="冷却（分钟）">
              <InputNumber min={1} max={1440} />
            </Form.Item>
          </Space>
          {metric && isRate(metric) && (
            <Form.Item
              name="minSamples"
              label="最少样本（次访问）"
              extra="样本太少时一两次失败就是高比率，告警没有意义"
            >
              <InputNumber min={0} />
            </Form.Item>
          )}
          <Form.Item name="webhookType" label="通知方式">
            <Select options={WEBHOOK_OPTIONS} />
          </Form.Item>
          {webhookType && webhookType !== 'none' && (
            <Form.Item
              name="webhookUrl"
              label="Webhook 地址"
              rules={[{ required: true, pattern: /^https?:\/\//, message: '需为 http(s) 地址' }]}
            >
              <Input placeholder="群机器人的 Webhook 地址" />
            </Form.Item>
          )}
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

function AlertsTable() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['alerts', page],
    queryFn: () => monitorApi.alerts(page),
  });
  return (
    <Table
      rowKey="id"
      size="small"
      loading={isLoading}
      dataSource={data?.rows ?? []}
      locale={{ emptyText: '还没有触发过告警' }}
      pagination={{
        current: page,
        pageSize: 20,
        total: data?.total ?? 0,
        onChange: setPage,
        hideOnSinglePage: true,
      }}
      columns={[
        {
          title: '时间',
          dataIndex: 'createdAt',
          width: 170,
          render: (v: string) => new Date(v).toLocaleString('zh-CN'),
        },
        { title: '规则', render: (_: unknown, r: AlertRecord) => r.rule.name },
        {
          title: '触发值',
          width: 150,
          render: (_: unknown, r: AlertRecord) =>
            `${formatValue(r.metric, r.value)} / ${formatValue(r.metric, r.threshold)}`,
        },
        {
          title: '详情',
          dataIndex: 'message',
          render: (v: string) => (
            <span style={{ whiteSpace: 'pre-line' }}>{v.split('\n').slice(1).join('\n')}</span>
          ),
        },
        {
          title: '通知',
          width: 110,
          render: (_: unknown, r: AlertRecord) =>
            r.notified ? (
              <Tag color="success">已推送</Tag>
            ) : r.notifyError ? (
              <Tooltip title={r.notifyError}>
                <Tag color="error">推送失败</Tag>
              </Tooltip>
            ) : (
              <Tag>仅记录</Tag>
            ),
        },
      ]}
    />
  );
}
