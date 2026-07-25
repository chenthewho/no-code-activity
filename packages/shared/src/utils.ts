/** 穷尽性检查：switch 漏分支时编译期报错 */
export function assertNever(value: never, hint = 'Unexpected value'): never {
  throw new Error(`${hint}: ${JSON.stringify(value)}`);
}

/** 生成节点/资源 id。不追求全局唯一，只需在单份 DSL 内不冲突 */
export function createId(prefix = 'n'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 结构化深拷贝，用于 DSL 快照，避免设计器改动污染历史版本 */
export function deepClone<T>(value: T): T {
  return structuredClone(value);
}
