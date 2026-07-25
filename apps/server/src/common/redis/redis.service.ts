import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * 分布式锁 / 计数能力。
 *
 * 未配置 REDIS_URL 时降级为进程内实现，只为让本地 `pnpm dev` 不依赖外部服务；
 * 多实例部署下进程内锁是无效的，生产环境必须配 REDIS_URL——启动日志会明确告警。
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;
  private readonly memoryLocks = new Map<string, number>();

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');
    if (url) {
      this.client = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
      this.client.on('error', (err) => this.logger.error(`Redis 连接异常: ${err.message}`));
      this.logger.log('Redis 已启用');
    } else {
      this.client = null;
      this.logger.warn('未配置 REDIS_URL，锁降级为进程内实现，切勿用于多实例生产环境');
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /** 抢占锁，返回是否成功。ttlMs 到期自动释放，避免进程崩溃留下死锁 */
  async acquireLock(key: string, ttlMs = 30_000): Promise<boolean> {
    if (this.client) {
      const result = await this.client.set(key, '1', 'PX', ttlMs, 'NX');
      return result === 'OK';
    }
    const expireAt = this.memoryLocks.get(key);
    const now = Date.now();
    if (expireAt !== undefined && expireAt > now) return false;
    this.memoryLocks.set(key, now + ttlMs);
    return true;
  }

  async releaseLock(key: string): Promise<void> {
    if (this.client) {
      await this.client.del(key);
      return;
    }
    this.memoryLocks.delete(key);
  }

  /** 在锁保护下执行，无论成败都释放 */
  async withLock<T>(key: string, fn: () => Promise<T>, ttlMs = 30_000): Promise<T> {
    const ok = await this.acquireLock(key, ttlMs);
    if (!ok) {
      throw new Error(`资源正被其它操作占用：${key}`);
    }
    try {
      return await fn();
    } finally {
      await this.releaseLock(key);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }
}
