import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Dropdown,
  Empty,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  message,
} from 'antd';
import type { DataSource } from '@nca/dsl';
import { createId } from '@nca/shared';
import { useDesignerStore } from '../../stores/designer';

const TYPE_LABEL: Record<DataSource['type'], string> = {
  http: '接口',
  static: '静态数据',
  computed: '计算',
};

export function DataSourcePanel() {
  const { dsl, addDataSource, updateDataSource, removeDataSource } = useDesignerStore();
  const sources = dsl.dataSources;

  const create = (type: DataSource['type']) => {
    const id = createId('ds');
    const base = { id, name: `数据源 ${sources.length + 1}` };
    const ds: DataSource =
      type === 'http'
        ? {
            ...base,
            type: 'http',
            url: '',
            method: 'GET',
            headers: {},
            params: {},
            autoLoad: true,
            pollInterval: 0,
            cacheTtl: 0,
          }
        : type === 'static'
          ? { ...base, type: 'static', data: [] }
          : { ...base, type: 'computed', expression: '' };
    addDataSource(ds);
  };

  return (
    <div style={{ padding: 8 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12, fontSize: 12 }}
        message="配好后在任意属性里用 {{ dataSource.数据源ID }} 绑定"
      />

      {sources.length === 0 && (
        <Empty description="还没有数据源" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      )}

      <Collapse
        size="small"
        items={sources.map((ds) => ({
          key: ds.id,
          label: (
            <Space size={4}>
              <Tag color={ds.type === 'http' ? 'blue' : ds.type === 'static' ? 'green' : 'purple'}>
                {TYPE_LABEL[ds.type]}
              </Tag>
              <span style={{ fontSize: 12 }}>{ds.name}</span>
              <code style={{ color: '#999', fontSize: 11 }}>{ds.id}</code>
            </Space>
          ),
          extra: (
            <a
              style={{ color: '#ff4d4f', fontSize: 12 }}
              onClick={(e) => {
                e.stopPropagation();
                removeDataSource(ds.id);
              }}
            >
              删除
            </a>
          ),
          children: (
            <DataSourceForm
              ds={ds}
              onChange={(patch) => updateDataSource(ds.id, patch)}
            />
          ),
        }))}
      />

      <Dropdown
        trigger={['click']}
        menu={{
          items: [
            { key: 'http', label: '接口数据源' },
            { key: 'static', label: '静态数据源' },
            { key: 'computed', label: '计算数据源' },
          ],
          onClick: ({ key }) => create(key as DataSource['type']),
        }}
      >
        <Button size="small" type="dashed" block style={{ marginTop: 12 }}>
          + 新增数据源
        </Button>
      </Dropdown>
    </div>
  );
}

function DataSourceForm({
  ds,
  onChange,
}: {
  ds: DataSource;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <Form layout="vertical" size="small">
      <Form.Item label="名称" style={{ marginBottom: 10 }}>
        <Input value={ds.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Form.Item>

      {ds.type === 'http' && <HttpFields ds={ds} onChange={onChange} />}

      {ds.type === 'static' && (
        <Form.Item label="数据内容" extra="JSON 格式" style={{ marginBottom: 10 }}>
          <Input.TextArea
            rows={5}
            value={JSON.stringify(ds.data, null, 2)}
            onChange={(e) => {
              try {
                onChange({ data: JSON.parse(e.target.value) });
              } catch {
                // 编辑途中的半截 JSON 属于正常状态，不打断输入
              }
            }}
          />
        </Form.Item>
      )}

      {ds.type === 'computed' && (
        <Form.Item label="计算表达式" extra="可引用页面状态、其它数据源与登录用户，它们一变就自动重算；只能引用排在前面的计算数据源" style={{ marginBottom: 10 }}>
          <Input
            value={ds.expression}
            placeholder="{{ dataSource.rank.length }}"
            onChange={(e) => onChange({ expression: e.target.value })}
          />
        </Form.Item>
      )}
    </Form>
  );
}

function HttpFields({
  ds,
  onChange,
}: {
  ds: Extract<DataSource, { type: 'http' }>;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [preview, setPreview] = useState<string>('');

  /** 试跑一次，让运营配 transform 之前先看清返回结构 */
  const runTest = async () => {
    if (!ds.url) {
      void message.warning('请先填写接口地址');
      return;
    }
    setTesting(true);
    setPreview('');
    try {
      const response = await fetch(ds.url, { method: ds.method, headers: ds.headers });
      const json: unknown = await response.json();
      setPreview(JSON.stringify(json, null, 2).slice(0, 4000));
    } catch (err) {
      setPreview(`请求失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <Form.Item label="接口地址" style={{ marginBottom: 10 }}>
        <Input
          value={ds.url}
          placeholder="https://api.example.com/rank"
          onChange={(e) => onChange({ url: e.target.value })}
        />
      </Form.Item>

      <Form.Item label="请求方法" style={{ marginBottom: 10 }}>
        <Select
          value={ds.method}
          options={[
            { label: 'GET', value: 'GET' },
            { label: 'POST', value: 'POST' },
          ]}
          onChange={(value) => onChange({ method: value })}
        />
      </Form.Item>

      <Form.Item label="请求参数" extra="JSON，值可用 {{ }} 绑定" style={{ marginBottom: 10 }}>
        <Input.TextArea
          rows={2}
          value={JSON.stringify(ds.params, null, 2)}
          onChange={(e) => {
            try {
              onChange({ params: JSON.parse(e.target.value) });
            } catch {
              // 同上，半截 JSON 不打断输入
            }
          }}
        />
      </Form.Item>

      <Form.Item
        label="响应裁剪"
        extra="从返回里取出真正要用的那层，如 {{ response.data.list }}"
        style={{ marginBottom: 10 }}
      >
        <Input
          value={ds.transform ?? ''}
          placeholder="{{ response.data }}"
          onChange={(e) => onChange({ transform: e.target.value || undefined })}
        />
      </Form.Item>

      <Form.Item label="进页面自动请求" style={{ marginBottom: 10 }}>
        <Switch checked={ds.autoLoad} onChange={(checked) => onChange({ autoLoad: checked })} />
      </Form.Item>

      <Form.Item label="轮询间隔(ms)" extra="0 表示不轮询，榜单类活动常用" style={{ marginBottom: 10 }}>
        <InputNumber
          style={{ width: '100%' }}
          min={0}
          max={3600000}
          step={1000}
          value={ds.pollInterval}
          onChange={(value) => onChange({ pollInterval: value ?? 0 })}
        />
      </Form.Item>

      <Button size="small" loading={testing} onClick={runTest} block>
        试跑一次，看返回结构
      </Button>

      {preview && (
        <Card size="small" style={{ marginTop: 8 }}>
          <pre style={{ margin: 0, maxHeight: 200, overflow: 'auto', fontSize: 11 }}>{preview}</pre>
        </Card>
      )}
    </>
  );
}
