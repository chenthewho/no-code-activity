import type { ApiResponse } from '@nca/shared';

const BASE_URL = import.meta.env.VITE_API_BASE ?? 'http://localhost:3100/api/v1';
const TOKEN_KEY = 'nca:token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly errors?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, query, headers, ...rest } = options;

  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }

  const token = getToken();
  const response = await fetch(url.toString(), {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // 登录态失效时清 token 并回登录页，避免后续请求连环 401
  if (response.status === 401) {
    clearToken();
    if (!window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new ApiError('登录已失效', 401);
  }

  const payload = (await response.json().catch(() => null)) as
    | (ApiResponse<T> & { errors?: { path: string; message: string }[] })
    | null;

  if (!response.ok || !payload) {
    throw new ApiError(payload?.message ?? `请求失败 (${response.status})`, response.status, payload?.errors);
  }
  return payload.data;
}
