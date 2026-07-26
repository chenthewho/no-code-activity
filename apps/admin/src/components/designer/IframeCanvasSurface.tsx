import { useCallback, useEffect, useRef } from 'react';
import type { FinalDsl } from '@nca/dsl';
import { useDesignerStore } from '../../stores/designer';
import { PREVIEW_MESSAGE, PreviewFrame, type PreviewFrameHandle } from './PreviewFrame';

interface Props {
  dsl: FinalDsl;
  onSelectNode?: (nodeId: string) => void;
  designWidth?: number;
  canvasHeight?: number;
}

/**
 * 设计器画布：在 PreviewFrame 之上叠加编辑交互。
 *
 * iframe 承载的是真实 Renderer——样式天然隔离（后台的 antd 污染不到活动页），
 * 且预览跑的就是线上那份渲染代码，不存在「画布好看、线上错位」的漂移。
 */
export function IframeCanvasSurface({
  dsl,
  onSelectNode,
  designWidth = 375,
  canvasHeight = 667,
}: Props) {
  const frameRef = useRef<PreviewFrameHandle>(null);
  const selectedId = useDesignerStore((s) => s.selectedId);
  const dragging = useDesignerStore((s) => s.dragging);
  const setDropTarget = useDesignerStore((s) => s.setDropTarget);

  const handleMessage = useCallback(
    (type: string, payload: Record<string, unknown> | undefined) => {
      if (type === PREVIEW_MESSAGE.SELECT && typeof payload?.nodeId === 'string') {
        onSelectNode?.(payload.nodeId);
      } else if (type === PREVIEW_MESSAGE.REMOVE && typeof payload?.nodeId === 'string') {
        useDesignerStore.getState().removeNode(payload.nodeId);
      } else if (type === PREVIEW_MESSAGE.DROP_TARGET) {
        setDropTarget({
          parentId: String(payload?.parentId ?? 'ROOT'),
          index: Number(payload?.index ?? 0),
        });
      }
    },
    [onSelectNode, setDropTarget],
  );

  // 选中态双向联动：节点树里选中的节点，画布上也要描出来
  useEffect(() => {
    frameRef.current?.post(PREVIEW_MESSAGE.EDITOR_SELECT, { nodeId: selectedId });
  }, [selectedId, dsl]);

  /**
   * 拖拽期间把 iframe 的 pointer-events 关掉（interactive=false）。
   * 否则指针一进 iframe，事件就全被它吞掉，父窗口再也收不到 mousemove——
   * 关掉之后父窗口拿到坐标，换算成 iframe 内坐标发给渲染器做命中测试。
   */
  useEffect(() => {
    if (!dragging) return;

    const onMove = (e: MouseEvent) => {
      const rect = frameRef.current?.getRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
        frameRef.current?.post(PREVIEW_MESSAGE.DROP_END);
        setDropTarget(null);
        return;
      }
      frameRef.current?.post(PREVIEW_MESSAGE.DROP_PROBE, { x, y });
    };

    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mousemove', onMove);
      frameRef.current?.post(PREVIEW_MESSAGE.DROP_END);
    };
  }, [dragging, setDropTarget]);

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
      <PreviewFrame
        ref={frameRef}
        dsl={dsl}
        width={designWidth}
        height={canvasHeight}
        interactive={!dragging}
        onMessage={handleMessage}
      />
    </div>
  );
}
