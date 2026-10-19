import type { HostType } from '@nca/shared';
import type { HostAdapter, HostLoginResult } from './types';

/**
 * 宿主容器注入的桥接对象。SDK / game_center / 小程序 web-view 会把能力挂到
 * window.__NCA_BRIDGE__ 上；桥接缺失时（开发预览、纯浏览器）回落浏览器行为并提示。
 */
export interface HostBridge {
  /** 拉起宿主登录，返回一次性 code（推荐）或票据；见 docs/host-bridge.md */
  login?(): Promise<HostLoginResult | null>;
  logout?(): Promise<void>;
  share?(payload: { title?: string; desc?: string; cover?: string; channel?: string }): Promise<void>;
  navigate?(url: string, target?: string): void;
  downloadGame?(gameId: string): Promise<void>;
  invoke?(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

declare global {
  interface Window {
    /** 宿主容器声明的宿主类型，detectHost 据此分流 */
    __NCA_HOST__?: HostType;
    /** 宿主容器注入的能力桥接 */
    __NCA_BRIDGE__?: HostBridge;
  }
}

function bridge(): HostBridge | undefined {
  return typeof window !== 'undefined' ? window.__NCA_BRIDGE__ : undefined;
}

/**
 * 生成一个委托到宿主桥接的适配器。SDK 竖屏 / 横屏 / game_center / 小程序 web-view
 * 走同一套桥接协议，只是 type 不同——Renderer 主体不出现任何 if (isWechat) 判断。
 */
export function createBridgeHost(type: HostType): HostAdapter {
  return {
    type,

    async login() {
      const b = bridge();
      if (b?.login) {
        try {
          return await b.login();
        } catch (err) {
          console.warn(`[nca] ${type} 宿主 login 失败`, err);
        }
      }
      console.info(`[nca] ${type} 宿主暂未注入 login 桥接`);
      return null;
    },

    async logout() {
      try {
        await bridge()?.logout?.();
      } catch (err) {
        console.warn(`[nca] ${type} 宿主 logout 失败`, err);
      }
    },

    async share(payload) {
      const b = bridge();
      if (b?.share) {
        try {
          await b.share(payload);
          return;
        } catch (err) {
          console.warn(`[nca] ${type} 宿主 share 失败`, err);
        }
      }
      // 回落系统分享
      if (typeof navigator !== 'undefined' && 'share' in navigator) {
        try {
          await navigator.share({ title: payload.title, text: payload.desc });
          return;
        } catch {
          // 用户取消分享是正常路径
          return;
        }
      }
      console.info(`[nca] ${type} 宿主无分享能力`);
    },

    navigate(url, target) {
      const b = bridge();
      if (b?.navigate) {
        b.navigate(url, target);
        return;
      }
      if (target === '_blank') window.open(url, '_blank', 'noopener,noreferrer');
      else window.location.href = url;
    },

    async downloadGame(gameId) {
      const b = bridge();
      if (b?.downloadGame) {
        try {
          await b.downloadGame(gameId);
          return;
        } catch (err) {
          console.warn(`[nca] ${type} 宿主 downloadGame 失败`, err);
        }
      }
      console.info(`[nca] ${type} 宿主无下载能力，gameId=${gameId}`);
    },

    async invoke(method, params) {
      const b = bridge();
      if (b?.invoke) return b.invoke(method, params);
      throw new Error(`${type} 宿主不支持 SDK 能力：${method}`);
    },
  };
}
