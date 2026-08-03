import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command, MemorySaver } from '@langchain/langgraph';
import { createEmptyDsl } from '@nca/dsl';
import type { AiEvent, AiInterrupt, AiResume } from '@nca/shared';
import { buildWorkflow, type WorkflowDeps } from './graph';
import type { MaterialCatalog } from '../llm/catalog';

/**
 * 这条流程最要紧的性质不是「能跑通」，而是**副作用的时机**：
 * 在运营明确点头之前，系统不能凭空创建活动、不能写草稿、更不能发布。
 * 第一版踩过的坑就是某个组件在初始化时偷偷调了保存接口——运营只是打开
 * 看一眼，数据库里就多出一条脏活动。这里把顺序钉死。
 */

const CATALOG: MaterialCatalog = {
  materials: [
    { name: 'Lottery', title: '抽奖' },
    { name: 'Login', title: '登录' },
    { name: 'Modal', title: '弹窗' },
    { name: 'Text', title: '文本' },
  ] as unknown as MaterialCatalog['materials'],
  names: new Set(['Lottery', 'Login', 'Modal', 'Text']),
  containers: new Set(['Page', 'Modal']),
  text: '（测试用物料清单）',
};

function makeDeps(overrides: Partial<WorkflowDeps> = {}) {
  const events: AiEvent[] = [];
  const activityCreate = vi.fn().mockResolvedValue({ id: 'act_new' });
  const draftSave = vi.fn().mockResolvedValue({ updatedAt: '', issues: [] });
  const publish = vi.fn().mockResolvedValue({ version: 1 });

  // 模型永远按要求返回结构化结果，把不确定性挡在测试之外
  const llm = {
    runTurn: vi.fn(async ({ toolChoice }: { toolChoice?: { name?: string } }) => {
      const name = toolChoice?.name;
      const input =
        name === 'propose_basics'
          ? {
              title: '夏日狂欢抽奖',
              description: '夏日抽奖活动',
              startTime: '2026-07-01T00:00:00.000Z',
              endTime: '2026-07-31T23:59:59.000Z',
            }
          : name === 'propose_components'
            ? { materials: ['Lottery', 'Text'], reason: '抽奖为主，配一段说明' }
            : {
                summary: '搭好了抽奖主体',
                patches: [
                  {
                    op: 'addNode',
                    ref: '@t',
                    material: 'Text',
                    position: { mode: 'appendTo', target: 'ROOT' },
                  },
                ],
              };
      return {
        text: '',
        thinking: '',
        toolUses: [{ id: 'tu_1', name: name ?? 'apply_patches', input }],
        stopReason: 'tool_use',
        content: [],
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      };
    }),
  };

  const deps: WorkflowDeps = {
    prisma: {
      template: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn() },
      activity: { create: activityCreate },
    } as unknown as WorkflowDeps['prisma'],
    llm: llm as unknown as WorkflowDeps['llm'],
    draft: {
      get: vi.fn().mockResolvedValue(createEmptyDsl('act_new', '夏日狂欢抽奖')),
      save: draftSave,
    } as unknown as WorkflowDeps['draft'],
    publish: { publish } as unknown as WorkflowDeps['publish'],
    catalog: CATALOG,
    checkpointer: new MemorySaver(),
    userId: 'user_1',
    permissions: ['ai:use', 'ai:publish'],
    emit: (e) => events.push(e),
    ...overrides,
  };

  return { deps, events, activityCreate, draftSave, publish, llm };
}

const CONFIG = { configurable: { thread_id: 'run_test' } };

type Graph = ReturnType<typeof buildWorkflow>;

/**
 * 当前挂起的卡片从图快照里读，而不是等节点 emit——
 * 恢复时节点会被重跑，节点内 emit 会把同一张卡片重复报出来。
 * 服务端也是这么读的，测试跟着走同一条路。
 */
async function pendingCard(graph: Graph): Promise<AiInterrupt | undefined> {
  const snapshot = await graph.getState(CONFIG);
  return snapshot.tasks
    .flatMap((task) => task.interrupts ?? [])
    .map((item) => (item as { value?: unknown }).value as AiInterrupt | undefined)
    .find(Boolean);
}

describe('会场搭建工作流', () => {
  let ctx: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    ctx = makeDeps();
  });

  const resume = (graph: ReturnType<typeof buildWorkflow>, value: AiResume) =>
    graph.invoke(new Command({ resume: value }) as never, CONFIG);

  it('六张卡片按顺序出现，每一步都停下来等人', async () => {
    const graph = buildWorkflow(ctx.deps);
    const seen: string[] = [];
    const record = async () => {
      const card = await pendingCard(graph);
      if (card) seen.push(card.node);
    };

    await graph.invoke({ prompt: '做个夏日抽奖活动' }, CONFIG);
    await record();
    expect(seen).toEqual(['intake']);

    await resume(graph, { decision: 'edit', fields: { title: '夏日狂欢抽奖' } });
    await record();
    await resume(graph, { decision: 'respond', choices: [''] });
    await record();
    await resume(graph, { decision: 'respond', choices: ['Lottery', 'Text', 'Login'] });
    await record();
    await resume(graph, { decision: 'edit', fields: { prizes: '/api/prizes', draw: '/api/draw' } });
    await record();
    await resume(graph, { decision: 'approve' });
    await record();

    expect(seen).toEqual(['intake', 'template', 'plan', 'fields', 'build', 'publish']);
  });

  it('恢复不会把上一个节点重跑一遍：模型只被调用该调用的次数', async () => {
    const graph = buildWorkflow(ctx.deps);

    await graph.invoke({ prompt: '做个抽奖' }, CONFIG);
    await resume(graph, { decision: 'edit', fields: {} });
    await resume(graph, { decision: 'respond', choices: [''] });
    await resume(graph, { decision: 'respond', choices: ['Lottery'] });
    await resume(graph, { decision: 'edit', fields: {} });

    // 一轮下来只该有三次模型调用：解析需求、规划组件、产出补丁。
    // interrupt 若和昂贵动作挤在同一个节点里，每次 resume 都会多调一次，
    // 草稿也会被多存一次——这正是把确认节点单独拆出来的原因。
    expect(ctx.llm.runTurn).toHaveBeenCalledTimes(3);
    expect(ctx.draftSave).toHaveBeenCalledTimes(2); // 建活动时一次，搭完页面一次
  });

  it('活动记录要等基本信息与模板都确认过才创建', async () => {
    const graph = buildWorkflow(ctx.deps);

    await graph.invoke({ prompt: '做个抽奖' }, CONFIG);
    // 只是问了第一张卡片，什么都还没写
    expect(ctx.activityCreate).not.toHaveBeenCalled();
    expect(ctx.draftSave).not.toHaveBeenCalled();

    await resume(graph, { decision: 'edit', fields: {} });
    // 确认完基本信息，仍然不该写——还要先选模板
    expect(ctx.activityCreate).not.toHaveBeenCalled();

    await resume(graph, { decision: 'respond', choices: [''] });
    // 两轮确认都过了，这时才落库
    expect(ctx.activityCreate).toHaveBeenCalledTimes(1);
  });

  it('发布必须人工点头，拒绝就只留草稿', async () => {
    const graph = buildWorkflow(ctx.deps);

    await graph.invoke({ prompt: '做个抽奖' }, CONFIG);
    await resume(graph, { decision: 'edit', fields: {} });
    await resume(graph, { decision: 'respond', choices: [''] });
    await resume(graph, { decision: 'respond', choices: ['Lottery'] });
    await resume(graph, { decision: 'edit', fields: {} });
    await resume(graph, { decision: 'approve' });

    // 停在发布确认上，还没发
    expect(ctx.publish).not.toHaveBeenCalled();

    const final = await resume(graph, { decision: 'reject' });
    expect(ctx.publish).not.toHaveBeenCalled();
    expect(final.published).toBe(false);
    // 草稿是存过的，运营回设计器还能接着改
    expect(ctx.draftSave).toHaveBeenCalled();
  });

  it('确认发布才真的发布', async () => {
    const graph = buildWorkflow(ctx.deps);

    await graph.invoke({ prompt: '做个抽奖' }, CONFIG);
    await resume(graph, { decision: 'edit', fields: {} });
    await resume(graph, { decision: 'respond', choices: [''] });
    await resume(graph, { decision: 'respond', choices: ['Lottery'] });
    await resume(graph, { decision: 'edit', fields: {} });
    await resume(graph, { decision: 'approve' });
    const final = await resume(graph, { decision: 'approve' });

    expect(ctx.publish).toHaveBeenCalledWith('act_new', 'user_1', expect.any(String));
    expect(final.published).toBe(true);
  });

  it('预览被否掉是退回组件清单，不是整条流程重来', async () => {
    const graph = buildWorkflow(ctx.deps);

    await graph.invoke({ prompt: '做个抽奖' }, CONFIG);
    await resume(graph, { decision: 'edit', fields: {} });
    await resume(graph, { decision: 'respond', choices: [''] });
    await resume(graph, { decision: 'respond', choices: ['Lottery'] });
    await resume(graph, { decision: 'edit', fields: {} });
    await resume(graph, { decision: 'reject' });

    // 回到 plan 再问一次组件，而不是回到 intake 重问活动名称
    expect((await pendingCard(graph))?.node).toBe('plan');
    expect(ctx.activityCreate).toHaveBeenCalledTimes(1);
  });

  it('勾了抽奖会自动补上登录入口，并在卡片上说明原因', async () => {
    const graph = buildWorkflow(ctx.deps);

    await graph.invoke({ prompt: '做个抽奖' }, CONFIG);
    await resume(graph, { decision: 'edit', fields: {} });
    await resume(graph, { decision: 'respond', choices: [''] });

    const planCard = (await pendingCard(graph))!;
    expect(planCard.node).toBe('plan');
    const injected = planCard.options!.filter((o) => o.autoInjected);
    expect(injected.map((o) => o.value)).toContain('Login');
    // 系统替运营做的决定必须说清楚，不能悄悄加进去
    expect(planCard.missing).toContain('Login');
  });
});
