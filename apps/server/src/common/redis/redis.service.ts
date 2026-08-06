import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * 分布式锁 / KV / 计数 / Lua 能力。
 *
 * 未配置 REDIS_URL 时降级为进程内实现，只为让本地 `pnpm dev` 不依赖外部服务；
 * 多实例部署下进程内锁与计数是无效的，生产环境必须配 REDIS_URL——启动日志会明确告警。
 * Lua（eval）只在 Redis 启用时可用，调用方需先判 enabled。
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis | null;
  private readonly memoryLocks = new Map<string, number>();
  private readonly memoryStore = new Map<string, { value: string; expireAt: number }>();

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

  async get(key: string): Promise<string | null> {
    if (this.client) return this.client.get(key);
    const entry = this.memoryStore.get(key);
    if (!entry) return null;
    if (entry.expireAt <= Date.now()) {
      this.memoryStore.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    if (this.client) {
      if (ttlMs !== undefined) await this.client.set(key, value, 'PX', ttlMs);
      else await this.client.set(key, value);
      return;
    }
    this.memoryStore.set(key, { value, expireAt: ttlMs !== undefined ? Date.now() + ttlMs : Infinity });
  }

  async del(key: string): Promise<void> {
    if (this.client) {
      await this.client.del(key);
      return;
    }
    this.memoryStore.delete(key);
  }

  /**
   * 执行 Lua 脚本。只对 Redis 有效；未启用时抛错，调用方应先判 enabled。
   * keys / args 原样传给脚本，返回 Redis 原始结果（数组、数字或字符串）。
   */
  async eval(script: string, keys: string[], args: (string | number)[]): Promise<unknown> {
    if (!this.client) throw new Error('Redis 未启用，无法执行 Lua');
    return this.client.eval(script, keys.length, ...keys, ...args);
  }

  /**
   * 原子自增，首次自增时带上过期。用于「按天限流」这类计数：并发下不会出现
   * INCR 与 EXPIRE 之间丢 TTL 的窗口。
   */
  async incrWithExpire(key: string, ttlMs: number): Promise<number> {
    if (this.client) {
      const script = `local c = redis.call('INCR', KEYS[1])\nif c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end\nreturn c`;
      const result = await this.client.eval(script, 1, key, ttlMs);
      return Number(result);
    }
    const now = Date.now();
    const entry = this.memoryStore.get(key);
    const next = entry && entry.expireAt > now ? Number(entry.value) + 1 : 1;
    this.memoryStore.set(key, { value: String(next), expireAt: now + ttlMs });
    return next;
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
