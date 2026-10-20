import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AppointmentService, sceneStatus } from './appointment.service';

interface Scene {
  id: string;
  activityId: string;
  sceneId: string;
  name: string;
  startAt: Date | null;
  endAt: Date | null;
  capacity: number | null;
  booked: number;
  sort: number;
  createdAt: Date;
}

const NOW = new Date('2026-10-20T10:00:00Z');

/**
 * 内存版 Prisma：UPDATE 的「比较并自增」与预约记录的唯一约束都照真库的语义来，
 * 事务失败时把占的名额退回去。
 */
function setup(scenes: Partial<Scene>[] = []) {
  const rows: Scene[] = scenes.map((s, i) => ({
    id: `s${i}`,
    activityId: 'a1',
    sceneId: `scene_${i}`,
    name: `第 ${i + 1} 场`,
    startAt: null,
    endAt: null,
    capacity: null,
    booked: 0,
    sort: i,
    createdAt: NOW,
    ...s,
  }));
  const records: { activityId: string; sceneId: string; userId: string; status: string }[] = [];
  const recordKey = (r: { activityId: string; sceneId: string; userId: string }) =>
    `${r.activityId}/${r.sceneId}/${r.userId}`;

  /** 每个事务各自记下占了哪些名额，失败时只退自己的——和真库的行级回滚一致 */
  const makeTx = (taken: Scene[]) => ({
    $executeRaw: async (_sql: TemplateStringsArray, id: string) => {
      const scene = rows.find((s) => s.id === id)!;
      if (scene.capacity !== null && scene.booked >= scene.capacity) return 0;
      scene.booked += 1;
      taken.push(scene);
      return 1;
    },
    appointmentRecord: {
      create: async ({ data }: { data: { activityId: string; sceneId: string; userId: string } }) => {
        if (records.some((r) => recordKey(r) === recordKey(data))) {
          throw Object.assign(new Error('unique'), { code: 'P2002' });
        }
        records.push({ ...data, status: 'confirmed' });
        return data;
      },
    },
  });
  const prisma = {
    appointmentScene: {
      findMany: async ({ where }: { where: { activityId: string } }) =>
        rows.filter((s) => s.activityId === where.activityId),
      findUnique: async ({ where }: { where: { activityId_sceneId: { activityId: string; sceneId: string } } }) =>
        rows.find(
          (s) =>
            s.activityId === where.activityId_sceneId.activityId &&
            s.sceneId === where.activityId_sceneId.sceneId,
        ) ?? null,
      count: async ({ where }: { where: { activityId: string } }) =>
        rows.filter((s) => s.activityId === where.activityId).length,
    },
    appointmentRecord: {
      findUnique: async ({ where }: { where: { activityId_sceneId_userId: { activityId: string; sceneId: string; userId: string } } }) =>
        records.find((r) => recordKey(r) === recordKey(where.activityId_sceneId_userId)) ?? null,
      findMany: async ({ where }: { where: { activityId: string; userId: string } }) =>
        records.filter((r) => r.activityId === where.activityId && r.userId === where.userId),
    },
    $transaction: async (fn: (t: ReturnType<typeof makeTx>) => Promise<unknown>) => {
      const taken: Scene[] = [];
      try {
        return await fn(makeTx(taken));
      } catch (err) {
        for (const scene of taken) scene.booked -= 1;
        throw err;
      }
    },
  };
  return { service: new AppointmentService(prisma as never), rows, records };
}

const book = (service: AppointmentService, userId: string, sceneId = 'scene_0') =>
  service.book({ activityId: 'a1', sceneId }, userId, NOW);

describe('预约场次', () => {
  it('名额约满即拒绝，已约的人再点返回 already 且不占名额', async () => {
    const { service, rows } = setup([{ capacity: 2 }]);
    await expect(book(service, 'u1')).resolves.toEqual({ booked: true, already: false });
    await expect(book(service, 'u1')).resolves.toEqual({ booked: true, already: true });
    await expect(book(service, 'u2')).resolves.toEqual({ booked: true, already: false });
    await expect(book(service, 'u3')).rejects.toMatchObject({
      response: expect.objectContaining({ reason: 'FULL' }),
    });
    expect(rows[0]!.booked).toBe(2);
  });

  it('并发下同一人重复提交：记录写不进去时占的名额随事务退回', async () => {
    const { service, rows } = setup([{ capacity: 5 }]);
    await Promise.all([book(service, 'u1'), book(service, 'u1'), book(service, 'u1')]);
    expect(rows[0]!.booked).toBe(1);
  });

  it('开场后停止预约；只设结束时间的，到结束为止', async () => {
    const { service } = setup([
      { startAt: new Date('2026-10-20T09:00:00Z') },
      { endAt: new Date('2026-10-20T12:00:00Z') },
    ]);
    await expect(book(service, 'u1', 'scene_0')).rejects.toThrow(/已开始/);
    await expect(book(service, 'u1', 'scene_1')).resolves.toMatchObject({ already: false });
  });

  it('配了场次就只认配置里的；一个没配的早期活动保持不限', async () => {
    const configured = setup([{}]);
    await expect(book(configured.service, 'u1', 'scene_x')).rejects.toBeInstanceOf(BadRequestException);

    const legacy = setup([]);
    await expect(book(legacy.service, 'u1', 'anything')).resolves.toEqual({ booked: true, already: false });
    expect(legacy.records).toHaveLength(1);
  });

  it('C 端列表：剩余名额、状态、这位访问者约过哪些', async () => {
    const { service } = setup([
      { capacity: 1 },
      { capacity: 3, booked: 1 },
      { startAt: new Date('2026-10-20T08:00:00Z') },
    ]);
    await book(service, 'u1', 'scene_0');
    const list = await service.publicList('a1', 'u1', NOW);
    expect(list.map((s) => [s.sceneId, s.status, s.remaining, s.booked])).toEqual([
      ['scene_0', 'full', 0, true],
      ['scene_1', 'open', 2, false],
      ['scene_2', 'closed', null, false],
    ]);
    expect((await service.publicList('a1', undefined, NOW)).every((s) => !s.booked)).toBe(true);
  });

  it('状态判定：已开场优先于约满', () => {
    const past = new Date('2026-10-20T09:00:00Z');
    expect(sceneStatus({ startAt: past, endAt: null, capacity: 1, booked: 1 }, NOW)).toBe('closed');
    expect(sceneStatus({ startAt: null, endAt: null, capacity: 1, booked: 1 }, NOW)).toBe('full');
    expect(sceneStatus({ startAt: null, endAt: null, capacity: null, booked: 99 }, NOW)).toBe('open');
  });
});
