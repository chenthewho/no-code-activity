import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { finalDslSchema, type CraftNode, type EventBinding, type FinalDsl } from '@nca/dsl';
import { RendererSurface } from './RendererSurface';

/**
 * 活动组件的验收点都在「物料 → 事件 → 动作 → 状态 → 回到物料」这条闭环上，
 * 所以一律跑整套渲染器，而不是单独 mount 物料。
 */
function makeDsl(
  nodes: Record<string, unknown>,
  events: unknown[],
  initialState = {},
  dataSources: unknown[] = [],
): FinalDsl {
  return finalDslSchema.parse({
    schemaVersion: '1.0.0',
    meta: { activityId: 'act_test', title: '活动组件' },
    dataSources,
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

/**
 * 这是 AI 会生成的那条标准编排，也是线上真实形态：
 * 中奖结果来自接口，而不是像上面几个用例那样写死常量。
 * 它同时压住两个曾经的缺陷——`state.set` 不求值、以及同一事件里
 * 后一个动作读不到前一个动作刚写进去的值。
 */
describe('抽奖闭环（接口驱动）', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function drawDrivenDsl() {
    return makeDsl(
      {
        lot_1: {
          type: { resolvedName: 'Lottery' },
          props: {
            prizes: PRIZES,
            resultIndex: '{{ state.prizeIndex }}',
            rounds: 1,
            duration: 800,
          },
        },
        // 带前缀：奖品名同时出现在九宫格的格子里，光断言名字会命中两处
        probe_1: probe('开奖结果：{{ state.wonName }}'),
      },
      [
        {
          id: 'e_draw',
          nodeId: 'lot_1',
          trigger: 'onCustom',
          customEvent: 'draw',
          actions: [
            // 先归位，否则第二次点击会立刻停在上一轮结果
            { type: 'state.set', key: 'prizeIndex', value: -1 },
            { type: 'dataSource.refresh', dataSourceId: 'ds_draw' },
            { type: 'state.set', key: 'prizeIndex', value: '{{ dataSource.ds_draw.index }}' },
          ],
        },
        {
          id: 'e_finish',
          nodeId: 'lot_1',
          trigger: 'onCustom',
          customEvent: 'finish',
          actions: [{ type: 'state.set', key: 'wonName', value: '{{ payload.prize.name }}' }],
        },
      ],
      { prizeIndex: -1, wonName: '未开奖' },
      [
        {
          id: 'ds_draw',
          name: '抽奖接口',
          type: 'http',
          url: '/api/draw',
          method: 'POST',
          autoLoad: false,
        },
      ],
    );
  }

  it('接口返回的中奖序号能写进 state，并驱动物料落停到对应奖品', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ index: 5 }) }),
    );

    render(<RendererSurface dsl={drawDrivenDsl()} />);
    expect(screen.getByText('开奖结果：未开奖')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '抽奖' }));
    // 让 draw 的三个动作串行跑完（含一次真实 await 的接口请求）
    await act(async () => {});

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    // 6 号奖 = index 5，说明表达式求了值、且第三个动作读到了刚刷新的数据源
    expect(screen.getByText('开奖结果：6 号奖')).toBeInTheDocument();
  });

  it('连抽两次都能停在各自的结果上，不会卡在上一轮', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ index: 1 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ index: 7 }) });
    vi.stubGlobal('fetch', fetchMock);

    render(<RendererSurface dsl={drawDrivenDsl()} />);

    fireEvent.click(screen.getByRole('button', { name: '抽奖' }));
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('开奖结果：2 号奖')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '抽奖' }));
    await act(async () => {});
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('开奖结果：8 号奖')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('登录', () => {
  const loginDsl = (props: Record<string, unknown> = {}) =>
    makeDsl(
      {
        login_1: {
          type: { resolvedName: 'Login' },
          props: { greeting: 'Hi, ', ...props },
        },
        probe_1: probe('{{ state.submitted ? "已提交" : "未提交" }}'),
      },
      [
        {
          id: 'e_submit',
          nodeId: 'login_1',
          trigger: 'onCustom',
          customEvent: 'submit',
          actions: [{ type: 'state.set', key: 'submitted', value: true }],
        },
      ],
      {},
    );

  it('未登录时展示登录入口，弹窗默认不出现', () => {
    render(<RendererSurface dsl={loginDsl()} />);
    expect(screen.getByText('登录后参与活动')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('请输入账号')).not.toBeInTheDocument();
  });

  it('点击登录弹出账号密码框', () => {
    render(<RendererSurface dsl={loginDsl()} />);
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    expect(screen.getByPlaceholderText('请输入账号')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入密码')).toHaveAttribute('type', 'password');
  });

  it('账号密码没填全就提交，只提示不关窗也不抛 submit', async () => {
    render(<RendererSurface dsl={loginDsl()} />);
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    fireEvent.change(screen.getByPlaceholderText('请输入账号'), { target: { value: 'player' } });
    // 密码留空。入口与弹窗里的提交按钮同名，取后者
    fireEvent.click(screen.getAllByRole('button', { name: '登录' }).at(-1)!);

    expect(screen.getByText('请输入账号和密码')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('请输入账号')).toBeInTheDocument();
    await act(async () => {});
    expect(screen.getByText('未提交')).toBeInTheDocument();
  });

  it('填完提交后抛 submit、关窗，并按账号进入已登录态', async () => {
    render(<RendererSurface dsl={loginDsl()} />);
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    fireEvent.change(screen.getByPlaceholderText('请输入账号'), { target: { value: 'player' } });
    fireEvent.change(screen.getByPlaceholderText('请输入密码'), { target: { value: 'pwd123' } });
    fireEvent.click(screen.getAllByRole('button', { name: '登录' }).at(-1)!);

    await waitFor(() => expect(screen.getByText('已提交')).toBeInTheDocument());
    expect(screen.queryByPlaceholderText('请输入账号')).not.toBeInTheDocument();
    expect(screen.getByText('Hi, player')).toBeInTheDocument();
  });

  it('退出后回到未登录态', async () => {
    render(<RendererSurface dsl={loginDsl()} />);
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    fireEvent.change(screen.getByPlaceholderText('请输入账号'), { target: { value: 'player' } });
    fireEvent.change(screen.getByPlaceholderText('请输入密码'), { target: { value: 'pwd123' } });
    fireEvent.click(screen.getAllByRole('button', { name: '登录' }).at(-1)!);
    await waitFor(() => expect(screen.getByText('Hi, player')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '退出' }));
    expect(screen.getByText('登录后参与活动')).toBeInTheDocument();
  });

  it('关掉本地登录态后只认绑定值，提交不会自己登进去', async () => {
    render(<RendererSurface dsl={loginDsl({ localSession: false })} />);
    fireEvent.click(screen.getByRole('button', { name: '登录' }));
    fireEvent.change(screen.getByPlaceholderText('请输入账号'), { target: { value: 'player' } });
    fireEvent.change(screen.getByPlaceholderText('请输入密码'), { target: { value: 'pwd123' } });
    fireEvent.click(screen.getAllByRole('button', { name: '登录' }).at(-1)!);

    await waitFor(() => expect(screen.getByText('已提交')).toBeInTheDocument());
    expect(screen.getByText('登录后参与活动')).toBeInTheDocument();
  });

  it('形态选「交给登录动作」时不弹窗，只抛 login 事件', async () => {
    const dsl = loginDsl({ mode: 'action' });
    dsl.events = [
      {
        id: 'e_login',
        nodeId: 'login_1',
        trigger: 'onCustom',
        customEvent: 'login',
        actions: [{ type: 'state.set', key: 'submitted', value: true }],
      },
    ];
    render(<RendererSurface dsl={dsl} />);
    fireEvent.click(screen.getByRole('button', { name: '登录' }));

    await waitFor(() => expect(screen.getByText('已提交')).toBeInTheDocument());
    expect(screen.queryByPlaceholderText('请输入账号')).not.toBeInTheDocument();
  });

  it('登录态绑定的是未求值的空串时仍算未登录', () => {
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
            roles: [
              { id: 'r1', name: '影流之主', serverId: 's1' },
              { id: 'r2', name: '德玛西亚之力', serverId: 's2' },
            ],
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
      ],
      {},
    );

  const selects = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('select')) as HTMLSelectElement[];

  it('未绑定时只有一个入口按钮，下拉在弹窗里', () => {
    const { container } = render(<RendererSurface dsl={bindDsl()} />);
    expect(screen.getByRole('button', { name: '绑定角色' })).toBeInTheDocument();
    expect(selects(container)).toHaveLength(0);
  });

  it('点入口弹出弹窗，含区服与角色两个下拉', () => {
    const { container } = render(<RendererSurface dsl={bindDsl()} />);
    fireEvent.click(screen.getByRole('button', { name: '绑定角色' }));
    expect(selects(container)).toHaveLength(2);
  });

  it('角色按所属区服过滤，没选区服时选不了角色', () => {
    const { container } = render(<RendererSurface dsl={bindDsl()} />);
    fireEvent.click(screen.getByRole('button', { name: '绑定角色' }));
    const [serverSelect, roleSelect] = selects(container);

    expect(roleSelect!.disabled).toBe(true);
    expect(screen.getByText('请先选择区服')).toBeInTheDocument();

    fireEvent.change(serverSelect!, { target: { value: 's1' } });
    const labels = Array.from(roleSelect!.options).map((o) => o.text);
    expect(labels).toContain('影流之主');
    expect(labels).not.toContain('德玛西亚之力');
  });

  it('换区服会清掉已选角色，避免把别区的角色提交上去', () => {
    const { container } = render(<RendererSurface dsl={bindDsl()} />);
    fireEvent.click(screen.getByRole('button', { name: '绑定角色' }));
    const [serverSelect, roleSelect] = selects(container);

    fireEvent.change(serverSelect!, { target: { value: 's1' } });
    fireEvent.change(roleSelect!, { target: { value: 'r1' } });
    expect(roleSelect!.value).toBe('r1');

    fireEvent.change(serverSelect!, { target: { value: 's2' } });
    expect(roleSelect!.value).toBe('');
  });

  it('确认绑定后抛 bind 事件、关窗，并展示区服与角色', async () => {
    const { container } = render(<RendererSurface dsl={bindDsl()} />);
    fireEvent.click(screen.getByRole('button', { name: '绑定角色' }));
    const [serverSelect, roleSelect] = selects(container);
    fireEvent.change(serverSelect!, { target: { value: 's1' } });
    fireEvent.change(roleSelect!, { target: { value: 'r1' } });
    fireEvent.click(screen.getByRole('button', { name: '确认绑定' }));

    await waitFor(() => expect(screen.getByText('已提交绑定')).toBeInTheDocument());
    expect(selects(container)).toHaveLength(0);
    expect(screen.getByText('艾欧尼亚 · 影流之主')).toBeInTheDocument();
  });

  it('绑定后可以换绑，弹窗会再开一次', async () => {
    const { container } = render(<RendererSurface dsl={bindDsl()} />);
    fireEvent.click(screen.getByRole('button', { name: '绑定角色' }));
    let [serverSelect, roleSelect] = selects(container);
    fireEvent.change(serverSelect!, { target: { value: 's1' } });
    fireEvent.change(roleSelect!, { target: { value: 'r1' } });
    fireEvent.click(screen.getByRole('button', { name: '确认绑定' }));
    await waitFor(() => expect(screen.getByText('艾欧尼亚 · 影流之主')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '换绑' }));
    [serverSelect, roleSelect] = selects(container);
    fireEvent.change(serverSelect!, { target: { value: 's2' } });
    fireEvent.change(roleSelect!, { target: { value: 'r2' } });
    fireEvent.click(screen.getByRole('button', { name: '确认绑定' }));

    await waitFor(() => expect(screen.getByText('祖安 · 德玛西亚之力')).toBeInTheDocument());
  });

  it('没选角色时确认按钮点不动', async () => {
    render(<RendererSurface dsl={bindDsl()} />);
    fireEvent.click(screen.getByRole('button', { name: '绑定角色' }));
    fireEvent.click(screen.getByRole('button', { name: '确认绑定' }));

    await act(async () => {});
    expect(screen.getByText('未绑定')).toBeInTheDocument();
  });

  it('外部绑定的已绑定角色直接展示，无需本地选过', () => {
    render(<RendererSurface dsl={bindDsl({ boundRole: '疾风剑豪', boundServer: '黑色玫瑰' })} />);
    expect(screen.getByText('黑色玫瑰 · 疾风剑豪')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '换绑' })).toBeInTheDocument();
  });
});

describe('活动规则', () => {
  const rulesDsl = (props: Record<string, unknown> = {}) =>
    makeDsl(
      {
        rule_1: {
          type: { resolvedName: 'Rules' },
          props: {
            content: '每人每天限抽 3 次\n奖品 7 个工作日内发放\n\n最终解释权归主办方',
            ...props,
          },
        },
      },
      [],
      {},
    );

  it('铺开形态按行渲染并自动编号', () => {
    render(<RendererSurface dsl={rulesDsl()} />);
    expect(screen.getByText('每人每天限抽 3 次')).toBeInTheDocument();
    // 空行被忽略，第三条仍然是 3
    expect(screen.getByText('最终解释权归主办方')).toBeInTheDocument();
    expect(screen.getByText('3.')).toBeInTheDocument();
  });

  it('按钮形态默认收起，点开才看得到正文', () => {
    render(<RendererSurface dsl={rulesDsl({ mode: 'dialog' })} />);
    expect(screen.queryByText('每人每天限抽 3 次')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '活动规则' }));
    expect(screen.getByText('每人每天限抽 3 次')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '我知道了' }));
    expect(screen.queryByText('每人每天限抽 3 次')).not.toBeInTheDocument();
  });
});

describe('奖励列表', () => {
  const REWARDS = [
    { id: 'a', name: '新手礼包', desc: '登录即得', status: 'ready' },
    { id: 'b', name: '进阶礼包', desc: '邀请 3 位好友', status: 'locked' },
    { id: 'c', name: '限定头像框', desc: '已到账', status: 'received' },
  ];

  const rewardDsl = (props: Record<string, unknown> = {}) =>
    makeDsl(
      {
        rw_1: { type: { resolvedName: 'RewardList' }, props: { data: REWARDS, ...props } },
        // 带前缀：「已领取」同时是按钮上的文案，光断言两个字会命中两处
        probe_1: probe('领取结果：{{ state.got ? "已抛出" : "未触发" }}'),
      },
      [
        {
          id: 'e_receive',
          nodeId: 'rw_1',
          trigger: 'onCustom',
          customEvent: 'receive',
          actions: [{ type: 'state.set', key: 'got', value: true }],
        },
      ],
      {},
    );

  it('没数据时给占位提示', () => {
    render(<RendererSurface dsl={rewardDsl({ data: [] })} />);
    expect(screen.getByText('暂无奖励')).toBeInTheDocument();
  });

  it('三种状态各自的按钮文案与可点性', () => {
    render(<RendererSurface dsl={rewardDsl()} />);
    expect(screen.getByRole('button', { name: '领取' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '未达成' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '已领取' })).toBeDisabled();
  });

  it('点可领取的按钮抛 receive 事件', async () => {
    render(<RendererSurface dsl={rewardDsl()} />);
    fireEvent.click(screen.getByRole('button', { name: '领取' }));
    await waitFor(() => expect(screen.getByText('领取结果：已抛出')).toBeInTheDocument());
  });

  it('未达成的项点了没反应', async () => {
    render(<RendererSurface dsl={rewardDsl()} />);
    fireEvent.click(screen.getByRole('button', { name: '未达成' }));
    await act(async () => {});
    expect(screen.getByText('领取结果：未触发')).toBeInTheDocument();
  });
});

describe('邀请好友', () => {
  const inviteDsl = (props: Record<string, unknown> = {}) =>
    makeDsl(
      {
        inv_1: {
          type: { resolvedName: 'InviteFriend' },
          props: { inviteCode: 'abc123', ...props },
        },
        probe_1: probe('{{ state.rel ? "已建立邀请关系" : "无邀请关系" }}'),
      },
      [
        {
          id: 'e_accept',
          nodeId: 'inv_1',
          trigger: 'onCustom',
          customEvent: 'accept',
          actions: [{ type: 'state.set', key: 'rel', value: '{{ payload.code }}' }],
        },
        {
          id: 'e_copy',
          nodeId: 'inv_1',
          trigger: 'onCustom',
          customEvent: 'copy',
          actions: [{ type: 'state.set', key: 'copiedLink', value: '{{ payload.link }}' }],
        },
      ],
      {},
    );

  it('点邀请弹出弹窗，链接里带上我的邀请码', () => {
    const { container } = render(<RendererSurface dsl={inviteDsl()} />);
    fireEvent.click(screen.getByRole('button', { name: '邀请好友' }));

    const input = container.querySelector('.nca-invite__link') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toContain('inviteCode=abc123');
  });

  it('点复制抛 copy 事件，把链接带给动作', async () => {
    const dsl = inviteDsl();
    dsl.craftJson.probe_1!.props.content = '{{ state.copiedLink ? "已复制" : "未复制" }}';
    render(<RendererSurface dsl={dsl} />);
    fireEvent.click(screen.getByRole('button', { name: '邀请好友' }));
    fireEvent.click(screen.getByRole('button', { name: /复制链接/ }));

    await waitFor(() => expect(screen.getByText('已复制')).toBeInTheDocument());
  });

  it('好友带邀请码进来自动弹窗，接受后建立邀请关系', async () => {
    render(<RendererSurface dsl={inviteDsl({ invitedBy: 'friend999', inviterName: '小明' })} />);

    await waitFor(() => expect(screen.getByText(/小明 邀请你一起参加活动/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '接受邀请' }));

    await waitFor(() => expect(screen.getByText('已建立邀请关系')).toBeInTheDocument());
    expect(screen.getByText('已接受好友邀请')).toBeInTheDocument();
  });

  it('拒绝邀请只关窗，不建立关系', async () => {
    render(<RendererSurface dsl={inviteDsl({ invitedBy: 'friend999' })} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '再逛逛' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '再逛逛' }));
    await act(async () => {});

    expect(screen.getByText('无邀请关系')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '邀请好友' })).toBeInTheDocument();
  });

  it('自己的链接自己点开不会弹接受邀请', async () => {
    render(<RendererSurface dsl={inviteDsl({ invitedBy: 'abc123' })} />);
    await act(async () => {});
    expect(screen.queryByRole('button', { name: '接受邀请' })).not.toBeInTheDocument();
  });
});

describe('邀请记录', () => {
  const INVITES = [
    { id: '1', name: '小明', time: '08-01 10:20', status: '已接受' },
    { id: '2', name: '小红', time: '08-02 19:05', status: '已接受' },
  ];

  const recordDsl = (props: Record<string, unknown> = {}) =>
    makeDsl(
      { rec_1: { type: { resolvedName: 'InviteRecord' }, props: { data: INVITES, ...props } } },
      [],
      {},
    );

  it('渲染每条记录并按列表长度汇总人数', () => {
    render(<RendererSurface dsl={recordDsl()} />);
    expect(screen.getByText('小明')).toBeInTheDocument();
    expect(screen.getByText('已邀请 2 位好友')).toBeInTheDocument();
  });

  it('绑定了总数就以总数为准，分页时列表长度不作数', () => {
    render(<RendererSurface dsl={recordDsl({ total: 27 })} />);
    expect(screen.getByText('已邀请 27 位好友')).toBeInTheDocument();
  });

  it('没人接受邀请时给空态，但汇总还在', () => {
    render(<RendererSurface dsl={recordDsl({ data: [] })} />);
    expect(screen.getByText('还没有好友接受邀请')).toBeInTheDocument();
    expect(screen.getByText('已邀请 0 位好友')).toBeInTheDocument();
  });
});
