import { z } from 'zod';
import { httpUrl, identifier, jsonValue } from './primitives';

const baseFields = {
  id: identifier,
  name: z.string().min(1).max(60),
  /** 数据就绪前，绑定该数据源的组件读到的兜底值 */
  fallback: jsonValue.optional(),
};

/**
 * HTTP 数据源。url 走后端 RuntimeModule 代理白名单，
 * 不允许 Renderer 直连任意域名（防 SSRF 与跨域配置泛滥）。
 */
export const httpDataSourceSchema = z.object({
  ...baseFields,
  // 与动作字段同理：新建数据源时 url 必然为空，草稿要能存下
  type: z.literal('http'),
  url: httpUrl.or(z.literal('')),
  method: z.enum(['GET', 'POST']).default('GET'),
  headers: z.record(z.string(), z.string()).default({}),
  /** 值可含 {{ }} 表达式，请求前由 propsParser 求值 */
  params: z.record(z.string(), jsonValue).default({}),
  body: z.record(z.string(), jsonValue).optional(),
  /** 页面加载即请求；false 则等 dataSource.refresh 动作触发 */
  autoLoad: z.boolean().default(true),
  /** 轮询间隔（毫秒），0 表示不轮询。榜单类活动常用 */
  pollInterval: z.number().int().min(0).max(3_600_000).default(0),
  /** 响应裁剪表达式，如 "{{ response.data.list }}" */
  transform: z.string().optional(),
  cacheTtl: z.number().int().min(0).default(0),
});

/** 静态数据源：设计器里直接填的 mock / 常量表 */
export const staticDataSourceSchema = z.object({
  ...baseFields,
  type: z.literal('static'),
  data: jsonValue,
});

/** 计算数据源：由其它数据源或页面状态派生 */
export const computedDataSourceSchema = z.object({
  ...baseFields,
  type: z.literal('computed'),
  expression: z.string(),
});

export const dataSourceSchema = z.discriminatedUnion('type', [
  httpDataSourceSchema,
  staticDataSourceSchema,
  computedDataSourceSchema,
]);

export type DataSource = z.infer<typeof dataSourceSchema>;
export type HttpDataSource = z.infer<typeof httpDataSourceSchema>;
