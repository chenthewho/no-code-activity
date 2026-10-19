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

describe('草稿 vs 发布：分级校验', () => {
  function dslWithEmptyToast() {
    const dsl = baseDsl();
    dsl.events = [
      {
        id: 'e1',
        nodeId: 'btn_1',
        trigger: 'onClick',
        actions: [{ type: 'toast', message: '', level: 'info', duration: 2000 }],
      },
    ];
    return dsl;
  }

  it('草稿模式：必填项没填只报 warning，草稿仍能保存', () => {
    const result = validateFinalDsl(dslWithEmptyToast(), { mode: 'draft' });
    expect(result.success).toBe(true);
    if (result.success) {
      const issue = result.issues.find((i) => i.path.includes('message'));
      expect(issue?.level).toBe('warning');
      expect(issue?.message).toContain('提示文案');
    }
  });

  it('发布模式：同样的缺失升级为 error 并拦住发布', () => {
    const result = validateFinalDsl(dslWithEmptyToast(), { mode: 'publish' });
    expect(result.success).toBe(false);
  });

  it('问题带上位置与节点 id，便于面板定位', () => {
    const result = validateFinalDsl(dslWithEmptyToast(), { mode: 'publish' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.issues.find((i) => i.path.includes('message'));
      expect(issue?.location).toBe('事件 1 › 动作 1');
      expect(issue?.nodeId).toBe('btn_1');
    }
  });

  it('新建的空 HTTP 数据源不阻断草稿保存', () => {
    const dsl = baseDsl();
    dsl.dataSources = [
      {
        id: 'ds_new', name: '新数据源', type: 'http', url: '', method: 'GET',
        headers: {}, params: {}, autoLoad: true, pollInterval: 0, cacheTtl: 0,
      },
    ];
    expect(validateFinalDsl(dsl, { mode: 'draft' }).success).toBe(true);
    expect(validateFinalDsl(dsl, { mode: 'publish' }).success).toBe(false);
  });

  it('填了但指向不存在的引用，两种模式都是 error', () => {
    const dsl = baseDsl();
    dsl.events = [
      {
        id: 'e1', nodeId: 'btn_1', trigger: 'onClick',
        actions: [{ type: 'modal.open', modalId: 'ghost_modal' }],
      },
    ];
    expect(validateFinalDsl(dsl, { mode: 'draft' }).success).toBe(false);
    expect(validateFinalDsl(dsl, { mode: 'publish' }).success).toBe(false);
  });

  it('循环容器没填数据来源，草稿放行、发布拦截', () => {
    const dsl = baseDsl();
    dsl.craftJson.btn_1!.control = {
      loop: { source: '', itemAlias: 'item', indexAlias: 'index' },
    };
    expect(validateFinalDsl(dsl, { mode: 'draft' }).success).toBe(true);
    expect(validateFinalDsl(dsl, { mode: 'publish' }).success).toBe(false);
  });

  it('默认按发布口径，不传 mode 时最严格', () => {
    expect(validateFinalDsl(dslWithEmptyToast()).success).toBe(false);
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

describe('validateFinalDsl · 物料版本', () => {
  it('节点版本高于注册表时发布拦截，低于或缺省时放行（交给渲染器迁移）', () => {
    const dsl = baseDsl();
    dsl.craftJson.btn_1!.type.version = '2.0.0';
    const newer = validateFinalDsl(dsl, { materialVersions: { Button: '1.3.0' } });
    expect(newer.success).toBe(false);
    expect(newer.issues[0]).toMatchObject({ level: 'error', nodeId: 'btn_1' });
    expect(newer.issues[0]!.message).toMatch(/高于物料注册表的 v1.3.0/);

    dsl.craftJson.btn_1!.type.version = '1.0.0';
    expect(validateFinalDsl(dsl, { materialVersions: { Button: '2.0.0' } }).success).toBe(true);
    delete dsl.craftJson.btn_1!.type.version;
    expect(validateFinalDsl(dsl, { materialVersions: { Button: '2.0.0' } }).success).toBe(true);
  });
});
