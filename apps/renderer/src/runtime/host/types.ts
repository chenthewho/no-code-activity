import type { HostType } from '@nca/shared';

/**
 * 宿主适配层。同一份 DSL 要跑在浏览器、游戏中心、SDK 横竖屏、小程序 web-view 里，
 * 差异全部收敛到这个接口，Renderer 主体不出现任何 if (isWechat) 之类的判断。
 */
export interface HostAdapter {
  readonly type: HostType;
  /** 拉起登录，返回用户标识；未登录场景由动作按需触发 */
  login(): Promise<{ userId: string } | null>;
  share(payload: { title?: string; desc?: string; cover?: string; channel?: string }): Promise<void>;
  navigate(url: string, target: '_self' | '_blank'): void;
  downloadGame(gameId: string): Promise<void>;
  /** 宿主私有能力，method 由各适配器白名单裁决，未授权直接拒绝 */
  invoke(method: string, params?: Record<string, unknown>): Promise<unknown>;
}
