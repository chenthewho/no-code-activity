import type { WebhookType } from './monitor.dto';

export interface AlertMessage {
  title: string;
  /** 多行正文，每行一条要点 */
  lines: string[];
  link?: string;
  /** generic 类型原样带上结构化字段，方便接收方自己处理 */
  data?: Record<string, unknown>;
}

/** 各家群机器人的消息体格式不同，按类型拼 */
export function buildWebhookBody(type: WebhookType, message: AlertMessage): unknown {
  const text = [message.title, ...message.lines, ...(message.link ? [message.link] : [])].join(
    '\n',
  );
  switch (type) {
    case 'wecom':
      return {
        msgtype: 'markdown',
        markdown: {
          content: [
            `**${message.title}**`,
            ...message.lines.map((l) => `> ${l}`),
            message.link ? `[查看监控](${message.link})` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      };
    case 'dingtalk':
      return {
        msgtype: 'markdown',
        markdown: {
          title: message.title,
          text: [
            `### ${message.title}`,
            ...message.lines.map((l) => `- ${l}`),
            message.link ? `[查看监控](${message.link})` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      };
    case 'feishu':
      return { msg_type: 'text', content: { text } };
    default:
      return { title: message.title, text, ...message.data };
  }
}

/**
 * 发送告警。群机器人即使失败也常回 200，真正的结果在 errcode / code 里，
 * 只看 HTTP 状态会把「发送失败」记成「已通知」。
 */
export async function sendWebhook(
  url: string,
  type: WebhookType,
  message: AlertMessage,
  http: typeof fetch = fetch,
): Promise<void> {
  const response = await http(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildWebhookBody(type, message)),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json().catch(() => ({}))) as {
    errcode?: number;
    code?: number;
    errmsg?: string;
    msg?: string;
  };
  const code = payload.errcode ?? payload.code;
  if (typeof code === 'number' && code !== 0) {
    throw new Error(`机器人返回 ${code}：${payload.errmsg ?? payload.msg ?? ''}`);
  }
}
