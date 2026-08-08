import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { CraftNode } from '@nca/dsl';
import { componentMap, getMaterial } from '@nca/materials';
import { ROOT_NODE_ID } from '@nca/shared';
import { evaluateBinding } from '../runtime/expression';
import { resolveCondition, resolveProps } from '../runtime/props-parser';
import { useRuntime } from '../runtime/RuntimeProvider';
import { EditableNode } from './EditableNode';

/** 循环作用域。嵌套循环时内层继承外层，item/index 别名各自独立 */
const ScopeContext = createContext<Record<string, unknown>>({});

function ScopeProvider({ scope, children }: { scope: Record<string, unknown>; children: ReactNode }) {
  const parent = useContext(ScopeContext);
  const merged = useMemo(() => ({ ...parent, ...scope }), [parent, scope]);
  return <ScopeContext.Provider value={merged}>{children}</ScopeContext.Provider>;
}

export function CanvasRenderer() {
  return <NodeRenderer nodeId={ROOT_NODE_ID} />;
}

export function NodeRenderer({ nodeId }: { nodeId: string }) {
  const { dsl } = useRuntime();
  const node = dsl.craftJson[nodeId];

  if (!node) {
    console.warn(`[nca] 节点 ${nodeId} 不存在`);
    return null;
  }
  if (node.hidden) return null;

  // 循环要在条件之后、渲染之前展开：每一项都拿到自己的作用域
  if (node.control?.loop) {
    return <LoopNode nodeId={nodeId} node={node} />;
  }
  return <SingleNode nodeId={nodeId} node={node} />;
}

function LoopNode({ nodeId, node }: { nodeId: string; node: CraftNode }) {
  const { buildContext } = useRuntime();
  const scope = useContext(ScopeContext);
  const loop = node.control!.loop!;

  const ctx = buildContext(scope);
  if (!resolveCondition(node.control?.if, ctx)) return null;

  const raw = evaluateBinding(loop.source, ctx);
  const items = Array.isArray(raw) ? raw : [];

  return (
    <>
      {items.map((item, index) => {
        const itemScope = { [loop.itemAlias]: item, [loop.indexAlias]: index };
        // keyBy 让列表重排时组件状态不错位；没配就退回 index
        const key = loop.keyBy
          ? String(evaluateBinding(loop.keyBy, { ...ctx, ...itemScope }) ?? index)
          : String(index);
        return (
          <ScopeProvider key={key} scope={itemScope}>
            <SingleNode nodeId={nodeId} node={node} skipLoop />
          </ScopeProvider>
        );
      })}
    </>
  );
}

function SingleNode({
  nodeId,
  node,
  skipLoop = false,
}: {
  nodeId: string;
  node: CraftNode;
  skipLoop?: boolean;
}) {
  const { dsl, buildContext, emit, editing, openModals } = useRuntime();
  const scope = useContext(ScopeContext);
  const ctx = buildContext(scope);

  if (!skipLoop && !resolveCondition(node.control?.if, ctx)) return null;

  const Component = componentMap[node.type.resolvedName];
  if (!Component) {
    // 物料缺失只坏掉这一个节点，不能让整页白屏
    console.error(`[nca] 未注册的物料：${node.type.resolvedName}`);
    return editing ? (
      <div style={{ padding: 12, color: '#d4380d', border: '1px dashed #d4380d' }}>
        未知物料：{node.type.resolvedName}
      </div>
    ) : null;
  }

  const props = resolveProps(node.props, ctx);
  const runtimeProps = injectRuntimeProps(node, nodeId, openModals);

  const children =
    node.nodes.length > 0
      ? node.nodes.map((childId) => <NodeRenderer key={childId} nodeId={childId} />)
      : undefined;

  // 具名插槽：物料声明了哪些 slot，就把 linkedNodes 里挂进去的子节点渲染出来，
  // 以 slotContent 命名空间交给物料自行摆放
  const slotContent: Record<string, ReactNode> = {};
  const material = getMaterial(node.type.resolvedName);
  for (const slot of material?.meta.slots ?? []) {
    const slotNodeId = node.linkedNodes?.[slot];
    if (slotNodeId && dsl.craftJson[slotNodeId]) {
      slotContent[slot] = <NodeRenderer key={slotNodeId} nodeId={slotNodeId} />;
    }
  }

  const rendered = (
    <Component
      {...props}
      {...runtimeProps}
      nodeId={nodeId}
      editing={editing}
      emit={(event: string, payload?: Record<string, unknown>) => emit(nodeId, event, payload)}
      slotContent={Object.keys(slotContent).length > 0 ? slotContent : undefined}
    >
      {children}
    </Component>
  );

  // 只有编辑态才套标记层，线上渲染保持零额外开销
  return editing ? <EditableNode nodeId={nodeId}>{rendered}</EditableNode> : rendered;
}

/**
 * 注入由运行时掌控、而非 DSL 配置的 props。
 * 目前只有弹窗的开关态：modal.open/close 动作改的是运行时的 openModals，
 * 不写回 DSL，这样同一份 DSL 才能被反复打开关闭。
 */
function injectRuntimeProps(
  node: CraftNode,
  nodeId: string,
  openModals: string[],
): Record<string, unknown> {
  if (node.type.resolvedName === 'Modal') {
    return { visible: openModals.includes(nodeId) };
  }
  return {};
}
