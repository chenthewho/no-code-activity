import { compareVersion, type CraftNode, type FinalDsl, type JsonValue } from '@nca/dsl';

/**
 * 物料版本升级策略。
 *
 * 物料只有一份实现，代码里永远只有「最新版」的组件。已发布的 DSL 却是不可变快照，
 * 里面的 props 是按搭建当时的物料版本写的。于是约定（semver）：
 *
 * - **patch / minor 必须向后兼容**：只许新增带默认值的 props、修样式与 bug。
 *   旧节点不用改写，打上新版本号即可。
 * - **major 才允许破坏性变更**（改名、改结构、改语义），且必须随代码提供
 *   N → N+1 的 props 迁移函数。materials.test.ts 会检查每个大版本都有迁移，缺了 CI 红。
 * - 迁移在读取侧懒执行：渲染器加载 DSL 时、设计器打开草稿时各跑一遍。发布快照
 *   本身不改——回滚到半年前的版本，照样被今天的渲染器按迁移链升到能渲染的形状。
 * - 节点版本**高于**运行时的物料版本（DSL 用更新的物料搭、渲染器还没发版），
 *   发布环节直接拦截（见 validateFinalDsl 的 materialVersions），渲染器只告警。
 * - 下线物料分两步：先在 meta 上标 deprecated（工具箱隐藏、存量照常渲染），
 *   存量活动都下线后再删代码。
 */

/** 版本字段出现之前创建的节点，一律按 1.0.0 处理——当时所有物料都还是 1.x */
export const BASELINE_MATERIAL_VERSION = '1.0.0';

export interface MaterialMigration {
  /** 从哪个大版本升上来：fromMajor = 1 表示把 1.x 的 props 改写成 2.x 的形状 */
  fromMajor: number;
  /** 改了什么，出现在升级报告与设计器提示里 */
  description: string;
  /** 纯函数：只改写 props，不碰节点树结构 */
  up: (props: Record<string, JsonValue>) => Record<string, JsonValue>;
}

export interface MaterialVersionInfo {
  version: string;
  migrations?: readonly MaterialMigration[];
}

export interface MaterialUpgradeReport {
  /** 跨大版本、跑了迁移的节点 */
  migrated: { nodeId: string; material: string; from: string; to: string; steps: string[] }[];
  /** 同一大版本内、只更新了版本号的节点数 */
  stamped: number;
  /** 缺迁移函数、没法升上去的节点：props 原样保留，可能渲染异常 */
  blocked: { nodeId: string; material: string; from: string; to: string; reason: string }[];
  /** 节点版本比运行时还新：渲染器落后于搭建时的物料 */
  newer: { nodeId: string; material: string; nodeVersion: string; runtimeVersion: string }[];
}

export function majorOf(version: string): number {
  return Number(version.split('.')[0]) || 0;
}

/**
 * 把 DSL 里每个节点的 props 升到当前物料版本。不修改入参；
 * 没有任何节点需要变化时原样返回同一个对象（changed = false）。
 */
export function upgradeMaterials(
  dsl: FinalDsl,
  registry: Readonly<Record<string, MaterialVersionInfo>>,
): { dsl: FinalDsl; changed: boolean; report: MaterialUpgradeReport } {
  const report: MaterialUpgradeReport = { migrated: [], stamped: 0, blocked: [], newer: [] };
  let craftJson: FinalDsl['craftJson'] | null = null;

  const write = (id: string, node: CraftNode): void => {
    craftJson ??= { ...dsl.craftJson };
    craftJson[id] = node;
  };

  for (const [id, node] of Object.entries(dsl.craftJson)) {
    const info = registry[node.type.resolvedName];
    if (!info) continue; // 未注册的物料交给校验去报，这里不管

    const from = node.type.version ?? BASELINE_MATERIAL_VERSION;
    const order = compareVersion(from, info.version);
    if (order === 0) {
      // 版本一致但字段缺失（存量节点恰好是 1.0.0）：补上版本号，下次不用再推断
      if (!node.type.version) write(id, { ...node, type: { ...node.type, version: info.version } });
      continue;
    }
    if (order > 0) {
      report.newer.push({
        nodeId: id,
        material: node.type.resolvedName,
        nodeVersion: from,
        runtimeVersion: info.version,
      });
      continue;
    }

    // 同一大版本：向后兼容，只更新版本号
    let props = node.props;
    const steps: string[] = [];
    let blockedReason = '';
    for (let major = majorOf(from); major < majorOf(info.version); major++) {
      const migration = info.migrations?.find((m) => m.fromMajor === major);
      if (!migration) {
        blockedReason = `缺少 v${major} → v${major + 1} 的迁移`;
        break;
      }
      props = migration.up(props);
      steps.push(`v${major}→v${major + 1}：${migration.description}`);
    }

    if (blockedReason) {
      report.blocked.push({
        nodeId: id,
        material: node.type.resolvedName,
        from,
        to: info.version,
        reason: blockedReason,
      });
      continue;
    }

    write(id, { ...node, props, type: { ...node.type, version: info.version } });
    if (steps.length > 0) {
      report.migrated.push({
        nodeId: id,
        material: node.type.resolvedName,
        from,
        to: info.version,
        steps,
      });
    } else {
      report.stamped += 1;
    }
  }

  if (!craftJson) return { dsl, changed: false, report };
  return { dsl: { ...dsl, craftJson }, changed: true, report };
}

/** 升级报告转成一行行人话，渲染器打 warning、设计器弹提示都用它 */
export function describeUpgrade(report: MaterialUpgradeReport): string[] {
  return [
    ...report.migrated.map(
      (m) =>
        `组件 ${m.nodeId}（${m.material}）已从 v${m.from} 升级到 v${m.to}：${m.steps.join('；')}`,
    ),
    ...report.blocked.map(
      (b) => `组件 ${b.nodeId}（${b.material}）无法从 v${b.from} 升级到 v${b.to}：${b.reason}`,
    ),
    ...report.newer.map(
      (n) =>
        `组件 ${n.nodeId}（${n.material}）是 v${n.nodeVersion}，高于当前渲染器的 v${n.runtimeVersion}，请升级渲染器`,
    ),
  ];
}
