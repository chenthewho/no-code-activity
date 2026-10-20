import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { grayBucket, matchGray, type GrayRule } from '@nca/shared';
import { RedisService } from '../../common/redis/redis.service';
import { RuntimeService } from '../runtime/runtime.module';
import { PublishService } from './publish.service';

const RULE: GrayRule = { percent: 10, channels: ['qa'], userIds: ['ru_vip', 'guest_tester'] };

describe('灰度规则', () => {
  it('渠道、白名单（登录用户或访客 id）任一命中即看灰度版', () => {
    expect(matchGray(RULE, { channel: 'qa' })).toBe(true);
    expect(matchGray(RULE, { userId: 'ru_vip' })).toBe(true);
    expect(matchGray(RULE, { deviceId: 'guest_tester' })).toBe(true);
    expect(matchGray({ ...RULE, percent: 0 }, { channel: 'wx', deviceId: 'guest_x' })).toBe(false);
  });

  it('按设备分桶：同一设备结果稳定，放量只增不换，比例大致准确', () => {
    const ids = Array.from({ length: 20000 }, (_, i) => `guest_${i.toString(36)}_device`);
    const at10 = ids.filter((id) =>
      matchGray({ ...RULE, channels: [], userIds: [] }, { deviceId: id }),
    );
    const at30 = ids.filter((id) =>
      matchGray({ percent: 30, channels: [], userIds: [] }, { deviceId: id }),
    );
    expect(at10.length / ids.length).toBeGreaterThan(0.08);
    expect(at10.length / ids.length).toBeLessThan(0.12);
    // 从 10% 放到 30%：原来那批人一个都不少
    expect(at10.every((id) => at30.includes(id))).toBe(true);
    expect(grayBucket('same')).toBe(grayBucket('same'));
    expect(matchGray({ percent: 100, channels: [], userIds: [] }, { deviceId: 'any' })).toBe(true);
  });
});

function runtimeSetup(
  gray: Partial<{ grayVersion: number | null; grayRule: GrayRule | null }>,
  auth = {},
) {
  const versions: Record<number, { meta: Record<string, unknown> }> = {
    3: { meta: { activityId: 'a1', title: '旧版' } },
    4: { meta: { activityId: 'a1', title: '新版', auth } },
  };
  const prisma = {
    activity: {
      findFirst: vi.fn(async () => ({
        status: 'published',
        publishedVersion: 3,
        grayVersion: null,
        grayRule: null,
        ...gray,
      })),
    },
    activityVersion: {
      findUnique: vi.fn(
        async ({ where }: { where: { activityId_version: { version: number } } }) => {
          const v = where.activityId_version.version;
          return {
            version: v,
            createdAt: new Date(),
            dslUrl: `/v${v}.json`,
            dsl: {
              schemaVersion: '1.1.0',
              craftJson: { ROOT: { type: { resolvedName: 'Page' }, isCanvas: true, nodes: [] } },
              ...versions[v],
            },
          };
        },
      ),
    },
  };
  return new RuntimeService(prisma as never, { get: () => undefined } as never);
}

describe('C 端按访客选版本', () => {
  it('命中灰度规则的看新版，其余看全量版；不带访客信息一律全量', async () => {
    const service = runtimeSetup({ grayVersion: 4, grayRule: RULE });
    expect((await service.dsl('a1', { channel: 'qa' })).version).toBe(4);
    expect((await service.dsl('a1', { channel: 'qa' })).gray).toBe(true);
    expect((await service.dsl('a1', { channel: 'wx', deviceId: 'guest_tester' })).version).toBe(4);
    const normal = await service.dsl('a1', { channel: 'wx', userId: 'ru_other' });
    expect(normal.version).toBe(3);
    expect(normal.gray).toBe(false);
    expect((await service.dsl('a1')).version).toBe(3);
  });

  it('没有灰度时所有人都看全量版', async () => {
    const service = runtimeSetup({});
    expect((await service.dsl('a1', { channel: 'qa' })).version).toBe(3);
  });

  it('灰度版要求登录、全量版不要求时，按更严的来：访客一律不放行', async () => {
    const service = runtimeSetup({ grayVersion: 4, grayRule: RULE }, { loginMode: 'sso' });
    await expect(service.resolveParticipant('a1', null, 'guest_x')).rejects.toMatchObject({
      response: expect.objectContaining({ reason: 'LOGIN_REQUIRED' }),
    });
  });
});

function publishSetup(activity: Record<string, unknown> | null) {
  const updates: unknown[] = [];
  const prisma = {
    activity: {
      findFirst: vi.fn(async () => activity),
      update: vi.fn(async (args: unknown) => (updates.push(args), args)),
    },
    activityVersion: {
      findUnique: vi.fn(async () => ({ version: 4, dslUrl: '/v4.json', manifestUrl: '/m4.json' })),
    },
    dslDraft: { findUnique: vi.fn(async () => null) },
  };
  const service = new PublishService(
    prisma as never,
    {} as never,
    new RedisService({ get: () => undefined } as never),
    { get: () => 'http://localhost:5180' } as never,
    { record: vi.fn() } as never,
  );
  return { service, updates };
}

describe('灰度发布流程', () => {
  it('没有在线全量版本时不允许灰度发布', async () => {
    const { service } = publishSetup({ id: 'a1', status: 'draft', publishedVersion: null });
    await expect(service.publish('a1', 'u1', '', RULE)).rejects.toThrow(/首次发布请直接全量/);
  });

  it('转全量：全量指针切到灰度版并清空灰度；停止灰度只清空灰度', async () => {
    const graying = {
      id: 'a1',
      status: 'published',
      publishedVersion: 3,
      grayVersion: 4,
      grayRule: RULE,
    };
    const promote = publishSetup(graying);
    const result = await promote.service.promoteGray('a1');
    expect(result.version).toBe(4);
    expect(promote.updates[0]).toMatchObject({ data: { publishedVersion: 4, grayVersion: null } });

    const stop = publishSetup(graying);
    await stop.service.stopGray('a1');
    expect(stop.updates[0]).toMatchObject({ data: { grayVersion: null } });
    expect((stop.updates[0] as { data: Record<string, unknown> }).data).not.toHaveProperty(
      'publishedVersion',
    );
  });

  it('没有进行中的灰度时，转全量 / 停止 / 调整都报错', async () => {
    const { service } = publishSetup({
      id: 'a1',
      status: 'published',
      publishedVersion: 3,
      grayVersion: null,
    });
    await expect(service.promoteGray('a1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.stopGray('a1')).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateGray('a1', RULE)).rejects.toBeInstanceOf(BadRequestException);
  });
});
