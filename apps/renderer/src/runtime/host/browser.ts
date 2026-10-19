import { HOST_TYPE, type HostType } from '@nca/shared';
import { createLoginNonce, fetchAuthConfig, ssoLoginUrl } from '../auth';
import type { HostAdapter } from './types';
import { createBridgeHost } from './bridge';
import { createWechatMiniProgramHost, isMiniProgramEnv } from './wechat-mp';

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
    window.location.assign(ssoLoginUrl(window.location.href, createLoginNonce()));
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

/** 走能力桥接（注入对象或 postMessage）的宿主类型；小程序走 JSSDK，单独适配 */
const BRIDGE_HOSTS: HostType[] = [
  HOST_TYPE.GAME_CENTER,
  HOST_TYPE.LDQ_PC,
  HOST_TYPE.LDQ_APP,
  HOST_TYPE.SDK_LANDSCAPE,
  HOST_TYPE.SDK_PORTRAIT,
];

/**
 * 判定当前宿主，优先级：宿主容器注入的 __NCA_HOST__ > 地址上的 ?host=（预览与 iframe 宿主）>
 * 微信设置的 __wxjs_environment（小程序 web-view）> 浏览器。
 * 不做 UA 嗅探：微信 H5 与小程序 web-view 的 UA 一模一样，靠它分不出来。
 */
export function resolveHostType(): HostType {
  if (typeof window === 'undefined') return HOST_TYPE.BROWSER;
  const injected = window.__NCA_HOST__;
  const urlHost = new URLSearchParams(window.location.search).get('host') as HostType | null;
  const known = Object.values(HOST_TYPE) as string[];
  if (injected && known.includes(injected)) return injected;
  if (urlHost && known.includes(urlHost)) return urlHost;
  if (isMiniProgramEnv()) return HOST_TYPE.WECHAT_MINI_PROGRAM;
  return HOST_TYPE.BROWSER;
}

export function detectHost(): HostAdapter {
  const type = resolveHostType();
  if (type === HOST_TYPE.WECHAT_MINI_PROGRAM) return createWechatMiniProgramHost();
  if (BRIDGE_HOSTS.includes(type)) return createBridgeHost(type);
  return browserHost;
}
