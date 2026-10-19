import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { RuntimeService } from './runtime.module';

function setup(auth: Record<string, unknown> | undefined) {
  const prisma = {
    activity: {
      findFirst: vi.fn(async () => ({ status: 'published', publishedVersion: 1 })),
    },
    activityVersion: {
      findUnique: vi.fn(async () => ({ version: 1, dsl: { meta: { activityId: 'a1', auth } } })),
    },
  };
  return {
    service: new RuntimeService(prisma as never, { get: () => undefined } as never),
    prisma,
  };
}

describe('RuntimeService.resolveParticipant', () => {
  it('登录用户一律以 token 为准，忽略 body 里自报的 userId', async () => {
    const { service } = setup({ loginMode: 'sso' });
    await expect(
      service.resolveParticipant('a1', { sub: 'ru_1', provider: 'sso' }, 'guest_x'),
    ).resolves.toBe('ru_1');
  });

  it('活动配置了登录方式时拒绝访客，并给出 LOGIN_REQUIRED 原因码', async () => {
    const { service } = setup({ loginMode: 'sso' });
    const error = await service.resolveParticipant('a1', null, 'guest_x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getResponse()).toMatchObject({
      reason: 'LOGIN_REQUIRED',
    });
  });

  it('「进页面即要求登录」同样拒绝访客', async () => {
    const { service } = setup({ required: true, loginMode: 'none' });
    await expect(service.resolveParticipant('a1', null, 'guest_x')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('不要求登录的活动接受访客标识，但必须带一个', async () => {
    const { service } = setup(undefined);
    await expect(service.resolveParticipant('a1', null, 'guest_x')).resolves.toBe('guest_x');
    await expect(service.resolveParticipant('a1', null, undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('登录策略按活动缓存，连续请求只查一次库', async () => {
    const { service, prisma } = setup(undefined);
    await service.resolveParticipant('a1', null, 'g1');
    await service.resolveParticipant('a1', null, 'g2');
    expect(prisma.activityVersion.findUnique).toHaveBeenCalledTimes(1);
  });
});
