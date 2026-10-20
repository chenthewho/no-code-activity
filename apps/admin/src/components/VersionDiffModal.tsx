import { useMemo, useState } from 'react';
import { Alert, Descriptions, Empty, List, Modal, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { diffDsl, finalDslSchema, type FieldChange, type FinalDsl } from '@nca/dsl';
import { activityApi, type VersionItem } from '../api';

/** 对比的右侧：某个发布版本，或者设计器里还没发布的草稿 */
export type DiffTarget = { version: number } | { dsl: FinalDsl; label: string };

interface Props {
  activityId: string;
  open: boolean;
  onClose: () => void;
  versions: VersionItem[];
  /** 左侧（基准）版本，缺省取右侧之前的那一版 */
  fromVersion?: number;
  to: DiffTarget;
}

function short(value: unknown): string {
  if (value === undefined) return '（无）';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

function FieldTable({ changes }: { changes: FieldChange[] }) {
  return (
    <Table
      size="small"
      rowKey="path"
      pagination={false}
      dataSource={changes}
      columns={[
        { title: '字段', dataIndex: 'path', width: 180, render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
        { title: '改前', dataIndex: 'from', render: (v: unknown) => <Typography.Text type="secondary">{short(v)}</Typography.Text> },
        { title: '改后', dataIndex: 'to', render: (v: unknown) => short(v) },
      ]}
    />
  );
}

/**
 * 两版之间改了什么：按组件、事件、数据源、页面设置分组列出。
 * 回滚、灰度、发布前看一眼，比对着两个预览找不同可靠得多。
 */
export function VersionDiffModal({ activityId, open, onClose, versions, fromVersion, to }: Props) {
  const toVersion = 'version' in to ? to.version : undefined;
  const defaultFrom =
    fromVersion ?? versions.map((v) => v.version).filter((v) => toVersion === undefined || v < toVersion).sort((a, b) => b - a)[0];
  const [from, setFrom] = useState<number | undefined>(defaultFrom);

  const fromQuery = useQuery({
    queryKey: ['version-dsl', activityId, from],
    queryFn: () => activityApi.versionDsl(activityId, from!),
    enabled: open && from !== undefined,
  });
  const toQuery = useQuery({
    queryKey: ['version-dsl', activityId, toVersion],
    queryFn: () => activityApi.versionDsl(activityId, toVersion!),
    enabled: open && toVersion !== undefined,
  });

  const toDsl = 'dsl' in to ? to.dsl : toQuery.data?.dsl;
  const diff = useMemo(() => {
    if (!fromQuery.data || !toDsl) return null;
    // 存量快照可能缺默认字段，过一遍 schema 补齐后再比，避免把「补了默认值」当成改动；
    // 个别老快照过不了新 schema 时按原样比，宁可多报几处也不能整个对比打不开
    const normalize = (dsl: unknown) => {
      const parsed = finalDslSchema.safeParse(dsl);
      return parsed.success ? parsed.data : (dsl as FinalDsl);
    };
    return diffDsl(normalize(fromQuery.data.dsl), normalize(toDsl));
  }, [fromQuery.data, toDsl]);

  const toLabel = 'label' in to ? to.label : `v${to.version}`;
  const loading = fromQuery.isLoading || toQuery.isLoading;

  return (
    <Modal title="版本对比" open={open} onCancel={onClose} footer={null} width={860} destroyOnHidden>
      <Space style={{ marginBottom: 16 }}>
        <Select
          style={{ width: 200 }}
          value={from}
          onChange={setFrom}
          placeholder="选择基准版本"
          options={versions
            .filter((v) => v.version !== toVersion)
            .map((v) => ({ value: v.version, label: `v${v.version}${v.changelog ? ` · ${v.changelog}` : ''}` }))}
        />
        <span>→</span>
        <Tag color="blue">{toLabel}</Tag>
      </Space>

      {from === undefined ? (
        <Empty description="还没有可对比的发布版本" />
      ) : loading || !diff ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin />
        </div>
      ) : diff.empty ? (
        <Alert type="success" showIcon message="两版内容一致，没有任何改动" />
      ) : (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Descriptions size="small" column={4} bordered>
            <Descriptions.Item label="新增组件">{diff.nodes.added.length}</Descriptions.Item>
            <Descriptions.Item label="删除组件">{diff.nodes.removed.length}</Descriptions.Item>
            <Descriptions.Item label="修改组件">{diff.nodes.changed.length}</Descriptions.Item>
            <Descriptions.Item label="事件 / 数据源">
              {diff.events.added.length + diff.events.removed.length + diff.events.changed.length} /{' '}
              {diff.dataSources.added.length + diff.dataSources.removed.length + diff.dataSources.changed.length}
            </Descriptions.Item>
          </Descriptions>

          {(diff.nodes.added.length > 0 || diff.nodes.removed.length > 0) && (
            <div>
              {diff.nodes.added.map((n) => (
                <Tag key={n.id} color="success">
                  + {n.label}
                </Tag>
              ))}
              {diff.nodes.removed.map((n) => (
                <Tag key={n.id} color="error">
                  − {n.label}
                </Tag>
              ))}
            </div>
          )}

          {diff.nodes.changed.length > 0 && (
            <List
              size="small"
              header={<strong>修改的组件</strong>}
              bordered
              dataSource={diff.nodes.changed}
              renderItem={(n) => (
                <List.Item style={{ display: 'block' }}>
                  <Space style={{ marginBottom: n.props.length ? 8 : 0 }}>
                    <strong>{n.label}</strong>
                    <Typography.Text type="secondary">{n.id}</Typography.Text>
                    {n.moved && <Tag>挪了位置</Tag>}
                    {n.other.map((o) => (
                      <Tag key={o}>{o}</Tag>
                    ))}
                  </Space>
                  {n.props.length > 0 && <FieldTable changes={n.props} />}
                </List.Item>
              )}
            />
          )}

          {(['events', 'dataSources'] as const).map((key) => {
            const c = diff[key];
            if (c.added.length + c.removed.length + c.changed.length === 0) return null;
            return (
              <div key={key}>
                <strong>{key === 'events' ? '事件绑定' : '数据源'}：</strong>
                {c.added.map((id) => (
                  <Tag key={`a${id}`} color="success">
                    + {id}
                  </Tag>
                ))}
                {c.removed.map((id) => (
                  <Tag key={`r${id}`} color="error">
                    − {id}
                  </Tag>
                ))}
                {c.changed.map((id) => (
                  <Tag key={`c${id}`} color="processing">
                    ~ {id}
                  </Tag>
                ))}
              </div>
            );
          })}

          {diff.meta.length > 0 && (
            <div>
              <strong>页面设置</strong>
              <FieldTable changes={diff.meta} />
            </div>
          )}
          {diff.initialState.length > 0 && (
            <div>
              <strong>初始状态</strong>
              <FieldTable changes={diff.initialState} />
            </div>
          )}
        </Space>
      )}
    </Modal>
  );
}
