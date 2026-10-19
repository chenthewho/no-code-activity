import { Alert, Card, Popconfirm, Switch, Table, Tag, Tooltip, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { materialVersions } from '@nca/materials';
import { materialApi, type MaterialRegistryItem } from '../api';

const CATEGORY_LABEL: Record<string, string> = {
  basic: '基础',
  container: '容器',
  media: '媒体',
  business: '业务',
};

/**
 * 物料管理：注册表里的版本、上下架开关，以及草稿中的用量。
 * 「代码版本」取自打进后台的物料代码，与注册表不一致说明服务端还没同步（没跑 seed）。
 */
export function MaterialManagePage() {
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useQuery({
    queryKey: ['material-registry'],
    queryFn: materialApi.registry,
  });

  const toggle = useMutation({
    mutationFn: ({ name, enabled }: { name: string; enabled: boolean }) =>
      materialApi.toggle(name, enabled),
    onSuccess: (_, vars) => {
      void message.success(vars.enabled ? '已上架' : '已下架');
      void queryClient.invalidateQueries({ queryKey: ['material-registry'] });
      void queryClient.invalidateQueries({ queryKey: ['materials'] });
    },
    onError: (err: Error) => void message.error(err.message),
  });

  const columns = [
    {
      title: '物料',
      render: (_: unknown, row: MaterialRegistryItem) => (
        <span style={{ whiteSpace: 'nowrap' }}>
          <strong>{row.title}</strong> <span style={{ color: '#8c8c8c' }}>{row.name}</span>
          {row.deprecated && (
            <Tooltip
              title={[
                row.deprecated.reason,
                row.deprecated.replacedBy && `建议改用 ${row.deprecated.replacedBy}`,
              ]
                .filter(Boolean)
                .join('；')}
            >
              <Tag color="orange" style={{ marginLeft: 6 }}>
                已废弃
              </Tag>
            </Tooltip>
          )}
        </span>
      ),
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 80,
      render: (c: string) => CATEGORY_LABEL[c] ?? c,
    },
    {
      title: '注册表版本',
      dataIndex: 'version',
      width: 110,
      render: (v: string) => <Tag>v{v}</Tag>,
    },
    {
      title: '代码版本',
      width: 110,
      render: (_: unknown, row: MaterialRegistryItem) => {
        const code = materialVersions[row.name]?.version;
        if (!code) return <Tag color="red">代码中不存在</Tag>;
        return code === row.version ? (
          <span style={{ color: '#8c8c8c' }}>v{code}</span>
        ) : (
          <Tooltip title="后台打包的物料代码与注册表不一致，请在服务端执行 seed 同步">
            <Tag color="gold">v{code}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '草稿用量',
      width: 150,
      render: (_: unknown, row: MaterialRegistryItem) =>
        row.usage.nodes === 0 ? (
          <span style={{ color: '#bfbfbf' }}>未使用</span>
        ) : (
          <span>
            {row.usage.activities} 个活动 · {row.usage.nodes} 处
          </span>
        ),
    },
    {
      title: '待升级',
      width: 90,
      render: (_: unknown, row: MaterialRegistryItem) =>
        row.usage.outdated > 0 ? (
          <Tooltip title="节点记录的物料版本与注册表不一致，打开设计器或渲染时会自动升级">
            <Tag color="blue">{row.usage.outdated}</Tag>
          </Tooltip>
        ) : (
          '—'
        ),
    },
    {
      title: '上架',
      dataIndex: 'enabled',
      width: 80,
      render: (enabled: boolean, row: MaterialRegistryItem) =>
        enabled ? (
          <Popconfirm
            title="下架该物料？"
            description={
              row.usage.activities > 0
                ? `工具箱将不再提供它；${row.usage.activities} 个使用它的活动将无法再次发布`
                : '工具箱将不再提供它'
            }
            onConfirm={() => toggle.mutate({ name: row.name, enabled: false })}
          >
            <Switch size="small" checked disabled={row.name === 'Page'} />
          </Popconfirm>
        ) : (
          <Switch
            size="small"
            checked={false}
            onChange={() => toggle.mutate({ name: row.name, enabled: true })}
          />
        ),
    },
  ];

  return (
    <Card title="物料管理">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="版本规则：小版本向后兼容，存量节点只更新版本号；大版本必须随代码提供迁移函数，渲染与打开设计器时自动改写旧节点。已发布的快照不改，回滚到旧版本同样会被自动升级。"
      />
      <Table
        rowKey="name"
        size="middle"
        loading={isLoading}
        dataSource={data}
        columns={columns}
        pagination={false}
      />
    </Card>
  );
}
