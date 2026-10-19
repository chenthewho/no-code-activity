import {
  createParamDecorator,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { RuntimeAuthService, type RuntimeTokenPayload } from './runtime-auth.service';

type RuntimeRequest = Request & { runtimeUser?: RuntimeTokenPayload | null };

/**
 * C 端身份解析。只解析不拦截：同一个接口既服务登录用户也服务访客，
 * 要不要登录由业务按活动配置决定（见 RuntimeService.resolveParticipant）。
 */
@Injectable()
export class RuntimeUserGuard implements CanActivate {
  constructor(private readonly auth: RuntimeAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<RuntimeRequest>();
    req.runtimeUser = await this.auth.fromAuthorization(req.headers.authorization);
    return true;
  }
}

/** 取 RuntimeUserGuard 解析出的 C 端身份，未登录为 null */
export const RuntimeUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RuntimeTokenPayload | null =>
    ctx.switchToHttp().getRequest<RuntimeRequest>().runtimeUser ?? null,
);
