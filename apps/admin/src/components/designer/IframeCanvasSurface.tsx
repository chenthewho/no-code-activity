import { useCallback, useEffect, useRef, useState } from 'react';
import type { FinalDsl, JsonValue } from '@nca/dsl';
import { modalOfNode, useDesignerStore } from '../../stores/designer';
import { ModalSwitch } from './ModalSwitch';
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

  /** 缩放/移动进行中：此时由父窗口接管指针，坐标转发进 iframe */
  const [capturing, setCapturing] = useState(false);

  const handleMessage = useCallback(
    (type: string, payload: Record<string, unknown> | undefined) => {
      const store = useDesignerStore.getState();

      switch (type) {
        case PREVIEW_MESSAGE.SELECT:
          if (typeof payload?.nodeId === 'string') onSelectNode?.(payload.nodeId);
          break;

        case PREVIEW_MESSAGE.REMOVE:
          if (typeof payload?.nodeId === 'string') store.removeNode(payload.nodeId);
          break;

        case PREVIEW_MESSAGE.DROP_TARGET:
          setDropTarget({
            parentId: String(payload?.parentId ?? 'ROOT'),
            index: Number(payload?.index ?? 0),
          });
          break;

        case PREVIEW_MESSAGE.CAPTURE_START:
          setCapturing(true);
          break;

        case PREVIEW_MESSAGE.UPDATE_PROPS:
          // 一次拖拽只回写一次，对应一步撤销
          if (typeof payload?.nodeId === 'string' && payload.patch) {
            store.updateProps(payload.nodeId, payload.patch as Record<string, JsonValue>);
          }
          break;

        case PREVIEW_MESSAGE.SHORTCUT: {
          const action = payload?.action;
          if (action === 'undo') store.undo();
          else if (action === 'redo') store.redo();
          else if (action === 'delete' && store.selectedId) store.removeNode(store.selectedId);
          break;
        }

        case PREVIEW_MESSAGE.DRAG_NODE_END:
          store.endDrag();
          break;

        case PREVIEW_MESSAGE.DRAG_NODE:
          // 流式节点的「移动」语义是重排，走与工具箱拖入相同的落点流程
          if (typeof payload?.nodeId === 'string') {
            const node = store.dsl.craftJson[payload.nodeId];
            if (node) {
              store.startDrag({
                materialName: node.type.resolvedName,
                defaultProps: {},
                nodeId: payload.nodeId,
              });
            }
          }
          break;

        default:
          break;
      }
    },
    [onSelectNode, setDropTarget],
  );

  // 选中态双向联动：节点树里选中的节点，画布上也要描出来
  useEffect(() => {
    frameRef.current?.post(PREVIEW_MESSAGE.EDITOR_SELECT, { nodeId: selectedId });
  }, [selectedId, dsl]);

  /**
   * 展开哪个弹窗由选中态推导：选中弹窗里的节点就展开它，选到页面上就收起。
   * 否则从节点树点进弹窗内部的文字，会因为弹窗没展开而什么都看不到。
   */
  const activeModalId = modalOfNode(dsl.craftJson, selectedId);
  useEffect(() => {
    frameRef.current?.post(PREVIEW_MESSAGE.EDIT_MODAL, { modalId: activeModalId });
  }, [activeModalId, dsl]);

  // 把画布的指令入口交给 store，设置器等面板才有办法请画布代为测量
  useEffect(() => {
    const bridge = useDesignerStore.getState().setCanvasBridge;
    bridge((type, payload) => frameRef.current?.post(type, payload));
    return () => bridge(null);
  }, []);

  /**
   * 拖拽重排：把 iframe 的 pointer-events 关掉后由父窗口收 mousemove，
   * 换算成 iframe 内坐标发给渲染器做命中测试。
   * 否则指针一进 iframe，事件就全被它吞掉，父窗口再也收不到。
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
      // 拖已有节点时要排除它自己，否则会提示「拖进自己里面」
      frameRef.current?.post(PREVIEW_MESSAGE.DROP_PROBE, { x, y, excludeId: dragging.nodeId });
    };

    document.addEventListener('mousemove', onMove);
    return () => {
      document.removeEventListener('mousemove', onMove);
      frameRef.current?.post(PREVIEW_MESSAGE.DROP_END);
    };
  }, [dragging, setDropTarget]);

  /**
   * 缩放/移动时父窗口只做补位转发。
   *
   * 注意这里不能像重排那样关掉 iframe 的 pointer-events：鼠标已在 iframe 内按下，
   * 事件被它隐式捕获，中途改样式抢不回这一次拖拽，反而会让画布彻底收不到移动。
   * 主力跟踪在 iframe 内部，父窗口只在指针移出画布时补上坐标。
   */
  useEffect(() => {
    if (!capturing) return;

    const onMove = (e: MouseEvent) => {
      const rect = frameRef.current?.getRect();
      if (!rect) return;
      frameRef.current?.post(PREVIEW_MESSAGE.POINTER, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    };
    const onUp = () => {
      frameRef.current?.post(PREVIEW_MESSAGE.CAPTURE_END);
      setCapturing(false);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [capturing]);

  /**
   * 只有从工具箱发起的拖拽才需要关掉 iframe 的指针事件——那时鼠标在父窗口按下，
   * 得让它在指针飘过画布时仍能收到 mousemove。
   * 画布内发起的拖拽相反：关掉就等于把事件从正在跟踪的画布手里夺走。
   */
  const interactive = !(dragging && !dragging.nodeId);

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
        // 拖动时锁掉文本选中，否则整页文字会被刷蓝
        userSelect: dragging || capturing ? 'none' : undefined,
      }}
    >
      {/* 相对定位，好让弹窗开关贴着手机框右侧浮着 */}
      <div style={{ position: 'relative' }}>
        <PreviewFrame
          ref={frameRef}
          dsl={dsl}
          width={designWidth}
          height={canvasHeight}
          interactive={interactive}
          onMessage={handleMessage}
        />
        <ModalSwitch
          dsl={dsl}
          activeId={activeModalId}
          // 开关即选中：展开就把弹窗选上，收起则清空选中，
          // 不然收起后设置面板还停在看不见的弹窗子节点上
          onToggle={(modalId) =>
            modalId ? onSelectNode?.(modalId) : useDesignerStore.getState().select(null)
          }
        />
      </div>
    </div>
  );
}
