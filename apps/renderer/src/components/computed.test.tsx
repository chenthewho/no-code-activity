import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { finalDslSchema, type FinalDsl } from '@nca/dsl';
import { RendererSurface } from './RendererSurface';

function dsl(actions: unknown[], texts: Record<string, string>, dataSources: unknown[]): FinalDsl {
  return finalDslSchema.parse({
    schemaVersion: '1.0.0',
    meta: { activityId: 'act_computed', title: 'computed' },
    initialState: { count: 1 },
    dataSources,
    craftJson: {
      ROOT: { type: { resolvedName: 'Page' }, isCanvas: true, nodes: ['btn', ...Object.keys(texts)] },
      btn: { type: { resolvedName: 'Button' }, props: { text: '加一' } },
      ...Object.fromEntries(
        Object.entries(texts).map(([id, content]) => [id, { type: { resolvedName: 'Text' }, props: { content } }]),
      ),
    },
    events: [{ id: 'e1', nodeId: 'btn', trigger: 'onClick', actions }],
  });
}

const DOUBLE = { id: 'ds_double', name: '翻倍', type: 'computed', expression: '{{ state.count * 2 }}' };

describe('computed 数据源', () => {
  it('随 state 变化重新计算，且可以引用前面声明的 computed', async () => {
    render(
      <RendererSurface
        dsl={dsl(
          [{ type: 'state.set', key: 'count', value: '{{ state.count + 1 }}' }],
          { t1: '翻倍 {{ dataSource.ds_double }}', t2: '再加十 {{ dataSource.ds_plus }}' },
          [DOUBLE, { id: 'ds_plus', name: '再加十', type: 'computed', expression: '{{ dataSource.ds_double + 10 }}' }],
        )}
      />,
    );
    expect(screen.getByText('翻倍 2')).toBeInTheDocument();
    expect(screen.getByText('再加十 12')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加一' }));
    expect(await screen.findByText('翻倍 4')).toBeInTheDocument();
    expect(screen.getByText('再加十 14')).toBeInTheDocument();
  });

  it('同一个事件里，后一个动作读到的是前一个动作刚写入后的新值', async () => {
    render(
      <RendererSurface
        dsl={dsl(
          [
            { type: 'state.set', key: 'count', value: 5 },
            { type: 'state.set', key: 'snapshot', value: '{{ dataSource.ds_double }}' },
          ],
          { t1: '快照 {{ state.snapshot }}' },
          [DOUBLE],
        )}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '加一' }));
    expect(await screen.findByText('快照 10')).toBeInTheDocument();
  });

  it('依赖还没就绪时退回 fallback', () => {
    render(
      <RendererSurface
        dsl={dsl([], { t1: '昵称 {{ dataSource.ds_name }}' }, [
          { id: 'ds_name', name: '昵称', type: 'computed', expression: '{{ state.profile.name }}', fallback: '游客' },
        ])}
      />,
    );
    expect(screen.getByText('昵称 游客')).toBeInTheDocument();
  });
});
