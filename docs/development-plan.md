# 零代码活动页平台 · 开发规划

> **落地进度（2026-07-26）**：M0 / M1 / M2 已完成并端到端验证通过。
> 运营可在设计器里拖拽搭页、绑事件与数据源、存为模板、发布上线，
> C 端渲染全链路打通。78 项单测 + 多轮浏览器端到端验证。
> 实施中相对本文的调整记录在文末「实施偏差」一节。

> Admin（管理后台）+ Designer（拖拽设计器）+ Renderer（C 端渲染器）+ Server（NestJS）
> 对应架构图：activity-design 全链路架构与业务流程

---

## 1. 仓库结构（pnpm monorepo + Turborepo）

设计器和渲染器必须共用同一套物料组件与 DSL 协议，否则会出现"设计器所见 ≠ 线上所得"的双端漂移问题，因此强烈建议 monorepo：

```
no-code-activity/
├── apps/
│   ├── admin/                # 管理后台 + 设计器宿主（React + Vite + TanStack Router）
│   │   ├── src/routes/       # 活动管理 / 模板中心 / 活动配置编辑页
│   │   └── src/designer/     # 设计器（Craft.js 画布、工具箱、设置器、Zustand stores）
│   ├── renderer/             # C 端活动页运行时（独立构建，产物发 COS/CDN）
│   └── server/               # NestJS 后端
├── packages/
│   ├── dsl/                  # DSL 类型定义 + zod 校验 + 版本迁移（双端共享，核心资产）
│   ├── materials/            # 物料组件库（图片/视频/榜单/抽奖/表单等，双端共用）
│   ├── runtime-core/         # 运行时核心：propsParser、EventBinder、DataSourceEngine
│   ├── bridge/               # postMessage 通信协议 + 宿主(Host) SDK 桥接层
│   └── shared/               # 通用类型 / 常量 / 工具
├── docs/
└── turbo.json / pnpm-workspace.yaml
```

关键点：

- **materials 包是唯一物料来源**。每个物料导出 `{ Component, meta }`：`meta` 里的 props schema 驱动设置器面板自动生成；设计器通过 Craft.js 的 `connectors` 注入编辑行为，渲染器直接消费纯组件。一份代码，两种消费方式。
- **renderer 独立构建、体积敏感**：不引 antd、不引设计器任何代码，目标首屏 JS < 150KB gzip。
- **dsl 包是协议中枢**：Admin 保存、Server 校验、Renderer 消费全部 import 同一份类型和 zod schema。

## 2. 技术选型

| 层 | 选型 | 说明 |
|---|---|---|
| Admin/Designer | React 18 + Vite + TS + TanStack Router/Query + Zustand + antd | 路由守卫做页面权限控制 |
| 画布 | Craft.js | 图中已选定；用适配层包一遍，防止后续更换成本扩散 |
| Renderer | React 18 + Vite（独立入口）| iframe 沙箱 + 样式隔离 |
| Server | NestJS 11 + Prisma + MySQL + Redis | Redis 做库存扣减、发布锁、会话 |
| 对象存储 | 腾讯云 COS + CDN | 资源直传用服务端签名（STS 临时密钥） |
| 校验 | zod（前后端共享 schema） | validateFinalDsl 双端同源 |
| 工程 | pnpm + Turborepo + ESLint + Prettier + Vitest + CI | |

## 3. 核心协议设计（先于功能开发定稿）

### 3.1 FinalDSL（发布产物）

```jsonc
{
  "schemaVersion": "1.0.0",          // DSL 协议版本，配合迁移函数向前兼容
  "meta": {
    "activityId": "act_xxx",
    "title": "…", "startTime": "…", "endTime": "…",
    "theme": { "primaryColor": "…" },
    "share": { "title": "…", "cover": "…" }
  },
  "dataSources": [                    // DataSourceEngine 消费
    { "id": "ds_rank", "type": "http", "url": "…", "autoLoad": true, "transform": "…" }
  ],
  "craftJson": { "ROOT": { /* Craft.js 序列化节点树 */ } },
  "events": [                         // EventBinder 消费：触发器 → 动作编排
    { "nodeId": "btn_1", "trigger": "onClick",
      "actions": [{ "type": "modal.open", "target": "modal_rule" }] }
  ],
  "assets": [{ "url": "…", "type": "image", "critical": true }]  // preload 依据
}
```

### 3.2 物料协议（materials 包内每个物料的 meta）

```ts
interface MaterialMeta {
  name: string;            // 唯一标识，componentMap 的 key
  version: string;
  title: string;           // 工具箱展示名
  category: 'basic' | 'business' | 'container' | 'media';
  propsSchema: PropSchema[];   // 驱动设置器"属性/样式/事件"三面板自动生成
  events?: EventDef[];         // 可绑定的触发器（onClick、onExpose…）
  defaultProps: Record<string, unknown>;
  isContainer?: boolean;       // 是否可嵌套子节点（condition/loop/slot 容器）
}
```

### 3.3 预览通信（Designer iframe ↔ Renderer）

postMessage 协议，统一 envelope `{ type, payload, seq }`：

| 消息 | 方向 | 含义 |
|---|---|---|
| `RENDERER_READY` | R → D | 渲染器就绪，可以接收数据 |
| `RENDERER_META_INIT` | D → R | 下发活动 meta / mock 环境 |
| `CRAFT_JSON_PREVIEW` | D → R | 下发最新 DSL（编辑防抖后热更新） |
| `NODE_SELECTED` | R → D | 预览态点选节点，反向联动画布选中 |

### 3.4 manifest.json（发布描述文件）

```jsonc
{
  "activityId": "act_xxx", "version": 7, "publishedAt": "…",
  "entry": { "js": ["…/renderer.[hash].js"], "css": ["…"] },
  "dsl": "…/final-dsl.[hash].json",
  "runtime": { "hosts": ["browser", "sdk_portrait"], "requiredSdkVersion": "…" }
}
```

Renderer bootstrap 链路：`main → 拉 manifest → 拉 DSL → validateFinalDsl（容错降级）→ preloadCriticalDslImages → RendererSurface 挂载 → CanvasRenderer 递归渲染`。

## 4. 后端设计（NestJS）

### 4.1 模块划分

```
AuthModule        SSO 对接 / JWT / RBAC（角色-权限-菜单）
ActivityModule    活动 CRUD、基础信息、发布状态机
DslModule         DSL 草稿自动保存、版本快照、diff/回滚
TemplateModule    模板中心（列表/预览/收藏/从模板创建）
MaterialModule    物料注册表、版本管理（resolver 的数据来源）
AssetModule       COS 直传签名、资源登记（图片/视频/字体）
PublishModule     构建 FinalDSL → 传 COS → 生成 manifest → CDN 刷新，含发布锁与回滚
PrizeModule       奖品配置 / 库存（Redis 扣减）/ 中奖记录
ChannelModule     渠道链接生成 / 渠道参数 / 分享落地页
RuntimeModule     C 端 API：meta 下发、数据源代理、抽奖、预约、表单提交（限流+防刷）
AnalyticsModule   埋点上报接收（曝光/点击/转化），写 Kafka 或先落库
```

### 4.2 数据模型（核心表）

```
user / role / permission            RBAC 三件套
activity(id, title, status, start_time, end_time, cover, owner, channel_config…)
    status 状态机: draft → published → offline（预留 reviewing）
activity_version(id, activity_id, version, dsl_json, manifest_url, created_by)
    发布 = 生成不可变 version 快照；回滚 = 指回旧 version
dsl_draft(activity_id, dsl_json, updated_at)      自动保存，单行覆盖
template(id, title, cover, dsl_json, category, fav_count)
material(name, version, meta_json, status)
asset(id, activity_id, url, type, size, hash)
prize(id, activity_id, name, total, remaining, probability)
prize_record / form_submission / analytics_event
```

### 4.3 关键接口（REST，`/api/v1`）

- `POST /auth/login`、`GET /auth/me`
- `GET|POST /activities`、`PATCH /activities/:id`、`POST /activities/:id/copy`
- `PUT /activities/:id/draft`（自动保存，节流）/ `GET /activities/:id/draft`
- `POST /activities/:id/publish` → 返回 version + 活动 URL；`POST /activities/:id/rollback`
- `POST /assets/cos-credentials`（STS 直传签名）
- `GET /runtime/activities/:id/meta`（C 端，带 CDN 缓存）
- `POST /runtime/lottery/draw`、`POST /runtime/appointment`、`POST /runtime/forms`
- `POST /analytics/events`（批量上报）

## 5. 前端三端要点

### Admin
- TanStack Router 路由守卫：登录态 + 页面级权限码控制（对应图中"路由守卫/页面权限控制"）。
- 活动配置编辑页：基础信息 / 渠道链接 / 奖品配置 / 表单，react-hook-form + zod，草稿自动保存。
- 模板中心：列表、iframe 预览（复用 Renderer 预览通道）、收藏、"从模板创建活动"。

### Designer
- 三栏布局：工具箱（物料按 category 分组，从 MaterialModule 拉注册表）｜ IframeCanvasSurface（iframe 内跑真实 Renderer，天然样式隔离，预览即线上）｜ 设置器（属性/样式/事件三面板，由 propsSchema 自动生成表单）。
- Zustand 三 store：`canvasStore`（选中节点/节点树）、`dataPanelStore`（数据源配置）、`settingsStore`（面板 UI 态）。
- 撤销/重做用 Craft.js 内置 history；保存时 `buildFinalDslForRenderer()` 组装 FinalDSL。

### Renderer
- `componentMap` 注册制 + `CraftNodeRenderer` 递归渲染；`condition/loop/slot` 三种结构容器。
- `propsParser`：DSL 里 `{{ }}` 表达式求值。**禁用 eval**，用受限表达式解析器（如 jsep + 白名单求值器），上下文只暴露 `state / dataSource / query / user`。
- 运行时分层：`AuthRuntime`（登录态）、`MetaRuntime`、`DataSourceEngine`、`EventBinder`、`AnalyticsRuntime`（曝光用 IntersectionObserver）、`modal portal` / `toast`。
- 宿主适配（bridge 包）：`browser / game_center / ldq_pc / ldq_app / sdk 横竖屏` 各写一个 HostAdapter，统一 `login / share / downloadGame / openModal / appointment` 等 action 接口；**微信小程序用 web-view 承载 H5**，JSSDK 桥接分享等能力，不单独实现一套渲染器。

## 6. 发布链路

```
设计器点击发布
 → buildFinalDslForRenderer（剔除编辑态字段、收集 assets、events）
 → 前后端双重 validateFinalDsl（zod，同一份 schema）
 → Server：资源确权 → 生成 activity_version 快照
 → 上传 final-dsl.json + manifest.json 至 COS（版本号目录，不可变）
 → CDN 刷新 → 返回活动链接（活动域名/act/:id）
```

- Renderer JS 本身随 CI 独立发版（带 hash），manifest 里记 entry；DSL 发布与代码发布解耦。
- 灰度：manifest 支持按渠道/白名单指向不同 version；回滚只改 manifest 指针，秒级生效。

## 7. 里程碑（按 1 名后端 + 2 名前端估算，可并行压缩）

### M0 · 基建（约 1 周）
monorepo 脚手架、CI、ESLint/Prettier/Vitest、Nest 骨架 + Prisma + MySQL/Redis 接入、Auth（登录 + RBAC）、Admin 骨架（TanStack Router + 路由守卫 + 布局）。
**验收：能登录进空后台，权限路由生效。**

### M1 · MVP 闭环（约 3 周）★ 最重要
- 活动 CRUD + 列表 + 基础信息表单
- `dsl` / `materials` 包定稿协议；5–8 个基础物料（容器、图片、文本、按钮、轮播）
- 设计器最小版：Craft.js 画布 + 工具箱拖入 + 属性面板 + 保存草稿
- Renderer 最小版：直连拉 DSL、componentMap 递归渲染
- 简易发布：DSL 传 COS + 固定 entry，可访问线上页
**验收：拖一个页面 → 发布 → 手机能打开。跑通这条线，后面全是增量。**

### M2 · 设计器完整能力（约 3–4 周）
- IframeCanvasSurface + postMessage 预览协议（所见即线上）
- 事件面板 + EventBinder（modal open/close、跳转、triggerEvent）
- DataSourceEngine + 数据面板；`propsParser` 表达式绑定
- condition / loop / slot 容器；自动保存 + 版本记录 + 回滚
- 模板中心（保存为模板 / 从模板创建 / 预览 / 收藏）
**验收：不写代码可配出"榜单 + 弹窗 + 接口数据"的动态活动页。**

### M3 · 发布与业务能力（约 3 周）
- 完整发布流水线：manifest、版本快照、CDN 刷新、灰度、回滚
- 奖品配置 + 抽奖接口（Redis 库存 + 防刷）、表单提交、活动预约、渠道链接
- AuthRuntime 对接 SSO；AnalyticsRuntime 埋点上报 + 基础报表
**验收：一场真实营销活动可全流程上线。**

### M4 · 多宿主与打磨（约 2–3 周）
- bridge 宿主适配：SDK 横竖屏、game_center、微信小程序 web-view
- 性能：critical 资源预加载、骨架屏、分包、监控告警（DSL 校验失败率、白屏率）
- 权限细化、操作审计、物料版本升级策略
**验收：同一 DSL 在 ≥3 个宿主正常运行，核心指标有监控。**

## 8. 关键决策与风险

| # | 决策/风险 | 说明 |
|---|---|---|
| 1 | 双端共用物料是生死线 | 任何"设计器一套组件、渲染器一套组件"的捷径都会导致长期漂移，必须从 M1 就执行 |
| 2 | Craft.js 维护较慢 | 用适配层封装其 API（节点操作、序列化），画布层可替换；不要让 Craft.js 类型渗透进 DSL |
| 3 | 表达式求值安全 | DSL 来自服务端但仍按不可信输入处理：解析器 + 白名单上下文，杜绝 eval/new Function |
| 4 | 小程序宿主 | 不做小程序原生渲染器，用 web-view + JSSDK 桥接，成本降一个量级 |
| 5 | DSL 版本兼容 | schemaVersion + 迁移函数链（migrate 1.0→1.1→…），老活动页永远可打开 |
| 6 | 抽奖/库存 | Redis Lua 原子扣减 + 落库对账，接口限流 + 风控埋点，从 M3 起就按线上标准做 |

---

## 9. 实施偏差（M0/M1 落地后回填）

实现过程中与本文原始规划不一致的地方，以及为什么这么改：

| # | 原规划 | 实际做法 | 原因 |
|---|---|---|---|
| 1 | Craft.js 承载画布 | M1 先用自研 store（`stores/designer.ts`）管理节点树，DSL 结构仍按 Craft.js 序列化格式定义 | DSL 格式已对齐，M2 接入 Craft.js 时只换画布层，Renderer 与协议零改动。先跑通主链路比先引框架更重要 |
| 2 | `jsep + 白名单求值器` | 自研受限表达式解析器（`runtime/expression.ts`） | 少一个依赖，且能精确控制语义：禁函数调用、禁原型链访问、标识符只解析到显式上下文。14 项安全测试覆盖 |
| 3 | 工作区包各自构建 dist | Vite 侧别名到 TS 源码 | 后端要 CJS、浏览器要 ESM，双格式构建脆弱且易错；直接编译源码更稳，还白得跨包 HMR。服务端仍消费 CJS dist |
| 4 | Redis 必需 | 未配 `REDIS_URL` 时锁降级为进程内实现 | 让 `pnpm dev` 不依赖外部服务。启动日志明确告警，生产必须配 |
| 5 | 物料 meta 用 zod 校验 | 运行时用纯类型辅助函数，协议一致性交给 CI 测试 | 渲染器体积敏感，物料包不该在运行时依赖 zod |
| 6 | 端口 3000/3306/6379/5174 | 3100/3307/6381/5180 | 开发机上这些端口常被其它项目占用。渲染器额外开 `strictPort`，端口漂移直接失败 |

### 实现中发现、值得记住的坑

- **zod 4 的 `.default()` 取的是输出类型**，嵌套 schema 想让内层默认值生效必须用 `.prefault()`。
- **iframe 加 `sandbox="allow-scripts"` 而不带 `allow-same-origin`** 会让其变成不透明源，
  指定 `targetOrigin` 的 postMessage 直接失效。跨端口本身已有源隔离，不必加 sandbox。
- **antd Tree 的 `defaultExpandAll` 对异步加载的树数据不生效**，需受控 `expandedKeys`。
- **发布前必须先落库当前编辑**，否则发出去的是上一次自动保存的内容。
- **删除节点要连子树和事件绑定一起清**，否则悬空引用会拖到发布校验时才暴露。

### M2 完成情况（2026-07-26）

全部完成：事件编排面板、数据源面板（含「试跑一次」看返回结构）、
condition/loop 结构容器配置、画布交互层（点选/悬停描边/拖拽落点）、
资源上传与图片选择器、模板中心（搜索/分类/收藏/预览/从模板创建/下架）、
活动基础信息编辑，以及按设计稿的 antd 界面重构。

**slot 具名插槽容器（M2 三容器最后一个，2026-08-08 补齐）**：
- renderer `CanvasRenderer` 按物料 `meta.slots` 渲染 `node.linkedNodes`，注入 `slotContent` prop。
- 新增 `Card` 物料（header/body/footer 三插槽，body 可回退普通子节点）。
- 设计器：`addToSlot` 动作（替换同名插槽）、NodeTree 展示 slot 子节点、设置面板
  `SlotEditor`（往各插槽选物料填入/移除）；removeNode/relocateNode 同步清理 linkedNodes 引用。

M2 期间通过真实使用暴露并修复的缺陷（都补了回归测试）：

| 缺陷 | 影响 | 根因 |
|---|---|---|
| 表达式绑定正则吞并 | 多绑定文案渲染成空 | 惰性量词跨过了中间的 `}}` |
| vw 适配未生效 | 750 稿在 390 屏上整体放大近一倍 | 物料输出字面 px，适配形同虚设 |
| EditorOverlay 无限渲染 | 设计器卡死 | effect 缺依赖数组且每次 setState 新对象 |
| 草稿与发布共用严格 schema | 清空必填项后草稿再也存不进去 | 未区分「形状」与「完整性」两类校验 |
| 基础信息与 DSL meta 不同步 | 改完活动时间倒计时仍读旧值 | 两份数据各自为政，缺少投影 |
| cover 空串盖进 meta | 整个画布空白 | `??` 只挡 null 不挡空串 |

### M3 起点

优先级排序：① 奖品配置与抽奖接口（Redis Lua 原子扣减 + 防刷）→
② 表单提交与活动预约 → ③ 渠道链接与分享落地页 → ④ SSO 对接 →
⑤ 埋点上报与基础报表 → ⑥ COS STS 直传替换服务端中转。

**① 已完成（2026-08-06）**：`PrizeModule`（admin CRUD + Redis 库存权威）、
`GET /runtime/activities/:id/prizes`（公开列表）、`POST /runtime/lottery/draw`
（Lua 原子选奖+扣减、limitPerUser、按天限流 100/人、无 Redis 降级进程内）。
renderer 的 `lottery.draw` 动作已接入（写回 `state.prizeIndex`），admin 活动详情页
新增「奖品配置」卡片。

**② 已完成（2026-08-07）**：表单提交 + 活动预约。
- 表单：新增 `Form` 物料（字段 JSON 配置 + 必填/数字校验，提交 emit values）、
  `POST /runtime/forms` 落 `form_submission`、renderer `form.submit` 动作。
- 预约：新增 `appointment_record` 表（`@@unique(activityId, sceneId, userId)` 去重）、
  `POST /runtime/appointment`（重复预约返回 already）、`Appointment` 物料 +
  renderer `appointment` 动作。容量/时段配置留待扩展。

**③ 已完成（2026-08-07）**：渠道链接与分享落地页。
- `ChannelModule`：`GET/POST/DELETE /channels`，链接 = `ACTIVITY_BASE_URL/act/:id?ch=<code>&<params>`
  （复用 `buildActivityUrl`），同一活动渠道码唯一，重复返回 400。
- admin 活动详情页新增「渠道链接」卡片：建渠道（名称/码/透传参数 JSON）+ 一键复制链接 + 删除。
- 落地页能力原生就绪：renderer 表达式上下文已有 `query`，运营用 `{{ query.ch }}` 做渠道差异化展示；
  browser host 的分享带当前 URL（含渠道参），渠道可自然传播。

**⑤ 已完成（2026-08-08）**：埋点上报与基础报表。
- `AnalyticsModule`：`POST /analytics/events`（批量 ≤100 条、按 IP 每分钟限流、UA 识别
  wechat/mobile/desktop、带渠道归因）；`GET /analytics/report`（PV/点击/转化 + 点击 Top 节点 +
  近 7 天 PV 趋势，运营报表需 activity:view）。
- renderer `analytics.ts`：合批上报（攒 20 条或 3 秒空闲，卸载 sendBeacon 兜底）；PV 曝光、
  点击（emit 拦截）、转化（抽奖中奖/表单提交/预约成功）三处埋点，带 `?ch=` 渠道归因。
- admin 活动详情页新增「数据报表」卡片（PV/点击/转化统计 + Top 节点 + 每日 PV 列表）。
- 逐节点曝光（IntersectionObserver + DOM 打标）留作后续，v1 是页面级 PV。

剩余：④ SSO、⑥ COS STS。

---

## 10. AI Agent 接入（本文之外的增量）

参照得物《活动搭建平台 AI 实践》第二版范式落地，详见
[AI Agent 技术文档](ai-agent.md)。这里只记与本文原规划的关系与新增的决策。

| # | 决策 | 说明 |
|---|---|---|
| 1 | 工作流引擎用 LangGraph，没有自研 | 与前几次「能自己写就少一个依赖」的取舍相反。理由是 interrupt/resume + Checkpointer 这套人机协同语义自己实现代价不低，而它恰好是这版的核心。代价是得自己补一个 MySQL 检查点存储——官方只有 SQLite/Postgres/Redis |
| 2 | AI 不直接产出 FinalDSL，只产出补丁 | 节点 id 的格式、唯一性、parent/nodes 双向一致跟「页面长什么样」无关，却每错一次就是一次白屏。模型用 @ref 占位，真实 id 由 applyPatches 生成，从结构上就没机会写错 |
| 3 | 物料清单读 material 表，不 import @nca/materials | 那个包是 ESM + React，拉进 CJS 服务端要把 React 带进生产依赖；且表里的 enabled 开关应当同时对模型生效 |
| 4 | 工具 schema 由 zod 派生，不手写 | 协议加一个算子模型第二天就会用；测试断言「工具暴露的算子数 == 协议里的算子数」，漂移立刻红 |
| 5 | 权限码新增 ai:use / ai:publish | 不复用 activity:edit —— 出问题时要能单独关掉 AI 而不影响手工搭建 |
| 6 | SSE 手写，不用 @Sse | 全局 TransformInterceptor 会把事件包坏，AllExceptionsFilter 会在流中途二次写响应 |

### 实施中发现、值得记住的坑

- **LangGraph 恢复时会把整个节点从头再跑一遍**。interrupt 前面放任何昂贵或有
  副作用的动作，都会在 resume 时重复执行。必须让 interrupt 独占一个节点，
  准备工作放前一个节点、把卡片写进 state。
- **LangGraph 把 falsy 的 resume 当成「没给输入」**，`Command({ resume: false })`
  直接抛 `EmptyInputError`。「拒绝」这类决策不能写成裸布尔。
- **中断卡片不能由节点 emit**，否则 resume 重跑节点时会把同一张卡片再推一遍。
  应在 invoke 返回后从 `getState().tasks[].interrupts` 统一读。
- **AI 产物落画布必须走新增的 `applyDsl` 而不是 `load`**。load 会清空撤销栈并把
  dirty 置回 false，结果是这次生成既撤销不了也不会自动保存，刷新即丢。
- **`state.set` 原本不做表达式求值**（已修）。抽奖标准闭环依赖「把接口返回的
  中奖下标写进 state」，不求值这条链路在线上是断的——点了没反应，还不报错。
  同时修掉了「同一事件内后一个动作读不到前一个动作刚写入的值」。
