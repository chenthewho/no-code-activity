import { useState } from 'react';
import { Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tag, message } from 'antd';
import { KeyOutlined, PlusOutlined, UserOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { roleApi, userApi, type UserItem } from '../api';
import { useAuthStore } from '../stores/auth';

interface CreateValues {
  username: string;
  nickname: string;
  password: string;
  email?: string;
  roleCodes: string[];
}

interface EditValues {
  nickname: string;
  email?: string;
  roleCodes: string[];
}

/**
 * 用户管理。服务端有两条硬规则，这里只是让人别撞上去：
 * 不能动自己的角色和启停；只能授予自己拥有的权限（超级管理员除外）。
 */
export function UserManagePage() {
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserItem | null>(null);
  const [resetting, setResetting] = useState<UserItem | null>(null);
  const [createForm] = Form.useForm<CreateValues>();
  const [editForm] = Form.useForm<EditValues>();
  const [passwordForm] = Form.useForm<{ password: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['users', page, keyword],
    queryFn: () => userApi.list({ page, pageSize: 20, keyword: keyword || undefined }),
  });
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: roleApi.list });
  const roleOptions = roles.map((r) => ({ value: r.code, label: r.name }));

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['users'] });
  const onError = (err: Error) => void message.error(err.message);

  const createMutation = useMutation({
    mutationFn: userApi.create,
    onSuccess: () => {
      void message.success('用户已创建');
      setCreating(false);
      createForm.resetFields();
      refresh();
    },
    onError,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof userApi.update>[1] }) =>
      userApi.update(id, body),
    onSuccess: () => {
      void message.success('已保存，权限变更约一分钟内对该用户生效');
      setEditing(null);
      refresh();
    },
    onError,
  });

  const resetMutation = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      userApi.resetPassword(id, password),
    onSuccess: () => {
      void message.success('密码已重置');
      setResetting(null);
      passwordForm.resetFields();
    },
    onError,
  });

  const columns = [
    {
      title: '用户',
      render: (_: unknown, row: UserItem) => (
        <Space style={{ whiteSpace: 'nowrap' }}>
          <UserOutlined style={{ color: '#bfbfbf' }} />
          <span>{row.nickname}</span>
          <span style={{ color: '#8c8c8c' }}>@{row.username}</span>
          {row.id === me?.id && <Tag>我</Tag>}
        </Space>
      ),
    },
    {
      title: '角色',
      dataIndex: 'roles',
      render: (list: UserItem['roles']) =>
        list.length ? (
          list.map((r) => <Tag key={r.code}>{r.name}</Tag>)
        ) : (
          <span style={{ color: '#bfbfbf' }}>无</span>
        ),
    },
    {
      title: '来源',
      dataIndex: 'sso',
      width: 90,
      render: (sso: boolean) => (sso ? <Tag color="blue">SSO</Tag> : <Tag>本地</Tag>),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 80,
      render: (enabled: boolean, row: UserItem) => (
        <Switch
          size="small"
          checked={enabled}
          disabled={row.id === me?.id}
          onChange={(checked) => updateMutation.mutate({ id: row.id, body: { enabled: checked } })}
        />
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString('zh-CN'),
    },
    {
      title: '操作',
      width: 170,
      render: (_: unknown, row: UserItem) => (
        <Space size="small">
          <Button
            type="link"
            size="small"
            disabled={row.id === me?.id}
            onClick={() => {
              setEditing(row);
              editForm.setFieldsValue({
                nickname: row.nickname,
                email: row.email,
                roleCodes: row.roles.map((r) => r.code),
              });
            }}
          >
            编辑
          </Button>
          <Button type="link" size="small" icon={<KeyOutlined />} onClick={() => setResetting(row)}>
            重置密码
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="用户管理"
      extra={
        <Space>
          <Input.Search
            allowClear
            placeholder="用户名 / 昵称"
            style={{ width: 220 }}
            onSearch={(value) => {
              setKeyword(value);
              setPage(1);
            }}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            新建用户
          </Button>
        </Space>
      }
    >
      <Table
        rowKey="id"
        size="middle"
        loading={isLoading}
        dataSource={data?.list ?? []}
        columns={columns}
        pagination={{
          current: page,
          pageSize: 20,
          total: data?.total ?? 0,
          onChange: setPage,
          showTotal: (total) => `共 ${total} 人`,
        }}
      />

      <Modal
        title="新建用户"
        open={creating}
        onCancel={() => setCreating(false)}
        onOk={() => createForm.submit()}
        confirmLoading={createMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={createForm}
          layout="vertical"
          initialValues={{ roleCodes: [] }}
          onFinish={(values) =>
            createMutation.mutate({ ...values, email: values.email || undefined })
          }
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item
            name="nickname"
            label="昵称"
            rules={[{ required: true, message: '请输入昵称' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            rules={[{ required: true, min: 8, message: '密码至少 8 位' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input />
          </Form.Item>
          <Form.Item name="roleCodes" label="角色" extra="只能分配权限不超过你自己的角色">
            <Select mode="multiple" options={roleOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`编辑用户 · ${editing?.username ?? ''}`}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        onOk={() => editForm.submit()}
        confirmLoading={updateMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={editForm}
          layout="vertical"
          onFinish={(values) =>
            editing &&
            updateMutation.mutate({
              id: editing.id,
              body: {
                nickname: values.nickname,
                email: values.email || undefined,
                roleCodes: values.roleCodes,
              },
            })
          }
        >
          <Form.Item name="nickname" label="昵称" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="邮箱">
            <Input />
          </Form.Item>
          <Form.Item name="roleCodes" label="角色">
            <Select mode="multiple" options={roleOptions} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`重置密码 · ${resetting?.username ?? ''}`}
        open={Boolean(resetting)}
        onCancel={() => setResetting(null)}
        onOk={() => passwordForm.submit()}
        confirmLoading={resetMutation.isPending}
        destroyOnHidden
      >
        <Form
          form={passwordForm}
          layout="vertical"
          onFinish={(values) =>
            resetting && resetMutation.mutate({ id: resetting.id, password: values.password })
          }
        >
          <Form.Item
            name="password"
            label="新密码"
            rules={[{ required: true, min: 8, message: '密码至少 8 位' }]}
            extra={resetting?.sso ? '该用户通过 SSO 开户，设置后也可用账号密码登录' : undefined}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
