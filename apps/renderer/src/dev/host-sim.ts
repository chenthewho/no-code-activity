/**
 * 宿主模拟器（仅开发期，http://localhost:5180/host-sim.html?id=<活动id>）。
 *
 * 把同一个活动并排放进几个宿主里跑，本页扮演宿主一方，走的都是真协议：
 * - SDK / 游戏中心：postMessage 桥（?bridge=postmessage），本页回应 login/share/... 调用，
 *   login 返回 mock:<id> 形式的 code，由服务端 HOST_AUTH_MODE=mock 校验
 * - 小程序 web-view：页面里装的是假 wx.miniProgram（?mock_wx=1），navigateTo 到登录页时
 *   本页扮演小程序登录页——调服务端 /runtime/auth/wechat-mp 换票据，带 nca_ticket 重开 web-view
 */
import { BRIDGE_SOURCE } from '../runtime/host/post-message-bridge';
import { API_BASE } from '../runtime/api-base';

interface SimHost {
  key: string;
  label: string;
  desc: string;
  width: number;
  height: number;
  query: string;
}

const HOSTS: SimHost[] = [
  {
    key: 'browser',
    label: '浏览器 / H5',
    desc: '无桥接，登录走统一登录跳转',
    width: 375,
    height: 667,
    query: '',
  },
  {
    key: 'sdk_portrait',
    label: 'SDK 竖屏',
    desc: 'postMessage 桥，登录返回宿主 code',
    width: 375,
    height: 667,
    query: 'host=sdk_portrait&bridge=postmessage',
  },
  {
    key: 'sdk_landscape',
    label: 'SDK 横屏',
    desc: '横屏里的竖版稿收成居中一列',
    width: 667,
    height: 375,
    query: 'host=sdk_landscape&bridge=postmessage',
  },
  {
    key: 'game_center',
    label: '游戏中心',
    desc: 'postMessage 桥',
    width: 375,
    height: 667,
    query: 'host=game_center&bridge=postmessage',
  },
  {
    key: 'wechat_mini_program',
    label: '微信小程序 web-view',
    desc: '假 wx.miniProgram，登录跳小程序登录页换票据',
    width: 375,
    height: 667,
    query: 'mock_wx=1',
  },
];

const frames = new Map<Window, { host: SimHost; iframe: HTMLIFrameElement; log: HTMLElement }>();

function log(el: HTMLElement, text: string): void {
  const line = document.createElement('div');
  line.textContent = `${new Date().toLocaleTimeString('zh-CN')} ${text}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

function render(activityId: string): void {
  const root = document.getElementById('hosts')!;
  root.innerHTML = '';
  frames.clear();
  for (const host of HOSTS) {
    const card = document.createElement('section');
    card.className = 'host';
    card.innerHTML = `<h3>${host.label}</h3><div class="desc">${host.desc}</div>`;
    const iframe = document.createElement('iframe');
    iframe.width = String(host.width);
    iframe.height = String(host.height);
    iframe.dataset.host = host.key;
    iframe.src = `/?id=${encodeURIComponent(activityId)}${host.query ? `&${host.query}` : ''}`;
    const logEl = document.createElement('div');
    logEl.className = 'log';
    card.append(iframe, logEl);
    root.appendChild(card);
    iframe.addEventListener('load', () => {
      if (iframe.contentWindow) frames.set(iframe.contentWindow, { host, iframe, log: logEl });
    });
  }
}

/** 宿主对桥接调用的应答。真实宿主在这里调自家账号体系、分享面板、下载器 */
function answer(host: SimHost, method: string, params: unknown): unknown {
  switch (method) {
    case 'login':
      return { code: `mock:sim_${host.key}:${host.label}玩家` };
    case 'share':
    case 'navigate':
    case 'downloadGame':
    case 'logout':
      return null;
    case 'invoke':
      return { echo: params };
    default:
      throw new Error(`宿主不支持 ${method}`);
  }
}

async function miniProgramLogin(
  entry: { iframe: HTMLIFrameElement; log: HTMLElement },
  url: string,
): Promise<void> {
  // 扮演小程序里的登录页：wx.login 拿 code → 服务端换票据 → 带票据重开 web-view
  const redirect = new URL(url, 'https://mp.local').searchParams.get('redirect');
  const response = await fetch(`${API_BASE}/runtime/auth/wechat-mp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'mock:sim_wx_user:小程序用户' }),
  });
  const payload = (await response.json()) as { ticket?: string; message?: string };
  if (!payload.ticket || !redirect) {
    log(entry.log, `← 小程序换票失败：${payload.message ?? response.status}`);
    return;
  }
  const next = new URL(redirect);
  next.searchParams.set('nca_ticket', payload.ticket);
  log(entry.log, '← 小程序登录页换到票据，重新打开 web-view');
  entry.iframe.src = next.toString();
}

window.addEventListener('message', (event: MessageEvent<Record<string, unknown>>) => {
  const entry = event.source ? frames.get(event.source as Window) : undefined;
  const data = event.data;
  if (!entry || !data) return;

  if (data.source === BRIDGE_SOURCE && typeof data.method === 'string') {
    log(entry.log, `→ ${data.method} ${data.params ? JSON.stringify(data.params) : ''}`);
    let reply: Record<string, unknown>;
    try {
      const result = answer(entry.host, data.method, data.params);
      reply = { source: BRIDGE_SOURCE, id: data.id, result };
      log(entry.log, `← ${JSON.stringify(result)}`);
    } catch (err) {
      reply = { source: BRIDGE_SOURCE, id: data.id, error: (err as Error).message };
    }
    (event.source as Window).postMessage(reply, '*');
    return;
  }

  if (data.source === 'nca-host-sim') {
    log(entry.log, `→ ${String(data.kind)} ${JSON.stringify(data.url ?? data.data)}`);
    if (data.kind === 'wx.navigateTo' && String(data.url).startsWith('/pages/nca-login/')) {
      void miniProgramLogin(entry, String(data.url));
    }
  }
});

const input = document.getElementById('activity') as HTMLInputElement;
input.value = new URLSearchParams(window.location.search).get('id') ?? '';
document.getElementById('load')!.addEventListener('click', () => {
  const url = new URL(window.location.href);
  url.searchParams.set('id', input.value.trim());
  window.history.replaceState(null, '', url.toString());
  render(input.value.trim());
});
if (input.value) render(input.value);
