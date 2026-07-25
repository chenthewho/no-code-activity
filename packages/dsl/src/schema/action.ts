import { z } from 'zod';
import { assetUrl, httpUrl, identifier, jsonValue } from './primitives';

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
  url: httpUrl,
  target: z.enum(['_self', '_blank']).default('_self'),
});

const modalOpen = z.object({
  ...actionBase,
  type: z.literal('modal.open'),
  modalId: identifier,
  /** 打开弹窗时注入的局部数据，可用表达式 */
  payload: z.record(z.string(), jsonValue).optional(),
});

const modalClose = z.object({
  ...actionBase,
  type: z.literal('modal.close'),
  /** 省略则关闭最顶层弹窗 */
  modalId: identifier.optional(),
});

const toast = z.object({
  ...actionBase,
  type: z.literal('toast'),
  message: z.string().min(1),
  level: z.enum(['info', 'success', 'warning', 'error']).default('info'),
  duration: z.number().int().min(500).max(10_000).default(2000),
});

const stateSet = z.object({
  ...actionBase,
  type: z.literal('state.set'),
  key: z.string().min(1),
  value: jsonValue,
});

const dataSourceRefresh = z.object({
  ...actionBase,
  type: z.literal('dataSource.refresh'),
  dataSourceId: identifier,
});

/** 向指定组件派发自定义事件，对应图中 component.triggerEvent */
const componentTrigger = z.object({
  ...actionBase,
  type: z.literal('component.trigger'),
  nodeId: identifier,
  event: z.string().min(1),
  payload: z.record(z.string(), jsonValue).optional(),
});

const lotteryDraw = z.object({
  ...actionBase,
  type: z.literal('lottery.draw'),
  prizePoolId: z.string().min(1),
  /** 中奖/未中奖后续动作，由 EventBinder 在接口返回后串联 */
  onWin: z.array(identifier).default([]),
  onLose: z.array(identifier).default([]),
});

/** 活动预约 / 报名 */
const appointment = z.object({
  ...actionBase,
  type: z.literal('appointment'),
  sceneId: z.string().min(1),
});

const formSubmit = z.object({
  ...actionBase,
  type: z.literal('form.submit'),
  formNodeId: identifier,
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
  gameId: z.string().min(1),
});

const login = z.object({
  ...actionBase,
  type: z.literal('login'),
});

/** 宿主 SDK 能力调用，method 由各 HostAdapter 的白名单裁决 */
const sdkInvoke = z.object({
  ...actionBase,
  type: z.literal('sdk.invoke'),
  method: z.string().min(1).max(64),
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
