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

@Injectable()
export class AnthropicClient {
  private readonly logger = new Logger(AnthropicClient.name);
  private client?: Anthropic;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  get configured(): boolean {
    return Boolean(this.config.get('ANTHROPIC_API_KEY', { infer: true }));
  }

  private sdk(): Anthropic {
    const apiKey = this.config.get('ANTHROPIC_API_KEY', { infer: true });
    if (!apiKey) {
      // 没配 key 不该在启动时炸掉整个服务，只在真正要用 AI 时报出来
      throw new ServiceUnavailableException('尚未配置 ANTHROPIC_API_KEY，AI 助手不可用');
    }
    if (!this.client) {
      const baseURL = this.config.get('ANTHROPIC_BASE_URL', { infer: true });
      this.client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
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

    const stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      system: params.system,
      messages: params.messages,
      tools: params.tools,
      // Opus 5 默认就开思考；显式写出来是为了同时指定 display——
      // 默认 omitted 的话前端只能看到一段长长的空白
      thinking: { type: 'adaptive', display: 'summarized' },
      output_config: { effort },
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
