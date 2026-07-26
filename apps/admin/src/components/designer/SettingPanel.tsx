import {
  Alert,
  Collapse,
  ColorPicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
} from 'antd';
import { SettingOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { JsonValue, MaterialMeta, PropSchemaItem } from '@nca/dsl';
import { useDesignerStore } from '../../stores/designer';
import { EventPanel } from './EventPanel';
import { ControlPanel } from './ControlPanel';
import { ImagePicker } from './ImagePicker';
import { SpacingEditor } from './SpacingEditor';

interface SettingPanelProps {
  metas: MaterialMeta[];
}

/**
 * 设置器面板完全由 meta.propsSchema 驱动生成。
 * 新增一个物料属性只需改物料声明，这里不用动一行代码——
 * 这是「物料协议即面板」的核心收益。
 */
export function SettingPanel({ metas }: SettingPanelProps) {
  const { dsl, selectedId, updateProps } = useDesignerStore();

  if (!selectedId) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="在画布中选择一个组件"
        style={{ marginTop: 80 }}
      />
    );
  }

  const node = dsl.craftJson[selectedId];
  const meta = metas.find((m) => m.name === node?.type.resolvedName);
  if (!node || !meta) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="该组件未在物料表中注册"
        style={{ marginTop: 80 }}
      />
    );
  }

  const props = node.props as Record<string, unknown>;

  // 协议里的 group / section 决定落在哪一区，面板不做任何字段名猜测
  const sections = [
    { key: 'props', title: '基础属性', items: meta.propsSchema.filter((p) => p.group === 'props') },
    {
      key: 'style',
      title: '基础样式',
      items: meta.propsSchema.filter((p) => p.group === 'style' && p.section !== 'layout'),
    },
    {
      key: 'layout',
      title: '布局与间距',
      items: meta.propsSchema.filter((p) => p.group === 'style' && p.section === 'layout'),
    },
  ].filter((s) => s.items.length > 0);

  const renderItems = (items: PropSchemaItem[]) => {
    const visible = items.filter((item) => isVisible(item, props));
    if (visible.length === 0) {
      return <div style={{ color: '#bfbfbf', fontSize: 12 }}>无可配置项</div>;
    }
    return (
      <Form layout="vertical" size="small">
        {visible.map((item) => (
          <Form.Item
            key={item.key}
            label={
              <Space size={4}>
                <span>{item.label}</span>
                {item.bindable && (
                  <Tag color="blue" style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}>
                    可绑定
                  </Tag>
                )}
              </Space>
            }
            extra={item.help}
            style={{ marginBottom: 12 }}
          >
            <PropEditor
              item={item}
              value={props[item.key] ?? item.defaultValue}
              onChange={(value) => updateProps(selectedId, { [item.key]: value as JsonValue })}
            />
          </Form.Item>
        ))}
      </Form>
    );
  };

  return (
    <Tabs
      size="small"
      centered
      items={[
        {
          key: 'props',
          label: (
            <span>
              <SettingOutlined /> 组件属性
            </span>
          ),
          children: (
            <div style={{ padding: '0 4px' }}>
              <Alert
                type="info"
                showIcon={false}
                banner
                style={{ marginBottom: 8, fontSize: 12, background: '#f6f8fa', border: 'none' }}
                message={
                  <Space size={6}>
                    <span style={{ color: '#8c8c8c' }}>当前选中</span>
                    <strong>{node.displayName ?? meta.title}</strong>
                    <code style={{ color: '#bfbfbf', fontSize: 11 }}>{selectedId}</code>
                  </Space>
                }
              />
              <Collapse
                ghost
                size="small"
                expandIconPosition="end"
                defaultActiveKey={sections.map((s) => s.key).concat('control')}
                items={[
                  ...sections.map((section) => ({
                    key: section.key,
                    label: <span style={{ fontSize: 13, fontWeight: 600 }}>{section.title}</span>,
                    children: renderItems(section.items),
                  })),
                  {
                    key: 'control',
                    label: <span style={{ fontSize: 13, fontWeight: 600 }}>条件与循环</span>,
                    children: <ControlPanel nodeId={selectedId} />,
                  },
                ]}
              />
            </div>
          ),
        },
        {
          key: 'event',
          label: (
            <span>
              <ThunderboltOutlined /> 事件绑定
            </span>
          ),
          children: <EventPanel meta={meta} />,
        },
      ]}
    />
  );
}

/**
 * visibleWhen 表达式此处只做最常见的 props.x 相等/真值判断。
 * 不复用渲染器那套完整求值器，是为了让 Admin 不必打包运行时。
 */
function isVisible(item: PropSchemaItem, props: Record<string, unknown>): boolean {
  if (!item.visibleWhen) return true;
  const expr = item.visibleWhen.replace(/^\{\{|\}\}$/g, '').trim();

  const eq = /^props\.([A-Za-z0-9_]+)\s*===?\s*'([^']*)'$/.exec(expr);
  if (eq) return String(props[eq[1] as string] ?? '') === eq[2];

  const truthy = /^props\.([A-Za-z0-9_]+)$/.exec(expr);
  if (truthy) return Boolean(props[truthy[1] as string]);

  return true;
}

interface PropEditorProps {
  item: PropSchemaItem;
  value: unknown;
  onChange: (value: unknown) => void;
}

function PropEditor({ item, value, onChange }: PropEditorProps) {
  const bindableHint = item.bindable ? '支持 {{ }} 绑定' : undefined;

  switch (item.editor) {
    case 'number':
      return (
        <InputNumber
          style={{ width: '100%' }}
          value={value as number}
          min={item.min}
          max={item.max}
          step={item.step}
          onChange={(v) => onChange(v)}
        />
      );

    case 'boolean':
      return <Switch size="small" checked={Boolean(value)} onChange={onChange} />;

    case 'color':
      return <ColorEditor value={value as string} onChange={onChange} />;

    case 'spacing':
      return <SpacingEditor value={value} onChange={onChange} />;

    case 'select':
      return (
        <Select
          style={{ width: '100%' }}
          value={value as string}
          options={item.options?.map((o) => ({ label: o.label, value: o.value }))}
          onChange={onChange}
          allowClear
        />
      );

    case 'radio':
      return (
        <Radio.Group
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={item.options?.map((o) => ({ label: o.label, value: o.value }))}
          optionType="button"
          buttonStyle="solid"
          size="small"
        />
      );

    case 'textarea':
    case 'richtext':
      return (
        <Input.TextArea
          value={value as string}
          rows={3}
          placeholder={item.placeholder ?? bindableHint}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case 'json':
      return (
        <Input.TextArea
          value={typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)}
          rows={5}
          placeholder={item.placeholder ?? bindableHint}
          onChange={(e) => {
            const text = e.target.value;
            // 绑定表达式原样存字符串，纯 JSON 才解析成对象
            if (text.includes('{{')) {
              onChange(text);
              return;
            }
            try {
              onChange(JSON.parse(text));
            } catch {
              onChange(text);
            }
          }}
        />
      );

    case 'image':
      return (
        <ImagePicker
          value={value as string}
          placeholder={item.placeholder ?? bindableHint}
          onChange={onChange}
        />
      );

    case 'video':
    case 'url':
    case 'dataSource':
    default:
      return (
        <Input
          value={value as string}
          placeholder={item.placeholder ?? bindableHint}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/**
 * 颜色编辑器：色块 + 文本框。
 * 保留文本输入是因为运营常直接粘 rgba() 或 transparent，
 * 纯取色器给不了这些值。
 */
function ColorEditor({ value, onChange }: { value?: string; onChange: (v: string) => void }) {
  return (
    <Space.Compact style={{ width: '100%' }}>
      <ColorPicker
        value={value && value !== 'transparent' ? value : undefined}
        onChange={(color) => onChange(color.toHexString())}
      />
      <Input
        value={value ?? ''}
        placeholder="transparent"
        onChange={(e) => onChange(e.target.value)}
      />
    </Space.Compact>
  );
}
