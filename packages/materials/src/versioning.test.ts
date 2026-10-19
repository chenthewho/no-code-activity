import { describe, expect, it } from 'vitest';
import { finalDslSchema, type FinalDsl } from '@nca/dsl';
import { materials, materialVersions } from './index';
import { describeUpgrade, majorOf, upgradeMaterials, type MaterialVersionInfo } from './versioning';

function dslWith(
  nodes: Record<string, { name: string; version?: string; props?: Record<string, unknown> }>,
): FinalDsl {
  return finalDslSchema.parse({
    schemaVersion: '1.1.0',
    meta: { activityId: 'a1', title: 't' },
    craftJson: {
      ROOT: {
        type: { resolvedName: 'Page', version: '1.0.0' },
        isCanvas: true,
        nodes: Object.keys(nodes),
      },
      ...Object.fromEntries(
        Object.entries(nodes).map(([id, n]) => [
          id,
          {
            type: { resolvedName: n.name, ...(n.version ? { version: n.version } : {}) },
            props: n.props ?? {},
            parent: 'ROOT',
          },
        ]),
      ),
    },
  });
}

/** 假想的升级：Btn 2.0 把 label 改名为 text，3.0 把 size 从字符串改成数字 */
const REGISTRY: Record<string, MaterialVersionInfo> = {
  Page: { version: '1.0.0' },
  Btn: {
    version: '3.1.0',
    migrations: [
      {
        fromMajor: 1,
        description: 'label 改名为 text',
        up: ({ label, ...rest }) => ({ ...rest, ...(label !== undefined ? { text: label } : {}) }),
      },
      {
        fromMajor: 2,
        description: 'size 改为数字',
        up: (props) => ({ ...props, size: props.size === 'large' ? 48 : 32 }),
      },
    ],
  },
  Card: { version: '2.0.0', migrations: [] },
};

describe('upgradeMaterials', () => {
  it('缺版本号的存量节点按 1.0.0 处理，沿迁移链逐级升到当前版本', () => {
    const input = dslWith({ b1: { name: 'Btn', props: { label: '抽奖', size: 'large' } } });
    const { dsl, changed, report } = upgradeMaterials(input, REGISTRY);
    expect(changed).toBe(true);
    expect(dsl.craftJson.b1!.props).toEqual({ text: '抽奖', size: 48 });
    expect(dsl.craftJson.b1!.type.version).toBe('3.1.0');
    expect(report.migrated[0]!.steps).toHaveLength(2);
    // 不修改入参：发布快照是不可变的
    expect(input.craftJson.b1!.props).toEqual({ label: '抽奖', size: 'large' });
  });

  it('同一大版本内只更新版本号，props 原样', () => {
    const { dsl, report } = upgradeMaterials(
      dslWith({ b1: { name: 'Btn', version: '3.0.2', props: { text: 'x', size: 40 } } }),
      REGISTRY,
    );
    expect(dsl.craftJson.b1!.props).toEqual({ text: 'x', size: 40 });
    expect(dsl.craftJson.b1!.type.version).toBe('3.1.0');
    expect(report.stamped).toBe(1);
    expect(report.migrated).toEqual([]);
  });

  it('缺迁移函数时不硬升：props 原样保留并报告', () => {
    const { dsl, report } = upgradeMaterials(
      dslWith({ c1: { name: 'Card', props: { title: 'x' } } }),
      REGISTRY,
    );
    expect(dsl.craftJson.c1!.type.version).toBeUndefined();
    expect(report.blocked[0]).toMatchObject({ nodeId: 'c1', reason: '缺少 v1 → v2 的迁移' });
  });

  it('节点版本比运行时新：不动它，报告出来', () => {
    const { report } = upgradeMaterials(
      dslWith({ b1: { name: 'Btn', version: '4.0.0' } }),
      REGISTRY,
    );
    expect(report.newer).toEqual([
      { nodeId: 'b1', material: 'Btn', nodeVersion: '4.0.0', runtimeVersion: '3.1.0' },
    ]);
    expect(describeUpgrade(report)[0]).toMatch(/请升级渲染器/);
  });

  it('全都已是最新版时原样返回同一个对象', () => {
    const input = dslWith({ b1: { name: 'Btn', version: '3.1.0' } });
    const result = upgradeMaterials(input, REGISTRY);
    expect(result.changed).toBe(false);
    expect(result.dsl).toBe(input);
  });

  it('未注册的物料跳过，留给校验报错', () => {
    const { changed } = upgradeMaterials(
      dslWith({ x: { name: 'Ghost', version: '1.0.0' } }),
      REGISTRY,
    );
    expect(changed).toBe(false);
  });
});

describe('物料版本守则（CI 守卫）', () => {
  it('每个升过大版本的物料，都提供了从 v1 起每一级的迁移', () => {
    for (const material of materials) {
      const major = majorOf(material.meta.version);
      for (let from = 1; from < major; from++) {
        const has = material.migrations?.some((m) => m.fromMajor === from);
        if (!has) throw new Error(`物料 ${material.meta.name} 缺少 v${from} → v${from + 1} 的迁移`);
      }
    }
  });

  it('版本号是合法的 semver（x.y.z）', () => {
    for (const [name, info] of Object.entries(materialVersions)) {
      expect(info.version, name).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});
