import { z } from 'zod';
import { assetUrl, identifier } from './primitives';
import { dslMetaSchema } from './meta';
import { dataSourceSchema } from './datasource';
import { eventBindingSchema } from './action';
import { craftJsonSchema } from './node';

export const assetRefSchema = z.object({
  id: identifier,
  url: assetUrl,
  type: z.enum(['image', 'video', 'audio', 'font']),
  /** 首屏关键资源，Renderer 启动时预加载并等待，避免加载闪烁 */
  critical: z.boolean().default(false),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  bytes: z.number().int().nonnegative().optional(),
});

export type AssetRef = z.infer<typeof assetRefSchema>;

/**
 * FinalDSL —— 发布产物，也是设计器预览下发的同一份结构。
 * 「设计器所见 = 线上所得」的根基：两端消费的是同一个对象、同一份 schema。
 */
export const finalDslSchema = z.object({
  schemaVersion: z.string().min(1),
  meta: dslMetaSchema,
  dataSources: z.array(dataSourceSchema).default([]),
  craftJson: craftJsonSchema,
  events: z.array(eventBindingSchema).default([]),
  assets: z.array(assetRefSchema).default([]),
  /** 页面初始状态，state.set 动作与表达式上下文的 state 命名空间 */
  initialState: z.record(z.string(), z.unknown()).default({}),
});

export type FinalDsl = z.infer<typeof finalDslSchema>;

/**
 * manifest.json —— 发布描述文件，CDN 上的入口。
 * DSL 内容与 Renderer 代码解耦：代码随 CI 发版，DSL 随活动发布，
 * 回滚只需把 manifest 指针指回旧版本，秒级生效。
 */
export const manifestSchema = z.object({
  activityId: z.string().min(1),
  version: z.number().int().positive(),
  publishedAt: z.string().min(1),
  entry: z.object({
    js: z.array(assetUrl).min(1),
    css: z.array(assetUrl).default([]),
  }),
  /** FinalDSL 的 CDN 地址 */
  dsl: assetUrl,
  runtime: z.object({
    schemaVersion: z.string().min(1),
    hosts: z.array(z.string()).default([]),
    minRendererVersion: z.string().optional(),
  }),
});

export type Manifest = z.infer<typeof manifestSchema>;
