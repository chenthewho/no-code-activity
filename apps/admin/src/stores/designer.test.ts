import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDsl } from '@nca/dsl';
import { ROOT_NODE_ID } from '@nca/shared';
import { useDesignerStore } from './designer';

const store = () => useDesignerStore.getState();

beforeEach(() => {
  store().load(createEmptyDsl('act_1', '测试活动'));
});

describe('addNode', () => {
  it('新节点挂到根下并自动选中', () => {
    store().addNode('Text', { content: '你好' });
    const { dsl, selectedId } = store();

    expect(selectedId).toBeTruthy();
    expect(dsl.craftJson[ROOT_NODE_ID]!.nodes).toEqual([selectedId]);
    expect(dsl.craftJson[selectedId!]!.props.content).toBe('你好');
  });

  it('选中容器时新节点放进容器内', () => {
    store().addNode('Container', {});
    const containerId = store().selectedId!;
    // Container 物料的 isCanvas 由画布层设置，这里显式模拟容器语义
    useDesignerStore.setState((s) => ({
      dsl: {
        ...s.dsl,
        craftJson: {
          ...s.dsl.craftJson,
          [containerId]: { ...s.dsl.craftJson[containerId]!, isCanvas: true },
        },
      },
    }));

    store().addNode('Text', {});
    const textId = store().selectedId!;

    expect(store().dsl.craftJson[containerId]!.nodes).toContain(textId);
    expect(store().dsl.craftJson[ROOT_NODE_ID]!.nodes).not.toContain(textId);
  });
});

describe('removeNode', () => {
  it('连子树一起删除，不留孤儿节点', () => {
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
    store().addNode('Text', {});
    const childId = store().selectedId!;

    store().removeNode(containerId);

    expect(store().dsl.craftJson[containerId]).toBeUndefined();
    expect(store().dsl.craftJson[childId]).toBeUndefined();
    expect(store().dsl.craftJson[ROOT_NODE_ID]!.nodes).not.toContain(containerId);
  });

  it('同时清理指向被删节点的事件绑定', () => {
    store().addNode('Button', {});
    const buttonId = store().selectedId!;
    useDesignerStore.setState((s) => ({
      dsl: {
        ...s.dsl,
        events: [{ id: 'e1', nodeId: buttonId, trigger: 'onClick', actions: [] }],
      },
    }));

    store().removeNode(buttonId);

    expect(store().dsl.events).toHaveLength(0);
  });

  it('拒绝删除根节点', () => {
    store().removeNode(ROOT_NODE_ID);
    expect(store().dsl.craftJson[ROOT_NODE_ID]).toBeDefined();
  });
});

describe('moveNode', () => {
  it('在兄弟节点间交换顺序', () => {
    store().addNode('Text', {});
    const first = store().selectedId!;
    store().select(null);
    store().addNode('Button', {});
    const second = store().selectedId!;

    expect(store().dsl.craftJson[ROOT_NODE_ID]!.nodes).toEqual([first, second]);

    store().moveNode(second, -1);
    expect(store().dsl.craftJson[ROOT_NODE_ID]!.nodes).toEqual([second, first]);
  });

  it('越界移动不改变顺序', () => {
    store().addNode('Text', {});
    const only = store().selectedId!;
    store().moveNode(only, -1);
    expect(store().dsl.craftJson[ROOT_NODE_ID]!.nodes).toEqual([only]);
  });
});

describe('撤销 / 重做', () => {
  it('撤销回到上一步，重做再前进', () => {
    store().addNode('Text', {});
    const nodeId = store().selectedId!;
    expect(Object.keys(store().dsl.craftJson)).toHaveLength(2);

    store().undo();
    expect(store().dsl.craftJson[nodeId]).toBeUndefined();

    store().redo();
    expect(store().dsl.craftJson[nodeId]).toBeDefined();
  });

  it('新操作会清空重做栈', () => {
    store().addNode('Text', {});
    store().undo();
    expect(store().future).toHaveLength(1);

    store().addNode('Button', {});
    expect(store().future).toHaveLength(0);
  });

  it('空栈时撤销重做是安全的空操作', () => {
    const before = store().dsl;
    store().undo();
    store().redo();
    expect(store().dsl).toBe(before);
  });

  it('load 会重置历史，防止跨活动误撤销', () => {
    store().addNode('Text', {});
    expect(store().past.length).toBeGreaterThan(0);

    store().load(createEmptyDsl('act_2', '另一个活动'));
    expect(store().past).toHaveLength(0);
    expect(store().future).toHaveLength(0);
    expect(store().dirty).toBe(false);
  });
});

describe('dirty 标记', () => {
  it('改动后置脏，保存后清除', () => {
    expect(store().dirty).toBe(false);
    store().addNode('Text', {});
    expect(store().dirty).toBe(true);

    store().markSaved();
    expect(store().dirty).toBe(false);
  });
});
