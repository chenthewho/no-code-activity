import { z } from 'zod';

/**
 * 环境变量集中校验：缺关键配置就在启动时炸掉，
 * 而不是等某个接口第一次被调用才在线上暴露。
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default('api/v1'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL 必填'),
  REDIS_URL: z.string().optional(),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET 至少 16 位'),
  // 限定 ms 库支持的写法，auth.module 里的类型断言才站得住脚
  JWT_EXPIRES_IN: z
    .string()
    .regex(/^\d+(s|m|h|d|w|y)$/, 'JWT_EXPIRES_IN 形如 7d / 12h / 30m')
    .default('7d'),

  CORS_ORIGINS: z.string().default('*'),

  // 对象存储：未配置时发布走本地目录，便于本地跑通全链路
  COS_BUCKET: z.string().optional(),
  COS_REGION: z.string().optional(),
  COS_SECRET_ID: z.string().optional(),
  COS_SECRET_KEY: z.string().optional(),
  CDN_BASE_URL: z.string().default('http://localhost:3100/static'),
  PUBLISH_LOCAL_DIR: z.string().default('./.publish'),

  /** Renderer 产物地址，写进 manifest.entry */
  RENDERER_ENTRY_JS: z.string().default('http://localhost:5180/src/main.tsx'),
  RENDERER_ENTRY_CSS: z.string().default(''),

  /**
   * 活动页站点根，发布后返回的 activityUrl 由它拼出。
   * 与 CDN_BASE_URL 是两回事：那是发布产物（DSL/manifest）的托管地址，
   * 这是渲染器应用的访问地址——本地开发时两者根本不在同一个端口上。
   */
  ACTIVITY_BASE_URL: z.string().default('http://localhost:5180'),

  /**
   * AI 助手。key 一律 optional——没配 key 的本地环境要能照常起服务、跑测试，
   * 只是调 AI 接口时才报错。这里写成必填的话，所有不碰 AI 的人都会被卡在启动。
   */
  ANTHROPIC_API_KEY: z.string().optional(),
  /** 走代理/网关时改这里，直连官方留空 */
  ANTHROPIC_BASE_URL: z.string().optional(),
  AI_MODEL: z.string().default('claude-opus-5'),
  /** 流式输出，给足余量；编排类任务的思考与工具调用都算在里面 */
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(64000),
  AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
  /**
   * Opus 5 的思考模式。走网关/非 Claude 后端（如 deepseek）时有些后端
   * 不认 thinking + tool_choice 的组合，会直接 400，此时置 off 连
   * output_config 一起省掉。
   */
  AI_THINKING: z.enum(['adaptive', 'off']).default('adaptive'),
  /**
   * 工具选择策略。force=强制指定工具（Opus 5 原生支持）；auto=降级成
   * 交给模型自己选——网关/非 Claude 后端（如 deepseek）的 thinking 模式
   * 不允许强制 tool_choice，会直接 400，只能 auto。
   */
  AI_TOOL_CHOICE: z.enum(['force', 'auto']).default('force'),
  /** 单次运行的补丁上限，兜住模型跑飞 */
  AI_MAX_PATCHES_PER_RUN: z.coerce.number().int().positive().default(80),
});

export type AppConfig = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): AppConfig {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n  ');
    throw new Error(`环境变量校验失败：\n  ${detail}`);
  }
  return result.data;
}

export function corsOrigins(value: string): string[] | true {
  if (value.trim() === '*') return true;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
