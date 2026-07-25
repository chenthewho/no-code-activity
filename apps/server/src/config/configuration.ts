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
  RENDERER_ENTRY_JS: z.string().default('http://localhost:5174/src/main.tsx'),
  RENDERER_ENTRY_CSS: z.string().default(''),
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
