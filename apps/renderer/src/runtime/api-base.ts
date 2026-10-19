/**
 * API_BASE 是唯一一个「renderer 知道服务端地址」的地方：数据源相对 URL、
 * 业务动作、登录都从这里解析。生产走 CDN 时通过 VITE_API_BASE 注入，缺省指回本地。
 *
 * 单独成文件是为了让 api.ts 与 auth.ts 都能引用它而不互相 import。
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? 'http://localhost:3100/api/v1';
