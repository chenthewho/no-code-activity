import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import type { ReportEventsDto } from './analytics.dto';

/** 单个 IP 每分钟最多上报次数，防刷屏 */
const MAX_EVENTS_PER_MINUTE = 600;
const MINUTE_MS = 60 * 1000;

/** 简单 UA 识别宿主：微信内 / 移动端 / 桌面，够报表分个大概就行 */
function classifyHost(ua?: string): string {
  if (!ua) return 'unknown';
  if (/MicroMessenger/i.test(ua)) return 'wechat';
  if (/Mobile|Android|iPhone|iPad/i.test(ua)) return 'mobile';
  return 'desktop';
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** 按 IP 限流，返回是否放行；Redis 未启用时降级为进程内计数 */
  async allow(ip?: string): Promise<boolean> {
    const key = `nca:analytics:${ip ?? 'unknown'}`;
    const count = await this.redis.incrWithExpire(key, MINUTE_MS);
    return count <= MAX_EVENTS_PER_MINUTE;
  }

  async ingest(dto: ReportEventsDto, ip?: string, userAgent?: string): Promise<void> {
    await this.prisma.analyticsEvent.createMany({
      data: dto.events.map((e) => ({
        activityId: dto.activityId,
        nodeId: e.nodeId ?? null,
        event: e.event,
        channel: e.channel ?? null,
        host: classifyHost(userAgent),
        // 没 props 就不带，让列走默认 NULL，避免 JsonNull 哨兵值
        ...(e.props ? { props: e.props as Prisma.InputJsonValue } : {}),
      })),
    });
  }

  /**
   * 基础报表：事件总量分型、点击 Top 节点、近 N 天 PV 趋势。
   * 埋点是运营看效果的，够用、不追求完整 BI。
   */
  async report(activityId: string, days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const where: Prisma.AnalyticsEventWhereInput = { activityId, createdAt: { gte: since } };

    const [byEvent, byNode, total, trendRows] = await Promise.all([
      this.prisma.analyticsEvent.groupBy({
        by: ['event'],
        where,
        _count: { _all: true },
      }),
      this.prisma.analyticsEvent.groupBy({
        by: ['nodeId'],
        where: { ...where, event: 'click' },
        _count: { _all: true },
        orderBy: { _count: { nodeId: 'desc' } },
        take: 20,
      }),
      this.prisma.analyticsEvent.count({ where }),
      this.prisma.$queryRaw<{ date: Date; cnt: bigint }[]>`
        SELECT DATE(createdAt) AS date, COUNT(*) AS cnt
        FROM analytics_event
        WHERE activityId = ${activityId} AND event = 'expose' AND createdAt >= ${since}
        GROUP BY DATE(createdAt) ORDER BY date`,
    ]);

    const toCount = (event: string) =>
      byEvent.find((r) => r.event === event)?._count._all ?? 0;

    return {
      total,
      pageViews: toCount('expose'),
      clicks: toCount('click'),
      converts: toCount('convert'),
      byNode: byNode
        .filter((r) => r.nodeId)
        .map((r) => ({ nodeId: r.nodeId, clicks: r._count._all })),
      trend: trendRows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        pageViews: Number(r.cnt),
      })),
    };
  }
}
