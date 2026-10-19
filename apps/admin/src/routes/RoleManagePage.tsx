import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Divider,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Table,
  Tag,
  message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { roleApi, type PermissionItem, type RoleItem } from '../api';

interface RoleValues {
  code: string;
  name: string;
  remark?: string;
  permissions: string[];
}

const MODULE_LABEL: Record<string, string> = {
  activity: '活动',
  template: '模板',
  material: '物料',
  ai: 'AI 助手',
  monitor: '运行监控',
  system: '系统',
};

/** 角色与授权。权限按模块分组，一眼看出某个角色在每块业务上能做什么 */
export function RoleManagePage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<RoleItem | 'new' | null>(null);
  const [form] = Form.useForm<RoleValues>();

  const { data: roles = [], isLoading } = useQuery({ queryKey: ['roles'], queryFn: roleApi.list });
  const { data: permissions = [] } = useQuery({
    queryKey: ['permissions'],
    queryFn: roleApi.permissions,
  });

  const groups = useMemo(() => {
    const map = new Map<string, PermissionItem[]>();
    for (const p of permissions) {
      const key = p.module ?? 'system';
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return [...map.entries()];
  }, [permissions]);
  const nameOf = useMemo(() => new Map(permissions.map((p) => [p.code, p.name])), [permissions]);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['roles'] });
  const onError = (err: Error) => void message.error(err.message);

  const saveMutation = useMutation({
    mutationFn: async (values: RoleValues) => {
      if (editing === 'new') {
        await roleApi.create(values);
      } else if (editing) {
        await roleApi.update(editing.id, {
          name: values.name,
          remark: values.remark,
          ...(editing.builtin ? {} : { permissions: values.permissions }),
        });
      }
    },
    onSuccess: () => {
      void message.success('已保存，约一分钟内对该角色下所有用户生效');
      setEditing(null);
      refresh();
    },
    onError,
  });

  const removeMutation = useMutation({
    mutationFn: roleApi.remove,
    onSuccess: () => {
      void message.success('角色已删除');
      refresh();
    },
    onError,
  });

  const open = (role: RoleItem | 'new') => {
    setEditing(role);
    form.setFieldsValue(
      role === 'new'
        ? { code: '', name: '', remark: '', permissions: [] }
        : { code: role.code, name: role.name, remark: role.remark, permissions: role.permissions },
    );
  };

  const columns = [
    {
      title: '角色',
      width: 240,
      render: (_: unknown, row: RoleItem) => (
        <Space style={{ whiteSpace: 'nowrap' }}>
          <strong>{row.name}</strong>
          <span style={{ color: '#8c8c8c' }}>{row.code}</span>
          {row.builtin && <Tag color="gold">内置</Tag>}
        </Space>
      ),
    },
    {
      title: '权限',
      dataIndex: 'permissions',
      render: (codes: string[], row: RoleItem) =>
        row.builtin ? (
          <Tag color="gold">全部权限</Tag>
        ) : (
          <Space size={[0, 4]} wrap>
            {codes.map((c) => (
              <Tag key={c}>{nameOf.get(c) ?? c}</Tag>
            ))}
          </Space>
        ),
    },
    { title: '用户数', dataIndex: 'userCount', width: 90 },
    {
      title: '操作',
      width: 150,
      render: (_: unknown, row: RoleItem) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => open(row)}>
            编辑
          </Button>
          {!row.builtin && (
            <Popconfirm
              title="确认删除该角色？"
              disabled={row.userCount > 0}
              onConfirm={() => removeMutation.mutate(row.id)}
            >
              <Button type="link" size="small" danger disabled={row.userCount > 0}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const builtin = editing !== 'new' && editing?.builtin;

  return (
    <Card
      title="角色权限"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => open('new')}>
          新建角色
        </Button>
      }
    >
      <Table
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={roles}
        columns={columns}
        pagination={false}
      />

      <Modal
        title={editing === 'new' ? '新建角色' : `编辑角色 · ${editing?.name ?? ''}`}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
        confirmLoading={saveMutation.isPending}
        width={640}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
          <Space style={{ display: 'flex' }} align="start">
            <Form.Item name="name" label="角色名称" rules={[{ required: true }]}>
              <Input style={{ width: 200 }} />
            </Form.Item>
            <Form.Item
              name="code"
              label="角色编码"
              rules={[
                {
                  required: true,
                  pattern: /^[a-z][a-z0-9_]*$/,
                  message: '小写字母开头，可含数字与下划线',
                },
              ]}
            >
              <Input style={{ width: 200 }} disabled={editing !== 'new'} />
            </Form.Item>
          </Space>
          <Form.Item name="remark" label="说明">
            <Input />
          </Form.Item>
          <Divider plain orientation="left" style={{ marginTop: 0 }}>
            授权
          </Divider>
          {builtin ? (
            <p style={{ color: '#8c8c8c' }}>超级管理员恒有全部权限，不能修改授权。</p>
          ) : (
            <Form.Item
              name="permissions"
              extra="只能勾选你自己拥有的权限；「全部活动」是数据范围，没有它只能看到自己负责或参与的活动"
            >
              <Checkbox.Group style={{ width: '100%' }}>
                {groups.map(([module, items]) => (
                  <div key={module} style={{ marginBottom: 10 }}>
                    <div style={{ color: '#8c8c8c', fontSize: 12, marginBottom: 4 }}>
                      {MODULE_LABEL[module] ?? module}
                    </div>
                    <Space size={[16, 6]} wrap>
                      {items.map((p) => (
                        <Checkbox key={p.code} value={p.code}>
                          {p.name}
                        </Checkbox>
                      ))}
                    </Space>
                  </div>
                ))}
              </Checkbox.Group>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </Card>
  );
}
