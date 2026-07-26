import { ROOT_NODE_ID } from '@nca/shared';
import type { CraftJson } from '@nca/dsl';

export interface DropTarget {
  parentId: string;
  index: number;
  /** 指示线的位置，画布据此画横线或高亮容器 */
  hint: { top: number; left: number; width: number; height: number; mode: 'line' | 'box' };
}

/** 从坐标找到最内层被标记的节点 */
export function nodeAtPoint(x: number, y: number): { nodeId: string; el: HTMLElement } | null {
  const el = document.elementFromPoint(x, y);
  if (!(el instanceof HTMLElement)) return null;
  const tagged = el.closest('[data-nca-node]');
  if (!(tagged instanceof HTMLElement)) return null;
  const nodeId = tagged.getAttribute('data-nca-node');
  return nodeId ? { nodeId, el: tagged } : null;
}

/** excludeId 及其子树都不能作为落点——把节点拖进自己里面会让节点树脱环 */
function isInsideSubtree(nodeId: string, rootId: string, tree: CraftJson): boolean {
  let cursor: string | null | undefined = nodeId;
  while (cursor) {
    if (cursor === rootId) return true;
    cursor = tree[cursor]?.parent ?? null;
  }
  return false;
}

export function findElement(nodeId: string): HTMLElement | null {
  const el = document.querySelector(`[data-nca-node="${CSS.escape(nodeId)}"]`);
  return el instanceof HTMLElement ? el : null;
}

/**
 * 计算拖拽落点。
 *
 * 规则：命中容器且指针在其中部 → 放进容器；否则按指针在命中节点的上半/下半
 * 决定插到它前面还是后面。这样既能往空容器里放，也能在兄弟之间精确插队。
 */
export function computeDropTarget(
  x: number,
  y: number,
  tree: CraftJson,
  excludeId?: string,
): DropTarget {
  let hit = nodeAtPoint(x, y);

  // 命中的是被拖节点自己或其子孙时，往上找一个合法的落点容器
  if (hit && excludeId && isInsideSubtree(hit.nodeId, excludeId, tree)) {
    const parentId = tree[excludeId]?.parent;
    const parentEl = parentId ? findElement(parentId) : null;
    hit = parentId && parentEl ? { nodeId: parentId, el: parentEl } : null;
  }

  if (!hit) {
    return fallbackToRoot(tree);
  }

  const { nodeId, el } = hit;
  const node = tree[nodeId];
  if (!node) return fallbackToRoot(tree);

  const rect = el.getBoundingClientRect();
  const isContainer = node.isCanvas === true;

  // 容器中部 60% 区域视为「放进去」
  if (isContainer) {
    const innerTop = rect.top + rect.height * 0.2;
    const innerBottom = rect.bottom - rect.height * 0.2;
    if (y >= innerTop && y <= innerBottom) {
      const index = indexInsideContainer(nodeId, y, tree, excludeId);
      return {
        parentId: nodeId,
        index,
        hint: {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          mode: 'box',
        },
      };
    }
  }

  const parentId = node.parent ?? ROOT_NODE_ID;
  const parent = tree[parentId];
  if (!parent) return fallbackToRoot(tree);

  const siblingIndex = parent.nodes.indexOf(nodeId);
  const after = y > rect.top + rect.height / 2;
  const index = siblingIndex === -1 ? parent.nodes.length : siblingIndex + (after ? 1 : 0);

  return {
    parentId,
    index,
    hint: {
      top: after ? rect.bottom : rect.top,
      left: rect.left,
      width: rect.width,
      height: 0,
      mode: 'line',
    },
  };
}

/** 在容器内按已有子节点的位置找插入下标 */
function indexInsideContainer(
  containerId: string,
  y: number,
  tree: CraftJson,
  excludeId?: string,
): number {
  const children = tree[containerId]?.nodes ?? [];
  for (let i = 0; i < children.length; i++) {
    if (children[i] === excludeId) continue;
    const childEl = findElement(children[i] as string);
    if (!childEl) continue;
    const rect = childEl.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) return i;
  }
  return children.length;
}

function fallbackToRoot(tree: CraftJson): DropTarget {
  const rootEl = findElement(ROOT_NODE_ID);
  const rect = rootEl?.getBoundingClientRect();
  return {
    parentId: ROOT_NODE_ID,
    index: tree[ROOT_NODE_ID]?.nodes.length ?? 0,
    hint: {
      top: rect ? rect.bottom : 0,
      left: rect?.left ?? 0,
      width: rect?.width ?? 0,
      height: 0,
      mode: 'line',
    },
  };
}
