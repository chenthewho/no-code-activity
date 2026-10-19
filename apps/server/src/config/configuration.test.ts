import { describe, expect, it } from 'vitest';
import { parseTrustProxy, validateEnv } from './configuration';

const BASE = { DATABASE_URL: 'mysql://x', JWT_SECRET: 'a-very-long-secret-value' };

describe('configuration', () => {
  it('TRUST_PROXY 转成 Express 认的形状', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
  });

  it('布尔开关不把字符串 "false" 当成 true', () => {
    expect(validateEnv({ ...BASE, SSO_ADMIN_ENABLED: 'false' }).SSO_ADMIN_ENABLED).toBe(false);
    expect(validateEnv(BASE).SSO_ADMIN_ENABLED).toBe(true);
  });

  it('生产环境禁止模拟登录', () => {
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'production', SSO_PROVIDER: 'mock' })).toThrow(
      /mock/,
    );
    expect(() => validateEnv({ ...BASE, NODE_ENV: 'production', HOST_AUTH_MODE: 'mock' })).toThrow(
      /mock/,
    );
  });
});
