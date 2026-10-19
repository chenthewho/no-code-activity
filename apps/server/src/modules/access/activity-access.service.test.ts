import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PERMISSION, type Permission } from '@nca/shared';
import { ActivityAccessService, satisfies } from './activity-access.service';

const ACTIVITY = { id: 'a1', ownerId: 'owner' };
const MEMBERS = [
  { activityId: 'a1', userId: 'ed', role: 'editor' },
  { activityId: 'a1', userId: 'vw', role: 'viewer' },
];

function setup() {
  const prisma = {
    activity: {
      findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === ACTIVITY.id
          ? {
              ownerId: ACTIVITY.ownerId,
              members: MEMBERS.filter((m) => m.userId === currentUser).map((m) => ({
                role: m.role,
              })),
            }
          : null,
      ),
      count: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === ACTIVITY.id ? 1 : 0,
      ),
    },
    activityMember: {
      findMany: vi.fn(async ({ where }: { where: { userId: string } }) =>
        MEMBERS.filter((m) => m.userId === where.userId),
      ),
    },
  };
  let currentUser = '';
  const service = new ActivityAccessService(prisma as never);
  const as = (sub: string, permissions: Permission[] = []) => {
    currentUser = sub;
    return { sub, permissions };
  };
  return { service, as };
}

describe('ActivityAccessService', () => {
  it('负责人 / 编辑成员 / 只读成员 / activity:all / 无关的人', async () => {
    const { service, as } = setup();
    expect(await service.resolve(as('owner'), 'a1')).toBe('owner');
    expect(await service.resolve(as('ed'), 'a1')).toBe('editor');
    expect(await service.resolve(as('vw'), 'a1')).toBe('viewer');
    expect(await service.resolve(as('lead', [PERMISSION.ACTIVITY_ALL]), 'a1')).toBe('all');
    expect(await service.resolve(as('root', [PERMISSION.SYSTEM_MANAGE]), 'a1')).toBe('all');
    expect(await service.resolve(as('stranger'), 'a1')).toBeNull();
  });

  it('只读成员不能改，编辑成员不能管成员，无关的人 403，活动不存在 404', async () => {
    const { service, as } = setup();
    await expect(service.assert(as('vw'), 'a1', 'view')).resolves.toBe('viewer');
    await expect(service.assert(as('vw'), 'a1', 'edit')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.assert(as('ed'), 'a1', 'edit')).resolves.toBe('editor');
    await expect(service.assert(as('ed'), 'a1', 'manage')).rejects.toThrow(/只有活动负责人/);
    await expect(service.assert(as('owner'), 'a1', 'manage')).resolves.toBe('owner');
    await expect(service.assert(as('stranger'), 'a1', 'view')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.assert(as('owner'), 'nope', 'view')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('列表范围：没有 activity:all 时要「全部」也只给自己能看到的', () => {
    const { service } = setup();
    const mine = { sub: 'u1', permissions: [] };
    expect(service.scopeWhere(mine, 'mine')).toEqual({ ownerId: 'u1' });
    const joined = { OR: [{ ownerId: 'u1' }, { members: { some: { userId: 'u1' } } }] };
    expect(service.scopeWhere(mine, 'joined')).toEqual(joined);
    expect(service.scopeWhere(mine, 'all')).toEqual(joined);
    expect(
      service.scopeWhere({ sub: 'u1', permissions: [PERMISSION.ACTIVITY_ALL] }, 'all'),
    ).toEqual({});
  });

  it('列表逐行访问级别一次查完', async () => {
    const { service, as } = setup();
    const map = await service.accessMap(as('ed', [PERMISSION.ACTIVITY_ALL]), [
      { id: 'a1', ownerId: 'owner' },
      { id: 'a2', ownerId: 'ed' },
      { id: 'a3', ownerId: 'other' },
    ]);
    expect(map).toEqual({ a1: 'editor', a2: 'owner', a3: 'all' });
  });

  it('satisfies 规则表', () => {
    expect(satisfies('viewer', 'view')).toBe(true);
    expect(satisfies('viewer', 'edit')).toBe(false);
    expect(satisfies('editor', 'manage')).toBe(false);
    expect(satisfies('all', 'manage')).toBe(true);
  });
});
