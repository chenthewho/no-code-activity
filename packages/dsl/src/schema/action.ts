import { z } from 'zod';
import { assetUrl, httpUrl, identifier, jsonValue } from './primitives';

/**
 * 「形状」与「完整性」是两件事，这里只管形状。
 *
 * 运营在设计器里是渐进填写的：先加一个「打开弹窗」动作，再回头选目标弹窗。
 * 如果 schema 直接要求非空，草稿就会在填到一半时存不进去，编辑流程直接断掉。
 * 所以可填字段一律允许空串，「必须填」交给 validate.ts 的完整性检查——
 * 发布时报 error 拦住，草稿期只报 warning 提示。
 */
const fillable = <T extends z.ZodType>(schema: T) => schema.or(z.literal(''));

/**
 * 动作协议，对应架构图「动作与配置 (Actions)」。
 *
 * 刻意做成封闭的可辨识联合而不是「执行一段脚本」：DSL 虽然来自自家服务端，
 * 但它由运营在设计器里拼装、经多层传输，按不可信输入处理。所有能力必须是
 * EventBinder 里注册过的具名动作，宿主能力则统一收敛到 sdk.invoke 的方法白名单。
 */

const actionBase = {
  id: identifier.optional(),
  /** 执行前的条件表达式，如 "{{ state.hasDrawn === false }}"，为假则跳过该动作 */
  condition: z.string().optional(),
};

const navigate = z.object({
  ...actionBase,
  type: z.literal('navigate'),
  url: fillable(httpUrl),
  target: z.enum(['_self', '_blank']).default('_self'),
});

const modalOpen = z.object({
  ...actionBase,
  type: z.literal('modal.open'),
  modalId: fillable(identifier),
  /** 打开弹窗时注入的局部数据，可用表达式 */
  payload: z.record(z.string(), jsonValue).optional(),
});

const modalClose = z.object({
  ...actionBase,
  type: z.literal('modal.close'),
  /** 省略则关闭最顶层弹窗 */
  modalId: fillable(identifier).optional(),
});

const toast = z.object({
  ...actionBase,
  type: z.literal('toast'),
  message: z.string(),
  level: z.enum(['info', 'success', 'warning', 'error']).default('info'),
  duration: z.number().int().min(500).max(10_000).default(2000),
});

const stateSet = z.object({
  ...actionBase,
  type: z.literal('state.set'),
  key: z.string(),
  value: jsonValue,
});

const dataSourceRefresh = z.object({
  ...actionBase,
  type: z.literal('dataSource.refresh'),
  dataSourceId: fillable(identifier),
});

/** 向指定组件派发自定义事件，对应图中 component.triggerEvent */
const componentTrigger = z.object({
  ...actionBase,
  type: z.literal('component.trigger'),
  nodeId: fillable(identifier),
  event: z.string(),
  payload: z.record(z.string(), jsonValue).optional(),
});

const lotteryDraw = z.object({
  ...actionBase,
  type: z.literal('lottery.draw'),
  prizePoolId: z.string(),
  /** 中奖/未中奖后续动作，由 EventBinder 在接口返回后串联 */
  onWin: z.array(identifier).default([]),
  onLose: z.array(identifier).default([]),
});

/** 活动预约 / 报名 */
const appointment = z.object({
  ...actionBase,
  type: z.literal('appointment'),
  sceneId: z.string(),
});

const formSubmit = z.object({
  ...actionBase,
  type: z.literal('form.submit'),
  formNodeId: fillable(identifier),
});

const share = z.object({
  ...actionBase,
  type: z.literal('share'),
  channel: z.enum(['wechat', 'wechat_moments', 'qq', 'weibo', 'link', 'system']).default('system'),
  title: z.string().optional(),
  desc: z.string().optional(),
  cover: assetUrl.optional(),
});

const gameDownload = z.object({
  ...actionBase,
  type: z.literal('game.download'),
  gameId: z.string(),
});

const login = z.object({
  ...actionBase,
  type: z.literal('login'),
});

/** 退出 C 端登录：清掉本地登录态，宿主有自己的登出能力时一并调用 */
const logout = z.object({
  ...actionBase,
  type: z.literal('logout'),
});

/** 宿主 SDK 能力调用，method 由各 HostAdapter 的白名单裁决 */
const sdkInvoke = z.object({
  ...actionBase,
  type: z.literal('sdk.invoke'),
  method: z.string().max(64),
  params: z.record(z.string(), jsonValue).default({}),
});

export const actionSchema = z.discriminatedUnion('type', [
  navigate,
  modalOpen,
  modalClose,
  toast,
  stateSet,
  dataSourceRefresh,
  componentTrigger,
  lotteryDraw,
  appointment,
  formSubmit,
  share,
  gameDownload,
  login,
  logout,
  sdkInvoke,
]);

export type DslAction = z.infer<typeof actionSchema>;
export type DslActionType = DslAction['type'];

/** 触发器：组件通用生命周期 + 物料自定义事件（由 MaterialMeta.events 声明） */
export const TRIGGERS = ['onClick', 'onLoad', 'onExpose', 'onChange', 'onCustom'] as const;

export const eventBindingSchema = z.object({
  id: identifier,
  nodeId: identifier,
  trigger: z.enum(TRIGGERS),
  /** trigger 为 onCustom 时，物料抛出的具体事件名 */
  customEvent: z.string().optional(),
  actions: z.array(actionSchema).default([]),
});

export type EventBinding = z.infer<typeof eventBindingSchema>;

/**
 * 各动作的必填字段。发布时缺失即报错，草稿期只提示。
 *
 * 放在协议包里而不是设计器里：表单的「必填」标记与后端的发布校验
 * 读的是同一份清单，不可能出现「界面没标必填、发布却被拦」的错位。
 */
export const REQUIRED_ACTION_FIELDS: Record<DslActionType, string[]> = {
  navigate: ['url'],
  'modal.open': ['modalId'],
  'modal.close': [],
  toast: ['message'],
  'state.set': ['key'],
  'dataSource.refresh': ['dataSourceId'],
  'component.trigger': ['nodeId', 'event'],
  'lottery.draw': ['prizePoolId'],
  appointment: ['sceneId'],
  'form.submit': ['formNodeId'],
  share: [],
  login: [],
  logout: [],
  'game.download': ['gameId'],
  'sdk.invoke': ['method'],
};

/** 字段名 → 面板上的中文标签，用于把校验问题说成人话 */
export const ACTION_FIELD_LABELS: Record<string, string> = {
  url: '目标地址',
  modalId: '目标弹窗',
  message: '提示文案',
  key: '状态键名',
  dataSourceId: '数据源',
  nodeId: '目标组件',
  event: '事件名',
  prizePoolId: '奖池 ID',
  sceneId: '场景 ID',
  formNodeId: '表单节点',
  gameId: '游戏 ID',
  method: '方法名',
};
