import type { MaterialCatalog } from '../llm/catalog';

/**
 * 双轨注册：显式选择 + 条件注入。
 *
 * 运营勾的是「我要什么」，但有些组件是业务规则决定必须有的——抽奖前得先登录，
 * 绑角色也得先登录。把这类规则写在这里，而不是散在各个节点的 if 里：
 * 新增一条规则只改这张表，调度逻辑一行不动。
 *
 * 界面上会把自动注入的项显式标出来，让运营知道系统替他做了什么决定——
 * 悄悄加进去的组件比没加更让人困惑。
 */
export interface InjectionRule {
  /** 触发条件：勾选了这些物料中的任意一个 */
  when: string[];
  /** 就自动补上这个物料 */
  inject: string;
  reason: string;
}

export const INJECTION_RULES: readonly InjectionRule[] = [
  {
    when: ['Lottery', 'BindRole'],
    inject: 'Login',
    reason: '抽奖与绑定角色都要先识别用户身份，没有登录入口这条链路走不通',
  },
  {
    when: ['Lottery'],
    inject: 'Modal',
    reason: '中奖后需要一个弹窗告诉用户抽到了什么',
  },
] as const;

export interface InjectionResult {
  material: string;
  reason: string;
}

/**
 * 按规则算出要补哪些组件。
 * 已经被显式勾选的不会重复注入；物料清单里没有的（比如被下架了）直接跳过。
 */
export function resolveInjections(
  selected: readonly string[],
  catalog: MaterialCatalog,
): InjectionResult[] {
  const chosen = new Set(selected);
  const result: InjectionResult[] = [];

  for (const rule of INJECTION_RULES) {
    if (chosen.has(rule.inject)) continue;
    if (!catalog.names.has(rule.inject)) continue;
    if (!rule.when.some((m) => chosen.has(m))) continue;
    result.push({ material: rule.inject, reason: rule.reason });
    chosen.add(rule.inject);
  }
  return result;
}

/**
 * 各业务物料需要哪些数据源。
 * 用来生成「补充字段」那张卡片——与其让模型凭空编接口地址，不如直接问运营。
 */
export const REQUIRED_ENDPOINTS: Record<string, { key: string; label: string }[]> = {
  Lottery: [
    { key: 'prizes', label: '奖品列表接口' },
    { key: 'draw', label: '抽奖接口（POST，返回中奖下标 index）' },
  ],
  RankList: [{ key: 'rank', label: '榜单数据接口' }],
  BindRole: [
    { key: 'servers', label: '区服列表接口' },
    { key: 'roles', label: '角色列表接口' },
    { key: 'bound', label: '已绑定角色接口' },
  ],
};

export function requiredEndpoints(selected: readonly string[]): { key: string; label: string }[] {
  const seen = new Set<string>();
  const out: { key: string; label: string }[] = [];
  for (const material of selected) {
    for (const item of REQUIRED_ENDPOINTS[material] ?? []) {
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      out.push(item);
    }
  }
  return out;
}
