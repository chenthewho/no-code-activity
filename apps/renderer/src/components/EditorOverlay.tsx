import { useCallback, useEffect, useState } from 'react';
import { PREVIEW_MESSAGE } from '../bootstrap/preview-channel';
import { useRuntime } from '../runtime/RuntimeProvider';
import { computeDropTarget, findElement, nodeAtPoint, type DropTarget } from '../runtime/hit-test';

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** 位置判等，用来避免「新对象 → setState → 重渲染」的自我循环 */
function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

/**
 * 编辑态交互层：点选、悬停描边、拖拽落点提示。
 *
 * 描边画在 iframe 内部而不是父窗口，省掉一整套坐标换算，
 * 页面滚动时也天然跟随。父窗口只负责发坐标、收落点。
 */
export function EditorOverlay() {
  const { dsl, editing } = useRuntime();
  const [selected, setSelected] = useState<Box | null>(null);
  const [hovered, setHovered] = useState<Box | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const boxOf = (nodeId: string): Box | null => {
    const el = findElement(nodeId);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
  };

  const post = useCallback((type: string, payload?: unknown) => {
    window.parent.postMessage({ type, payload }, '*');
  }, []);

  // 点选：冒泡阶段拿最内层命中节点，通知设计器
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

  // 接收设计器下发的选中态与拖拽探针
  useEffect(() => {
    if (!editing) return;

    const onMessage = (event: MessageEvent<{ type?: string; payload?: Record<string, number | string> }>) => {
      if (event.source !== window.parent) return;
      const { type, payload } = event.data ?? {};

      if (type === PREVIEW_MESSAGE.EDITOR_SELECT) {
        const nodeId = payload?.nodeId as string | undefined;
        setSelectedId(nodeId ?? null);
        return;
      }

      if (type === PREVIEW_MESSAGE.DROP_PROBE) {
        const x = Number(payload?.x ?? 0);
        const y = Number(payload?.y ?? 0);
        const target = computeDropTarget(x, y, dsl.craftJson);
        setDrop(target);
        post(PREVIEW_MESSAGE.DROP_TARGET, { parentId: target.parentId, index: target.index });
        return;
      }

      if (type === PREVIEW_MESSAGE.DROP_END) {
        setDrop(null);
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
    if (!editing) return;
    const next = selectedId ? boxOf(selectedId) : null;
    setSelected((prev) => (sameBox(prev, next) ? prev : next));
  }, [editing, selectedId, dsl]);

  if (!editing) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 9999 }}>
      {hovered && !drop && <Outline box={hovered} color="rgba(22,119,255,.4)" />}
      {selected && !drop && <Outline box={selected} color="#1677ff" width={2} />}
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
