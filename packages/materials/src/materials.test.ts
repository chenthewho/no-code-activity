import { describe, expect, it } from 'vitest';
import { materialMetaSchema } from '@nca/dsl';
import { componentMap, knownMaterialNames, materialMetas, materials } from './index';

describe('物料协议一致性', () => {
  it('每个 meta 都符合 materialMetaSchema', () => {
    for (const meta of materialMetas) {
      const result = materialMetaSchema.safeParse(meta);
      if (!result.success) {
        throw new Error(
          `物料 ${meta.name} 不符合协议：${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
        );
      }
    }
  });

  it('物料名唯一', () => {
    const names = materialMetas.map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('componentMap 与 meta 一一对应', () => {
    expect(Object.keys(componentMap).sort()).toEqual([...knownMaterialNames].sort());
    for (const meta of materialMetas) {
      expect(typeof componentMap[meta.name]).toBe('function');
    }
  });

  it('propsSchema 内 key 不重复', () => {
    for (const meta of materialMetas) {
      const keys = meta.propsSchema.map((p) => p.key);
      expect(new Set(keys).size, `${meta.name} 的 propsSchema 存在重复 key`).toBe(keys.length);
    }
  });

  it('defaultProps 的每个键都在 propsSchema 中声明过', () => {
    for (const meta of materialMetas) {
      const keys = new Set(meta.propsSchema.map((p) => p.key));
      for (const key of Object.keys(meta.defaultProps)) {
        expect(keys.has(key), `${meta.name}.defaultProps.${key} 未在 propsSchema 声明`).toBe(true);
      }
    }
  });

  it('visibleWhen 引用的 props 字段存在', () => {
    for (const meta of materialMetas) {
      const keys = new Set(meta.propsSchema.map((p) => p.key));
      for (const item of meta.propsSchema) {
        if (!item.visibleWhen) continue;
        for (const [, ref] of item.visibleWhen.matchAll(/props\.([A-Za-z0-9_]+)/g)) {
          expect(keys.has(ref as string), `${meta.name}.${item.key} 的 visibleWhen 引用了未知字段 ${ref}`).toBe(
            true,
          );
        }
      }
    }
  });

  it('容器类物料必须标记 isContainer', () => {
    const containers = materials.filter((m) => m.meta.isContainer).map((m) => m.meta.name);
    expect(containers).toContain('Page');
    expect(containers).toContain('Container');
    expect(containers).toContain('Modal');
  });
});
