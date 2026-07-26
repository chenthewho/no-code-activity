import { useEffect } from 'react';
import type { FinalDsl } from '@nca/dsl';
import { RuntimeProvider, useRuntime } from '../runtime/RuntimeProvider';
import { CanvasRenderer } from './CanvasRenderer';
import { ToastLayer } from './ToastLayer';
import { EditorOverlay } from './EditorOverlay';

export interface RendererSurfaceProps {
  dsl: FinalDsl;
  editing?: boolean;
}

/** 活动页外壳：页面适配 + 画布 + 全局浮层 */
export function RendererSurface({ dsl, editing = false }: RendererSurfaceProps) {
  return (
    <RuntimeProvider dsl={dsl} editing={editing}>
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
   * 移动端适配。根字号恒定为「100 × 视口宽 / 设计稿宽」，配合物料输出的 rem
   * （1rem = 100 设计像素），一份 750 的稿子就能在任意机型上等比还原。
   * fixed 模式设成 100px，等价于 1rem = 1 设计像素，即不缩放。
   */
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      if (page.adaptMode === 'fixed') {
        root.style.fontSize = '100px';
        return;
      }
      // 上限两倍稿宽，避免在 PC 上被拉伸到失真
      const width = Math.min(window.innerWidth, page.designWidth * 2);
      root.style.fontSize = `${(width / page.designWidth) * 100}px`;
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
      } as React.CSSProperties}
    >
      <CanvasRenderer />
      <ToastLayer />
      <EditorOverlay />
    </div>
  );
}
