import { HOST_TYPE } from '@nca/shared';
import type { HostAdapter } from './types';

/**
 * 微信小程序 web-view 宿主。
 *
 * 不做小程序原生渲染器：活动页仍是这份 H5，跑在小程序的 <web-view> 里，
 * 与小程序之间只能通过 JSSDK 的 wx.miniProgram 通信——
 *   - 登录：跳到小程序里的登录页，由它 wx.login 换票据后带 nca_ticket 重新打开 web-view
 *   - 分享：web-view 页面不能直接调分享，只能 postMessage 把分享内容交给小程序页面，
 *     小程序在 onShareAppMessage 里取最后一条消息
 *   - 跳转：mp: 开头的地址走小程序路由，其余在 web-view 内打开（需配业务域名）
 * 小程序侧的接入代码见 docs/host-bridge.md。
 */

interface WxMiniProgram {
  navigateTo(options: { url: string; fail?: (err: unknown) => void }): void;
  postMessage(options: { data: Record<string, unknown> }): void;
}

declare global {
  interface Window {
    /** 小程序 web-view 内由微信设置，值为 'miniprogram' */
    __wxjs_environment?: string;
    wx?: { miniProgram?: WxMiniProgram };
  }
}

const JSSDK_URL = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';
/** 小程序里承接登录的页面，可用 ?mp_login= 覆盖 */
const DEFAULT_LOGIN_PATH = '/pages/nca-login/index';

export function isMiniProgramEnv(): boolean {
  return typeof window !== 'undefined' && window.__wxjs_environment === 'miniprogram';
}

let sdkPromise: Promise<WxMiniProgram | null> | null = null;

/** 按需加载 JSSDK：只有真用到小程序能力时才多一个请求，不拖慢首屏 */
export function loadMiniProgramSdk(): Promise<WxMiniProgram | null> {
  if (window.wx?.miniProgram) return Promise.resolve(window.wx.miniProgram);
  sdkPromise ??= new Promise<WxMiniProgram | null>((resolve) => {
    const script = document.createElement('script');
    script.src = JSSDK_URL;
    script.async = true;
    const timer = window.setTimeout(() => resolve(null), 5000);
    script.onload = () => {
      window.clearTimeout(timer);
      resolve(window.wx?.miniProgram ?? null);
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      sdkPromise = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

function loginPath(): string {
  const custom = new URLSearchParams(window.location.search).get('mp_login');
  return custom && custom.startsWith('/') ? custom : DEFAULT_LOGIN_PATH;
}

export function createWechatMiniProgramHost(): HostAdapter {
  const post = async (data: Record<string, unknown>): Promise<boolean> => {
    const mp = await loadMiniProgramSdk();
    if (!mp) return false;
    mp.postMessage({ data });
    return true;
  };

  return {
    type: HOST_TYPE.WECHAT_MINI_PROGRAM,

    async login() {
      const mp = await loadMiniProgramSdk();
      if (!mp) return null;
      // 登录页换好票据后，用带 nca_ticket 的地址重新打开 web-view，运行时启动时换成 token
      mp.navigateTo({ url: `${loginPath()}?redirect=${encodeURIComponent(window.location.href)}` });
      return { redirecting: true };
    },

    async logout() {
      await post({ type: 'nca:logout' });
    },

    async share(payload) {
      // type 放最后：payload 是整条动作，自带 type: 'share'，放前面会把消息类型盖掉
      const { title, desc, cover, channel } = payload;
      const sent = await post({
        title,
        desc,
        cover,
        channel,
        link: window.location.href,
        type: 'nca:share',
      });
      return { hint: sent ? '点击右上角「···」即可分享给好友' : '当前环境无法分享' };
    },

    navigate(url, target) {
      if (url.startsWith('mp:')) {
        void loadMiniProgramSdk().then((mp) => mp?.navigateTo({ url: url.slice(3) }));
        return;
      }
      if (target === '_blank') window.open(url, '_blank', 'noopener,noreferrer');
      else window.location.href = url;
    },

    async downloadGame() {
      return { hint: '小程序内暂不支持下载，请在应用商店搜索下载' };
    },

    // web-view 到小程序只有单向 postMessage，没有返回值
    async invoke(method, params) {
      if (!(await post({ type: 'nca:invoke', method, params: params ?? {} }))) {
        throw new Error(`小程序宿主不支持 SDK 能力：${method}`);
      }
      return undefined;
    },
  };
}
