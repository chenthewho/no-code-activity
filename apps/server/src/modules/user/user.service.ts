import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PERMISSION, type PageResult, type Permission } from '@nca/shared';
import type { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import type { JwtPayload } from '../auth/auth.types';
import type {
  CreateRoleDto,
  CreateUserDto,
  ListUserDto,
  UpdateRoleDto,
  UpdateUserDto,
} from './user.dto';

/** 内置超级管理员角色：权限恒为全集，不能删、不能改授权 */
export const ADMIN_ROLE = 'admin';

export interface UserItem {
  id: string;
  username: string;
  nickname: string;
  email?: string;
  enabled: boolean;
  /** 通过 SSO 开户、没有本地密码 */
  sso: boolean;
  roles: { code: string; name: string }[];
  createdAt: string;
}

export interface RoleItem {
  id: string;
  code: string;
  name: string;
  remark?: string;
  permissions: string[];
  userCount: number;
  builtin: boolean;
}

/**
 * 用户、角色与授权。
 *
 * 防提权的核心规则：**只能授予自己拥有的权限**（system:manage 例外）。否则一个只有
 * user:manage 的人给自己分一个 admin 角色，就成了超级管理员。
 */
@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async list(query: ListUserDto): Promise<PageResult<UserItem>> {
    const where: Prisma.UserWhereInput = query.keyword
      ? {
          OR: [
            { username: { contains: query.keyword } },
            { nickname: { contains: query.keyword } },
          ],
        }
      : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { roles: { include: { role: { select: { code: true, name: true } } } } },
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      list: rows.map((u) => ({
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        email: u.email ?? undefined,
        enabled: u.enabled,
        sso: Boolean(u.ssoId),
        roles: u.roles.map((r) => r.role),
        createdAt: u.createdAt.toISOString(),
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** 拉协作成员用的轻量搜索：只回启用中的用户，最多 20 个 */
  async lookup(keyword: string) {
    return this.prisma.user.findMany({
      where: {
        enabled: true,
        ...(keyword
          ? { OR: [{ username: { contains: keyword } }, { nickname: { contains: keyword } }] }
          : {}),
      },
      select: { id: true, username: true, nickname: true },
      orderBy: { username: 'asc' },
      take: 20,
    });
  }

  async create(dto: CreateUserDto, actor: JwtPayload) {
    const roleIds = await this.grantableRoleIds(dto.roleCodes, actor);
    const taken = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (taken) throw new BadRequestException('用户名已存在');

    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        nickname: dto.nickname,
        email: dto.email ?? null,
        password: await argon2.hash(dto.password),
        roles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
    });
    return { id: user.id };
  }

  async update(id: string, dto: UpdateUserDto, actor: JwtPayload) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');
    // 自己把自己停用或改掉角色，结果往往是没人能把它改回来
    if (id === actor.sub && (dto.enabled === false || dto.roleCodes !== undefined)) {
      throw new BadRequestException('不能停用自己，也不能修改自己的角色');
    }

    // 改别人的任何东西（启停、角色、资料）都要求他现有的权限你都有：
    // 只校验改角色的话，停用管理员 → 重置密码 → 再启用，就能接管超级管理员
    if (id !== actor.sub) await this.assertCanRevoke(id, actor);
    const roleIds = dto.roleCodes ? await this.grantableRoleIds(dto.roleCodes, actor) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { nickname: dto.nickname, email: dto.email, enabled: dto.enabled },
      });
      if (roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })) });
      }
    });
    if (roleIds || dto.enabled !== undefined) await this.auth.invalidatePermissions();
  }

  async resetPassword(id: string, password: string, actor: JwtPayload) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');
    // 改一个比自己权限大的人的密码，等于直接接管他的账号
    await this.assertCanRevoke(id, actor);
    await this.prisma.user.update({
      where: { id },
      data: { password: await argon2.hash(password) },
    });
  }

  // ── 角色 ────────────────────────────────────────────────

  async roles(): Promise<RoleItem[]> {
    const rows = await this.prisma.role.findMany({
      orderBy: { createdAt: 'asc' },
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      remark: r.remark ?? undefined,
      permissions: r.permissions.map((p) => p.permission.code),
      userCount: r._count.users,
      builtin: r.code === ADMIN_ROLE,
    }));
  }

  async permissions() {
    return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] });
  }

  async createRole(dto: CreateRoleDto, actor: JwtPayload) {
    if (await this.prisma.role.findUnique({ where: { code: dto.code } })) {
      throw new BadRequestException('角色编码已存在');
    }
    const permissionIds = await this.grantablePermissionIds(dto.permissions, actor);
    const role = await this.prisma.role.create({
      data: {
        code: dto.code,
        name: dto.name,
        remark: dto.remark ?? null,
        permissions: { create: permissionIds.map((permissionId) => ({ permissionId })) },
      },
    });
    return { id: role.id };
  }

  async updateRole(id: string, dto: UpdateRoleDto, actor: JwtPayload) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundException('角色不存在');
    if (role.code === ADMIN_ROLE && dto.permissions) {
      throw new BadRequestException('超级管理员角色恒有全部权限，不能修改授权');
    }

    let permissionIds: string[] | null = null;
    if (dto.permissions) {
      permissionIds = await this.grantablePermissionIds(dto.permissions, actor);
      // 收回权限同样要求自己拥有它：否则低权限的人能把高权限角色「降级」掉
      const removed = role.permissions
        .map((p) => p.permission.code)
        .filter((c) => !dto.permissions!.includes(c));
      this.assertHolds(removed, actor);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({ where: { id }, data: { name: dto.name, remark: dto.remark } });
      if (permissionIds) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
        });
      }
    });
    if (permissionIds) await this.auth.invalidatePermissions();
  }

  async removeRole(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('角色不存在');
    if (role.code === ADMIN_ROLE) throw new BadRequestException('超级管理员角色不能删除');
    if (role._count.users > 0)
      throw new BadRequestException(`仍有 ${role._count.users} 个用户使用该角色，请先调整`);
    await this.prisma.role.delete({ where: { id } });
  }

  // ── 防提权 ───────────────────────────────────────────────

  private assertHolds(codes: string[], actor: JwtPayload): void {
    const owned = new Set<string>(actor.permissions ?? []);
    if (owned.has(PERMISSION.SYSTEM_MANAGE)) return;
    const missing = codes.filter((c) => !owned.has(c));
    if (missing.length > 0) {
      throw new ForbiddenException(`不能授予或收回自己没有的权限：${missing.join(', ')}`);
    }
  }

  private async grantablePermissionIds(codes: string[], actor: JwtPayload): Promise<string[]> {
    const unique = [...new Set(codes)];
    const rows = await this.prisma.permission.findMany({ where: { code: { in: unique } } });
    const unknown = unique.filter((c) => !rows.some((r) => r.code === c));
    if (unknown.length > 0) throw new BadRequestException(`未知权限码：${unknown.join(', ')}`);
    this.assertHolds(unique, actor);
    return rows.map((r) => r.id);
  }

  private async grantableRoleIds(codes: string[], actor: JwtPayload): Promise<string[]> {
    const unique = [...new Set(codes)];
    const roles = await this.prisma.role.findMany({
      where: { code: { in: unique } },
      include: { permissions: { include: { permission: true } } },
    });
    const unknown = unique.filter((c) => !roles.some((r) => r.code === c));
    if (unknown.length > 0) throw new BadRequestException(`未知角色：${unknown.join(', ')}`);
    this.assertHolds(
      roles.flatMap((r) => r.permissions.map((p) => p.permission.code as Permission)),
      actor,
    );
    return roles.map((r) => r.id);
  }

  /** 动一个人的角色或密码，要求他现有的权限你都有——不能对比自己权限大的人下手 */
  private async assertCanRevoke(userId: string, actor: JwtPayload): Promise<void> {
    this.assertHolds(await this.auth.permissionsOf(userId), actor);
  }
}
