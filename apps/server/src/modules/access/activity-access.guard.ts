import {
  BadRequestException,
  Injectable,
  NotFoundException,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { JwtPayload } from '../auth/auth.types';
import { ActivityAccessService, type AccessNeed } from './activity-access.service';

/**
 * 活动 id 从哪取。奖品/渠道接口按自身 id 操作，要先查出它属于哪个活动——
 * 否则「改一个别人活动下的奖品」就绕过了数据权限。
 */
export type ActivitySource =
  | { param: string }
  | { query: string }
  | { body: string }
  | { prizeParam: string }
  | { channelParam: string };

interface AccessRule {
  need: AccessNeed;
  source: ActivitySource;
}

const ACTIVITY_ACCESS_KEY = 'nca:activityAccess';

/**
 * 声明接口要求的活动访问级别，由 ActivityAccessGuard 执行。
 * 与 @RequirePermissions 叠加使用：前者管「能不能做这类事」，这里管「能不能对这个活动做」。
 */
export const RequireActivityAccess = (need: AccessNeed, source: ActivitySource = { param: 'id' }) =>
  SetMetadata(ACTIVITY_ACCESS_KEY, { need, source } satisfies AccessRule);

@Injectable()
export class ActivityAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: ActivityAccessService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.get<AccessRule | undefined>(
      ACTIVITY_ACCESS_KEY,
      context.getHandler(),
    );
    if (!rule) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    if (!req.user) return false;
    const activityId = await this.activityIdOf(req, rule.source);
    await this.access.assert(req.user, activityId, rule.need);
    return true;
  }

  private async activityIdOf(req: Request, source: ActivitySource): Promise<string> {
    const pick = (value: unknown): string => {
      if (typeof value !== 'string' || !value) throw new BadRequestException('缺少 activityId');
      return value;
    };
    if ('param' in source) return pick(req.params?.[source.param]);
    if ('query' in source) return pick((req.query as Record<string, unknown>)?.[source.query]);
    if ('body' in source)
      return pick((req.body as Record<string, unknown> | undefined)?.[source.body]);
    if ('prizeParam' in source) {
      const prize = await this.prisma.prize.findUnique({
        where: { id: pick(req.params?.[source.prizeParam]) },
        select: { activityId: true },
      });
      if (!prize) throw new NotFoundException('奖品不存在');
      return prize.activityId;
    }
    const channel = await this.prisma.channel.findUnique({
      where: { id: pick(req.params?.[source.channelParam]) },
      select: { activityId: true },
    });
    if (!channel) throw new NotFoundException('渠道不存在');
    return channel.activityId;
  }
}
