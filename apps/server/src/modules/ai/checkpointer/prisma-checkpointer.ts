import type { RunnableConfig } from '@langchain/core/runnables';
import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
} from '@langchain/langgraph-checkpoint';
import type { PrismaService } from '../../../common/prisma/prisma.service';

/**
 * LangGraph 的 MySQL 检查点存储。
 *
 * 官方只给了 SQLite / Postgres / Redis 三种实现，本项目是 MySQL，只能自己补。
 * 之所以不退而求其次用 MemorySaver：中断等待的是人的决策，可能几分钟，也可能
 * 隔一夜再回来点「确认发布」。进程内存活不过一次重启，而 Redis 的 TTL 语义
 * 跟「等人」根本对不上——真正需要的是持久化 + 可审计，那就是数据库。
 *
 * 表结构与字段名刻意对齐官方实现，将来官方出了 MySQL 版，数据可以平移过去。
 */
export class PrismaCheckpointSaver extends BaseCheckpointSaver {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  private static ns(config: RunnableConfig): string {
    return (config.configurable?.checkpoint_ns as string | undefined) ?? '';
  }

  private static threadId(config: RunnableConfig, op: string): string {
    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) {
      throw new Error(`${op} 缺少 thread_id：使用 checkpointer 时必须在 configurable 里带上它`);
    }
    return threadId;
  }

  /**
   * Prisma 的 Bytes 要的是 ArrayBuffer 支撑的 Uint8Array，而 serde 吐出来的
   * 可能落在 SharedArrayBuffer 上。顺手拷一份，也省得和 serde 共享同一块内存。
   */
  private toBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    return copy;
  }

  /** 把一行检查点连同它的 pendingWrites 组装成 LangGraph 要的元组 */
  private async toTuple(
    row: {
      threadId: string;
      checkpointNs: string;
      checkpointId: string;
      parentCheckpointId: string | null;
      type: string | null;
      checkpoint: Uint8Array;
      metadata: Uint8Array;
    },
    config: RunnableConfig,
  ): Promise<CheckpointTuple> {
    const type = row.type ?? 'json';
    const writes = await this.prisma.aiCheckpointWrite.findMany({
      where: {
        threadId: row.threadId,
        checkpointNs: row.checkpointNs,
        checkpointId: row.checkpointId,
      },
      orderBy: [{ taskId: 'asc' }, { idx: 'asc' }],
    });

    const pendingWrites = await Promise.all(
      writes.map(
        async (w) =>
          [w.taskId, w.channel, await this.serde.loadsTyped(w.type ?? 'json', w.value)] as [
            string,
            string,
            unknown,
          ],
      ),
    );

    const tuple: CheckpointTuple = {
      config,
      checkpoint: (await this.serde.loadsTyped(type, row.checkpoint)) as Checkpoint,
      metadata: (await this.serde.loadsTyped(type, row.metadata)) as CheckpointMetadata,
      pendingWrites,
    };

    if (row.parentCheckpointId) {
      tuple.parentConfig = {
        configurable: {
          thread_id: row.threadId,
          checkpoint_ns: row.checkpointNs,
          checkpoint_id: row.parentCheckpointId,
        },
      };
    }
    return tuple;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id as string | undefined;
    if (!threadId) return undefined;
    const checkpointNs = PrismaCheckpointSaver.ns(config);
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;

    // 指定了 id 就取那一版，否则取最新的一版。
    // checkpointId 是 uuid6，字典序即时间序，直接倒排就是最新。
    const row = checkpointId
      ? await this.prisma.aiCheckpoint.findUnique({
          where: {
            threadId_checkpointNs_checkpointId: { threadId, checkpointNs, checkpointId },
          },
        })
      : await this.prisma.aiCheckpoint.findFirst({
          where: { threadId, checkpointNs },
          orderBy: { checkpointId: 'desc' },
        });

    if (!row) return undefined;

    // 没指定 id 时要把实际取到的 id 回填进 config，否则调用方拿不到自己在哪一版上
    const resolved: RunnableConfig = checkpointId
      ? config
      : {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            checkpoint_id: row.checkpointId,
          },
        };

    return this.toTuple(row, resolved);
  }

  async *list(
    config: RunnableConfig,
    options?: CheckpointListOptions,
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id as string | undefined;
    const checkpointNs = config.configurable?.checkpoint_ns as string | undefined;
    const before = options?.before?.configurable?.checkpoint_id as string | undefined;

    const rows = await this.prisma.aiCheckpoint.findMany({
      where: {
        ...(threadId ? { threadId } : {}),
        ...(checkpointNs !== undefined ? { checkpointNs } : {}),
        ...(before ? { checkpointId: { lt: before } } : {}),
      },
      orderBy: { checkpointId: 'desc' },
      ...(options?.limit ? { take: options.limit } : {}),
    });

    for (const row of rows) {
      const tuple = await this.toTuple(row, {
        configurable: {
          thread_id: row.threadId,
          checkpoint_ns: row.checkpointNs,
          checkpoint_id: row.checkpointId,
        },
      });

      // filter 作用在 metadata 上，交给调用方按需筛
      if (options?.filter) {
        const metadata = (tuple.metadata ?? {}) as Record<string, unknown>;
        const matched = Object.entries(options.filter).every(
          ([key, value]) => metadata[key] === value,
        );
        if (!matched) continue;
      }
      yield tuple;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<RunnableConfig> {
    const threadId = PrismaCheckpointSaver.threadId(config, '保存检查点');
    const checkpointNs = PrismaCheckpointSaver.ns(config);
    const parentCheckpointId = config.configurable?.checkpoint_id as string | undefined;

    const [[type, serializedCheckpoint], [, serializedMetadata]] = await Promise.all([
      this.serde.dumpsTyped(checkpoint),
      this.serde.dumpsTyped(metadata),
    ]);

    const data = {
      parentCheckpointId: parentCheckpointId ?? null,
      type,
      checkpoint: this.toBytes(serializedCheckpoint),
      metadata: this.toBytes(serializedMetadata),
    };

    await this.prisma.aiCheckpoint.upsert({
      where: {
        threadId_checkpointNs_checkpointId: {
          threadId,
          checkpointNs,
          checkpointId: checkpoint.id,
        },
      },
      create: { threadId, checkpointNs, checkpointId: checkpoint.id, ...data },
      update: data,
    });

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = PrismaCheckpointSaver.threadId(config, '保存中间写入');
    const checkpointNs = PrismaCheckpointSaver.ns(config);
    const checkpointId = config.configurable?.checkpoint_id as string | undefined;
    if (!checkpointId) throw new Error('保存中间写入缺少 checkpoint_id');

    for (const [i, [channel, value]] of writes.entries()) {
      // 保留通道（error / scheduled / interrupt / resume）用固定负数下标，
      // 同一个 task 重跑时应该覆盖；普通通道先到先得，不能被后来的覆盖。
      const idx = WRITES_IDX_MAP[channel] ?? i;
      const [type, serialized] = await this.serde.dumpsTyped(value);
      const payload = { channel, type, value: this.toBytes(serialized) };

      await this.prisma.aiCheckpointWrite.upsert({
        where: {
          threadId_checkpointNs_checkpointId_taskId_idx: {
            threadId,
            checkpointNs,
            checkpointId,
            taskId,
            idx,
          },
        },
        create: { threadId, checkpointNs, checkpointId, taskId, idx, ...payload },
        update: idx < 0 ? payload : {},
      });
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.aiCheckpointWrite.deleteMany({ where: { threadId } }),
      this.prisma.aiCheckpoint.deleteMany({ where: { threadId } }),
    ]);
  }
}
