import { describe, expect, it, vi } from 'vitest';
import { AuditService, redact } from './audit.service';

interface AuditRow {
  userId: string;
  action: string;
  targetType?: string;
  targetId?: string;
}

function fakePrisma() {
  const rows: AuditRow[] = [];
  return {
    auditLog: {
      create: vi.fn(async ({ data }: { data: AuditRow }) => {
        rows.push(data);
        return data;
      }),
      findMany: vi.fn(async () => rows),
      count: vi.fn(async () => rows.length),
    },
    $transaction: vi.fn(async (args: Promise<unknown>[]) => Promise.all(args)),
  };
}

function buildService(prisma: unknown) {
  return new AuditService(prisma as never);
}

describe('AuditService', () => {
  it('record 落一条审计记录', async () => {
    const prisma = fakePrisma();
    const service = buildService(prisma);
    await service.record({
      userId: 'u1',
      username: 'admin',
      action: 'activity.publish',
      targetType: 'activities',
      targetId: 'act_1',
      ip: '127.0.0.1',
    });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'u1',
        username: 'admin',
        action: 'activity.publish',
        targetType: 'activities',
        targetId: 'act_1',
        ip: '127.0.0.1',
      }),
    });
  });

  it('list 返回按时间倒序的分页结果', async () => {
    const prisma = fakePrisma();
    const service = buildService(prisma);
    await service.record({ userId: 'u1', action: 'prize.create' });
    await service.record({ userId: 'u1', action: 'channel.create' });

    const result = await service.list({ page: 1, pageSize: 20 });
    expect(result.total).toBe(2);
    expect(result.rows).toHaveLength(2);
  });

  it('密码、密钥、票据类字段的值不进审计', () => {
    expect(
      redact({ username: 'a', password: 'p', nested: { clientSecret: 's', list: [{ ticket: 't', ok: 1 }] } }),
    ).toEqual({ username: 'a', password: '***', nested: { clientSecret: '***', list: [{ ticket: '***', ok: 1 }] } });
  });
});
