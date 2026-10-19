import { ROOT_NODE_ID } from '@nca/shared';
import { finalDslSchema, type FinalDsl } from './schema/dsl';
import type { CraftJson } from './schema/node';
import { ACTION_FIELD_LABELS, REQUIRED_ACTION_FIELDS } from './schema/action';
import { compareVersion } from './migrate';

export interface DslIssue {
  level: 'error' | 'warning';
  path: string;
  message: string;
  /** 面板上的位置描述，如「事件 2 › 动作 3「轻提示」」，用于把问题指回具体表单 */
  location?: string;
  /** 关联的节点 id，设计器据此跳转选中 */
  nodeId?: string;
}

export type ValidateResult =
  | { success: true; data: FinalDsl; issues: DslIssue[] }
  | { success: false; issues: DslIssue[] };

/**
 * draft   —— 编辑中。允许「还没填」，缺字段只报 warning，保证草稿随时存得下。
 * publish —— 上线前。同样的缺失升级为 error，把不完整的配置拦在发布环节。
 */
export type ValidateMode = 'draft' | 'publish';

export interface ValidateOptions {
  /** 已注册物料名集合；传入则校验 resolvedName 能否解析 */
  knownMaterials?: ReadonlySet<string> | readonly string[];
  mode?: ValidateMode;
  /**
   * 物料名 → 当前注册版本。节点记录的版本高于它，说明 DSL 是用更新的物料搭的、
   * 线上渲染器可能还不认识新 props——发布时必须拦住，而不是上线后才发现组件错乱。
   */
  materialVersions?: Readonly<Record<string, string>>;
  /**
   * 物料名 → 支持的宿主（缺省表示全部支持）。投放宿主里有物料不支持的，提示一条 warning：
   * 页面照样能发，只是那个组件在该宿主里不会显示。
   */
  materialHosts?: Readonly<Record<string, readonly string[] | undefined>>;
}

/**
 * 结构完整性校验。zod 只管「字段形状对不对」，这里管「引用指得到吗」——
 * 悬空的子节点 id、指向不存在节点的事件绑定，都会让 Renderer 在线上白屏，
 * 必须在发布前拦下。
 */
function checkIntegrity(dsl: FinalDsl, options: ValidateOptions): DslIssue[] {
  const issues: DslIssue[] = [];
  const mode: ValidateMode = options.mode ?? 'publish';
  // 编辑中「还没填完」是常态，不该阻断保存；发布时同样的缺失必须拦住
  const missingLevel: DslIssue['level'] = mode === 'draft' ? 'warning' : 'error';
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
    const registered = options.materialVersions?.[node.type.resolvedName];
    if (registered && node.type.version && compareVersion(node.type.version, registered) > 0) {
      issues.push({
        level: 'error',
        path: `craftJson.${id}.type.version`,
        nodeId: id,
        message: `组件「${node.displayName ?? node.type.resolvedName}」用的是 v${node.type.version}，高于物料注册表的 v${registered}，请先同步物料再发布`,
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

  if (options.materialHosts) {
    const warned = new Set<string>();
    for (const [id, node] of Object.entries(tree)) {
      const name = node.type.resolvedName;
      const supported = options.materialHosts[name];
      if (!supported || supported.length === 0 || warned.has(name)) continue;
      const missing = dsl.meta.hosts.filter((h) => !supported.includes(h));
      if (missing.length === 0) continue;
      warned.add(name);
      issues.push({
        level: 'warning',
        path: `craftJson.${id}.type.resolvedName`,
        nodeId: id,
        message: `组件「${node.displayName ?? name}」只支持 ${supported.join('、')}，在 ${missing.join('、')} 中不会显示`,
      });
    }
  }

  const dataSourceIds = new Set(dsl.dataSources.map((ds) => ds.id));

  for (const [i, binding] of dsl.events.entries()) {
    if (!nodeIds.has(binding.nodeId)) {
      issues.push({
        level: 'error',
        path: `events[${i}].nodeId`,
        message: `事件绑定指向的组件已不存在`,
        location: `事件 ${i + 1}`,
      });
    }
    for (const [j, action] of binding.actions.entries()) {
      const at = `events[${i}].actions[${j}]`;
      const where = `事件 ${i + 1} › 动作 ${j + 1}`;
      const record = action as unknown as Record<string, unknown>;

      // 必填项缺失：清单来自协议包，与设计器表单的必填标记同源
      for (const field of REQUIRED_ACTION_FIELDS[action.type] ?? []) {
        const value = record[field];
        if (value === undefined || value === null || value === '') {
          issues.push({
            level: missingLevel,
            path: `${at}.${field}`,
            message: `「${ACTION_FIELD_LABELS[field] ?? field}」还没填`,
            location: where,
            nodeId: binding.nodeId,
          });
        }
      }

      switch (action.type) {
        case 'dataSource.refresh':
          if (action.dataSourceId && !dataSourceIds.has(action.dataSourceId)) {
            issues.push({
              level: 'error',
              path: `${at}.dataSourceId`,
              message: `指向的数据源已不存在`,
              location: where,
              nodeId: binding.nodeId,
            });
          }
          break;
        case 'modal.open':
          if (action.modalId && !nodeIds.has(action.modalId)) {
            issues.push({
              level: 'error',
              path: `${at}.modalId`,
              message: `指向的弹窗已不存在`,
              location: where,
              nodeId: binding.nodeId,
            });
          }
          break;
        case 'component.trigger':
          if (action.nodeId && !nodeIds.has(action.nodeId)) {
            issues.push({
              level: 'error',
              path: `${at}.nodeId`,
              message: `指向的组件已不存在`,
              location: where,
              nodeId: binding.nodeId,
            });
          }
          break;
        case 'form.submit':
          if (action.formNodeId && !nodeIds.has(action.formNodeId)) {
            issues.push({
              level: 'error',
              path: `${at}.formNodeId`,
              message: `指向的表单节点已不存在`,
              location: where,
              nodeId: binding.nodeId,
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

    const dsWhere = `数据源「${ds.name}」`;
    if (ds.type === 'http' && !ds.url) {
      issues.push({
        level: missingLevel,
        path: `dataSources[${i}].url`,
        message: '「接口地址」还没填',
        location: dsWhere,
      });
    }
    if (ds.type === 'computed' && !ds.expression) {
      issues.push({
        level: missingLevel,
        path: `dataSources[${i}].expression`,
        message: '「计算表达式」还没填',
        location: dsWhere,
      });
    }
  }

  for (const [id, node] of Object.entries(tree)) {
    const loop = node.control?.loop;
    if (loop && !loop.source) {
      issues.push({
        level: missingLevel,
        path: `craftJson.${id}.control.loop.source`,
        message: '列表渲染的「数据来源」还没填',
        location: `组件 ${node.displayName ?? node.type.resolvedName}`,
        nodeId: id,
      });
    }
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
