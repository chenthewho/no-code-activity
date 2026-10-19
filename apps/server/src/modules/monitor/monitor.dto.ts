import { z } from 'zod';

/** 渲染器上报的事件类型；publish_invalid 由服务端自己记，不接受上报 */
export const CLIENT_EVENT_TYPES = [
  'boot',
  'load_error',
  'dsl_invalid',
  'stall',
  'white_screen',
  'js_error',
  'host_mismatch',
] as const;

export const reportMonitorSchema = z.object({
  activityId: z.string().max(64).optional(),
  host: z.string().max(32).optional(),
  events: z
    .array(
      z.object({
        type: z.enum(CLIENT_EVENT_TYPES),
        message: z.string().max(500).optional(),
        detail: z.record(z.string(), z.unknown()).optional(),
        durationMs: z.number().int().min(0).max(600_000).optional(),
      }),
    )
    .min(1)
    .max(50),
});
export type ReportMonitorDto = z.infer<typeof reportMonitorSchema>;

export const METRICS = [
  'dsl_invalid_rate',
  'white_screen_rate',
  'load_error_rate',
  'js_error_count',
  'publish_invalid_count',
] as const;
export type Metric = (typeof METRICS)[number];

export const WEBHOOK_TYPES = ['none', 'wecom', 'feishu', 'dingtalk', 'generic'] as const;
export type WebhookType = (typeof WEBHOOK_TYPES)[number];

export const alertRuleSchema = z.object({
  name: z.string().min(1).max(60),
  metric: z.enum(METRICS),
  /** 比率类填 0~1（0.05 = 5%），计数类填次数 */
  threshold: z.number().min(0),
  windowMinutes: z.number().int().min(1).max(1440).default(10),
  minSamples: z.number().int().min(0).max(100_000).default(20),
  cooldownMinutes: z.number().int().min(1).max(1440).default(30),
  enabled: z.boolean().default(true),
  webhookType: z.enum(WEBHOOK_TYPES).default('none'),
  webhookUrl: z
    .string()
    .max(1024)
    .refine((v) => v === '' || /^https?:\/\//.test(v), '需为 http(s) 地址')
    .optional(),
});
export type AlertRuleDto = z.infer<typeof alertRuleSchema>;

export const updateAlertRuleSchema = alertRuleSchema.partial();

export const overviewSchema = z.object({
  hours: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 7)
    .default(24),
  activityId: z.string().max(64).optional(),
});

export const listAlertsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
