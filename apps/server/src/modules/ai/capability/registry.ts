import { z } from 'zod';
import { PERMISSION, type Permission } from '@nca/shared';

/**
 * 平台能力注册表。
 *
 * 物料与动作的能力一律从 materialMetas / actionSchema 派生（仓库的单一来源约定，
 * 双写必然漂移），这张表只登记「平台级操作」——读草稿、写草稿、发布这类
 * 跟页面结构无关、但需要判权限和判要不要人工确认的事。
 *
 * 每项声明三件事：要什么权限、需不需要人拦一道、入参长什么样。
 * 中断策略由此派生，而不是散落在各个节点的 if 里。
 */

/**
 * none    —— 读操作，AI 直接执行不打断。风险上限是查到不相关的东西。
 * approve —— 写操作，出卡片让人点「应用 / 放弃」。可能产生脏数据。
 * human   —— 影响线上，必须人工确认，且额外要发布权限。
 */
export type ConfirmPolicy = 'none' | 'approve' | 'human';

export interface Capability {
  name: string;
  description: string;
  permission: Permission | null;
  confirm: ConfirmPolicy;
  input: z.ZodType;
}

export const CAPABILITIES: readonly Capability[] = [
  {
    name: 'read_page',
    description: '读取当前活动的页面结构（节点树、事件、数据源）。改任何东西之前都该先读一次。',
    permission: null,
    confirm: 'none',
    input: z.object({}),
  },
  {
    name: 'list_templates',
    description: '列出可用的会场模板，用于「从模板起步」。',
    permission: null,
    confirm: 'none',
    input: z.object({
      category: z.string().optional(),
    }),
  },
  {
    name: 'apply_patches',
    description:
      '把一批 DSL 补丁应用到当前页面。这是修改页面的唯一方式——不要试图直接输出整份 DSL。',
    permission: PERMISSION.AI_USE,
    confirm: 'approve',
    input: z.object({
      summary: z.string().min(1).describe('一句话说明这批改动做了什么，会显示给运营看'),
      patches: z.array(z.unknown()).min(1),
    }),
  },
  {
    name: 'save_draft',
    description: '把当前页面存成草稿。',
    permission: PERMISSION.AI_USE,
    confirm: 'approve',
    input: z.object({}),
  },
  {
    name: 'publish_activity',
    description: '发布活动到线上。',
    permission: PERMISSION.AI_PUBLISH,
    confirm: 'human',
    input: z.object({
      changelog: z.string().optional(),
    }),
  },
] as const;

export const CAPABILITY_MAP: ReadonlyMap<string, Capability> = new Map(
  CAPABILITIES.map((c) => [c.name, c]),
);

/** 按调用方持有的权限裁剪出他能用的能力，模型看不到自己无权调用的工具 */
export function capabilitiesFor(permissions: readonly string[]): Capability[] {
  const owned = new Set(permissions);
  const superuser = owned.has(PERMISSION.SYSTEM_MANAGE);
  return CAPABILITIES.filter((c) => c.permission === null || superuser || owned.has(c.permission));
}
