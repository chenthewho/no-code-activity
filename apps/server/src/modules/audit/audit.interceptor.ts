import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { tap } from 'rxjs';
import { AUDIT_METADATA, type AuditOptions } from './audit.decorator';
import { AuditService } from './audit.service';
import type { JwtPayload } from '../auth/auth.types';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    const options = Reflect.getMetadata(AUDIT_METADATA, context.getHandler()) as
      | AuditOptions
      | undefined;
    // 没标 @Audit 的方法直接放行，零开销
    if (!options) return next.handle();

    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    // 从路由路径取资源类型：/api/v1/activities/:id -> activities（跳过 api/v1 前缀段）
    const segments: string[] = req.route?.path?.split('/').filter(Boolean) ?? [];
    const targetType = segments.find((s) => s !== 'api' && s !== 'v1');

    return next.handle().pipe(
      tap(() => {
        // 成功返回后才落审计；失败由异常过滤器处理，不记
        const user = req.user;
        void this.audit.record({
          userId: user?.sub ?? 'unknown',
          username: user?.username,
          action: options.action,
          targetType,
          targetId: options.targetParam ? (req.params?.[options.targetParam] as string) : undefined,
          detail: (req.body as object | undefined) ?? undefined,
          ip: req.ip,
        });
      }),
    );
  }
}
