import { ACTIVITY_STATUS } from '@nca/shared';
import { z } from 'zod';

export const createActivitySchema = z.object({
  title: z.string().min(1, '请输入活动名称').max(120),
  description: z.string().max(500).optional(),
  cover: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
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
});
export type ListActivityDto = z.infer<typeof listActivitySchema>;

/** 草稿保存：DSL 结构在 service 里用 finalDslSchema 校验，这里只管外层信封 */
export const saveDraftSchema = z.object({
  dsl: z.unknown(),
});
export type SaveDraftDto = z.infer<typeof saveDraftSchema>;
