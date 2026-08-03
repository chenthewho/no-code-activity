import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { finalDslSchema, type CraftNode, type EventBinding, type FinalDsl } from '@nca/dsl';
import { RendererSurface } from './RendererSurface';

/**
 * 活动组件的验收点都在「物料 → 事件 → 动作 → 状态 → 回到物料」这条闭环上，
 * 所以一律跑整套渲染器，而不是单独 mount 物料。
 */
function makeDsl(nodes: Record<string, unknown>, events: unknown[], initialState = {}): FinalDsl {
  return finalDslSchema.parse({
    schemaVersion: '1.0.0',
    meta: { activityId: 'act_test', title: '活动组件' },
    dataSources: [],
    craftJson: {
      ROOT: {
        type: { resolvedName: 'Page' },
        isCanvas: true,
        nodes: Object.keys(nodes),
        props: {},
      },
      ...nodes,
    },
    events,
    assets: [],
    initialState,
  });
}

const PRIZES = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `${i + 1} 号奖` }));

/** 探针：把状态变化显示成文字，断言据此看到动作真的跑完了 */
const probe = (content: string): Record<string, unknown> => ({
  type: { resolvedName: 'Text' },
  props: { content },
});

function lotteryDsl(
  props: Record<string, unknown> = {},
  extraEvents: Partial<EventBinding>[] = [],
): FinalDsl {
  return makeDsl(
    {
      lot_1: {
        type: { resolvedName: 'Lottery' },
        props: {
          prizes: PRIZES,
          resultIndex: '{{ state.prizeIndex }}',
          rounds: 1,
          duration: 800,
          ...props,
        },
      },
      probe_1: probe('{{ state.won ? "开奖完成" : "等待开奖" }}'),
    },
    [
      {
        id: 'e_finish',
        nodeId: 'lot_1',
        trigger: 'onCustom',
        customEvent: 'finish',
        actions: [{ type: 'state.set', key: 'won', value: true }],
      },
      ...extraEvents,
    ],
    { prizeIndex: -1 },
  );
}

describe('抽奖', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('没配奖品时给出占位提示，而不是渲染出一堆空格子', () => {
    render(<RendererSurface dsl={lotteryDsl({ prizes: [] })} />);
    expect(screen.getByText('请配置奖品')).toBeInTheDocument();
  });

  it('九宫格铺出 8 个奖品，中心是抽奖按钮', () => {
    render(<RendererSurface dsl={lotteryDsl()} />);
    expect(screen.getByText('1 号奖')).toBeInTheDocument();
    expect(screen.getByText('8 号奖')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '抽奖' })).toBeInTheDocument();
  });

  it('点击后转起来，拿到中奖序号才落停并抛 finish', async () => {
    vi.useFakeTimers();
    // 点击 → 写入中奖序号 → 物料看到合法序号才收尾，正是线上那条链路
    const dsl = lotteryDsl({}, [
      {
        id: 'e_draw',
        nodeId: 'lot_1',
        trigger: 'onCustom',
        customEvent: 'draw',
        actions: [{ type: 'state.set', key: 'prizeIndex', value: 2 }],
      },
    ]);
    render(<RendererSurface dsl={dsl} />);
    expect(screen.getByText('等待开奖')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '抽奖' }));
    await act(async () => {});

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('开奖完成')).toBeInTheDocument();
  });

  it('结果一直不来就超时收场，不会一直空转', async () => {
    vi.useFakeTimers();
    const dsl = lotteryDsl({ timeout: 2000 }, [
      {
        id: 'e_timeout',
        nodeId: 'lot_1',
        trigger: 'onCustom',
        customEvent: 'timeout',
        actions: [{ type: 'state.set', key: 'won', value: true }],
      },
    ]);
    render(<RendererSurface dsl={dsl} />);

    fireEvent.click(screen.getByRole('button', { name: '抽奖' }));
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    expect(screen.getByText('开奖完成')).toBeInTheDocument();
  });

  it('禁用态点不动，也不会抛 draw', async () => {
    const dsl = lotteryDsl({ disabled: true, disabledText: '今日已抽完' }, [
      {
        id: 'e_draw',
        nodeId: 'lot_1',
        trigger: 'onCustom',
        customEvent: 'draw',
        actions: [{ type: 'state.set', key: 'won', value: true }],
      },
    ]);
    render(<RendererSurface dsl={dsl} />);

    fireEvent.click(screen.getByRole('button', { name: '今日已抽完' }));
    await act(async () => {});

    expect(screen.getByText('等待开奖')).toBeInTheDocument();
  });

  it('转盘形态同样按中奖序号落停', async () => {
    vi.useFakeTimers();
    const dsl = lotteryDsl({ mode: 'wheel', prizes: PRIZES.slice(0, 6) }, [
      {
        id: 'e_draw',
        nodeId: 'lot_1',
        trigger: 'onCustom',
        customEvent: 'draw',
        actions: [{ type: 'state.set', key: 'prizeIndex', value: 4 }],
      },
    ]);
    const { container } = render(<RendererSurface dsl={dsl} />);
    expect(container.querySelector('.nca-lottery__wheel')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '抽奖' }));
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByText('开奖完成')).toBeInTheDocument();
  });

  it('编辑态不起转，画布内容保持稳定', async () => {
    vi.useFakeTimers();
    const { container } = render(<RendererSurface dsl={lotteryDsl()} editing />);
    await act(async () => {});
    const before = container.querySelector('.nca-lottery--grid')?.innerHTML;

    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(container.querySelector('.nca-lottery--grid')?.innerHTML).toBe(before);
  });
});

describe('登录', () => {
  const loginDsl = () =>
    makeDsl(
      {
        login_1: {
          type: { resolvedName: 'Login' },
          props: {
            logged: '{{ state.userId }}',
            nickname: '{{ state.nickname }}',
            greeting: 'Hi, ',
          },
        },
      },
      [
        {
          id: 'e_login',
          nodeId: 'login_1',
          trigger: 'onCustom',
          customEvent: 'login',
          actions: [
            { type: 'state.set', key: 'userId', value: 'u_1' },
            { type: 'state.set', key: 'nickname', value: '阿离' },
          ],
        },
      ],
      {},
    );

  it('登录态为空时展示登录入口', () => {
    render(<RendererSurface dsl={loginDsl()} />);
    expect(screen.getByText('登录后参与活动')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
  });

  it('点击登录抛出 login 事件，登录态写回后换成昵称', async () => {
    render(<RendererSurface dsl={loginDsl()} />);
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => expect(screen.getByText('Hi, 阿离')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument();
  });

  it('登录态是未求值的空串时仍算未登录', () => {
    const dsl = loginDsl();
    (dsl.craftJson.login_1 as CraftNode).props.logged = '';
    render(<RendererSurface dsl={dsl} />);
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
  });
});

describe('绑定角色', () => {
  const bindDsl = (props: Record<string, unknown> = {}) =>
    makeDsl(
      {
        bind_1: {
          type: { resolvedName: 'BindRole' },
          props: {
            servers: [
              { id: 's1', name: '艾欧尼亚' },
              { id: 's2', name: '祖安' },
            ],
            roles: [{ id: 'r1', name: '影流之主' }],
            ...props,
          },
        },
        probe_1: probe('{{ state.bound ? "已提交绑定" : "未绑定" }}'),
      },
      [
        {
          id: 'e_bind',
          nodeId: 'bind_1',
          trigger: 'onCustom',
          customEvent: 'bind',
          actions: [{ type: 'state.set', key: 'bound', value: true }],
        },
        {
          id: 'e_server',
          nodeId: 'bind_1',
          trigger: 'onCustom',
          customEvent: 'serverChange',
          actions: [{ type: 'state.set', key: 'picked', value: true }],
        },
      ],
      {},
    );

  it('渲染区服与角色两级选择', () => {
    const { container } = render(<RendererSurface dsl={bindDsl()} />);
    const selects = container.querySelectorAll('select');
    expect(selects).toHaveLength(2);
    expect(screen.getByText('艾欧尼亚')).toBeInTheDocument();
    expect(screen.getByText('影流之主')).toBeInTheDocument();
  });

  it('没选角色时提交按钮点不动', async () => {
    render(<RendererSurface dsl={bindDsl()} />);
    fireEvent.click(screen.getByRole('button', { name: '确认绑定' }));
    await act(async () => {});
    expect(screen.getByText('未绑定')).toBeInTheDocument();
  });

  it('选完区服和角色后提交，抛出 bind 事件', async () => {
    const { container } = render(<RendererSurface dsl={bindDsl()} />);
    const [serverSelect, roleSelect] = Array.from(container.querySelectorAll('select'));

    fireEvent.change(serverSelect!, { target: { value: 's1' } });
    fireEvent.change(roleSelect!, { target: { value: 'r1' } });
    fireEvent.click(screen.getByRole('button', { name: '确认绑定' }));

    await waitFor(() => expect(screen.getByText('已提交绑定')).toBeInTheDocument());
  });

  it('换区服会清掉已选角色，避免把别区的角色提交上去', () => {
    const { container } = render(<RendererSurface dsl={bindDsl()} />);
    const [serverSelect, roleSelect] = Array.from(container.querySelectorAll('select'));

    fireEvent.change(serverSelect!, { target: { value: 's1' } });
    fireEvent.change(roleSelect!, { target: { value: 'r1' } });
    expect((roleSelect as HTMLSelectElement).value).toBe('r1');

    fireEvent.change(serverSelect!, { target: { value: 's2' } });
    expect((roleSelect as HTMLSelectElement).value).toBe('');
  });

  it('角色列表为空时禁用角色选择并给出提示', () => {
    const { container } = render(<RendererSurface dsl={bindDsl({ roles: [] })} />);
    const [, roleSelect] = Array.from(container.querySelectorAll('select'));
    expect((roleSelect as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText('请先选择区服')).toBeInTheDocument();
  });

  it('已绑定态直接展示角色，点切换才回到选择界面', () => {
    const { container } = render(
      <RendererSurface dsl={bindDsl({ boundRole: '影流之主', boundServer: '艾欧尼亚' })} />,
    );
    expect(container.querySelectorAll('select')).toHaveLength(0);
    expect(screen.getByText('艾欧尼亚 · 影流之主')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '切换角色' }));
    expect(container.querySelectorAll('select')).toHaveLength(2);
  });
});
