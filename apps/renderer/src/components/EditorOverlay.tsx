import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ROOT_NODE_ID } from '@nca/shared';
import { PREVIEW_MESSAGE } from '../bootstrap/preview-channel';
import { useRuntime } from '../runtime/RuntimeProvider';
import { computeDropTarget, findElement, nodeAtPoint, type DropTarget } from '../runtime/hit-test';
import {
  applyMove,
  applyResize,
  buildPatch,
  canvasScale,
  freeLayoutPatch,
  HANDLES,
  isAbsolute,
  offsetInContainingBlock,
  toDesignPx,
  type Box,
  type TransformSession,
} from '../runtime/transform';

/**
 * 越过这个距离才算拖拽，否则算点选。
 * 没有阈值的话，选中组件时手抖几像素就会把它拖离原位或改掉排序。
 */
const DRAG_THRESHOLD = 4;

/** 位置判等，用来避免「新对象 → setState → 重渲染」的自我循环 */
function sameBox(a: Box | null, b: Box | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

/** 视口坐标 → 文档坐标。命中测试只认视口坐标，覆盖层只认文档坐标 */
function toDocX(clientX: number): number {
  return clientX + window.scrollX;
}
function toDocY(clientY: number): number {
  return clientY + window.scrollY;
}

/** 元素在文档坐标系里的盒子 */
function docBox(el: HTMLElement): Box {
  const rect = el.getBoundingClientRect();
  return {
    top: toDocY(rect.top),
    left: toDocX(rect.left),
    width: rect.width,
    height: rect.height,
  };
}

/**
 * 编辑态交互层：点选、悬停描边、拖拽落点、缩放与移动。
 *
 * 描边与手柄画在 iframe 内部而不是父窗口，省掉一整套坐标换算。
 * 父窗口只负责发坐标、收结果。
 *
 * 一切都按「文档坐标」记录并以 absolute 定位，画布滚动时描边和手柄
 * 由浏览器带着一起走。用 fixed + 视口坐标的话，框会钉死在屏幕上，
 * 页面一滚就和组件脱开；改成滚动时重新测量又必然慢半帧、跟手时会抖。
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

  /** 已按下但还没越过阈值的组件本体，越过后才升级成真正的拖拽 */
  const pendingRef = useRef<{ nodeId: string; x: number; y: number } | null>(null);

  const boxOf = (nodeId: string): Box | null => {
    const el = findElement(nodeId);
    if (!el) return null;
    return docBox(el);
  };

  /** 落点提示来自命中测试，那边给的是视口坐标，画之前换算到文档坐标 */
  const setDocDrop = (target: DropTarget | null) => {
    setDrop(
      target && {
        ...target,
        hint: {
          ...target.hint,
          top: toDocY(target.hint.top),
          left: toDocX(target.hint.left),
        },
      },
    );
  };

  const post = useCallback((type: string, payload?: unknown) => {
    window.parent.postMessage({ type, payload }, '*');
  }, []);

  const selectedNode = selectedId ? dsl.craftJson[selectedId] : undefined;

  /** 起手：告诉父窗口接管指针，之后坐标由它转发进来 */
  const beginTransform = useCallback(
    (nodeId: string, mode: TransformSession['mode'], x: number, y: number) => {
      const el = findElement(nodeId);
      if (!el) return;
      const box = docBox(el);
      const offset = offsetInContainingBlock(el);

      // 起手点与盒子都用文档坐标：拖到一半滚动页面时，两边一起走，位移才不会错
      setSession({
        nodeId,
        mode,
        startX: x,
        startY: y,
        startBox: box,
        startTop: offset.top,
        startLeft: offset.left,
        box,
      });
      post(PREVIEW_MESSAGE.CAPTURE_START, { nodeId });
    },
    [post],
  );

  /**
   * 拖组件本体的语义按定位方式分流：
   * 自由摆放的节点改坐标，流式节点走重排——页面是流式布局，
   * 把两者混成一件事只会让「我明明拖到那儿了它却弹回来」。
   */
  const startNodeDrag = useCallback(
    (nodeId: string, x: number, y: number) => {
      if (nodeId === ROOT_NODE_ID) return;
      if (isAbsolute(dsl.craftJson[nodeId])) {
        beginTransform(nodeId, { kind: 'move' }, x, y);
      } else {
        setReorderId(nodeId);
        post(PREVIEW_MESSAGE.DRAG_NODE, { nodeId });
      }
    },
    [dsl.craftJson, beginTransform, post],
  );

  /** 在流式与自由摆放之间切换。转过去时补齐坐标和宽度，保证视觉上原地不动 */
  const toggleFreeLayout = useCallback(
    (nodeId: string) => {
      const node = dsl.craftJson[nodeId];
      if (isAbsolute(node)) {
        post(PREVIEW_MESSAGE.UPDATE_PROPS, { nodeId, patch: { position: 'static' } });
        return;
      }
      const el = findElement(nodeId);
      if (!el) return;
      post(PREVIEW_MESSAGE.UPDATE_PROPS, { nodeId, patch: freeLayoutPatch(el, node) });
    },
    [dsl.craftJson, post],
  );

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

  // 点选、悬停，以及「按下组件本体」的拖拽起手
  useEffect(() => {
    if (!editing) return;

    /**
     * 选中放在 mousedown 而不是 click：拖拽从按下那一刻就开始，
     * 等到 click 再选的话，整段拖拽过程里选中框还停在上一个组件上。
     */
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const hit = nodeAtPoint(e.clientX, e.clientY);
      if (!hit) return;
      setSelectedId(hit.nodeId);
      post(PREVIEW_MESSAGE.SELECT, { nodeId: hit.nodeId });
      pendingRef.current = { nodeId: hit.nodeId, x: toDocX(e.clientX), y: toDocY(e.clientY) };
    };

    const onClick = (e: MouseEvent) => {
      const hit = nodeAtPoint(e.clientX, e.clientY);
      if (!hit) return;
      // 编辑态下点击不该触发按钮跳转等真实行为
      e.preventDefault();
      e.stopPropagation();
    };

    const onMove = (e: MouseEvent) => {
      const pending = pendingRef.current;
      if (pending) {
        const x = toDocX(e.clientX);
        const y = toDocY(e.clientY);
        if (Math.hypot(x - pending.x, y - pending.y) < DRAG_THRESHOLD) return;
        pendingRef.current = null;
        // 以按下点为起手基准，这样越过阈值时元素不会突然跳 4 像素
        startNodeDrag(pending.nodeId, pending.x, pending.y);
        return;
      }
      if (sessionRef.current || reorderRef.current) return;
      const hit = nodeAtPoint(e.clientX, e.clientY);
      const next = hit ? boxOf(hit.nodeId) : null;
      // 同样要判等：鼠标每动一像素都换新对象的话，会白白触发一轮重渲染
      setHovered((prev) => (sameBox(prev, next) ? prev : next));
    };

    /**
     * 这个 mouseup 全程挂着，兜住「按下即松手」的极快拖拽：
     * session 专属的监听要等一次重渲染才挂上，那之前松手就会漏掉，
     * 于是拖拽结束了却还在跟指针走。
     */
    const onUp = () => {
      pendingRef.current = null;
      finishTransform();
    };
    const onLeave = () => setHovered(null);
    // 编辑态下按住图片会触发浏览器原生拖图，把拖拽整个吞掉
    const onDragStart = (e: DragEvent) => e.preventDefault();

    document.addEventListener('mousedown', onDown);
    document.addEventListener('click', onClick, true);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('mouseleave', onLeave);
    document.addEventListener('dragstart', onDragStart);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('mouseleave', onLeave);
      document.removeEventListener('dragstart', onDragStart);
    };
  }, [editing, post, startNodeDrag, finishTransform]);

  /** 编辑态锁掉文本选中：拖组件时整页文字被刷蓝，既难看又会干扰命中判断 */
  useEffect(() => {
    if (!editing) return;
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.userSelect = previous;
    };
  }, [editing]);

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
      setDocDrop(target);
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

    const onMove = (e: MouseEvent) => trackPointer(toDocX(e.clientX), toDocY(e.clientY));
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
        setDocDrop(target);
        post(PREVIEW_MESSAGE.DROP_TARGET, { parentId: target.parentId, index: target.index });
        return;
      }

      if (type === PREVIEW_MESSAGE.DROP_END) {
        setDrop(null);
        return;
      }

      // 设置器把「改成自由摆放」派过来了：量出当前位置，连坐标一起回传
      if (type === PREVIEW_MESSAGE.MEASURE_FREE) {
        const nodeId = payload?.nodeId as string | undefined;
        if (!nodeId) return;
        const el = findElement(nodeId);
        const patch = el
          ? freeLayoutPatch(el, dsl.craftJson[nodeId])
          : // 量不到也得把定位方式落下，否则下拉框看着像没反应
            { position: 'absolute' };
        post(PREVIEW_MESSAGE.UPDATE_PROPS, { nodeId, patch });
        return;
      }

      // 指针移出画布时由父窗口补位转发。它发的是 iframe 内的视口坐标
      if (type === PREVIEW_MESSAGE.POINTER) {
        trackPointer(toDocX(Number(payload?.x ?? 0)), toDocY(Number(payload?.y ?? 0)));
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

  /**
   * 挂到 body 而不是就地渲染：.nca-surface 是 relative，就地渲染的话
   * 绝对定位会以它为参照系，页面结构一变覆盖层就整体偏移。
   * body 无定位，参照系就是文档原点，坐标含义确定。
   */
  return createPortal(
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: 0,
        height: 0,
        pointerEvents: 'none',
        zIndex: 9999,
      }}
    >
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
              onToggleFree={() => selectedId && toggleFreeLayout(selectedId)}
              onMoveStart={(e) => {
                if (!selectedId) return;
                e.preventDefault();
                e.stopPropagation();
                startNodeDrag(selectedId, toDocX(e.clientX), toDocY(e.clientY));
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
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  beginTransform(
                    selectedId,
                    { kind: 'resize', handle: handle.key },
                    toDocX(e.clientX),
                    toDocY(e.clientY),
                  );
                }}
              />
            ))}
        </>
      )}

      {drop?.hint.mode === 'box' && (
        <div
          style={{
            position: 'absolute',
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
            position: 'absolute',
            top: drop.hint.top - 1,
            left: drop.hint.left,
            width: drop.hint.width,
            height: 3,
            background: '#52c41a',
            borderRadius: 2,
          }}
        />
      )}
    </div>,
    document.body,
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
   * 只夹横向。
   * 满宽组件的东侧手柄本该骑在画布边界上，一半会落到 iframe 之外，
   * 鼠标按下会被父窗口接走，运营根本抓不住它；而画布不能横向滚动，
   * 抓不到就是真的抓不到。纵向不夹——超出屏幕的手柄滚过去就能碰到，
   * 硬夹进视口反而会把它画在一个不属于元素的位置上。
   */
  const clampX = (value: number) => Math.max(0, Math.min(value, window.innerWidth - SIZE));

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: 'absolute',
        top: box.top + box.height * handle.y - SIZE / 2,
        left: clampX(box.left + box.width * handle.x - SIZE / 2),
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
  onToggleFree,
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
  onToggleFree: () => void;
  onMoveStart: (e: React.MouseEvent) => void;
}) {
  const BAR_HEIGHT = 22;
  // 贴在页面最顶端的组件上方没有空间，翻到下沿去
  const above = box.top > BAR_HEIGHT + 4;

  return (
    <div
      style={{
        position: 'absolute',
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
          title={
            absolute
              ? '改回跟随排版，位置由上下文决定'
              : '转为自由摆放，之后可以拖到页面任意位置'
          }
          style={{
            cursor: 'pointer',
            padding: '0 4px',
            borderRadius: 2,
            // 亮起表示「此刻可以随便拖」，运营一眼能看出当前处于哪种模式
            background: absolute ? 'rgba(255,255,255,.9)' : 'rgba(255,255,255,.22)',
            color: absolute ? '#1677ff' : '#fff',
          }}
          onClick={onToggleFree}
        >
          自由
        </span>
      )}
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
        position: 'absolute',
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
