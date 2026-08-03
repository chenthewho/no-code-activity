/**
 * 活动页地址 = 渲染器站点根 + /act/:id。
 *
 * 单独拎出来是因为它曾经推导错过：早先从 CDN_BASE_URL 掐掉 /static 得到站点根，
 * 而 CDN_BASE_URL 指的是发布产物（DSL/manifest）的托管地址。生产环境下产物与
 * 渲染器同源，掐一刀恰好对；本地开发产物由服务端 :3100/static 托管，渲染器却在
 * :5180，推出来的 http://localhost:3100/act/xxx 点开就是 Cannot GET。
 *
 * 不带 NestJS 依赖，纯函数好单测。
 */
export function buildActivityUrl(base: string, activityId: string): string {
  return `${base.replace(/\/+$/, '')}/act/${activityId}`;
}
