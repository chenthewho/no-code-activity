import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** monitor 有模块级状态（一次访问一个结局），每个用例重新加载一份 */
async function load() {
  vi.resetModules();
  return import('./monitor');
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('健康上报', () => {
  it('合批发送，带活动与宿主；一次访问只认第一个结局', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    m.initMonitor({ activityId: 'a1', host: 'sdk_portrait' });

    m.reportMonitor('boot', { durationMs: 900 });
    m.reportMonitor('stall');
    m.reportMonitor('white_screen');
    vi.advanceTimersByTime(1000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body).toMatchObject({ activityId: 'a1', host: 'sdk_portrait' });
    expect(body.events.map((e: { type: string }) => e.type)).toEqual(['boot', 'white_screen']);
  });

  it('JS 错误每次访问最多 20 条，未初始化（设计器预览）不上报', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const m = await load();
    m.reportMonitor('js_error', { message: 'before init' });
    vi.advanceTimersByTime(1000);
    expect(fetchMock).not.toHaveBeenCalled();

    m.initMonitor({ host: 'browser' });
    for (let i = 0; i < 30; i++) m.reportMonitor('js_error', { message: `e${i}` });
    vi.advanceTimersByTime(1000);
    const body = JSON.parse(
      String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    );
    expect(body.events).toHaveLength(20);
  });

  it('白屏判定：采样点全打在页面骨架上才算', async () => {
    const m = await load();
    const surface = document.createElement('div');
    surface.className = 'nca-surface';
    const content = document.createElement('p');
    const doc = document;
    // jsdom 没实现 elementFromPoint，直接挂一个桩
    const spy = vi.fn<(x: number, y: number) => Element | null>();
    Object.defineProperty(doc, 'elementFromPoint', { value: spy, configurable: true });

    spy.mockReturnValue(surface);
    expect(m.isBlankScreen(doc)).toBe(true);
    spy.mockReturnValue(doc.body);
    expect(m.isBlankScreen(doc)).toBe(true);

    let calls = 0;
    spy.mockImplementation(() => (++calls === 5 ? content : surface));
    expect(m.isBlankScreen(doc)).toBe(false);
    delete (doc as unknown as { elementFromPoint?: unknown }).elementFromPoint;
  });
});
