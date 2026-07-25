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

  // vw 适配：把设计稿 px 换算成视口比例，一份稿子适配所有机型宽度。
  // 用 font-size + rem 而不是 transform scale，避免缩放导致的文字模糊。
  useEffect(() => {
    if (page.adaptMode !== 'vw') return;
    const root = document.documentElement;
    const apply = () => {
      const width = Math.min(window.innerWidth, page.designWidth * 2);
      root.style.fontSize = `${(width / page.designWidth) * 100}px`;
    };
    apply();
    window.addEventListener('resize', apply);
    return () => {
      window.removeEventListener('resize', apply);
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
