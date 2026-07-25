import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@nca/shared';
import type { JwtPayload } from '../../modules/auth/auth.types';

export const IS_PUBLIC_KEY = 'nca:isPublic';
/** 跳过登录校验，用于登录接口与 C 端 runtime 接口 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const PERMISSIONS_KEY = 'nca:permissions';
/** 声明访问该接口所需权限码，与 Admin 路由守卫用的是同一份字典 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;
    if (!user) return undefined;
    return data ? user[data] : user;
  },
);
