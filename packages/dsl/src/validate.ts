import { ROOT_NODE_ID } from '@nca/shared';
import { finalDslSchema, type FinalDsl } from './schema/dsl';
import type { CraftJson } from './schema/node';

export interface DslIssue {
  level: 'error' | 'warning';
  path: string;
  message: string;
}

export type ValidateResult =
  | { success: true; data: FinalDsl; issues: DslIssue[] }
  | { success: false; issues: DslIssue[] };

export interface ValidateOptions {
  /** 已注册物料名集合；传入则校验 resolvedName 能否解析 */
  knownMaterials?: ReadonlySet<string> | readonly string[];
}

/**
 * 结构完整性校验。zod 只管「字段形状对不对」，这里管「引用指得到吗」——
 * 悬空的子节点 id、指向不存在节点的事件绑定，都会让 Renderer 在线上白屏，
 * 必须在发布前拦下。
 */
function checkIntegrity(dsl: FinalDsl, options: ValidateOptions): DslIssue[] {
  const issues: DslIssue[] = [];
  const tree: CraftJson = dsl.craftJson;
  const nodeIds = new Set(Object.keys(tree));
  const known = options.knownMaterials
    ? options.knownMaterials instanceof Set
      ? options.knownMaterials
      : new Set(options.knownMaterials)
    : undefined;

  for (const [id, node] of Object.entries(tree)) {
    if (known && !known.has(node.type.resolvedName)) {
      issues.push({
        level: 'error',
        path: `craftJson.${id}.type.resolvedName`,
        message: `未注册的物料「${node.type.resolvedName}」，渲染时无法解析`,
      });
    }
    for (const child of node.nodes) {
      if (!nodeIds.has(child)) {
        issues.push({
          level: 'error',
          path: `craftJson.${id}.nodes`,
          message: `子节点 ${child} 不存在`,
        });
      }
    }
    for (const [slot, target] of Object.entries(node.linkedNodes)) {
      if (!nodeIds.has(target)) {
        issues.push({
          level: 'error',
          path: `craftJson.${id}.linkedNodes.${slot}`,
          message: `插槽节点 ${target} 不存在`,
        });
      }
    }
  }

  // 从 ROOT 出发遍历，检出环与孤儿节点
  const visited = new Set<string>();
  const stack = [ROOT_NODE_ID];
  const onPath = new Set<string>();
  const walk = (id: string): void => {
    if (onPath.has(id)) {
      issues.push({ level: 'error', path: `craftJson.${id}`, message: '节点树存在循环引用' });
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    onPath.add(id);
    const node = tree[id];
    if (node) {
      for (const child of node.nodes) if (nodeIds.has(child)) walk(child);
      for (const target of Object.values(node.linkedNodes)) if (nodeIds.has(target)) walk(target);
    }
    onPath.delete(id);
  };
  walk(stack[0] as string);

  for (const id of nodeIds) {
    if (!visited.has(id)) {
      issues.push({
        level: 'warning',
        path: `craftJson.${id}`,
        message: '孤儿节点：无法从 ROOT 到达，不会被渲染',
      });
    }
  }

  const dataSourceIds = new Set(dsl.dataSources.map((ds) => ds.id));

  for (const [i, binding] of dsl.events.entries()) {
    if (!nodeIds.has(binding.nodeId)) {
      issues.push({
        level: 'error',
        path: `events[${i}].nodeId`,
        message: `事件绑定指向不存在的节点 ${binding.nodeId}`,
      });
    }
    for (const [j, action] of binding.actions.entries()) {
      const at = `events[${i}].actions[${j}]`;
      switch (action.type) {
        case 'dataSource.refresh':
          if (!dataSourceIds.has(action.dataSourceId)) {
            issues.push({
              level: 'error',
              path: `${at}.dataSourceId`,
              message: `数据源 ${action.dataSourceId} 不存在`,
            });
          }
          break;
        case 'modal.open':
          if (!nodeIds.has(action.modalId)) {
            issues.push({
              level: 'error',
              path: `${at}.modalId`,
              message: `弹窗节点 ${action.modalId} 不存在`,
            });
          }
          break;
        case 'component.trigger':
          if (!nodeIds.has(action.nodeId)) {
            issues.push({
              level: 'error',
              path: `${at}.nodeId`,
              message: `目标组件 ${action.nodeId} 不存在`,
            });
          }
          break;
        case 'form.submit':
          if (!nodeIds.has(action.formNodeId)) {
            issues.push({
              level: 'error',
              path: `${at}.formNodeId`,
              message: `表单节点 ${action.formNodeId} 不存在`,
            });
          }
          break;
        default:
          break;
      }
    }
  }

  const seenDs = new Set<string>();
  for (const [i, ds] of dsl.dataSources.entries()) {
    if (seenDs.has(ds.id)) {
      issues.push({ level: 'error', path: `dataSources[${i}].id`, message: `数据源 id 重复：${ds.id}` });
    }
    seenDs.add(ds.id);
  }

  if (dsl.meta.startTime && dsl.meta.endTime) {
    if (Date.parse(dsl.meta.endTime) <= Date.parse(dsl.meta.startTime)) {
      issues.push({ level: 'error', path: 'meta.endTime', message: '活动结束时间需晚于开始时间' });
    }
  }

  return issues;
}

/** 前后端共用的唯一校验入口：Admin 发布前调、Server 落库前调、Renderer 启动时调 */
export function validateFinalDsl(input: unknown, options: ValidateOptions = {}): ValidateResult {
  const parsed = finalDslSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      issues: parsed.error.issues.map((issue) => ({
        level: 'error' as const,
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    };
  }

  const issues = checkIntegrity(parsed.data, options);
  if (issues.some((i) => i.level === 'error')) {
    return { success: false, issues };
  }
  return { success: true, data: parsed.data, issues };
}

export function validateFinalDslOrThrow(input: unknown, options: ValidateOptions = {}): FinalDsl {
  const result = validateFinalDsl(input, options);
  if (!result.success) {
    const detail = result.issues
      .filter((i) => i.level === 'error')
      .map((i) => `${i.path}: ${i.message}`)
      .join('; ');
    throw new Error(`DSL 校验失败 —— ${detail}`);
  }
  return result.data;
}
