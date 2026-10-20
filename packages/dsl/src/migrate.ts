import { isPlainObject } from '@nca/shared';
import { DSL_SCHEMA_VERSION } from './version';

type RawDsl = Record<string, unknown>;

/**
 * 版本迁移链。每次 DSL 结构破坏性变更：
 *   1. version.ts 里递增 DSL_SCHEMA_VERSION 并加进 KNOWN_SCHEMA_VERSIONS
 *   2. 这里补一条 { from, to, up } —— 只做纯函数式结构改写
 * 半年前发布的活动页因此永远能被今天的 Renderer 打开。
 */
export interface Migration {
  from: string;
  to: string;
  up: (dsl: RawDsl) => RawDsl;
}

/**
 * 当前生效的迁移表。每次 DSL 结构破坏性变更补一条：
 * { from: '1.0.0', to: '1.1.0', up: ... }
 * 导出是为了单测注入假迁移链验证推进逻辑，正常使用走默认参数。
 */
export const DSL_MIGRATIONS: Migration[] = [
  /**
   * 1.1.0：新增 logout 动作、节点上的物料版本（type.version）。
   * 都是可选的增量字段，旧结构原样合法，不需要改写；升版本号是为了让
   * 还没升级的旧渲染器遇到新 DSL 时明确报「请升级渲染器」，而不是在
   * 一个不认识的动作上校验失败、给运营一个莫名其妙的错误页。
   */
  { from: '1.0.0', to: '1.1.0', up: (dsl) => dsl },
];

export interface MigrateResult {
  dsl: RawDsl;
  from: string;
  to: string;
  applied: string[];
}

export function migrateDsl(input: unknown, migrations: Migration[] = DSL_MIGRATIONS): MigrateResult {
  if (!isPlainObject(input)) {
    throw new Error('DSL 需为对象');
  }
  const from = typeof input.schemaVersion === 'string' ? input.schemaVersion : '1.0.0';

  let current: RawDsl = { ...input, schemaVersion: from };
  const applied: string[] = [];

  // 沿链推进，直到没有可用迁移
  let guard = 0;
  for (;;) {
    if (guard++ > migrations.length + 1) {
      throw new Error('DSL 迁移链出现循环');
    }
    const version = current.schemaVersion as string;
    const next = migrations.find((m) => m.from === version);
    if (!next) break;
    current = next.up(current);
    current.schemaVersion = next.to;
    applied.push(`${next.from}→${next.to}`);
  }

  const to = current.schemaVersion as string;
  if (to !== DSL_SCHEMA_VERSION) {
    // 高于当前运行时的版本：说明 Renderer 代码比 DSL 老，需提示升级而非静默渲染
    if (compareVersion(to, DSL_SCHEMA_VERSION) > 0) {
      throw new Error(
        `DSL 版本 ${to} 高于当前 Renderer 支持的 ${DSL_SCHEMA_VERSION}，请升级渲染器`,
      );
    }
  }

  return { dsl: current, from, to, applied };
}

/** 节点上还没有物料版本字段时的版本：字段出现之前创建的节点，一律按 1.0.0 处理——当时所有物料都还是 1.x */
export const BASELINE_MATERIAL_VERSION = '1.0.0';

export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}
