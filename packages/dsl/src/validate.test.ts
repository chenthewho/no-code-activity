import { describe, expect, it } from 'vitest';
import { createEmptyDsl } from './factory';
import { validateFinalDsl } from './validate';
import { migrateDsl, compareVersion } from './migrate';
import { DSL_SCHEMA_VERSION } from './version';

function baseDsl() {
  const dsl = createEmptyDsl('act_1', '测试活动');
  dsl.craftJson.ROOT!.nodes = ['btn_1'];
  dsl.craftJson.btn_1 = {
    type: { resolvedName: 'Button' },
    isCanvas: false,
    props: { text: '点我' },
    custom: {},
    hidden: false,
    nodes: [],
    linkedNodes: {},
  };
  return dsl;
}

describe('validateFinalDsl', () => {
  it('接受结构完整的 DSL', () => {
    const result = validateFinalDsl(baseDsl());
    expect(result.success).toBe(true);
  });

  it('拒绝缺少 ROOT 的节点树', () => {
    const dsl = baseDsl();
    delete (dsl.craftJson as Record<string, unknown>).ROOT;
    const result = validateFinalDsl(dsl);
    expect(result.success).toBe(false);
  });

  it('检出悬空子节点引用', () => {
    const dsl = baseDsl();
    dsl.craftJson.ROOT!.nodes = ['missing_node'];
    const result = validateFinalDsl(dsl);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.some((i) => i.message.includes('missing_node'))).toBe(true);
    }
  });

  it('检出指向不存在节点的事件绑定', () => {
    const dsl = baseDsl();
    dsl.events = [{ id: 'e1', nodeId: 'ghost', trigger: 'onClick', actions: [] }];
    const result = validateFinalDsl(dsl);
    expect(result.success).toBe(false);
  });

  it('检出引用了不存在数据源的动作', () => {
    const dsl = baseDsl();
    dsl.events = [
      {
        id: 'e1',
        nodeId: 'btn_1',
        trigger: 'onClick',
        actions: [{ type: 'dataSource.refresh', dataSourceId: 'ds_nope' }],
      },
    ];
    const result = validateFinalDsl(dsl);
    expect(result.success).toBe(false);
  });

  it('孤儿节点只报 warning，不阻断发布', () => {
    const dsl = baseDsl();
    dsl.craftJson.orphan = {
      type: { resolvedName: 'Text' },
      isCanvas: false,
      props: {},
      custom: {},
      hidden: false,
      nodes: [],
      linkedNodes: {},
    };
    const result = validateFinalDsl(dsl);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.issues.some((i) => i.level === 'warning')).toBe(true);
    }
  });

  it('knownMaterials 可拦截未注册物料', () => {
    const result = validateFinalDsl(baseDsl(), { knownMaterials: ['Page'] });
    expect(result.success).toBe(false);
  });

  it('拒绝结束早于开始的活动时间', () => {
    const dsl = baseDsl();
    dsl.meta.startTime = '2026-08-01T00:00:00.000Z';
    dsl.meta.endTime = '2026-07-01T00:00:00.000Z';
    expect(validateFinalDsl(dsl).success).toBe(false);
  });
});

describe('migrateDsl', () => {
  it('当前版本原样通过', () => {
    const result = migrateDsl(baseDsl());
    expect(result.to).toBe(DSL_SCHEMA_VERSION);
    expect(result.applied).toEqual([]);
  });

  it('高于运行时的版本直接抛错，而非静默渲染', () => {
    expect(() => migrateDsl({ ...baseDsl(), schemaVersion: '99.0.0' })).toThrow(/升级渲染器/);
  });
});

describe('compareVersion', () => {
  it('按语义化版本比较', () => {
    expect(compareVersion('1.2.0', '1.10.0')).toBe(-1);
    expect(compareVersion('2.0.0', '1.9.9')).toBe(1);
    expect(compareVersion('1.0.0', '1.0.0')).toBe(0);
  });
});
