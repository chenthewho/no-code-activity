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

  /** D → R：把设计器侧的选中态同步到画布，画布据此描边 */
  EDITOR_SELECT: 'EDITOR_SELECT',
  /** D → R：拖拽经过画布，带 iframe 内坐标，请画布算出落点 */
  DROP_PROBE: 'EDITOR_DROP_PROBE',
  /** D → R：拖拽结束/离开，清掉落点提示 */
  DROP_END: 'EDITOR_DROP_END',
  /** R → D：算出的落点（父容器 + 下标），拖拽释放时据此插入 */
  DROP_TARGET: 'EDITOR_DROP_TARGET',
  /** R → D：从画布上的悬浮工具条请求删除节点 */
  REMOVE: 'EDITOR_REMOVE_NODE',

  /**
   * 缩放 / 移动的指针捕获协议。
   *
   * 拖动很容易越出画布边界，而 iframe 只在指针位于其内部时才收得到 mousemove。
   * 所以由父窗口接管指针：捕获期间关掉 iframe 的 pointer-events，
   * 父窗口把换算后的坐标持续转发进来，松手时再回传一次最终值。
   */
  CAPTURE_START: 'EDITOR_CAPTURE_START',
  POINTER: 'EDITOR_POINTER',
  CAPTURE_END: 'EDITOR_CAPTURE_END',
  /** R → D：把缩放/移动的结果写回节点 props（一次拖拽只提交一次，对应一步撤销） */
  UPDATE_PROPS: 'EDITOR_UPDATE_PROPS',
  /**
   * D → R：请画布算出「转为自由摆放」要写的完整 props。
   * 设置器里改「定位方式」和工具条上点「自由」必须是同一件事，
   * 算完再用 UPDATE_PROPS 回传，因此仍然只产生一步撤销。
   * 而只有画布量得到元素此刻的实际位置与宽度——少了这一步，
   * 元素会当场脱离文档流并收缩到内容宽，看起来就是「一选绝对定位页面就乱了」。
   */
  MEASURE_FREE: 'EDITOR_MEASURE_FREE',
  /** R → D：请求以流式重排的方式拖动已有节点 */
  DRAG_NODE: 'EDITOR_DRAG_NODE',
  /** R → D：画布内发起的重排已松手，请设计器落库 */
  DRAG_NODE_END: 'EDITOR_DRAG_NODE_END',
  /**
   * R → D：把画布内按下的快捷键转交给设计器。
   * 点过画布后焦点就在 iframe 里，父窗口的 keydown 再也收不到，
   * 不转发的话「点组件 → ⌘Z」这条最常用的路径直接失效。
   */
  SHORTCUT: 'EDITOR_SHORTCUT',
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
