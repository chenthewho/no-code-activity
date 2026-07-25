import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { router } from './routes/router';
import { useAuthStore } from './stores/auth';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000 },
  },
});

function Root() {
  // 首屏先恢复登录态，路由守卫才不会把已登录用户误判为未登录
  useEffect(() => {
    void useAuthStore.getState().restore();
  }, []);

  return (
    <ConfigProvider locale={zhCN}>
      <AntApp>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('缺少挂载节点 #root');

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
