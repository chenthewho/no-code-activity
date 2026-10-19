/** 活动发布状态机：draft → published ⇄ offline */
export const ACTIVITY_STATUS = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  OFFLINE: 'offline',
} as const;

export type ActivityStatus = (typeof ACTIVITY_STATUS)[keyof typeof ACTIVITY_STATUS];

/** 允许的状态流转，PublishModule 与前端按钮态共用 */
export const ACTIVITY_STATUS_TRANSITIONS: Record<ActivityStatus, ActivityStatus[]> = {
  [ACTIVITY_STATUS.DRAFT]: [ACTIVITY_STATUS.PUBLISHED],
  [ACTIVITY_STATUS.PUBLISHED]: [ACTIVITY_STATUS.OFFLINE],
  [ACTIVITY_STATUS.OFFLINE]: [ACTIVITY_STATUS.PUBLISHED],
};

/** 渲染宿主，对应架构图「渲染主环境 (Host)」一栏 */
export const HOST_TYPE = {
  BROWSER: 'browser',
  GAME_CENTER: 'game_center',
  LDQ_PC: 'ldq_pc',
  LDQ_APP: 'ldq_app',
  SDK_LANDSCAPE: 'sdk_landscape',
  SDK_PORTRAIT: 'sdk_portrait',
  WECHAT_MINI_PROGRAM: 'wechat_mini_program',
} as const;

export type HostType = (typeof HOST_TYPE)[keyof typeof HOST_TYPE];

/** 宿主的中文名，后台的投放配置、宿主预览与报表共用 */
export const HOST_LABELS: Record<HostType, string> = {
  [HOST_TYPE.BROWSER]: '浏览器 / H5',
  [HOST_TYPE.GAME_CENTER]: '游戏中心',
  [HOST_TYPE.LDQ_PC]: 'LDQ PC 端',
  [HOST_TYPE.LDQ_APP]: 'LDQ App',
  [HOST_TYPE.SDK_PORTRAIT]: 'SDK 竖屏',
  [HOST_TYPE.SDK_LANDSCAPE]: 'SDK 横屏',
  [HOST_TYPE.WECHAT_MINI_PROGRAM]: '微信小程序',
};

/** 物料分类，决定工具箱分组 */
export const MATERIAL_CATEGORY = {
  BASIC: 'basic',
  CONTAINER: 'container',
  MEDIA: 'media',
  BUSINESS: 'business',
} as const;

export type MaterialCategory = (typeof MATERIAL_CATEGORY)[keyof typeof MATERIAL_CATEGORY];

/** 权限码：Admin 路由守卫与后端 RBAC 守卫共用同一份字典 */
export const PERMISSION = {
  ACTIVITY_VIEW: 'activity:view',
  ACTIVITY_EDIT: 'activity:edit',
  ACTIVITY_PUBLISH: 'activity:publish',
  ACTIVITY_DELETE: 'activity:delete',
  /**
   * 数据范围：可查看、操作全部活动。没有它时只能碰自己负责或被拉进协作的活动——
   * 功能权限（能不能编辑）与数据权限（能编辑哪些）是两个维度，缺一个都会越权。
   */
  ACTIVITY_ALL: 'activity:all',
  /** 奖品与库存直接关系到成本，从「编辑活动」里单拎出来 */
  PRIZE_MANAGE: 'prize:manage',
  CHANNEL_MANAGE: 'channel:manage',
  ANALYTICS_VIEW: 'analytics:view',
  TEMPLATE_VIEW: 'template:view',
  TEMPLATE_MANAGE: 'template:manage',
  MATERIAL_MANAGE: 'material:manage',
  /** 用户、角色与授权 */
  USER_MANAGE: 'user:manage',
  AUDIT_VIEW: 'audit:view',
  /** 运行监控看板与告警规则 */
  MONITOR_VIEW: 'monitor:view',
  MONITOR_MANAGE: 'monitor:manage',
  /**
   * AI 助手。与 activity:edit 分开，是为了能单独关掉 AI 而保留手工搭建——
   * 模型会写草稿，出问题时需要一个不牵连正常编辑的开关。
   */
  AI_USE: 'ai:use',
  /** AI 触发的发布必须单独授权：影响线上，且发布动作永远还要人工确认一次 */
  AI_PUBLISH: 'ai:publish',
  SYSTEM_MANAGE: 'system:manage',
} as const;

export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];

/** 活动协作成员的角色：editor 可编辑，viewer 只读。负责人另记在 activity.ownerId */
export const ACTIVITY_MEMBER_ROLE = {
  EDITOR: 'editor',
  VIEWER: 'viewer',
} as const;

export type ActivityMemberRole = (typeof ACTIVITY_MEMBER_ROLE)[keyof typeof ACTIVITY_MEMBER_ROLE];

/**
 * 当前用户对某个活动的访问级别，前端据此决定按钮显隐：
 * all —— 有 activity:all 数据范围；owner —— 负责人；editor / viewer —— 协作成员。
 */
export type ActivityAccess = 'all' | 'owner' | ActivityMemberRole;

export const ROOT_NODE_ID = 'ROOT';
