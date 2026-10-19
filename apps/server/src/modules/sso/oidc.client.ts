import { createHash, randomBytes } from 'node:crypto';

/**
 * 最小 OIDC 客户端：授权码 + PKCE。
 *
 * 没引 openid-client：我们只用到「拼授权地址 → 用 code 换 access_token →
 * 拿 userinfo」三步，身份以 userinfo 为准（服务端对服务端、走 TLS），
 * 不需要在本地验 id_token 的签名，也就用不上 JWKS 那一整套。
 */

export interface OidcEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
}

export interface OidcClaimMapping {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
}

export interface OidcClientOptions {
  clientId: string;
  clientSecret?: string;
  scope: string;
  /** 配了就走 .well-known 自动发现，显式给的端点优先 */
  issuer?: string;
  endpoints?: Partial<OidcEndpoints>;
  claims: OidcClaimMapping;
  /** 测试注入用 */
  fetch?: typeof fetch;
}

/** 从 IdP 拿到的、已按映射规则归一化的身份 */
export interface OidcProfile {
  id: string;
  username?: string;
  nickname?: string;
  avatar?: string;
}

export function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

/** PKCE：verifier 留在服务端，challenge 随授权请求发给 IdP */
export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = randomToken(48);
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

/** 按配置的 claim 名取字段；取不到用户 id 视为 IdP 返回异常 */
export function mapClaims(raw: Record<string, unknown>, claims: OidcClaimMapping): OidcProfile {
  const pick = (key: string): string | undefined => {
    const value = raw[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
    return undefined;
  };
  const id = pick(claims.id);
  if (!id) throw new Error(`IdP 返回的用户信息缺少 ${claims.id} 字段`);
  return {
    id,
    username: pick(claims.username),
    nickname: pick(claims.nickname) ?? pick(claims.username),
    avatar: pick(claims.avatar),
  };
}

export class OidcClient {
  private discovered: Promise<OidcEndpoints> | null = null;
  private readonly http: typeof fetch;

  constructor(private readonly options: OidcClientOptions) {
    this.http = options.fetch ?? fetch;
  }

  async endpoints(): Promise<OidcEndpoints> {
    const given = this.options.endpoints ?? {};
    if (given.authorizationEndpoint && given.tokenEndpoint && given.userinfoEndpoint) {
      return given as OidcEndpoints;
    }
    if (!this.options.issuer) {
      throw new Error('SSO 未配置 issuer，也没有给全授权/令牌/用户信息三个端点');
    }
    // 发现文档只拉一次；失败了清掉缓存，下次请求再试，别把一次网络抖动永久记住
    this.discovered ??= this.discover(this.options.issuer).catch((err: unknown) => {
      this.discovered = null;
      throw err;
    });
    const found = await this.discovered;
    return {
      authorizationEndpoint: given.authorizationEndpoint ?? found.authorizationEndpoint,
      tokenEndpoint: given.tokenEndpoint ?? found.tokenEndpoint,
      userinfoEndpoint: given.userinfoEndpoint ?? found.userinfoEndpoint,
    };
  }

  async authorizeUrl(input: {
    state: string;
    redirectUri: string;
    codeChallenge: string;
  }): Promise<string> {
    const { authorizationEndpoint } = await this.endpoints();
    const url = new URL(authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.options.clientId);
    url.searchParams.set('redirect_uri', input.redirectUri);
    url.searchParams.set('scope', this.options.scope);
    url.searchParams.set('state', input.state);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  async exchangeCode(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<string> {
    const { tokenEndpoint } = await this.endpoints();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: this.options.clientId,
      code_verifier: input.codeVerifier,
    });
    if (this.options.clientSecret) body.set('client_secret', this.options.clientSecret);

    const response = await this.http(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: body.toString(),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok || typeof payload.access_token !== 'string') {
      const reason = payload.error_description ?? payload.error ?? `HTTP ${response.status}`;
      throw new Error(`用授权码换取令牌失败：${String(reason)}`);
    }
    return payload.access_token;
  }

  async userInfo(accessToken: string): Promise<OidcProfile> {
    const { userinfoEndpoint } = await this.endpoints();
    const response = await this.http(userinfoEndpoint, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`获取用户信息失败：HTTP ${response.status}`);
    const raw = (await response.json()) as Record<string, unknown>;
    return mapClaims(raw, this.options.claims);
  }

  private async discover(issuer: string): Promise<OidcEndpoints> {
    const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
    const response = await this.http(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`OIDC 发现文档获取失败：HTTP ${response.status}`);
    const doc = (await response.json()) as Record<string, unknown>;
    const pick = (key: string): string => {
      const value = doc[key];
      if (typeof value !== 'string') throw new Error(`OIDC 发现文档缺少 ${key}`);
      return value;
    };
    return {
      authorizationEndpoint: pick('authorization_endpoint'),
      tokenEndpoint: pick('token_endpoint'),
      userinfoEndpoint: pick('userinfo_endpoint'),
    };
  }
}
