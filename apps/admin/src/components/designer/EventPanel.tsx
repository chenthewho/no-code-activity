import { Button, Card, Collapse, Dropdown, Empty, Form, Input, InputNumber, Select, Space, Switch, Tag } from 'antd';
import type { DslAction, DslActionType, MaterialMeta } from '@nca/dsl';
import { useDesignerStore } from '../../stores/designer';
import { ACTION_DEFS, ACTION_DEF_MAP, createAction, describeAction, type ActionFieldDef } from './action-schema';

const TRIGGER_LABEL: Record<string, string> = {
  onClick: '点击时',
  onLoad: '加载时',
  onExpose: '曝光时',
  onChange: '变更时',
  onCustom: '自定义事件',
};

/** 物料声明的事件名 → 通用触发器。与渲染器 emit 的匹配规则保持一致 */
function triggerForEvent(eventName: string): { trigger: string; customEvent?: string } {
  const mapped: Record<string, string> = {
    click: 'onClick',
    change: 'onChange',
    load: 'onLoad',
    expose: 'onExpose',
  };
  const trigger = mapped[eventName];
  return trigger ? { trigger } : { trigger: 'onCustom', customEvent: eventName };
}

export function EventPanel({ meta }: { meta: MaterialMeta }) {
  const { dsl, selectedId, addEvent, removeEvent, addAction, removeAction, moveAction, updateAction } =
    useDesignerStore();

  if (!selectedId) return null;

  const bindings = dsl.events.filter((e) => e.nodeId === selectedId);

  if (meta.events.length === 0) {
    return <Empty description="该组件无可绑定事件" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
  }

  // 已绑过的事件不再重复列出，一个触发器一条绑定，动作在里面排队
  const boundKeys = new Set(bindings.map((b) => b.customEvent ?? b.trigger));
  const available = meta.events.filter((e) => {
    const { trigger, customEvent } = triggerForEvent(e.name);
    return !boundKeys.has(customEvent ?? trigger);
  });

  return (
    <div style={{ padding: 4 }}>
      {bindings.length === 0 && (
        <div style={{ marginBottom: 12, color: '#888', fontSize: 12 }}>
          还没有事件绑定。选一个触发器，再往里加动作。
        </div>
      )}

      {bindings.map((binding) => (
        <Card
          key={binding.id}
          size="small"
          style={{ marginBottom: 12 }}
          title={
            <Space size={4}>
              <Tag color="blue">
                {binding.customEvent
                  ? `自定义 · ${binding.customEvent}`
                  : (TRIGGER_LABEL[binding.trigger] ?? binding.trigger)}
              </Tag>
              <span style={{ color: '#999', fontSize: 12 }}>{binding.actions.length} 个动作</span>
            </Space>
          }
          extra={
            <a style={{ color: '#ff4d4f', fontSize: 12 }} onClick={() => removeEvent(binding.id)}>
              删除
            </a>
          }
        >
          {binding.actions.length === 0 ? (
            <div style={{ marginBottom: 8, color: '#bbb', fontSize: 12 }}>暂无动作</div>
          ) : (
            <Collapse
              size="small"
              ghost
              items={binding.actions.map((action, index) => ({
                key: String(index),
                label: (
                  <span style={{ fontSize: 12 }}>
                    <Tag color="default">{index + 1}</Tag>
                    {describeAction(action)}
                  </span>
                ),
                extra: (
                  <Space size={2} onClick={(e) => e.stopPropagation()}>
                    <a style={{ fontSize: 12 }} onClick={() => moveAction(binding.id, index, -1)}>
                      ↑
                    </a>
                    <a style={{ fontSize: 12 }} onClick={() => moveAction(binding.id, index, 1)}>
                      ↓
                    </a>
                    <a
                      style={{ fontSize: 12, color: '#ff4d4f' }}
                      onClick={() => removeAction(binding.id, index)}
                    >
                      ✕
                    </a>
                  </Space>
                ),
                children: (
                  <ActionForm
                    action={action}
                    onChange={(patch) => updateAction(binding.id, index, patch)}
                  />
                ),
              }))}
            />
          )}

          <Dropdown
            trigger={['click']}
            menu={{
              items: groupActionMenu(),
              onClick: ({ key }) => addAction(binding.id, createAction(key as DslActionType)),
            }}
          >
            <Button size="small" type="dashed" block style={{ marginTop: 8 }}>
              + 添加动作
            </Button>
          </Dropdown>
        </Card>
      ))}

      {available.length > 0 && (
        <Dropdown
          trigger={['click']}
          menu={{
            items: available.map((e) => ({ key: e.name, label: e.label })),
            onClick: ({ key }) => {
              const { trigger, customEvent } = triggerForEvent(key);
              addEvent(selectedId, trigger as 'onClick', customEvent);
            },
          }}
        >
          <Button size="small" type="primary" ghost block>
            + 绑定事件
          </Button>
        </Dropdown>
      )}
    </div>
  );
}

function groupActionMenu() {
  const groups = ['页面', '数据', '业务', '宿主'] as const;
  return groups.map((group) => ({
    key: group,
    type: 'group' as const,
    label: group,
    children: ACTION_DEFS.filter((d) => d.group === group).map((d) => ({
      key: d.type,
      label: d.label,
    })),
  }));
}

function ActionForm({
  action,
  onChange,
}: {
  action: DslAction;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const def = ACTION_DEF_MAP[action.type];
  const record = action as unknown as Record<string, unknown>;

  if (!def || def.fields.length === 0) {
    return <div style={{ color: '#999', fontSize: 12 }}>该动作无需配置</div>;
  }

  return (
    <Form layout="vertical" size="small">
      {def.description && (
        <div style={{ marginBottom: 8, color: '#999', fontSize: 12 }}>{def.description}</div>
      )}
      {def.fields.map((field) => (
        <Form.Item key={field.key} label={field.label} extra={field.help} style={{ marginBottom: 10 }}>
          <ActionField
            field={field}
            value={record[field.key]}
            onChange={(value) => onChange({ [field.key]: value })}
          />
        </Form.Item>
      ))}
      <Form.Item label="执行条件" extra="留空则始终执行" style={{ marginBottom: 0 }}>
        <Input
          size="small"
          value={(record.condition as string) ?? ''}
          placeholder="{{ state.joined === false }}"
          onChange={(e) => onChange({ condition: e.target.value || undefined })}
        />
      </Form.Item>
    </Form>
  );
}

function ActionField({
  field,
  value,
  onChange,
}: {
  field: ActionFieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const dsl = useDesignerStore((s) => s.dsl);

  switch (field.editor) {
    case 'number':
      return <InputNumber style={{ width: '100%' }} value={value as number} onChange={onChange} />;

    case 'boolean':
      return <Switch checked={Boolean(value)} onChange={onChange} />;

    case 'select':
      return (
        <Select
          style={{ width: '100%' }}
          value={value as string}
          options={field.options}
          onChange={onChange}
          allowClear
        />
      );

    case 'node': {
      // 只列出可选节点，避免运营手输 id 打错——这类错误要到发布校验才暴露
      const options = Object.entries(dsl.craftJson)
        .filter(([, node]) => !field.nodeMaterial || node.type.resolvedName === field.nodeMaterial)
        .map(([id, node]) => ({
          label: `${node.displayName ?? node.type.resolvedName} (${id})`,
          value: id,
        }));
      return (
        <Select
          style={{ width: '100%' }}
          value={(value as string) || undefined}
          options={options}
          onChange={onChange}
          placeholder={options.length === 0 ? '画布中还没有可选节点' : '请选择'}
          allowClear
        />
      );
    }

    case 'dataSource': {
      const options = dsl.dataSources.map((ds) => ({ label: `${ds.name} (${ds.id})`, value: ds.id }));
      return (
        <Select
          style={{ width: '100%' }}
          value={(value as string) || undefined}
          options={options}
          onChange={onChange}
          placeholder={options.length === 0 ? '还没有配置数据源' : '请选择'}
          allowClear
        />
      );
    }

    case 'json':
      return (
        <Input.TextArea
          rows={2}
          value={typeof value === 'string' ? value : JSON.stringify(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => {
            const text = e.target.value;
            try {
              onChange(JSON.parse(text));
            } catch {
              onChange(text);
            }
          }}
        />
      );

    case 'textarea':
      return (
        <Input.TextArea
          rows={2}
          value={value as string}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    default:
      return (
        <Input
          value={value as string}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
