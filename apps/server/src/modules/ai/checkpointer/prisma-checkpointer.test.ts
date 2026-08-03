import { describe, expect, it } from 'vitest';
import { Annotation, Command, START, StateGraph, interrupt } from '@langchain/langgraph';
import { PrismaCheckpointSaver } from './prisma-checkpointer';
import type { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * 用内存假表跑真实的 LangGraph 图。
 *
 * 只断言「存进去能读出来」没什么意义——真正要证明的是这份 MySQL 实现
 * 满足 BaseCheckpointSaver 的契约：图能在 interrupt 处停住，进程拿着
 * 同一个 thread_id 回来 resume 时能从断点接着跑，而不是从头再来一遍。
 */

interface CheckpointRow {
  threadId: string;
  checkpointNs: string;
  checkpointId: string;
  parentCheckpointId: string | null;
  type: string | null;
  checkpoint: Uint8Array;
  metadata: Uint8Array;
}

interface WriteRow {
  threadId: string;
  checkpointNs: string;
  checkpointId: string;
  taskId: string;
  idx: number;
  channel: string;
  type: string | null;
  value: Uint8Array;
}

/** 只实现 checkpointer 真正用到的那几个 Prisma 方法 */
function fakePrisma() {
  const checkpoints: CheckpointRow[] = [];
  const writes: WriteRow[] = [];

  const ckKey = (r: { threadId: string; checkpointNs: string; checkpointId: string }) =>
    `${r.threadId}|${r.checkpointNs}|${r.checkpointId}`;
  const wKey = (r: WriteRow | Record<string, unknown>) =>
    `${r.threadId as string}|${r.checkpointNs as string}|${r.checkpointId as string}|${r.taskId as string}|${r.idx as number}`;

  const matchCheckpoint = (row: CheckpointRow, where: Record<string, unknown>): boolean => {
    for (const [key, expected] of Object.entries(where)) {
      const actual = (row as unknown as Record<string, unknown>)[key];
      if (expected && typeof expected === 'object' && 'lt' in expected) {
        if (!(String(actual) < String((expected as { lt: string }).lt))) return false;
      } else if (actual !== expected) {
        return false;
      }
    }
    return true;
  };

  return {
    _checkpoints: checkpoints,
    _writes: writes,
    aiCheckpoint: {
      findUnique: ({ where }: { where: Record<string, { [k: string]: string }> }) => {
        const k = where.threadId_checkpointNs_checkpointId!;
        const target = `${k.threadId}|${k.checkpointNs}|${k.checkpointId}`;
        return Promise.resolve(checkpoints.find((r) => ckKey(r) === target) ?? null);
      },
      findFirst: ({ where }: { where: Record<string, unknown> }) => {
        const found = checkpoints
          .filter((r) => matchCheckpoint(r, where))
          .sort((a, b) => b.checkpointId.localeCompare(a.checkpointId));
        return Promise.resolve(found[0] ?? null);
      },
      findMany: ({
        where,
        take,
      }: {
        where: Record<string, unknown>;
        orderBy?: unknown;
        take?: number;
      }) => {
        const found = checkpoints
          .filter((r) => matchCheckpoint(r, where))
          .sort((a, b) => b.checkpointId.localeCompare(a.checkpointId));
        return Promise.resolve(take ? found.slice(0, take) : found);
      },
      upsert: ({
        where,
        create,
        update,
      }: {
        where: Record<string, { [k: string]: string }>;
        create: CheckpointRow;
        update: Partial<CheckpointRow>;
      }) => {
        const k = where.threadId_checkpointNs_checkpointId!;
        const at = checkpoints.findIndex(
          (r) =>
            r.threadId === k.threadId &&
            r.checkpointNs === k.checkpointNs &&
            r.checkpointId === k.checkpointId,
        );
        if (at >= 0) Object.assign(checkpoints[at]!, update);
        else checkpoints.push({ ...create });
        return Promise.resolve(create);
      },
      deleteMany: ({ where }: { where: { threadId: string } }) => {
        for (let i = checkpoints.length - 1; i >= 0; i -= 1) {
          if (checkpoints[i]!.threadId === where.threadId) checkpoints.splice(i, 1);
        }
        return Promise.resolve({ count: 0 });
      },
    },
    aiCheckpointWrite: {
      findMany: ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          writes
            .filter((r) =>
              Object.entries(where).every(
                ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v,
              ),
            )
            .sort((a, b) => a.taskId.localeCompare(b.taskId) || a.idx - b.idx),
        ),
      upsert: ({
        where,
        create,
        update,
      }: {
        where: Record<string, Record<string, unknown>>;
        create: WriteRow;
        update: Partial<WriteRow>;
      }) => {
        const k = where.threadId_checkpointNs_checkpointId_taskId_idx!;
        const at = writes.findIndex((r) => wKey(r) === wKey(k));
        if (at >= 0) {
          if (Object.keys(update).length > 0) Object.assign(writes[at]!, update);
        } else {
          writes.push({ ...create });
        }
        return Promise.resolve(create);
      },
      deleteMany: ({ where }: { where: { threadId: string } }) => {
        for (let i = writes.length - 1; i >= 0; i -= 1) {
          if (writes[i]!.threadId === where.threadId) writes.splice(i, 1);
        }
        return Promise.resolve({ count: 0 });
      },
    },
    $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
  };
}

/** 一个会在中间停下来等人的两步图 */
function buildGraph(saver: PrismaCheckpointSaver) {
  const State = Annotation.Root({
    title: Annotation<string>,
    approved: Annotation<boolean>,
    published: Annotation<boolean>,
  });

  return new StateGraph(State)
    .addNode('draft', (state) => ({ title: `${state.title}（已拟稿）` }))
    .addNode('confirm', () => {
      // 发布影响线上，必须人工点头——这就是「AI 开车、人踩刹车」那一脚。
      //
      // 恢复值一律用对象包一层：LangGraph 会把 falsy 的 resume 当成「没给输入」
      // 直接抛 EmptyInputError，`Command({ resume: false })` 是跑不通的。
      // 于是「拒绝」不能写成 false，只能是 { approved: false }。
      const decision = interrupt<{ ask: string }, { approved: boolean }>({ ask: '确认发布吗？' });
      return { approved: decision.approved };
    })
    .addNode('publish', (state) => ({ published: state.approved }))
    .addEdge(START, 'draft')
    .addEdge('draft', 'confirm')
    .addEdge('confirm', 'publish')
    .compile({ checkpointer: saver });
}

describe('PrismaCheckpointSaver', () => {
  it('图在 interrupt 处停住，换一个 saver 实例仍能从断点续跑', async () => {
    const prisma = fakePrisma();
    const config = { configurable: { thread_id: 'run_1' } };

    const first = buildGraph(new PrismaCheckpointSaver(prisma as unknown as PrismaService));
    const paused = await first.invoke({ title: '夏日抽奖' }, config);

    // 停在确认节点：稿子拟好了，但没发布
    expect(paused.title).toBe('夏日抽奖（已拟稿）');
    expect(paused.published).toBeUndefined();
    expect(prisma._checkpoints.length).toBeGreaterThan(0);

    // 换一个实例，模拟「用户隔了一会儿才回来点确认」——甚至服务重启过
    const second = buildGraph(new PrismaCheckpointSaver(prisma as unknown as PrismaService));
    const done = await second.invoke(new Command({ resume: { approved: true } }), config);

    expect(done.approved).toBe(true);
    expect(done.published).toBe(true);
    // 从断点接着跑，而不是重头再拟一次稿
    expect(done.title).toBe('夏日抽奖（已拟稿）');
  });

  it('拒绝时同样从断点继续，只是走出不同结果', async () => {
    const prisma = fakePrisma();
    const config = { configurable: { thread_id: 'run_2' } };
    const graph = buildGraph(new PrismaCheckpointSaver(prisma as unknown as PrismaService));

    await graph.invoke({ title: '活动' }, config);
    const done = await graph.invoke(new Command({ resume: { approved: false } }), config);

    expect(done.approved).toBe(false);
    expect(done.published).toBe(false);
  });

  it('两个 run 各走各的，互不串线', async () => {
    const prisma = fakePrisma();
    const saver = new PrismaCheckpointSaver(prisma as unknown as PrismaService);
    const graph = buildGraph(saver);

    await graph.invoke({ title: 'A' }, { configurable: { thread_id: 'run_a' } });
    await graph.invoke({ title: 'B' }, { configurable: { thread_id: 'run_b' } });

    const a = await graph.invoke(new Command({ resume: { approved: true } }), {
      configurable: { thread_id: 'run_a' },
    });
    const b = await graph.invoke(new Command({ resume: { approved: false } }), {
      configurable: { thread_id: 'run_b' },
    });

    expect(a.title).toBe('A（已拟稿）');
    expect(a.published).toBe(true);
    expect(b.title).toBe('B（已拟稿）');
    expect(b.published).toBe(false);
  });

  it('deleteThread 只清掉这一条线的检查点与中间写入', async () => {
    const prisma = fakePrisma();
    const saver = new PrismaCheckpointSaver(prisma as unknown as PrismaService);
    const graph = buildGraph(saver);

    await graph.invoke({ title: 'A' }, { configurable: { thread_id: 'run_a' } });
    await graph.invoke({ title: 'B' }, { configurable: { thread_id: 'run_b' } });
    expect(prisma._checkpoints.some((r) => r.threadId === 'run_a')).toBe(true);

    await saver.deleteThread('run_a');

    expect(prisma._checkpoints.some((r) => r.threadId === 'run_a')).toBe(false);
    expect(prisma._writes.some((r) => r.threadId === 'run_a')).toBe(false);
    expect(prisma._checkpoints.some((r) => r.threadId === 'run_b')).toBe(true);
  });

  it('getTuple 在没指定版本时回填实际取到的 checkpoint_id', async () => {
    const prisma = fakePrisma();
    const saver = new PrismaCheckpointSaver(prisma as unknown as PrismaService);
    const graph = buildGraph(saver);
    await graph.invoke({ title: 'A' }, { configurable: { thread_id: 'run_x' } });

    const tuple = await saver.getTuple({ configurable: { thread_id: 'run_x' } });

    expect(tuple).toBeDefined();
    // 调用方得知道自己停在哪一版上，否则没法拿它去 resume
    expect(tuple!.config.configurable?.checkpoint_id).toBeTruthy();
  });
});
