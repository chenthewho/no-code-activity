import { Empty, Form, Input, InputNumber, Radio, Select, Switch, Tabs, ColorPicker } from 'antd';
import type { JsonValue, MaterialMeta, PropSchemaItem } from '@nca/dsl';
import { useDesignerStore } from '../../stores/designer';
import { EventPanel } from './EventPanel';
import { ControlPanel } from './ControlPanel';
import { ImagePicker } from './ImagePicker';

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
    return <Empty description="在画布中选择一个组件" style={{ marginTop: 60 }} />;
  }

  const node = dsl.craftJson[selectedId];
  const meta = metas.find((m) => m.name === node?.type.resolvedName);
  if (!node || !meta) {
    return <Empty description="该组件未在物料表中注册" style={{ marginTop: 60 }} />;
  }

  const props = node.props as Record<string, unknown>;
  const groups = {
    props: meta.propsSchema.filter((p) => p.group === 'props'),
    style: meta.propsSchema.filter((p) => p.group === 'style'),
  };

  const renderGroup = (items: PropSchemaItem[]) => {
    const visible = items.filter((item) => isVisible(item, props));
    if (visible.length === 0) {
      return <Empty description="无可配置项" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
    }
    return (
      <Form layout="vertical" size="small">
        {visible.map((item) => (
          <Form.Item key={item.key} label={item.label} extra={item.help} style={{ marginBottom: 12 }}>
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
      items={[
        { key: 'props', label: '属性', children: renderGroup(groups.props) },
        { key: 'style', label: '样式', children: renderGroup(groups.style) },
        { key: 'event', label: '事件', children: <EventPanel meta={meta} /> },
        { key: 'control', label: '逻辑', children: <ControlPanel nodeId={selectedId} /> },
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
      return <Switch checked={Boolean(value)} onChange={onChange} />;

    case 'color':
      return (
        <ColorPicker
          value={(value as string) || undefined}
          showText
          onChange={(color) => onChange(color.toHexString())}
        />
      );

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
