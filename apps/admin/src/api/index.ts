import type { FinalDsl, MaterialMeta } from '@nca/dsl';
import type {
  ActivityAccess,
  ActivityMemberRole,
  ActivityStatus,
  ActivitySummary,
  CurrentUser,
  GrayRule,
  PageResult,
} from '@nca/shared';
import { request } from './client';

export const authApi = {
  login: (username: string, password: string) =>
    request<{ token: string; user: CurrentUser }>('/auth/login', {
      method: 'POST',
      body: { username, password },
    }),
  me: () => request<CurrentUser>('/auth/me'),
  ssoConfig: () => request<{ enabled: boolean; label: string }>('/auth/sso/config'),
  ssoExchange: (ticket: string, nonce?: string) =>
    request<{ token: string; user: CurrentUser }>('/auth/sso/exchange', {
      method: 'POST',
      body: { ticket, nonce },
    }),
};

const SSO_NONCE_KEY = 'nca:admin-sso-nonce';

/**
 * 后台 SSO 入口：整页跳到服务端，由它 302 去 IdP。nonce 留在本浏览器的 sessionStorage，
 * 换票时带回——别人发来的 /login?sso_ticket=… 链接在这里换不了（防登录 CSRF）。
 */
export function adminSsoUrl(redirect: string): string {
  const base = import.meta.env.VITE_API_BASE ?? 'http://localhost:3100/api/v1';
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  sessionStorage.setItem(SSO_NONCE_KEY, nonce);
  return `${base}/auth/sso/authorize?redirect=${encodeURIComponent(redirect)}&nonce=${nonce}`;
}

export function takeAdminSsoNonce(): string | undefined {
  const nonce = sessionStorage.getItem(SSO_NONCE_KEY) ?? undefined;
  sessionStorage.removeItem(SSO_NONCE_KEY);
  return nonce;
}

export interface ActivityListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: ActivityStatus;
  /** mine 我负责的 / joined 我负责或参与的 / all 全部（需 activity:all） */
  scope?: 'mine' | 'joined' | 'all';
}

export interface ActivityDetail extends Omit<ActivitySummary, 'access'> {
  description?: string;
  /** 灰度中的版本与规则，没有灰度时为 null */
  grayVersion: number | null;
  grayRule: GrayRule | null;
  grayStartedAt: string | null;
  /** null：活动存在但当前用户无权访问（正常情况下服务端已 403，不会走到这里） */
  access: ActivityAccess | null;
}

export interface UserBrief {
  id: string;
  username: string;
  nickname: string;
}

export interface ActivityMembers {
  owner: UserBrief;
  members: (UserBrief & { role: ActivityMemberRole; createdAt: string })[];
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
  gray?: boolean;
}

export const activityApi = {
  list: (query: ActivityListQuery) =>
    request<PageResult<ActivitySummary>>('/activities', { query: query as Record<string, string> }),
  detail: (id: string) => request<ActivityDetail>(`/activities/${id}`),
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

  publish: (id: string, changelog?: string, gray?: GrayRule) =>
    request<PublishResult>(`/activities/${id}/publish`, {
      method: 'POST',
      body: { changelog, ...(gray ? { gray } : {}) },
    }),
  updateGray: (id: string, rule: GrayRule) =>
    request<void>(`/activities/${id}/gray`, { method: 'PATCH', body: rule }),
  promoteGray: (id: string) =>
    request<PublishResult>(`/activities/${id}/gray/promote`, { method: 'POST' }),
  stopGray: (id: string) => request<void>(`/activities/${id}/gray`, { method: 'DELETE' }),
  versions: (id: string) => request<VersionItem[]>(`/activities/${id}/versions`),
  versionDsl: (id: string, version: number) =>
    request<{ version: number; dsl: unknown; changelog?: string; createdAt: string }>(
      `/activities/${id}/versions/${version}`,
    ),
  rollback: (id: string, version: number) =>
    request<PublishResult>(`/activities/${id}/rollback`, { method: 'POST', body: { version } }),
  changeStatus: (id: string, status: 'published' | 'offline') =>
    request<void>(`/activities/${id}/status`, { method: 'POST', body: { status } }),

  members: (id: string) => request<ActivityMembers>(`/activities/${id}/members`),
  upsertMember: (id: string, userId: string, role: ActivityMemberRole) =>
    request<void>(`/activities/${id}/members`, { method: 'PUT', body: { userId, role } }),
  removeMember: (id: string, userId: string) =>
    request<void>(`/activities/${id}/members/${userId}`, { method: 'DELETE' }),
  transferOwner: (id: string, userId: string) =>
    request<void>(`/activities/${id}/owner`, { method: 'POST', body: { userId } }),
};

export interface UserItem {
  id: string;
  username: string;
  nickname: string;
  email?: string;
  enabled: boolean;
  sso: boolean;
  roles: { code: string; name: string }[];
  createdAt: string;
}

export interface RoleItem {
  id: string;
  code: string;
  name: string;
  remark?: string;
  permissions: string[];
  userCount: number;
  builtin: boolean;
}

export interface PermissionItem {
  id: string;
  code: string;
  name: string;
  module?: string;
}

export const userApi = {
  list: (query: { page?: number; pageSize?: number; keyword?: string } = {}) =>
    request<PageResult<UserItem>>('/users', { query: query as Record<string, string> }),
  lookup: (keyword: string) => request<UserBrief[]>('/users/lookup', { query: { keyword } }),
  create: (body: { username: string; nickname: string; password: string; email?: string; roleCodes: string[] }) =>
    request<{ id: string }>('/users', { method: 'POST', body }),
  update: (id: string, body: { nickname?: string; email?: string; enabled?: boolean; roleCodes?: string[] }) =>
    request<void>(`/users/${id}`, { method: 'PATCH', body }),
  resetPassword: (id: string, password: string) =>
    request<void>(`/users/${id}/password`, { method: 'POST', body: { password } }),
};

export const roleApi = {
  list: () => request<RoleItem[]>('/roles'),
  permissions: () => request<PermissionItem[]>('/permissions'),
  create: (body: { code: string; name: string; remark?: string; permissions: string[] }) =>
    request<{ id: string }>('/roles', { method: 'POST', body }),
  update: (id: string, body: { name?: string; remark?: string; permissions?: string[] }) =>
    request<void>(`/roles/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => request<void>(`/roles/${id}`, { method: 'DELETE' }),
};

export interface MaterialRegistryItem {
  name: string;
  title: string;
  version: string;
  category: string;
  enabled: boolean;
  deprecated?: { reason?: string; replacedBy?: string };
  updatedAt: string;
  usage: { activities: number; nodes: number; outdated: number };
}

export const materialApi = {
  list: () => request<MaterialMeta[]>('/materials'),
  registry: () => request<MaterialRegistryItem[]>('/materials/registry'),
  toggle: (name: string, enabled: boolean) =>
    request<void>(`/materials/${name}`, { method: 'PATCH', body: { enabled } }),
};

export interface AssetItem {
  id: string;
  url: string;
  type: string;
  size: number;
  createdAt: string;
}

type UploadTicket =
  | { mode: 'reused'; id: string; url: string }
  | { mode: 'proxy'; maxBytes: number }
  | {
      mode: 'cos';
      uploadId: string;
      url: string;
      uploadUrl: string;
      method: 'PUT';
      headers: Record<string, string>;
    };

export interface UploadResult {
  url: string;
  reused: boolean;
}

/** 文件内容的 SHA-256，服务端据此去重并给对象命名 */
async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 服务端中转：走 FormData，不能用 request()——它固定发 JSON */
async function proxyUpload(file: File, activityId?: string): Promise<UploadResult> {
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
  const payload = (await response.json()) as { code: number; message: string; data: UploadResult };
  if (!response.ok) throw new Error(payload.message ?? '上传失败');
  return payload.data;
}

export const assetApi = {
  list: (query: { page?: number; pageSize?: number; type?: string } = {}) =>
    request<PageResult<AssetItem>>('/assets', { query: query as Record<string, string> }),

  /**
   * 上传素材。先问服务端要凭证：同内容传过就直接复用；配了 COS 就用 STS 临时凭证
   * 从浏览器直传到桶，文件不经过应用服务器；否则回落服务端中转。三条路返回同一形状。
   */
  upload: async (file: File, activityId?: string): Promise<UploadResult> => {
    const ticket = await request<UploadTicket>('/assets/upload-ticket', {
      method: 'POST',
      body: {
        filename: file.name,
        mimetype: file.type,
        size: file.size,
        sha256: await sha256Hex(file),
        activityId,
      },
    });

    if (ticket.mode === 'reused') return { url: ticket.url, reused: true };
    if (ticket.mode === 'proxy') return proxyUpload(file, activityId);

    let put: Response;
    try {
      put = await fetch(ticket.uploadUrl, { method: ticket.method, headers: ticket.headers, body: file });
    } catch {
      // 桶没配跨域规则时浏览器直接掐掉请求，拿到的是网络错误而不是 4xx
      throw new Error('直传被浏览器拦截，请检查存储桶的跨域（CORS）配置是否放行了后台域名');
    }
    if (!put.ok) throw new Error(`直传失败（HTTP ${put.status}）`);
    const done = await request<{ url: string; reused: boolean }>('/assets/upload-complete', {
      method: 'POST',
      body: { uploadId: ticket.uploadId },
    });
    return { url: done.url, reused: done.reused };
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

export interface PrizeItem {
  id: string;
  activityId: string;
  name: string;
  image?: string;
  /** 万分比，10000 表示 100% */
  probability: number;
  total: number;
  remaining: number;
  /** 单用户可中上限，0 不限 */
  limitPerUser: number;
  sort: number;
  createdAt: string;
}

export interface PrizeInput {
  name: string;
  image?: string;
  probability: number;
  total: number;
  limitPerUser: number;
  sort: number;
}

export const prizeApi = {
  list: (activityId: string) => request<PrizeItem[]>('/prizes', { query: { activityId } }),
  create: (body: PrizeInput & { activityId: string }) =>
    request<PrizeItem>('/prizes', { method: 'POST', body }),
  update: (id: string, body: Partial<PrizeInput>) =>
    request<PrizeItem>(`/prizes/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => request<void>(`/prizes/${id}`, { method: 'DELETE' }),
};

export interface AppointmentSceneItem {
  id: string;
  activityId: string;
  sceneId: string;
  name: string;
  startAt: string | null;
  endAt: string | null;
  /** 名额，null 不限 */
  capacity: number | null;
  /** 已约人数 */
  booked: number;
  sort: number;
}

export interface AppointmentSceneInput {
  name: string;
  startAt?: string | null;
  endAt?: string | null;
  capacity?: number | null;
  sort?: number;
}

export const appointmentApi = {
  list: (activityId: string) =>
    request<AppointmentSceneItem[]>('/appointment-scenes', { query: { activityId } }),
  create: (body: AppointmentSceneInput & { activityId: string; sceneId: string }) =>
    request<AppointmentSceneItem>('/appointment-scenes', { method: 'POST', body }),
  update: (id: string, body: AppointmentSceneInput) =>
    request<AppointmentSceneItem>(`/appointment-scenes/${id}`, { method: 'PATCH', body }),
  remove: (id: string) => request<void>(`/appointment-scenes/${id}`, { method: 'DELETE' }),
};

export interface ChannelItem {
  id: string;
  activityId: string;
  name: string;
  code: string;
  params?: Record<string, string | number | boolean>;
  /** 生成的渠道落地链接 */
  link: string;
  createdAt: string;
}

export interface ChannelInput {
  name: string;
  code: string;
  params?: Record<string, string | number | boolean>;
}

export const channelApi = {
  list: (activityId: string) => request<ChannelItem[]>('/channels', { query: { activityId } }),
  create: (body: ChannelInput & { activityId: string }) =>
    request<ChannelItem>('/channels', { method: 'POST', body }),
  remove: (id: string) => request<void>(`/channels/${id}`, { method: 'DELETE' }),
};

export interface AnalyticsReport {
  total: number;
  pageViews: number;
  clicks: number;
  converts: number;
  /** 逐节点：曝光每次访问只记一次，点击与转化按次数 */
  byNode: { nodeId: string; exposures: number; clicks: number; converts: number }[];
  trend: { date: string; pageViews: number }[];
}

export const analyticsApi = {
  report: (activityId: string, days = 7) =>
    request<AnalyticsReport>('/analytics/report', { query: { activityId, days: String(days) } }),
};

export interface AuditLogItem {
  id: string;
  userId: string;
  username?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: unknown;
  ip?: string;
  createdAt: string;
}

export const auditApi = {
  list: (query: { page?: number; pageSize?: number; action?: string; targetType?: string } = {}) =>
    request<{ rows: AuditLogItem[]; total: number }>('/audit-logs', {
      query: query as Record<string, string>,
    }),
};

export type MonitorMetric =
  | 'dsl_invalid_rate'
  | 'white_screen_rate'
  | 'load_error_rate'
  | 'js_error_count'
  | 'publish_invalid_count';

export type WebhookType = 'none' | 'wecom' | 'feishu' | 'dingtalk' | 'generic';

export interface MonitorOverview {
  hours: number;
  stats: {
    attempts: number;
    boots: number;
    loadErrors: number;
    dslInvalid: number;
    stalls: number;
    whiteScreens: number;
    jsErrors: number;
    publishInvalid: number;
  };
  rates: { dslInvalid: number; whiteScreen: number; loadError: number };
  render: { p50: number | null; p90: number | null; samples: number };
  trend: {
    hour: string;
    attempts: number;
    whiteScreens: number;
    dslInvalid: number;
    loadErrors: number;
    jsErrors: number;
  }[];
  topActivities: { activityId: string; title: string; problems: number }[];
  /** 仅按活动筛选时有：各发布版本的失败率，灰度期间并排对比新旧版 */
  byVersion: {
    version: number;
    attempts: number;
    jsErrors: number;
    rates: { dslInvalid: number; whiteScreen: number; loadError: number };
  }[];
  recent: {
    id: string;
    type: string;
    activityId: string | null;
    version: number | null;
    host: string | null;
    message: string | null;
    detail: unknown;
    createdAt: string;
  }[];
}

export interface AlertRule {
  id: string;
  name: string;
  metric: MonitorMetric;
  threshold: number;
  windowMinutes: number;
  minSamples: number;
  cooldownMinutes: number;
  enabled: boolean;
  webhookType: WebhookType;
  webhookUrl: string | null;
  lastTriggeredAt: string | null;
}

export type AlertRuleInput = Omit<AlertRule, 'id' | 'lastTriggeredAt' | 'webhookUrl'> & { webhookUrl?: string };

export interface AlertRecord {
  id: string;
  ruleId: string;
  rule: { name: string };
  metric: MonitorMetric;
  value: number;
  threshold: number;
  samples: number;
  activityId: string | null;
  message: string;
  notified: boolean;
  notifyError: string | null;
  createdAt: string;
}

export const monitorApi = {
  overview: (hours: number, activityId?: string) =>
    request<MonitorOverview>('/monitor/overview', { query: { hours, activityId } }),
  alerts: (page = 1) => request<{ rows: AlertRecord[]; total: number }>('/monitor/alerts', { query: { page } }),
  rules: () => request<AlertRule[]>('/monitor/alert-rules'),
  createRule: (body: AlertRuleInput) => request<AlertRule>('/monitor/alert-rules', { method: 'POST', body }),
  updateRule: (id: string, body: Partial<AlertRuleInput>) =>
    request<AlertRule>(`/monitor/alert-rules/${id}`, { method: 'PATCH', body }),
  removeRule: (id: string) => request<void>(`/monitor/alert-rules/${id}`, { method: 'DELETE' }),
  testRule: (id: string) => request<void>(`/monitor/alert-rules/${id}/test`, { method: 'POST' }),
};
