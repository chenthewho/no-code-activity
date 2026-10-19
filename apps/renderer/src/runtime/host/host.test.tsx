import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalDslSchema } from '@nca/dsl';
import { getMaterial } from '@nca/materials';
import { computeViewport } from '../viewport';
import { RendererSurface } from '../../components/RendererSurface';
import { createPostMessageBridge, BRIDGE_SOURCE } from './post-message-bridge';
import { detectHost, resolveHostType } from './browser';

function setUrl(search: string) {
  window.history.replaceState(null, '', `/${search}`);
}

beforeEach(() => setUrl(''));
afterEach(() => {
  delete window.__NCA_HOST__;
  delete window.__wxjs_environment;
  delete window.wx;
  vi.useRealTimers();
});

describe('computeViewport', () => {
  it('竖屏按宽等比缩放，上限两倍稿宽', () => {
    expect(computeViewport({ width: 375, height: 812, designWidth: 750, adaptMode: 'vw' })).toEqual(
      {
        rootFontSize: 50,
        frameWidth: null,
      },
    );
    expect(
      computeViewport({ width: 2000, height: 3000, designWidth: 750, adaptMode: 'vw' })
        .rootFontSize,
    ).toBe(200);
  });

  it('横屏里放竖版稿：收成 9:16 的一列，不窄于 375', () => {
    // 手机横置 844×390：9:16 只有 219，按下限 375
    expect(computeViewport({ width: 844, height: 390, designWidth: 750, adaptMode: 'vw' })).toEqual(
      {
        rootFontSize: 50,
        frameWidth: 375,
      },
    );
    // PC 1440×900：列宽 506
    expect(
      computeViewport({ width: 1440, height: 900, designWidth: 750, adaptMode: 'vw' }).frameWidth,
    ).toBe(506);
  });

  it('横版稿在横屏里照常按宽缩放；fixed 不缩放', () => {
    expect(
      computeViewport({ width: 1334, height: 750, designWidth: 1334, adaptMode: 'vw' }),
    ).toEqual({
      rootFontSize: 100,
      frameWidth: null,
    });
    expect(
      computeViewport({ width: 1440, height: 900, designWidth: 750, adaptMode: 'fixed' }),
    ).toEqual({
      rootFontSize: 100,
      frameWidth: null,
    });
  });
});

describe('宿主判定', () => {
  it('注入的 __NCA_HOST__ > ?host= > 小程序环境 > 浏览器；不认识的值忽略', () => {
    expect(resolveHostType()).toBe('browser');
    window.__wxjs_environment = 'miniprogram';
    expect(resolveHostType()).toBe('wechat_mini_program');
    setUrl('?host=sdk_landscape');
    expect(resolveHostType()).toBe('sdk_landscape');
    window.__NCA_HOST__ = 'game_center';
    expect(resolveHostType()).toBe('game_center');
    window.__NCA_HOST__ = 'nonsense' as never;
    setUrl('?host=also-nonsense');
    expect(resolveHostType()).toBe('wechat_mini_program');
  });

  it('小程序宿主：分享交给小程序页面并提示用户点右上角，登录跳小程序登录页', async () => {
    const miniProgram = { navigateTo: vi.fn(), postMessage: vi.fn() };
    window.__wxjs_environment = 'miniprogram';
    window.wx = { miniProgram };
    setUrl('?id=a1');
    const host = detectHost();
    expect(host.type).toBe('wechat_mini_program');

    const result = await host.share({ title: '快来', channel: 'system', type: 'share' } as never);
    expect(result).toEqual({ hint: expect.stringContaining('右上角') });
    expect(miniProgram.postMessage.mock.calls[0]![0].data).toMatchObject({
      type: 'nca:share',
      title: '快来',
    });

    expect(await host.login()).toEqual({ redirecting: true });
    expect(miniProgram.navigateTo.mock.calls[0]![0].url).toBe(
      `/pages/nca-login/index?redirect=${encodeURIComponent(window.location.href)}`,
    );
  });
});

describe('postMessage 桥', () => {
  it('请求带 id 发给宿主，只认宿主窗口的同 id 回复', async () => {
    const posted: { id: number; method: string }[] = [];
    const target = {
      postMessage: (msg: { id: number; method: string }) => posted.push(msg),
    } as unknown as Window;
    const bridge = createPostMessageBridge(target);

    const pending = bridge.login!();
    expect(posted[0]).toMatchObject({ method: 'login' });
    const id = posted[0]!.id;

    // 别的窗口冒充宿主回复：不认
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: BRIDGE_SOURCE, id, result: { code: 'forged' } },
        source: window,
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: BRIDGE_SOURCE, id, result: { code: 'real' } },
        source: target,
      }),
    );
    await expect(pending).resolves.toEqual({ code: 'real' });
  });

  it('宿主报错或超时都会结束等待', async () => {
    vi.useFakeTimers();
    const posted: { id: number }[] = [];
    const target = { postMessage: (msg: { id: number }) => posted.push(msg) } as unknown as Window;
    const bridge = createPostMessageBridge(target);

    const failing = bridge.invoke!('x');
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: BRIDGE_SOURCE, id: posted[0]!.id, error: '不支持' },
        source: target,
      }),
    );
    await expect(failing).rejects.toThrow('不支持');

    const silent = bridge.share!({ title: 't' });
    vi.advanceTimersByTime(10_001);
    await expect(silent).rejects.toThrow(/宿主未响应 share/);
  });
});

describe('同一份 DSL 跑在不同宿主', () => {
  const dsl = finalDslSchema.parse({
    schemaVersion: '1.1.0',
    meta: {
      activityId: 'a1',
      title: '多宿主',
      hosts: ['browser', 'sdk_portrait', 'wechat_mini_program'],
    },
    craftJson: {
      ROOT: { type: { resolvedName: 'Page' }, isCanvas: true, nodes: ['t1', 'only'] },
      t1: {
        type: { resolvedName: 'Text' },
        props: { content: '{{ host === "sdk_portrait" ? "SDK 专属文案" : "通用文案" }}' },
        parent: 'ROOT',
      },
      only: { type: { resolvedName: 'Button' }, props: { text: '仅浏览器可见' }, parent: 'ROOT' },
    },
  });

  it.each([
    ['', '通用文案', true],
    ['?host=sdk_portrait', 'SDK 专属文案', false],
    ['?host=wechat_mini_program', '通用文案', false],
  ])('宿主 %s：{{ host }} 分支与宿主专属组件', async (search, text, buttonVisible) => {
    setUrl(search);
    const button = getMaterial('Button')!.meta;
    const original = button.supportedHosts;
    button.supportedHosts = ['browser'];
    try {
      render(<RendererSurface dsl={dsl} />);
      await act(async () => {});
      expect(screen.getByText(text)).toBeInTheDocument();
      expect(Boolean(screen.queryByText('仅浏览器可见'))).toBe(buttonVisible);
    } finally {
      button.supportedHosts = original;
    }
  });
});
