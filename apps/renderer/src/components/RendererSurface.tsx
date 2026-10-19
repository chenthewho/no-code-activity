import { useEffect, useState } from 'react';
import type { FinalDsl } from '@nca/dsl';
import { RuntimeProvider, useRuntime } from '../runtime/RuntimeProvider';
import { CanvasRenderer } from './CanvasRenderer';
import { ToastLayer } from './ToastLayer';
import { EditorOverlay } from './EditorOverlay';
import { computeViewport } from '../runtime/viewport';

export interface RendererSurfaceProps {
  dsl: FinalDsl;
  editing?: boolean;
  /** 编辑态下由设计器指定要展开的弹窗 */
  editingModalId?: string | null;
}

/** 活动页外壳：页面适配 + 画布 + 全局浮层 */
export function RendererSurface({
  dsl,
  editing = false,
  editingModalId = null,
}: RendererSurfaceProps) {
  return (
    <RuntimeProvider dsl={dsl} editing={editing} editingModalId={editingModalId}>
      <PageFrame />
    </RuntimeProvider>
  );
}

function PageFrame() {
  const { dsl } = useRuntime();
  const { page, title, theme } = dsl.meta;

  useEffect(() => {
    const pageTitle = page.title ?? title;
    if (pageTitle) document.title = pageTitle;
  }, [page.title, title]);

  /**
   * 页面适配。根字号配合物料输出的 rem（1rem = 100 设计像素），一份 750 的稿子
   * 就能在任意机型上等比还原；横屏里放竖版稿时收成居中的一列，规则见 computeViewport。
   */
  const [frameWidth, setFrameWidth] = useState<number | null>(null);
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const result = computeViewport({
        width: window.innerWidth,
        height: window.innerHeight,
        designWidth: page.designWidth,
        adaptMode: page.adaptMode,
      });
      root.style.fontSize = `${result.rootFontSize}px`;
      setFrameWidth(result.frameWidth);
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      root.style.fontSize = '';
    };
  }, [page.adaptMode, page.designWidth]);

  return (
    <div
      className="nca-surface"
      style={{
        '--nca-primary': theme.primaryColor,
        backgroundColor: theme.backgroundColor,
        minHeight: '100vh',
        // 收成一列时居中，两侧留出视口底色；列内的绝对定位与弹窗都相对这一列
        ...(frameWidth ? { width: frameWidth, margin: '0 auto', position: 'relative' } : {}),
      } as React.CSSProperties}
    >
      <CanvasRenderer />
      <ToastLayer />
      <EditorOverlay />
    </div>
  );
}
