import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../../common/redis/redis.service';
import { SsoService } from '../sso/sso.service';
import { RuntimeAuthService } from './runtime-auth.service';
import { parseMockCode } from './host-auth';

interface Row {
  id: string;
  provider: string;
  externalId: string;
  nickname: string | null;
  avatar: string | null;
}

function fakePrisma() {
  const rows: Row[] = [];
  return {
    rows,
    runtimeUser: {
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { provider_externalId: { provider: string; externalId: string } };
          create: Omit<Row, 'id'>;
          update: Partial<Row>;
        }) => {
          const key = where.provider_externalId;
          const existing = rows.find(
            (r) => r.provider === key.provider && r.externalId === key.externalId,
          );
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const row = { id: `ru_${rows.length + 1}`, ...create } as Row;
          rows.push(row);
          return row;
        },
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
      ),
    },
  };
}

function setup(env: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    JWT_SECRET: 'admin-secret-0123456789',
    ACTIVITY_BASE_URL: 'http://localhost:5180',
    PUBLIC_API_BASE_URL: 'http://localhost:3100/api/v1',
    SSO_PROVIDER: 'mock',
    HOST_AUTH_MODE: 'mock',
    RUNTIME_JWT_EXPIRES_IN: '1d',
    ...env,
  };
  const config = {
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (values[key] === undefined) throw new Error(`missing ${key}`);
      return values[key];
    },
  };
  const redis = new RedisService(config as never);
  const sso = new SsoService(config as never, redis);
  const prisma = fakePrisma();
  const jwt = new JwtService({});
  const service = new RuntimeAuthService(prisma as never, jwt, config as never, redis, sso);
  service.onModuleInit();
  return { service, sso, redis, prisma, jwt };
}

describe('RuntimeAuthService', () => {
  it('SSO 只允许跳回白名单源，防开放重定向', async () => {
    const { service } = setup();
    await expect(service.beginSso('https://evil.example/act/1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.beginSso(undefined)).rejects.toBeInstanceOf(BadRequestException);
    const url = new URL(await service.beginSso('http://localhost:5180/act/a1?ch=wx'));
    expect(url.pathname).toBe('/api/v1/sso-mock/authorize');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('IdP 回调后建号，并把一次性票据挂到跳回地址上；票据只能换一次', async () => {
    const { service, sso, prisma } = setup();
    // 绕过真实 IdP：直接驱动注册进 SsoService 的回调处理器
    const completion = (
      sso as unknown as { completions: Map<string, (p: unknown, r: string) => Promise<string>> }
    ).completions.get('runtime')!;
    const target = new URL(
      await completion(
        { id: 'alice', nickname: 'Alice' },
        'http://localhost:5180/act/a1?ch=wx#top',
      ),
    );
    expect(target.searchParams.get('ch')).toBe('wx');
    expect(target.hash).toBe('#top');
    const ticket = target.searchParams.get('nca_ticket')!;
    expect(ticket).toBeTruthy();
    expect(prisma.rows[0]).toMatchObject({
      provider: 'sso',
      externalId: 'alice',
      nickname: 'Alice',
    });

    const result = await service.exchange(ticket);
    expect(result.user).toEqual({ id: 'ru_1', provider: 'sso', nickname: 'Alice' });
    await expect(service.exchange(ticket)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('C 端 token 能被自己验过，后台密钥签的 token 不行', async () => {
    const { service, jwt } = setup();
    const { token } = await service.hostLogin('sdk_portrait', 'mock:p1:玩家');
    const payload = await service.fromAuthorization(`Bearer ${token}`);
    expect(payload).toMatchObject({ sub: 'ru_1', provider: 'sdk_portrait', nickname: '玩家' });

    const adminToken = await jwt.signAsync({ sub: 'admin' }, { secret: 'admin-secret-0123456789' });
    expect(await service.fromAuthorization(`Bearer ${adminToken}`)).toBeNull();
    expect(await service.fromAuthorization(undefined)).toBeNull();
  });

  it('同一宿主同一账号重复登录复用同一个用户', async () => {
    const { service, prisma } = setup();
    await service.hostLogin('game_center', 'mock:g1');
    await service.hostLogin('game_center', 'mock:g1:新昵称');
    await service.hostLogin('sdk_portrait', 'mock:g1');
    expect(prisma.rows).toHaveLength(2);
    expect(prisma.rows[0]!.nickname).toBe('新昵称');
  });

  it('宿主登录没开启时拒绝；mock code 格式不对时拒绝', async () => {
    const off = setup({ HOST_AUTH_MODE: 'none' });
    await expect(off.service.hostLogin('sdk_portrait', 'mock:p1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const on = setup();
    await expect(on.service.hostLogin('sdk_portrait', 'forged')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('小程序换的是票据而不是 token', async () => {
    const { service } = setup();
    const { ticket, expiresIn } = await service.wechatMpTicket('mock:openid_1');
    expect(expiresIn).toBe(60);
    const result = await service.exchange(ticket);
    expect(result.user.provider).toBe('wechat_mp');
  });

  it('换票按 IP 限流', async () => {
    const { service } = setup();
    for (let i = 0; i < 60; i++) {
      await service.exchange('nope', '1.2.3.4').catch(() => undefined);
    }
    await expect(service.exchange('nope', '1.2.3.4')).rejects.toThrow(/过于频繁/);
  });

  it('token 指向的用户已不存在时 me 报未登录', async () => {
    const { service } = setup();
    await expect(service.me({ sub: 'ghost', provider: 'sso' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

describe('parseMockCode', () => {
  it('解析 mock:<id>[:<昵称>]', () => {
    expect(parseMockCode('mock:u1')).toEqual({ externalId: 'u1', nickname: undefined });
    expect(parseMockCode('mock:u1:小王')).toEqual({ externalId: 'u1', nickname: '小王' });
    expect(parseMockCode('u1')).toBeNull();
  });
});
