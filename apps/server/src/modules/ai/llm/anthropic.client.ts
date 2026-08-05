import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../../config/configuration';

export interface LlmToolUse {
  id: string;
  name: string;
  input: unknown;
}

export interface LlmUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface LlmTurn {
  text: string;
  thinking: string;
  toolUses: LlmToolUse[];
  stopReason: string | null;
  usage: LlmUsage;
  /** 原样回填进下一轮 messages，thinking / tool_use 块都必须带上 */
  content: Anthropic.ContentBlock[];
}

export interface RunTurnParams {
  system: Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  tools: Anthropic.Tool[];
  /** 逼模型必须走某个工具，用于「这一步就是要一份结构化结果」的节点 */
  toolChoice?: Anthropic.ToolChoice;
  /** 流式增量回调，用于把 token 实时推给前端 */
  onText?: (delta: string) => void;
  onThinking?: (delta: string) => void;
}

/** 模型拒答。分开成一类错误，调用方好把原因如实告诉运营而不是笼统报「生成失败」 */
export class LlmRefusalError extends Error {
  constructor(readonly category: string | null) {
    super(`模型拒绝了这次请求${category ? `（${category}）` : ''}`);
  }
}

/**
 * 网关 SSE 归一化。
 *
 * opencode 这类网关的 message_start 事件不带 message.content（标准 Anthropic
 * 协议里是空数组 []），@anthropic-ai/sdk 0.115 的 MessageStream 把 content 当成
 * undefined，第一条 content_block_start 一进来就 `.push` 崩掉。这里在 fetch 层
 * 逐帧解析 SSE，把缺失的 content 补成 []。直连官方时协议是标准的，这段不生效。
 */
function normalizeSseFrame(frame: string): string {
  const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
  if (!dataLine) return frame;
  try {
    const evt = JSON.parse(dataLine.slice(6)) as { type?: string; message?: { content?: unknown } };
    if (evt.type === 'message_start' && evt.message && !Array.isArray(evt.message.content)) {
      evt.message.content = [];
      return frame.replace(dataLine, `data: ${JSON.stringify(evt)}`);
    }
  } catch {
    // 帧不是 JSON 或解析失败，原样放行
  }
  return frame;
}

const gatewayFetch: typeof fetch = async (url, init) => {
  const res = await fetch(url, init);
  if (!res.body) return res;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';

  // SSE 以空行分帧，最后一段可能只收到一半，留在缓冲里等下一片
  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        controller.enqueue(encoder.encode(`${normalizeSseFrame(frame)}\n\n`));
      }
    },
    flush(controller) {
      if (buffer) controller.enqueue(encoder.encode(`${normalizeSseFrame(buffer)}\n\n`));
    },
  });

  return new Response(res.body.pipeThrough(transform), {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
};

/**
 * 重试时回放模型上一条回复。续聊里 replay 带 thinking 的 assistant 消息
 * 需要 thinking_signature（一些网关也不认），直接只回放 text / tool_use 块最稳。
 * auto 模式下模型若只回了文字，这里回放出来的就是纯文本。
 */
export function replayAssistantContent(turn: LlmTurn): Anthropic.ContentBlockParam[] {
  return turn.content.filter((block) => block.type !== 'thinking');
}

@Injectable()
export class AnthropicClient {
  private readonly logger = new Logger(AnthropicClient.name);
  private client?: Anthropic;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  get configured(): boolean {
    return Boolean(this.config.get('ANTHROPIC_API_KEY', { infer: true }));
  }

  /** 工具选择策略：force=强制指定工具（Opus 5 原生），auto=网关后端只能交模型自选 */
  get toolChoiceMode(): 'force' | 'auto' {
    return this.config.get('AI_TOOL_CHOICE', { infer: true });
  }

  private sdk(): Anthropic {
    const apiKey = this.config.get('ANTHROPIC_API_KEY', { infer: true });
    if (!apiKey) {
      // 没配 key 不该在启动时炸掉整个服务，只在真正要用 AI 时报出来
      throw new ServiceUnavailableException('尚未配置 ANTHROPIC_API_KEY，AI 助手不可用');
    }
    if (!this.client) {
      const baseURL = this.config.get('ANTHROPIC_BASE_URL', { infer: true });
      // 走网关时套一层 fetch 补网关的协议窟窿，直连官方不装
      this.client = new Anthropic({
        apiKey,
        ...(baseURL ? { baseURL, fetch: gatewayFetch } : {}),
      });
    }
    return this.client;
  }

  /**
   * 跑一轮对话。
   *
   * 一律走流式：max_tokens 给到 64k，非流式请求会先撞上 SDK 的 HTTP 超时。
   * 顺带也让前端能实时看到进度——AI 产品的信任是一点点建立的，
   * 十几秒的空白比慢更伤。
   */
  async runTurn(params: RunTurnParams): Promise<LlmTurn> {
    const client = this.sdk();
    const model = this.config.get('AI_MODEL', { infer: true });
    const maxTokens = this.config.get('AI_MAX_TOKENS', { infer: true });
    const effort = this.config.get('AI_EFFORT', { infer: true });
    const thinkingMode = this.config.get('AI_THINKING', { infer: true });
    const toolChoiceMode = this.config.get('AI_TOOL_CHOICE', { infer: true });

    // deepseek 这类网关后端的 thinking 模式不允许强制 tool_choice（type: tool），
    // 会直接 400。auto 模式把「强制指定工具」降级成「交给模型选」，
    // 调用方需要用单工具 + 提示词 + 重试来兜住模型不调工具的情况。
    const toolChoice =
      params.toolChoice && toolChoiceMode === 'auto' && params.toolChoice.type === 'tool'
        ? ({ type: 'auto' } as const)
        : params.toolChoice;

    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      system: params.system,
      messages: params.messages,
      tools: params.tools,
      ...(toolChoice ? { tool_choice: toolChoice } : {}),
      // Opus 5 默认开思考，显式写出来是为了同时指定 display——
      // 默认 omitted 的话前端只能看到一段长长的空白。
      // 走网关/非 Claude 后端时置 AI_THINKING=off：有些后端不认
      // thinking + tool_choice 的组合会直接 400，此时连 output_config 一起省掉。
      ...(thinkingMode === 'adaptive'
        ? {
            thinking: { type: 'adaptive', display: 'summarized' },
            output_config: { effort },
          }
        : {}),
    });

    if (params.onText) {
      stream.on('text', (delta) => params.onText?.(delta));
    }
    if (params.onThinking) {
      stream.on('thinking', (delta) => params.onThinking?.(delta));
    }

    const message = await stream.finalMessage();

    // 必须先判 stop_reason 再读 content：拒答时 content 可能是空的
    if (message.stop_reason === 'refusal') {
      const category = message.stop_details?.category ?? null;
      this.logger.warn(`模型拒答，category=${category ?? 'unknown'}`);
      throw new LlmRefusalError(category);
    }

    let text = '';
    let thinking = '';
    const toolUses: LlmToolUse[] = [];
    for (const block of message.content) {
      if (block.type === 'text') text += block.text;
      else if (block.type === 'thinking') thinking += block.thinking;
      else if (block.type === 'tool_use') {
        toolUses.push({ id: block.id, name: block.name, input: block.input });
      }
    }

    return {
      text,
      thinking,
      toolUses,
      stopReason: message.stop_reason,
      content: message.content,
      usage: {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
        cacheRead: message.usage.cache_read_input_tokens ?? 0,
        cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
