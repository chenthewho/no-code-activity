import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cosAuthorization, tc3Authorization } from './tencent-sign';

export interface TempCredentials {
  tmpSecretId: string;
  tmpSecretKey: string;
  sessionToken: string;
  /** 秒级时间戳 */
  startTime: number;
  expiredTime: number;
}

/** 浏览器直传需要的一切：地址、方法、要带的头，以及给 SDK 分片上传用的临时密钥 */
export interface DirectUpload {
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  credentials: TempCredentials;
  bucket: string;
  region: string;
  key: string;
}

/** 签名有效期留一点余量给时钟偏差，与官方 SDK 的做法一致 */
const CLOCK_SKEW_S = 60;

/** 素材与产物都按内容寻址：同一个 key 的内容永不改变，CDN 与浏览器可以永久缓存 */
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

/**
 * 腾讯云 COS。
 *
 * 发布产物与服务端中转的上传用永久密钥直接写；浏览器直传则先向 STS 换一份
 * 只能写这一个对象的临时密钥——前端拿到的密钥即便泄露，也只能覆盖它本来就
 * 要上传的那个文件，几分钟后自动失效。
 */
@Injectable()
export class CosService {
  private readonly logger = new Logger(CosService.name);

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return Boolean(this.bucket && this.region && this.secretId && this.secretKey);
  }

  get bucket(): string {
    return this.config.get<string>('COS_BUCKET') ?? '';
  }

  get region(): string {
    return this.config.get<string>('COS_REGION') ?? '';
  }

  private get secretId(): string {
    return this.config.get<string>('COS_SECRET_ID') ?? '';
  }

  private get secretKey(): string {
    return this.config.get<string>('COS_SECRET_KEY') ?? '';
  }

  /** 桶名形如 name-1250000000，后缀就是 APPID；也可显式配 COS_APPID */
  get appId(): string {
    return this.config.get<string>('COS_APPID') ?? /-(\d+)$/.exec(this.bucket)?.[1] ?? '';
  }

  /** 桶的访问域名。可用 COS_ENDPOINT 覆盖（全球加速域名、内网域名、兼容实现） */
  get endpoint(): string {
    const custom = this.config.get<string>('COS_ENDPOINT');
    return (custom || `https://${this.bucket}.cos.${this.region}.myqcloud.com`).replace(/\/$/, '');
  }

  objectUrl(key: string): string {
    return `${this.endpoint}/${encodeKey(key)}`;
  }

  /** 服务端写对象：发布产物、中转上传。产物按内容寻址，可以放心设长缓存 */
  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
    cacheControl?: string,
  ): Promise<void> {
    const url = this.objectUrl(key);
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: this.sign('PUT', key, url),
        'Content-Type': contentType,
        'Content-Length': String(body.length),
        ...(cacheControl ? { 'Cache-Control': cacheControl } : {}),
      },
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new BadGatewayException(
        `COS 上传失败 ${key}：HTTP ${response.status} ${cosErrorCode(detail)}`,
      );
    }
  }

  /** 查对象是否存在及大小——直传完成后服务端据此确认文件真的到了 */
  async headObject(key: string): Promise<{ exists: boolean; size: number }> {
    const url = this.objectUrl(key);
    const response = await fetch(url, {
      method: 'HEAD',
      headers: { Authorization: this.sign('HEAD', key, url) },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) return { exists: false, size: 0 };
    if (!response.ok)
      throw new BadGatewayException(`COS 查询对象失败 ${key}：HTTP ${response.status}`);
    return { exists: true, size: Number(response.headers.get('content-length') ?? 0) };
  }

  /**
   * 浏览器直传：换一份只允许 PutObject 这一个 key 的临时密钥，并用它预先算好签名。
   * 前端直接照着 headers 发 PUT 即可，不必引入 COS SDK；要分片上传大文件时，
   * credentials 也一并给了。
   */
  async createDirectUpload(
    key: string,
    contentType: string,
    durationSeconds: number,
  ): Promise<DirectUpload> {
    const credentials = await this.federationToken(key, durationSeconds);
    const uploadUrl = this.objectUrl(key);
    const authorization = cosAuthorization({
      secretId: credentials.tmpSecretId,
      secretKey: credentials.tmpSecretKey,
      method: 'PUT',
      pathname: `/${key}`,
      headers: { host: new URL(uploadUrl).host },
      startTime: credentials.startTime,
      expireTime: credentials.expiredTime,
    });
    return {
      uploadUrl,
      method: 'PUT',
      headers: {
        Authorization: authorization,
        'x-cos-security-token': credentials.sessionToken,
        'Content-Type': contentType,
        // COS 把 PUT 时的 Cache-Control 存成对象元数据，回源时原样返回
        'Cache-Control': IMMUTABLE_CACHE,
      },
      credentials,
      bucket: this.bucket,
      region: this.region,
      key,
    };
  }

  /** STS GetFederationToken：策略收窄到单个对象的 PutObject */
  private async federationToken(key: string, durationSeconds: number): Promise<TempCredentials> {
    if (!this.appId)
      throw new Error('无法确定 COS APPID：桶名应形如 name-1250000000，或配置 COS_APPID');
    const policy = {
      version: '2.0',
      statement: [
        {
          effect: 'allow',
          action: ['name/cos:PutObject'],
          resource: [`qcs::cos:${this.region}:uid/${this.appId}:${this.bucket}/${key}`],
        },
      ],
    };
    const payload = JSON.stringify({
      Name: 'nca-upload',
      // 云 API 要求 Policy 做一次 URL 编码
      Policy: encodeURIComponent(JSON.stringify(policy)),
      DurationSeconds: durationSeconds,
    });
    const endpoint = (
      this.config.get<string>('STS_ENDPOINT') || 'https://sts.tencentcloudapi.com'
    ).replace(/\/$/, '');
    // 与官方 SDK 一致：参与签名的是不带端口的 hostname
    const host = new URL(endpoint).hostname;
    const timestamp = Math.floor(Date.now() / 1000);

    const response = await fetch(`${endpoint}/`, {
      method: 'POST',
      headers: {
        Authorization: tc3Authorization({
          secretId: this.secretId,
          secretKey: this.secretKey,
          service: 'sts',
          host,
          payload,
          timestamp,
        }),
        'Content-Type': 'application/json; charset=utf-8',
        'X-TC-Action': 'GetFederationToken',
        'X-TC-Version': '2018-08-13',
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Region': this.region,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json().catch(() => ({}))) as StsResponse;
    const result = body.Response;
    if (!response.ok || !result || result.Error || !result.Credentials) {
      const reason = result?.Error
        ? `${result.Error.Code}: ${result.Error.Message}`
        : `HTTP ${response.status}`;
      this.logger.error(`STS 换取临时密钥失败：${reason}`);
      throw new BadGatewayException(`获取上传凭证失败（${reason}）`);
    }
    return {
      tmpSecretId: result.Credentials.TmpSecretId,
      tmpSecretKey: result.Credentials.TmpSecretKey,
      sessionToken: result.Credentials.Token,
      startTime: timestamp - CLOCK_SKEW_S,
      expiredTime: result.ExpiredTime ?? timestamp + durationSeconds,
    };
  }

  private sign(method: string, key: string, url: string): string {
    const now = Math.floor(Date.now() / 1000);
    return cosAuthorization({
      secretId: this.secretId,
      secretKey: this.secretKey,
      method,
      pathname: `/${key}`,
      headers: { host: new URL(url).host },
      startTime: now - CLOCK_SKEW_S,
      expireTime: now + 600,
    });
  }
}

interface StsResponse {
  Response?: {
    Credentials?: { Token: string; TmpSecretId: string; TmpSecretKey: string };
    ExpiredTime?: number;
    Error?: { Code: string; Message: string };
  };
}

/** 对象路径逐段编码，保留 /——key 里出现空格、中文时 URL 才合法 */
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** COS 的错误体是 XML，取出 <Code> 足够定位问题，不把整段回给前端 */
function cosErrorCode(xml: string): string {
  return /<Code>([^<]+)<\/Code>/.exec(xml)?.[1] ?? '';
}
