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

describe('AnalyticsService.report', () => {
  it('页面曝光算 PV，组件曝光与点击、转化按节点合并，按点击排序', async () => {
    const prisma = fakePrisma();
    prisma.analyticsEvent.groupBy = vi.fn(async (args: { by: string[] }) =>
      args.by.length === 1
        ? [
            { event: 'expose', _count: { _all: 130 } },
            { event: 'click', _count: { _all: 12 } },
          ]
        : [
            { nodeId: 'ROOT', event: 'expose', _count: { _all: 100 } },
            { nodeId: 'btn', event: 'expose', _count: { _all: 20 } },
            { nodeId: 'btn', event: 'click', _count: { _all: 2 } },
            { nodeId: 'lottery', event: 'expose', _count: { _all: 10 } },
            { nodeId: 'lottery', event: 'click', _count: { _all: 10 } },
            { nodeId: 'lottery', event: 'convert', _count: { _all: 4 } },
          ],
    ) as never;
    prisma.analyticsEvent.count = vi.fn(async (args: { where: Record<string, unknown> }) =>
      'OR' in args.where ? 100 : 136,
    ) as never;

    const report = await buildService(prisma, fakeRedis()).report('act_1');
    expect(report.pageViews).toBe(100);
    expect(report.byNode).toEqual([
      { nodeId: 'lottery', exposures: 10, clicks: 10, converts: 4 },
      { nodeId: 'btn', exposures: 20, clicks: 2, converts: 0 },
    ]);
  });
});
