import {
  createEmptyDsl,
  type CraftNode,
  type DataSource,
  type DslAction,
  type EventBinding,
  type FinalDsl,
  type JsonValue,
  type NodeControl,
} from '@nca/dsl';
import { createId, ROOT_NODE_ID } from '@nca/shared';
import { create } from 'zustand';

/**
 * 选中节点所属的弹窗（含自身），没有则为 null。
 *
 * 「当前在编辑哪个弹窗」不另存一份状态，而是由选中态推导出来：
 * 两份状态各存各的迟早会不同步——从节点树点进弹窗里的文字，
 * 却因为开关还停在关闭上而什么都看不见。
 */
export function modalOfNode(craftJson: FinalDsl['craftJson'], nodeId: string | null): string | null {
  let cursor = nodeId;
  while (cursor) {
    const node = craftJson[cursor];
    if (!node) return null;
    if (node.type.resolvedName === 'Modal') return cursor;
    cursor = node.parent ?? null;
  }
  return null;
}

export interface DragPayload {
  materialName: string;
  defaultProps: Record<string, JsonValue>;
  /** 从画布拖动已有节点时带上它的 id；从工具箱新建则为空 */
  nodeId?: string;
}

export interface DropTargetInfo {
  parentId: string;
  index: number;
}

interface DesignerState {
  dsl: FinalDsl;
  selectedId: string | null;
  dirty: boolean;
  /** 正在拖拽的物料/节点，非空时画布进入落点探测模式 */
  dragging: DragPayload | null;
  dropTarget: DropTargetInfo | null;
  /** 撤销/重做栈，存 DSL 快照 */
  past: FinalDsl[];
  future: FinalDsl[];
  /**
   * 反向指令通道，由画布组件挂载时注册。
   *
   * 有些改动必须由画布来算——比如「转为自由摆放」要先量出元素当前的渲染位置与宽度，
   * 而那只有 iframe 里的真实 DOM 知道。面板通过它把活派给画布，结果照常走 UPDATE_PROPS 回来。
   */
  askCanvas: ((type: string, payload?: unknown) => void) | null;
  setCanvasBridge: (fn: ((type: string, payload?: unknown) => void) | null) => void;

  load: (dsl: FinalDsl) => void;
  select: (nodeId: string | null) => void;
  startDrag: (payload: DragPayload) => void;
  setDropTarget: (target: DropTargetInfo | null) => void;
  /** 释放拖拽：把落点应用成插入或移动，无落点则取消 */
  endDrag: () => void;
  addNode: (materialName: string, defaultProps: Record<string, JsonValue>, parentId?: string) => void;
  updateProps: (nodeId: string, patch: Record<string, JsonValue>) => void;
  removeNode: (nodeId: string) => void;
  moveNode: (nodeId: string, direction: -1 | 1) => void;
  /** 拖拽落点：把节点插到指定父容器的指定下标 */
  relocateNode: (nodeId: string, parentId: string, index: number) => void;
  insertNode: (
    materialName: string,
    defaultProps: Record<string, JsonValue>,
    parentId: string,
    index: number,
  ) => void;

  // 事件编排
  addEvent: (nodeId: string, trigger: EventBinding['trigger'], customEvent?: string) => void;
  updateEvent: (eventId: string, patch: Partial<EventBinding>) => void;
  removeEvent: (eventId: string) => void;
  addAction: (eventId: string, action: DslAction) => void;
  updateAction: (eventId: string, index: number, patch: Record<string, unknown>) => void;
  removeAction: (eventId: string, index: number) => void;
  moveAction: (eventId: string, index: number, direction: -1 | 1) => void;

  // 数据源
  addDataSource: (ds: DataSource) => void;
  updateDataSource: (id: string, patch: Record<string, unknown>) => void;
  removeDataSource: (id: string) => void;

  // 结构容器
  updateControl: (nodeId: string, control: NodeControl | undefined) => void;

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
  dragging: null,
  dropTarget: null,
  past: [],
  future: [],
  askCanvas: null,

  setCanvasBridge(fn) {
    set({ askCanvas: fn });
  },

  load(dsl) {
    set({ dsl, selectedId: null, dirty: false, past: [], future: [], dragging: null, dropTarget: null });
  },

  select(nodeId) {
    set({ selectedId: nodeId });
  },

  startDrag(payload) {
    set({ dragging: payload, dropTarget: null });
  },

  setDropTarget(target) {
    set({ dropTarget: target });
  },

  endDrag() {
    const { dragging, dropTarget } = get();
    set({ dragging: null, dropTarget: null });
    if (!dragging) return;

    // 没有落点 = 没拖到画布上，视作「原地点击」，追加到默认位置。
    // 两条路径都收敛在这里，避免 click 与 drop 各插入一次。
    if (!dropTarget) {
      if (!dragging.nodeId) {
        get().addNode(dragging.materialName, dragging.defaultProps);
      }
      return;
    }

    if (dragging.nodeId) {
      get().relocateNode(dragging.nodeId, dropTarget.parentId, dropTarget.index);
    } else {
      get().insertNode(
        dragging.materialName,
        dragging.defaultProps,
        dropTarget.parentId,
        dropTarget.index,
      );
    }
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

  /**
   * 拖拽落点。同容器内移动时下标要按「先摘除再插入」修正，
   * 否则往后拖会永远差一位。
   */
  relocateNode(nodeId, parentId, index) {
    const state = get();
    if (nodeId === ROOT_NODE_ID) return;

    const node = state.dsl.craftJson[nodeId];
    const target = state.dsl.craftJson[parentId];
    if (!node || !target) return;

    // 不能把容器拖进自己的子树里，否则节点树会脱环成孤岛
    let cursor: string | null | undefined = parentId;
    while (cursor) {
      if (cursor === nodeId) return;
      cursor = state.dsl.craftJson[cursor]?.parent ?? null;
    }

    const oldParentId = node.parent ?? ROOT_NODE_ID;
    const craftJson = { ...state.dsl.craftJson };

    const oldParent = craftJson[oldParentId];
    if (oldParent) {
      craftJson[oldParentId] = {
        ...oldParent,
        nodes: oldParent.nodes.filter((id) => id !== nodeId),
      };
    }

    const parentAfterRemoval = craftJson[parentId]!;
    const bounded = Math.max(0, Math.min(index, parentAfterRemoval.nodes.length));
    const nodes = [...parentAfterRemoval.nodes];
    nodes.splice(bounded, 0, nodeId);

    craftJson[parentId] = { ...parentAfterRemoval, nodes };
    craftJson[nodeId] = { ...node, parent: parentId };

    set(commit(state, { ...state.dsl, craftJson }));
  },

  insertNode(materialName, defaultProps, parentId, index) {
    const state = get();
    const parent = state.dsl.craftJson[parentId];
    if (!parent) return;

    const nodeId = createId(materialName.toLowerCase());
    const nodes = [...parent.nodes];
    nodes.splice(Math.max(0, Math.min(index, nodes.length)), 0, nodeId);

    const next: FinalDsl = {
      ...state.dsl,
      craftJson: {
        ...state.dsl.craftJson,
        [nodeId]: {
          type: { resolvedName: materialName },
          isCanvas: false,
          props: { ...defaultProps },
          custom: {},
          hidden: false,
          nodes: [],
          linkedNodes: {},
          parent: parentId,
        },
        [parentId]: { ...parent, nodes },
      },
    };
    set({ ...commit(state, next), selectedId: nodeId });
  },

  addEvent(nodeId, trigger, customEvent) {
    const state = get();
    const binding: EventBinding = {
      id: createId('evt'),
      nodeId,
      trigger,
      ...(customEvent ? { customEvent } : {}),
      actions: [],
    };
    set(commit(state, { ...state.dsl, events: [...state.dsl.events, binding] }));
  },

  updateEvent(eventId, patch) {
    const state = get();
    const events = state.dsl.events.map((e) => (e.id === eventId ? { ...e, ...patch } : e));
    set(commit(state, { ...state.dsl, events }));
  },

  removeEvent(eventId) {
    const state = get();
    set(commit(state, { ...state.dsl, events: state.dsl.events.filter((e) => e.id !== eventId) }));
  },

  addAction(eventId, action) {
    const state = get();
    const events = state.dsl.events.map((e) =>
      e.id === eventId ? { ...e, actions: [...e.actions, action] } : e,
    );
    set(commit(state, { ...state.dsl, events }));
  },

  updateAction(eventId, index, patch) {
    const state = get();
    const events = state.dsl.events.map((e) => {
      if (e.id !== eventId) return e;
      const actions = e.actions.map((a, i) =>
        i === index ? ({ ...a, ...patch } as DslAction) : a,
      );
      return { ...e, actions };
    });
    set(commit(state, { ...state.dsl, events }));
  },

  removeAction(eventId, index) {
    const state = get();
    const events = state.dsl.events.map((e) =>
      e.id === eventId ? { ...e, actions: e.actions.filter((_, i) => i !== index) } : e,
    );
    set(commit(state, { ...state.dsl, events }));
  },

  moveAction(eventId, index, direction) {
    const state = get();
    const events = state.dsl.events.map((e) => {
      if (e.id !== eventId) return e;
      const target = index + direction;
      if (target < 0 || target >= e.actions.length) return e;
      const actions = [...e.actions];
      [actions[index], actions[target]] = [actions[target]!, actions[index]!];
      return { ...e, actions };
    });
    set(commit(state, { ...state.dsl, events }));
  },

  addDataSource(ds) {
    const state = get();
    if (state.dsl.dataSources.some((d) => d.id === ds.id)) return;
    set(commit(state, { ...state.dsl, dataSources: [...state.dsl.dataSources, ds] }));
  },

  updateDataSource(id, patch) {
    const state = get();
    const dataSources = state.dsl.dataSources.map((d) =>
      d.id === id ? ({ ...d, ...patch } as DataSource) : d,
    );
    set(commit(state, { ...state.dsl, dataSources }));
  },

  removeDataSource(id) {
    const state = get();
    // 同步摘掉引用它的刷新动作，避免留下发布时才报错的死引用
    const events = state.dsl.events.map((e) => ({
      ...e,
      actions: e.actions.filter((a) => !(a.type === 'dataSource.refresh' && a.dataSourceId === id)),
    }));
    set(
      commit(state, {
        ...state.dsl,
        dataSources: state.dsl.dataSources.filter((d) => d.id !== id),
        events,
      }),
    );
  },

  updateControl(nodeId, control) {
    const state = get();
    const node = state.dsl.craftJson[nodeId];
    if (!node) return;
    const nextNode = { ...node };
    if (control === undefined) {
      delete nextNode.control;
    } else {
      nextNode.control = control;
    }
    set(
      commit(state, {
        ...state.dsl,
        craftJson: { ...state.dsl.craftJson, [nodeId]: nextNode },
      }),
    );
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
