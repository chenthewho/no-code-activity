import { useCallback, useEffect, useRef, useState } from 'react';
import { PREVIEW_MESSAGE } from '../bootstrap/preview-channel';
import { useRuntime } from '../runtime/RuntimeProvider';
import { computeDropTarget, findElement, nodeAtPoint, type DropTarget } from '../runtime/hit-test';
import {
  applyMove,
  applyResize,
  buildPatch,
  canvasScale,
  HANDLES,
  isAbsolute,
  toDesignPx,
  type Box,
  type TransformSession,
} from '../runtime/transform';

/** 位置判等，用来避免「新对象 → setState → 重渲染」的自我循环 */
function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

/**
 * 编辑态交互层：点选、悬停描边、拖拽落点、缩放与移动。
 *
 * 描边与手柄画在 iframe 内部而不是父窗口，省掉一整套坐标换算，
 * 页面滚动时也天然跟随。父窗口只负责发坐标、收结果。
 */
export function EditorOverlay() {
  const { dsl, editing } = useRuntime();
  const [selected, setSelected] = useState<Box | null>(null);
  const [hovered, setHovered] = useState<Box | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [session, setSession] = useState<TransformSession | null>(null);

  // 拖拽过程中每帧都要读，用 ref 免得进 effect 依赖
  const sessionRef = useRef<TransformSession | null>(null);
  sessionRef.current = session;

  /** 画布内发起的重排：被拖节点 id。与 session 互斥 */
  const [reorderId, setReorderId] = useState<string | null>(null);
  const reorderRef = useRef<string | null>(null);
  reorderRef.current = reorderId;

  const boxOf = (nodeId: string): Box | null => {
    const el = findElement(nodeId);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  };

  const post = useCallback((type: string, payload?: unknown) => {
    window.parent.postMessage({ type, payload }, '*');
  }, []);

  const selectedNode = selectedId ? dsl.craftJson[selectedId] : undefined;

  /** 起手：告诉父窗口接管指针，之后坐标由它转发进来 */
  const beginTransform = useCallback(
    (nodeId: string, mode: TransformSession['mode'], e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const box = boxOf(nodeId);
      if (!box) return;
      const node = dsl.craftJson[nodeId];

      setSession({
        nodeId,
        mode,
        startX: e.clientX,
        startY: e.clientY,
        startBox: box,
        startTop: Number(node?.props?.top ?? 0),
        startLeft: Number(node?.props?.left ?? 0),
        box,
      });
      post(PREVIEW_MESSAGE.CAPTURE_START, { nodeId });
    },
    [dsl.craftJson, post],
  );

  // 点选与悬停
  useEffect(() => {
    if (!editing) return;

    const onClick = (e: MouseEvent) => {
      const hit = nodeAtPoint(e.clientX, e.clientY);
      if (!hit) return;
      // 编辑态下点击不该触发按钮跳转等真实行为
      e.preventDefault();
      e.stopPropagation();
      setSelectedId(hit.nodeId);
      post(PREVIEW_MESSAGE.SELECT, { nodeId: hit.nodeId });
    };

    const onMove = (e: MouseEvent) => {
      if (sessionRef.current) return;
      const hit = nodeAtPoint(e.clientX, e.clientY);
      const next = hit ? boxOf(hit.nodeId) : null;
      // 同样要判等：鼠标每动一像素都换新对象的话，会白白触发一轮重渲染
      setHovered((prev) => (sameBox(prev, next) ? prev : next));
    };

    const onLeave = () => setHovered(null);

    document.addEventListener('click', onClick, true);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);
    return () => {
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, [editing, post]);

  /** 把一次拖拽的结果提交给设计器。重复调用是安全的——session 已清空就直接返回 */
  const finishTransform = useCallback(() => {
    const current = sessionRef.current;
    if (!current) return;
    sessionRef.current = null;
    setSession(null);
    // 整场拖拽只提交一次，对应一步撤销；过程中的视觉反馈是本地画的
    const patch = buildPatch(current, current.box, dsl.craftJson[current.nodeId]);
    if (Object.keys(patch).length > 0) {
      post(PREVIEW_MESSAGE.UPDATE_PROPS, { nodeId: current.nodeId, patch });
    }
  }, [dsl.craftJson, post]);

  const trackPointer = useCallback((x: number, y: number) => {
    const current = sessionRef.current;
    if (!current) return;
    const next = current.mode.kind === 'resize' ? applyResize(current, x, y) : applyMove(current, x, y);
    setSession({ ...current, box: next });
  }, []);

  /**
   * 画布内发起的重排，落点也由画布自己算。
   *
   * 同样是隐式捕获的问题：鼠标在 iframe 内按下，父窗口收不到后续移动，
   * 指望它发探针过来是收不到的。
   */
  useEffect(() => {
    if (!editing || !reorderId) return;

    const onMove = (e: MouseEvent) => {
      const target = computeDropTarget(e.clientX, e.clientY, dsl.craftJson, reorderId);
      setDrop(target);
      post(PREVIEW_MESSAGE.DROP_TARGET, { parentId: target.parentId, index: target.index });
    };
    const onUp = () => {
      setDrop(null);
      setReorderId(null);
      reorderRef.current = null;
      post(PREVIEW_MESSAGE.DRAG_NODE_END);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [editing, reorderId, dsl.craftJson, post]);

  /**
   * 拖拽中的指针由 iframe 自己跟。
   *
   * 不能指望父窗口接管：鼠标在 iframe 内按下后，后续事件被它隐式捕获，
   * 此时再把 pointer-events 关掉也抢不回这一次拖拽。
   * 父窗口的转发只在指针移出画布时补位，两边算的都是相对起手点的绝对增量，
   * 因此重复收到同一位置也不会叠加出错。
   */
  useEffect(() => {
    if (!editing || !session) return;

    const onMove = (e: MouseEvent) => trackPointer(e.clientX, e.clientY);
    const onUp = () => finishTransform();

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [editing, session, trackPointer, finishTransform]);

  /**
   * 画布内的快捷键转交给设计器。
   * 点过画布后焦点落在 iframe 里，父窗口再也收不到 keydown，
   * 「点组件 → ⌘Z 撤销」这条最常用的路径会直接失效。
   */
  useEffect(() => {
    if (!editing) return;

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        post(PREVIEW_MESSAGE.SHORTCUT, { action: e.shiftKey ? 'redo' : 'undo' });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        post(PREVIEW_MESSAGE.SHORTCUT, { action: 'delete' });
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [editing, post]);

  // 父窗口下发的消息：选中同步、拖拽探针、指针转发
  useEffect(() => {
    if (!editing) return;

    const onMessage = (
      event: MessageEvent<{ type?: string; payload?: Record<string, number | string> }>,
    ) => {
      if (event.source !== window.parent) return;
      const { type, payload } = event.data ?? {};

      if (type === PREVIEW_MESSAGE.EDITOR_SELECT) {
        setSelectedId((payload?.nodeId as string | undefined) ?? null);
        return;
      }

      if (type === PREVIEW_MESSAGE.DROP_PROBE) {
        const x = Number(payload?.x ?? 0);
        const y = Number(payload?.y ?? 0);
        const target = computeDropTarget(x, y, dsl.craftJson, payload?.excludeId as string | undefined);
        setDrop(target);
        post(PREVIEW_MESSAGE.DROP_TARGET, { parentId: target.parentId, index: target.index });
        return;
      }

      if (type === PREVIEW_MESSAGE.DROP_END) {
        setDrop(null);
        return;
      }

      // 指针移出画布时由父窗口补位转发
      if (type === PREVIEW_MESSAGE.POINTER) {
        trackPointer(Number(payload?.x ?? 0), Number(payload?.y ?? 0));
        return;
      }

      if (type === PREVIEW_MESSAGE.CAPTURE_END) {
        finishTransform();
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [editing, dsl.craftJson, post]);

  /**
   * 选中框要跟着内容变化重算：改属性可能让元素尺寸变了。
   *
   * 必须带相等判断——boxOf 每次都返回新对象，直接 setState 会让
   * 「渲染 → setState → 渲染」自我循环，页面直接卡死。
   */
  useEffect(() => {
    if (!editing || session) return;
    const next = selectedId ? boxOf(selectedId) : null;
    setSelected((prev) => (sameBox(prev, next) ? prev : next));
  }, [editing, selectedId, dsl, session]);

  if (!editing) return null;

  // 拖拽中优先显示实时预览框
  const activeBox = session ? session.box : selected;
  const scale = canvasScale();
  const isRoot = selectedId === 'ROOT';

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}>
      {hovered && !drop && !session && <Outline box={hovered} color="rgba(22,119,255,.4)" />}

      {activeBox && !drop && (
        <>
          <Outline box={activeBox} color="#1677ff" width={2} />
          {selectedNode && (
            <SelectionToolbar
              box={activeBox}
              name={selectedNode.displayName ?? selectedNode.type.resolvedName}
              width={toDesignPx(activeBox.width, scale)}
              height={toDesignPx(activeBox.height, scale)}
              hasParent={Boolean(selectedNode.parent)}
              movable={!isRoot}
              absolute={isAbsolute(selectedNode)}
              onSelectParent={() => post(PREVIEW_MESSAGE.SELECT, { nodeId: selectedNode.parent })}
              onRemove={() => post(PREVIEW_MESSAGE.REMOVE, { nodeId: selectedId })}
              onMoveStart={(e) => {
                if (!selectedId) return;
                // 绝对定位才能拖到任意位置；流式节点交给父窗口走重排流程
                if (isAbsolute(selectedNode)) {
                  beginTransform(selectedId, { kind: 'move' }, e);
                } else {
                  e.preventDefault();
                  e.stopPropagation();
                  setReorderId(selectedId);
                  post(PREVIEW_MESSAGE.DRAG_NODE, { nodeId: selectedId });
                }
              }}
            />
          )}
          {!isRoot &&
            selectedId &&
            HANDLES.map((handle) => (
              <ResizeHandleDot
                key={handle.key}
                box={activeBox}
                handle={handle}
                onMouseDown={(e) =>
                  beginTransform(selectedId, { kind: 'resize', handle: handle.key }, e)
                }
              />
            ))}
        </>
      )}

      {drop?.hint.mode === 'box' && (
        <div
          style={{
            position: 'fixed',
            top: drop.hint.top,
            left: drop.hint.left,
            width: drop.hint.width,
            height: drop.hint.height,
            border: '2px dashed #52c41a',
            background: 'rgba(82,196,26,.08)',
            boxSizing: 'border-box',
          }}
        />
      )}
      {drop?.hint.mode === 'line' && (
        <div
          style={{
            position: 'fixed',
            top: drop.hint.top - 1,
            left: drop.hint.left,
            width: drop.hint.width,
            height: 3,
            background: '#52c41a',
            borderRadius: 2,
          }}
        />
      )}
    </div>
  );
}

function ResizeHandleDot({
  box,
  handle,
  onMouseDown,
}: {
  box: Box;
  handle: (typeof HANDLES)[number];
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const SIZE = 10;
  /**
   * 夹到画布可视区内。
   * 满宽组件的东侧手柄本该骑在边界上，一半会落到 iframe 之外，
   * 鼠标按下会被父窗口接走，运营根本抓不住它。
   */
  const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max - SIZE));

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: 'fixed',
        top: clamp(box.top + box.height * handle.y - SIZE / 2, window.innerHeight),
        left: clamp(box.left + box.width * handle.x - SIZE / 2, window.innerWidth),
        width: SIZE,
        height: SIZE,
        background: '#fff',
        border: '1.5px solid #1677ff',
        borderRadius: 2,
        cursor: handle.cursor,
        pointerEvents: 'auto',
      }}
    />
  );
}

/**
 * 选中节点的悬浮工具条。
 *
 * 贴在选区上沿，显示组件名与实际渲染尺寸——尺寸是运营调布局时最想知道的信息，
 * 而右侧面板里的宽高常常是 auto，看不出真实占位。
 * 空间不够时自动翻到选区下方，避免顶到画布外看不见。
 */
function SelectionToolbar({
  box,
  name,
  width,
  height,
  hasParent,
  movable,
  absolute,
  onSelectParent,
  onRemove,
  onMoveStart,
}: {
  box: Box;
  name: string;
  width: number;
  height: number;
  hasParent: boolean;
  movable: boolean;
  absolute: boolean;
  onSelectParent: () => void;
  onRemove: () => void;
  onMoveStart: (e: React.MouseEvent) => void;
}) {
  const BAR_HEIGHT = 22;
  const above = box.top > BAR_HEIGHT + 4;

  return (
    <div
      style={{
        position: 'fixed',
        top: above ? box.top - BAR_HEIGHT - 2 : box.top + box.height + 2,
        left: Math.max(2, box.left),
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        height: BAR_HEIGHT,
        padding: '0 6px',
        color: '#fff',
        fontSize: 11,
        lineHeight: `${BAR_HEIGHT}px`,
        whiteSpace: 'nowrap',
        background: '#1677ff',
        borderRadius: 3,
        pointerEvents: 'auto',
      }}
    >
      <span style={{ fontWeight: 600 }}>{name}</span>
      <span style={{ opacity: 0.75 }}>
        {width} × {height}
      </span>
      {movable && (
        <span
          title={absolute ? '拖动调整位置' : '拖动调整排列顺序'}
          style={{ cursor: 'move', opacity: 0.9 }}
          onMouseDown={onMoveStart}
        >
          ✥
        </span>
      )}
      {hasParent && (
        <span title="选中父容器" style={{ cursor: 'pointer', opacity: 0.9 }} onClick={onSelectParent}>
          ↑
        </span>
      )}
      <span title="删除该组件" style={{ cursor: 'pointer', opacity: 0.9 }} onClick={onRemove}>
        ✕
      </span>
    </div>
  );
}

function Outline({ box, color, width = 1 }: { box: Box; color: string; width?: number }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
        outline: `${width}px solid ${color}`,
        outlineOffset: -width,
        boxSizing: 'border-box',
      }}
    />
  );
}
