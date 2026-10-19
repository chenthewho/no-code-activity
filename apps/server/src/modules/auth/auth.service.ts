import { BadRequestException, ForbiddenException, Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { CurrentUser, Permission } from '@nca/shared';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import type { OidcProfile } from '../sso/oidc.client';
import { SsoService } from '../sso/sso.service';
import type { JwtPayload } from './auth.types';

const USER_WITH_PERMISSIONS = {
  roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
} as const;

/** 权限缓存时长：改了角色最晚这么久全员生效，换来每个请求不必都查四张表 */
const PERMISSION_CACHE_MS = 60_000;
/** 全局权限版本号：任何角色授权变化都递增它，让所有缓存一次性作废 */
const PERMISSION_VERSION_KEY = 'nca:perm:ver';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly sso: SsoService,
    private readonly redis: RedisService,
  ) {}

  /**
   * 以数据库为准的当前身份。token 里的权限是登录那一刻的快照——只信它的话，
   * 收回权限、停用账号都要等 token 过期（默认 7 天）才生效。
   * 守卫每次请求都走这里，结果按「权限版本号 + 用户」缓存一分钟。
   */
  async livePayload(userId: string): Promise<JwtPayload> {
    const version = (await this.redis.get(PERMISSION_VERSION_KEY)) ?? '0';
    const key = `nca:perm:${version}:${userId}`;
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as JwtPayload;

    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: USER_WITH_PERMISSIONS });
    if (!user?.enabled) throw new UnauthorizedException('账号已停用或不存在，请联系管理员');
    const payload = this.buildPayload(user);
    await this.redis.set(key, JSON.stringify(payload), PERMISSION_CACHE_MS);
    return payload;
  }

  /**
   * 用户角色里的全部权限码，不看账号是否启用、不走缓存。
   * 给「能不能动这个人」的判断用：停用账号同样是高权限账号，跳过检查就成了提权口子。
   */
  async permissionsOf(userId: string): Promise<Permission[]> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: USER_WITH_PERMISSIONS });
    return user ? this.buildPayload(user).permissions : [];
  }

  /** 角色授权、用户角色、启停变化后调用：所有人的权限缓存立即作废 */
  async invalidatePermissions(): Promise<void> {
    await this.redis.incrWithExpire(PERMISSION_VERSION_KEY, 30 * 24 * 60 * 60 * 1000);
  }

  onModuleInit(): void {
    this.sso.register('admin', (profile, redirect, nonce) => this.completeSso(profile, redirect, nonce));
  }

  get ssoEnabled(): boolean {
    return this.sso.enabled && this.config.get<boolean>('SSO_ADMIN_ENABLED') !== false;
  }

  ssoConfig(): { enabled: boolean; label: string } {
    return { enabled: this.ssoEnabled, label: this.sso.label };
  }

  /** 后台 SSO 只允许跳回站内路径：拼在 ADMIN_BASE_URL 后面，杜绝开放重定向 */
  async beginSso(redirect: string | undefined, nonce: string | undefined): Promise<string> {
    if (!this.ssoEnabled) throw new BadRequestException('后台未开启统一登录');
    const path = redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/activities';
    return this.sso.begin('admin', path, nonce);
  }

  async exchangeSsoTicket(ticket: string, nonce?: string): Promise<{ token: string; user: CurrentUser }> {
    const { userId } = await this.sso.consumeTicket<{ userId: string; nonce?: string }>('admin', ticket, nonce);
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: USER_WITH_PERMISSIONS });
    if (!user?.enabled) throw new UnauthorizedException('账号不可用');
    const payload = this.buildPayload(user);
    return { token: await this.issueToken(payload), user: await this.getProfile(user.id) };
  }

  /**
   * IdP 认证通过后的后台建号。首次登录自动开户，缺省不带任何权限，
   * 由管理员在「用户管理」里分配——SSO 只证明「你是谁」，不该顺带决定「你能干什么」。
   */
  private async completeSso(profile: OidcProfile, redirect: string, nonce: string): Promise<string> {
    let user = await this.prisma.user.findUnique({ where: { ssoId: profile.id } });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          username: await this.availableUsername(profile.username ?? `sso_${profile.id}`),
          nickname: profile.nickname ?? profile.username ?? profile.id,
          avatar: profile.avatar ?? null,
          ssoId: profile.id,
          password: null,
        },
      });
      const roleCode = this.config.get<string>('SSO_ADMIN_DEFAULT_ROLE');
      const role = roleCode ? await this.prisma.role.findUnique({ where: { code: roleCode } }) : null;
      if (role) {
        await this.prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
      } else if (roleCode) {
        this.logger.warn(`SSO_ADMIN_DEFAULT_ROLE=${roleCode} 不存在，新用户 ${user.username} 没有任何角色`);
      }
      this.logger.log(`SSO 首次登录，已开户 ${user.username}${role ? `（${role.code}）` : '（待授权）'}`);
    }
    if (!user.enabled) throw new ForbiddenException('账号已被停用，请联系管理员');

    const ticket = await this.sso.issueTicket('admin', { userId: user.id, nonce });
    const base = (this.config.get<string>('ADMIN_BASE_URL') ?? 'http://localhost:5173').replace(/\/$/, '');
    const target = new URL(`${base}/login`);
    target.searchParams.set('sso_ticket', ticket);
    target.searchParams.set('redirect', redirect);
    return target.toString();
  }

  /** IdP 的用户名可能与本地账号撞名，撞了就补个随机后缀，不覆盖任何人 */
  private async availableUsername(preferred: string): Promise<string> {
    const base = preferred.replace(/[^\w.@-]/g, '_').slice(0, 40) || 'sso_user';
    let candidate = base;
    for (let i = 0; i < 5; i++) {
      const taken = await this.prisma.user.findUnique({ where: { username: candidate } });
      if (!taken) return candidate;
      candidate = `${base}_${randomBytes(2).toString('hex')}`;
    }
    return `${base}_${randomBytes(6).toString('hex')}`;
  }

  async validateUser(username: string, password: string): Promise<JwtPayload> {
    const user = await this.prisma.user.findUnique({ where: { username }, include: USER_WITH_PERMISSIONS });

    // 用户不存在与密码错误返回同一句提示，避免账号枚举
    if (!user?.password || !user.enabled) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    const ok = await argon2.verify(user.password, password);
    if (!ok) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    return this.buildPayload(user);
  }

  async issueToken(payload: JwtPayload): Promise<string> {
    return this.jwt.signAsync(payload);
  }

  async getProfile(userId: string): Promise<CurrentUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: USER_WITH_PERMISSIONS });
    if (!user) throw new UnauthorizedException('用户不存在');

    const payload = this.buildPayload(user);
    return {
      id: user.id,
      username: user.username,
      nickname: user.nickname,
      avatar: user.avatar ?? undefined,
      roles: payload.roles,
      permissions: payload.permissions,
    };
  }

  private buildPayload(user: UserWithRoles): JwtPayload {
    const roles = user.roles.map((ur) => ur.role.code);
    const permissions = [
      ...new Set(user.roles.flatMap((ur) => ur.role.permissions.map((rp) => rp.permission.code))),
    ] as Permission[];
    return { sub: user.id, username: user.username, nickname: user.nickname, roles, permissions };
  }
}

interface UserWithRoles {
  id: string;
  username: string;
  nickname: string;
  roles: {
    role: {
      code: string;
      permissions: { permission: { code: string } }[];
    };
  }[];
}
