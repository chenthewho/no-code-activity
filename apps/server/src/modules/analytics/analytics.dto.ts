import { z } from 'zod';

export const analyticsEventItemSchema = z.object({
  event: z.enum(['expose', 'click', 'convert']),
  nodeId: z.string().max(128).optional(),
  channel: z.string().max(64).optional(),
  props: z.record(z.string(), z.unknown()).optional(),
});

/** C 端批量上报：一次最多 100 条，超出会被服务端拒绝 */
export const reportEventsSchema = z.object({
  activityId: z.string().min(1),
  events: z.array(analyticsEventItemSchema).min(1).max(100),
});
export type ReportEventsDto = z.infer<typeof reportEventsSchema>;
