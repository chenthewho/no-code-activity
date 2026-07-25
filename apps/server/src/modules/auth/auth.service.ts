import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { CurrentUser, Permission } from '@nca/shared';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { JwtPayload } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async validateUser(username: string, password: string): Promise<JwtPayload> {
    const user = await this.prisma.user.findUnique({
      where: { username },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });

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
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
    });
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
