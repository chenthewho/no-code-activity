import type { AiEvent, AiInterrupt, AiResume, AiRunStatus } from '@nca/shared';
import { getToken, request } from './client';

export interface AiRunStep {
  id: string;
  seq: number;
  kind: string;
  node: string | null;
  payload: unknown;
  createdAt: string;
}

export interface AiRunDetail {
  id: string;
  activityId: string | null;
  status: AiRunStatus;
  title: string | null;
  interrupt: AiInterrupt | null;
  error: string | null;
  steps: AiRunStep[];
}

export const aiApi = {
  start: (body: { prompt: string; activityId?: string; scenario?: string }) =>
    request<{ id: string }>('/ai/runs', { method: 'POST', body }),
  /** 断线重连时用它补齐前情，不依赖 SSE 重放 */
  detail: (id: string) => request<AiRunDetail>(`/ai/runs/${id}`),
};

const BASE_URL =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:3100/api/v1';

/**
 * 流式读取。
 *
 * 不能用 request()：它固定 Content-Type、并且会 await response.json() 把整个
 * 响应体一次性解包，流就没了。也不能用 EventSource——它带不了 Authorization 头，
 * 那样就得为 SSE 单开一条免鉴权路径。fetch + ReadableStream 两头都占得住。
 */
export async function streamAi(
  path: string,
  body: unknown,
  onEvent: (event: AiEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = getToken();
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`AI 请求失败 (${response.status})`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE 以空行分帧，最后一段可能只收到一半，留在缓冲里等下一片
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(6)) as AiEvent);
      } catch {
        // 单帧解析失败不该中断整条流
      }
    }
  }
}

export function streamRun(
  runId: string,
  resume: AiResume | undefined,
  onEvent: (event: AiEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamAi(`/ai/runs/${runId}/stream`, { resume }, onEvent, signal);
}

export function streamEdit(
  body: { activityId: string; instruction: string; selectedNodeId?: string },
  onEvent: (event: AiEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  return streamAi('/ai/edit/stream', body, onEvent, signal);
}
