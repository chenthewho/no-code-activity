import { HOST_TYPE } from '@nca/shared';
import type { HostAdapter } from './types';

/** 浏览器宿主：能力最少的基线实现，其它宿主在此之上补 SDK 桥接 */
export const browserHost: HostAdapter = {
  type: HOST_TYPE.BROWSER,

  async login() {
    // 浏览器环境走 SSO 跳转，回跳后由 AuthRuntime 从 URL/Cookie 取回登录态
    console.info('[nca] browser 宿主暂未接入 SSO 跳转');
    return null;
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

export function detectHost(): HostAdapter {
  // M4 接入其它宿主时在这里按 UA / 注入的全局标识分流
  return browserHost;
}
