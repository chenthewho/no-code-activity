import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { finalDslSchema, type FinalDsl } from '@nca/dsl';
import { RendererSurface } from './RendererSurface';

/** 构造一份与真实发布产物同形状的 DSL */
function makeDsl(overrides: Partial<FinalDsl> = {}): FinalDsl {
  return finalDslSchema.parse({
    schemaVersion: '1.0.0',
    meta: { activityId: 'act_test', title: '七夕抽奖活动' },
    dataSources: [
      {
        id: 'ds_rank',
        type: 'static',
        name: '榜单',
        data: [
          { name: '张三', score: 99 },
          { name: '李四', score: 88 },
        ],
      },
    ],
    craftJson: {
      ROOT: {
        type: { resolvedName: 'Page' },
        isCanvas: true,
        nodes: ['txt_1', 'btn_1', 'rank_1', 'modal_1'],
        props: { backgroundColor: '#fff5f5' },
      },
      txt_1: {
        type: { resolvedName: 'Text' },
        props: { content: '共 {{ dataSource.ds_rank.length }} 人上榜' },
      },
      btn_1: { type: { resolvedName: 'Button' }, props: { text: '立即抽奖' } },
      rank_1: {
        type: { resolvedName: 'RankList' },
        props: { data: '{{ dataSource.ds_rank }}', showAvatar: false },
      },
      modal_1: {
        type: { resolvedName: 'Modal' },
        isCanvas: true,
        nodes: ['modal_txt'],
        props: { width: 600 },
      },
      modal_txt: { type: { resolvedName: 'Text' }, props: { content: '恭喜中奖' } },
    },
    events: [
      {
        id: 'e1',
        nodeId: 'btn_1',
        trigger: 'onClick',
        actions: [{ type: 'modal.open', modalId: 'modal_1' }],
      },
    ],
    assets: [],
    initialState: { joined: false },
    ...overrides,
  });
}

describe('RendererSurface', () => {
  it('按 DSL 递归渲染出节点树', () => {
    render(<RendererSurface dsl={makeDsl()} />);
    expect(screen.getByText('立即抽奖')).toBeInTheDocument();
  });

  it('解析 props 中的表达式绑定', () => {
    render(<RendererSurface dsl={makeDsl()} />);
    // {{ dataSource.ds_rank.length }} 求值为 2
    expect(screen.getByText('共 2 人上榜')).toBeInTheDocument();
  });

  it('整串绑定保留数组类型，榜单据此渲染出每一行', () => {
    render(<RendererSurface dsl={makeDsl()} />);
    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.getByText('李四')).toBeInTheDocument();
    expect(screen.getByText('99')).toBeInTheDocument();
  });

  it('弹窗默认不渲染，点击按钮触发 modal.open 后出现', async () => {
    render(<RendererSurface dsl={makeDsl()} />);
    expect(screen.queryByText('恭喜中奖')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('立即抽奖'));

    await waitFor(() => expect(screen.getByText('恭喜中奖')).toBeInTheDocument());
  });

  it('关闭按钮收起弹窗', async () => {
    render(<RendererSurface dsl={makeDsl()} />);
    fireEvent.click(screen.getByText('立即抽奖'));
    await waitFor(() => expect(screen.getByText('恭喜中奖')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('关闭'));
    await waitFor(() => expect(screen.queryByText('恭喜中奖')).not.toBeInTheDocument());
  });

  it('condition 为假时整棵子树不渲染', () => {
    const dsl = makeDsl();
    dsl.craftJson.txt_1!.control = { if: '{{ state.joined }}' };
    render(<RendererSurface dsl={dsl} />);
    expect(screen.queryByText('共 2 人上榜')).not.toBeInTheDocument();
  });

  it('loop 按数据源展开子树，item 别名在作用域内可用', () => {
    const dsl = makeDsl();
    dsl.craftJson.ROOT!.nodes = ['txt_loop'];
    dsl.craftJson.txt_loop = {
      type: { resolvedName: 'Text' },
      isCanvas: false,
      props: { content: '{{ item.name }} 得 {{ item.score }} 分' },
      custom: {},
      hidden: false,
      nodes: [],
      linkedNodes: {},
      control: { loop: { source: '{{ dataSource.ds_rank }}', itemAlias: 'item', indexAlias: 'index' } },
    };
    render(<RendererSurface dsl={dsl} />);
    expect(screen.getByText('张三 得 99 分')).toBeInTheDocument();
    expect(screen.getByText('李四 得 88 分')).toBeInTheDocument();
  });

  it('state.set 动作改变页面状态并驱动重渲染', async () => {
    const dsl = makeDsl();
    dsl.craftJson.txt_1!.props = { content: '{{ state.joined ? "已参与" : "未参与" }}' };
    dsl.events = [
      {
        id: 'e1',
        nodeId: 'btn_1',
        trigger: 'onClick',
        actions: [{ type: 'state.set', key: 'joined', value: true }],
      },
    ];
    render(<RendererSurface dsl={dsl} />);
    expect(screen.getByText('未参与')).toBeInTheDocument();

    fireEvent.click(screen.getByText('立即抽奖'));
    await waitFor(() => expect(screen.getByText('已参与')).toBeInTheDocument());
  });

  it('toast 动作弹出提示', async () => {
    const dsl = makeDsl();
    dsl.events = [
      {
        id: 'e1',
        nodeId: 'btn_1',
        trigger: 'onClick',
        actions: [{ type: 'toast', message: '活动尚未开始', level: 'warning', duration: 2000 }],
      },
    ];
    render(<RendererSurface dsl={dsl} />);
    fireEvent.click(screen.getByText('立即抽奖'));
    await waitFor(() => expect(screen.getByText('活动尚未开始')).toBeInTheDocument());
  });

  it('未注册物料只坏掉该节点，页面其余部分照常渲染', () => {
    const dsl = makeDsl();
    dsl.craftJson.ROOT!.nodes = ['btn_1', 'ghost'];
    dsl.craftJson.ghost = {
      type: { resolvedName: 'NotExist' },
      isCanvas: false,
      props: {},
      custom: {},
      hidden: false,
      nodes: [],
      linkedNodes: {},
    };
    render(<RendererSurface dsl={dsl} />);
    expect(screen.getByText('立即抽奖')).toBeInTheDocument();
  });

  it('编辑态下弹窗平铺展示，便于在画布里直接编辑', async () => {
    render(<RendererSurface dsl={makeDsl()} editing />);
    // 编辑态无需点击就能看到弹窗内容
    await act(async () => {});
    expect(screen.getByText('恭喜中奖')).toBeInTheDocument();
    expect(screen.getByText(/编辑态平铺展示/)).toBeInTheDocument();
  });
});
