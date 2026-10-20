/**
 * 灰度规则：命中任意一条就看灰度版本，否则看全量版本。
 *
 * - channels：带这些渠道码（?ch=）访问的人，适合「先给内部测试渠道看」
 * - userIds：白名单，C 端登录用户 id 或访客 id，适合点名让几个人验收
 * - percent：按设备分桶的比例（0–100），适合逐步放量
 */
export interface GrayRule {
  percent: number;
  channels: string[];
  userIds: string[];
}

export interface GrayVisitor {
  /** 访问带的渠道码 */
  channel?: string;
  /** 设备上的访客 id：分桶依据，登录前后不变，同一台设备放量期间始终落在同一边 */
  deviceId?: string;
  /** C 端登录用户 id（来自服务端验过的 token，不是页面自报的） */
  userId?: string;
}

/** 0–99 的稳定分桶：同一个 id 永远落在同一个桶，放量从 10% 到 30% 时原来那 10% 的人不会被换掉 */
export function grayBucket(id: string): number {
  // FNV-1a 32 位：够均匀、两端实现一致、不依赖 crypto
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 100;
}

export function matchGray(rule: GrayRule, visitor: GrayVisitor): boolean {
  if (visitor.channel && rule.channels.includes(visitor.channel)) return true;
  if (visitor.userId && rule.userIds.includes(visitor.userId)) return true;
  if (visitor.deviceId && rule.userIds.includes(visitor.deviceId)) return true;
  if (rule.percent > 0 && visitor.deviceId) return grayBucket(visitor.deviceId) < rule.percent;
  return false;
}
