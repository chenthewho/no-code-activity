import { afterEach, describe, expect, it, vi } from 'vitest';
import { CosService } from './cos.service';

function service(env: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    COS_BUCKET: 'demo-1250000000',
    COS_REGION: 'ap-guangzhou',
    COS_SECRET_ID: 'AKIDpermanent',
    COS_SECRET_KEY: 'permanentKey',
    ...env,
  };
  return new CosService({ get: (key: string) => values[key] } as never);
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('CosService', () => {
  it('四项配置齐了才启用；APPID 从桶名后缀解析', () => {
    expect(service().enabled).toBe(true);
    expect(service().appId).toBe('1250000000');
    expect(service({ COS_SECRET_KEY: undefined }).enabled).toBe(false);
    expect(service().endpoint).toBe('https://demo-1250000000.cos.ap-guangzhou.myqcloud.com');
    expect(service({ COS_ENDPOINT: 'http://127.0.0.1:9100/' }).endpoint).toBe(
      'http://127.0.0.1:9100',
    );
  });

  it('直传凭证：向 STS 申请只能 PutObject 这一个 key 的临时密钥，并用它签好 PUT', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      json(200, {
        Response: {
          Credentials: { Token: 'session-token', TmpSecretId: 'AKIDtmp', TmpSecretKey: 'tmpKey' },
          ExpiredTime: 1900000000,
          RequestId: 'r1',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const upload = await service().createDirectUpload('assets/ab/hash.png', 'image/png', 900);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://sts.tencentcloudapi.com/');
    const headers = init!.headers as Record<string, string>;
    expect(headers['X-TC-Action']).toBe('GetFederationToken');
    expect(headers['X-TC-Version']).toBe('2018-08-13');
    expect(headers['X-TC-Region']).toBe('ap-guangzhou');
    expect(headers.Authorization).toMatch(
      /^TC3-HMAC-SHA256 Credential=AKIDpermanent\/\d{4}-\d\d-\d\d\/sts\/tc3_request/,
    );

    const body = JSON.parse(String(init!.body)) as { Policy: string; DurationSeconds: number };
    expect(body.DurationSeconds).toBe(900);
    const policy = JSON.parse(decodeURIComponent(body.Policy)) as {
      statement: { action: string[]; resource: string[] }[];
    };
    expect(policy.statement[0]!.action).toEqual(['name/cos:PutObject']);
    expect(policy.statement[0]!.resource).toEqual([
      'qcs::cos:ap-guangzhou:uid/1250000000:demo-1250000000/assets/ab/hash.png',
    ]);

    expect(upload.uploadUrl).toBe(
      'https://demo-1250000000.cos.ap-guangzhou.myqcloud.com/assets/ab/hash.png',
    );
    expect(upload.headers['x-cos-security-token']).toBe('session-token');
    expect(upload.headers['Content-Type']).toBe('image/png');
    // 前端拿到的签名出自临时密钥，永久密钥不出服务端
    expect(upload.headers.Authorization).toContain('q-ak=AKIDtmp');
    expect(upload.headers.Authorization).not.toContain('AKIDpermanent');
    expect(upload.credentials.expiredTime).toBe(1900000000);
  });

  it('STS 报错时把错误码带出来', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json(200, {
          Response: { Error: { Code: 'AuthFailure.SignatureFailure', Message: 'bad' } },
        }),
      ),
    );
    await expect(service().createDirectUpload('assets/x.png', 'image/png', 900)).rejects.toThrow(
      /AuthFailure.SignatureFailure/,
    );
  });

  it('HEAD 404 视为不存在，200 取 Content-Length', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 404 }))
        .mockResolvedValueOnce(
          new Response(null, { status: 200, headers: { 'Content-Length': '1234' } }),
        ),
    );
    const cos = service();
    expect(await cos.headObject('assets/a.png')).toEqual({ exists: false, size: 0 });
    expect(await cos.headObject('assets/a.png')).toEqual({ exists: true, size: 1234 });
  });

  it('服务端上传带 Cache-Control，失败时报出 COS 的错误码', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 200 }))
      .mockResolvedValueOnce(
        new Response('<Error><Code>AccessDenied</Code></Error>', { status: 403 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const cos = service();
    await cos.putObject(
      'activities/a/v1/x.json',
      Buffer.from('{}'),
      'application/json',
      'max-age=1',
    );
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Record<string, string>;
    expect(headers['Cache-Control']).toBe('max-age=1');
    expect(headers.Authorization).toContain('q-ak=AKIDpermanent');
    await expect(cos.putObject('k', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      /AccessDenied/,
    );
  });
});
