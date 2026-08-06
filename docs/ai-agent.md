# AI Agent 接入技术文档

> 参照得物《活动搭建平台 AI 实践》第二版的范式落地。
> 代码位置：`apps/server/src/modules/ai`、`apps/admin/src/routes/AiWorkbenchPage.tsx`、
> `apps/admin/src/components/designer/AiPanel.tsx`、`packages/dsl/src/patch.ts`。

---

## 1. 这一版要解决的是什么

「AI 帮你填字段」不会带来质变——运营仍然是流程的主体，AI 只是把某几个输入框
预先填上，人还得从头走到尾。真正的变化是**让 AI 驱动流程，人只在关键节点确认**。

所以这一版的形态是：运营说一句「做个夏日抽奖活动，7 月 1 日到 7 月 31 日，
九宫格」，剩下的解析需求、建活动、选模板、配组件、绑事件、生成页面全部由工作流
推进；运营做的事收缩成两件——**提供信息**和**在卡片上确认**。

对应到本仓库，有两个入口：

| 入口               | 形态                                   | 适用                 |
| ------------------ | -------------------------------------- | -------------------- |
| `/ai` 工作台       | 六张中断卡片串起的工作流，右侧实时预览 | 从零把一个活动搭起来 |
| 设计器右侧 AI 面板 | 一问一答，出 diff 后人工点应用         | 已经搭好了，想改一处 |

两者共用同一套补丁协议与校验，区别只在**要不要走流程**。

---

## 2. 架构分层

```
┌──────────────────────── 前端 ────────────────────────┐
│ /ai 工作台            设计器 AI 面板                  │
│  ├ InterruptCard      ├ 补丁 diff 预览                │
│  └ PreviewFrame       └ applyDsl（走 commit，可撤销）  │
│         ↕ SSE（fetch + ReadableStream，带 Bearer）    │
└───────────────────────────────────────────────────────┘
                          ↕
┌──────────────── apps/server/modules/ai ───────────────┐
│ ai.controller   手写 SSE，绕开全局拦截器与异常过滤器    │
│ ai.service      EventQueue 把图的 push 桥接成可 await   │
│ workflow/graph  LangGraph 有向图 + 六个 interrupt      │
│ workflow/injection  双轨注册的条件注入规则表           │
│ capability/registry 平台能力：权限 + 确认策略          │
│ llm/catalog     物料清单（读 material 表，非 import）  │
│ llm/tools       工具 schema（z.toJSONSchema 派生）     │
│ llm/prompt      system prompt（前缀打 cache_control）  │
│ checkpointer    PrismaCheckpointSaver（MySQL）         │
└───────────────────────────────────────────────────────┘
                          ↕
┌──────────────── packages/dsl ─────────────────────────┐
│ patch.ts        补丁协议 + applyPatches（唯一写通道）   │
│ validate.ts     落库前的结构与引用完整性校验            │
└───────────────────────────────────────────────────────┘
```

**AI 永远不直接写 DSL**：它产出补丁 → `applyPatches` 生成新 DSL →
`validateFinalDsl` 校验 → 走既有的 `DraftService.save`。
和运营手工搭建走的是同一条落库路径，不存在「AI 专用后门」。

---

## 3. 工作流与六个中断点

`workflow/graph.ts`。节点分两类：**准备节点**（干活）与**确认节点**（只有一句
`interrupt`）。

```
START
  → intake        LLM 解析需求
  → intake_confirm      ① 确认活动基本信息        [edit]
  → template      拉模板列表
  → template_confirm    ② 选择会场模板            [respond]
  → create        ★ 第一次写操作：创建活动 + 初始草稿
  → plan          LLM 规划组件 + 条件注入
  → plan_confirm        ③ 确认组件清单            [respond·多选]
  → fields        算出还缺哪些接口地址
  → fields_confirm      ④ 补充接口地址            [edit]（没有要补的就跳过）
  → build         LLM 出补丁 → applyPatches → 存草稿
  → build_confirm       ⑤ 预览并确认              [approve]
        ├ reject → 回到 plan
        └ approve ↓
  → publish_ask
  → publish_confirm     ⑥ 确认发布上线            [approve·危险]
  → publish_do    ★ 发布
END
```

### 中断点的三种类型

| kind      | 语义                               | 用在哪             |
| --------- | ---------------------------------- | ------------------ |
| `approve` | 高风险操作前拦一道，人点确认或放弃 | 预览确认、发布     |
| `edit`    | AI 填好了，人过一遍并微调          | 基本信息、接口地址 |
| `respond` | 信息不够，AI 得问一句              | 选模板、选组件     |

每张卡片都带 `why` / `done` / `missing` 三个字段，分别回答「为什么需要你」
「AI 已经做了什么」「还缺什么」。这不是装饰——语焉不详的确认框和假进度条一样
都在消耗信任，而 AI 产品的信任是一点点建立起来的。

### 两条结构性约束

**副作用只发生在人点头之后。** 活动记录要等基本信息与模板都确认过才创建
（`create` 节点排在两个确认节点之后），否则运营只是打开看一眼，库里就凭空多出
一条脏活动。`graph.test.ts` 把这个顺序钉死了。

**`interrupt` 必须独占一个节点。** LangGraph 恢复时会把整个节点**从头再跑一遍**
——第一版把 `interrupt` 写在 `build` 末尾，结果每次 resume 都会重新调一次模型、
重新存一次草稿。改成「准备节点算好卡片写进 `state.card`，确认节点里只剩一句
`interrupt`」之后，一轮下来模型恰好被调用三次，测试直接断言这个次数。

同理，**中断卡片不由节点 `emit`**，而是 `invoke` 返回后由 service 从图快照
（`getState().tasks[].interrupts`）统一读取——节点内 emit 会在 resume 时把
同一张卡片重复推给前端。

---

## 4. 补丁协议：AI 修改页面的唯一通道

`packages/dsl/src/patch.ts`。**模型不产出 `FinalDsl`，只产出一串补丁算子。**

三个理由：

1. 节点 id 有格式约束（`^[A-Za-z_][A-Za-z0-9_-]*$`）、要全局唯一、还要维持
   `parent` 与 `nodes` 的双向一致。这些跟「页面该长什么样」毫无关系，却每错一次
   就是一次线上白屏。
2. 改一个按钮文案不该重写整页——既贵，又容易顺手抹掉运营手工调过的样式。
3. 补丁天然能算 diff，落库前能给人看清「到底要动哪几处」，这正是中断卡片需要的。

### 算子

`addNode` / `updateProps` / `removeNode` / `moveNode` / `setControl` /
`bindEvent` / `removeEvent` / `addDataSource` / `removeDataSource` /
`setMeta` / `setInitialState`。

### @ref：模型不碰真实 id

新建节点时模型起一个临时句柄，后续补丁用同一个句柄指向它，真实 id 由
`applyPatches` 生成：

```json
[
  {
    "op": "addNode",
    "ref": "@win",
    "material": "Modal",
    "position": { "mode": "appendTo", "target": "ROOT" }
  },
  {
    "op": "addNode",
    "ref": "@lot",
    "material": "Lottery",
    "position": { "mode": "before", "target": "@win" }
  },
  {
    "op": "bindEvent",
    "target": "@lot",
    "trigger": "onCustom",
    "customEvent": "finish",
    "actions": [{ "type": "modal.open", "modalId": "@win" }]
  }
]
```

动作里引用节点的字段（`modalId` / `nodeId` / `formNodeId`）同样支持 `@ref`。
为此 `bindEvent.actions` 先收成松散对象，等 `@ref` 换成真实 id 后再过
`actionSchema` 严格校验——否则「打开我刚建的那个弹窗」这种最自然的写法会在
解析阶段就被 `identifier` 正则判死。

### 声明式位置编排

位置用「放在谁前面 / 后面 / 里面」声明，而不是下标：

```
{ mode: 'appendTo' | 'prependTo' | 'before' | 'after', target: '@ref' | '真实 id' }
```

把**位置意图**和**位置计算**分开，条件注入才谈得上——系统自动补进来的组件用
同一套声明，不需要知道页面上已经有什么。

### 出错策略：跳过并记账，不是整批掀掉

模型偶尔会引用一个不存在的节点。为此丢弃另外九条正确的改动毫无道理，所以单条
出错只跳过这一条并记一条 issue。但**依赖被跳过节点的补丁会一起跳过**（`@ref`
解析不到），避免把半截结构写进 DSL。

`patch.test.ts` 覆盖：越界物料、ROOT 之外新建 Page、往非容器塞子节点、移进自己
的子树、删节点后的悬空引用清理，并断言一整套抽奖闭环补丁的产物能过发布级校验。

---

## 5. 能力注册表与权限模型

`capability/registry.ts`。物料与动作的能力**一律从 `materialMetas` /
`actionSchema` 派生**（仓库的单一来源约定，双写必然漂移）；这张表只登记
**平台级操作**，每项声明三件事：

| 能力               | 权限         | 确认策略                 |
| ------------------ | ------------ | ------------------------ |
| `read_page`        | —            | `none`（读操作直接执行） |
| `list_templates`   | —            | `none`                   |
| `apply_patches`    | `ai:use`     | `approve`（出卡片）      |
| `save_draft`       | `ai:use`     | `approve`                |
| `publish_activity` | `ai:publish` | `human`（必须人工）      |

**中断策略由这张表派生**，而不是散落在各节点的 `if` 里。工具集也按调用方权限
裁剪——无权发布的人，模型那边压根看不到发布这个工具。

权限分级的依据是风险：读权限的风险上限是查到不相关的东西；写权限可能产生脏
数据；发布权限直接影响线上。所以 `ai:use` / `ai:publish` 单独成码，而不是复用
`activity:edit` / `activity:publish`——出问题时要能单独把 AI 关掉，而不影响运营
手工搭建。

> 注意 `JwtPayload.permissions` 是登录时快照进 token 的，改完权限重跑 seed 后
> **需要重新登录**才拿得到 `ai:use`。

---

## 6. 提示词与成本

`llm/prompt.ts` + `llm/catalog.ts`。

模型看到的东西**没有一处是手写维护的**：

- **物料清单**读 `material` 表，不是 `import @nca/materials`。那个包是 ESM +
  React，拉进 CJS 服务端要把 React 一起拖进生产依赖；而且表里有 `enabled` 开关，
  运营临时下架的物料对模型也应该同时消失，否则 AI 会热情推荐一个工具箱里根本
  找不到的组件。
- **补丁工具的入参 schema** 由 `dslPatchSchema` 经 `z.toJSONSchema` 转出来。协议
  加一个算子，模型第二天就会用。`tools.test.ts` 直接断言工具暴露的算子数量等于
  协议里的算子数量，漂移会立刻红。

### 缓存

system prompt 分两段：**随发版才变**的部分（角色、硬约束、物料清单）打
`cache_control: ephemeral`，**每次都变**的部分（当前页面、用户指令）放 messages。
前缀命中后读取成本降到约十分之一，而这恰恰是最长的一段。

页面只给**节点树摘要**而不是整份 DSL——中等复杂度的活动页 `craftJson` 就上万
token，模型真正需要的是「有哪些节点、什么类型、谁是谁的孩子、绑了什么事件」，
要细节可以再 `read_page`。

### 模型与参数

| 项           | 值                                 | 说明                                        |
| ------------ | ---------------------------------- | ------------------------------------------- |
| 模型         | `claude-opus-5`                    | $5 / $25 per MTok，1M 上下文                |
| `max_tokens` | 64000                              | **必须流式**，非流式会先撞 SDK 的 HTTP 超时 |
| `thinking`   | `adaptive` + `display: summarized` | 默认 `omitted` 的话前端只看到一段长空白     |
| `effort`     | `high`（可配）                     | 编排类任务起步 `high`，可往下 sweep         |

不发 `temperature` / `top_p`——Opus 5 已移除，发了直接 400。
读 `content` 前**必须先判 `stop_reason === 'refusal'`**，拒答时 content 可能是空的。

> **走第三方网关时**（`ANTHROPIC_BASE_URL` 指向网关，后端是 deepseek 这类）：
> - `AI_THINKING=off`——这类后端强制开 thinking 且不认 thinking + `tool_choice` 组合，会 400。
> - `AI_TOOL_CHOICE=auto`——同上原因，强制 `{type:'tool'}` 会被拒，降级成 `auto`；
>   build / edit 节点此时只给模型 `apply_patches` 一个工具，模型没调工具会自动重试一次。
> 另外这类网关的 SSE `message_start` 常缺 `content` 字段，`AnthropicClient` 里有一个
> `gatewayFetch` 在 fetch 层把 `content: []` 补上，否则老版 SDK 的 MessageStream 直接崩。

---

## 7. Checkpointer

`checkpointer/prisma-checkpointer.ts`，表 `ai_checkpoint` / `ai_checkpoint_write`。

LangGraph 官方只提供 SQLite / Postgres / Redis 三种实现，本项目是 MySQL，只能
自己补。没有退而求其次用 `MemorySaver` 的余地：中断等的是**人的决策**，可能几
分钟，也可能隔一夜再回来点「确认发布」，进程内存活不过一次重启。Redis 的 TTL
语义跟「等人」也对不上——真正需要的是持久化加可审计，那就是数据库。

表结构与字段名对齐官方实现，将来官方出了 MySQL 版数据可以平移。
`prisma-checkpointer.test.ts` 用内存假表跑**真实的 LangGraph 图**，断言的是契约
而非存取本身：图在 interrupt 处停住，换一个 saver 实例（模拟服务重启）拿同一个
`thread_id` 回来能从断点接着跑；两条 run 并行不串线；`deleteThread` 只清自己那条。

> ⚠️ **LangGraph 把 falsy 的 `resume` 当成「没给输入」**，
> `new Command({ resume: false })` 直接抛 `EmptyInputError`。
> 所以「拒绝」这类决策**不能写成裸布尔**，必须用对象包一层
> （`AiResume` 因此设计成 `{ decision, fields?, choices?, message? }`）。

---

## 8. 前后端通信

**SSE，手写而不是用 `@Sse`。** 全局 `TransformInterceptor` 会把每个事件对象包成
`{code,message,data}`，把 SSE 数据结构破坏掉；`AllExceptionsFilter` 又会在流中途
`res.status().json()`，那时响应头早已发出，只会得到一个二次写入的报错。
`@Res()` 手写把两者都绕开，并在 handler 内 try/catch 把异常转成 error 事件。

前端用 `fetch + ReadableStream` 而不是 `EventSource`——后者带不了
`Authorization` 头，那就得为 SSE 单开一条免鉴权路径。

**驱动与恢复共用一个接口**：`POST /ai/runs/:id/stream`，带 `resume` 就是从断点
续，不带就是从头跑。对 LangGraph 来说本来就是同一件事。

| 接口                       | 用途                                                  |
| -------------------------- | ----------------------------------------------------- |
| `POST /ai/runs`            | 创建运行，返回 runId                                  |
| `GET /ai/runs/:id`         | 运行详情，**断线重连靠它补齐前情**（不依赖 SSE 重放） |
| `POST /ai/runs/:id/stream` | 执行 / 恢复，SSE                                      |
| `POST /ai/edit/stream`     | 设计器局部编辑，SSE                                   |

事件类型见 `packages/shared/src/ai.ts` 的 `AiEvent`：
`status` / `thinking` / `text` / `patch` / `dsl` / `interrupt` / `done` / `error`。

---

## 9. 设计器里落地 AI 产物

**必须走 `applyDsl`，不能走 `load`。** `load` 会清空 `past` / `future` 并把
`dirty` 置回 `false`，于是这次生成既撤销不了，也不会触发 1.5s 防抖自动保存——
运营刷新一下页面，生成的东西就没了。`applyDsl` 走 `commit`，一次生成正好等于
一步撤销，且照常进入自动保存。`designer.ai.test.ts` 把这两条和 `load` 的对照
都钉死了。

输入框必须用 `Input.TextArea`：设计器全局监听 `document` 的 `keydown`，非输入框
焦点下按 Delete 会把选中的组件删掉。

---

## 10. 怎么扩展

| 想加什么       | 改哪里                                              | 要不要改 prompt                   |
| -------------- | --------------------------------------------------- | --------------------------------- |
| 新物料         | `packages/materials` + 重跑 seed                    | **不用**，清单从 material 表派生  |
| 新补丁算子     | `packages/dsl/src/patch.ts` 的联合 + `applyPatches` | **不用**，工具 schema 从 zod 派生 |
| 新平台能力     | `capability/registry.ts` 加一项                     | 不用                              |
| 新条件注入规则 | `workflow/injection.ts` 的 `INJECTION_RULES`        | 不用                              |
| 新中断点       | `graph.ts` 加一对「准备节点 + 确认节点」            | 不用                              |
| 新硬约束       | `llm/prompt.ts` 的 `HARD_RULES`                     | 要                                |

---

## 11. 已知限制

1. **`build` 节点只让模型出一轮补丁**（`tool_choice` 强制 `apply_patches`），
   没有做「模型看到校验报错后自己改」的回环。目前靠 prompt 里的硬约束 +
   跳过并记账兜住，复杂页面可能有若干条补丁不生效，会在卡片上列出来。
2. **三个动作仍未接入**（`appointment` / `form.submit` / `component.trigger`）。
   `lottery.draw` 已于 2026-08-06 接入：走 `POST /runtime/lottery/draw`
   （PrizeModule，Redis Lua 原子扣减 + limitPerUser + 按天限流），renderer 动作
   把返回的下标写回 `state.prizeIndex` 让物料落停。其余三个仍是占位 toast，
   已写进 prompt 黑名单，服务端没有做二次拦截。
3. **`computed` 数据源只在挂载时算一次**，不随 state 变化。AI 不能用它做派生值。
4. **未接 `fallbacks` 参数**。Opus 5 的安全分类器可能拒答（`stop_reason: refusal`），
   当前只是如实报错给运营，没有自动回落到 Opus 4.8。要开的话在
   `anthropic.client.ts` 里加 `betas: ['server-side-fallback-2026-07-01']` +
   `fallbacks: 'default'`。
5. **多实例部署需要 `REDIS_URL`**：未配时发布锁退化为进程内实现。

---

## 12. 配置

```bash
# apps/server/.env
ANTHROPIC_API_KEY=sk-ant-...     # 留空则 AI 接口报「未配置」，其余功能不受影响
ANTHROPIC_BASE_URL=              # 走代理/网关时填，直连官方留空
AI_MODEL="claude-opus-5"
AI_MAX_TOKENS=64000
AI_EFFORT=high                   # low | medium | high | xhigh | max
AI_THINKING=adaptive             # adaptive | off；走网关/非 Claude 后端用 off
AI_TOOL_CHOICE=force             # force | auto；走网关/非 Claude 后端用 auto
AI_MAX_PATCHES_PER_RUN=80
```

```bash
pnpm --filter @nca/server prisma:push      # 建 ai_run / ai_run_step / ai_checkpoint*
pnpm --filter @nca/server prisma:generate
pnpm --filter @nca/server seed             # 灌 ai:use / ai:publish 权限码
# 然后重新登录一次——权限是登录时快照进 token 的
```

**Node 版本**：本仓库 `.nvmrc` 锁 v22.23.1。低于 22.12 的 Node 跑不了渲染器测试
（jsdom 依赖链里有 ESM 包，`require(ESM)` 在旧版本上直接报错），进 repo 先
`nvm use`。
