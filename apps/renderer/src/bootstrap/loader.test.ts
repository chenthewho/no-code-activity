import { afterEach, describe, expect, it, vi } from 'vitest';
import { DslInvalidError, DslLoadError, loadDsl } from './loader';

const VALID = {
  schemaVersion: '1.1.0',
  meta: { activityId: 'a1', title: '预取' },
  craftJson: { ROOT: { type: { resolvedName: 'Page' }, isCanvas: true, nodes: [] } },
};

afterEach(() => {
  delete window.__NCA_DSL_PREFETCH__;
  vi.unstubAllGlobals();
});

describe('loadDsl', () => {
  it('复用 index.html 内联脚本的预取请求，同一地址加载两次也只发一次请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    window.__NCA_DSL_PREFETCH__ = { url: '/dsl/a1', promise: Promise.resolve(VALID) };

    const first = await loadDsl('/dsl/a1');
    const second = await loadDsl('/dsl/a1');
    expect(first.dsl.meta.title).toBe('预取');
    expect(second.dsl.meta.title).toBe('预取');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('地址不同不复用；预取失败后清掉，下一次重新请求', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(VALID)));
    vi.stubGlobal('fetch', fetchMock);
    const failed = Promise.reject(new Error('HTTP 503'));
    window.__NCA_DSL_PREFETCH__ = { url: '/dsl/a1', promise: failed };

    await expect(loadDsl('/dsl/a1')).rejects.toMatchObject({ name: 'DslLoadError', status: 503 });
    await Promise.resolve();
    expect(window.__NCA_DSL_PREFETCH__).toBeUndefined();
    await expect(loadDsl('/dsl/a1')).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('拉不下来与拉下来但不合法分成两种错误，监控据此分别计数', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    await expect(loadDsl('/dsl/missing')).rejects.toBeInstanceOf(DslLoadError);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ schemaVersion: '1.1.0', meta: {} }))),
    );
    await expect(loadDsl('/dsl/broken')).rejects.toBeInstanceOf(DslInvalidError);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ...VALID, schemaVersion: '9.0.0' }))),
    );
    await expect(loadDsl('/dsl/future')).rejects.toThrow(/请升级渲染器/);
  });
});
