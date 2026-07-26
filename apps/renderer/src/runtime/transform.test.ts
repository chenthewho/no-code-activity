import { describe, expect, it } from 'vitest';
import type { CraftNode } from '@nca/dsl';
import { applyMove, applyResize, buildPatch, isAbsolute, type TransformSession } from './transform';

const startBox = { top: 100, left: 50, width: 200, height: 80 };

function session(mode: TransformSession['mode'], overrides: Partial<TransformSession> = {}): TransformSession {
  return {
    nodeId: 'n1',
    mode,
    startX: 300,
    startY: 200,
    startBox,
    startTop: 0,
    startLeft: 0,
    box: startBox,
    ...overrides,
  };
}

const node = (props: Record<string, unknown> = {}): CraftNode =>
  ({
    type: { resolvedName: 'Container' },
    isCanvas: false,
    props,
    custom: {},
    hidden: false,
    nodes: [],
    linkedNodes: {},
  }) as unknown as CraftNode;

describe('applyResize', () => {
  it('右侧手柄只加宽，不动位置', () => {
    const box = applyResize(session({ kind: 'resize', handle: 'e' }), 340, 200);
    expect(box.width).toBe(240);
    expect(box.height).toBe(80);
    expect(box.left).toBe(50);
  });

  it('左侧手柄在加宽的同时把左边界跟着挪', () => {
    const box = applyResize(session({ kind: 'resize', handle: 'w' }), 280, 200);
    expect(box.width).toBe(220);
    expect(box.left).toBe(30);
  });

  it('角手柄同时改宽高', () => {
    const box = applyResize(session({ kind: 'resize', handle: 'se' }), 350, 250);
    expect(box.width).toBe(250);
    expect(box.height).toBe(130);
  });

  it('缩到最小尺寸后位置也停住，不会一边缩到 0 一边继续滑', () => {
    const box = applyResize(session({ kind: 'resize', handle: 'w' }), 900, 200);
    expect(box.width).toBe(8);
    // 右边界固定在 250，左边界应停在 242
    expect(box.left).toBe(242);
    expect(box.left + box.width).toBe(250);
  });

  it('向上拖 n 手柄增高并上移顶边', () => {
    const box = applyResize(session({ kind: 'resize', handle: 'n' }), 300, 160);
    expect(box.height).toBe(120);
    expect(box.top).toBe(60);
  });
});

describe('applyMove', () => {
  it('按指针增量平移，尺寸不变', () => {
    const box = applyMove(session({ kind: 'move' }), 330, 240);
    expect(box).toEqual({ top: 140, left: 80, width: 200, height: 80 });
  });
});

describe('buildPatch', () => {
  it('缩放只回写真正变化的边', () => {
    const s = session({ kind: 'resize', handle: 'e' });
    const patch = buildPatch(s, { ...startBox, width: 300 }, node());
    expect(patch).toEqual({ width: 300 });
    expect(patch.height).toBeUndefined();
  });

  it('流式节点不回写 top/left——它靠重排而不是坐标', () => {
    const s = session({ kind: 'move' });
    const patch = buildPatch(s, { ...startBox, top: 200, left: 150 }, node());
    expect(patch.top).toBeUndefined();
    expect(patch.left).toBeUndefined();
  });

  it('绝对定位节点在原有 top/left 基础上累加位移', () => {
    const s = session({ kind: 'move' }, { startTop: 40, startLeft: 20 });
    const patch = buildPatch(
      s,
      { ...startBox, top: startBox.top + 30, left: startBox.left + 10 },
      node({ position: 'absolute', top: 40, left: 20 }),
    );
    expect(patch.top).toBe(70);
    expect(patch.left).toBe(30);
  });

  it('位移不足 1px 时不产生改动，避免误触留下无意义的 diff', () => {
    const s = session({ kind: 'move' }, { startTop: 0, startLeft: 0 });
    const patch = buildPatch(s, { ...startBox, top: 100.4 }, node({ position: 'absolute' }));
    expect(patch).toEqual({});
  });
});

describe('isAbsolute', () => {
  it('按 props.position 判定', () => {
    expect(isAbsolute(node({ position: 'absolute' }))).toBe(true);
    expect(isAbsolute(node({ position: 'relative' }))).toBe(false);
    expect(isAbsolute(node())).toBe(false);
    expect(isAbsolute(undefined)).toBe(false);
  });
});
