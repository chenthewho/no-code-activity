import { API_BASE } from './api';

export type AnalyticsEventName = 'expose' | 'click' | 'convert';

interface PendingEvent {
  event: AnalyticsEventName;
  nodeId?: string;
  channel?: string;
  props?: Record<string, unknown>;
}

let activityId = '';
const pending: PendingEvent[] = [];
let timer: number | null = null;
let flushing = false;

/** 埋点一旦初始化就绑定当前活动；重复初始化以最后一次为准 */
export function initAnalytics(id: string): void {
  activityId = id;
  if (typeof window !== 'undefined' && 'sendBeacon' in navigator) {
    window.addEventListener('pagehide', flushNow);
  }
}

/**
 * 记录一条事件。合批上报：攒够 20 条立刻发，否则 3 秒空闲后发一次，
 * 页面离开时用 sendBeacon 兜底最后一批。失败静默，不拖累页面。
 */
export function trackAnalytics(
  event: AnalyticsEventName,
  nodeId?: string,
  props?: Record<string, unknown>,
): void {
  if (!activityId) return;
  pending.push({ event, nodeId, props });
  if (pending.length >= 20) {
    void flush();
    return;
  }
  if (timer === null) {
    timer = window.setTimeout(() => {
      timer = null;
      void flush();
    }, 3000);
  }
}

async function flush(): Promise<void> {
  if (!activityId || pending.length === 0 || flushing) return;
  flushing = true;
  const batch = pending.splice(0, pending.length);
  const channel = queryChannel();
  try {
    await fetch(`${API_BASE}/analytics/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        activityId,
        events: batch.map((e) => ({ ...e, channel: e.channel ?? channel })),
      }),
      keepalive: true,
    });
  } catch {
    // 埋点失败不影响页面
  } finally {
    flushing = false;
  }
}

function flushNow(): void {
  if (!activityId || pending.length === 0) return;
  const batch = pending.splice(0, pending.length);
  const body = JSON.stringify({ activityId, events: batch });
  // sendBeacon 在页面卸载时最可靠；Content-Type 用 Blob 指定为 JSON
  void navigator.sendBeacon(
    `${API_BASE}/analytics/events`,
    new Blob([body], { type: 'application/json' }),
  );
}

/** 从落地 URL 取渠道码（M3③ 的 ?ch=），埋点带上做渠道归因 */
function queryChannel(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return new URLSearchParams(window.location.search).get('ch') ?? undefined;
}
