import { createEmptyDsl, type CraftNode, type FinalDsl, type JsonValue } from '@nca/dsl';
import { createId, ROOT_NODE_ID } from '@nca/shared';
import { create } from 'zustand';

interface DesignerState {
  dsl: FinalDsl;
  selectedId: string | null;
  dirty: boolean;
  /** 撤销/重做栈，存 DSL 快照 */
  past: FinalDsl[];
  future: FinalDsl[];

  load: (dsl: FinalDsl) => void;
  select: (nodeId: string | null) => void;
  addNode: (materialName: string, defaultProps: Record<string, JsonValue>, parentId?: string) => void;
  updateProps: (nodeId: string, patch: Record<string, JsonValue>) => void;
  removeNode: (nodeId: string) => void;
  moveNode: (nodeId: string, direction: -1 | 1) => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;
}

const HISTORY_LIMIT = 50;

/** 每次结构性改动前压栈，保证撤销粒度是「一次操作」而不是「一次按键」 */
function commit(state: DesignerState, next: FinalDsl): Partial<DesignerState> {
  return {
    dsl: next,
    past: [...state.past, state.dsl].slice(-HISTORY_LIMIT),
    future: [],
    dirty: true,
  };
}

/**
 * 新节点的落点：选中容器就放进去，选中普通节点就放到它的父容器里，
 * 什么都没选则挂到根下。
 */
function resolveDropParent(dsl: FinalDsl, selectedId: string | null): string {
  if (!selectedId) return ROOT_NODE_ID;
  const node = dsl.craftJson[selectedId];
  if (!node) return ROOT_NODE_ID;
  if (node.isCanvas) return selectedId;
  return node.parent ?? ROOT_NODE_ID;
}

export const useDesignerStore = create<DesignerState>((set, get) => ({
  dsl: createEmptyDsl('pending', '未命名活动'),
  selectedId: null,
  dirty: false,
  past: [],
  future: [],

  load(dsl) {
    set({ dsl, selectedId: null, dirty: false, past: [], future: [] });
  },

  select(nodeId) {
    set({ selectedId: nodeId });
  },

  addNode(materialName, defaultProps, parentId) {
    const state = get();
    const parent = parentId ?? resolveDropParent(state.dsl, state.selectedId);
    const nodeId = createId(materialName.toLowerCase());

    const node: CraftNode = {
      type: { resolvedName: materialName },
      isCanvas: false,
      props: { ...defaultProps },
      custom: {},
      hidden: false,
      nodes: [],
      linkedNodes: {},
      parent,
    };

    const next: FinalDsl = {
      ...state.dsl,
      craftJson: {
        ...state.dsl.craftJson,
        [nodeId]: node,
        [parent]: {
          ...state.dsl.craftJson[parent]!,
          nodes: [...state.dsl.craftJson[parent]!.nodes, nodeId],
        },
      },
    };
    set({ ...commit(state, next), selectedId: nodeId });
  },

  updateProps(nodeId, patch) {
    const state = get();
    const node = state.dsl.craftJson[nodeId];
    if (!node) return;
    const next: FinalDsl = {
      ...state.dsl,
      craftJson: {
        ...state.dsl.craftJson,
        [nodeId]: { ...node, props: { ...node.props, ...patch } },
      },
    };
    set(commit(state, next));
  },

  removeNode(nodeId) {
    const state = get();
    if (nodeId === ROOT_NODE_ID) return;

    // 连子树一起删，否则会留下一堆孤儿节点，发布时才被校验拦下
    const toDelete = new Set<string>();
    const walk = (id: string) => {
      toDelete.add(id);
      state.dsl.craftJson[id]?.nodes.forEach(walk);
    };
    walk(nodeId);

    const craftJson = { ...state.dsl.craftJson };
    for (const id of toDelete) delete craftJson[id];
    for (const [id, node] of Object.entries(craftJson)) {
      if (node.nodes.some((child) => toDelete.has(child))) {
        craftJson[id] = { ...node, nodes: node.nodes.filter((child) => !toDelete.has(child)) };
      }
    }

    const next: FinalDsl = {
      ...state.dsl,
      craftJson,
      // 事件绑定也要跟着清，留着就是指向不存在节点的死引用
      events: state.dsl.events.filter((e) => !toDelete.has(e.nodeId)),
    };
    set({ ...commit(state, next), selectedId: null });
  },

  moveNode(nodeId, direction) {
    const state = get();
    const parentId = state.dsl.craftJson[nodeId]?.parent ?? ROOT_NODE_ID;
    const parent = state.dsl.craftJson[parentId];
    if (!parent) return;

    const index = parent.nodes.indexOf(nodeId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= parent.nodes.length) return;

    const nodes = [...parent.nodes];
    [nodes[index], nodes[target]] = [nodes[target]!, nodes[index]!];

    const next: FinalDsl = {
      ...state.dsl,
      craftJson: { ...state.dsl.craftJson, [parentId]: { ...parent, nodes } },
    };
    set(commit(state, next));
  },

  undo() {
    const state = get();
    const previous = state.past.at(-1);
    if (!previous) return;
    set({
      dsl: previous,
      past: state.past.slice(0, -1),
      future: [state.dsl, ...state.future].slice(0, HISTORY_LIMIT),
      dirty: true,
    });
  },

  redo() {
    const state = get();
    const next = state.future[0];
    if (!next) return;
    set({
      dsl: next,
      past: [...state.past, state.dsl].slice(-HISTORY_LIMIT),
      future: state.future.slice(1),
      dirty: true,
    });
  },

  markSaved() {
    set({ dirty: false });
  },
}));
