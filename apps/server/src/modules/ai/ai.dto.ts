import { z } from 'zod';

export const startRunSchema = z.object({
  /** 已有活动上继续搭；为空表示这次要从头新建一个活动 */
  activityId: z.string().optional(),
  prompt: z.string().min(1, '请描述你想做的活动').max(4000),
  scenario: z.string().max(64).default('build'),
});
export type StartRunDto = z.infer<typeof startRunSchema>;

/**
 * 恢复指令。resume 必须是对象——LangGraph 把 falsy 的 resume 当成「没给输入」
 * 直接抛 EmptyInputError，所以「拒绝」不能写成裸 false。
 */
export const resumeSchema = z.object({
  decision: z.enum(['approve', 'reject', 'edit', 'respond']),
  fields: z.record(z.string(), z.string()).optional(),
  choices: z.array(z.string()).optional(),
  message: z.string().max(2000).optional(),
});
export type ResumeDto = z.infer<typeof resumeSchema>;

export const streamSchema = z.object({
  resume: resumeSchema.optional(),
});
export type StreamDto = z.infer<typeof streamSchema>;

export const editSchema = z.object({
  activityId: z.string().min(1),
  instruction: z.string().min(1).max(2000),
  /** 设计器里当前选中的节点，改动会聚焦在它身上 */
  selectedNodeId: z.string().optional(),
});
export type EditDto = z.infer<typeof editSchema>;
