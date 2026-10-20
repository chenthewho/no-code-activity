import { HttpException, HttpStatus, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { sendWebhook, type AlertMessage } from './alert.notifier';
import type { AlertRuleDto, Metric, ReportMonitorDto, WebhookType } from './monitor.dto';

/** 一次访问的「结局」事件：每次打开活动页恰好上报其中一条，是各项比率的分母 */
const OUTCOME_TYPES = ['boot', 'load_error', 'dsl_invalid', 'stall'] as const;
/** 看板「最近异常」与问题活动排行关心的类型 */
const PROBLEM_TYPES = [
  'load_error',
  'dsl_invalid',
  'stall',
  'white_screen',
  'js_error',
  'publish_invalid',
];

/** 单 IP 每分钟最多上报次数：一个页面一次访问也就一两批 */
const MAX_REPORTS_PER_MINUTE = 300;

export const METRIC_LABEL: Record<Metric, string> = {
  dsl_invalid_rate: 'DSL 校验失败率',
  white_screen_rate: '白屏率',
  load_error_rate: '加载失败率',
  js_error_count: 'JS 错误数',
  publish_invalid_count: '发布校验失败次数',
};

export interface WindowStats {
  /** 访问次数 = 四种结局之和 */
  attempts: number;
  boots: number;
  loadErrors: number;
  dslInvalid: number;
  stalls: number;
  whiteScreens: number;
  jsErrors: number;
  publishInvalid: number;
}

export interface MetricValue {
  value: number;
  /** 比率类是分母（访问次数），计数类就是计数本身 */
  samples: number;
  /** 哪些事件类型计入了这个指标，定位问题活动用 */
  types: string[];
}

/** 指标口径集中在一处，看板与告警算出来的数永远一致 */
export function metricValue(metric: Metric, stats: WindowStats): MetricValue {
  const rate = (n: number) => (stats.attempts > 0 ? n / stats.attempts : 0);
  switch (metric) {
    case 'dsl_invalid_rate':
      return { value: rate(stats.dslInvalid), samples: stats.attempts, types: ['dsl_invalid'] };
    case 'white_screen_rate':
      // 迟迟渲染不出来（stall）与渲染了但满屏空白（white_screen）对用户是一回事
      return {
        value: rate(stats.whiteScreens + stats.stalls),
        samples: stats.attempts,
        types: ['white_screen', 'stall'],
      };
    case 'load_error_rate':
      return { value: rate(stats.loadErrors), samples: stats.attempts, types: ['load_error'] };
    case 'js_error_count':
      return { value: stats.jsErrors, samples: stats.jsErrors, types: ['js_error'] };
    case 'publish_invalid_count':
      return {
        value: stats.publishInvalid,
        samples: stats.publishInvalid,
        types: ['publish_invalid'],
      };
  }
}

function statsFromCounts(counts: Map<string, number>): WindowStats {
  const n = (type: string) => counts.get(type) ?? 0;
  return {
    attempts: OUTCOME_TYPES.reduce((sum, t) => sum + n(t), 0),
    boots: n('boot'),
    loadErrors: n('load_error'),
    dslInvalid: n('dsl_invalid'),
    stalls: n('stall'),
    whiteScreens: n('white_screen'),
    jsErrors: n('js_error'),
    publishInvalid: n('publish_invalid'),
  };
}

export function isRateMetric(metric: Metric): boolean {
  return metric.endsWith('_rate');
}

export function formatMetric(metric: Metric, value: number): string {
  return isRateMetric(metric) ? `${(value * 100).toFixed(2)}%` : String(Math.round(value));
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index]!;
}

interface RuleRow {
  id: string;
  name: string;
  metric: string;
  threshold: number;
  windowMinutes: number;
  minSamples: number;
  cooldownMinutes: number;
  enabled: boolean;
  webhookType: string;
  webhookUrl: string | null;
  lastTriggeredAt: Date | null;
}

@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  // ── 上报 ────────────────────────────────────────────────

  async ingest(dto: ReportMonitorDto, ip?: string, ua?: string): Promise<void> {
    const count = await this.redis.incrWithExpire(`nca:monitor:${ip ?? 'unknown'}`, 60_000);
    if (count > MAX_REPORTS_PER_MINUTE) {
      throw new HttpException('上报过于频繁', HttpStatus.TOO_MANY_REQUESTS);
    }
    await this.prisma.monitorEvent.createMany({
      data: dto.events.map((e) => ({
        activityId: dto.activityId ?? null,
        version: dto.version ?? null,
        type: e.type,
        host: dto.host ?? null,
        message: e.message?.slice(0, 500) ?? null,
        durationMs: e.durationMs ?? null,
        ua: ua?.slice(0, 255) ?? null,
        ...(e.detail ? { detail: e.detail as Prisma.InputJsonValue } : {}),
      })),
    });
  }

  /** 服务端自己记的事件（发布校验失败），失败只写日志，绝不影响主流程 */
  async record(
    type: 'publish_invalid',
    activityId: string,
    message: string,
    detail?: unknown,
  ): Promise<void> {
    try {
      await this.prisma.monitorEvent.create({
        data: {
          type,
          activityId,
          message: message.slice(0, 500),
          ...(detail ? { detail: detail as Prisma.InputJsonValue } : {}),
        },
      });
    } catch (err) {
      this.logger.warn(`监控事件写入失败：${(err as Error).message}`);
    }
  }

  // ── 统计 ────────────────────────────────────────────────

  async windowStats(since: Date, activityId?: string): Promise<WindowStats> {
    const rows = await this.prisma.monitorEvent.groupBy({
      by: ['type'],
      where: { createdAt: { gte: since }, ...(activityId ? { activityId } : {}) },
      _count: { _all: true },
    });
    return statsFromCounts(new Map(rows.map((r) => [r.type, r._count._all])));
  }

  /** 单个活动按发布版本拆开的指标：灰度期间并排看新旧版本的失败率 */
  async versionStats(since: Date, activityId: string) {
    const rows = await this.prisma.monitorEvent.groupBy({
      by: ['version', 'type'],
      where: { createdAt: { gte: since }, activityId, version: { not: null } },
      _count: { _all: true },
    });
    const byVersion = new Map<number, Map<string, number>>();
    for (const row of rows) {
      const counts = byVersion.get(row.version!) ?? new Map<string, number>();
      counts.set(row.type, row._count._all);
      byVersion.set(row.version!, counts);
    }
    return [...byVersion.entries()]
      .sort(([a], [b]) => b - a)
      .map(([version, counts]) => {
        const stats = statsFromCounts(counts);
        return {
          version,
          attempts: stats.attempts,
          jsErrors: stats.jsErrors,
          rates: {
            dslInvalid: metricValue('dsl_invalid_rate', stats).value,
            whiteScreen: metricValue('white_screen_rate', stats).value,
            loadError: metricValue('load_error_rate', stats).value,
          },
        };
      });
  }

  async overview(hours: number, activityId?: string) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const where: Prisma.MonitorEventWhereInput = {
      createdAt: { gte: since },
      ...(activityId ? { activityId } : {}),
    };

    const [stats, durations, hourly, problems, recent, versions] = await Promise.all([
      this.windowStats(since, activityId),
      // 分位数在应用层算：取最近 5000 次成功渲染的耗时，量级足够、开销可控
      this.prisma.monitorEvent.findMany({
        where: { ...where, type: 'boot', durationMs: { not: null } },
        select: { durationMs: true },
        orderBy: { createdAt: 'desc' },
        take: 5000,
      }),
      this.prisma.$queryRaw<{ hour: string; type: string; cnt: bigint }[]>`
        SELECT DATE_FORMAT(createdAt, '%Y-%m-%dT%H:00:00Z') AS hour, type, COUNT(*) AS cnt
        FROM monitor_event
        WHERE createdAt >= ${since} ${activityId ? Prisma.sql`AND activityId = ${activityId}` : Prisma.empty}
        GROUP BY hour, type ORDER BY hour`,
      this.prisma.monitorEvent.groupBy({
        by: ['activityId'],
        where: { ...where, type: { in: PROBLEM_TYPES }, activityId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { activityId: 'desc' } },
        take: 10,
      }),
      this.prisma.monitorEvent.findMany({
        where: { ...where, type: { in: PROBLEM_TYPES } },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      activityId ? this.versionStats(since, activityId) : Promise.resolve([]),
    ]);

    const sorted = durations.map((d) => d.durationMs!).sort((a, b) => a - b);
    const trend = new Map<string, Record<string, number>>();
    for (const row of hourly) {
      const bucket = trend.get(row.hour) ?? {};
      bucket[row.type] = Number(row.cnt);
      trend.set(row.hour, bucket);
    }

    const titles = await this.prisma.activity.findMany({
      where: { id: { in: problems.map((p) => p.activityId!) } },
      select: { id: true, title: true },
    });

    return {
      hours,
      stats,
      rates: {
        dslInvalid: metricValue('dsl_invalid_rate', stats).value,
        whiteScreen: metricValue('white_screen_rate', stats).value,
        loadError: metricValue('load_error_rate', stats).value,
      },
      render: {
        p50: percentile(sorted, 0.5),
        p90: percentile(sorted, 0.9),
        samples: sorted.length,
      },
      trend: [...trend.entries()].map(([hour, counts]) => ({
        hour,
        attempts: OUTCOME_TYPES.reduce((sum, t) => sum + (counts[t] ?? 0), 0),
        whiteScreens: (counts.white_screen ?? 0) + (counts.stall ?? 0),
        dslInvalid: counts.dsl_invalid ?? 0,
        loadErrors: counts.load_error ?? 0,
        jsErrors: counts.js_error ?? 0,
      })),
      topActivities: problems.map((p) => ({
        activityId: p.activityId!,
        title: titles.find((t) => t.id === p.activityId)?.title ?? '（已删除）',
        problems: p._count._all,
      })),
      byVersion: versions,
      recent: recent.map((e) => ({
        id: e.id.toString(),
        type: e.type,
        activityId: e.activityId,
        version: e.version,
        host: e.host,
        message: e.message,
        detail: e.detail,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  // ── 告警规则 ─────────────────────────────────────────────

  async rules() {
    return this.prisma.alertRule.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async createRule(dto: AlertRuleDto) {
    return this.prisma.alertRule.create({ data: { ...dto, webhookUrl: dto.webhookUrl || null } });
  }

  async updateRule(id: string, dto: Partial<AlertRuleDto>) {
    await this.findRule(id);
    return this.prisma.alertRule.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.webhookUrl !== undefined ? { webhookUrl: dto.webhookUrl || null } : {}),
      },
    });
  }

  async removeRule(id: string) {
    await this.findRule(id);
    await this.prisma.alertRule.delete({ where: { id } });
  }

  async alerts(page: number, pageSize: number) {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.alertRecord.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { rule: { select: { name: true } } },
      }),
      this.prisma.alertRecord.count(),
    ]);
    return { rows, total };
  }

  /** 发一条测试消息，验证机器人地址配对了 */
  async testRule(id: string): Promise<void> {
    const rule = await this.findRule(id);
    if (rule.webhookType === 'none' || !rule.webhookUrl) {
      throw new HttpException('该规则没有配置通知地址', HttpStatus.BAD_REQUEST);
    }
    await sendWebhook(rule.webhookUrl, rule.webhookType as WebhookType, {
      title: `【测试】${rule.name}`,
      lines: ['这是一条测试消息，收到说明告警通知配置正确。'],
      link: this.monitorLink(),
    }).catch((err: Error) => {
      throw new HttpException(`通知发送失败：${err.message}`, HttpStatus.BAD_GATEWAY);
    });
  }

  /**
   * 评估一条规则。窗口内样本不足、未超阈值、仍在冷却期，都不告警。
   * 返回本次是否产生了告警（测试与日志用）。
   */
  async evaluateRule(rule: RuleRow, now = new Date()): Promise<boolean> {
    const metric = rule.metric as Metric;
    const since = new Date(now.getTime() - rule.windowMinutes * 60 * 1000);
    const stats = await this.windowStats(since);
    const { value, samples, types } = metricValue(metric, stats);

    if (isRateMetric(metric) && samples < rule.minSamples) return false;
    if (value <= rule.threshold) return false;
    if (
      rule.lastTriggeredAt &&
      now.getTime() - rule.lastTriggeredAt.getTime() < rule.cooldownMinutes * 60 * 1000
    ) {
      return false;
    }

    // 顺手找出问题最集中的活动：告警能直接指向「哪个活动挂了」，而不是只说「有东西挂了」
    const [top] = await this.prisma.monitorEvent.groupBy({
      by: ['activityId'],
      where: { createdAt: { gte: since }, type: { in: types }, activityId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { activityId: 'desc' } },
      take: 1,
    });
    const activity = top?.activityId
      ? await this.prisma.activity.findUnique({
          where: { id: top.activityId },
          select: { title: true },
        })
      : null;

    const label = METRIC_LABEL[metric];
    const lines = [
      `近 ${rule.windowMinutes} 分钟${label} ${formatMetric(metric, value)}，阈值 ${formatMetric(metric, rule.threshold)}`,
      ...(isRateMetric(metric) ? [`样本：${samples} 次访问`] : []),
      ...(top?.activityId
        ? [`问题最集中：${activity?.title ?? top.activityId}（${top._count._all} 次）`]
        : []),
    ];
    const message: AlertMessage = {
      title: `【活动页告警】${rule.name}`,
      lines,
      link: this.monitorLink(top?.activityId ?? undefined),
      data: {
        metric,
        value,
        threshold: rule.threshold,
        samples,
        activityId: top?.activityId ?? null,
      },
    };

    let notified = false;
    let notifyError: string | null = null;
    if (rule.webhookType !== 'none' && rule.webhookUrl) {
      try {
        await sendWebhook(rule.webhookUrl, rule.webhookType as WebhookType, message);
        notified = true;
      } catch (err) {
        notifyError = (err as Error).message.slice(0, 500);
        this.logger.warn(`告警通知发送失败（${rule.name}）：${notifyError}`);
      }
    }

    await this.prisma.$transaction([
      this.prisma.alertRecord.create({
        data: {
          ruleId: rule.id,
          metric,
          value,
          threshold: rule.threshold,
          samples,
          activityId: top?.activityId ?? null,
          message: [message.title, ...lines].join('\n'),
          notified,
          notifyError,
        },
      }),
      this.prisma.alertRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: now } }),
    ]);
    this.logger.warn(`${message.title}：${lines[0]}`);
    return true;
  }

  async evaluateAll(now = new Date()): Promise<number> {
    const rules = await this.prisma.alertRule.findMany({ where: { enabled: true } });
    let fired = 0;
    for (const rule of rules) {
      try {
        if (await this.evaluateRule(rule, now)) fired += 1;
      } catch (err) {
        this.logger.error(`告警规则 ${rule.name} 评估失败：${(err as Error).message}`);
      }
    }
    return fired;
  }

  /** 清理过期事件：监控数据只看近期，留着只会拖慢统计查询 */
  async purge(retentionDays: number): Promise<number> {
    const before = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.monitorEvent.deleteMany({
      where: { createdAt: { lt: before } },
    });
    return count;
  }

  private monitorLink(activityId?: string): string {
    const base = (this.config.get<string>('ADMIN_BASE_URL') ?? 'http://localhost:5173').replace(
      /\/$/,
      '',
    );
    return `${base}/monitor${activityId ? `?activityId=${activityId}` : ''}`;
  }

  private async findRule(id: string) {
    const rule = await this.prisma.alertRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('告警规则不存在');
    return rule;
  }
}
