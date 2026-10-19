import type { RuntimeAuthConfig, RuntimeLoginResult, RuntimeUserProfile } from '@nca/shared';
import { API_BASE } from './api-base';

/**
 * C 端登录态（AuthRuntime）。
 *
 * 身份只认服务端签发的 C 端 token：SSO 回跳带回来的一次性票据、宿主桥接给的
 * 一次性 code，都要先到服务端换成 token。页面脚本自己报的 userId 一律不可信。
 */

const TOKEN_KEY = 'nca:rt-token';
/** SSO 回跳时挂在活动页地址上的一次性票据参数名，与服务端约定 */
export const TICKET_PARAM = 'nca_ticket';

export class LoginRequiredError extends Error {
  constructor(message = '请先登录') {
    super(message);
    this.name = 'LoginRequiredError';
  }
}

export function getRuntimeToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return memoryToken;
  }
}

export function setRuntimeToken(token: string): void {
  memoryToken = token;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // 隐私模式写不进去就只留在内存里，本次会话内仍然有效
  }
}

export function clearRuntimeToken(): void {
  memoryToken = null;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // 同上
  }
}

let memoryToken: string | null = null;

export function authHeaders(): Record<string, string> {
  const token = getRuntimeToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * 取出地址栏上的登录票据，并立刻从地址栏抹掉——留着的话刷新会拿一张已用过的票
 * 再换一次，分享出去还会把它带给别人。
 */
export function takeTicketFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const ticket = url.searchParams.get(TICKET_PARAM);
  if (!ticket) return null;
  url.searchParams.delete(TICKET_PARAM);
  window.history.replaceState(window.history.state, '', url.toString());
  return ticket;
}

/** 发起统一登录的地址：服务端 302 到 IdP，登录完再带票据跳回当前页 */
export function ssoLoginUrl(redirect: string): string {
  return `${API_BASE}/runtime/auth/sso/authorize?redirect=${encodeURIComponent(redirect)}`;
}

let configPromise: Promise<RuntimeAuthConfig> | null = null;

export function fetchAuthConfig(): Promise<RuntimeAuthConfig> {
  configPromise ??= fetch(`${API_BASE}/runtime/auth/config`)
    .then((r) =>
      r.ok
        ? (r.json() as Promise<RuntimeAuthConfig>)
        : Promise.reject(new Error(`HTTP ${r.status}`)),
    )
    .catch((err: unknown) => {
      configPromise = null;
      throw err;
    });
  return configPromise;
}

let restorePromise: Promise<RuntimeUserProfile | null> | null = null;

/**
 * 启动时恢复登录态：地址栏有票据就换 token，否则用本地 token 取用户。
 * 整个页面生命周期只跑一次——React StrictMode 会把 effect 执行两遍，
 * 两遍各自去换票的话，第二遍拿到的是已经作废的票，还会把第一遍的结果覆盖成未登录。
 */
export function restoreLogin(): Promise<RuntimeUserProfile | null> {
  restorePromise ??= (async () => {
    const ticket = takeTicketFromUrl();
    return ticket ? exchangeTicket(ticket) : fetchRuntimeUser();
  })().catch((err: unknown) => {
    console.warn('[nca] 登录态恢复失败', err);
    return null;
  });
  return restorePromise;
}

export async function exchangeTicket(ticket: string): Promise<RuntimeUserProfile> {
  return saveLogin(await postAuth('/runtime/auth/exchange', { ticket }));
}

export async function hostLogin(host: string, code: string): Promise<RuntimeUserProfile> {
  return saveLogin(await postAuth('/runtime/auth/host-login', { host, code }));
}

/** 用本地 token 取当前用户；token 过期或被吊销就顺手清掉 */
export async function fetchRuntimeUser(): Promise<RuntimeUserProfile | null> {
  if (!getRuntimeToken()) return null;
  const response = await fetch(`${API_BASE}/runtime/auth/me`, { headers: authHeaders() });
  if (response.status === 401) {
    clearRuntimeToken();
    return null;
  }
  if (!response.ok) throw new Error(`获取登录信息失败 (${response.status})`);
  return (await response.json()) as RuntimeUserProfile;
}

function saveLogin(result: RuntimeLoginResult): RuntimeUserProfile {
  setRuntimeToken(result.token);
  return result.user;
}

async function postAuth(path: string, body: unknown): Promise<RuntimeLoginResult> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as
    (RuntimeLoginResult & { message?: string }) | null;
  if (!response.ok || !payload?.token) {
    throw new Error(payload?.message ?? `登录失败 (${response.status})`);
  }
  return payload;
}
