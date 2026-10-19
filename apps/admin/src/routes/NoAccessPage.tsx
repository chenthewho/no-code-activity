import { Result } from 'antd';
import { useAuthStore } from '../stores/auth';

/** 登录了但还没有任何可用权限：典型是首次 SSO 开户、等待管理员授权 */
export function NoAccessPage() {
  const user = useAuthStore((s) => s.user);
  return (
    <Result
      status="403"
      title="暂无可用权限"
      subTitle={`账号 ${user?.username ?? ''} 已开通，但还没有分配角色。请联系管理员在「用户管理」中授权。`}
    />
  );
}
