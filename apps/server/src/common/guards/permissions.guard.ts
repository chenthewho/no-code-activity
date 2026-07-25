import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSION, type Permission } from '@nca/shared';
import type { Request } from 'express';
import { PERMISSIONS_KEY } from '../decorators';
import type { JwtPayload } from '../../modules/auth/auth.types';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = request.user;
    if (!user) throw new ForbiddenException('无访问权限');

    // system:manage 是超级权限，绕过逐项检查
    const owned = new Set(user.permissions ?? []);
    if (owned.has(PERMISSION.SYSTEM_MANAGE)) return true;

    const missing = required.filter((p) => !owned.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException(`缺少权限：${missing.join(', ')}`);
    }
    return true;
  }
}
