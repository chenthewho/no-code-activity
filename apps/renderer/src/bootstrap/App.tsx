import { useEffect, useRef, useState } from 'react';
import type { FinalDsl } from '@nca/dsl';
import { RendererSurface } from '../components/RendererSurface';
import { DslInvalidError, DslLoadError, loadDsl, parseDsl, preloadCriticalImages } from './loader';
import { usePreviewChannel } from './preview-channel';
import { API_BASE } from '../runtime/api';
import { BootSkeleton } from '../components/BootSkeleton';
import { initMonitor, reportMonitor, wasHiddenBeforeBoot, watchWhiteScreen } from '../runtime/monitor';
import { resolveHostType } from '../runtime/host/browser';

type Status = 'loading' | 'ready' | 'error';

/** 这么久还没渲染出来，就当这次访问卡住了：用户多半已经关掉页面 */
const STALL_MS = 8000;

export function App() {
  const [status, setStatus] = useState<Status>('loading');
  const [dsl, setDsl] = useState<FinalDsl | null>(null);
  const [error, setError] = useState<string>('');
  const dslMsRef = useRef<number>(0);
  const stallRef = useRef<number>();

  // 设计器预览：DSL 由父窗口通过 postMessage 下发，不走网络加载
  const preview = usePreviewChannel((next) => {
    try {
      setDsl(parseDsl(next).dsl);
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  });

  useEffect(() => {
    if (preview.isPreview) return;

    const controller = new AbortController();
    const params = new URLSearchParams(window.location.search);
    const activityId = params.get('id') ?? window.location.pathname.split('/act/')[1];
    const dslUrl = params.get('dsl');
    initMonitor({ activityId: activityId || undefined, host: resolveHostType() });

    if (!activityId && !dslUrl) {
      setError('缺少活动 id：请以 /act/:id 或 ?id=xxx 访问');
      setStatus('error');
      reportMonitor('load_error', { message: '缺少活动 id' });
      return;
    }

    const stall = window.setTimeout(() => {
      reportMonitor('stall', { message: `${STALL_MS / 1000} 秒内未完成渲染` });
    }, STALL_MS);
    stallRef.current = stall;

    void (async () => {
      try {
        const url = dslUrl ?? `${API_BASE}/runtime/activities/${activityId}/dsl`;
        const result = await loadDsl(url, controller.signal);
        dslMsRef.current = Math.round(performance.now());
        result.warnings.forEach((w) => console.warn(`[nca] ${w}`));
        await preloadCriticalImages(result.dsl);
        setDsl(result.dsl);
        setStatus('ready');
      } catch (err) {
        if (controller.signal.aborted) return;
        window.clearTimeout(stall);
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStatus('error');
        if (err instanceof DslInvalidError) {
          reportMonitor('dsl_invalid', { message });
        } else {
          reportMonitor('load_error', {
            message,
            detail: err instanceof DslLoadError && err.status ? { status: err.status } : undefined,
          });
        }
      }
    })();

    return () => {
      controller.abort();
      window.clearTimeout(stall);
    };
  }, [preview.isPreview]);

  // 首屏渲染完成：等浏览器真正画出来（rAF 之后）再记耗时，然后安排一次白屏检测
  useEffect(() => {
    if (status !== 'ready' || preview.isPreview) return;
    window.clearTimeout(stallRef.current);
    const frame = requestAnimationFrame(() => {
      const hidden = wasHiddenBeforeBoot();
      reportMonitor('boot', {
        // 后台打开的页面耗时没有意义，只记这次访问、不记耗时
        ...(hidden ? {} : { durationMs: Math.round(performance.now()) }),
        detail: { dslMs: dslMsRef.current, ...(hidden ? { hidden: true } : {}) },
      });
      if (!hidden) watchWhiteScreen();
    });
    return () => cancelAnimationFrame(frame);
  }, [status, preview.isPreview]);

  if (status === 'loading') {
    return <BootSkeleton />;
  }
  if (status === 'error' || !dsl) {
    return (
      <div className="nca-boot nca-boot--error">
        <p>活动页加载失败</p>
        <pre>{error}</pre>
      </div>
    );
  }

  return (
    <RendererSurface
      dsl={dsl}
      editing={preview.isPreview}
      editingModalId={preview.editingModalId}
    />
  );
}
