/**
 * DSL 协议版本。任何破坏性结构变更都必须递增，并在 migrate.ts 里补一条迁移，
 * 保证历史发布的活动页永远可以被新版 Renderer 打开。
 */
export const DSL_SCHEMA_VERSION = '1.0.0';

/** 已知版本，按时间顺序排列，迁移链依此推进 */
export const KNOWN_SCHEMA_VERSIONS = ['1.0.0'] as const;

export type SchemaVersion = (typeof KNOWN_SCHEMA_VERSIONS)[number];
