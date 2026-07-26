import type { FinalDsl, MaterialMeta } from '@nca/dsl';
import type { ActivityStatus, ActivitySummary, CurrentUser, PageResult } from '@nca/shared';
import { request } from './client';

export const authApi = {
  login: (username: string, password: string) =>
    request<{ token: string; user: CurrentUser }>('/auth/login', {
      method: 'POST',
      body: { username, password },
    }),
  me: () => request<CurrentUser>('/auth/me'),
};

export interface ActivityListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: ActivityStatus;
}

export interface VersionItem {
  id: string;
  version: number;
  changelog?: string;
  createdBy?: string;
  createdAt: string;
  dslUrl?: string;
  manifestUrl?: string;
}

export interface PublishResult {
  version: number;
  dslUrl: string;
  manifestUrl: string;
  activityUrl: string;
}

export const activityApi = {
  list: (query: ActivityListQuery) =>
    request<PageResult<ActivitySummary>>('/activities', { query: query as Record<string, string> }),
  detail: (id: string) => request<ActivitySummary>(`/activities/${id}`),
  create: (body: { title: string; description?: string; templateId?: string }) =>
    request<{ id: string }>('/activities', { method: 'POST', body }),
  update: (id: string, body: Record<string, unknown>) =>
    request<unknown>(`/activities/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => request<void>(`/activities/${id}`, { method: 'DELETE' }),
  copy: (id: string) => request<{ id: string }>(`/activities/${id}/copy`, { method: 'POST' }),

  getDraft: (id: string) => request<FinalDsl>(`/activities/${id}/draft`),
  saveDraft: (id: string, dsl: FinalDsl) =>
    request<{ updatedAt: string; issues: { level: string; path: string; message: string }[] }>(
      `/activities/${id}/draft`,
      { method: 'PUT', body: { dsl } },
    ),

  publish: (id: string, changelog?: string) =>
    request<PublishResult>(`/activities/${id}/publish`, { method: 'POST', body: { changelog } }),
  versions: (id: string) => request<VersionItem[]>(`/activities/${id}/versions`),
  rollback: (id: string, version: number) =>
    request<PublishResult>(`/activities/${id}/rollback`, { method: 'POST', body: { version } }),
  changeStatus: (id: string, status: 'published' | 'offline') =>
    request<void>(`/activities/${id}/status`, { method: 'POST', body: { status } }),
};

export const materialApi = {
  list: () => request<MaterialMeta[]>('/materials'),
};

export interface AssetItem {
  id: string;
  url: string;
  type: string;
  size: number;
  createdAt: string;
}

export const assetApi = {
  list: (query: { page?: number; pageSize?: number; type?: string } = {}) =>
    request<PageResult<AssetItem>>('/assets', { query: query as Record<string, string> }),

  /** 走 FormData，不能用 request()——它固定发 JSON */
  upload: async (file: File, activityId?: string): Promise<{ url: string; reused: boolean }> => {
    const form = new FormData();
    form.append('file', file);
    if (activityId) form.append('activityId', activityId);

    const token = localStorage.getItem('nca:token');
    const base = import.meta.env.VITE_API_BASE ?? 'http://localhost:3100/api/v1';
    const response = await fetch(`${base}/assets/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const payload = (await response.json()) as { code: number; message: string; data: { url: string; reused: boolean } };
    if (!response.ok) throw new Error(payload.message ?? '上传失败');
    return payload.data;
  },
};

export interface TemplateSummary {
  id: string;
  title: string;
  cover?: string;
  description?: string;
  category?: string;
  useCount: number;
  favCount: number;
  favorited: boolean;
  createdAt: string;
}

export interface TemplateDetail extends TemplateSummary {
  dsl: FinalDsl;
}

export const templateApi = {
  list: (query: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    category?: string;
    onlyFavorite?: boolean;
  } = {}) =>
    request<PageResult<TemplateSummary>>('/templates', {
      query: query as Record<string, string>,
    }),
  categories: () => request<string[]>('/templates/categories'),
  detail: (id: string) => request<TemplateDetail>(`/templates/${id}`),
  saveFrom: (body: {
    title: string;
    activityId: string;
    description?: string;
    category?: string;
    cover?: string;
  }) => request<{ id: string }>('/templates', { method: 'POST', body }),
  toggleFavorite: (id: string) =>
    request<{ favorited: boolean }>(`/templates/${id}/favorite`, { method: 'POST' }),
  disable: (id: string) => request<void>(`/templates/${id}`, { method: 'DELETE' }),
};
