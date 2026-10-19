import { Layout, Menu, Dropdown, Avatar, Spin } from 'antd';
import {
  AppstoreOutlined,
  RobotOutlined,
  LogoutOutlined,
  ProjectOutlined,
  ThunderboltFilled,
  FileSearchOutlined,
} from '@ant-design/icons';
import { Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { PERMISSION } from '@nca/shared';
import { useAuthStore } from '../stores/auth';

const { Header, Sider, Content } = Layout;

export function AppLayout() {
  const { user, logout, can, initializing } = useAuthStore();
  const location = useLocation();
  const navigate = useNavigate();

  if (initializing) {
    return (
      <div
        style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}
      >
        <Spin size="large" />
      </div>
    );
  }

  // 菜单按权限码过滤，没权限的入口直接不渲染，而不是点进去再报错
  const items: { key: string; icon?: React.ReactNode; label: React.ReactNode }[] = [
    can(PERMISSION.ACTIVITY_VIEW) && {
      key: '/activities',
      icon: <ProjectOutlined />,
      label: <Link to="/activities">活动管理</Link>,
    },
    can(PERMISSION.TEMPLATE_VIEW) && {
      key: '/templates',
      icon: <AppstoreOutlined />,
      label: <Link to="/templates">模板中心</Link>,
    },
    can(PERMISSION.AI_USE) && {
      key: '/ai',
      icon: <RobotOutlined />,
      label: <Link to="/ai">AI 工作台</Link>,
    },
    can(PERMISSION.SYSTEM_MANAGE) && {
      key: '/audit',
      icon: <FileSearchOutlined />,
      label: <Link to="/audit">操作审计</Link>,
    },
  ].filter(Boolean) as { key: string; icon?: React.ReactNode; label: React.ReactNode }[];

  const selected = items.find((item) => location.pathname.startsWith(item.key))?.key;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingInline: 24,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: '#fff',
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          <ThunderboltFilled style={{ color: '#1677ff' }} />
          活动运营平台
        </div>
        <Dropdown
          menu={{
            items: [
              { key: 'roles', label: `角色：${user?.roles.join('、') || '无'}`, disabled: true },
              { type: 'divider' as const },
              {
                key: 'logout',
                icon: <LogoutOutlined />,
                label: '退出登录',
                onClick: () => {
                  logout();
                  void navigate({
                    to: '/login',
                    search: { redirect: undefined, sso_ticket: undefined },
                  });
                },
              },
            ],
          }}
        >
          <div style={{ color: '#fff', cursor: 'pointer' }}>
            <Avatar size="small" src={user?.avatar} style={{ marginRight: 8 }}>
              {user?.nickname?.[0]}
            </Avatar>
            {user?.nickname}
          </div>
        </Dropdown>
      </Header>
      <Layout>
        <Sider width={200} theme="light" style={{ borderRight: '1px solid #f0f0f0' }}>
          <Menu
            mode="inline"
            style={{ borderInlineEnd: 'none', paddingTop: 8 }}
            selectedKeys={selected ? [selected] : []}
            items={items}
          />
        </Sider>
        <Content style={{ padding: 20, background: '#f5f7fa' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
