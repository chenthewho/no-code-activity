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
  TEMPLATE_VIEW: 'template:view',
  TEMPLATE_MANAGE: 'template:manage',
  MATERIAL_MANAGE: 'material:manage',
  SYSTEM_MANAGE: 'system:manage',
} as const;

export type Permission = (typeof PERMISSION)[keyof typeof PERMISSION];

export const ROOT_NODE_ID = 'ROOT';
