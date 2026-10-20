import type Anthropic from '@anthropic-ai/sdk';
import {
  applyPatches,
  dslPatchSchema,
  type ApplyPatchesOptions,
  type DslPatch,
  type FinalDsl,
} from '@nca/dsl';
import { replayAssistantContent, type AnthropicClient, type LlmTurn } from './anthropic.client';
import { renderPageOutline } from './prompt';

/** 看到报错后最多再改几轮。每轮都是一次完整的模型调用，给多了只是在烧钱等一个改不对的结果 */
export const MAX_FIX_ROUNDS = 2;

export interface PatchLoopParams {
  llm: Pick<AnthropicClient, 'runTurn'>;
  system: Anthropic.TextBlockParam[];
  tools: Anthropic.Tool[];
  /** 第一轮的用户消息（需求 + 当前页面大纲） */
  messages: Anthropic.MessageParam[];
  current: FinalDsl;
  applyOptions: ApplyPatchesOptions;
  maxFixRounds?: number;
  onThinking?: (delta: string) => void;
  onText?: (delta: string) => void;
  /** 进入修正轮之前回调，调用方可借此提示「正在修正 N 处问题」 */
  onFix?: (round: number, issues: string[]) => void;
}

export interface PatchLoopResult {
  /** 第一轮的改动说明——修正轮只是补漏，说明以第一轮为准 */
  summary: string;
  dsl: FinalDsl;
  /** 各轮通过协议校验的补丁，按顺序 */
  patches: DslPatch[];
  /** 真正生效的补丁数 */
  applied: number;
  /** 最后一轮仍没生效的问题 */
  issues: string[];
  /** 一共调了几轮 apply_patches（1 = 一次就对） */
  rounds: number;
}

/**
 * 让模型调 apply_patches 出补丁并应用；有补丁没生效时，把问题作为这次工具调用的结果回给模型，
 * 让它在已生效的基础上只出修正补丁，最多 maxFixRounds 轮。
 *
 * 修正轮是同一段对话的延续：assistant 消息原样带回（thinking / tool_use 块都在，开着思考时 API 要求），
 * 紧跟着 user 消息里放每个 tool_use 对应的 tool_result。
 */
export async function runPatchLoop(params: PatchLoopParams): Promise<PatchLoopResult> {
  const maxFixRounds = params.maxFixRounds ?? MAX_FIX_ROUNDS;
  let messages = params.messages;
  let dsl = params.current;
  let summary = '';
  let applied = 0;
  let issues: string[] = [];
  const allPatches: DslPatch[] = [];

  for (let round = 0; ; round++) {
    const { turn, call, history } = await requestPatches(params, messages);
    const input = call.input as { summary?: string; patches?: unknown[] };
    if (round === 0) summary = input.summary ?? '';

    // 逐条过协议：模型写错一条不该毁掉整批
    const patches: DslPatch[] = [];
    const rejected: string[] = [];
    for (const [i, raw] of (input.patches ?? []).entries()) {
      const parsed = dslPatchSchema.safeParse(raw);
      if (parsed.success) patches.push(parsed.data);
      else rejected.push(`第 ${i + 1} 条：${parsed.error.issues[0]?.message ?? '结构错误'}`);
    }

    const result = applyPatches(dsl, patches, params.applyOptions);
    dsl = result.dsl;
    applied += result.applied;
    allPatches.push(...patches);
    issues = [...rejected, ...result.issues.map((i) => i.message)];

    if (issues.length === 0 || round >= maxFixRounds) {
      return { summary, dsl, patches: allPatches, applied, issues, rounds: round + 1 };
    }

    params.onFix?.(round + 1, issues);
    const refs = Object.entries(result.refs);
    const feedback = [
      `这批补丁生效了 ${result.applied} 条，以下 ${issues.length} 处没有生效：`,
      ...issues.map((text) => `- ${text}`),
      '',
      refs.length ? `本批新建节点的真实 id：${refs.map(([ref, id]) => `${ref} → ${id}`).join('，')}` : '',
      '已生效的改动保留在页面上，当前页面：',
      renderPageOutline(dsl),
      '',
      '请再调用一次 apply_patches，只针对上面没生效的部分给出修正补丁，不要重复已生效的改动。',
      '引用本批已建好的节点时用真实 id，@ref 只在同一批补丁内有效。',
    ]
      .filter((line, i, all) => line !== '' || all[i - 1] !== '')
      .join('\n');

    messages = [
      ...history,
      // 原样带回：开着思考时，带 tool_use 的 assistant 消息必须连同 thinking 块一起回传
      { role: 'assistant', content: turn.content as Anthropic.ContentBlockParam[] },
      {
        role: 'user',
        content: turn.toolUses.map((use) => ({
          type: 'tool_result' as const,
          tool_use_id: use.id,
          content: use.id === call.id ? feedback : '这一步只处理 apply_patches，该调用未执行。',
          is_error: true,
        })),
      },
    ];
  }
}

/**
 * 调一轮模型拿 apply_patches。auto 模式（网关不允许强制工具）下模型可能只回了文字，
 * 回放（去 thinking）后再要求一次。返回实际产出这次调用的那段对话，修正轮接着它往下说。
 */
async function requestPatches(
  params: PatchLoopParams,
  messages: Anthropic.MessageParam[],
): Promise<{ turn: LlmTurn; call: LlmTurn['toolUses'][number]; history: Anthropic.MessageParam[] }> {
  const ask = (msgs: Anthropic.MessageParam[]) =>
    params.llm.runTurn({
      system: params.system,
      messages: msgs,
      tools: params.tools,
      toolChoice: { type: 'tool', name: 'apply_patches' },
      onThinking: params.onThinking,
      onText: params.onText,
    });

  const turn = await ask(messages);
  const call = turn.toolUses.find((t) => t.name === 'apply_patches');
  if (call) return { turn, call, history: messages };

  const history: Anthropic.MessageParam[] = [
    ...messages,
    { role: 'assistant', content: replayAssistantContent(turn) },
    {
      role: 'user',
      content: '你上一条没有调用 apply_patches。请直接调用 apply_patches 产出页面改动，不要回复文字或调用其他工具。',
    },
  ];
  const retry = await ask(history);
  const retryCall = retry.toolUses.find((t) => t.name === 'apply_patches');
  if (!retryCall) throw new Error('模型没有产出任何页面改动');
  return { turn: retry, call: retryCall, history };
}
