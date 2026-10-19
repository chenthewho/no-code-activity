import { createHash, createHmac } from 'node:crypto';

/**
 * 腾讯云两套签名：COS 的 XML API 签名（q-sign-algorithm=sha1）与云 API 3.0 的
 * TC3-HMAC-SHA256（STS 换临时密钥用）。
 *
 * 没引 cos-nodejs-sdk-v5 / tencentcloud-sdk：我们只用到「上传一个对象、查一个对象、
 * 换一份临时密钥」，为此拉进两个 SDK 及其一长串依赖不划算。两种算法都是公开且稳定的，
 * 单测里的期望值由官方 SDK 计算得出，算法漂移会立刻红。
 */

/** COS 文档规定的编码：在 encodeURIComponent 基础上再编码 !'()* */
export function cosEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** 可以参与签名的请求头，与官方 SDK 一致：x-cos-* 加上这份清单 */
const SIGNABLE_HEADERS = new Set([
  'content-disposition',
  'content-encoding',
  'content-length',
  'content-md5',
  'expect',
  'expires',
  'host',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'if-unmodified-since',
  'origin',
  'range',
  'transfer-encoding',
]);

function pickSignable(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => {
      const lower = key.toLowerCase();
      return lower.startsWith('x-cos-') || SIGNABLE_HEADERS.has(lower);
    }),
  );
}

/** key 编码后转小写、按字典序排；值编码。返回 [键列表, 键值串] */
function canonical(record: Record<string, string>): [string, string] {
  const entries = Object.entries(record)
    .map(([key, value]) => [cosEncode(key).toLowerCase(), cosEncode(value)] as const)
    .sort(([a], [b]) => (a === b ? 0 : a > b ? 1 : -1));
  return [
    entries.map(([key]) => key).join(';'),
    entries.map(([key, value]) => `${key}=${value}`).join('&'),
  ];
}

export interface CosSignInput {
  secretId: string;
  secretKey: string;
  method: string;
  /** 对象路径，以 / 开头，不做编码（与官方 SDK 一致） */
  pathname: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  /** 签名生效区间（秒级时间戳） */
  startTime: number;
  expireTime: number;
}

/** COS 请求签名，返回 Authorization 头的值 */
export function cosAuthorization(input: CosSignInput): string {
  const keyTime = `${input.startTime};${input.expireTime}`;
  const [headerList, headerString] = canonical(pickSignable(input.headers ?? {}));
  const [paramList, paramString] = canonical(input.query ?? {});

  const signKey = createHmac('sha1', input.secretKey).update(keyTime).digest('hex');
  const formatString = [
    input.method.toLowerCase(),
    input.pathname,
    paramString,
    headerString,
    '',
  ].join('\n');
  const stringToSign = [
    'sha1',
    keyTime,
    createHash('sha1').update(formatString, 'utf8').digest('hex'),
    '',
  ].join('\n');
  const signature = createHmac('sha1', signKey).update(stringToSign).digest('hex');

  return [
    'q-sign-algorithm=sha1',
    `q-ak=${input.secretId}`,
    `q-sign-time=${keyTime}`,
    `q-key-time=${keyTime}`,
    `q-header-list=${headerList}`,
    `q-url-param-list=${paramList}`,
    `q-signature=${signature}`,
  ].join('&');
}

export interface Tc3SignInput {
  secretId: string;
  secretKey: string;
  /** 产品名，如 sts */
  service: string;
  /** 不带端口的主机名，与官方 SDK 一致 */
  host: string;
  /** 已序列化的 JSON 请求体 */
  payload: string;
  timestamp: number;
  contentType?: string;
}

/** 云 API 3.0 签名（POST + JSON），返回 Authorization 头的值 */
export function tc3Authorization(input: Tc3SignInput): string {
  const contentType = input.contentType ?? 'application/json; charset=utf-8';
  const date = new Date(input.timestamp * 1000).toISOString().slice(0, 10);
  const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
  const hmac = (key: string | Buffer, value: string) =>
    createHmac('sha256', key).update(value, 'utf8').digest();

  const signedHeaders = 'content-type;host';
  const canonicalRequest = [
    'POST',
    '/',
    '',
    `content-type:${contentType}\nhost:${input.host}\n`,
    signedHeaders,
    sha256(input.payload),
  ].join('\n');
  const scope = `${date}/${input.service}/tc3_request`;
  const stringToSign = [
    'TC3-HMAC-SHA256',
    String(input.timestamp),
    scope,
    sha256(canonicalRequest),
  ].join('\n');

  const secretSigning = hmac(
    hmac(hmac(`TC3${input.secretKey}`, date), input.service),
    'tc3_request',
  );
  const signature = createHmac('sha256', secretSigning).update(stringToSign, 'utf8').digest('hex');
  return `TC3-HMAC-SHA256 Credential=${input.secretId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}
