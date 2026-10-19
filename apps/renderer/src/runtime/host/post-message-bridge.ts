import type { HostBridge } from './bridge';

/**
 * postMessage 桥接：给「把活动页嵌在 iframe 里」的宿主用（PC 游戏中心、LDQ PC 端、
 * 宿主模拟器）。它们没法像原生容器那样往页面里注入 window.__NCA_BRIDGE__，
 * 只能隔着 iframe 收发消息。
 *
 * 协议（双方都带 source 字段，混在别的 postMessage 流量里也认得出来）：
 *   页面 → 宿主  { source: 'nca-bridge', id, method, params }
 *   宿主 → 页面  { source: 'nca-bridge', id, result } 或 { source: 'nca-bridge', id, error }
 *
 * 只认来自 window.parent 的回复：页面里别的 iframe 发来同 id 的消息不会被当成宿主应答。
 * 需显式开启（地址带 ?bridge=postmessage），否则任何被嵌进 iframe 的活动页都会对着
 * 一个不会回话的父页面苦等登录超时。
 */

export const BRIDGE_SOURCE = 'nca-bridge';

/** 登录要等用户在宿主里操作完，给足时间；其余能力都是即时的 */
const TIMEOUTS: Record<string, number> = { login: 120_000 };
const DEFAULT_TIMEOUT = 10_000;

interface BridgeReply {
  source: typeof BRIDGE_SOURCE;
  id: number;
  result?: unknown;
  error?: string;
}

export function postMessageBridgeEnabled(): boolean {
  if (typeof window === 'undefined' || window.parent === window) return false;
  return new URLSearchParams(window.location.search).get('bridge') === 'postmessage';
}

export function createPostMessageBridge(
  target: Window = window.parent,
  options: { targetOrigin?: string } = {},
): HostBridge {
  let seq = 0;
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }
  >();

  window.addEventListener('message', (event: MessageEvent<BridgeReply>) => {
    if (event.source !== target) return;
    const data = event.data;
    if (!data || data.source !== BRIDGE_SOURCE || typeof data.id !== 'number') return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    window.clearTimeout(entry.timer);
    if (data.error) entry.reject(new Error(data.error));
    else entry.resolve(data.result);
  });

  const call = <T>(method: string, params?: unknown): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++seq;
      const timer = window.setTimeout(() => {
        pending.delete(id);
        reject(new Error(`宿主未响应 ${method}`));
      }, TIMEOUTS[method] ?? DEFAULT_TIMEOUT);
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      // 消息里只有方法名与参数，不含登录态；回复只认 window.parent，所以发 * 不会泄露什么
      target.postMessage(
        { source: BRIDGE_SOURCE, id, method, params },
        options.targetOrigin ?? '*',
      );
    });

  return {
    login: () => call('login'),
    logout: () => call('logout'),
    share: (payload) => call('share', payload),
    navigate: (url, targetWindow) =>
      void call('navigate', { url, target: targetWindow }).catch(() => undefined),
    downloadGame: (gameId) => call('downloadGame', { gameId }),
    invoke: (method, params) => call('invoke', { method, params }),
  };
}
