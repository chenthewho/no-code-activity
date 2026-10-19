import { describe, expect, it, vi } from 'vitest';
import { ActivityAccessService } from '../access/activity-access.service';
import { ActivityService } from './activity.service';

describe('ActivityService.list 数据范围', () => {
  it('ownerId 筛选只能在数据范围之内收窄，不能把范围覆盖掉', async () => {
    const findMany = vi.fn(async () => []);
    const prisma = {
      activity: { findMany, count: vi.fn(async () => 0) },
      activityMember: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    const service = new ActivityService(
      prisma as never,
      new ActivityAccessService(prisma as never),
    );
    await service.list(
      { page: 1, pageSize: 10, scope: 'mine', ownerId: 'someone_else' },
      { sub: 'me', username: 'me', nickname: 'me', roles: [], permissions: [] },
    );
    const where = (findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0]
      .where;
    expect(where.AND).toEqual([{ ownerId: 'me' }, { ownerId: 'someone_else' }]);
    expect(where.ownerId).toBeUndefined();
  });
});
