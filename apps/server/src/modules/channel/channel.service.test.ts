import { describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ChannelService } from './channel.service';

interface ChannelRow {
  id: string;
  activityId: string;
  name: string;
  code: string;
  params: Record<string, unknown> | null;
  createdAt: Date;
}

function fakePrisma(rows: ChannelRow[] = []) {
  return {
    channel: {
      findMany: vi.fn(async () => rows),
      findUnique: vi.fn(async ({ where }: { where: { activityId_code?: { activityId: string; code: string } } }) => {
        const key = where.activityId_code;
        return rows.find((r) => key && r.activityId === key.activityId && r.code === key.code) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Omit<ChannelRow, 'id' | 'createdAt'> }) => {
        const row: ChannelRow = { id: 'c1', createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      delete: vi.fn(async () => undefined),
    },
  };
}

function fakeConfig() {
  return {
    get: vi.fn((key: string) => (key === 'ACTIVITY_BASE_URL' ? 'http://localhost:5180' : undefined)),
  };
}

function buildService(prisma: unknown, config: unknown) {
  return new ChannelService(prisma as never, config as never);
}

describe('ChannelService', () => {
  it('生成带渠道码与透传参数的落地链接', async () => {
    const service = buildService(fakePrisma(), fakeConfig());
    const created = await service.create({ activityId: 'act_1', name: '微信', code: 'wechat', params: { utm_source: 'wechat' } });
    expect(created.link).toBe('http://localhost:5180/act/act_1?ch=wechat&utm_source=wechat');
  });

  it('无参数时链接只有渠道码', async () => {
    const service = buildService(fakePrisma(), fakeConfig());
    const created = await service.create({ activityId: 'act_1', name: '短信', code: 'sms' });
    expect(created.link).toBe('http://localhost:5180/act/act_1?ch=sms');
  });

  it('同一活动重复渠道码抛 400', async () => {
    const prisma = fakePrisma([
      { id: 'c1', activityId: 'act_1', name: '旧', code: 'sms', params: {}, createdAt: new Date() },
    ]);
    const service = buildService(prisma, fakeConfig());
    await expect(service.create({ activityId: 'act_1', name: '新', code: 'sms' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('列表返回每条渠道的链接', async () => {
    const prisma = fakePrisma([
      { id: 'c1', activityId: 'act_1', name: '微信', code: 'wechat', params: null, createdAt: new Date() },
    ]);
    const service = buildService(prisma, fakeConfig());
    const list = await service.list('act_1');
    expect(list[0].link).toBe('http://localhost:5180/act/act_1?ch=wechat');
  });
});
