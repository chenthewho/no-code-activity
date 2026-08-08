import { z } from 'zod';

export const createChannelSchema = z.object({
  activityId: z.string().min(1),
  name: z.string().min(1, '渠道名称必填').max(60),
  /** 渠道码：URL 友好的短码，同一活动内唯一 */
  code: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, '渠道码只能包含字母/数字/_/-'),
  /** 透传到落地页 query 的参数，如 { utm_source: 'wechat' }；可空 */
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type CreateChannelDto = z.infer<typeof createChannelSchema>;
