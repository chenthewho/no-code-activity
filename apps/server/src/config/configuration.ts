import { z } from 'zod';

/**
 * 布尔开关。z.coerce.boolean 会把字符串 "false" 也当成 true（非空即真），
 * 写进 .env 的开关全都得走这里。
 */
const envBool = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0', ''])
    .optional()
    .transform((v) => (v === undefined || v === '' ? fallback : v === 'true' || v === '1'));

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

  /**
   * 反向代理后面部署时必须配：否则所有请求的 IP 都是代理的，按 IP 的限流（登录换票、
   * 埋点与健康上报）会让全体用户共用一个额度。取值同 Express 的 trust proxy：
   * true / 代理层数（如 1）/ 逗号分隔的代理网段（如 loopback,10.0.0.0/8）。
   */
  TRUST_PROXY: z.string().optional(),

  // 对象存储：未配置时发布走本地目录，便于本地跑通全链路
  COS_BUCKET: z.string().optional(),
  COS_REGION: z.string().optional(),
  COS_SECRET_ID: z.string().optional(),
  COS_SECRET_KEY: z.string().optional(),
  /** 缺省从桶名后缀解析（name-1250000000） */
  COS_APPID: z.string().optional(),
  /** 覆盖桶的访问域名：全球加速、内网域名或兼容实现 */
  COS_ENDPOINT: z.string().optional(),
  /** STS 地址，VPC 内可改走 sts.internal.tencentcloudapi.com */
  STS_ENDPOINT: z.string().optional(),
  /** 浏览器直传的临时密钥有效期（秒），STS 允许 900 起 */
  COS_UPLOAD_EXPIRES: z.coerce.number().int().min(900).max(7200).default(900),
  /**
   * 产物与素材的对外访问根。未配置时：本地模式指向 /static 静态托管，
   * COS 模式指向桶域名——上线时应改成桶绑定的 CDN 域名。
   */
  CDN_BASE_URL: z.string().optional(),
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
   * 服务端对外的 API 根地址（含前缀）。SSO 回调地址由它拼出，必须是 IdP 能
   * 302 回来的公网地址——反向代理后面的服务自己推断不出来，只能显式配。
   */
  PUBLIC_API_BASE_URL: z.string().default('http://localhost:3100/api/v1'),
  /** 管理后台站点根，后台 SSO 登录完成后跳回这里 */
  ADMIN_BASE_URL: z.string().default('http://localhost:5173'),

  /**
   * 统一登录（OIDC 授权码 + PKCE）。
   * none —— 不开启；oidc —— 对接真实 IdP；mock —— 服务端自带的模拟 IdP，
   * 只为本地把「跳转 → 回调 → 换票」整条链路跑通，生产环境禁用。
   */
  SSO_PROVIDER: z.enum(['none', 'oidc', 'mock']).default('none'),
  /** 配了 issuer 就走 .well-known 自动发现，下面三个端点可省 */
  SSO_ISSUER: z.string().optional(),
  SSO_AUTHORIZE_URL: z.string().optional(),
  SSO_TOKEN_URL: z.string().optional(),
  SSO_USERINFO_URL: z.string().optional(),
  SSO_CLIENT_ID: z.string().optional(),
  SSO_CLIENT_SECRET: z.string().optional(),
  SSO_SCOPE: z.string().default('openid profile'),
  /** 登录按钮上展示的名字，如「公司统一账号」 */
  SSO_LABEL: z.string().default('统一登录'),
  /** userinfo 里各字段的取法，不同 IdP 命名不一 */
  SSO_CLAIM_USER_ID: z.string().default('sub'),
  SSO_CLAIM_USERNAME: z.string().default('preferred_username'),
  SSO_CLAIM_NICKNAME: z.string().default('name'),
  SSO_CLAIM_AVATAR: z.string().default('picture'),
  /**
   * 后台是否允许 SSO 登录。首次登录自动开户，缺省**不授予任何角色**：C 端与后台往往共用
   * 一个 IdP，任何活动参与者都能走到这一步——开户可以，权限必须由管理员手动授予。
   * 只有确定 IdP 里全是内部员工时，才把 SSO_ADMIN_DEFAULT_ROLE 配成某个角色。
   */
  SSO_ADMIN_ENABLED: envBool(true),
  SSO_ADMIN_DEFAULT_ROLE: z.string().optional(),

  /**
   * C 端登录态。与后台 token 用不同的密钥签发——两种 token 互相拿不过去，
   * 活动页上的用户永远摸不到管理接口。缺省由 JWT_SECRET 派生。
   */
  RUNTIME_JWT_SECRET: z.string().min(16).optional(),
  RUNTIME_JWT_EXPIRES_IN: z
    .string()
    .regex(/^\d+(s|m|h|d|w|y)$/, 'RUNTIME_JWT_EXPIRES_IN 形如 30d / 12h')
    .default('30d'),
  /** 允许 SSO 登录后跳回的活动页源，逗号分隔；缺省只认 ACTIVITY_BASE_URL 的源 */
  RUNTIME_REDIRECT_ORIGINS: z.string().optional(),

  /**
   * 宿主登录：SDK / 游戏中心等宿主拉起自家登录后给一个一次性 code，
   * 服务端拿它去宿主账号服务换用户身份。
   * none —— 不开启；http —— POST 到 HOST_AUTH_VERIFY_URL 校验；
   * mock —— 接受形如 mock:<userId> 的 code，仅限本地联调。
   */
  HOST_AUTH_MODE: z.enum(['none', 'http', 'mock']).default('none'),
  HOST_AUTH_VERIFY_URL: z.string().optional(),
  /** 微信小程序：web-view 外层用 wx.login 的 code 换活动页登录票据 */
  WECHAT_MP_APPID: z.string().optional(),
  WECHAT_MP_SECRET: z.string().optional(),

  /** 告警评估周期（毫秒），0 关闭；监控事件保留天数 */
  MONITOR_EVAL_INTERVAL_MS: z.coerce.number().int().min(0).default(60_000),
  MONITOR_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(30),

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
  const env = result.data;
  // 模拟登录是给本地联调开的后门，带进生产等于任何人都能冒充任意用户
  if (env.NODE_ENV === 'production') {
    if (env.SSO_PROVIDER === 'mock') throw new Error('生产环境禁止 SSO_PROVIDER=mock');
    if (env.HOST_AUTH_MODE === 'mock') throw new Error('生产环境禁止 HOST_AUTH_MODE=mock');
  }
  if (env.SSO_PROVIDER === 'oidc' && !env.SSO_CLIENT_ID) {
    throw new Error('SSO_PROVIDER=oidc 时必须配置 SSO_CLIENT_ID');
  }
  if (env.HOST_AUTH_MODE === 'http' && !env.HOST_AUTH_VERIFY_URL) {
    throw new Error('HOST_AUTH_MODE=http 时必须配置 HOST_AUTH_VERIFY_URL');
  }
  return env;
}

/** TRUST_PROXY 的字符串转成 Express 认的形状 */
export function parseTrustProxy(value: string): boolean | number | string {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false' || trimmed === '') return false;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

export function corsOrigins(value: string): string[] | true {
  if (value.trim() === '*') return true;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
