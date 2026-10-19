import { describe, expect, it } from 'vitest';
import { cosAuthorization, cosEncode, tc3Authorization } from './tencent-sign';

/**
 * 期望值由官方 SDK 计算：cos-nodejs-sdk-v5@2.14.6 的 util.getAuth 与
 * tencentcloud-sdk-nodejs-common@4.0.900 的 Sign.sign3，输入与下面完全一致。
 * 自己实现签名的前提就是这里永远和官方算出同一个值。
 */
describe('cosAuthorization', () => {
  it('PUT：中文与特殊字符路径、x-cos-* 头参与签名、Content-Type 不参与', () => {
    const auth = cosAuthorization({
      secretId: 'AKIDexample',
      secretKey: 'exampleSecretKey',
      method: 'PUT',
      pathname: '/assets/ab/hash 中文(1)*!.png',
      headers: {
        Host: 'demo-1250000000.cos.ap-guangzhou.myqcloud.com',
        'Content-Type': 'image/png',
        'x-cos-security-token': 'tok/+=',
      },
      query: { 'response-content-type': 'image/png', Prefix: 'a b' },
      startTime: 1700000000,
      expireTime: 1700000900,
    });
    expect(auth).toBe(
      'q-sign-algorithm=sha1&q-ak=AKIDexample&q-sign-time=1700000000;1700000900&q-key-time=1700000000;1700000900' +
        '&q-header-list=host;x-cos-security-token&q-url-param-list=prefix;response-content-type' +
        '&q-signature=48d46cd173f55a22e076f9b1a2a4cee5b2074217',
    );
  });

  it('HEAD：只签 host、无查询参数', () => {
    const auth = cosAuthorization({
      secretId: 'AKIDexample',
      secretKey: 'exampleSecretKey',
      method: 'HEAD',
      pathname: '/assets/ab/x.png',
      headers: { host: 'demo-1250000000.cos.ap-guangzhou.myqcloud.com' },
      startTime: 1700000000,
      expireTime: 1700000600,
    });
    expect(auth).toBe(
      'q-sign-algorithm=sha1&q-ak=AKIDexample&q-sign-time=1700000000;1700000600&q-key-time=1700000000;1700000600' +
        '&q-header-list=host&q-url-param-list=&q-signature=dcd25c9e4938280a78f6f82a73cbc3d35faa3303',
    );
  });

  it("编码规则比 encodeURIComponent 多编码 !'()*", () => {
    expect(cosEncode("a b!'()*")).toBe('a%20b%21%27%28%29%2A');
  });
});

describe('tc3Authorization', () => {
  it('与官方 SDK 的 sign3 结果一致', () => {
    const payload = JSON.stringify({
      Name: 'nca-upload',
      Policy: encodeURIComponent('{"version":"2.0"}'),
      DurationSeconds: 900,
    });
    expect(
      tc3Authorization({
        secretId: 'AKIDexample',
        secretKey: 'exampleSecretKey',
        service: 'sts',
        host: 'sts.tencentcloudapi.com',
        payload,
        timestamp: 1700000000,
      }),
    ).toBe(
      'TC3-HMAC-SHA256 Credential=AKIDexample/2023-11-14/sts/tc3_request, SignedHeaders=content-type;host, ' +
        'Signature=0b6050a7a3186949ec14fe5aa9bb3ed8c02ef8b83fe188a4644aa5213b69cd54',
    );
  });
});
