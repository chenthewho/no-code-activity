import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ROOT_NODE_ID } from '@nca/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import type { ReportEventsDto } from './analytics.dto';

/** 单个 IP 每分钟最多上报次数，防刷屏 */
const MAX_EVENTS_PER_MINUTE = 600;
const MINUTE_MS = 60 * 1000;
/** 报表里列出的节点数上限 */
const TOP_NODES = 20;

export interface NodeStats {
  nodeId: string;
  exposures: number;
  clicks: number;
  converts: number;
}

/**
 * 逐节点汇总：曝光、点击、转化合到一行，按点击、曝光、转化排序取前 N。
 * 页面本身的曝光是 PV，不进节点榜。
 */
export function nodeStats(rows: { nodeId: string | null; event: string; count: number }[]): NodeStats[] {
  const byNode = new Map<string, NodeStats>();
  for (const { nodeId, event, count } of rows) {
    if (!nodeId || nodeId === ROOT_NODE_ID) continue;
    const stats = byNode.get(nodeId) ?? { nodeId, exposures: 0, clicks: 0, converts: 0 };
    if (event === 'expose') stats.exposures += count;
    else if (event === 'click') stats.clicks += count;
    else if (event === 'convert') stats.converts += count;
    byNode.set(nodeId, stats);
  }
  return [...byNode.values()]
    .sort((a, b) => b.clicks - a.clicks || b.exposures - a.exposures || b.converts - a.converts)
    .slice(0, TOP_NODES);
}

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
        version: dto.version ?? null,
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
   * 基础报表：PV / 点击 / 转化总量、逐节点曝光点击转化、近 N 天 PV 趋势。
   * 埋点是运营看效果的，够用、不追求完整 BI。
   *
   * 曝光事件分两种：nodeId 为 ROOT（或早期没带 nodeId）的是页面浏览，其余是组件曝光。
   */
  async report(activityId: string, days = 7) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const where: Prisma.AnalyticsEventWhereInput = { activityId, createdAt: { gte: since } };
    const pageView: Prisma.AnalyticsEventWhereInput = {
      event: 'expose',
      OR: [{ nodeId: ROOT_NODE_ID }, { nodeId: null }],
    };

    const [byEvent, byNode, pageViews, total, trendRows] = await Promise.all([
      this.prisma.analyticsEvent.groupBy({
        by: ['event'],
        where,
        _count: { _all: true },
      }),
      // 一个活动的组件数有限（几十个），全量分组后在内存里合并排序
      this.prisma.analyticsEvent.groupBy({
        by: ['nodeId', 'event'],
        where: { ...where, nodeId: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.analyticsEvent.count({ where: { ...where, ...pageView } }),
      this.prisma.analyticsEvent.count({ where }),
      this.prisma.$queryRaw<{ date: Date; cnt: bigint }[]>`
        SELECT DATE(createdAt) AS date, COUNT(*) AS cnt
        FROM analytics_event
        WHERE activityId = ${activityId} AND event = 'expose' AND createdAt >= ${since}
          AND (nodeId = ${ROOT_NODE_ID} OR nodeId IS NULL)
        GROUP BY DATE(createdAt) ORDER BY date`,
    ]);

    const toCount = (event: string) =>
      byEvent.find((r) => r.event === event)?._count._all ?? 0;

    return {
      total,
      pageViews,
      clicks: toCount('click'),
      converts: toCount('convert'),
      byNode: nodeStats(
        byNode.map((r) => ({ nodeId: r.nodeId, event: r.event, count: r._count._all })),
      ),
      trend: trendRows.map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        pageViews: Number(r.cnt),
      })),
    };
  }
}
