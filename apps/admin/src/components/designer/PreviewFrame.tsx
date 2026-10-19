import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { Spin } from 'antd';
import type { FinalDsl } from '@nca/dsl';

export const RENDERER_ORIGIN = import.meta.env.VITE_RENDERER_ORIGIN ?? 'http://localhost:5180';

export const PREVIEW_MESSAGE = {
  READY: 'RENDERER_READY',
  DSL: 'CRAFT_JSON_PREVIEW',
  SELECT: 'NODE_SELECTED',
  EDITOR_SELECT: 'EDITOR_SELECT',
  DROP_PROBE: 'EDITOR_DROP_PROBE',
  DROP_END: 'EDITOR_DROP_END',
  DROP_TARGET: 'EDITOR_DROP_TARGET',
  REMOVE: 'EDITOR_REMOVE_NODE',
  CAPTURE_START: 'EDITOR_CAPTURE_START',
  POINTER: 'EDITOR_POINTER',
  CAPTURE_END: 'EDITOR_CAPTURE_END',
  UPDATE_PROPS: 'EDITOR_UPDATE_PROPS',
  MEASURE_FREE: 'EDITOR_MEASURE_FREE',
  EDIT_MODAL: 'EDITOR_EDIT_MODAL',
  DRAG_NODE: 'EDITOR_DRAG_NODE',
  DRAG_NODE_END: 'EDITOR_DRAG_NODE_END',
  SHORTCUT: 'EDITOR_SHORTCUT',
} as const;

export interface PreviewFrameHandle {
  post: (type: string, payload?: unknown) => void;
  getRect: () => DOMRect | undefined;
}

interface Props {
  dsl: FinalDsl;
  width: number;
  height: number;
  /** 关掉指针事件：拖拽经过时要让父窗口收到 mousemove */
  interactive?: boolean;
  /** 以哪个宿主的身份预览：影响 {{ host }} 分支、横屏布局与宿主专属组件的显隐 */
  host?: string;
  onMessage?: (type: string, payload: Record<string, unknown> | undefined) => void;
}

/**
 * 承载真实 Renderer 的 iframe。
 *
 * 设计器画布与模板预览都用它——两者的差别只是「要不要交互」，
 * 各写一套 iframe 承载逻辑迟早会出现「预览正常、画布异常」的分叉。
 */
export const PreviewFrame = forwardRef<PreviewFrameHandle, Props>(function PreviewFrame(
  { dsl, width, height, interactive = true, host, onMessage },
  ref,
) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const seqRef = useRef(0);

  const post = useCallback((type: string, payload?: unknown) => {
    iframeRef.current?.contentWindow?.postMessage({ type, payload }, RENDERER_ORIGIN);
  }, []);

  useImperativeHandle(ref, () => ({
    post,
    getRect: () => iframeRef.current?.getBoundingClientRect(),
  }));

  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const handle = (event: MessageEvent<{ type?: string; payload?: Record<string, unknown> }>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const { type, payload } = event.data ?? {};
      if (!type) return;
      if (type === PREVIEW_MESSAGE.READY) setReady(true);
      onMessageRef.current?.(type, payload);
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, []);

  // DSL 变更下发。带自增 seq，渲染器据此丢弃乱序到达的旧消息
  useEffect(() => {
    if (!ready) return;
    seqRef.current += 1;
    iframeRef.current?.contentWindow?.postMessage(
      { type: PREVIEW_MESSAGE.DSL, payload: dsl, seq: seqRef.current },
      RENDERER_ORIGIN,
    );
  }, [dsl, ready]);

  return (
    <div
      style={{
        position: 'relative',
        width,
        minHeight: height,
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
        src={`${RENDERER_ORIGIN}/?preview=1${host ? `&host=${encodeURIComponent(host)}` : ''}`}
        style={{
          display: 'block',
          width: '100%',
          height,
          border: 'none',
          pointerEvents: interactive ? 'auto' : 'none',
        }}
      />
    </div>
  );
});
