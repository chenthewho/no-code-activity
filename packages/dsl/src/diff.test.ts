import { describe, expect, it } from 'vitest';
import { createEmptyDsl } from './factory';
import { diffDsl } from './diff';
import type { FinalDsl } from './schema/dsl';

function base(): FinalDsl {
  const dsl = createEmptyDsl('act_1', '活动');
  dsl.craftJson.ROOT!.nodes = ['title', 'btn'];
  dsl.craftJson.title = {
    type: { resolvedName: 'Text' },
    isCanvas: false,
    props: { content: '旧标题', style: { color: '#000', fontSize: 28 } },
    custom: {},
    hidden: false,
    nodes: [],
    linkedNodes: {},
    parent: 'ROOT',
  };
  dsl.craftJson.btn = {
    type: { resolvedName: 'Button' },
    isCanvas: false,
    displayName: '抽奖按钮',
    props: { text: '抽奖' },
    custom: {},
    hidden: false,
    nodes: [],
    linkedNodes: {},
    parent: 'ROOT',
  };
  dsl.events = [{ id: 'e1', nodeId: 'btn', trigger: 'onClick', actions: [{ type: 'toast', message: 'hi', level: 'info', duration: 2000 }] }];
  return dsl;
}

const clone = (dsl: FinalDsl): FinalDsl => JSON.parse(JSON.stringify(dsl)) as FinalDsl;

describe('diffDsl', () => {
  it('同样的内容（对象键顺序不同、活动 id 不同）视为没有改动', () => {
    const a = base();
    const b = clone(a);
    b.meta.activityId = 'act_copy';
    b.craftJson.title!.props = { style: { fontSize: 28, color: '#000' }, content: '旧标题' };
    // 老节点没写物料版本，设计器打开时补上基线版本号，也不算改动
    b.craftJson.btn!.type.version = '1.0.0';
    expect(diffDsl(a, b).empty).toBe(true);
    b.craftJson.btn!.type.version = '1.2.0';
    expect(diffDsl(a, b).nodes.changed[0]?.other).toEqual(['物料版本 1.0.0 → 1.2.0']);
  });

  it('组件的新增、删除、显隐', () => {
    const a = base();
    const b = clone(a);
    b.craftJson.title!.props.content = '新标题';
    (b.craftJson.title!.props.style as Record<string, unknown>).color = '#f00';
    b.craftJson.ROOT!.nodes = ['btn', 'img'];
    delete b.craftJson.title;
    b.craftJson.img = { ...clone(a).craftJson.title!, type: { resolvedName: 'Image' }, props: { src: '/a.png' } };
    b.craftJson.btn!.hidden = true;

    const diff = diffDsl(a, b);
    expect(diff.nodes.added).toEqual([{ id: 'img', material: 'Image', label: 'Image' }]);
    expect(diff.nodes.removed).toEqual([{ id: 'title', material: 'Text', label: 'Text' }]);
    expect(diff.nodes.changed).toEqual([
      // 前面的标题删掉了，按钮下标变了但相对顺序没变，不算挪位置
      expect.objectContaining({ id: 'btn', label: '抽奖按钮', moved: false, other: ['隐藏'], props: [] }),
    ]);
    expect(diff.empty).toBe(false);
  });

  it('挪位置：只报真正换了顺序或换了容器的组件，前面插入新组件不连累后面的兄弟', () => {
    const a = base();
    a.craftJson.ROOT!.nodes = ['title', 'btn', 'x', 'y'];
    for (const id of ['x', 'y', 'z']) a.craftJson[id] = { ...clone(a).craftJson.title!, props: { content: id } };
    delete a.craftJson.z;

    const inserted = clone(a);
    inserted.craftJson.z = { ...clone(a).craftJson.title!, props: { content: 'z' } };
    inserted.craftJson.ROOT!.nodes = ['z', 'title', 'btn', 'x', 'y'];
    expect(diffDsl(a, inserted).nodes.changed).toEqual([]);

    const reordered = clone(a);
    reordered.craftJson.ROOT!.nodes = ['btn', 'x', 'y', 'title'];
    expect(diffDsl(a, reordered).nodes.changed.map((n) => n.id)).toEqual(['title']);

    const reparented = clone(a);
    reparented.craftJson.ROOT!.nodes = ['title', 'x', 'y'];
    reparented.craftJson.x!.isCanvas = true;
    reparented.craftJson.x!.nodes = ['btn'];
    reparented.craftJson.btn!.parent = 'x';
    const changes = diffDsl(a, reparented).nodes.changed;
    expect(changes.find((n) => n.id === 'btn')?.moved).toBe(true);
    expect(changes.find((n) => n.id === 'y')).toBeUndefined();
  });

  it('属性改动精确到路径，列表整体比较', () => {
    const a = base();
    const b = clone(a);
    b.craftJson.title!.props.content = '新标题';
    (b.craftJson.title!.props.style as Record<string, unknown>).color = '#f00';
    const change = diffDsl(a, b).nodes.changed[0]!;
    expect(change.props).toEqual([
      { path: 'content', from: '旧标题', to: '新标题' },
      { path: 'style.color', from: '#000', to: '#f00' },
    ]);
    expect(change.moved).toBe(false);
  });

  it('事件绑定、数据源、页面设置与初始状态', () => {
    const a = base();
    const b = clone(a);
    b.events[0]!.actions = [];
    b.events.push({ id: 'e2', nodeId: 'title', trigger: 'onClick', actions: [] });
    b.dataSources = [{ id: 'ds_rank', name: '榜单', type: 'static', data: [] }] as FinalDsl['dataSources'];
    b.meta.share = { title: '快来' };
    b.meta.auth = { required: false, loginMode: 'sso' };
    b.initialState = { joined: false };

    const diff = diffDsl(a, b);
    expect(diff.events).toEqual({ added: ['e2'], removed: [], changed: ['e1'] });
    expect(diff.dataSources.added).toEqual(['ds_rank']);
    expect(diff.meta.map((m) => m.path)).toEqual(['auth.loginMode', 'share.title']);
    expect(diff.initialState).toEqual([{ path: 'joined', from: undefined, to: false }]);
  });
});
