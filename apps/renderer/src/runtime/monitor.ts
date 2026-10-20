import { API_BASE } from './api-base';

/**
 * 渲染器健康上报（MonitorRuntime）。和埋点分开：埋点给运营看效果，这里给研发看
 * 「页面有没有挂」——每次访问恰好上报一条结局（boot / load_error / dsl_invalid / stall），
 * 外加白屏、JS 错误等质量信号。服务端据此算失败率、白屏率并告警。
 *
 * 设计器预览不上报：画布里的半成品出错是常态，混进来只会让告警失真。
 */

export type MonitorEventType =
  'boot' | 'load_error' | 'dsl_invalid' | 'stall' | 'white_screen' | 'js_error' | 'host_mismatch';

interface PendingEvent {
  type: MonitorEventType;
  message?: string;
  detail?: Record<string, unknown>;
  durationMs?: number;
}

const OUTCOMES = new Set<MonitorEventType>(['boot', 'load_error', 'dsl_invalid', 'stall']);
/** 一次访问最多报这么多条 JS 错误：一个循环里的报错能刷爆上报接口 */
const MAX_JS_ERRORS = 20;

let enabled = false;
let activityId: string | undefined;
let host: string | undefined;
let version: number | undefined;
let outcomeReported = false;
let jsErrors = 0;
const pending: PendingEvent[] = [];
let timer: number | null = null;
/**
 * 首屏渲染前页面是否进过后台。后台标签页里 rAF 不触发，「首屏耗时」会一直算到用户
 * 切回来为止——这种访问照样计入访问次数，但耗时不进分位数，否则 P90 被拉到几分钟。
 */
let hiddenBeforeBoot = typeof document !== 'undefined' && document.visibilityState === 'hidden';

export function wasHiddenBeforeBoot(): boolean {
  return hiddenBeforeBoot;
}

export function initMonitor(options: { activityId?: string; host: string }): void {
  enabled = true;
  activityId = options.activityId;
  host = options.host;
  window.addEventListener('pagehide', flushWithBeacon);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && !outcomeReported) hiddenBeforeBoot = true;
  });
  window.addEventListener('error', (event) => {
    reportMonitor('js_error', {
      message: event.message || String(event.error),
      detail: { source: event.filename, line: event.lineno, stack: stackOf(event.error) },
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown;
    reportMonitor('js_error', {
      message: reason instanceof Error ? reason.message : String(reason),
      detail: { kind: 'unhandledrejection', stack: stackOf(reason) },
    });
  });
}

/** 初始化之后才知道活动 id 的场景（如 /act/:id 解析在后）用它补上 */
export function setMonitorActivity(id: string): void {
  activityId = id;
}

/** DSL 拉回来才知道看到的是哪个发布版本 */
export function setMonitorVersion(value: number | undefined): void {
  version = value;
}

export function reportMonitor(
  type: MonitorEventType,
  data: { message?: string; detail?: Record<string, unknown>; durationMs?: number } = {},
): void {
  if (!enabled) return;
  if (OUTCOMES.has(type)) {
    // 一次访问只有一个结局：渲染成功之后又超时之类的二次上报直接丢弃
    if (outcomeReported) return;
    outcomeReported = true;
  }
  if (type === 'js_error' && ++jsErrors > MAX_JS_ERRORS) return;
  pending.push({ type, ...data, message: data.message?.slice(0, 500) });
  if (timer === null) timer = window.setTimeout(flush, 1000);
}

function body(): string {
  return JSON.stringify({ activityId, host, version, events: pending.splice(0, 50) });
}

function flush(): void {
  timer = null;
  if (pending.length === 0) return;
  void fetch(`${API_BASE}/monitor/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body(),
    keepalive: true,
  }).catch(() => undefined);
  if (pending.length > 0) timer = window.setTimeout(flush, 1000);
}

function flushWithBeacon(): void {
  if (pending.length === 0) return;
  if ('sendBeacon' in navigator) {
    navigator.sendBeacon(
      `${API_BASE}/monitor/events`,
      new Blob([body()], { type: 'application/json' }),
    );
  } else {
    flush();
  }
}

function stackOf(error: unknown): string | undefined {
  return error instanceof Error ? error.stack?.slice(0, 1000) : undefined;
}

/** 这些元素被采样点命中，说明那个位置什么内容都没有 */
const EMPTY_SELECTORS = ['html', 'body', '#root', '.nca-surface', '.nca-page', '.nca-boot'];

/**
 * 白屏检测：在视口里撒 9 个采样点，全都只打到页面骨架（body、根容器）就算白屏。
 * 渲染完成后过一会儿再查，给图片与数据源留一点时间。
 */
export function isBlankScreen(doc: Document = document): boolean {
  const w = doc.documentElement.clientWidth || window.innerWidth;
  const h = doc.documentElement.clientHeight || window.innerHeight;
  for (let i = 1; i <= 3; i++) {
    for (let j = 1; j <= 3; j++) {
      const el = doc.elementFromPoint((w * i) / 4, (h * j) / 4);
      if (el && !EMPTY_SELECTORS.some((selector) => el.matches(selector))) return false;
    }
  }
  return true;
}

export function watchWhiteScreen(delayMs = 1500): void {
  if (!enabled) return;
  window.setTimeout(() => {
    if (isBlankScreen()) {
      reportMonitor('white_screen', { message: '渲染完成后首屏没有可见内容' });
    }
  }, delayMs);
}
