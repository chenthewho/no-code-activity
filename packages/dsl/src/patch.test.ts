import { describe, expect, it } from 'vitest';
import { ROOT_NODE_ID } from '@nca/shared';
import { createEmptyDsl } from './factory';
import { applyPatches, dslPatchSchema, type DslPatch } from './patch';
import { validateFinalDsl } from './validate';
import type { FinalDsl } from './schema/dsl';

const MATERIALS = [
  'Page',
  'Container',
  'Text',
  'Image',
  'Button',
  'Modal',
  'Countdown',
  'Swiper',
  'RankList',
  'Lottery',
  'Login',
  'BindRole',
];
const CONTAINERS = ['Page', 'Container', 'Modal'];

/** 走一遍 schema，顺带验证协议本身收不收这条补丁 */
function parse(raw: unknown[]): DslPatch[] {
  return raw.map((item) => dslPatchSchema.parse(item));
}

let seq = 0;
function apply(dsl: FinalDsl, raw: unknown[]) {
  seq = 0;
  return applyPatches(dsl, parse(raw), {
    knownMaterials: MATERIALS,
    containerMaterials: CONTAINERS,
    // 固定 id，断言才能写死
    createNodeId: (material) => `${material.toLowerCase()}_${++seq}`,
  });
}

const base = (): FinalDsl => createEmptyDsl('act_1', '测试活动');

describe('补丁协议 · 新建与定位', () => {
  it('@ref 换成真实 id，父子关系两边都写上', () => {
    const { dsl, refs, applied, issues } = apply(base(), [
      {
        op: 'addNode',
        ref: '@title',
        material: 'Text',
        props: { content: '标题' },
        position: { mode: 'appendTo', target: ROOT_NODE_ID },
      },
    ]);

    expect(applied).toBe(1);
    expect(issues).toEqual([]);
    expect(refs['@title']).toBe('text_1');
    expect(dsl.craftJson.ROOT!.nodes).toEqual(['text_1']);
    expect(dsl.craftJson.text_1!.parent).toBe(ROOT_NODE_ID);
    expect(dsl.craftJson.text_1!.props.content).toBe('标题');
  });

  it('before / after 按声明插到锚点前后，而不是一律追加到末尾', () => {
    const { dsl } = apply(base(), [
      {
        op: 'addNode',
        ref: '@a',
        material: 'Text',
        position: { mode: 'appendTo', target: 'ROOT' },
      },
      { op: 'addNode', ref: '@b', material: 'Text', position: { mode: 'after', target: '@a' } },
      { op: 'addNode', ref: '@c', material: 'Text', position: { mode: 'before', target: '@a' } },
      {
        op: 'addNode',
        ref: '@d',
        material: 'Text',
        position: { mode: 'prependTo', target: 'ROOT' },
      },
    ]);

    // d 最前，然后 c、a、b
    expect(dsl.craftJson.ROOT!.nodes).toEqual(['text_4', 'text_3', 'text_1', 'text_2']);
  });

  it('后续补丁能用 @ref 指到前面新建的节点', () => {
    const { dsl, refs } = apply(base(), [
      {
        op: 'addNode',
        ref: '@box',
        material: 'Container',
        position: { mode: 'appendTo', target: 'ROOT' },
      },
      {
        op: 'addNode',
        ref: '@btn',
        material: 'Button',
        position: { mode: 'appendTo', target: '@box' },
      },
    ]);

    expect(dsl.craftJson[refs['@btn']!]!.parent).toBe(refs['@box']);
    expect(dsl.craftJson[refs['@box']!]!.nodes).toEqual([refs['@btn']]);
  });

  it('动作里引用弹窗也走 @ref，落库时已是真实 id', () => {
    const { dsl, refs } = apply(base(), [
      {
        op: 'addNode',
        ref: '@win',
        material: 'Modal',
        position: { mode: 'appendTo', target: 'ROOT' },
      },
      {
        op: 'addNode',
        ref: '@btn',
        material: 'Button',
        position: { mode: 'appendTo', target: 'ROOT' },
      },
      {
        op: 'bindEvent',
        target: '@btn',
        trigger: 'onClick',
        actions: [{ type: 'modal.open', modalId: '@win' }],
      },
    ]);

    const action = dsl.events[0]!.actions[0] as { modalId: string };
    expect(action.modalId).toBe(refs['@win']);
    expect(action.modalId).not.toContain('@');
  });
});

describe('补丁协议 · 拦截模型的常见错法', () => {
  it('编出来的物料直接拒掉', () => {
    const { applied, issues, dsl } = apply(base(), [
      {
        op: 'addNode',
        ref: '@x',
        material: 'Carousel3D',
        position: { mode: 'appendTo', target: 'ROOT' },
      },
    ]);
    expect(applied).toBe(0);
    expect(issues[0]!.message).toContain('未注册的物料');
    expect(Object.keys(dsl.craftJson)).toEqual([ROOT_NODE_ID]);
  });

  it('不允许在 ROOT 之外再造一个 Page', () => {
    const { applied, issues } = apply(base(), [
      {
        op: 'addNode',
        ref: '@p',
        material: 'Page',
        position: { mode: 'appendTo', target: 'ROOT' },
      },
    ]);
    expect(applied).toBe(0);
    expect(issues[0]!.message).toContain('Page 只能是根节点');
  });

  it('往非容器里塞子节点会被拦下，且不留半截节点', () => {
    const { dsl, applied, issues } = apply(base(), [
      {
        op: 'addNode',
        ref: '@t',
        material: 'Text',
        position: { mode: 'appendTo', target: 'ROOT' },
      },
      {
        op: 'addNode',
        ref: '@b',
        material: 'Button',
        position: { mode: 'appendTo', target: '@t' },
      },
    ]);

    expect(applied).toBe(1);
    expect(issues[0]!.message).toContain('不能容纳子节点');
    // 失败的那个节点必须回滚掉，否则就是一个从 ROOT 到不了的孤儿
    expect(Object.keys(dsl.craftJson).sort()).toEqual([ROOT_NODE_ID, 'text_1']);
  });

  it('根节点不能删也不能移', () => {
    const { applied, issues } = apply(base(), [
      { op: 'removeNode', target: 'ROOT' },
      { op: 'moveNode', target: 'ROOT', position: { mode: 'appendTo', target: 'ROOT' } },
    ]);
    expect(applied).toBe(0);
    expect(issues).toHaveLength(2);
  });

  it('不能把节点移进自己的子树，否则整棵树会从 ROOT 上掉下来', () => {
    const { dsl, issues } = apply(base(), [
      {
        op: 'addNode',
        ref: '@outer',
        material: 'Container',
        position: { mode: 'appendTo', target: 'ROOT' },
      },
      {
        op: 'addNode',
        ref: '@inner',
        material: 'Container',
        position: { mode: 'appendTo', target: '@outer' },
      },
      { op: 'moveNode', target: '@outer', position: { mode: 'appendTo', target: '@inner' } },
    ]);

    expect(issues.some((i) => i.message.includes('自己的子树'))).toBe(true);
    expect(dsl.craftJson.ROOT!.nodes).toEqual(['container_1']);
  });

  it('onCustom 不给事件名就拒掉——写了也永远触发不了', () => {
    const { applied, issues } = apply(base(), [
      {
        op: 'addNode',
        ref: '@l',
        material: 'Lottery',
        position: { mode: 'appendTo', target: 'ROOT' },
      },
      { op: 'bindEvent', target: '@l', trigger: 'onCustom', actions: [] },
    ]);
    expect(applied).toBe(1);
    expect(issues[0]!.message).toContain('onCustom');
  });

  it('数据源 id 撞车要报出来，不能默默覆盖', () => {
    const ds = { id: 'ds_a', name: '接口', type: 'http', url: '/api/a' };
    const { dsl, issues } = apply(base(), [
      { op: 'addDataSource', dataSource: ds },
      { op: 'addDataSource', dataSource: { ...ds, name: '另一个' } },
    ]);
    expect(dsl.dataSources).toHaveLength(1);
    expect(issues[0]!.message).toContain('重复');
  });

  it('一条补丁错了不牵连其余，但依赖它的会一起跳过', () => {
    const { dsl, applied, issues } = apply(base(), [
      {
        op: 'addNode',
        ref: '@ok',
        material: 'Text',
        position: { mode: 'appendTo', target: 'ROOT' },
      },
      // 锚点不存在 → 跳过，@bad never resolves
      {
        op: 'addNode',
        ref: '@bad',
        material: 'Text',
        position: { mode: 'appendTo', target: 'no_such' },
      },
      { op: 'updateProps', target: '@bad', props: { content: 'x' } },
      { op: 'updateProps', target: '@ok', props: { content: '照常生效' } },
    ]);

    expect(applied).toBe(2);
    expect(issues).toHaveLength(2);
    expect(dsl.craftJson.text_1!.props.content).toBe('照常生效');
  });
});

describe('补丁协议 · 删除要清干净', () => {
  it('删节点连子树、事件绑定、指向它的动作一起清', () => {
    const { dsl } = apply(base(), [
      {
        op: 'addNode',
        ref: '@box',
        material: 'Container',
        position: { mode: 'appendTo', target: 'ROOT' },
      },
      {
        op: 'addNode',
        ref: '@inner',
        material: 'Text',
        position: { mode: 'appendTo', target: '@box' },
      },
      {
        op: 'addNode',
        ref: '@win',
        material: 'Modal',
        position: { mode: 'appendTo', target: 'ROOT' },
      },
      {
        op: 'addNode',
        ref: '@btn',
        material: 'Button',
        position: { mode: 'appendTo', target: 'ROOT' },
      },
      { op: 'bindEvent', target: '@inner', trigger: 'onClick', actions: [] },
      {
        op: 'bindEvent',
        target: '@btn',
        trigger: 'onClick',
        actions: [{ type: 'modal.open', modalId: '@win' }],
      },
      { op: 'removeNode', target: '@box' },
      { op: 'removeNode', target: '@win' },
    ]);

    // 子树没了
    expect(dsl.craftJson.container_1).toBeUndefined();
    expect(dsl.craftJson.text_2).toBeUndefined();
    // 绑在被删节点上的事件没了
    expect(dsl.events.some((e) => e.nodeId === 'container_1' || e.nodeId === 'text_2')).toBe(false);
    // 指向被删弹窗的动作没了，但事件本身还在
    const btnEvent = dsl.events.find((e) => e.nodeId === 'button_4');
    expect(btnEvent).toBeDefined();
    expect(btnEvent!.actions).toEqual([]);
    // 没有悬空引用
    expect(validateFinalDsl(dsl, { knownMaterials: MATERIALS }).success).toBe(true);
  });
});

describe('补丁协议 · 与既有校验器对齐', () => {
  it('不修改传入的 DSL', () => {
    const original = base();
    const snapshot = JSON.stringify(original);
    apply(original, [
      {
        op: 'addNode',
        ref: '@t',
        material: 'Text',
        position: { mode: 'appendTo', target: 'ROOT' },
      },
    ]);
    expect(JSON.stringify(original)).toBe(snapshot);
  });

  it('一整套抽奖闭环补丁跑完，产物能过发布级校验', () => {
    const { dsl, applied } = apply(base(), [
      {
        op: 'addDataSource',
        dataSource: { id: 'ds_prizes', name: '奖品', type: 'http', url: '/api/prizes' },
      },
      {
        op: 'addDataSource',
        dataSource: {
          id: 'ds_draw',
          name: '抽奖',
          type: 'http',
          url: '/api/draw',
          method: 'POST',
          autoLoad: false,
        },
      },
      { op: 'setInitialState', state: { prizeIndex: -1 } },
      {
        op: 'addNode',
        ref: '@lot',
        material: 'Lottery',
        props: { prizes: '{{ dataSource.ds_prizes }}', resultIndex: '{{ state.prizeIndex }}' },
        position: { mode: 'appendTo', target: 'ROOT' },
      },
      {
        op: 'addNode',
        ref: '@win',
        material: 'Modal',
        position: { mode: 'appendTo', target: 'ROOT' },
      },
      {
        op: 'bindEvent',
        target: '@lot',
        trigger: 'onCustom',
        customEvent: 'draw',
        actions: [
          { type: 'state.set', key: 'prizeIndex', value: -1 },
          { type: 'dataSource.refresh', dataSourceId: 'ds_draw' },
          { type: 'state.set', key: 'prizeIndex', value: '{{ dataSource.ds_draw.index }}' },
        ],
      },
      {
        op: 'bindEvent',
        target: '@lot',
        trigger: 'onCustom',
        customEvent: 'finish',
        actions: [{ type: 'modal.open', modalId: '@win' }],
      },
    ]);

    expect(applied).toBe(7);
    const result = validateFinalDsl(dsl, { knownMaterials: MATERIALS, mode: 'publish' });
    expect(result.success).toBe(true);
  });
});

describe('补丁协议 · 物料版本', () => {
  it('新建节点记下物料当前版本，没登记版本的物料不写', () => {
    const { dsl } = applyPatches(
      base(),
      parse([
        { op: 'addNode', ref: '@a', material: 'Lottery', props: {}, position: { mode: 'appendTo', target: ROOT_NODE_ID } },
        { op: 'addNode', ref: '@b', material: 'Text', props: {}, position: { mode: 'appendTo', target: ROOT_NODE_ID } },
      ]),
      {
        knownMaterials: MATERIALS,
        containerMaterials: CONTAINERS,
        createNodeId: (m) => m.toLowerCase(),
        materialVersions: { Lottery: '2.1.0' },
      },
    );
    expect(dsl.craftJson.lottery!.type).toEqual({ resolvedName: 'Lottery', version: '2.1.0' });
    expect(dsl.craftJson.text!.type).toEqual({ resolvedName: 'Text' });
  });
});
