import { z } from 'zod';
import { ROOT_NODE_ID, createId, deepClone } from '@nca/shared';
import { identifier, propsRecord } from './schema/primitives';
import { nodeControlSchema, type CraftNode } from './schema/node';
import { actionSchema, TRIGGERS, type DslAction, type EventBinding } from './schema/action';
import { dataSourceSchema } from './schema/datasource';
import { dslMetaSchema } from './schema/meta';
import type { FinalDsl } from './schema/dsl';
import type { DslIssue } from './validate';

/**
 * DSL 补丁协议 —— AI 修改页面的唯一通道。
 *
 * 为什么不让模型直接吐整棵 FinalDsl：
 * 1. 节点 id 有格式约束、要全局唯一、还要维持 parent 与 nodes 的双向一致，
 *    模型每错一次就是一次白屏，而这些约束跟「页面该长什么样」毫无关系；
 * 2. 改一个按钮文案不该重写整页——既贵，又容易顺手抹掉运营手工调过的样式；
 * 3. 补丁天然能算 diff，能在落库前给人看「到底要改哪几处」。
 *
 * 于是模型只描述意图：新建节点用 @ref 占位，位置用「放在谁前面/后面/里面」
 * 声明，真实 id 与父子关系由 applyPatches 统一生成和维护。
 */

/** 同一批补丁内指代「刚新建、还没有真实 id」的节点 */
export const nodeRefSchema = z
  .string()
  .regex(/^@[A-Za-z_][A-Za-z0-9_]*$/, { message: '引用需形如 @banner' });

/** 目标节点：已存在节点的真实 id，或同批次里前面新建节点的 @ref */
export const nodeTargetSchema = z.union([identifier, nodeRefSchema]);

/**
 * 声明式位置编排：组件不关心自己最终排在第几个，只声明相对关系。
 * 把「位置意图」和「位置计算」分开，才谈得上条件注入——
 * 系统自动补进来的组件同样用这套声明，不需要知道页面已有什么。
 */
export const patchPositionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('appendTo'), target: nodeTargetSchema }),
  z.object({ mode: z.literal('prependTo'), target: nodeTargetSchema }),
  z.object({ mode: z.literal('before'), target: nodeTargetSchema }),
  z.object({ mode: z.literal('after'), target: nodeTargetSchema }),
]);

export type PatchPosition = z.infer<typeof patchPositionSchema>;

const addNode = z.object({
  op: z.literal('addNode'),
  /** 本批次内的临时句柄，后续补丁用 @ref 指向它 */
  ref: nodeRefSchema,
  material: z.string().min(1),
  props: propsRecord.default({}),
  position: patchPositionSchema,
  control: nodeControlSchema.optional(),
  displayName: z.string().optional(),
});

const updateProps = z.object({
  op: z.literal('updateProps'),
  target: nodeTargetSchema,
  /** 与现有 props 浅合并；显式传 null 表示清空该项 */
  props: propsRecord,
});

const removeNode = z.object({
  op: z.literal('removeNode'),
  target: nodeTargetSchema,
});

const moveNode = z.object({
  op: z.literal('moveNode'),
  target: nodeTargetSchema,
  position: patchPositionSchema,
});

const setControl = z.object({
  op: z.literal('setControl'),
  target: nodeTargetSchema,
  /** 传 null 清掉条件/循环配置 */
  control: nodeControlSchema.nullable(),
});

const bindEvent = z.object({
  op: z.literal('bindEvent'),
  target: nodeTargetSchema,
  trigger: z.enum(TRIGGERS),
  /** trigger 为 onCustom 时必填，取值来自物料 meta 的 events */
  customEvent: z.string().optional(),
  /**
   * 这里刻意收成松散对象，等 @ref 换成真实 id 之后再用 actionSchema 严格校验。
   * 动作里的 modalId 之类字段是 identifier，直接拿 actionSchema 卡的话，
   * 「打开我刚建的那个弹窗」这种最自然的写法会在解析阶段就被判死。
   */
  actions: z.array(z.record(z.string(), z.unknown())).default([]),
});

const removeEvent = z.object({
  op: z.literal('removeEvent'),
  eventId: identifier,
});

const addDataSource = z.object({
  op: z.literal('addDataSource'),
  /** 数据源 id 由模型自己定：表达式里要写 {{ dataSource.ds_prizes }}，它得知道名字 */
  dataSource: dataSourceSchema,
});

const removeDataSource = z.object({
  op: z.literal('removeDataSource'),
  dataSourceId: identifier,
});

const setMeta = z.object({
  op: z.literal('setMeta'),
  /** 与现有 meta 深合并一层，只改传了的字段 */
  meta: dslMetaSchema.partial(),
});

const setInitialState = z.object({
  op: z.literal('setInitialState'),
  state: z.record(z.string(), z.unknown()),
});

export const dslPatchSchema = z.discriminatedUnion('op', [
  addNode,
  updateProps,
  removeNode,
  moveNode,
  setControl,
  bindEvent,
  removeEvent,
  addDataSource,
  removeDataSource,
  setMeta,
  setInitialState,
]);

export type DslPatch = z.infer<typeof dslPatchSchema>;
export type DslPatchOp = DslPatch['op'];

export interface ApplyPatchesOptions {
  /** 已注册物料名，拦截模型编出来的组件 */
  knownMaterials?: ReadonlySet<string> | readonly string[];
  /** 可以接子节点的物料名，拦截「往文本里塞按钮」 */
  containerMaterials?: ReadonlySet<string> | readonly string[];
  /** 注入确定性 id 生成器，测试用 */
  createNodeId?: (material: string) => string;
}

export interface ApplyPatchesResult {
  dsl: FinalDsl;
  issues: DslIssue[];
  /** @ref → 真实 id。设计器据此选中并高亮 AI 刚建的节点 */
  refs: Record<string, string>;
  /** 真正生效的补丁数，可能小于传入条数 */
  applied: number;
}

/** 动作里这几个字段存的是节点/数据源 id，需要把 @ref 换成真实 id */
const ACTION_ID_FIELDS = ['modalId', 'nodeId', 'formNodeId'] as const;

function toSet(input?: ReadonlySet<string> | readonly string[]): ReadonlySet<string> | undefined {
  if (!input) return undefined;
  return input instanceof Set ? input : new Set(input);
}

function defaultNodeId(material: string): string {
  return createId(material.toLowerCase().slice(0, 8));
}

/**
 * 应用一批补丁。
 *
 * 单条补丁出错只跳过这一条并记一条 issue，不掀掉整批——模型偶尔会引用一个
 * 不存在的节点，为此丢弃另外九条正确的改动毫无道理。但依赖被跳过节点的
 * 后续补丁会一起跳过（@ref 解析不到），避免把半截结构写进 DSL。
 */
export function applyPatches(
  input: FinalDsl,
  patches: readonly DslPatch[],
  options: ApplyPatchesOptions = {},
): ApplyPatchesResult {
  const dsl = deepClone(input) as FinalDsl;
  const issues: DslIssue[] = [];
  const refs: Record<string, string> = {};
  const known = toSet(options.knownMaterials);
  const containers = toSet(options.containerMaterials);
  const makeId = options.createNodeId ?? defaultNodeId;
  let applied = 0;

  const fail = (index: number, message: string, nodeId?: string): void => {
    issues.push({ level: 'error', path: `patches[${index}]`, message, nodeId });
  };
  const warn = (index: number, message: string, nodeId?: string): void => {
    issues.push({ level: 'warning', path: `patches[${index}]`, message, nodeId });
  };

  /** @ref → 真实 id；非 @ 开头的原样返回。解析不到返回 null */
  const resolve = (target: string): string | null => {
    if (!target.startsWith('@')) return dsl.craftJson[target] ? target : null;
    return refs[target] ?? null;
  };

  const detach = (nodeId: string): void => {
    for (const node of Object.values(dsl.craftJson)) {
      const at = node.nodes.indexOf(nodeId);
      if (at >= 0) node.nodes.splice(at, 1);
    }
  };

  /** 把节点按位置意图挂到树上；返回 false 表示位置无效 */
  const place = (index: number, nodeId: string, position: PatchPosition): boolean => {
    const anchor = resolve(position.target);
    if (!anchor) {
      fail(index, `位置锚点 ${position.target} 不存在`);
      return false;
    }

    if (position.mode === 'appendTo' || position.mode === 'prependTo') {
      const parent = dsl.craftJson[anchor];
      if (!parent) {
        fail(index, `位置锚点 ${position.target} 不存在`);
        return false;
      }
      if (containers && !containers.has(parent.type.resolvedName)) {
        fail(index, `「${parent.type.resolvedName}」不能容纳子节点`, anchor);
        return false;
      }
      detach(nodeId);
      if (position.mode === 'appendTo') parent.nodes.push(nodeId);
      else parent.nodes.unshift(nodeId);
      dsl.craftJson[nodeId]!.parent = anchor;
      return true;
    }

    // before / after：挂到锚点的父容器里，插在锚点前后
    const parentId = dsl.craftJson[anchor]?.parent ?? null;
    if (!parentId || !dsl.craftJson[parentId]) {
      fail(index, `${position.target} 没有父容器，无法在它前后插入`, anchor);
      return false;
    }
    detach(nodeId);
    const siblings = dsl.craftJson[parentId]!.nodes;
    const at = siblings.indexOf(anchor);
    const insertAt = at < 0 ? siblings.length : position.mode === 'before' ? at : at + 1;
    siblings.splice(insertAt, 0, nodeId);
    dsl.craftJson[nodeId]!.parent = parentId;
    return true;
  };

  /** 连子树一起摘掉，并清理指向它们的事件与动作，避免留下悬空引用 */
  const removeSubtree = (rootId: string): void => {
    const doomed = new Set<string>();
    const walk = (id: string): void => {
      if (doomed.has(id)) return;
      doomed.add(id);
      for (const child of dsl.craftJson[id]?.nodes ?? []) walk(child);
    };
    walk(rootId);

    detach(rootId);
    for (const id of doomed) delete dsl.craftJson[id];

    dsl.events = dsl.events
      .filter((binding) => !doomed.has(binding.nodeId))
      .map((binding) => ({
        ...binding,
        actions: binding.actions.filter((action) => {
          const record = action as unknown as Record<string, unknown>;
          return !ACTION_ID_FIELDS.some((field) => {
            const value = record[field];
            return typeof value === 'string' && doomed.has(value);
          });
        }),
      }));
  };

  /**
   * 先把动作里引用节点的字段从 @ref 换成真实 id，再过一遍 actionSchema。
   * 单个动作写错只丢这一个动作并记 issue，其余动作照常绑上。
   */
  const buildActions = (index: number, raw: Record<string, unknown>[]): DslAction[] => {
    const actions: DslAction[] = [];
    for (const [j, item] of raw.entries()) {
      const record = { ...item };
      for (const field of ACTION_ID_FIELDS) {
        const value = record[field];
        if (typeof value === 'string' && value.startsWith('@')) {
          const real = resolve(value);
          if (real) {
            record[field] = real;
          } else {
            warn(index, `动作 ${j + 1} 里的 ${value} 解析不到，该字段留空`);
            record[field] = '';
          }
        }
      }
      const parsed = actionSchema.safeParse(record);
      if (!parsed.success) {
        fail(index, `动作 ${j + 1} 不合法：${parsed.error.issues[0]?.message ?? '结构错误'}`);
        continue;
      }
      actions.push(parsed.data);
    }
    return actions;
  };

  for (const [index, patch] of patches.entries()) {
    switch (patch.op) {
      case 'addNode': {
        if (known && !known.has(patch.material)) {
          fail(index, `未注册的物料「${patch.material}」`);
          break;
        }
        if (patch.material === 'Page') {
          fail(index, 'Page 只能是根节点，不能再新建');
          break;
        }
        if (refs[patch.ref]) {
          fail(index, `引用 ${patch.ref} 在本批次里重复定义`);
          break;
        }

        const id = makeId(patch.material);
        const node: CraftNode = {
          type: { resolvedName: patch.material },
          isCanvas: containers?.has(patch.material) ?? false,
          props: patch.props,
          custom: {},
          hidden: false,
          nodes: [],
          linkedNodes: {},
          parent: null,
          ...(patch.displayName ? { displayName: patch.displayName } : {}),
          ...(patch.control ? { control: patch.control } : {}),
        };
        dsl.craftJson[id] = node;

        if (!place(index, id, patch.position)) {
          delete dsl.craftJson[id];
          break;
        }
        refs[patch.ref] = id;
        applied += 1;
        break;
      }

      case 'updateProps': {
        const id = resolve(patch.target);
        if (!id) {
          fail(index, `节点 ${patch.target} 不存在`);
          break;
        }
        const node = dsl.craftJson[id]!;
        node.props = { ...node.props, ...patch.props };
        applied += 1;
        break;
      }

      case 'removeNode': {
        const id = resolve(patch.target);
        if (!id) {
          fail(index, `节点 ${patch.target} 不存在`);
          break;
        }
        if (id === ROOT_NODE_ID) {
          fail(index, '根节点不能删除');
          break;
        }
        removeSubtree(id);
        applied += 1;
        break;
      }

      case 'moveNode': {
        const id = resolve(patch.target);
        if (!id) {
          fail(index, `节点 ${patch.target} 不存在`);
          break;
        }
        if (id === ROOT_NODE_ID) {
          fail(index, '根节点不能移动');
          break;
        }
        // 挪进自己的子树里会把这棵树从 ROOT 上摘下来，变成一圈孤儿
        const anchor = resolve(patch.position.target);
        if (anchor && isDescendantOrSelf(dsl, anchor, id)) {
          fail(index, '不能把节点移动到它自己的子树里', id);
          break;
        }
        if (place(index, id, patch.position)) applied += 1;
        break;
      }

      case 'setControl': {
        const id = resolve(patch.target);
        if (!id) {
          fail(index, `节点 ${patch.target} 不存在`);
          break;
        }
        const node = dsl.craftJson[id]!;
        if (patch.control === null) delete node.control;
        else node.control = patch.control;
        applied += 1;
        break;
      }

      case 'bindEvent': {
        const id = resolve(patch.target);
        if (!id) {
          fail(index, `节点 ${patch.target} 不存在`);
          break;
        }
        if (patch.trigger === 'onCustom' && !patch.customEvent) {
          fail(index, 'onCustom 必须指明物料抛出的事件名');
          break;
        }
        const binding: EventBinding = {
          id: createId('evt'),
          nodeId: id,
          trigger: patch.trigger,
          ...(patch.customEvent ? { customEvent: patch.customEvent } : {}),
          actions: buildActions(index, patch.actions),
        };
        dsl.events.push(binding);
        applied += 1;
        break;
      }

      case 'removeEvent': {
        const before = dsl.events.length;
        dsl.events = dsl.events.filter((binding) => binding.id !== patch.eventId);
        if (dsl.events.length === before) {
          fail(index, `事件 ${patch.eventId} 不存在`);
          break;
        }
        applied += 1;
        break;
      }

      case 'addDataSource': {
        if (dsl.dataSources.some((ds) => ds.id === patch.dataSource.id)) {
          fail(index, `数据源 id 重复：${patch.dataSource.id}`);
          break;
        }
        dsl.dataSources.push(patch.dataSource);
        applied += 1;
        break;
      }

      case 'removeDataSource': {
        const before = dsl.dataSources.length;
        dsl.dataSources = dsl.dataSources.filter((ds) => ds.id !== patch.dataSourceId);
        if (dsl.dataSources.length === before) {
          fail(index, `数据源 ${patch.dataSourceId} 不存在`);
          break;
        }
        applied += 1;
        break;
      }

      case 'setMeta': {
        dsl.meta = { ...dsl.meta, ...patch.meta };
        applied += 1;
        break;
      }

      case 'setInitialState': {
        dsl.initialState = { ...dsl.initialState, ...patch.state };
        applied += 1;
        break;
      }

      default:
        break;
    }
  }

  return { dsl, issues, refs, applied };
}

/** target 是否就是 nodeId 本身或它的后代 */
function isDescendantOrSelf(dsl: FinalDsl, target: string, nodeId: string): boolean {
  let cursor: string | null = target;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    if (cursor === nodeId) return true;
    seen.add(cursor);
    cursor = dsl.craftJson[cursor]?.parent ?? null;
  }
  return false;
}
