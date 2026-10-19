import { z } from 'zod';

const roleCodes = z.array(z.string().min(1).max(64)).max(20);

export const listUserSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().max(60).optional(),
});
export type ListUserDto = z.infer<typeof listUserSchema>;

export const createUserSchema = z.object({
  username: z
    .string()
    .min(2, '用户名至少 2 位')
    .max(40)
    .regex(/^[\w.@-]+$/, '用户名只能包含字母、数字与 _ . @ -'),
  nickname: z.string().min(1, '请输入昵称').max(40),
  password: z.string().min(8, '密码至少 8 位').max(64),
  email: z.string().email().optional(),
  roleCodes: roleCodes.default([]),
});
export type CreateUserDto = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  nickname: z.string().min(1).max(40).optional(),
  email: z.string().email().optional(),
  enabled: z.boolean().optional(),
  roleCodes: roleCodes.optional(),
});
export type UpdateUserDto = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({
  password: z.string().min(8, '密码至少 8 位').max(64),
});

export const lookupUserSchema = z.object({ keyword: z.string().max(60).default('') });

const permissionCodes = z.array(z.string().min(1).max(64)).max(100);

export const createRoleSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[a-z][a-z0-9_]*$/, '角色编码用小写字母、数字与下划线，字母开头'),
  name: z.string().min(1).max(40),
  remark: z.string().max(200).optional(),
  permissions: permissionCodes.default([]),
});
export type CreateRoleDto = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  remark: z.string().max(200).optional(),
  permissions: permissionCodes.optional(),
});
export type UpdateRoleDto = z.infer<typeof updateRoleSchema>;
