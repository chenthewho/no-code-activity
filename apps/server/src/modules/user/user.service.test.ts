import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PERMISSION, type Permission } from '@nca/shared';
import { UserService } from './user.service';

interface RoleRow {
  id: string;
  code: string;
  permissions: string[];
  users: number;
}

const ROLES: RoleRow[] = [
  { id: 'r_admin', code: 'admin', permissions: [PERMISSION.SYSTEM_MANAGE], users: 1 },
  {
    id: 'r_op',
    code: 'operator',
    permissions: [PERMISSION.ACTIVITY_VIEW, PERMISSION.ACTIVITY_EDIT],
    users: 2,
  },
  { id: 'r_empty', code: 'empty', permissions: [], users: 0 },
];
const ALL_PERMISSIONS = [
  PERMISSION.SYSTEM_MANAGE,
  PERMISSION.ACTIVITY_VIEW,
  PERMISSION.ACTIVITY_EDIT,
  PERMISSION.USER_MANAGE,
];

function setup(targetPermissions: Permission[] = []) {
  const withPerms = (r: RoleRow) => ({
    ...r,
    permissions: r.permissions.map((code) => ({ permission: { code } })),
    _count: { users: r.users },
  });
  const tx = {
    user: { update: vi.fn() },
    userRole: { deleteMany: vi.fn(), createMany: vi.fn() },
    role: { update: vi.fn() },
    rolePermission: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  const prisma = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; username?: string } }) =>
        where.username === 'taken'
          ? { id: 'x' }
          : where.id
            ? { id: where.id, enabled: true }
            : null,
      ),
      create: vi.fn(async () => ({ id: 'new_user' })),
    },
    role: {
      findMany: vi.fn(async ({ where }: { where: { code: { in: string[] } } }) =>
        ROLES.filter((r) => where.code.in.includes(r.code)).map(withPerms),
      ),
      findUnique: vi.fn(async ({ where }: { where: { id?: string; code?: string } }) => {
        const role = ROLES.find((r) => r.id === where.id || r.code === where.code);
        return role ? withPerms(role) : null;
      }),
      delete: vi.fn(),
    },
    permission: {
      findMany: vi.fn(async ({ where }: { where: { code: { in: string[] } } }) =>
        ALL_PERMISSIONS.filter((c) => where.code.in.includes(c)).map((code) => ({
          id: `p_${code}`,
          code,
        })),
      ),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
  };
  const auth = {
    invalidatePermissions: vi.fn(async () => undefined),
    livePayload: vi.fn(async (id: string) => ({ sub: id, permissions: targetPermissions })),
  };
  return { service: new UserService(prisma as never, auth as never), prisma, auth, tx };
}

const manager = {
  sub: 'm',
  username: 'm',
  nickname: 'm',
  roles: [],
  permissions: [
    PERMISSION.USER_MANAGE,
    PERMISSION.ACTIVITY_VIEW,
    PERMISSION.ACTIVITY_EDIT,
  ] as Permission[],
};
const root = { ...manager, sub: 'root', permissions: [PERMISSION.SYSTEM_MANAGE] as Permission[] };

describe('UserService 防提权', () => {
  it('只有 user:manage 的人不能给别人（或自己建的号）分 admin 角色', async () => {
    const { service } = setup();
    await expect(
      service.create(
        { username: 'u', nickname: 'u', password: '12345678', roleCodes: ['admin'] },
        manager,
      ),
    ).rejects.toThrow(/system:manage/);
    await expect(
      service.create(
        { username: 'u', nickname: 'u', password: '12345678', roleCodes: ['operator'] },
        manager,
      ),
    ).resolves.toEqual({ id: 'new_user' });
    await expect(
      service.create(
        { username: 'u', nickname: 'u', password: '12345678', roleCodes: ['admin'] },
        root,
      ),
    ).resolves.toEqual({ id: 'new_user' });
  });

  it('不能给角色加自己没有的权限，也不能从角色上收走自己没有的权限', async () => {
    const { service } = setup();
    await expect(
      service.updateRole(
        'r_op',
        { permissions: [PERMISSION.ACTIVITY_VIEW, PERMISSION.SYSTEM_MANAGE] },
        manager,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.updateRole('r_op', { permissions: [PERMISSION.ACTIVITY_VIEW] }, manager),
    ).resolves.toBe(undefined);
  });

  it('不能改比自己权限大的人的角色或密码', async () => {
    const { service } = setup([PERMISSION.SYSTEM_MANAGE]);
    await expect(
      service.update('boss', { roleCodes: ['operator'] }, manager),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.resetPassword('boss', 'newpassword', manager)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('不能停用自己或改自己的角色', async () => {
    const { service } = setup();
    await expect(service.update('root', { enabled: false }, root)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.update('root', { roleCodes: [] }, root)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('角色授权或启停变化后，全员权限缓存作废', async () => {
    const { service, auth } = setup();
    await service.update('u2', { roleCodes: ['operator'] }, manager);
    await service.update('u2', { enabled: false }, manager);
    await service.update('u2', { nickname: '新昵称' }, manager);
    expect(auth.invalidatePermissions).toHaveBeenCalledTimes(2);
  });

  it('admin 角色不能改授权、不能删；还有人用的角色不能删', async () => {
    const { service } = setup();
    await expect(service.updateRole('r_admin', { permissions: [] }, root)).rejects.toThrow(
      /恒有全部权限/,
    );
    await expect(service.removeRole('r_admin')).rejects.toThrow(/不能删除/);
    await expect(service.removeRole('r_op')).rejects.toThrow(/仍有 2 个用户/);
    await expect(service.removeRole('r_empty')).resolves.toBeUndefined();
  });

  it('未知角色、未知权限码直接拒绝', async () => {
    const { service } = setup();
    await expect(
      service.create(
        { username: 'u', nickname: 'u', password: '12345678', roleCodes: ['ghost'] },
        root,
      ),
    ).rejects.toThrow(/未知角色/);
    await expect(
      service.createRole({ code: 'r', name: 'r', permissions: ['nope:x'] }, root),
    ).rejects.toThrow(/未知权限码/);
  });
});
