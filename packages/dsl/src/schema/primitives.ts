import { z } from 'zod';

/**
 * 与 zod 大版本解耦的基础校验器：只依赖 z.string() + refine，
 * 避免 z.string().datetime() / z.iso.* 在 zod 3↔4 之间的 API 漂移。
 */

export const isoDateTime = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: '需为合法的 ISO 时间字符串' });

export const httpUrl = z
  .string()
  .refine((v) => /^(https?:)?\/\//.test(v) || v.startsWith('/'), {
    message: '需为 http(s) 链接或站内绝对路径',
  });

/** 资源地址：允许 http(s)、协议相对、站内路径、data URI */
export const assetUrl = z
  .string()
  .refine((v) => /^(https?:)?\/\//.test(v) || v.startsWith('/') || v.startsWith('data:'), {
    message: '需为合法的资源地址',
  });

export const cssColor = z.string().min(1);

/** 标识符：节点 id、数据源 id 等，限制字符集以便安全地拼进表达式上下文 */
export const identifier = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, { message: '标识符仅允许字母、数字、下划线与短横线' });

/** 任意 JSON 值（props 里可以放嵌套结构） */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);

/** props 容器：键为属性名，值为任意 JSON（字符串里可含 {{ }} 表达式） */
export const propsRecord = z.record(z.string(), jsonValue);
