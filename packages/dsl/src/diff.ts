import { BASELINE_MATERIAL_VERSION } from './migrate';
import type { FinalDsl } from './schema/dsl';
import type { CraftNode } from './schema/node';

/**
 * 两份 DSL 的差异：回滚前、灰度前、发布前，运营要能看清「这一版到底改了什么」。
 *
 * 按「人能理解的单位」比：组件（新增 / 删除 / 改了哪些属性 / 挪了位置）、事件绑定、
 * 数据源、页面设置、初始状态——而不是逐行比 JSON，后者对运营毫无意义。
 */

export interface FieldChange {
  path: string;
  from: unknown;
  to: unknown;
}

export interface NodeRef {
  id: string;
  material: string;
  /** 设计器里显示的名字：自定义名称或物料名 */
  label: string;
}

export interface NodeChange extends NodeRef {
  props: FieldChange[];
  /** 换了父容器，或与同一容器里留下来的兄弟组件之间的先后顺序变了 */
  moved: boolean;
  /** 其它变化：显隐、条件/循环、插槽、物料版本 */
  other: string[];
}

export interface IdChanges {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface DslDiff {
  nodes: { added: NodeRef[]; removed: NodeRef[]; changed: NodeChange[] };
  events: IdChanges;
  dataSources: IdChanges;
  meta: FieldChange[];
  initialState: FieldChange[];
  /** 两份内容等价 */
  empty: boolean;
}

/** 键排序后的 JSON：对象键顺序不同不算改动 */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

const same = (a: unknown, b: unknown): boolean => stable(a) === stable(b);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** 对象逐层比到叶子，数组整体比较（列表项的增删改对运营来说就是「这一项变了」） */
function diffFields(from: unknown, to: unknown, path = ''): FieldChange[] {
  if (isPlainObject(from) && isPlainObject(to)) {
    const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort();
    return keys.flatMap((key) => diffFields(from[key], to[key], path ? `${path}.${key}` : key));
  }
  return same(from, to) ? [] : [{ path, from, to }];
}

/**
 * 两份子节点列表里「没动过」的那批：取最长公共子序列，其余的才是被挪动的。
 * 只比下标的话，前面插入或删掉一个组件，后面所有兄弟都会被误报成挪了位置。
 */
function unmoved(a: string[], b: string[]): Set<string> {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const keep = new Set<string>();
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      keep.add(a[i]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
    else j++;
  }
  return keep;
}

function nodeRef(id: string, node: CraftNode): NodeRef {
  return { id, material: node.type.resolvedName, label: node.displayName ?? node.type.resolvedName };
}

function idChanges<T extends { id: string }>(from: T[], to: T[]): IdChanges {
  const before = new Map(from.map((item) => [item.id, item]));
  const after = new Map(to.map((item) => [item.id, item]));
  return {
    added: [...after.keys()].filter((id) => !before.has(id)),
    removed: [...before.keys()].filter((id) => !after.has(id)),
    changed: [...after.keys()].filter((id) => before.has(id) && !same(before.get(id), after.get(id))),
  };
}

export function diffDsl(from: FinalDsl, to: FinalDsl): DslDiff {
  const added: NodeRef[] = [];
  const removed: NodeRef[] = [];
  const changed: NodeChange[] = [];

  // 同一个容器下，两版都还在的子节点里谁的相对顺序变了
  const reordered = new Set<string>();
  for (const [id, after] of Object.entries(to.craftJson)) {
    const before = from.craftJson[id];
    if (!before) continue;
    const a = before.nodes.filter((child) => after.nodes.includes(child));
    const b = after.nodes.filter((child) => before.nodes.includes(child));
    const keep = unmoved(a, b);
    for (const child of a) if (!keep.has(child)) reordered.add(child);
  }

  for (const [id, after] of Object.entries(to.craftJson)) {
    const before = from.craftJson[id];
    if (!before) {
      added.push(nodeRef(id, after));
      continue;
    }
    const props = diffFields(before.props, after.props);
    const moved = (before.parent ?? null) !== (after.parent ?? null) || reordered.has(id);
    const other: string[] = [];
    if (before.hidden !== after.hidden) other.push(after.hidden ? '隐藏' : '取消隐藏');
    if (!same(before.control, after.control)) other.push('条件 / 循环渲染');
    if (!same(before.linkedNodes, after.linkedNodes)) other.push('插槽内容');
    if (before.type.resolvedName !== after.type.resolvedName) other.push('物料类型');
    // 设计器打开草稿时会给老节点补上版本号，没写版本号就是基线版本，补上不算改动
    const fromVersion = before.type.version ?? BASELINE_MATERIAL_VERSION;
    const toVersion = after.type.version ?? BASELINE_MATERIAL_VERSION;
    if (fromVersion !== toVersion) other.push(`物料版本 ${fromVersion} → ${toVersion}`);
    if ((before.displayName ?? '') !== (after.displayName ?? '')) other.push('名称');
    if (props.length > 0 || moved || other.length > 0) {
      changed.push({ ...nodeRef(id, after), props, moved, other });
    }
  }
  for (const [id, before] of Object.entries(from.craftJson)) {
    if (!to.craftJson[id]) removed.push(nodeRef(id, before));
  }

  // activityId 是活动身份而不是页面设置，复制出来的活动之间比较时不该算改动
  const { activityId: _fromId, ...fromMeta } = from.meta;
  const { activityId: _toId, ...toMeta } = to.meta;

  const diff: DslDiff = {
    nodes: { added, removed, changed },
    events: idChanges(from.events, to.events),
    dataSources: idChanges(from.dataSources, to.dataSources),
    meta: diffFields(fromMeta, toMeta),
    initialState: diffFields(from.initialState, to.initialState),
    empty: false,
  };
  diff.empty =
    added.length + removed.length + changed.length === 0 &&
    diff.events.added.length + diff.events.removed.length + diff.events.changed.length === 0 &&
    diff.dataSources.added.length + diff.dataSources.removed.length + diff.dataSources.changed.length === 0 &&
    diff.meta.length + diff.initialState.length === 0;
  return diff;
}
