import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalDslSchema, type FinalDsl } from '@nca/dsl';

const track = vi.hoisted(() => vi.fn());
vi.mock('./analytics', () => ({ initAnalytics: vi.fn(), trackAnalytics: track }));

import { RendererSurface } from '../components/RendererSurface';
import { exposureTargets, observeExposure, resetExposure } from './exposure';

class FakeObserver {
  static current: FakeObserver | null = null;
  observed = new Set<Element>();
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeObserver.current = this;
  }
  observe(el: Element) {
    this.observed.add(el);
  }
  unobserve(el: Element) {
    this.observed.delete(el);
  }
  disconnect() {
    this.observed.clear();
  }
  /** 模拟元素进入视口：默认整块可见 */
  fire(target: Element, entry: Partial<IntersectionObserverEntry> = {}) {
    this.callback(
      [
        {
          target,
          isIntersecting: true,
          intersectionRatio: 1,
          intersectionRect: { height: 100 } as DOMRectReadOnly,
          rootBounds: { height: 800 } as DOMRectReadOnly,
          ...entry,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
  }
}

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  resetExposure();
  track.mockClear();
  visibility = 'visible';
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});
afterEach(() => vi.unstubAllGlobals());

const exposes = () => track.mock.calls.filter(([event]) => event === 'expose').map(([, nodeId]) => nodeId as string);

function makeDsl(): FinalDsl {
  return finalDslSchema.parse({
    schemaVersion: '1.0.0',
    meta: { activityId: 'act_exp', title: '曝光' },
    craftJson: {
      ROOT: { type: { resolvedName: 'Page' }, isCanvas: true, nodes: ['txt', 'btn', 'rank'] },
      txt: { type: { resolvedName: 'Text' }, props: { content: '纯展示文字' } },
      btn: { type: { resolvedName: 'Button' }, props: { text: '立即参与' } },
      rank: { type: { resolvedName: 'RankList' }, props: { data: [] } },
    },
    events: [{ id: 'e1', nodeId: 'btn', trigger: 'onClick', actions: [{ type: 'toast', message: 'hi' }] }],
  });
}

describe('逐节点曝光', () => {
  it('只给绑了事件的组件与业务组件上报，页面本身不算', () => {
    expect([...exposureTargets(makeDsl())].sort()).toEqual(['btn', 'rank']);
  });

  it('一半进入视口记一次，同一节点（含循环出来的多个元素）每次访问只记一次', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    observeExposure(a, 'n1');
    observeExposure(b, 'n1');
    const io = FakeObserver.current!;

    io.fire(a, { intersectionRatio: 0.3, intersectionRect: { height: 30 } as DOMRectReadOnly });
    expect(exposes()).toEqual([]);
    io.fire(a, { intersectionRatio: 0.6 });
    io.fire(b);
    io.fire(a);
    expect(exposes()).toEqual(['n1']);
  });

  it('比视口还高的组件，可见部分占满半屏就算', () => {
    const tall = document.createElement('div');
    observeExposure(tall, 'tall');
    FakeObserver.current!.fire(tall, {
      intersectionRatio: 0.3,
      intersectionRect: { height: 500 } as DOMRectReadOnly,
    });
    expect(exposes()).toEqual(['tall']);
  });

  it('后台标签页里不记，切回前台时仍在视口里的才补记', () => {
    const seen = document.createElement('div');
    const left = document.createElement('div');
    observeExposure(seen, 'seen');
    observeExposure(left, 'left');
    visibility = 'hidden';
    const io = FakeObserver.current!;
    io.fire(seen);
    io.fire(left);
    io.fire(left, { isIntersecting: false, intersectionRatio: 0 });
    expect(exposes()).toEqual([]);

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(exposes()).toEqual(['seen']);
  });

  it('线上渲染：只有要统计的组件套探针，探针不产生盒子、观察的是物料根元素', () => {
    render(<RendererSurface dsl={makeDsl()} />);
    const io = FakeObserver.current!;
    const button = screen.getByText('立即参与').closest('button')!;
    const observed = [...io.observed];
    expect(observed).toHaveLength(2);
    expect(observed.some((el) => el.contains(button))).toBe(true);
    for (const el of observed) expect((el.parentElement as HTMLElement).style.display).toBe('contents');
    // 纯展示的文字不套探针
    expect(screen.getByText('纯展示文字').closest('[style*="contents"]')).toBeNull();

    io.fire(observed.find((el) => el.contains(button))!);
    expect(exposes()).toContain('btn');
  });

  it('StrictMode 卸载再挂载后仍在观察（开发环境下）', () => {
    render(
      <StrictMode>
        <RendererSurface dsl={makeDsl()} />
      </StrictMode>,
    );
    expect(FakeObserver.current!.observed.size).toBe(2);
  });

  it('编辑态不上报曝光', () => {
    render(<RendererSurface dsl={makeDsl()} editing />);
    expect(FakeObserver.current?.observed.size ?? 0).toBe(0);
  });
});
