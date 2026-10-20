import { describe, expect, it, vi } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import { PrizeService } from './prize.service';

/**
 * 用假 RedisService / PrismaService 验证 PrizeService 的编排逻辑。
 * Lua 的并发扣减语义由 Redis 执行，这里用 mock eval 按契约返回 {won, prizeId}，
 * 断言的是 JS 侧的正确性：候选过滤（库存/限次）、结果映射、落库、限流、降级路径。
 */

interface PrizeRow {
  id: string;
  activityId: string;
  name: string;
  image: string | null;
  probability: number;
  total: number;
  remaining: number;
  limitPerUser: number;
  sort: number;
}

function fakeRedis(overrides: Record<string, unknown> = {}) {
  const store = new Map<string, string>();
  return {
    enabled: true,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => void store.set(key, value)),
    del: vi.fn(async (key: string) => void store.delete(key)),
    eval: vi.fn(async () => [0, '']),
    incrWithExpire: vi.fn(async () => 1),
    withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
    // 测试里手动塞库存：remaining key 形如 nca:prize:{id}:remaining
    seedRemaining: (id: string, remaining: number) => store.set(`nca:prize:${id}:remaining`, String(remaining)),
    ...overrides,
  };
}

function fakePrisma(rows: PrizeRow[]) {
  const wonRecords: { prizeId: string; userId: string }[] = [];
  return {
    prize: {
      findMany: vi.fn(async ({ where }: { where: { activityId?: string } }) =>
        rows.filter((r) => !where.activityId || r.activityId === where.activityId),
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null),
      create: vi.fn(async ({ data }: { data: Partial<PrizeRow> }) => ({ ...data, id: 'p_new' })),
      update: vi.fn(async ({ data }: { data: Partial<PrizeRow> }) => ({ ...data, id: 'p_upd' })),
      updateMany: vi.fn(async ({ where, data }: { where: { id?: string }; data: { remaining?: { decrement: number } } }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row || row.remaining <= 0) return { count: 0 };
        row.remaining -= data.remaining?.decrement ?? 1;
        return { count: 1 };
      }),
      delete: vi.fn(async () => undefined),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    prizeRecord: {
      findMany: vi.fn(async ({ where }: { where: { prizeId?: string; userId?: string; status?: string } }) =>
        wonRecords.filter(
          (r) =>
            (!where.prizeId || r.prizeId === where.prizeId) &&
            (!where.userId || r.userId === where.userId),
        ),
      ),
      create: vi.fn(async (args: unknown) => {
        wonRecords.push((args as { data: { prizeId: string; userId: string } }).data);
        return { id: 'rec' };
      }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (args: unknown[]) => args),
  };
}

const ACTIVITY = 'act_1';

function prizesFixture(): PrizeRow[] {
  return [
    { id: 'p1', activityId: ACTIVITY, name: '一等奖', image: null, probability: 1000, total: 10, remaining: 10, limitPerUser: 1, sort: 0 },
    { id: 'p2', activityId: ACTIVITY, name: '二等奖', image: null, probability: 2000, total: 20, remaining: 20, limitPerUser: 0, sort: 1 },
    { id: 'p3', activityId: ACTIVITY, name: '谢谢参与', image: null, probability: 3000, total: 100, remaining: 100, limitPerUser: 0, sort: 2 },
  ];
}

function buildService(redis: ReturnType<typeof fakeRedis>, prisma: ReturnType<typeof fakePrisma>) {
  return new PrizeService(prisma as never, redis as never);
}

describe('PrizeService.draw', () => {
  it('Lua 选中某个奖品时返回对应 index 并落中奖记录', async () => {
    const redis = fakeRedis();
    const rows = prizesFixture();
    for (const p of rows) redis.seedRemaining(p.id, p.remaining);
    // mock eval 模拟 Lua 选中 p2
    redis.eval.mockResolvedValue([1, 'p2']);
    const prisma = fakePrisma(rows);
    const service = buildService(redis, prisma);

    const result = await service.draw(ACTIVITY, 'u1');

    expect(result.won).toBe(true);
    expect(result.index).toBe(1); // p2 在排序列表中下标 1
    expect(result.prize?.name).toBe('二等奖');
    // 落库一次中奖记录
    expect(prisma.prizeRecord.create).toHaveBeenCalledWith({
      data: { activityId: ACTIVITY, prizeId: 'p2', userId: 'u1', status: 'won' },
    });
  });

  it('Lua 未选中（roll 落入未中区间）时返回 won=false', async () => {
    const redis = fakeRedis();
    const rows = prizesFixture();
    for (const p of rows) redis.seedRemaining(p.id, p.remaining);
    redis.eval.mockResolvedValue([0, '']);
    const prisma = fakePrisma(rows);
    const service = buildService(redis, prisma);

    const result = await service.draw(ACTIVITY, 'u1');

    expect(result.won).toBe(false);
    expect(result.index).toBe(-1);
    expect(prisma.prizeRecord.create).not.toHaveBeenCalled();
  });

  it('库存售罄的奖品不进入候选，不会被选中', async () => {
    const redis = fakeRedis();
    const rows = prizesFixture();
    // p1 售罄，其余有库存
    redis.seedRemaining('p1', 0);
    redis.seedRemaining('p2', 20);
    redis.seedRemaining('p3', 100);
    redis.eval.mockResolvedValue([1, 'p2']);
    const prisma = fakePrisma(rows);
    const service = buildService(redis, prisma);

    const result = await service.draw(ACTIVITY, 'u1');

    // Lua 的 keys/args 只含 p2、p3（p1 被过滤掉）
    const evalArgs = redis.eval.mock.calls[0][2] as (string | number)[];
    expect(evalArgs.join(' ')).not.toContain('p1');
    expect(result.won).toBe(true);
  });

  it('超过单用户限次的奖品被前置过滤', async () => {
    const redis = fakeRedis();
    const rows = prizesFixture();
    for (const p of rows) redis.seedRemaining(p.id, p.remaining);
    const prisma = fakePrisma(rows);
    // u1 已中过 p1（limitPerUser=1），p1 应从候选剔除
    prisma.prizeRecord.findMany.mockResolvedValue([{ prizeId: 'p1', userId: 'u1' }] as never);
    redis.eval.mockResolvedValue([1, 'p2']);
    const service = buildService(redis, prisma);

    const result = await service.draw(ACTIVITY, 'u1');

    const evalArgs = redis.eval.mock.calls[0][2] as (string | number)[];
    expect(evalArgs.join(' ')).not.toContain('p1');
    expect(result.won).toBe(true);
  });

  it('超过每日抽奖上限时抛 429，不消耗库存', async () => {
    const redis = fakeRedis();
    const rows = prizesFixture();
    for (const p of rows) redis.seedRemaining(p.id, p.remaining);
    redis.incrWithExpire.mockResolvedValue(101); // > 100 上限
    const prisma = fakePrisma(rows);
    const service = buildService(redis, prisma);

    await expect(service.draw(ACTIVITY, 'u1')).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(prisma.prizeRecord.create).not.toHaveBeenCalled();
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('无 Redis 时走进程内降级：withLock + updateMany 原子扣减', async () => {
    const redis = fakeRedis({ enabled: false });
    // 概率之和 = 10000，无论 roll 落在哪都必中，测试不依赖随机数
    const rows: PrizeRow[] = [
      { id: 'p1', activityId: ACTIVITY, name: '一等奖', image: null, probability: 4000, total: 10, remaining: 10, limitPerUser: 0, sort: 0 },
      { id: 'p2', activityId: ACTIVITY, name: '二等奖', image: null, probability: 3000, total: 20, remaining: 20, limitPerUser: 0, sort: 1 },
      { id: 'p3', activityId: ACTIVITY, name: '三等奖', image: null, probability: 3000, total: 30, remaining: 30, limitPerUser: 0, sort: 2 },
    ];
    const prisma = fakePrisma(rows);
    const service = buildService(redis, prisma);

    const result = await service.draw(ACTIVITY, 'u1');

    expect(result.won).toBe(true);
    expect(prisma.prize.updateMany).toHaveBeenCalled();
    expect(prisma.prizeRecord.create).toHaveBeenCalled();
  });

  it('没有奖品时返回 won=false', async () => {
    const redis = fakeRedis();
    const prisma = fakePrisma([]);
    const service = buildService(redis, prisma);
    const result = await service.draw(ACTIVITY, 'u1');
    expect(result.won).toBe(false);
  });
});

describe('PrizeService.publicList', () => {
  it('只暴露 id/name/image，不暴露概率与库存', async () => {
    const redis = fakeRedis();
    const prisma = fakePrisma(prizesFixture());
    const service = buildService(redis, prisma);
    const list = await service.publicList(ACTIVITY);
    expect(list).toHaveLength(3);
    expect(list[0]).toEqual({ index: 0, id: 'p1', name: '一等奖', image: undefined });
    expect(Object.keys(list[0]).sort()).toEqual(['id', 'image', 'index', 'name']);
  });
});
