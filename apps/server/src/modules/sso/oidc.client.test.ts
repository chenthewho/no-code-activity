import { describe, expect, it, vi } from 'vitest';
import { OidcClient, createPkcePair, mapClaims, pkceChallenge } from './oidc.client';

const CLAIMS = { id: 'sub', username: 'preferred_username', nickname: 'name', avatar: 'picture' };

function json(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('OidcClient', () => {
  it('授权地址带齐授权码 + PKCE 参数', async () => {
    const client = new OidcClient({
      clientId: 'cid',
      scope: 'openid profile',
      claims: CLAIMS,
      endpoints: {
        authorizationEndpoint: 'https://idp.test/authorize',
        tokenEndpoint: 'https://idp.test/token',
        userinfoEndpoint: 'https://idp.test/userinfo',
      },
    });
    const url = new URL(
      await client.authorizeUrl({
        state: 's1',
        redirectUri: 'https://api.test/sso/callback',
        codeChallenge: 'ch',
      }),
    );
    expect(url.origin + url.pathname).toBe('https://idp.test/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'cid',
      redirect_uri: 'https://api.test/sso/callback',
      scope: 'openid profile',
      state: 's1',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    });
  });

  it('没给端点时走 .well-known 发现，且只拉一次', async () => {
    const http = vi.fn(async (url: string) =>
      url.endsWith('/.well-known/openid-configuration')
        ? json(200, {
            authorization_endpoint: 'https://idp.test/a',
            token_endpoint: 'https://idp.test/t',
            userinfo_endpoint: 'https://idp.test/u',
          })
        : json(404, {}),
    );
    const client = new OidcClient({
      clientId: 'cid',
      scope: 'openid',
      claims: CLAIMS,
      issuer: 'https://idp.test/',
      fetch: http as unknown as typeof fetch,
    });
    await client.endpoints();
    const endpoints = await client.endpoints();
    expect(endpoints.tokenEndpoint).toBe('https://idp.test/t');
    expect(http).toHaveBeenCalledTimes(1);
    expect(http.mock.calls[0]![0]).toBe('https://idp.test/.well-known/openid-configuration');
  });

  it('换令牌时以表单提交 code_verifier 与 client_secret', async () => {
    const http = vi.fn(async () => json(200, { access_token: 'at_1', token_type: 'Bearer' }));
    const client = new OidcClient({
      clientId: 'cid',
      clientSecret: 'sec',
      scope: 'openid',
      claims: CLAIMS,
      endpoints: {
        authorizationEndpoint: 'x',
        tokenEndpoint: 'https://idp.test/t',
        userinfoEndpoint: 'y',
      },
      fetch: http as unknown as typeof fetch,
    });
    const token = await client.exchangeCode({
      code: 'c1',
      redirectUri: 'https://cb',
      codeVerifier: 'v1',
    });
    expect(token).toBe('at_1');
    const [, init] = http.mock.calls[0] as unknown as [string, RequestInit];
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'c1',
      redirect_uri: 'https://cb',
      client_id: 'cid',
      code_verifier: 'v1',
      client_secret: 'sec',
    });
  });

  it('IdP 拒绝时把 error_description 带出来', async () => {
    const http = vi.fn(async () =>
      json(400, { error: 'invalid_grant', error_description: 'code 已使用' }),
    );
    const client = new OidcClient({
      clientId: 'cid',
      scope: 'openid',
      claims: CLAIMS,
      endpoints: { authorizationEndpoint: 'x', tokenEndpoint: 't', userinfoEndpoint: 'u' },
      fetch: http as unknown as typeof fetch,
    });
    await expect(
      client.exchangeCode({ code: 'c', redirectUri: 'r', codeVerifier: 'v' }),
    ).rejects.toThrow(/code 已使用/);
  });
});

describe('PKCE', () => {
  it('challenge 是 verifier 的 SHA-256 base64url（RFC 7636 附录 B 向量）', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
    const pair = createPkcePair();
    expect(pair.challenge).toBe(pkceChallenge(pair.verifier));
    expect(pair.verifier).toMatch(/^[\w-]{43,128}$/);
  });
});

describe('mapClaims', () => {
  it('按配置的字段名取身份，昵称缺省回落用户名', () => {
    expect(
      mapClaims({ uid: 42, login: 'alice' }, { ...CLAIMS, id: 'uid', username: 'login' }),
    ).toEqual({
      id: '42',
      username: 'alice',
      nickname: 'alice',
      avatar: undefined,
    });
  });

  it('缺用户 id 直接报错，绝不建一个空 id 的用户', () => {
    expect(() => mapClaims({ name: 'x' }, CLAIMS)).toThrow(/缺少 sub/);
  });
});
