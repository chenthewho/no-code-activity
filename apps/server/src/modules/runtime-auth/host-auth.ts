/**
 * 宿主登录凭据校验。
 *
 * SDK、游戏中心这类宿主有自己的账号体系：页面通过桥接拉起宿主登录，宿主给回
 * 一个一次性 code，服务端拿它去宿主账号服务换身份。桥接直接返回 userId 是不可信的
 * ——页面里任何脚本都能伪造，所以身份只认服务端校验过的结果。
 */

export interface HostIdentity {
  externalId: string;
  nickname?: string;
  avatar?: string;
}

/** 本地联调：code 形如 mock:<userId>[:<昵称>] */
export function parseMockCode(code: string): HostIdentity | null {
  const match = /^mock:([\w.-]{1,64})(?::(.{1,32}))?$/.exec(code.trim());
  if (!match) return null;
  return { externalId: match[1]!, nickname: match[2] };
}

/**
 * 宿主账号服务校验。约定：POST { host, code }，成功返回
 * { userId, nickname?, avatar? }；非 2xx 或缺 userId 都视为校验失败。
 */
export async function verifyByHttp(
  url: string,
  host: string,
  code: string,
  http: typeof fetch = fetch,
): Promise<HostIdentity> {
  const response = await http(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ host, code }),
    signal: AbortSignal.timeout(5000),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof payload.userId !== 'string' || !payload.userId) {
    throw new Error(`宿主登录校验失败（HTTP ${response.status}）`);
  }
  return {
    externalId: payload.userId,
    nickname: typeof payload.nickname === 'string' ? payload.nickname : undefined,
    avatar: typeof payload.avatar === 'string' ? payload.avatar : undefined,
  };
}

/**
 * 小程序 code2Session。有 unionid 优先用 unionid——同一主体下多个小程序/公众号
 * 是同一个人，用 openid 会被拆成多个用户。
 */
export async function wechatCode2Session(
  appId: string,
  secret: string,
  code: string,
  http: typeof fetch = fetch,
): Promise<HostIdentity> {
  const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
  url.searchParams.set('appid', appId);
  url.searchParams.set('secret', secret);
  url.searchParams.set('js_code', code);
  url.searchParams.set('grant_type', 'authorization_code');

  const response = await http(url.toString(), { signal: AbortSignal.timeout(5000) });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof payload.errcode === 'number' && payload.errcode !== 0) {
    throw new Error(`微信登录失败：${String(payload.errmsg ?? payload.errcode)}`);
  }
  const id = typeof payload.unionid === 'string' ? payload.unionid : payload.openid;
  if (typeof id !== 'string' || !id) throw new Error('微信登录失败：未返回 openid');
  return { externalId: id };
}
