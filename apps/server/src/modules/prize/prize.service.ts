import { HttpException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import type { CreatePrizeDto, UpdatePrizeDto } from './prize.dto';

const inventoryKey = (prizeId: string): string => `nca:prize:${prizeId}:remaining`;
const drawLimitKey = (activityId: string, userId: string): string =>
  `nca:draw:user:${activityId}:${userId}`;

/** 单个用户每天最多抽奖次数，超出视为刷单 */
const MAX_DRAWS_PER_USER_DAY = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DrawResult {
  won: boolean;
  /** 命中时是奖品在排序列表中的下标，renderer 动画停靠用；未命中 -1 */
  index: number;
  prize: { id: string; name: string; image?: string } | null;
  message: string;
}

/**
 * 抽奖 Lua：按概率选奖 + 原子扣减库存，一次调用完成，并发不超卖。
 *
 * KEYS[i] = 第 i 个「可中」奖品的 remaining key
 * ARGV = [prob1, id1, prob2, id2, ..., roll]，roll ∈ [0,10000)
 * 返回 {1, prizeId} 中奖 / {0, ''} 未中。
 * 「可中」候选已在 JS 侧过滤好（库存>0、未超 limitPerUser、probability>0）；
 * 脚本内再对 remaining 做最后一道并发校验。总概率不足 10000 的部分就是未中区间。
 */
const DRAW_LUA = `
local roll = tonumber(ARGV[#ARGV])
local n = (#ARGV - 1) / 2
for i = 0, n - 1 do
  local prob = tonumber(ARGV[1 + i * 2])
  local id = ARGV[2 + i * 2]
  local remaining = tonumber(redis.call('GET', KEYS[i + 1]) or '0')
  if remaining > 0 then
    if roll < prob then
      redis.call('DECR', KEYS[i + 1])
      return {1, id}
    end
    roll = roll - prob
  end
end
return {0, ''}
`;

@Injectable()
export class PrizeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ── 奖品 CRUD ──────────────────────────────────────────────

  /** 按 sort 排序的奖品列表，剩余库存以 Redis 权威值为准（无 Redis 回落 DB 列） */
  async list(activityId: string) {
    const rows = await this.prisma.prize.findMany({
      where: { activityId },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    if (!this.redis.enabled) return rows;
    return Promise.all(
      rows.map(async (p) => {
        const raw = await this.redis.get(inventoryKey(p.id));
        return { ...p, remaining: raw !== null ? Number(raw) : p.remaining };
      }),
    );
  }

  async create(dto: CreatePrizeDto) {
    const prize = await this.prisma.prize.create({
      data: {
        activityId: dto.activityId,
        name: dto.name,
        image: dto.image ?? null,
        probability: dto.probability,
        total: dto.total,
        remaining: dto.total,
        limitPerUser: dto.limitPerUser,
        sort: dto.sort,
      },
    });
    if (this.redis.enabled) await this.redis.set(inventoryKey(prize.id), String(prize.total));
    return prize;
  }

  async update(id: string, dto: UpdatePrizeDto) {
    const existing = await this.prisma.prize.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('奖品不存在');
    const updated = await this.prisma.prize.update({
      where: { id },
      data: {
        ...dto,
        // 改 total 时把剩余库存重置为总量，避免调完库存数与扣减对不上
        ...(dto.total !== undefined ? { remaining: dto.total } : {}),
      },
    });
    if (this.redis.enabled) {
      if (dto.total !== undefined) {
        await this.redis.set(inventoryKey(id), String(dto.total));
      } else if ((await this.redis.get(inventoryKey(id))) === null) {
        await this.redis.set(inventoryKey(id), String(updated.remaining));
      }
    }
    return updated;
  }

  async remove(id: string) {
    const existing = await this.prisma.prize.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('奖品不存在');
    // PrizeRecord 外键无级联，先清记录再删奖品
    await this.prisma.$transaction([
      this.prisma.prizeRecord.deleteMany({ where: { prizeId: id } }),
      this.prisma.prize.delete({ where: { id } }),
    ]);
    if (this.redis.enabled) await this.redis.del(inventoryKey(id));
  }

  // ── 抽奖 ──────────────────────────────────────────────────

  /**
   * C 端公开奖品列表（供 ds_prizes 数据源）：不含概率与库存，index 即格子序号。
   * 售罄的奖品格子也保留——页面照常展示，只是抽不到。
   */
  async publicList(activityId: string) {
    const rows = await this.prisma.prize.findMany({
      where: { activityId },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, image: true },
    });
    return rows.map((p, index) => ({ index, id: p.id, name: p.name, image: p.image ?? undefined }));
  }

  async draw(activityId: string, userId: string): Promise<DrawResult> {
    // 限流：按天计数，超出上限直接拒绝，不消耗任何库存
    const today = await this.redis.incrWithExpire(drawLimitKey(activityId, userId), DAY_MS);
    if (today > MAX_DRAWS_PER_USER_DAY) {
      throw new HttpException('今日抽奖次数已达上限，明天再来吧', HttpStatus.TOO_MANY_REQUESTS);
    }

    const prizes = await this.prisma.prize.findMany({
      where: { activityId },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    if (prizes.length === 0) return this.noWin();

    // 单用户限次：统计该用户每个奖品的已中次数
    const won = await this.prisma.prizeRecord.findMany({
      where: { activityId, userId, status: 'won' },
      select: { prizeId: true },
    });
    const wonByPrize = new Map<string, number>();
    for (const r of won) wonByPrize.set(r.prizeId, (wonByPrize.get(r.prizeId) ?? 0) + 1);

    // 可中候选：库存>0 且未超单用户限次。remaining 一并带上，降级路径直接用它
    const candidates: { id: string; probability: number; remaining: number }[] = [];
    for (const p of prizes) {
      const remaining = await this.currentRemaining(p.id, p.remaining);
      const limitLeft = p.limitPerUser === 0 ? Infinity : p.limitPerUser - (wonByPrize.get(p.id) ?? 0);
      if (remaining > 0 && limitLeft > 0 && p.probability > 0) {
        candidates.push({ id: p.id, probability: p.probability, remaining });
      }
    }
    if (candidates.length === 0) return this.noWin();

    const roll = randomInt(0, 10_000);
    const pickedId =
      this.redis.enabled ? await this.drawWithRedis(candidates, roll) : await this.drawFallback(candidates, roll);

    if (!pickedId) return this.noWin();

    const prize = prizes.find((p) => p.id === pickedId);
    if (!prize) return this.noWin();
    const index = prizes.findIndex((p) => p.id === pickedId);
    await this.prisma.prizeRecord.create({
      data: { activityId, prizeId: pickedId, userId, status: 'won' },
    });
    return {
      won: true,
      index,
      prize: { id: prize.id, name: prize.name, image: prize.image ?? undefined },
      message: '恭喜中奖',
    };
  }

  /** Redis 路径：Lua 脚本原子选奖 + 扣减 */
  private async drawWithRedis(
    candidates: { id: string; probability: number; remaining: number }[],
    roll: number,
  ): Promise<string | null> {
    const keys = candidates.map((c) => inventoryKey(c.id));
    const args: (string | number)[] = [];
    for (const c of candidates) args.push(c.probability, c.id);
    args.push(roll);
    const res = await this.redis.eval(DRAW_LUA, keys, args);
    const arr = Array.isArray(res) ? res : [];
    return Number(arr[0] ?? 0) === 1 ? String(arr[1] ?? '') : null;
  }

  /** 无 Redis 降级：进程内 withLock 串行选奖 + updateMany 原子扣减（单实例正确） */
  private async drawFallback(
    candidates: { id: string; probability: number; remaining: number }[],
    roll: number,
  ): Promise<string | null> {
    return this.redis.withLock('nca:draw', async () => {
      let r = roll;
      for (const c of candidates) {
        if (c.remaining <= 0) continue;
        if (r < c.probability) {
          const updated = await this.prisma.prize.updateMany({
            where: { id: c.id, remaining: { gt: 0 } },
            data: { remaining: { decrement: 1 } },
          });
          if (updated.count === 1) return c.id;
          // 恰被并发扣到 0，视作该奖品不可中，继续往后看
          c.remaining = 0;
          r -= c.probability;
        } else {
          r -= c.probability;
        }
      }
      return null;
    });
  }

  /** 剩余库存：Redis 权威，未初始化或无 Redis 时回落 DB 列 */
  private async currentRemaining(prizeId: string, dbRemaining?: number): Promise<number> {
    if (this.redis.enabled) {
      const raw = await this.redis.get(inventoryKey(prizeId));
      if (raw !== null) return Number(raw);
    }
    return dbRemaining ?? 0;
  }

  private noWin(): DrawResult {
    return { won: false, index: -1, prize: null, message: '未中奖' };
  }
}
