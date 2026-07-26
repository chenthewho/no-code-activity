import { z } from 'zod';
import { ROOT_NODE_ID } from '@nca/shared';
import { propsRecord } from './primitives';

/**
 * 节点树采用 Craft.js 的扁平序列化结构（id → node，靠 nodes 数组表达父子）。
 *
 * 这里刻意只描述结构本身，不引入任何 Craft.js 的类型：画布实现将来若替换，
 * DSL 与 Renderer 不受影响。设计器侧由 adapter 负责两者互转。
 */

/** 结构容器的控制字段，对应架构图 condition / loop / slot */
export const nodeControlSchema = z.object({
  /** 条件渲染表达式，为假则该节点及子树不渲染 */
  if: z.string().optional(),
  /** 列表渲染：数据源或表达式，配合 itemAlias 在子树中取值 */
  loop: z
    .object({
      // 允许空串：开关刚打开时还没选数据来源，草稿要存得下（见 validate.ts 的 mode）
      source: z.string(),
      itemAlias: z.string().min(1).default('item'),
      indexAlias: z.string().min(1).default('index'),
      /** 稳定 key 的取值表达式，缺省用 index（列表会重排时务必配置） */
      keyBy: z.string().optional(),
    })
    .optional(),
});

export type NodeControl = z.infer<typeof nodeControlSchema>;

export const craftNodeSchema = z.object({
  type: z.object({
    /** 物料名，必须能在 componentMap 里解析到 */
    resolvedName: z.string().min(1),
  }),
  /** 是否为可投放子节点的画布容器 */
  isCanvas: z.boolean().default(false),
  props: propsRecord.default({}),
  displayName: z.string().optional(),
  custom: z.record(z.string(), z.unknown()).default({}),
  hidden: z.boolean().default(false),
  nodes: z.array(z.string()).default([]),
  /** 具名插槽：slotName → nodeId */
  linkedNodes: z.record(z.string(), z.string()).default({}),
  parent: z.string().nullable().optional(),
  control: nodeControlSchema.optional(),
});

export type CraftNode = z.infer<typeof craftNodeSchema>;

export const craftJsonSchema = z
  .record(z.string(), craftNodeSchema)
  .refine((tree) => ROOT_NODE_ID in tree, { message: `节点树缺少根节点 ${ROOT_NODE_ID}` });

export type CraftJson = z.infer<typeof craftJsonSchema>;
