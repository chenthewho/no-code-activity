import { z } from 'zod';

/**
 * 奖品数据模型对应 schema.prisma 的 Prize：
 * probability 是万分比（10000=100%），total 是该奖品总库存，limitPerUser 是单用户可中上限（0=不限）。
 */
export const createPrizeSchema = z.object({
  activityId: z.string().min(1),
  name: z.string().min(1, '奖品名称必填').max(60),
  image: z.string().optional(),
  probability: z.number().int().min(0).max(10000).default(0),
  total: z.number().int().min(0).default(0),
  limitPerUser: z.number().int().min(0).default(0),
  sort: z.number().int().min(0).default(0),
});
export type CreatePrizeDto = z.infer<typeof createPrizeSchema>;

export const updatePrizeSchema = createPrizeSchema
  .omit({ activityId: true })
  .partial()
  .extend({ probability: z.number().int().min(0).max(10000).optional() });
export type UpdatePrizeDto = z.infer<typeof updatePrizeSchema>;

/**
 * C 端抽奖请求。登录用户的身份取自 C 端 token，body 里的 userId 只在
 * 活动不要求登录时作为访客标识使用——它是客户端自报的，不可信。
 */
export const drawSchema = z.object({
  activityId: z.string().min(1),
  userId: z.string().min(1).max(128).optional(),
});
export type DrawDto = z.infer<typeof drawSchema>;
