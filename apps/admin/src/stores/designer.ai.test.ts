import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDsl } from '@nca/dsl';
import { useDesignerStore } from './designer';

/**
 * AI 产物落画布必须走 applyDsl 而不是 load。
 *
 * load 会清空撤销栈并把 dirty 置回 false，于是一次 AI 生成既撤销不了，
 * 也不会触发 1.5s 防抖自动保存——运营刷新一下页面，生成的东西就没了。
 * 这两条正是这里要钉死的。
 */
describe('applyDsl', () => {
  beforeEach(() => {
    useDesignerStore.getState().load(createEmptyDsl('act_1', '原始活动'));
  });

  const withNode = () => {
    const base = createEmptyDsl('act_1', 'AI 生成的活动');
    base.craftJson.txt_1 = {
      type: { resolvedName: 'Text' },
      isCanvas: false,
      props: { content: 'AI 写的' },
      custom: {},
      hidden: false,
      nodes: [],
      linkedNodes: {},
      parent: 'ROOT',
    };
    base.craftJson.ROOT!.nodes = ['txt_1'];
    return base;
  };

  it('保留撤销栈，一次生成 = 一步撤销', () => {
    const store = useDesignerStore.getState();
    expect(store.past).toHaveLength(0);

    store.applyDsl(withNode());
    expect(useDesignerStore.getState().dsl.meta.title).toBe('AI 生成的活动');
    expect(useDesignerStore.getState().past).toHaveLength(1);

    useDesignerStore.getState().undo();
    expect(useDesignerStore.getState().dsl.meta.title).toBe('原始活动');
    expect(useDesignerStore.getState().dsl.craftJson.txt_1).toBeUndefined();
  });

  it('置脏，从而进入自动保存', () => {
    expect(useDesignerStore.getState().dirty).toBe(false);
    useDesignerStore.getState().applyDsl(withNode());
    expect(useDesignerStore.getState().dirty).toBe(true);
  });

  it('对照 load：它会清栈并置回未修改，所以 AI 不能用它', () => {
    useDesignerStore.getState().applyDsl(withNode());
    expect(useDesignerStore.getState().past).toHaveLength(1);

    useDesignerStore.getState().load(createEmptyDsl('act_1', '换一份'));
    expect(useDesignerStore.getState().past).toHaveLength(0);
    expect(useDesignerStore.getState().dirty).toBe(false);
  });

  it('清空重做栈：撤销后又应用了新产物，就不该还能重做回旧的那条线', () => {
    const store = useDesignerStore.getState();
    store.applyDsl(withNode());
    useDesignerStore.getState().undo();
    expect(useDesignerStore.getState().future).toHaveLength(1);

    useDesignerStore.getState().applyDsl(createEmptyDsl('act_1', '另一版'));
    expect(useDesignerStore.getState().future).toHaveLength(0);
  });
});
