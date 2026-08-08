import { describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from './analytics.service';

function fakePrisma() {
  return {
    analyticsEvent: {
      createMany: vi.fn(async () => ({ count: 0 })),
      groupBy: vi.fn(async () => []),
      count: vi.fn(async () => 0),
    },
    $queryRaw: vi.fn(async () => []),
  };
}

function fakeRedis(overrides: Record<string, unknown> = {}) {
  return { enabled: true, incrWithExpire: vi.fn(async () => 1), ...overrides };
}

function buildService(prisma: unknown, redis: unknown) {
  return new AnalyticsService(prisma as never, redis as never);
}

describe('AnalyticsService.ingest', () => {
  it('批量事件落库并识别宿主', async () => {
    const prisma = fakePrisma();
    const service = buildService(prisma, fakeRedis());
    await service.ingest(
      {
        activityId: 'act_1',
        events: [
          { event: 'expose', nodeId: 'ROOT' },
          { event: 'click', nodeId: 'btn_1', props: { text: '抽奖' } },
        ],
      },
      '1.2.3.4',
      'Mozilla/5.0 MicroMessenger iPhone',
    );
    expect(prisma.analyticsEvent.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ activityId: 'act_1', nodeId: 'ROOT', event: 'expose', host: 'wechat' }),
        expect.objectContaining({
          activityId: 'act_1',
          nodeId: 'btn_1',
          event: 'click',
          host: 'wechat',
          props: { text: '抽奖' },
        }),
      ],
    });
  });
});

describe('AnalyticsService.allow', () => {
  it('未超限放行', async () => {
    const redis = fakeRedis();
    const service = buildService(fakePrisma(), redis);
    await expect(service.allow('1.2.3.4')).resolves.toBe(true);
    expect(redis.incrWithExpire).toHaveBeenCalledWith('nca:analytics:1.2.3.4', expect.any(Number));
  });

  it('超过每分钟上限拒绝', async () => {
    const redis = fakeRedis({ incrWithExpire: vi.fn(async () => 601) });
    const service = buildService(fakePrisma(), redis);
    await expect(service.allow('1.2.3.4')).resolves.toBe(false);
  });
});
