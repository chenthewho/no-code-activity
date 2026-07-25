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

export const templateApi = {
  list: (query: { page?: number; pageSize?: number; keyword?: string } = {}) =>
    request<PageResult<{ id: string; title: string; cover?: string; useCount: number }>>(
      '/templates',
      { query: query as Record<string, string> },
    ),
  saveFrom: (body: { title: string; activityId: string; description?: string }) =>
    request<{ id: string }>('/templates', { method: 'POST', body }),
};
