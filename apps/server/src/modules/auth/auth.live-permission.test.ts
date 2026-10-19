import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { RedisService } from '../../common/redis/redis.service';
import { AuthService } from './auth.service';

function user(permissions: string[], enabled = true) {
  return {
    id: 'u1',
    username: 'u1',
    nickname: 'U1',
    enabled,
    roles: [
      { role: { code: 'r', permissions: permissions.map((code) => ({ permission: { code } })) } },
    ],
  };
}

function setup() {
  let row = user(['activity:view']);
  const prisma = { user: { findUnique: vi.fn(async () => row) } };
  const redis = new RedisService({ get: () => undefined } as never);
  const service = new AuthService(
    prisma as never,
    {} as never,
    { get: () => undefined } as never,
    {} as never,
    redis,
  );
  return { service, prisma, setRow: (next: ReturnType<typeof user>) => (row = next) };
}

describe('AuthService.livePayload', () => {
  it('权限以数据库为准并短时缓存；作废后立即读到新权限', async () => {
    const { service, prisma, setRow } = setup();
    expect((await service.livePayload('u1')).permissions).toEqual(['activity:view']);

    setRow(user(['activity:view', 'activity:edit']));
    // 缓存期内仍是旧值，不必每个请求都查库
    expect((await service.livePayload('u1')).permissions).toEqual(['activity:view']);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);

    await service.invalidatePermissions();
    expect((await service.livePayload('u1')).permissions).toEqual([
      'activity:view',
      'activity:edit',
    ]);
  });

  it('账号被停用后，手里的 token 立刻失效', async () => {
    const { service, setRow } = setup();
    setRow(user(['activity:view'], false));
    await expect(service.livePayload('u1')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
