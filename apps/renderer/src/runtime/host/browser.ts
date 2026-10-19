import { HOST_TYPE, type HostType } from '@nca/shared';
import { fetchAuthConfig, ssoLoginUrl } from '../auth';
import type { HostAdapter } from './types';
import { createBridgeHost } from './bridge';

/** 浏览器宿主：能力最少的基线实现，其它宿主在此之上补 SDK 桥接 */
export const browserHost: HostAdapter = {
  type: HOST_TYPE.BROWSER,

  /**
   * 浏览器走统一登录：整页跳去 IdP，登录完带一次性票据跳回当前地址，
   * 由运行时在启动时换成 token。服务端没开 SSO 时返回 null，交给运行时提示。
   */
  async login() {
    try {
      const config = await fetchAuthConfig();
      if (!config.sso) return null;
    } catch (err) {
      console.warn('[nca] 获取登录配置失败', err);
      return null;
    }
    window.location.assign(ssoLoginUrl(window.location.href));
    return { redirecting: true };
  },

  async share(payload) {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({ title: payload.title, text: payload.desc });
        return;
      } catch {
        // 用户取消分享属于正常路径，不该冒泡成错误
        return;
      }
    }
    console.info('[nca] 当前环境不支持系统分享');
  },

  navigate(url, target) {
    if (target === '_blank') {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      window.location.href = url;
    }
  },

  async downloadGame(gameId) {
    console.info(`[nca] browser 宿主无下载能力，gameId=${gameId}`);
  },

  async invoke(method) {
    throw new Error(`browser 宿主不支持 SDK 能力：${method}`);
  },
};

/** 需要走宿主桥接的宿主类型；其余回落 browser */
const BRIDGE_HOSTS: HostType[] = [
  HOST_TYPE.GAME_CENTER,
  HOST_TYPE.LDQ_PC,
  HOST_TYPE.LDQ_APP,
  HOST_TYPE.SDK_LANDSCAPE,
  HOST_TYPE.SDK_PORTRAIT,
  HOST_TYPE.WECHAT_MINI_PROGRAM,
];

export function detectHost(): HostAdapter {
  // 宿主容器注入的全局标识优先级最高；其次 ?host= 便于开发预览指定宿主。
  // UA 嗅探不可靠（微信 H5 与小程序 web-view 的 UA 一样），不做。
  const injected =
    typeof window !== 'undefined' ? (window as unknown as { __NCA_HOST__?: HostType }).__NCA_HOST__ : undefined;
  const urlHost =
    typeof window !== 'undefined'
      ? (new URLSearchParams(window.location.search).get('host') as HostType | null)
      : null;
  const type = injected ?? urlHost ?? undefined;

  if (type && BRIDGE_HOSTS.includes(type)) {
    return createBridgeHost(type);
  }
  return browserHost;
}
