import { describe, expect, it } from 'vitest';
import { compareVersion, migrateDsl, type MigrateResult } from './migrate';
import type { Migration } from './migrate';

type Raw = Record<string, unknown>;

/** 注入一条假迁移链，验证推进逻辑；DSL_MIGRATIONS 当前为空，只能靠它测。
 *  用低于当前版本（0.9.x）的链，推进终点正好是 1.0.0，不触发「高于运行时」守卫。 */
const FAKE_MIGRATIONS: Migration[] = [
  { from: '0.9.0', to: '0.9.1', up: (dsl) => ({ ...dsl, migrated: [...(dsl.migrated as string[] ?? []), '0.9.0→0.9.1'] }) },
  { from: '0.9.1', to: '1.0.0', up: (dsl) => ({ ...dsl, migrated: [...(dsl.migrated as string[] ?? []), '0.9.1→1.0.0'] }) },
];

function baseDsl(schemaVersion: string): Raw {
  return { schemaVersion, craftJson: { ROOT: {} }, meta: {} };
}

describe('migrateDsl', () => {
  it('当前版本且无迁移时原样返回，不产生任何改动', () => {
    const input = baseDsl('1.0.0');
    const result = migrateDsl(input);
    expect(result.applied).toEqual([]);
    expect(result.from).toBe('1.0.0');
    expect(result.to).toBe('1.0.0');
    expect(result.dsl).toEqual(input);
  });

  it('沿迁移链逐级推进，旧版本最终到当前版本', () => {
    const result: MigrateResult = migrateDsl(baseDsl('0.9.0'), FAKE_MIGRATIONS);
    expect(result.applied).toEqual(['0.9.0→0.9.1', '0.9.1→1.0.0']);
    expect(result.to).toBe('1.0.0');
    expect((result.dsl.migrated as string[]).length).toBe(2);
  });

  it('从链中间起步也能一路推到当前', () => {
    const result = migrateDsl(baseDsl('0.9.1'), FAKE_MIGRATIONS);
    expect(result.applied).toEqual(['0.9.1→1.0.0']);
    expect(result.to).toBe('1.0.0');
  });

  it('DSL 版本高于运行时就报错，拒绝静默渲染', () => {
    expect(() => migrateDsl(baseDsl('9.9.9'))).toThrow(/请升级渲染器/);
  });

  it('非对象输入直接抛错', () => {
    expect(() => migrateDsl('not-an-object')).toThrow(/DSL 需为对象/);
  });

  it('缺 schemaVersion 按 1.0.0 处理', () => {
    const result = migrateDsl({ craftJson: { ROOT: {} }, meta: {} }, FAKE_MIGRATIONS);
    expect(result.from).toBe('1.0.0');
    expect(result.to).toBe('1.0.0');
    expect(result.applied).toEqual([]);
  });
});

describe('compareVersion', () => {
  it('逐段比较', () => {
    expect(compareVersion('1.0.1', '1.0.0')).toBe(1);
    expect(compareVersion('1.1.0', '1.0.9')).toBe(1);
    expect(compareVersion('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersion('0.9.9', '1.0.0')).toBe(-1);
    expect(compareVersion('2.0.0', '1.9.9')).toBe(1);
  });
});
