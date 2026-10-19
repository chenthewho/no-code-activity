import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../common/redis/redis.service';
import { MonitorService } from './monitor.service';

const PURGE_EVERY_MS = 60 * 60 * 1000;

/**
 * 定时评估告警规则。多实例部署时用 Redis 锁保证一个周期只有一个实例在评估——
 * 锁不主动释放、TTL 略短于周期，这样别的实例在本周期内抢不到，下个周期又能接手。
 * 没配 Redis 时锁退化为进程内，单实例下同样成立。
 */
@Injectable()
export class AlertEvaluator implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertEvaluator.name);
  private timer: NodeJS.Timeout | null = null;
  private lastPurge = 0;

  constructor(
    private readonly monitor: MonitorService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const interval = this.config.get<number>('MONITOR_EVAL_INTERVAL_MS') ?? 60_000;
    if (interval <= 0) {
      this.logger.warn('MONITOR_EVAL_INTERVAL_MS=0，告警评估已关闭');
      return;
    }
    this.timer = setInterval(() => void this.tick(interval), interval);
    // 定时器不拖住进程退出（测试、优雅停机）
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(interval: number): Promise<void> {
    try {
      const acquired = await this.redis.acquireLock(
        'nca:monitor:eval',
        Math.max(1000, interval - 5000),
      );
      if (!acquired) return;
      await this.monitor.evaluateAll();
      if (Date.now() - this.lastPurge > PURGE_EVERY_MS) {
        this.lastPurge = Date.now();
        const removed = await this.monitor.purge(
          this.config.get<number>('MONITOR_RETENTION_DAYS') ?? 30,
        );
        if (removed > 0) this.logger.log(`已清理 ${removed} 条过期监控事件`);
      }
    } catch (err) {
      this.logger.error(`告警评估失败：${(err as Error).message}`);
    }
  }
}
