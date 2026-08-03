import type Anthropic from '@anthropic-ai/sdk';
import { Annotation, END, START, StateGraph, interrupt } from '@langchain/langgraph';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';
import {
  applyPatches,
  createEmptyDsl,
  dslPatchSchema,
  validateFinalDsl,
  type DslPatch,
  type FinalDsl,
} from '@nca/dsl';
import type { AiEvent, AiInterrupt, AiResume } from '@nca/shared';
import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { DraftService } from '../../dsl/draft.service';
import type { PublishService } from '../../publish/publish.service';
import type { AnthropicClient } from '../llm/anthropic.client';
import type { MaterialCatalog } from '../llm/catalog';
import { buildSystemPrompt, renderPageOutline } from '../llm/prompt';
import { buildTools } from '../llm/tools';
import { requiredEndpoints, resolveInjections } from './injection';

/**
 * 会场搭建工作流。
 *
 * 六张卡片对应六个中断点。选 Workflow 而不是放任 Agent 自由发挥，是因为这条
 * 流程步骤明确、完成条件确定，而且配错了直接影响线上——大框架用图保证可控，
 * 局部（解析需求、规划组件、产出补丁）才交给模型。
 *
 * 两条结构性约束贯穿全文：
 *
 * 1. **副作用只发生在人点头之后**。活动记录要等基本信息与模板都确认过才创建，
 *    否则运营只是打开看一眼，库里就多出一条脏活动。
 *
 * 2. **interrupt 必须独占一个节点**。LangGraph 恢复时会把整个节点从头再跑一遍，
 *    所以 interrupt 前面放任何昂贵或有副作用的动作，都会在 resume 时重复执行
 *    ——多调一次模型、多存一次草稿。准备工作放前一个节点，把卡片写进 state，
 *    确认节点里只剩一句 interrupt。
 */

export interface WorkflowDeps {
  prisma: PrismaService;
  llm: AnthropicClient;
  draft: DraftService;
  publish: PublishService;
  catalog: MaterialCatalog;
  checkpointer: BaseCheckpointSaver;
  userId: string;
  permissions: string[];
  emit: (event: AiEvent) => void;
}

interface Basics {
  title: string;
  description: string;
  startTime: string;
  endTime: string;
}

const last = <T>(_a: T, b: T): T => b;

const AiState = Annotation.Root({
  prompt: Annotation<string>({ reducer: last, default: () => '' }),
  activityId: Annotation<string | null>({ reducer: (a, b) => b ?? a, default: () => null }),
  basics: Annotation<Basics | null>({ reducer: (a, b) => b ?? a, default: () => null }),
  templateId: Annotation<string | null>({ reducer: last, default: () => null }),
  selected: Annotation<string[]>({ reducer: last, default: () => [] }),
  endpoints: Annotation<Record<string, string>>({
    reducer: (a, b) => ({ ...a, ...b }),
    default: () => ({}),
  }),
  summary: Annotation<string>({ reducer: last, default: () => '' }),
  approved: Annotation<boolean>({ reducer: last, default: () => false }),
  published: Annotation<boolean>({ reducer: last, default: () => false }),
  /** 待确认的卡片，由准备节点写、确认节点读 */
  card: Annotation<AiInterrupt | null>({ reducer: last, default: () => null }),
  /** 上一次人工决策，由下一个准备节点消费 */
  answer: Annotation<AiResume | null>({ reducer: last, default: () => null }),
});

type S = typeof AiState.State;

/** 把一条补丁说成人话，用于卡片上的逐条预览 */
function describePatch(patch: DslPatch): string {
  switch (patch.op) {
    case 'addNode':
      return `新增 ${patch.material}（${patch.position.mode} ${patch.position.target}）`;
    case 'updateProps':
      return `修改 ${patch.target} 的 ${Object.keys(patch.props).join('、')}`;
    case 'removeNode':
      return `删除 ${patch.target}`;
    case 'moveNode':
      return `移动 ${patch.target}`;
    case 'setControl':
      return `${patch.control ? '设置' : '清除'} ${patch.target} 的条件/循环`;
    case 'bindEvent':
      return `给 ${patch.target} 绑 ${patch.customEvent ?? patch.trigger}`;
    case 'removeEvent':
      return `解绑事件 ${patch.eventId}`;
    case 'addDataSource':
      return `新增数据源 ${patch.dataSource.id}`;
    case 'removeDataSource':
      return `删除数据源 ${patch.dataSourceId}`;
    case 'setMeta':
      return `更新活动信息 ${Object.keys(patch.meta).join('、')}`;
    case 'setInitialState':
      return `设置初始状态 ${Object.keys(patch.state).join('、')}`;
    default:
      return '未知改动';
  }
}

const BASICS_TOOL: Anthropic.Tool = {
  name: 'propose_basics',
  description: '从运营的描述里提取活动基本信息。信息不足时给出合理的建议值，不要留空。',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '活动名称' },
      description: { type: 'string', description: '一句话活动说明' },
      startTime: { type: 'string', description: '开始时间，ISO 8601' },
      endTime: { type: 'string', description: '结束时间，ISO 8601，必须晚于开始时间' },
    },
    required: ['title', 'description', 'startTime', 'endTime'],
  },
};

function componentsTool(catalog: MaterialCatalog): Anthropic.Tool {
  return {
    name: 'propose_components',
    description: '规划这个活动页需要哪些组件，按从上到下的展示顺序给出。',
    input_schema: {
      type: 'object',
      properties: {
        materials: {
          type: 'array',
          description: '物料名，必须来自可用物料清单',
          items: { type: 'string', enum: [...catalog.names] },
        },
        reason: { type: 'string', description: '一句话说明这样搭的理由' },
      },
      required: ['materials', 'reason'],
    },
  };
}

async function askForTool<T>(
  deps: WorkflowDeps,
  tool: Anthropic.Tool,
  userText: string,
): Promise<T> {
  const turn = await deps.llm.runTurn({
    system: buildSystemPrompt({ catalog: deps.catalog }),
    messages: [{ role: 'user', content: userText }],
    tools: [tool],
    toolChoice: { type: 'tool', name: tool.name },
    onThinking: (delta) => deps.emit({ type: 'thinking', delta }),
  });
  const call = turn.toolUses.find((t) => t.name === tool.name);
  if (!call) throw new Error(`模型没有按要求调用 ${tool.name}`);
  return call.input as T;
}

/**
 * 确认节点：整个函数体只有一句 interrupt。
 * 恢复时这个节点会被重跑，所以它必须什么副作用都没有。
 */
function confirm(state: S) {
  const answer = interrupt<AiInterrupt, AiResume>(state.card!);
  return { answer, card: null };
}

export function buildWorkflow(deps: WorkflowDeps) {
  const graph = new StateGraph(AiState)
    // ── 卡片 1：确认活动基本信息 ──────────────────────────────
    .addNode('intake', async (state: S) => {
      deps.emit({ type: 'status', status: '正在理解你的需求', node: 'intake' });
      const proposed = await askForTool<Basics>(
        deps,
        BASICS_TOOL,
        `运营的需求：${state.prompt}\n\n今天是 ${new Date().toISOString().slice(0, 10)}。`,
      );

      return {
        basics: proposed,
        card: {
          kind: 'edit',
          node: 'intake',
          title: '确认活动基本信息',
          why: '这几项决定活动标题、投放时间与倒计时，后面每一步都基于它们。',
          done: 'AI 已根据你的描述填好，请过一遍。',
          fields: [
            {
              key: 'title',
              label: '活动名称',
              value: proposed.title,
              type: 'text',
              required: true,
            },
            {
              key: 'description',
              label: '活动说明',
              value: proposed.description,
              type: 'textarea',
            },
            {
              key: 'startTime',
              label: '开始时间',
              value: proposed.startTime,
              type: 'datetime',
              required: true,
            },
            {
              key: 'endTime',
              label: '结束时间',
              value: proposed.endTime,
              type: 'datetime',
              required: true,
            },
          ],
        } satisfies AiInterrupt,
      };
    })
    .addNode('intake_confirm', confirm)

    // ── 卡片 2：选模板 ────────────────────────────────────────
    .addNode('template', async (state: S) => {
      const basics = { ...state.basics!, ...(state.answer?.fields as Partial<Basics> | undefined) };

      const templates = await deps.prisma.template.findMany({
        where: { enabled: true },
        orderBy: [{ useCount: 'desc' }],
        take: 12,
        select: { id: true, title: true, cover: true, description: true },
      });

      return {
        basics,
        card: {
          kind: 'respond',
          node: 'template',
          title: '选择会场模板',
          why: '模板决定页面的基础版式与配色，从模板起步比从空白页搭要快得多。',
          missing: templates.length ? undefined : '当前没有可用模板，会从空白页开始。',
          options: [
            { value: '', label: '空白页', description: '从零开始搭' },
            ...templates.map((t) => ({
              value: t.id,
              label: t.title,
              description: t.description ?? undefined,
              cover: t.cover ?? undefined,
            })),
          ],
        } satisfies AiInterrupt,
      };
    })
    .addNode('template_confirm', confirm)

    // ── 第一次写操作：此时已经过两轮人工确认 ──────────────────
    .addNode('create', async (state: S) => {
      const templateId = state.answer?.choices?.[0] || null;
      if (state.activityId) return { templateId };

      deps.emit({ type: 'status', status: '正在创建活动', node: 'create' });
      const basics = state.basics!;
      const activity = await deps.prisma.activity.create({
        data: {
          title: basics.title,
          description: basics.description || null,
          startTime: basics.startTime ? new Date(basics.startTime) : null,
          endTime: basics.endTime ? new Date(basics.endTime) : null,
          ownerId: deps.userId,
        },
        select: { id: true },
      });

      let dsl: FinalDsl = createEmptyDsl(activity.id, basics.title);
      if (templateId) {
        const template = await deps.prisma.template.findUnique({
          where: { id: templateId },
          select: { dsl: true },
        });
        const parsed = template ? validateFinalDsl(template.dsl, { mode: 'draft' }) : null;
        if (parsed?.success) {
          dsl = {
            ...parsed.data,
            meta: { ...parsed.data.meta, activityId: activity.id, title: basics.title },
          };
        }
      }
      await deps.draft.save(activity.id, dsl, deps.userId);
      return { activityId: activity.id, templateId };
    })

    // ── 卡片 3：组件清单（显式选择 + 条件注入）────────────────
    .addNode('plan', async (state: S) => {
      deps.emit({ type: 'status', status: '正在规划页面结构', node: 'plan' });
      const proposed = await askForTool<{ materials: string[]; reason: string }>(
        deps,
        componentsTool(deps.catalog),
        `活动需求：${state.prompt}\n活动名称：${state.basics?.title ?? ''}`,
      );

      const picked = proposed.materials.filter((m) => deps.catalog.names.has(m));
      const injected = resolveInjections(picked, deps.catalog);
      const titleOf = (name: string) =>
        deps.catalog.materials.find((x) => x.name === name)?.title ?? name;

      return {
        card: {
          kind: 'respond',
          node: 'plan',
          title: '确认组件清单',
          why: '勾掉不需要的，或补上 AI 没想到的。清单定了之后才会真正开始搭页面。',
          done: proposed.reason,
          missing: injected.length
            ? `已自动补上：${injected.map((i) => `${i.material}（${i.reason}）`).join('；')}`
            : undefined,
          multiple: true,
          options: [
            ...picked.map((m) => ({ value: m, label: titleOf(m) })),
            ...injected.map((i) => ({
              value: i.material,
              label: titleOf(i.material),
              description: i.reason,
              autoInjected: true,
            })),
          ],
        } satisfies AiInterrupt,
      };
    })
    .addNode('plan_confirm', confirm)

    // ── 卡片 4：补充接口地址 ──────────────────────────────────
    .addNode('fields', (state: S) => {
      const selected = state.answer?.choices?.length ? state.answer.choices : state.selected;
      const needed = requiredEndpoints(selected);
      if (!needed.length) return { selected, card: null };

      return {
        selected,
        card: {
          kind: 'edit',
          node: 'fields',
          title: '补充接口地址',
          why: '抽奖结果、榜单、角色这些数据必须由服务端给出，前端只负责展示。与其让 AI 编一个地址，不如你直接填。',
          missing: '留空的会先用占位地址，上线前需要补齐。',
          fields: needed.map((item) => ({
            key: item.key,
            label: item.label,
            value: `/api/${item.key}`,
            type: 'text' as const,
          })),
        } satisfies AiInterrupt,
      };
    })
    .addNode('fields_confirm', confirm)

    // ── 卡片 5：搭页面并预览 ──────────────────────────────────
    .addNode('build', async (state: S) => {
      const endpoints = state.answer?.fields ?? {};
      deps.emit({ type: 'status', status: '正在生成页面', node: 'build' });

      const activityId = state.activityId!;
      const current = await deps.draft.get(activityId);
      const endpointText = Object.entries({ ...state.endpoints, ...endpoints })
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n');

      const turn = await deps.llm.runTurn({
        system: buildSystemPrompt({ catalog: deps.catalog }),
        messages: [
          {
            role: 'user',
            content: [
              `运营需求：${state.prompt}`,
              `确认过的组件清单：${state.selected.join('、')}`,
              endpointText ? `已确认的接口地址：\n${endpointText}` : '',
              '',
              '当前页面：',
              renderPageOutline(current),
              '',
              '请调用 apply_patches 把页面搭出来。一次给全，不要分多次。',
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
        tools: buildTools(deps.permissions),
        toolChoice: { type: 'tool', name: 'apply_patches' },
        onThinking: (delta) => deps.emit({ type: 'thinking', delta }),
        onText: (delta) => deps.emit({ type: 'text', delta }),
      });

      const call = turn.toolUses.find((t) => t.name === 'apply_patches');
      if (!call) throw new Error('模型没有产出任何页面改动');
      const input = call.input as { summary: string; patches: unknown[] };

      // 逐条过协议：模型写错一条不该毁掉整批
      const patches: DslPatch[] = [];
      const rejected: string[] = [];
      for (const [i, raw] of input.patches.entries()) {
        const parsed = dslPatchSchema.safeParse(raw);
        if (parsed.success) patches.push(parsed.data);
        else rejected.push(`第 ${i + 1} 条：${parsed.error.issues[0]?.message ?? '结构错误'}`);
      }

      const result = applyPatches(current, patches, {
        knownMaterials: deps.catalog.names,
        containerMaterials: deps.catalog.containers,
      });
      const issues = [...rejected, ...result.issues.map((i) => i.message)];
      const preview = patches.map((p) => ({ op: p.op, text: describePatch(p) }));

      deps.emit({ type: 'patch', summary: input.summary, patches: preview, issues });
      // 草稿允许「还没填完」，先存下来让运营在预览里看到真东西
      await deps.draft.save(activityId, result.dsl, deps.userId);
      deps.emit({ type: 'dsl', dsl: result.dsl });

      return {
        endpoints,
        summary: input.summary,
        card: {
          kind: 'approve',
          node: 'build',
          title: '预览并确认',
          why: '右侧就是线上会长的样子。确认后进入发布环节，放弃则回到组件清单重来。',
          done: `${input.summary}（生效 ${result.applied} 条改动）`,
          missing: issues.length
            ? `有 ${issues.length} 处没能生效：${issues.slice(0, 3).join('；')}`
            : undefined,
          summary: input.summary,
          patches: preview,
        } satisfies AiInterrupt,
      };
    })
    .addNode('build_confirm', confirm)

    // ── 卡片 6：确认发布 ──────────────────────────────────────
    .addNode('publish_ask', (state: S) => ({
      approved: state.answer?.decision === 'approve',
      card: {
        kind: 'approve',
        node: 'publish',
        title: '确认发布上线',
        why: '发布会立刻影响线上访问，这一步必须由人来点。',
        done: state.summary,
        dangerous: true,
      } satisfies AiInterrupt,
    }))
    .addNode('publish_confirm', confirm)

    .addNode('publish_do', async (state: S) => {
      if (state.answer?.decision !== 'approve') {
        deps.emit({ type: 'status', status: '已保存为草稿，未发布', node: 'publish' });
        return { published: false };
      }
      deps.emit({ type: 'status', status: '正在发布', node: 'publish' });
      await deps.publish.publish(
        state.activityId!,
        deps.userId,
        state.answer.message ?? 'AI 助手发布',
      );
      return { published: true };
    })

    .addEdge(START, 'intake')
    .addEdge('intake', 'intake_confirm')
    .addEdge('intake_confirm', 'template')
    .addEdge('template', 'template_confirm')
    .addEdge('template_confirm', 'create')
    .addEdge('create', 'plan')
    .addEdge('plan', 'plan_confirm')
    .addEdge('plan_confirm', 'fields')
    // 没有要补的字段就别硬塞一张空卡片给运营
    .addConditionalEdges('fields', (state: S) => (state.card ? 'ask' : 'skip'), {
      ask: 'fields_confirm',
      skip: 'build',
    })
    .addEdge('fields_confirm', 'build')
    .addEdge('build', 'build_confirm')
    // 预览被否掉就退回组件清单，而不是整条流程重来
    .addConditionalEdges(
      'build_confirm',
      (state: S) => (state.answer?.decision === 'reject' ? 'again' : 'next'),
      { again: 'plan', next: 'publish_ask' },
    )
    .addEdge('publish_ask', 'publish_confirm')
    .addEdge('publish_confirm', 'publish_do')
    .addEdge('publish_do', END);

  return graph.compile({ checkpointer: deps.checkpointer });
}
