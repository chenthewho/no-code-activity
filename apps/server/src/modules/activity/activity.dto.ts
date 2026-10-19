import { ACTIVITY_STATUS } from '@nca/shared';
import { z } from 'zod';

/**
 * 只校验「是字符串」不够：无效日期会一路漏到 new Date() 才变成 Invalid Date，
 * 最终以一个看不懂的数据库错误冒出来。在入口就拦住并指明字段。
 */
const isoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: '需为合法的时间' });

export const createActivitySchema = z.object({
  title: z.string().min(1, '请输入活动名称').max(120),
  description: z.string().max(500).optional(),
  // 空串归一成未设置：清空封面时前端会传 ""，落库后会被当成一个非法的资源地址
  cover: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  startTime: isoDateTime.optional(),
  endTime: isoDateTime.optional(),
  /** 从模板创建时传入 */
  templateId: z.string().optional(),
});
export type CreateActivityDto = z.infer<typeof createActivitySchema>;

export const updateActivitySchema = createActivitySchema.partial().omit({ templateId: true });
export type UpdateActivityDto = z.infer<typeof updateActivitySchema>;

export const listActivitySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().optional(),
  status: z
    .enum([ACTIVITY_STATUS.DRAFT, ACTIVITY_STATUS.PUBLISHED, ACTIVITY_STATUS.OFFLINE])
    .optional(),
  ownerId: z.string().optional(),
  /** 数据范围：mine 我负责的 / joined 我负责或参与的 / all 全部（需 activity:all） */
  scope: z.enum(['mine', 'joined', 'all']).default('joined'),
});
export type ListActivityDto = z.infer<typeof listActivitySchema>;

export const upsertMemberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['editor', 'viewer']).default('editor'),
});
export type UpsertMemberDto = z.infer<typeof upsertMemberSchema>;

export const transferOwnerSchema = z.object({ userId: z.string().min(1) });

/** 草稿保存：DSL 结构在 service 里用 finalDslSchema 校验，这里只管外层信封 */
export const saveDraftSchema = z.object({
  dsl: z.unknown(),
});
export type SaveDraftDto = z.infer<typeof saveDraftSchema>;
