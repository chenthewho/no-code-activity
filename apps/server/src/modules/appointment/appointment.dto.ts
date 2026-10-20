import { z } from 'zod';

const isoTime = z.string().datetime({ offset: true }).nullable().optional();

const sceneFields = {
  name: z.string().trim().min(1, '场次名称必填').max(60),
  startAt: isoTime,
  endAt: isoTime,
  /** 名额，null 不限 */
  capacity: z.number().int().min(1, '名额至少 1 个').max(1_000_000).nullable().optional(),
  sort: z.number().int().min(0).default(0),
};

/** 结束时间要晚于开始时间——两个都填了才比 */
const timeOrder = (v: { startAt?: string | null; endAt?: string | null }) =>
  !v.startAt || !v.endAt || new Date(v.endAt) > new Date(v.startAt);
const timeOrderError = { message: '结束时间要晚于开始时间', path: ['endAt'] };

export const createSceneSchema = z
  .object({
    activityId: z.string().min(1),
    /** 场次编码：预约组件与预约记录用它关联，建好后不可改 */
    sceneId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/, '场次编码只能用字母、数字、下划线、连字符，最长 64 位'),
    ...sceneFields,
  })
  .refine(timeOrder, timeOrderError);
export type CreateSceneDto = z.infer<typeof createSceneSchema>;

export const updateSceneSchema = z.object(sceneFields).partial();
export type UpdateSceneDto = z.infer<typeof updateSceneSchema>;

/** C 端活动预约：一人一场次只能约一次（表上 @@unique 兜底并发） */
export const appointmentSchema = z.object({
  activityId: z.string().min(1),
  sceneId: z.string().min(1).max(64),
  /** 访客标识，仅活动不要求登录时使用；登录用户以 token 为准 */
  userId: z.string().min(1).max(128).optional(),
  contact: z.string().max(60).optional(),
});
export type AppointmentDto = z.infer<typeof appointmentSchema>;
