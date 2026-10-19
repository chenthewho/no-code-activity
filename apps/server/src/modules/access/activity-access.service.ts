import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ACTIVITY_MEMBER_ROLE, PERMISSION, type ActivityAccess } from '@nca/shared';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { JwtPayload } from '../auth/auth.types';

/** 操作需要的访问级别：看、改、管（成员与删除） */
export type AccessNeed = 'view' | 'edit' | 'manage';

/** 活动列表的数据范围：我负责的 / 我参与的（含负责）/ 全部 */
export type ActivityScope = 'mine' | 'joined' | 'all';

/**
 * 活动数据权限。
 *
 * 功能权限（PermissionsGuard）回答「你能不能编辑活动」，这里回答「你能编辑哪些活动」。
 * 只有前者的话，任何一个运营都能改、能发布、能回滚别人负责的活动——
 * 两层缺一层都是越权。
 */
@Injectable()
export class ActivityAccessService {
  constructor(private readonly prisma: PrismaService) {}

  canSeeAll(user: Pick<JwtPayload, 'permissions'>): boolean {
    const owned = user.permissions ?? [];
    return owned.includes(PERMISSION.ACTIVITY_ALL) || owned.includes(PERMISSION.SYSTEM_MANAGE);
  }

  /** 当前用户对活动的访问级别；活动不存在或无权访问返回 null */
  async resolve(
    user: Pick<JwtPayload, 'sub' | 'permissions'>,
    activityId: string,
  ): Promise<ActivityAccess | null> {
    const activity = await this.prisma.activity.findFirst({
      where: { id: activityId, deletedAt: null },
      select: { ownerId: true, members: { where: { userId: user.sub }, select: { role: true } } },
    });
    if (!activity) return null;
    if (this.canSeeAll(user)) return 'all';
    if (activity.ownerId === user.sub) return 'owner';
    const role = activity.members[0]?.role;
    return role === ACTIVITY_MEMBER_ROLE.EDITOR || role === ACTIVITY_MEMBER_ROLE.VIEWER
      ? role
      : null;
  }

  async assert(
    user: Pick<JwtPayload, 'sub' | 'permissions'>,
    activityId: string,
    need: AccessNeed,
  ): Promise<ActivityAccess> {
    const access = await this.resolve(user, activityId);
    if (!access) {
      // 不存在与无权访问区分开：前者是 404，后者是 403，但都不暴露活动内容
      const exists = await this.prisma.activity.count({
        where: { id: activityId, deletedAt: null },
      });
      if (!exists) throw new NotFoundException('活动不存在');
      throw new ForbiddenException('你不是该活动的负责人或协作成员');
    }
    if (!satisfies(access, need)) {
      throw new ForbiddenException(
        need === 'manage' ? '只有活动负责人可以执行该操作' : '你在该活动中是只读成员，不能修改',
      );
    }
    return access;
  }

  /** 列表的数据范围条件。没有 activity:all 的用户要 all 也只给自己能看到的 */
  scopeWhere(
    user: Pick<JwtPayload, 'sub' | 'permissions'>,
    scope: ActivityScope = 'joined',
  ): Prisma.ActivityWhereInput {
    if (scope === 'mine') return { ownerId: user.sub };
    if (scope === 'all' && this.canSeeAll(user)) return {};
    return { OR: [{ ownerId: user.sub }, { members: { some: { userId: user.sub } } }] };
  }

  /** 列表里每一行的访问级别，一次查完，不在循环里逐个查库 */
  async accessMap(
    user: Pick<JwtPayload, 'sub' | 'permissions'>,
    rows: { id: string; ownerId: string }[],
  ): Promise<Record<string, ActivityAccess>> {
    const seeAll = this.canSeeAll(user);
    const memberships = await this.prisma.activityMember.findMany({
      where: { userId: user.sub, activityId: { in: rows.map((r) => r.id) } },
      select: { activityId: true, role: true },
    });
    const roles = new Map(memberships.map((m) => [m.activityId, m.role as ActivityAccess]));
    // 优先级与 resolve 一致：activity:all 压过一切，否则列表显示「只读」而详情页是「全部」
    const result: Record<string, ActivityAccess> = {};
    for (const row of rows) {
      if (seeAll) result[row.id] = 'all';
      else if (row.ownerId === user.sub) result[row.id] = 'owner';
      else if (roles.has(row.id)) result[row.id] = roles.get(row.id)!;
    }
    return result;
  }
}

export function satisfies(access: ActivityAccess, need: AccessNeed): boolean {
  if (access === 'all' || access === 'owner') return true;
  if (need === 'view') return true;
  if (need === 'edit') return access === ACTIVITY_MEMBER_ROLE.EDITOR;
  return false;
}
