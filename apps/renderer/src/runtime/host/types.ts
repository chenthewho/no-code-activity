import type { HostType } from '@nca/shared';

/**
 * 宿主登录的结果。宿主拿到的身份凭据交回运行时，由运行时去服务端换 C 端 token。
 */
export interface HostLoginResult {
  /** 宿主账号服务签发的一次性 code，服务端校验后换 token（推荐） */
  code?: string;
  /** 已经换好的平台票据（如小程序外层用 wx.login 换来的），直接换 token */
  ticket?: string;
  /**
   * 旧协议：宿主直接报用户 id。页面脚本能任意伪造，只当访客标识用，
   * 不会被当成登录用户。
   */
  userId?: string;
  /** 宿主已整页跳转去登录（浏览器 SSO、小程序登录页），本页即将离开 */
  redirecting?: boolean;
}

/** 宿主动作的附加结果：需要提示用户时带一句话，由运行时用 toast 展示 */
export interface HostActionResult {
  hint?: string;
}

/**
 * 宿主适配层。同一份 DSL 要跑在浏览器、游戏中心、SDK 横竖屏、小程序 web-view 里，
 * 差异全部收敛到这个接口，Renderer 主体不出现任何 if (isWechat) 之类的判断。
 */
export interface HostAdapter {
  readonly type: HostType;
  /** 拉起登录。返回 null 表示该宿主拿不到身份（没开 SSO、桥接缺失） */
  login(): Promise<HostLoginResult | null>;
  /** 宿主侧的登出；本地登录态由运行时自己清，这里只通知宿主 */
  logout?(): Promise<void>;
  share(payload: {
    title?: string;
    desc?: string;
    cover?: string;
    channel?: string;
  }): Promise<HostActionResult | void>;
  navigate(url: string, target: '_self' | '_blank'): void;
  downloadGame(gameId: string): Promise<HostActionResult | void>;
  /** 宿主私有能力，method 由各适配器白名单裁决，未授权直接拒绝 */
  invoke(method: string, params?: Record<string, unknown>): Promise<unknown>;
}
