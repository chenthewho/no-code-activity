import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { createEmptyDsl } from '@nca/dsl';
import { MAX_FIX_ROUNDS, runPatchLoop } from './patch-loop';
import type { LlmTurn, RunTurnParams } from './anthropic.client';

const add = (ref: string, material: string) => ({
  op: 'addNode',
  ref,
  material,
  position: { mode: 'appendTo', target: 'ROOT' },
});

/** 按顺序回放预设的每一轮输出；null 表示这轮模型只回了文字、没调工具 */
function scriptedLlm(rounds: ({ summary?: string; patches: unknown[] } | null)[]) {
  const calls: RunTurnParams[] = [];
  const runTurn = vi.fn(async (params: RunTurnParams): Promise<LlmTurn> => {
    calls.push(structuredClone(params));
    const input = rounds[Math.min(calls.length - 1, rounds.length - 1)];
    const id = `tu_${calls.length}`;
    const content = input
      ? [
          { type: 'thinking', thinking: '想一想', signature: 'sig' },
          { type: 'tool_use', id, name: 'apply_patches', input },
        ]
      : [{ type: 'text', text: '我先说说思路……' }];
    return {
      text: '',
      thinking: '',
      toolUses: input ? [{ id, name: 'apply_patches', input }] : [],
      stopReason: input ? 'tool_use' : 'end_turn',
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      content: content as unknown as Anthropic.ContentBlock[],
    };
  });
  return { llm: { runTurn }, calls };
}

const run = (llm: ReturnType<typeof scriptedLlm>['llm']) =>
  runPatchLoop({
    llm,
    system: [],
    tools: [],
    messages: [{ role: 'user', content: '搭一个页面' }],
    current: createEmptyDsl('act_1', '活动'),
    applyOptions: { knownMaterials: ['Text', 'Button'], createNodeId: (m) => `${m.toLowerCase()}_1` },
  });

describe('apply_patches 修正回环', () => {
  it('一次就对：只调一轮', async () => {
    const { llm, calls } = scriptedLlm([{ summary: '加了标题', patches: [add('@t', 'Text')] }]);
    const result = await run(llm);
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ summary: '加了标题', applied: 1, issues: [], rounds: 1 });
  });

  it('有补丁没生效：把问题作为 tool_result 回给模型，在已生效的基础上只补修正', async () => {
    const { llm, calls } = scriptedLlm([
      { summary: '加了标题和按钮', patches: [add('@t', 'Text'), add('@b', 'Buton'), { op: 'nonsense' }] },
      { summary: '修正按钮', patches: [add('@b', 'Button')] },
    ]);
    const result = await run(llm);

    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({ summary: '加了标题和按钮', applied: 2, issues: [], rounds: 2 });
    expect(Object.keys(result.dsl.craftJson).sort()).toEqual(['ROOT', 'button_1', 'text_1']);

    const second = calls[1]!.messages;
    // 上一轮的 assistant 消息原样带回（含 thinking 块），紧跟 tool_result
    const assistant = second.at(-2)!;
    expect(assistant.role).toBe('assistant');
    expect((assistant.content as { type: string }[]).map((b) => b.type)).toEqual(['thinking', 'tool_use']);
    const toolResult = (second.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(toolResult).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1', is_error: true });
    expect(toolResult.content).toContain('2 处没有生效');
    expect(toolResult.content).toContain('第 3 条');
    expect(toolResult.content).toContain('@t → text_1');
  });

  it(`改不对就停：最多再改 ${MAX_FIX_ROUNDS} 轮，剩下的问题如实报出来`, async () => {
    const { llm, calls } = scriptedLlm([{ patches: [add('@x', 'Nope')] }]);
    const result = await run(llm);
    expect(calls).toHaveLength(1 + MAX_FIX_ROUNDS);
    expect(result.rounds).toBe(1 + MAX_FIX_ROUNDS);
    expect(result.issues).toHaveLength(1);
  });

  it('模型只回了文字：先催一次再继续，修正轮接着那段对话往下说', async () => {
    const { llm, calls } = scriptedLlm([
      null,
      { summary: '加按钮', patches: [add('@b', 'Buton')] },
      { patches: [add('@b', 'Button')] },
    ]);
    const result = await run(llm);
    expect(calls).toHaveLength(3);
    expect(result.issues).toEqual([]);
    const texts = calls[2]!.messages
      .filter((m) => typeof m.content === 'string')
      .map((m) => m.content as string);
    expect(texts.some((t) => t.includes('没有调用 apply_patches'))).toBe(true);
  });

  it('始终不调工具就报错', async () => {
    const { llm } = scriptedLlm([null]);
    await expect(run(llm)).rejects.toThrow('模型没有产出任何页面改动');
  });
});
