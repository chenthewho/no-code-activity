/**
 * C 端访问 API 服务端的入口配置与业务接口封装。
 *
 * API_BASE 是唯一一个「renderer 知道服务端地址」的地方：数据源相对 URL、
 * 抽奖动作都从这里解析。生产走 CDN 时通过 VITE_API_BASE 注入，缺省指回本地。
 */
export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3100/api/v1';

const GUEST_KEY = 'nca:guest-id';

/**
 * C 端当前没有 SSO 前的稳定用户标识：首次访问生成一个访客 id 存 localStorage，
 * 供 limitPerUser 与防刷在服务端按人计数。将来 host.login() 返回真实 userId 后
 * 用它替换，访客 id 只作兜底。
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

export interface DrawResult {
  won: boolean;
  index: number;
  prize: { id: string; name: string; image?: string } | null;
  message: string;
}

/** 调 C 端抽奖接口。返回裸 JSON（runtime 接口 markRaw 不包 code/data） */
export async function drawLottery(activityId: string, userId: string): Promise<DrawResult> {
  const response = await fetch(`${API_BASE}/runtime/lottery/draw`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activityId, userId }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `抽奖请求失败 (${response.status})`);
  }
  return (await response.json()) as DrawResult;
}

/** 表单提交：把 Form 物料收集的字段值上报到 POST /runtime/forms */
export async function submitForm(input: {
  activityId: string;
  formNodeId: string;
  userId?: string;
  data: Record<string, unknown>;
}): Promise<void> {
  const response = await fetch(`${API_BASE}/runtime/forms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(text || `提交失败 (${response.status})`);
  }
}
