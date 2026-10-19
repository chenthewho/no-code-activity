import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finalDslSchema } from '@nca/dsl';
import { componentMap } from '@nca/materials';
import { RendererSurface } from './RendererSurface';

function Boom({ fail }: { fail?: boolean }) {
  if (fail) throw new Error('坏掉了');
  return <span>好了</span>;
}

const dsl = (fail: boolean) =>
  finalDslSchema.parse({
    schemaVersion: '1.1.0',
    meta: { activityId: 'a1', title: '错误边界' },
    craftJson: {
      ROOT: { type: { resolvedName: 'Page' }, isCanvas: true, nodes: ['boom', 'txt'] },
      boom: { type: { resolvedName: 'Boom' }, props: { fail }, parent: 'ROOT' },
      txt: {
        type: { resolvedName: 'Text' },
        props: { content: '其它组件照常显示' },
        parent: 'ROOT',
      },
    },
  });

beforeEach(() => {
  componentMap.Boom = Boom;
  // React 会把捕获到的渲染错误再打一遍 console.error，测试里静音
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  delete componentMap.Boom;
  vi.restoreAllMocks();
});

describe('节点级错误边界', () => {
  it('一个组件渲染抛错只坏它自己，整页不白屏；线上静默隐藏', () => {
    render(<RendererSurface dsl={dsl(true)} />);
    expect(screen.getByText('其它组件照常显示')).toBeInTheDocument();
    expect(screen.queryByText(/渲染失败/)).not.toBeInTheDocument();
  });

  it('编辑态画出红框；改对属性后自动恢复', () => {
    const { rerender } = render(<RendererSurface dsl={dsl(true)} editing />);
    expect(screen.getByText(/组件「Boom」渲染失败：坏掉了/)).toBeInTheDocument();
    rerender(<RendererSurface dsl={dsl(false)} editing />);
    expect(screen.getByText('好了')).toBeInTheDocument();
  });
});
