import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type Anthropic from '@anthropic-ai/sdk';
import { Command } from '@langchain/langgraph';
import { applyPatches, dslPatchSchema, type DslPatch, type FinalDsl } from '@nca/dsl';
import { PERMISSION, type AiEvent, type AiInterrupt, type AiResume } from '@nca/shared';
// Prisma.JsonNull 是值不是类型，这里不能用 import type
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DraftService } from '../dsl/draft.service';
import { PublishService } from '../publish/publish.service';
import { PrismaCheckpointSaver } from './checkpointer/prisma-checkpointer';
import { AnthropicClient, LlmRefusalError, replayAssistantContent } from './llm/anthropic.client';
import { loadMaterialCatalog, type MaterialCatalog } from './llm/catalog';
import { buildSystemPrompt, renderPageOutline } from './llm/prompt';
import { buildTools } from './llm/tools';
import { buildWorkflow } from './workflow/graph';
import type { EditDto, StartRunDto } from './ai.dto';

/**
 * 把图里 push 出来的事件桥接成可以 for await 的流。
 * SSE 那头是拉模型，LangGraph 这头是推模型，中间需要一个小队列。
 */
class EventQueue {
  private readonly items: AiEvent[] = [];
  private wake?: () => void;
  private closed = false;

  push(event: AiEvent): void {
    this.items.push(event);
    this.wake?.();
    this.wake = undefined;
  }

  close(): void {
    this.closed = true;
    this.wake?.();
    this.wake = undefined;
  }

  async *drain(): AsyncGenerator<AiEvent> {
    for (;;) {
      while (this.items.length) yield this.items.shift()!;
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly checkpointer: PrismaCheckpointSaver;
  private catalogCache?: MaterialCatalog;

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: AnthropicClient,
    private readonly draft: DraftService,
    private readonly publish: PublishService,
  ) {
    this.checkpointer = new PrismaCheckpointSaver(prisma);
  }

  /** 物料清单随发版才变，一个进程里缓存住即可 */
  private async catalog(): Promise<MaterialCatalog> {
    this.catalogCache ??= await loadMaterialCatalog(this.prisma);
    return this.catalogCache;
  }

  async start(dto: StartRunDto, userId: string): Promise<{ id: string }> {
    const run = await this.prisma.aiRun.create({
      data: {
        activityId: dto.activityId ?? null,
        scenario: dto.scenario,
        title: dto.prompt.slice(0, 60),
        createdBy: userId,
      },
      select: { id: true },
    });
    await this.step(run.id, 'message', { prompt: dto.prompt });
    return run;
  }

  async detail(runId: string, userId: string) {
    const run = await this.prisma.aiRun.findUnique({
      where: { id: runId },
      include: { steps: { orderBy: { seq: 'asc' } } },
    });
    if (!run) throw new NotFoundException('运行记录不存在');
    if (run.createdBy && run.createdBy !== userId) {
      throw new ForbiddenException('无权查看他人的 AI 运行记录');
    }
    return run;
  }

  /** 每个节点/每次决策落一条，前端断线重连靠它补齐前情，不依赖 SSE 重放 */
  private async step(runId: string, kind: string, payload: unknown, node?: string): Promise<void> {
    const last = await this.prisma.aiRunStep.findFirst({
      where: { runId },
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    await this.prisma.aiRunStep.create({
      data: {
        runId,
        seq: (last?.seq ?? 0) + 1,
        kind,
        node: node ?? null,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * 驱动一次运行：没有 resume 就是从头跑，有 resume 就是从断点续。
   * 两种情况共用一个入口——对 LangGraph 来说本来就是同一件事。
   */
  async *run(
    runId: string,
    userId: string,
    permissions: string[],
    resume?: AiResume,
  ): AsyncGenerator<AiEvent> {
    const run = await this.detail(runId, userId);
    const queue = new EventQueue();
    const catalog = await this.catalog();

    const emit = (event: AiEvent): void => queue.push(event);

    const graph = buildWorkflow({
      prisma: this.prisma,
      llm: this.llm,
      draft: this.draft,
      publish: this.publish,
      catalog,
      checkpointer: this.checkpointer,
      userId,
      permissions,
      emit,
    });

    const config = { configurable: { thread_id: runId } };
    const prompt = (run.steps.find((s) => s.kind === 'message')?.payload as { prompt?: string })
      ?.prompt;

    // 恢复值一律是对象：LangGraph 把 falsy 的 resume 当成没给输入，会直接抛错。
    // Command 的节点名泛型推不进这个联合，这里断言成 invoke 自己的入参类型。
    type GraphInput = Parameters<typeof graph.invoke>[0];
    const input = (resume ? new Command({ resume }) : { prompt: prompt ?? '' }) as GraphInput;

    const task = (async () => {
      try {
        await this.prisma.aiRun.update({
          where: { id: runId },
          data: { status: 'running', interrupt: Prisma.JsonNull },
        });
        if (resume) await this.step(runId, 'resume', resume);

        await graph.invoke(input, config);

        // 中断卡片统一从快照里读，不由节点自己 emit：
        // 恢复时节点会被重跑一遍，节点内 emit 会把同一张卡片重复推给前端
        const snapshot = await graph.getState(config);
        const pending = snapshot.tasks
          .flatMap((task) => task.interrupts ?? [])
          .map((item) => (item as { value?: unknown }).value as AiInterrupt | undefined)
          .filter((card): card is AiInterrupt => Boolean(card));

        for (const card of pending) {
          queue.push({ type: 'interrupt', interrupt: card });
          await this.step(runId, 'interrupt', card, card.node);
        }

        if (pending.length) {
          await this.prisma.aiRun.update({
            where: { id: runId },
            data: {
              status: 'interrupted',
              interrupt: pending[0] as unknown as Prisma.InputJsonValue,
            },
          });
        } else if (snapshot.next.length === 0) {
          // next 为空且没有待确认卡片，说明整张图跑完了
          await this.prisma.aiRun.update({
            where: { id: runId },
            data: { status: 'succeeded', interrupt: Prisma.JsonNull },
          });
          queue.push({ type: 'done', status: 'succeeded' });
        }
      } catch (err) {
        const message =
          err instanceof LlmRefusalError
            ? err.message
            : err instanceof Error
              ? err.message
              : '生成失败';
        this.logger.error(`AI 运行失败 run=${runId}`, err);
        await this.prisma.aiRun
          .update({ where: { id: runId }, data: { status: 'failed', error: message } })
          .catch(() => undefined);
        await this.step(runId, 'error', { message }).catch(() => undefined);
        queue.push({ type: 'error', message });
      } finally {
        queue.close();
      }
    })();

    yield* queue.drain();
    await task;
  }

  /**
   * 设计器里的局部编辑：不走工作流，一次问答产出一批补丁。
   *
   * 与工作台的区别在于这里没有「流程」可言——运营选中一个组件说「改成红色」，
   * 要的就是立刻看到 diff，然后自己决定应不应用。中断确认交给前端的应用按钮，
   * 服务端只管产出与校验。
   */
  async *edit(dto: EditDto, userId: string, permissions: string[]): AsyncGenerator<AiEvent> {
    if (
      !permissions.includes(PERMISSION.AI_USE) &&
      !permissions.includes(PERMISSION.SYSTEM_MANAGE)
    ) {
      throw new ForbiddenException('缺少 ai:use 权限');
    }
    const catalog = await this.catalog();
    const current = await this.draft.get(dto.activityId);
    const queue = new EventQueue();

    const task = (async () => {
      try {
        const focus = dto.selectedNodeId
          ? `运营当前选中的是节点 ${dto.selectedNodeId}（${current.craftJson[dto.selectedNodeId]?.type.resolvedName ?? '未知'}），没有特别说明时改动应聚焦在它身上。`
          : '';

        const messages: Anthropic.MessageParam[] = [
          {
            role: 'user',
            content: [
              `运营的要求：${dto.instruction}`,
              focus,
              '',
              '当前页面：',
              renderPageOutline(current),
              '',
              '请调用 apply_patches 完成这次修改。只改需要改的部分。',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ];
        // auto 模式下只留 apply_patches 一个工具，避免模型在局部编辑时
        // 跑去 read_page 再回来，触发 tool_calls 必须跟 tool_result 的协议约束
        const tools =
          this.llm.toolChoiceMode === 'auto'
            ? buildTools(permissions).filter((t) => t.name === 'apply_patches')
            : buildTools(permissions);
        let turn = await this.llm.runTurn({
          system: buildSystemPrompt({ catalog }),
          messages,
          tools,
          toolChoice: { type: 'tool', name: 'apply_patches' },
          onThinking: (delta) => queue.push({ type: 'thinking', delta }),
          onText: (delta) => queue.push({ type: 'text', delta }),
        });

        let call = turn.toolUses.find((t) => t.name === 'apply_patches');
        if (!call) {
          // auto 模式下模型可能只回了文字；回放（去 thinking）后再要求一次
          const retry = await this.llm.runTurn({
            system: buildSystemPrompt({ catalog }),
            messages: [
              ...messages,
              { role: 'assistant', content: replayAssistantContent(turn) },
              {
                role: 'user',
                content:
                  '你上一条没有调用 apply_patches。请直接调用 apply_patches 产出改动，不要回复文字或调用其他工具。',
              },
            ],
            tools,
            toolChoice: { type: 'tool', name: 'apply_patches' },
            onThinking: (delta) => queue.push({ type: 'thinking', delta }),
            onText: (delta) => queue.push({ type: 'text', delta }),
          });
          call = retry.toolUses.find((t) => t.name === 'apply_patches');
        }
        if (!call) throw new Error('模型没有产出任何改动');
        const input = call.input as { summary: string; patches: unknown[] };

        const patches: DslPatch[] = [];
        const rejected: string[] = [];
        for (const [i, raw] of input.patches.entries()) {
          const parsed = dslPatchSchema.safeParse(raw);
          if (parsed.success) patches.push(parsed.data);
          else rejected.push(`第 ${i + 1} 条：${parsed.error.issues[0]?.message ?? '结构错误'}`);
        }

        const result = applyPatches(current, patches, {
          knownMaterials: catalog.names,
          containerMaterials: catalog.containers,
        });

        queue.push({
          type: 'patch',
          summary: input.summary,
          patches: patches.map((p) => ({ op: p.op, text: p.op })),
          issues: [...rejected, ...result.issues.map((i) => i.message)],
        });
        // 不落库：应不应用由运营在设计器里点，服务端只负责算出结果
        queue.push({ type: 'dsl', dsl: result.dsl satisfies FinalDsl });
        queue.push({ type: 'done', status: 'succeeded' });
      } catch (err) {
        const message = err instanceof Error ? err.message : '生成失败';
        this.logger.error(`AI 局部编辑失败 activity=${dto.activityId}`, err);
        queue.push({ type: 'error', message });
      } finally {
        queue.close();
      }
    })();

    yield* queue.drain();
    await task;
  }
}
