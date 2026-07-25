import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDsl } from '@nca/dsl';
import { ROOT_NODE_ID } from '@nca/shared';
import { useDesignerStore } from './designer';
import { createAction } from '../components/designer/action-schema';

const store = () => useDesignerStore.getState();

beforeEach(() => {
  store().load(createEmptyDsl('act_1', '测试活动'));
});

function addButton(): string {
  store().addNode('Button', { text: '抽奖' });
  return store().selectedId!;
}

describe('事件编排', () => {
  it('绑定触发器后可追加动作', () => {
    const nodeId = addButton();
    store().addEvent(nodeId, 'onClick');
    const eventId = store().dsl.events[0]!.id;

    store().addAction(eventId, createAction('toast'));
    store().addAction(eventId, createAction('modal.open'));

    const actions = store().dsl.events[0]!.actions;
    expect(actions).toHaveLength(2);
    expect(actions[0]!.type).toBe('toast');
    expect(actions[1]!.type).toBe('modal.open');
  });

  it('动作按声明顺序排列，可上下调整', () => {
    const nodeId = addButton();
    store().addEvent(nodeId, 'onClick');
    const eventId = store().dsl.events[0]!.id;
    store().addAction(eventId, createAction('toast'));
    store().addAction(eventId, createAction('navigate'));

    store().moveAction(eventId, 1, -1);
    expect(store().dsl.events[0]!.actions.map((a) => a.type)).toEqual(['navigate', 'toast']);
  });

  it('越界移动动作不改变顺序', () => {
    const nodeId = addButton();
    store().addEvent(nodeId, 'onClick');
    const eventId = store().dsl.events[0]!.id;
    store().addAction(eventId, createAction('toast'));

    store().moveAction(eventId, 0, -1);
    expect(store().dsl.events[0]!.actions).toHaveLength(1);
  });

  it('更新动作字段', () => {
    const nodeId = addButton();
    store().addEvent(nodeId, 'onClick');
    const eventId = store().dsl.events[0]!.id;
    store().addAction(eventId, createAction('toast'));

    store().updateAction(eventId, 0, { message: '活动尚未开始' });
    const action = store().dsl.events[0]!.actions[0]!;
    expect(action.type === 'toast' && action.message).toBe('活动尚未开始');
  });

  it('createAction 带出该动作的默认值', () => {
    const toast = createAction('toast');
    expect(toast.type === 'toast' && toast.level).toBe('info');
    expect(toast.type === 'toast' && toast.duration).toBe(2000);
  });
});

describe('数据源', () => {
  it('新增与更新数据源', () => {
    store().addDataSource({ id: 'ds_rank', name: '榜单', type: 'static', data: [] });
    expect(store().dsl.dataSources).toHaveLength(1);

    store().updateDataSource('ds_rank', { name: '实时榜单' });
    expect(store().dsl.dataSources[0]!.name).toBe('实时榜单');
  });

  it('id 重复时不重复添加', () => {
    store().addDataSource({ id: 'ds_a', name: 'A', type: 'static', data: [] });
    store().addDataSource({ id: 'ds_a', name: 'B', type: 'static', data: [] });
    expect(store().dsl.dataSources).toHaveLength(1);
  });

  it('删除数据源时一并摘掉引用它的刷新动作', () => {
    const nodeId = addButton();
    store().addDataSource({ id: 'ds_rank', name: '榜单', type: 'static', data: [] });
    store().addEvent(nodeId, 'onClick');
    const eventId = store().dsl.events[0]!.id;
    store().addAction(eventId, { type: 'dataSource.refresh', dataSourceId: 'ds_rank' });
    store().addAction(eventId, createAction('toast'));

    store().removeDataSource('ds_rank');

    expect(store().dsl.dataSources).toHaveLength(0);
    // 只摘掉引用它的那条，其它动作保留
    expect(store().dsl.events[0]!.actions.map((a) => a.type)).toEqual(['toast']);
  });
});

describe('结构容器', () => {
  it('设置与清除 control', () => {
    const nodeId = addButton();
    store().updateControl(nodeId, { if: '{{ state.joined }}' });
    expect(store().dsl.craftJson[nodeId]!.control?.if).toBe('{{ state.joined }}');

    store().updateControl(nodeId, undefined);
    expect(store().dsl.craftJson[nodeId]!.control).toBeUndefined();
  });

  it('配置列表渲染', () => {
    const nodeId = addButton();
    store().updateControl(nodeId, {
      loop: { source: '{{ dataSource.rank }}', itemAlias: 'row', indexAlias: 'i' },
    });
    expect(store().dsl.craftJson[nodeId]!.control?.loop?.itemAlias).toBe('row');
  });
});

describe('拖拽落点 relocateNode', () => {
  function buildTree() {
    store().addNode('Container', {});
    const containerId = store().selectedId!;
    useDesignerStore.setState((s) => ({
      dsl: {
        ...s.dsl,
        craftJson: {
          ...s.dsl.craftJson,
          [containerId]: { ...s.dsl.craftJson[containerId]!, isCanvas: true },
        },
      },
    }));
    store().select(null);
    store().addNode('Text', {});
    const textId = store().selectedId!;
    return { containerId, textId };
  }

  it('把节点移进容器', () => {
    const { containerId, textId } = buildTree();
    store().relocateNode(textId, containerId, 0);

    expect(store().dsl.craftJson[containerId]!.nodes).toEqual([textId]);
    expect(store().dsl.craftJson[ROOT_NODE_ID]!.nodes).toEqual([containerId]);
    expect(store().dsl.craftJson[textId]!.parent).toBe(containerId);
  });

  it('同容器内往后移动时下标不会差一位', () => {
    store().addNode('Text', {});
    const a = store().selectedId!;
    store().select(null);
    store().addNode('Button', {});
    const b = store().selectedId!;
    store().select(null);
    store().addNode('Image', {});
    const c = store().selectedId!;
    expect(store().dsl.craftJson[ROOT_NODE_ID]!.nodes).toEqual([a, b, c]);

    // 把第一个拖到末尾
    store().relocateNode(a, ROOT_NODE_ID, 3);
    expect(store().dsl.craftJson[ROOT_NODE_ID]!.nodes).toEqual([b, c, a]);
  });

  it('拒绝把容器拖进自己的子树，避免节点树脱环', () => {
    const { containerId, textId } = buildTree();
    store().relocateNode(textId, containerId, 0);

    const before = store().dsl.craftJson;
    store().relocateNode(containerId, textId, 0);
    expect(store().dsl.craftJson).toBe(before);
  });

  it('insertNode 按下标插入新节点', () => {
    store().addNode('Text', {});
    const first = store().selectedId!;

    store().insertNode('Button', { text: '按钮' }, ROOT_NODE_ID, 0);
    const inserted = store().selectedId!;

    expect(store().dsl.craftJson[ROOT_NODE_ID]!.nodes).toEqual([inserted, first]);
  });
});
