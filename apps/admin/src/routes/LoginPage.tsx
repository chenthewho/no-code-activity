import { useEffect, useRef, useState } from 'react';
import { Button, Card, Divider, Form, Input, Alert, Spin } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { adminSsoUrl, authApi } from '../api';
import { useAuthStore } from '../stores/auth';

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const loginWithSsoTicket = useAuthStore((s) => s.loginWithSsoTicket);
  const navigate = useNavigate();
  const search = useSearch({ from: '/login' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exchanging, setExchanging] = useState(Boolean(search.sso_ticket));
  const exchangedRef = useRef(false);

  const { data: sso } = useQuery({
    queryKey: ['sso-config'],
    queryFn: authApi.ssoConfig,
    // 拿不到配置就当没开 SSO，账号密码登录照常可用
    retry: false,
  });

  const target = search.redirect && search.redirect.startsWith('/') ? search.redirect : '/activities';

  // SSO 回跳：票据只能用一次，StrictMode 下 effect 会跑两遍，用 ref 挡住第二遍
  useEffect(() => {
    const ticket = search.sso_ticket;
    if (!ticket || exchangedRef.current) return;
    exchangedRef.current = true;
    void (async () => {
      try {
        await loginWithSsoTicket(ticket);
        await navigate({ to: target, replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : '统一登录失败');
        setExchanging(false);
        // 失败的票据从地址栏摘掉，免得刷新再撞一次
        await navigate({ to: '/login', search: { redirect: search.redirect, sso_ticket: undefined }, replace: true });
      }
    })();
  }, [loginWithSsoTicket, navigate, search.redirect, search.sso_ticket, target]);

  const onFinish = async (values: { username: string; password: string }) => {
    setLoading(true);
    setError('');
    try {
      await login(values.username, values.password);
      // 登录成功回到原本要去的页面，而不是一律扔到首页
      await navigate({ to: target });
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: '#f0f2f5',
      }}
    >
      <Card title="活动运营平台" style={{ width: 380 }}>
        {exchanging ? (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <Spin />
            <div style={{ marginTop: 12, color: '#8c8c8c' }}>正在完成统一登录…</div>
          </div>
        ) : (
          <>
            {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} showIcon />}
            <Form layout="vertical" onFinish={onFinish} initialValues={{ username: '', password: '' }}>
              <Form.Item
                name="username"
                label="用户名"
                rules={[{ required: true, message: '请输入用户名' }]}
              >
                <Input autoComplete="username" size="large" />
              </Form.Item>
              <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password autoComplete="current-password" size="large" />
              </Form.Item>
              <Button type="primary" htmlType="submit" loading={loading} block size="large">
                登录
              </Button>
            </Form>
            {sso?.enabled && (
              <>
                <Divider plain style={{ color: '#8c8c8c', fontSize: 12 }}>
                  或
                </Divider>
                <Button
                  block
                  size="large"
                  icon={<SafetyCertificateOutlined />}
                  onClick={() => window.location.assign(adminSsoUrl(target))}
                >
                  {sso.label}
                </Button>
              </>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
