import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../common/redis/redis.service';
import { OidcClient, createPkcePair, randomToken, type OidcProfile } from './oidc.client';

/** 登录发起方：活动页上的 C 端用户，或管理后台的运营 */
export type SsoKind = 'runtime' | 'admin';

/**
 * 回调处理器：拿到 IdP 认证过的身份后，各自建号/签票，返回最终要 302 去的地址。
 * 由 AuthModule / RuntimeAuthModule 在启动时注册进来——SSO 模块因此不需要
 * 反过来依赖它们，也就没有循环引用。
 */
export type SsoCompletion = (profile: OidcProfile, redirect: string) => Promise<string>;

interface PendingState {
  kind: SsoKind;
  redirect: string;
  verifier: string;
}

/** 授权请求的有效期：用户在 IdP 登录页上磨蹭再久也够了 */
const STATE_TTL_MS = 10 * 60 * 1000;
/** 登录票据只用来在回跳后换一次 token，越短越好 */
const TICKET_TTL_MS = 60 * 1000;

export const MOCK_CLIENT_ID = 'nca-mock-client';
export const MOCK_CLIENT_SECRET = 'nca-mock-secret';

@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  private readonly completions = new Map<SsoKind, SsoCompletion>();
  private oidc: OidcClient | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {
    if (this.provider === 'mock') {
      this.logger.warn('SSO 使用模拟 IdP（SSO_PROVIDER=mock），仅限本地联调');
    }
  }

  get provider(): 'none' | 'oidc' | 'mock' {
    return this.config.get('SSO_PROVIDER') ?? 'none';
  }

  get enabled(): boolean {
    return this.provider !== 'none';
  }

  get label(): string {
    return this.config.get<string>('SSO_LABEL') ?? '统一登录';
  }

  get apiBase(): string {
    return (
      this.config.get<string>('PUBLIC_API_BASE_URL') ?? 'http://localhost:3100/api/v1'
    ).replace(/\/$/, '');
  }

  /** IdP 上只需登记这一个回调地址，C 端和后台共用，靠 state 分流 */
  get callbackUrl(): string {
    return `${this.apiBase}/sso/callback`;
  }

  register(kind: SsoKind, completion: SsoCompletion): void {
    this.completions.set(kind, completion);
  }

  /** 生成授权地址：state 与 PKCE verifier 留在服务端，IdP 只看得到 challenge */
  async begin(kind: SsoKind, redirect: string): Promise<string> {
    if (!this.enabled) throw new NotFoundException('未开启统一登录');
    const state = randomToken();
    const { verifier, challenge } = createPkcePair();
    const pending: PendingState = { kind, redirect, verifier };
    await this.redis.set(stateKey(state), JSON.stringify(pending), STATE_TTL_MS);
    return this.client().authorizeUrl({
      state,
      redirectUri: this.callbackUrl,
      codeChallenge: challenge,
    });
  }

  /** IdP 回调：校验 state → 换令牌 → 取身份 → 交给发起方的处理器决定去哪 */
  async complete(code: string | undefined, state: string | undefined): Promise<string> {
    if (!code || !state) throw new BadRequestException('回调缺少 code 或 state');
    const raw = await this.redis.take(stateKey(state));
    if (!raw) throw new BadRequestException('登录请求已过期，请重新登录');
    const pending = JSON.parse(raw) as PendingState;

    const completion = this.completions.get(pending.kind);
    if (!completion) throw new BadRequestException(`未注册的登录发起方：${pending.kind}`);

    const client = this.client();
    const accessToken = await client.exchangeCode({
      code,
      redirectUri: this.callbackUrl,
      codeVerifier: pending.verifier,
    });
    const profile = await client.userInfo(accessToken);
    return completion(profile, pending.redirect);
  }

  /** 一次性票据：回跳 URL 里只带它，不带 token——URL 会进浏览历史和 Referer */
  async issueTicket(kind: SsoKind, payload: Record<string, unknown>): Promise<string> {
    const ticket = randomToken();
    await this.redis.set(ticketKey(kind, ticket), JSON.stringify(payload), TICKET_TTL_MS);
    return ticket;
  }

  async consumeTicket<T>(kind: SsoKind, ticket: string): Promise<T> {
    const raw = await this.redis.take(ticketKey(kind, ticket));
    if (!raw) throw new BadRequestException('登录票据无效或已过期');
    return JSON.parse(raw) as T;
  }

  private client(): OidcClient {
    if (this.oidc) return this.oidc;
    const claims = {
      id: this.config.get<string>('SSO_CLAIM_USER_ID') ?? 'sub',
      username: this.config.get<string>('SSO_CLAIM_USERNAME') ?? 'preferred_username',
      nickname: this.config.get<string>('SSO_CLAIM_NICKNAME') ?? 'name',
      avatar: this.config.get<string>('SSO_CLAIM_AVATAR') ?? 'picture',
    };
    const scope = this.config.get<string>('SSO_SCOPE') ?? 'openid profile';

    if (this.provider === 'mock') {
      const base = `${this.apiBase}/sso-mock`;
      this.oidc = new OidcClient({
        clientId: MOCK_CLIENT_ID,
        clientSecret: MOCK_CLIENT_SECRET,
        scope,
        claims,
        endpoints: {
          authorizationEndpoint: `${base}/authorize`,
          tokenEndpoint: `${base}/token`,
          userinfoEndpoint: `${base}/userinfo`,
        },
      });
      return this.oidc;
    }

    this.oidc = new OidcClient({
      clientId: this.config.getOrThrow<string>('SSO_CLIENT_ID'),
      clientSecret: this.config.get<string>('SSO_CLIENT_SECRET'),
      scope,
      claims,
      issuer: this.config.get<string>('SSO_ISSUER'),
      endpoints: {
        authorizationEndpoint: this.config.get<string>('SSO_AUTHORIZE_URL'),
        tokenEndpoint: this.config.get<string>('SSO_TOKEN_URL'),
        userinfoEndpoint: this.config.get<string>('SSO_USERINFO_URL'),
      },
    });
    return this.oidc;
  }
}

const stateKey = (state: string): string => `nca:sso:state:${state}`;
const ticketKey = (kind: SsoKind, ticket: string): string => `nca:sso:ticket:${kind}:${ticket}`;
