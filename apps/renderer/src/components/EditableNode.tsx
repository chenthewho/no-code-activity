import { useEffect, useRef, type ReactNode } from 'react';

/**
 * 编辑态给每个节点的真实 DOM 打上 data-nca-node 标记，供画布做命中测试。
 *
 * 用 display:contents 的包裹层而不是真的加一层 div——后者会破坏 flex 布局，
 * 让画布和线上长得不一样，那就违背了「所见即所得」的前提。
 * 包裹层自身不生成盒子，标记由 effect 盖到子元素的真实 DOM 上。
 */
export function EditableNode({ nodeId, children }: { nodeId: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current?.firstElementChild;
    if (!(el instanceof HTMLElement)) return;
    el.setAttribute('data-nca-node', nodeId);
    return () => el.removeAttribute('data-nca-node');
  });

  return (
    <div ref={ref} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
