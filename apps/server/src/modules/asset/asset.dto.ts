import { z } from 'zod';

export const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(40),
  activityId: z.string().optional(),
  type: z.string().optional(),
});
export type ListDto = z.infer<typeof listSchema>;

export const registerSchema = z.object({
  url: z.string().min(1),
  type: z.enum(['image', 'video', 'audio', 'font']),
  activityId: z.string().optional(),
  size: z.number().int().nonnegative().default(0),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});
export type RegisterDto = z.infer<typeof registerSchema>;

/** 直传第一步：告诉服务端要传什么，换一张上传凭证 */
export const uploadTicketSchema = z.object({
  filename: z.string().min(1).max(255),
  mimetype: z.string().min(1).max(100),
  size: z.number().int().positive(),
  /** 文件内容的 SHA-256（小写十六进制），去重与命名用 */
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 需为 64 位小写十六进制'),
  activityId: z.string().optional(),
});
export type UploadTicketDto = z.infer<typeof uploadTicketSchema>;

export const completeUploadSchema = z.object({ uploadId: z.string().min(1).max(64) });
export type CompleteUploadDto = z.infer<typeof completeUploadSchema>;
