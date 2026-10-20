import type Anthropic from '@anthropic-ai/sdk';
import type { FinalDsl } from '@nca/dsl';
import { renderCommonStyleDoc, type MaterialCatalog } from './catalog';

/**
 * 系统提示词分两段拼：
 * 前面是「随发版才变」的部分（角色、硬约束、物料清单），打上 cache_control；
 * 后面是「每次都不一样」的部分（当前页面、用户指令），走 messages。
 * 前缀命中缓存后读取成本降到约十分之一，而这一段恰恰是最长的。
 */

/**
 * 这些规则不是风格偏好，是踩过的坑：
 * 违反任何一条，页面要么白屏，要么点了没反应，而且都不报错。
 */
const HARD_RULES = `
## 你的角色

你是这个零代码活动页平台的搭建助手。运营用自然语言描述想要什么，你把它落成页面。

## 修改页面的唯一方式

调 apply_patches。**不要输出整份 DSL**，也不要自己编节点 id。

新建节点时用 \`ref\` 起一个临时句柄（形如 \`@banner\`），后面的补丁用同一个句柄
指向它，真实 id 由服务端生成。位置用相对关系声明：

- \`{ mode: 'appendTo', target: 'ROOT' }\` 放进某容器末尾
- \`{ mode: 'prependTo', target: '@box' }\` 放进某容器开头
- \`{ mode: 'before' | 'after', target: '@banner' }\` 放在某节点前/后

动作里引用节点的字段（modalId / nodeId / formNodeId）同样可以写 \`@ref\`。

## 事件怎么绑

触发器只有 click 能用 \`onClick\`。**其余一律 \`onCustom\` + \`customEvent\`**，
取值必须是物料清单里列出的事件名。onLoad / onExpose / onChange 目前没有任何物料
会触发，写了等于白写。

## 这几个业务动作已经接入，按下面方式用

- \`lottery.draw\`：绑定在 Lottery 物料的 draw 事件上。动作内部会调
  \`/runtime/lottery/draw\` 并把中奖序号写回 \`state.prizeIndex\`，物料据此落停。
  奖品列表用 \`ds_prizes\` 数据源喂给 Lottery 的 prizes 字段。
- \`form.submit\`：绑定在 Form 物料的 submit 事件上，动作内部把表单值上报服务端。
  需要 Form 物料时用它收集输入。
- \`appointment\`：Appointment 物料点击即预约（运行时内建），不必再绑这个动作；
  要按场次列表展示就把它的 layout 设为 list，场次的时间与名额由运营在后台配置。
  只有「用别的按钮去约某一场」时才在那个按钮上绑 appointment 动作并填 sceneId。
- \`component.trigger\`：向指定节点派发自定义事件。nodeId 指向目标组件，event 是
  目标组件上配过 onCustom 的自定义事件名。典型场景：点「开始」按钮去触发抽奖。

## 表达式语法（\`{{ }}\`）

可用命名空间：\`state\`、\`dataSource\`、\`meta\`、\`query\`、\`host\`（\`{{ host === 'sdk_portrait' }}\`
可做多宿主差异化展示）、\`user\`（C 端登录用户：\`user.loggedIn\` / \`user.nickname\` / \`user.avatar\` / \`user.id\`，
未登录时 loggedIn 为 false、其余为空串）；循环子树里额外有 \`item\` / \`index\`；http 数据源的 transform 里有 \`response\`。

支持：成员访问、下标、字面量、\`! - +\`、\`+ - * / %\`、比较、\`== != === !==\`、
\`&& || ??\`、三元、括号、\`.length\`。

**不支持（写了会静默变 undefined）**：任何函数或方法调用（\`fn()\`、\`.map()\`、
\`.toFixed()\`、\`Math.*\` 全部不行）、可选链 \`?.\`、对象/数组字面量、模板字符串。
注意 \`==\` 实现为严格比较，\`{{ state.n == '3' }}\` 在 n 是数字 3 时为 false。

\`control.if\`、\`loop.source\`、\`loop.keyBy\` 必须包 \`{{ }}\`，不包完全失效。

## 三个业务物料的数据从哪来

它们自己都不产生结果，只负责展示与交互，结果一律由外部绑进来：

- **Lottery**：\`prizes\` 绑奖品数据源；\`resultIndex\` 绑中奖下标。九宫格最多展示
  8 个奖品。标准编排是 onCustom \`draw\` → \`[state.set 下标=-1, dataSource.refresh 抽奖接口,
  state.set 下标={{ dataSource.xxx.index }}]\`。**开抽前必须先置回 -1**，否则第二次
  点击会立刻停在上一轮结果。中奖后用 onCustom \`finish\` 开弹窗。
- **Login**：\`mode\` 设为 \`'action'\`、\`localSession\` 设为 false，\`logged\` 绑 \`{{ user.loggedIn }}\`，
  \`nickname\` / \`avatar\` 绑 \`{{ user.nickname }}\` / \`{{ user.avatar }}\`。onCustom \`login\` →
  \`{ type: 'login' }\`（浏览器走统一登录跳转，宿主里走宿主登录）；onCustom \`logout\` → \`{ type: 'logout' }\`。
  登录是否必需由页面设置决定，不要自己用 state 模拟登录态。
- **BindRole**：\`servers\` / \`roles\` / \`boundRole\` 都从数据源绑。
  onCustom \`serverChange\` → 刷新角色数据源；onCustom \`bind\` → 刷新已绑定数据源。

## 其它约束

- 不要新建 Page，根节点 ROOT 已经是了
- 不要写 \`nodeId\` / \`editing\` / \`emit\` / \`children\` 这些 props，运行时会覆盖
- 不要给 Modal 写 \`visible\`，它由弹窗动作控制
- Page 与 Modal 不吃通用样式（position / margin / opacity 等）
- 尺寸数字的单位是 750 设计稿像素；字符串原样透传（\`'100%'\`、\`'auto'\`）
- 图片地址要么是完整 URL，要么以 \`/\` 开头，不能是相对路径
- 节点 id 只在你引用**已存在**节点时才写真实 id，新建一律用 @ref

## 工作方式

动手前先 read_page 看清现状。改动要小而准——只动用户要求的部分，
不要顺手重排版面或"优化"运营手工调过的样式。
每次 apply_patches 都要写清楚 summary，那句话会原样给运营看。
`.trim();

export interface PromptContext {
  catalog: MaterialCatalog;
  /** 场景说明，由能力注册表里的场景提供 */
  scenario?: string;
}

/** 稳定前缀：随发版才变，打 cache_control */
export function buildSystemPrompt(ctx: PromptContext): Anthropic.TextBlockParam[] {
  const style = renderCommonStyleDoc(ctx.catalog);
  const text = [
    HARD_RULES,
    ctx.scenario ? `\n## 本次任务\n\n${ctx.scenario}` : '',
    '\n## 可用物料\n',
    ctx.catalog.text,
    style ? `\n## 通用样式\n\n${style}` : '',
  ].join('\n');

  return [
    {
      type: 'text',
      text,
      // 整段是稳定前缀，命中后按约十分之一计费；变动的页面与指令放在 messages 里
      cache_control: { type: 'ephemeral' },
    },
  ];
}

/**
 * 当前页面的摘要。
 *
 * 不把整份 DSL 丢给模型：一个中等复杂度的活动页 craftJson 就上万 token，
 * 而模型真正需要的是「有哪些节点、什么类型、谁是谁的孩子、绑了什么事件」。
 * 要看某个节点的完整 props 时它可以再 read_page。
 */
export function renderPageOutline(dsl: FinalDsl): string {
  const lines: string[] = [];

  const walk = (id: string, depth: number): void => {
    const node = dsl.craftJson[id];
    if (!node) return;
    const indent = '  '.repeat(depth);
    const name = node.displayName ? `「${node.displayName}」` : '';
    const control = node.control?.loop ? ' [循环]' : node.control?.if ? ' [条件]' : '';
    lines.push(`${indent}- ${id}: ${node.type.resolvedName}${name}${control}`);
    for (const child of node.nodes) walk(child, depth + 1);
  };
  walk('ROOT', 0);

  const parts = [`活动标题：${dsl.meta.title}`, '', '节点树：', ...lines];

  if (dsl.dataSources.length) {
    parts.push('', '数据源：');
    for (const ds of dsl.dataSources) {
      const detail = ds.type === 'http' ? `${ds.method} ${ds.url}` : ds.type;
      parts.push(`- ${ds.id}（${ds.name}）：${detail}`);
    }
  }

  if (dsl.events.length) {
    parts.push('', '事件绑定：');
    for (const e of dsl.events) {
      const trigger = e.trigger === 'onCustom' ? `onCustom:${e.customEvent ?? ''}` : e.trigger;
      const actions = e.actions.map((a) => a.type).join(' → ') || '（空）';
      parts.push(`- ${e.id} ${e.nodeId} ${trigger}：${actions}`);
    }
  }

  if (Object.keys(dsl.initialState).length) {
    parts.push('', `初始状态：${JSON.stringify(dsl.initialState)}`);
  }

  return parts.join('\n');
}
