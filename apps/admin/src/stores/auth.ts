import type { CurrentUser, Permission } from '@nca/shared';
import { PERMISSION } from '@nca/shared';
import { create } from 'zustand';
import { authApi } from '../api';
import { clearToken, getToken, setToken } from '../api/client';

interface AuthState {
  user: CurrentUser | null;
  /** 未完成首次校验前为 true，路由守卫据此避免误判为未登录而闪跳登录页 */
  initializing: boolean;
  login: (username: string, password: string) => Promise<void>;
  /** SSO 回跳带回的一次性票据换登录态 */
  loginWithSsoTicket: (ticket: string) => Promise<void>;
  logout: () => void;
  restore: () => Promise<void>;
  can: (...permissions: Permission[]) => boolean;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  initializing: true,

  async login(username, password) {
    const { token, user } = await authApi.login(username, password);
    setToken(token);
    set({ user, initializing: false });
  },

  async loginWithSsoTicket(ticket) {
    const { token, user } = await authApi.ssoExchange(ticket);
    setToken(token);
    set({ user, initializing: false });
  },

  logout() {
    clearToken();
    set({ user: null });
  },

  /** 刷新页面后用本地 token 换回用户信息与权限码 */
  async restore() {
    if (!getToken()) {
      set({ user: null, initializing: false });
      return;
    }
    try {
      set({ user: await authApi.me(), initializing: false });
    } catch {
      clearToken();
      set({ user: null, initializing: false });
    }
  },

  can(...permissions) {
    const user = get().user;
    if (!user) return false;
    if (user.permissions.includes(PERMISSION.SYSTEM_MANAGE)) return true;
    return permissions.every((p) => user.permissions.includes(p));
  },
}));
