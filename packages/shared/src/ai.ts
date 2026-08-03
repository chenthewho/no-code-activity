/**
 * AI 人机协同协议：中断点、恢复指令、流式事件。
 *
 * 放在 shared 里是因为服务端与设计器两边都要用，且必须一字不差——
 * 中断卡片长什么样、恢复时回传什么，任何一边猜错都是流程卡死。
 */

/**
 * 三类中断，对应三种「人要做的事」：
 * - approve：高风险操作前拦一道，人点确认或放弃
 * - edit：AI 填好了，人过一遍并微调
 * - respond：信息不够，AI 得问一句
 */
export type AiInterruptKind = 'approve' | 'edit' | 'respond';

export interface AiInterruptField {
  key: string;
  label: string;
  value: string;
  type: 'text' | 'textarea' | 'date' | 'datetime';
  placeholder?: string;
  required?: boolean;
}

export interface AiInterruptOption {
  value: string;
  label: string;
  description?: string;
  cover?: string;
  /** 系统按规则自动带上的，界面要显式标出来 */
  autoInjected?: boolean;
}

export interface AiPatchPreview {
  op: string;
  /** 人话描述这一条补丁干了什么 */
  text: string;
}

/**
 * 中断卡片。
 *
 * why / done / missing 三个字段不是装饰：每张卡片都要说清「为什么需要你」
 * 「AI 已经做了什么」「还缺什么」。假进度条和语焉不详的确认框都在消耗信任，
 * 而 AI 产品的信任是一点点建立起来的。
 */
export interface AiInterrupt {
  kind: AiInterruptKind;
  /** 产生这个中断的图节点，恢复时要对得上 */
  node: string;
  title: string;
  why: string;
  done?: string;
  missing?: string;
  /** kind=edit：待确认的字段 */
  fields?: AiInterruptField[];
  /** kind=respond：候选项，multiple 时是多选 */
  options?: AiInterruptOption[];
  multiple?: boolean;
  /** kind=approve：改动摘要与逐条预览 */
  summary?: string;
  patches?: AiPatchPreview[];
  /** 这一步影响线上，界面上要加重警示 */
  dangerous?: boolean;
}

/**
 * 恢复指令。
 *
 * 一律是对象，不能是裸布尔——LangGraph 把 falsy 的 resume 当成「没给输入」
 * 直接抛 EmptyInputError，`{ resume: false }` 是跑不通的。
 */
export interface AiResume {
  decision: 'approve' | 'reject' | 'edit' | 'respond';
  /** decision=edit：改过的字段值 */
  fields?: Record<string, string>;
  /** decision=respond：选中的值 */
  choices?: string[];
  /** 自由输入的补充说明 */
  message?: string;
}

/** SSE 推给前端的事件 */
export type AiEvent =
  | { type: 'status'; status: string; node?: string }
  | { type: 'thinking'; delta: string }
  | { type: 'text'; delta: string }
  | { type: 'patch'; summary: string; patches: AiPatchPreview[]; issues: string[] }
  | { type: 'dsl'; dsl: unknown }
  | { type: 'interrupt'; interrupt: AiInterrupt }
  | { type: 'done'; status: 'succeeded' | 'failed' | 'cancelled'; message?: string }
  | { type: 'error'; message: string };

export const AI_RUN_STATUS = {
  RUNNING: 'running',
  INTERRUPTED: 'interrupted',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export type AiRunStatus = (typeof AI_RUN_STATUS)[keyof typeof AI_RUN_STATUS];
