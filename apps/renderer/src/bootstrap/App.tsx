import { useEffect, useState } from 'react';
import type { FinalDsl } from '@nca/dsl';
import { RendererSurface } from '../components/RendererSurface';
import { loadDsl, parseDsl, preloadCriticalImages } from './loader';
import { usePreviewChannel } from './preview-channel';
import { API_BASE } from '../runtime/api';

type Status = 'loading' | 'ready' | 'error';

export function App() {
  const [status, setStatus] = useState<Status>('loading');
  const [dsl, setDsl] = useState<FinalDsl | null>(null);
  const [error, setError] = useState<string>('');

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

    if (!activityId && !dslUrl) {
      setError('缺少活动 id：请以 /act/:id 或 ?id=xxx 访问');
      setStatus('error');
      return;
    }

    void (async () => {
      try {
        const url = dslUrl ?? `${API_BASE}/runtime/activities/${activityId}/dsl`;
        const result = await loadDsl(url, controller.signal);
        result.warnings.forEach((w) => console.warn(`[nca] ${w}`));
        await preloadCriticalImages(result.dsl);
        setDsl(result.dsl);
        setStatus('ready');
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus('error');
      }
    })();

    return () => controller.abort();
  }, [preview.isPreview]);

  if (status === 'loading') {
    return <div className="nca-boot">加载中…</div>;
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
