import type { DslAction, DslActionType, JsonValue } from '@nca/dsl';

/**
 * 动作配置表单的声明式定义。
 *
 * 与物料的 propsSchema 是同一个思路：动作的表单长什么样由数据描述，
 * 新增一种动作只在这里加一条，面板代码不用动。
 */
export interface ActionFieldDef {
  key: string;
  label: string;
  editor: 'string' | 'textarea' | 'number' | 'boolean' | 'select' | 'node' | 'dataSource' | 'json';
  options?: { label: string; value: string | number | boolean }[];
  placeholder?: string;
  help?: string;
  /** editor 为 node 时，只列出该物料类型的节点 */
  nodeMaterial?: string;
}

export interface ActionDef {
  type: DslActionType;
  label: string;
  group: '页面' | '数据' | '业务' | '宿主';
  description?: string;
  defaults: Record<string, JsonValue>;
  fields: ActionFieldDef[];
}

export const ACTION_DEFS: ActionDef[] = [
  {
    type: 'modal.open',
    label: '打开弹窗',
    group: '页面',
    defaults: { modalId: '' },
    fields: [{ key: 'modalId', label: '目标弹窗', editor: 'node', nodeMaterial: 'Modal' }],
  },
  {
    type: 'modal.close',
    label: '关闭弹窗',
    group: '页面',
    description: '不选则关闭最顶层弹窗',
    defaults: {},
    fields: [{ key: 'modalId', label: '目标弹窗', editor: 'node', nodeMaterial: 'Modal' }],
  },
  {
    type: 'toast',
    label: '轻提示',
    group: '页面',
    defaults: { message: '提示内容', level: 'info', duration: 2000 },
    fields: [
      { key: 'message', label: '提示文案', editor: 'string' },
      {
        key: 'level',
        label: '类型',
        editor: 'select',
        options: [
          { label: '普通', value: 'info' },
          { label: '成功', value: 'success' },
          { label: '警告', value: 'warning' },
          { label: '错误', value: 'error' },
        ],
      },
      { key: 'duration', label: '停留(ms)', editor: 'number' },
    ],
  },
  {
    type: 'navigate',
    label: '页面跳转',
    group: '页面',
    defaults: { url: '', target: '_self' },
    fields: [
      { key: 'url', label: '目标地址', editor: 'string', placeholder: 'https://…' },
      {
        key: 'target',
        label: '打开方式',
        editor: 'select',
        options: [
          { label: '当前窗口', value: '_self' },
          { label: '新窗口', value: '_blank' },
        ],
      },
    ],
  },
  {
    type: 'state.set',
    label: '设置页面状态',
    group: '数据',
    description: '设置后可用 {{ state.键名 }} 绑定到任意属性',
    defaults: { key: '', value: '' },
    fields: [
      { key: 'key', label: '状态键名', editor: 'string', placeholder: '如 joined' },
      { key: 'value', label: '值', editor: 'json', help: '填 true / 123 / "文本" 或 JSON' },
    ],
  },
  {
    type: 'dataSource.refresh',
    label: '刷新数据源',
    group: '数据',
    defaults: { dataSourceId: '' },
    fields: [{ key: 'dataSourceId', label: '数据源', editor: 'dataSource' }],
  },
  {
    type: 'component.trigger',
    label: '触发组件事件',
    group: '数据',
    defaults: { nodeId: '', event: '' },
    fields: [
      { key: 'nodeId', label: '目标组件', editor: 'node' },
      { key: 'event', label: '事件名', editor: 'string' },
    ],
  },
  {
    type: 'lottery.draw',
    label: '抽奖',
    group: '业务',
    defaults: { prizePoolId: '', onWin: [], onLose: [] },
    fields: [{ key: 'prizePoolId', label: '奖池 ID', editor: 'string' }],
  },
  {
    type: 'appointment',
    label: '活动预约',
    group: '业务',
    defaults: { sceneId: '' },
    fields: [{ key: 'sceneId', label: '场景 ID', editor: 'string' }],
  },
  {
    type: 'form.submit',
    label: '提交表单',
    group: '业务',
    defaults: { formNodeId: '' },
    fields: [{ key: 'formNodeId', label: '表单节点', editor: 'node' }],
  },
  {
    type: 'share',
    label: '分享',
    group: '宿主',
    defaults: { channel: 'system' },
    fields: [
      {
        key: 'channel',
        label: '渠道',
        editor: 'select',
        options: [
          { label: '系统分享', value: 'system' },
          { label: '微信好友', value: 'wechat' },
          { label: '朋友圈', value: 'wechat_moments' },
          { label: 'QQ', value: 'qq' },
          { label: '微博', value: 'weibo' },
          { label: '复制链接', value: 'link' },
        ],
      },
      { key: 'title', label: '分享标题', editor: 'string' },
      { key: 'desc', label: '分享描述', editor: 'string' },
      { key: 'cover', label: '分享封面', editor: 'string' },
    ],
  },
  {
    type: 'login',
    label: '拉起登录',
    group: '宿主',
    defaults: {},
    fields: [],
  },
  {
    type: 'game.download',
    label: '下载游戏',
    group: '宿主',
    defaults: { gameId: '' },
    fields: [{ key: 'gameId', label: '游戏 ID', editor: 'string' }],
  },
  {
    type: 'sdk.invoke',
    label: '调用 SDK 能力',
    group: '宿主',
    description: '方法名需在宿主适配器白名单内',
    defaults: { method: '', params: {} },
    fields: [
      { key: 'method', label: '方法名', editor: 'string' },
      { key: 'params', label: '参数', editor: 'json' },
    ],
  },
];

export const ACTION_DEF_MAP: Record<string, ActionDef> = Object.fromEntries(
  ACTION_DEFS.map((def) => [def.type, def]),
);

export function createAction(type: DslActionType): DslAction {
  const def = ACTION_DEF_MAP[type];
  return { type, ...(def?.defaults ?? {}) } as DslAction;
}

export function describeAction(action: DslAction): string {
  const def = ACTION_DEF_MAP[action.type];
  const label = def?.label ?? action.type;
  const record = action as unknown as Record<string, unknown>;

  // 摘要里带上关键参数，折叠状态下也能一眼看出这条动作在做什么
  const key = def?.fields[0]?.key;
  const value = key ? record[key] : undefined;
  return value ? `${label} · ${String(value)}` : label;
}
