import { useEffect, useMemo, useRef } from 'react';

/**
 * 设计器 ↔ 渲染器预览协议。
 *
 * 画布用 iframe 承载真实 Renderer，样式天然隔离，且预览的就是线上那份代码——
 * 这是「所见即所得」的实现基础，而不是设计器另写一套预览组件。
 */
export const PREVIEW_MESSAGE = {
  /** R → D：渲染器就绪，可以下发数据 */
  READY: 'RENDERER_READY',
  /** D → R：下发最新 DSL（编辑防抖后热更新） */
  DSL: 'CRAFT_JSON_PREVIEW',
  /** D → R：下发活动 meta / mock 环境 */
  META: 'RENDERER_META_INIT',
  /** R → D：预览态点选节点，反向联动画布选中 */
  SELECT: 'NODE_SELECTED',
} as const;

export interface PreviewEnvelope {
  type: string;
  payload?: unknown;
  seq?: number;
}

export interface PreviewChannel {
  isPreview: boolean;
  notifySelect: (nodeId: string) => void;
}

export function usePreviewChannel(onDsl: (dsl: unknown) => void): PreviewChannel {
  const isPreview = useMemo(() => {
    if (typeof window === 'undefined') return false;
    const flagged = new URLSearchParams(window.location.search).get('preview') === '1';
    return flagged && window.parent !== window;
  }, []);

  const onDslRef = useRef(onDsl);
  onDslRef.current = onDsl;
  const lastSeq = useRef(-1);

  useEffect(() => {
    if (!isPreview) return;

    const handle = (event: MessageEvent<PreviewEnvelope>) => {
      // 只接受父窗口消息；iframe 里任何第三方脚本都不该能驱动画布
      if (event.source !== window.parent) return;
      const data = event.data;
      if (!data || typeof data.type !== 'string') return;

      if (data.type === PREVIEW_MESSAGE.DSL) {
        // 编辑高频触发，乱序到达的旧消息要丢弃，否则画布会闪回旧状态
        if (typeof data.seq === 'number') {
          if (data.seq <= lastSeq.current) return;
          lastSeq.current = data.seq;
        }
        onDslRef.current(data.payload);
      }
    };

    window.addEventListener('message', handle);
    window.parent.postMessage({ type: PREVIEW_MESSAGE.READY }, '*');

    return () => window.removeEventListener('message', handle);
  }, [isPreview]);

  const notifySelect = useMemo(
    () => (nodeId: string) => {
      if (!isPreview) return;
      window.parent.postMessage({ type: PREVIEW_MESSAGE.SELECT, payload: { nodeId } }, '*');
    },
    [isPreview],
  );

  return { isPreview, notifySelect };
}
