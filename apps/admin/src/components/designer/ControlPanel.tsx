import { Alert, Divider, Form, Input, Select, Switch } from 'antd';
import { useDesignerStore } from '../../stores/designer';

/**
 * 结构容器配置：条件渲染与列表渲染。
 * 这两项不属于任何单个物料，是节点层面的能力，所以独立成一栏，
 * 而不是塞进 propsSchema。
 */
export function ControlPanel({ nodeId }: { nodeId: string }) {
  const { dsl, updateControl } = useDesignerStore();
  const node = dsl.craftJson[nodeId];
  if (!node) return null;

  const control = node.control;
  const loop = control?.loop;

  const dataSourceOptions = dsl.dataSources.map((ds) => ({
    label: `${ds.name} (${ds.id})`,
    value: `{{ dataSource.${ds.id} }}`,
  }));

  return (
    <Form layout="vertical" size="small" style={{ padding: 4 }}>
      <Form.Item label="条件渲染" extra="表达式为假时，该节点及其子树都不渲染">
        <Input
          value={control?.if ?? ''}
          placeholder="{{ state.joined === false }}"
          onChange={(e) =>
            updateControl(nodeId, normalize({ ...control, if: e.target.value || undefined }))
          }
        />
      </Form.Item>

      <Divider style={{ margin: '12px 0' }} />

      <Form.Item label="列表渲染" style={{ marginBottom: 8 }}>
        <Switch
          checked={Boolean(loop)}
          onChange={(checked) =>
            updateControl(
              nodeId,
              normalize({
                ...control,
                loop: checked
                  ? { source: '', itemAlias: 'item', indexAlias: 'index' }
                  : undefined,
              }),
            )
          }
        />
        <span style={{ marginLeft: 8, color: '#999', fontSize: 12 }}>
          按数据源逐项重复渲染该节点
        </span>
      </Form.Item>

      {loop && (
        <>
          <Form.Item label="数据来源" extra="可从数据源选，也可手填表达式">
            <Select
              style={{ width: '100%' }}
              value={loop.source || undefined}
              options={dataSourceOptions}
              placeholder={dataSourceOptions.length === 0 ? '还没有数据源' : '选择数据源'}
              onChange={(value) =>
                updateControl(nodeId, normalize({ ...control, loop: { ...loop, source: value } }))
              }
              allowClear
            />
            <Input
              style={{ marginTop: 6 }}
              value={loop.source}
              placeholder="{{ dataSource.rank }}"
              onChange={(e) =>
                updateControl(
                  nodeId,
                  normalize({ ...control, loop: { ...loop, source: e.target.value } }),
                )
              }
            />
          </Form.Item>

          <Form.Item label="单项变量名">
            <Input
              value={loop.itemAlias}
              onChange={(e) =>
                updateControl(
                  nodeId,
                  normalize({
                    ...control,
                    loop: { ...loop, itemAlias: e.target.value || 'item' },
                  }),
                )
              }
            />
          </Form.Item>

          <Form.Item label="下标变量名">
            <Input
              value={loop.indexAlias}
              onChange={(e) =>
                updateControl(
                  nodeId,
                  normalize({
                    ...control,
                    loop: { ...loop, indexAlias: e.target.value || 'index' },
                  }),
                )
              }
            />
          </Form.Item>

          <Form.Item
            label="唯一标识表达式"
            extra="列表会重排时务必配置，否则组件状态会错位"
          >
            <Input
              value={loop.keyBy ?? ''}
              placeholder={`{{ ${loop.itemAlias}.id }}`}
              onChange={(e) =>
                updateControl(
                  nodeId,
                  normalize({
                    ...control,
                    loop: { ...loop, keyBy: e.target.value || undefined },
                  }),
                )
              }
            />
          </Form.Item>

          <Alert
            type="info"
            showIcon
            message={`子节点里可用 {{ ${loop.itemAlias}.字段 }} 和 {{ ${loop.indexAlias} }}`}
            style={{ fontSize: 12 }}
          />
        </>
      )}
    </Form>
  );
}

/** 两项都空时把 control 整个摘掉，避免 DSL 里留下一堆空壳字段 */
function normalize(control: {
  if?: string;
  loop?: { source: string; itemAlias: string; indexAlias: string; keyBy?: string };
}) {
  if (!control.if && !control.loop) return undefined;
  return control;
}
