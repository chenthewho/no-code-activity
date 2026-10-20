import { API_BASE } from './api-base';
import { LoginRequiredError, authHeaders } from './auth';

/**
 * C 端业务接口封装。登录用户的身份由请求头里的 C 端 token 决定；
 * body 里的 userId 只是访客标识，活动不要求登录时服务端才会采用。
 */
export { API_BASE };

const GUEST_KEY = 'nca:guest-id';

/**
 * 访客标识：首次访问生成一个随机 id 存 localStorage，供不要求登录的活动按人计数。
 * 它是客户端自报的，能被随意更换——需要防刷的活动应在页面设置里开启登录。
 */
export function getOrCreateGuestId(): string {
  try {
    const existing = window.localStorage.getItem(GUEST_KEY);
    if (existing) return existing;
    const id = `guest_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(GUEST_KEY, id);
    return id;
  } catch {
    // 隐私模式等写不了 localStorage 时，退化成会话级随机 id
    return `guest_${Math.random().toString(36).slice(2, 12)}`;
  }
}

/**
 * 活动 DSL 的请求地址。带上设备上的访客 id 与渠道码，服务端灰度期间据此决定这位访客看哪个版本；
 * 登录态走请求头（白名单按登录用户匹配）。
 *
 * index.html 的内联预取脚本（vite.config.ts 的 dslPrefetch）拼的是同一个地址、带同一个请求头——
 * 两边对不上，预取就白发了。改这里务必同步改那边。
 */
export function dslRequest(activityId: string): { url: string; headers: Record<string, string> } {
  const url = new URL(`${API_BASE}/runtime/activities/${activityId}/dsl`);
  url.searchParams.set('gid', getOrCreateGuestId());
  const channel = new URLSearchParams(window.location.search).get('ch');
  if (channel) url.searchParams.set('ch', channel);
  return { url: url.toString(), headers: authHeaders() };
}

/**
 * 业务写接口统一走这里：带上登录态，错误体里的 message 抽出来给 toast 用，
 * 服务端判定「该活动需要登录」时抛 LoginRequiredError，由运行时拉起登录后重试。
 */
async function postRuntime<T>(path: string, body: unknown, fallbackError: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      message?: string;
      reason?: string;
    } | null;
    if (response.status === 401 && payload?.reason === 'LOGIN_REQUIRED') {
      throw new LoginRequiredError(payload.message);
    }
    throw new Error(payload?.message || `${fallbackError} (${response.status})`);
  }
  return (await response.json()) as T;
}

export interface DrawResult {
  won: boolean;
  index: number;
  prize: { id: string; name: string; image?: string } | null;
  message: string;
}

/** 调 C 端抽奖接口。返回裸 JSON（runtime 接口 markRaw 不包 code/data） */
export function drawLottery(activityId: string, guestId: string): Promise<DrawResult> {
  return postRuntime<DrawResult>(
    '/runtime/lottery/draw',
    { activityId, userId: guestId },
    '抽奖请求失败',
  );
}

/** 表单提交：把 Form 物料收集的字段值上报到 POST /runtime/forms */
export async function submitForm(input: {
  activityId: string;
  formNodeId: string;
  userId?: string;
  data: Record<string, unknown>;
}): Promise<void> {
  await postRuntime<unknown>('/runtime/forms', input, '提交失败');
}

export interface AppointmentResult {
  booked: boolean;
  /** 该用户此前已约过同一场次 */
  already: boolean;
}

/** 活动预约：一人一场次一次，重复预约返回 already */
export function bookAppointment(input: {
  activityId: string;
  sceneId: string;
  userId?: string;
  contact?: string;
}): Promise<AppointmentResult> {
  return postRuntime<AppointmentResult>('/runtime/appointment', input, '预约失败');
}
