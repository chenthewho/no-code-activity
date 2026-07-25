import { z } from 'zod';
import { HOST_TYPE } from '@nca/shared';
import { assetUrl, cssColor, httpUrl, isoDateTime } from './primitives';

const hostType = z.enum([
  HOST_TYPE.BROWSER,
  HOST_TYPE.GAME_CENTER,
  HOST_TYPE.LDQ_PC,
  HOST_TYPE.LDQ_APP,
  HOST_TYPE.SDK_LANDSCAPE,
  HOST_TYPE.SDK_PORTRAIT,
  HOST_TYPE.WECHAT_MINI_PROGRAM,
]);

export const themeSchema = z.object({
  primaryColor: cssColor.default('#1677ff'),
  backgroundColor: cssColor.default('#ffffff'),
  backgroundImage: assetUrl.optional(),
  fontFamily: z.string().optional(),
});

export const shareConfigSchema = z.object({
  title: z.string().max(120).optional(),
  desc: z.string().max(240).optional(),
  cover: assetUrl.optional(),
  link: httpUrl.optional(),
});

/**
 * 页面适配：设计稿宽度 + 适配模式。
 * vw   —— 等比缩放，营销活动页默认
 * rem  —— 根字号缩放，需宿主注入 rem 脚本
 * fixed—— 不缩放，PC 端固定宽度
 */
export const pageConfigSchema = z.object({
  designWidth: z.number().int().positive().default(750),
  adaptMode: z.enum(['vw', 'rem', 'fixed']).default('vw'),
  title: z.string().max(60).optional(),
});

export const authConfigSchema = z.object({
  /** 进页面即要求登录；否则由 EventBinder 在动作触发时按需拉起 */
  required: z.boolean().default(false),
  loginMode: z.enum(['sso', 'sdk', 'none']).default('none'),
});

export const dslMetaSchema = z.object({
  activityId: z.string().min(1),
  title: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  cover: assetUrl.optional(),
  startTime: isoDateTime.optional(),
  endTime: isoDateTime.optional(),
  // prefault 而非 default：空对象要走进子 schema 让内层 default 生效，
  // default 会直接把字面量当输出值，绕过内层默认。
  theme: themeSchema.prefault({}),
  share: shareConfigSchema.prefault({}),
  page: pageConfigSchema.prefault({}),
  auth: authConfigSchema.prefault({}),
  /** 该活动页支持的宿主，Renderer 启动时据此挑选 HostAdapter */
  hosts: z.array(hostType).min(1).default([HOST_TYPE.BROWSER]),
});

export type DslMeta = z.infer<typeof dslMetaSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type PageConfig = z.infer<typeof pageConfigSchema>;
