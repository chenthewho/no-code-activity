import { useCallback, useEffect, useRef, useState } from 'react';
import { Spin } from 'antd';
import type { FinalDsl } from '@nca/dsl';
import { useDesignerStore } from '../../stores/designer';

const RENDERER_ORIGIN = import.meta.env.VITE_RENDERER_ORIGIN ?? 'http://localhost:5180';

const MESSAGE = {
  READY: 'RENDERER_READY',
  DSL: 'CRAFT_JSON_PREVIEW',
  SELECT: 'NODE_SELECTED',
  EDITOR_SELECT: 'EDITOR_SELECT',
  DROP_PROBE: 'EDITOR_DROP_PROBE',
  DROP_END: 'EDITOR_DROP_END',
  DROP_TARGET: 'EDITOR_DROP_TARGET',
  REMOVE: 'EDITOR_REMOVE_NODE',
} as const;

export interface DropTargetInfo {
  parentId: string;
  index: number;
}

interface Props {
  dsl: FinalDsl;
  onSelectNode?: (nodeId: string) => void;
  designWidth?: number;
  canvasHeight?: number;
}

/**
 * 画布用 iframe 承载真实的 Renderer。
 *
 * 好处是双重的：样式天然隔离（后台的 antd 不会污染活动页），
 * 且预览跑的就是线上那份渲染代码——设计器不需要另写一套预览组件，
 * 也就不存在「画布好看、线上错位」的漂移。
 *
 * 渲染器跑在独立端口，已是跨源隔离，因此不加 sandbox：
 * allow-scripts 而不带 allow-same-origin 会把 iframe 变成不透明源，
 * 反而让指定 targetOrigin 的 postMessage 失效。真正的管控是下面的 targetOrigin。
 */
export function IframeCanvasSurface({
  dsl,
  onSelectNode,
  designWidth = 375,
  canvasHeight = 667,
}: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const seqRef = useRef(0);
  const selectedId = useDesignerStore((s) => s.selectedId);
  const dragging = useDesignerStore((s) => s.dragging);
  const setDropTarget = useDesignerStore((s) => s.setDropTarget);

  const post = useCallback((type: string, payload?: unknown) => {
    iframeRef.current?.contentWindow?.postMessage({ type, payload }, RENDERER_ORIGIN);
  }, []);

  useEffect(() => {
    const handle = (event: MessageEvent<{ type?: string; payload?: Record<string, unknown> }>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const { type, payload } = event.data ?? {};

      if (type === MESSAGE.READY) {
        setReady(true);
      } else if (type === MESSAGE.SELECT && typeof payload?.nodeId === 'string') {
        onSelectNode?.(payload.nodeId);
      } else if (type === MESSAGE.REMOVE) {
        const nodeId = payload?.nodeId;
        if (typeof nodeId === 'string') useDesignerStore.getState().removeNode(nodeId);
      } else if (type === MESSAGE.DROP_TARGET) {
        setDropTarget({
          parentId: String(payload?.parentId ?? 'ROOT'),
          index: Number(payload?.index ?? 0),
        });
      }
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, [onSelectNode, setDropTarget]);

  // DSL 变更下发。带自增 seq，渲染器据此丢弃乱序到达的旧消息
  useEffect(() => {
    if (!ready) return;
    seqRef.current += 1;
    iframeRef.current?.contentWindow?.postMessage(
      { type: MESSAGE.DSL, payload: dsl, seq: seqRef.current },
      RENDERER_ORIGIN,
    );
  }, [dsl, ready]);

  // 选中态双向联动：节点树里选中的节点，画布上也要描出来
  useEffect(() => {
    if (!ready) return;
    post(MESSAGE.EDITOR_SELECT, { nodeId: selectedId });
  }, [selectedId, ready, post]);

  /**
   * 拖拽期间把 iframe 的 pointer-events 关掉。
   * 否则指针一进 iframe，事件就全被它吞掉，父窗口再也收不到 mousemove——
   * 关掉之后父窗口拿到坐标，换算成 iframe 内坐标发给渲染器做命中测试。
   */
  useEffect(() => {
    if (!dragging || !ready) return;

    const onMove = (e: MouseEvent) => {
      const rect = iframeRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
        post(MESSAGE.DROP_END);
        setDropTarget(null);
        return;
      }
      post(MESSAGE.DROP_PROBE, { x, y });
    };

    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mousemove', onMove);
      post(MESSAGE.DROP_END);
    };
  }, [dragging, ready, post, setDropTarget]);

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        height: '100%',
        padding: 16,
        overflow: 'auto',
        background: '#f0f2f5',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: designWidth,
          minHeight: canvasHeight,
          background: '#fff',
          boxShadow: '0 2px 12px rgba(0,0,0,.12)',
        }}
      >
        {!ready && (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
            <Spin />
          </div>
        )}
        <iframe
          ref={iframeRef}
          title="设计器画布"
          src={`${RENDERER_ORIGIN}/?preview=1`}
          style={{
            display: 'block',
            width: '100%',
            height: canvasHeight,
            border: 'none',
            pointerEvents: dragging ? 'none' : 'auto',
          }}
        />
      </div>
    </div>
  );
}
