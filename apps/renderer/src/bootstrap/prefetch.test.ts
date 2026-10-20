import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dslPrefetchScript } from '../../prefetch-script';
import { API_BASE, dslRequest } from '../runtime/api';

/**
 * 内联预取脚本与 dslRequest 必须拼出同一个请求，否则预取白发、还多打一次接口。
 * 这里在 jsdom 里真跑一遍内联脚本，与 dslRequest 的结果逐字对比。
 */
function runInlineScript() {
  // 测试环境里执行注入到 index.html 的同一段脚本
  new Function(dslPrefetchScript(API_BASE))();
}

beforeEach(() => {
  localStorage.clear();
  delete window.__NCA_DSL_PREFETCH__;
});
afterEach(() => vi.unstubAllGlobals());

describe('index.html 内联 DSL 预取', () => {
  it.each([
    ['首次访问（还没有访客 id）、无渠道、未登录', '/?id=act_1', null],
    ['带渠道码、已登录', '/act/act_1?ch=wx', 'rt_token'],
  ])('%s：与 dslRequest 拼出同一个地址与请求头', async (_label, path, token) => {
    window.history.replaceState(null, '', path);
    if (token) localStorage.setItem('nca:rt-token', token);
    const fetchMock = vi.fn(async () => new Response('{}', { headers: { 'X-NCA-Version': '3' } }));
    vi.stubGlobal('fetch', fetchMock);

    runInlineScript();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // 内联脚本生成的访客 id 已经落到 localStorage，dslRequest 读到的是同一个
    const expected = dslRequest('act_1');
    expect(url).toBe(expected.url);
    expect(init.headers).toEqual(expected.headers);
    expect(window.__NCA_DSL_PREFETCH__?.url).toBe(expected.url);
    await expect(window.__NCA_DSL_PREFETCH__?.promise).resolves.toEqual({ data: {}, version: '3' });
    expect(localStorage.getItem('nca:guest-id')).toMatch(/^guest_[a-z0-9]+$/);
  });

  it('设计器预览与没有活动 id 的地址不预取', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/?preview=1&id=act_1');
    runInlineScript();
    window.history.replaceState(null, '', '/');
    runInlineScript();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
