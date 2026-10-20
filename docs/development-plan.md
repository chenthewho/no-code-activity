# 零代码活动页平台 · 开发规划

> **落地进度（2026-10-20）**：M0 – M4 全部完成。M3 的 SSO 与 COS STS 直传、M4 的多宿主、
> 性能、监控告警、权限细化、物料版本升级策略均已落地并端到端验证。此后补齐了 CI、灰度发布、版本对比、
> 逐节点曝光、预约场次（容量 / 时段），以及 AI 的两条已知限制（computed 数据源实时重算、出补丁修正回环），351 项单测。
> 实施中相对本文的调整记录在文末「实施偏差」一节，各里程碑的完成情况与踩过的坑见第 9 节。

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
  renderer `appointment` 动作。~~容量/时段配置留待扩展~~ → 2026-10-20 已补齐，见下方「预约场次」。

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
- ~~逐节点曝光留作后续，v1 是页面级 PV~~ → 2026-10-20 已补齐，见下方「逐节点曝光」。

**M4 · 操作审计（2026-08-08）**：`audit_log` 表 + `@Audit` 装饰器 + 全局
`AuditInterceptor`（成功变更后自动记录 userId/action/资源/ip/请求体），已应用到
活动（create/update/remove/copy/publish/rollback/status）、模板、奖品、渠道的变更接口；
`GET /audit-logs`（system:manage）+ admin「操作审计」页。草稿自动保存不入审计（太吵）。

**④ 已完成（2026-10-19）**：统一登录（C 端 + 后台）。
- OIDC 授权码 + PKCE（S256），没引 openid-client：只用「拼授权地址 → 换令牌 → 取 userinfo」三步，
  身份以 userinfo 为准，不需要本地验 id_token。C 端与后台共用一个回调 `/sso/callback`，靠 state 分流；
  state 与登录票据走 Redis 一次性取（Lua GET+DEL）。
- 回跳 URL 只带 60 秒的一次性票据（`nca_ticket`），不带 token；渲染器启动时换 token 并立刻抹掉地址栏里的票据。
- C 端用户是独立的 `runtime_user`（provider + externalId 唯一），C 端 token 用派生密钥 + `aud=nca-runtime` 签发，
  与后台 token 互不通用。
- 宿主登录：桥接返回一次性 code，服务端 POST 到 `HOST_AUTH_VERIFY_URL` 换身份；小程序外层 `wx.login` 换票据。
  旧协议「桥接直接报 userId」只当访客标识。
- 活动配置了登录方式（`meta.auth.loginMode ≠ none` 或 `required`）时，抽奖 / 表单 / 预约拒绝访客并返回
  `reason: LOGIN_REQUIRED`，渲染器据此拉起登录后重试——此前 body 里自报的 userId 换一个就能绕过按人限次。
- 本地 `SSO_PROVIDER=mock` 是一个按真协议说话的小 IdP，跑的就是对接真实 IdP 的同一套客户端代码；生产环境配 mock 启动即失败。
- **登录绑定发起它的浏览器（防登录 CSRF）**：发起前浏览器生成 nonce 存 sessionStorage 并随授权请求带上，
  票据记下它，换票必须带回同一个值——别人转发来的带票据链接（或截获的 code/state 回调链接）在这里换不了，
  换不了时保持本机原有登录态。小程序票据没有浏览器 nonce 可绑，只允许在小程序宿主里换。
- 后台 SSO 首次登录自动开户，缺省**不授予任何角色**（`SSO_ADMIN_DEFAULT_ROLE` 留空）——C 端与后台往往共用一个 IdP，
  任何活动参与者都能走到这一步；SSO 只证明「你是谁」，权限由管理员授予，未授权的账号落到「暂无可用权限」页。

**⑥ 已完成（2026-10-19）**：COS 存储 + STS 临时密钥直传。
- COS 签名（sha1）与云 API TC3-HMAC-SHA256 自实现，没引两个 SDK；单测期望值由官方 SDK 计算。
- 直传：`upload-ticket`（按 SHA-256 去重 + 向 STS 申请「只能 PutObject 这一个 key」的临时密钥并预签 PUT）→
  浏览器直传 → `upload-complete`（HEAD 确认对象到了、大小与类型一致、只认本人签发的 uploadId 才登记）。
  永久密钥从不出服务端，临时密钥本身也不下发——只给一个 10 分钟内有效的预签请求；未配 COS 时回落服务端中转。
- 直传的哈希是浏览器报的、服务端不复核：直传对象的 key 带上 uploadId（各传各的，覆盖不了别人的对象），
  这类素材记为 `hashVerified=false`，只给上传者本人复用；服务端中转算出的哈希才全局去重。
- 产物与素材按内容寻址，一律 `Cache-Control: immutable`，不需要 CDN 刷新——回滚只切数据库指针。
- 桶需配跨域规则（见 `.env.example`）。

**灰度发布（2026-10-20，补齐 M3「完整发布流水线」里的灰度）**：
- 发布时可选灰度：生成同样不可变的版本快照，只挂到 `grayVersion` 上，全量指针不动。规则三选任一命中——
  渠道码（先给内部测试渠道看）、白名单（登录用户 id 或访客 id）、按设备分桶的比例（FNV-1a 稳定分桶，
  从 10% 放到 30% 时原来那批人不会被换出去）。
- C 端 DSL 接口按访客（`?gid=` 设备访客 id、`?ch=` 渠道、C 端 token）选版本，响应头 `X-NCA-Version` 告诉渲染器看到的是哪版，
  `Cache-Control: private` 防止被共享缓存；index.html 的内联预取与 `dslRequest` 拼同一个请求（有单测逐字对比）。
- 埋点与健康上报都带版本号，监控看板按活动筛选时有「按版本」对比，新版失败率明显高于旧版时标红。
- 活动详情页的灰度卡片：调整范围、转全量（只切指针）、停止灰度；全量发布会结束进行中的灰度；
  灰度期间新旧两版登录要求不同时，参与接口按更严的执行。

**版本对比（2026-10-20，补齐 DslModule 规划的 diff）**：
- `@nca/dsl` 的 `diffDsl` 按运营看得懂的单位比：组件新增 / 删除 / 属性改动（逐层到叶子路径，列表整体比）/
  挪位置 / 显隐、条件循环、插槽、物料版本；事件绑定、数据源按 id 增删改；页面设置与初始状态逐字段。
- 「挪位置」按同一容器里留下来的兄弟节点取最长公共子序列判断——前面插入或删掉一个组件不会连累后面的兄弟；
  对象键顺序、活动 id、设计器给老节点补上的基线物料版本号都不算改动。
- 入口：发布历史每一版「对比上一版」（可切换基准版本）；设计器发布弹窗「查看本次改动」——线上版本 vs 当前草稿。

**逐节点曝光（2026-10-20，补齐 ⑤ 留下的尾巴）**：
- 只给值得算转化的节点上报：绑了事件的组件 + 业务组件（抽奖、表单、预约……）；纯展示的文字图片不报，
  否则埋点量随组件数翻几十倍。页面本身的曝光仍是 PV（nodeId = ROOT），报表里与组件曝光分开算。
- 线上渲染时只给这些节点套一层 `display: contents` 探针——不生成盒子、不影响布局，只为拿到物料根元素交给
  IntersectionObserver；其余节点仍是零额外 DOM。弹窗这类晚渲染的物料，每次渲染后重新对一下根元素。
- 口径：一半进入视口（比视口还高的组件，可见部分占满半屏）记一次，每次访问每个节点只记一次；
  后台标签页里不记，切回前台时仍在视口里的才补记。
- 报表「组件效果」：曝光、点击、点击率（点击次数 ÷ 曝光人次）、转化率，组件名取线上版本 DSL 里的名称；
  上线前的老数据没有曝光，比率显示「—」。

**预约场次（2026-10-20，补齐 ② 留下的容量 / 时段）**：
- 新增 `appointment_scene`：场次编码、名称、开始 / 结束时间、名额（不填不限）、已约人数；活动详情「预约场次」卡片配置，
  名额不能改到少于已约人数，有人约了的场次不能删。
- 名额在服务端执行：`UPDATE … SET booked = booked + 1 WHERE … AND (capacity IS NULL OR booked < capacity)` 占位，
  与写预约记录同一个事务——同一人并发重复提交时记录被唯一约束挡下，占的名额随事务回滚。
  实测 12 个访客并发抢 3 个名额：恰好 3 个成功，计数与记录一致。开场即停止预约，场次不存在直接拒绝。
- 一个场次都没配的早期活动保持原行为（按组件上的场次编码记录、不限名额）。
- 预约组件（v1.1.0）：点击即预约（运行时内建；运营绑了预约动作的以绑定为准，不会约两遍）；
  「单个场次」显示时间与剩余名额，「场次列表」列出全部场次。剩余名额、约满 / 已截止 / 已预约由运行时向
  `GET /runtime/activities/:id/appointment-scenes` 拉取后注入（登录用户按 token、访客按设备 id 判断约过没有），约完重拉。
- 升级物料后要同步物料注册表（`pnpm --filter @nca/server seed` 里的物料同步），否则发布会被「物料版本高于注册表」拦下。

### M4 完成情况（2026-10-19）

| 项 | 做法 |
|---|---|
| 多宿主 | 原生容器注入 `__NCA_HOST__` / `__NCA_BRIDGE__`；iframe 宿主 `?bridge=postmessage` 走消息桥（只认 `window.parent` 的回复）；小程序 web-view 走 JSSDK（登录跳小程序登录页换票据、分享交给小程序页面）；判定优先级：注入 > `?host=` > `__wxjs_environment` > 浏览器，不做 UA 嗅探。接入方式见 [宿主接入文档](host-bridge.md) |
| 横屏 | 横屏里放竖版稿（设计稿宽 < 1000）收成 9:16 的居中一列、不窄于 375；横版稿按宽缩放 |
| 宿主专属组件 | 物料 `supportedHosts` 生效：线上不渲染、编辑态照常显示；投放宿主里有不支持的，发布前 warning |
| 宿主联调 | 设计器顶栏可按任一宿主预览；开发期 `/host-sim.html` 并排跑五个宿主，模拟器扮演宿主一方 |
| 性能 | 骨架屏、React 分包；index.html 内联脚本在 JS 下载时并行拉 DSL；发布时自动标记首屏关键图片并 preload |
| 监控 | 每次访问上报一个结局（boot / load_error / dsl_invalid / stall）+ 白屏 / JS 错误；节点级错误边界；后台标签页的访问不计耗时 |
| 告警 | 规则：窗口 + 阈值 + 最少样本 + 冷却；Redis 锁保证多实例每周期只评估一次；自动定位问题最集中的活动；企业微信 / 飞书 / 钉钉 / 通用 Webhook，按机器人返回码判断送达 |
| 权限细化 | 数据范围 `activity:all` + 协作成员（负责人 / 编辑 / 只读）；奖品、渠道、报表、审计、监控独立授权；守卫以数据库当前权限为准（缓存 60 秒）；用户与角色管理只能授予自己拥有的权限；审计脱敏 |
| 物料版本 | 节点记 `type.version`；minor/patch 向后兼容只盖章，major 必须提供 N→N+1 迁移（CI 守卫）；渲染器与设计器读取时懒升级，快照不改；发布拦截「物料比注册表新」；废弃物料两步下线 |
| 操作审计 | `@Audit` + 全局拦截器 |

### M3 / M4 实施中值得记住的坑

- **StrictMode 下 effect 会跑两遍**：一次性票据换 token、DSL 预取复用都要做成「整个页面只执行一次 / 可重复复用」，
  否则第二遍拿着作废的票去换、或者再发一次请求。
- **腾讯云 TC3 签名用的是不带端口的 hostname**（官方 SDK 如此），用 `URL.host` 在非标准端口下会验签失败。
- **群机器人失败也回 200**，真正的结果在 `errcode` / `code` 里，只看 HTTP 状态会把失败记成已送达。
- **小程序 web-view 的分享只能交给小程序页面**：页面 postMessage，小程序在 `onShareAppMessage` 里取最后一条。
- **后台标签页里 rAF 不触发**：首屏耗时会一直算到用户切回来，必须排除，否则 P90 被拉到几分钟。
- **物料注册表为空时「跳过校验」曾传了空集合**：空 Set 是真值，结果反而拦下了所有发布。
- **内置角色授权改为只补不删**：新版本加的权限要补给老角色，代价是手工从内置角色上收回的默认权限会被补回。
- **后台标签页里 rAF 不触发**：等 rAF 再上报 boot 的话，在后台打开、没看就关掉的访问连「来过」都记不上；
  页面隐藏时直接上报（不带耗时）。
- **按 IP 限流在反向代理后面会变成全局限流**：所有请求的 IP 都是代理的，必须配 `TRUST_PROXY`。
- **数据范围条件要放进 AND，不能和其它筛选展开合并**：`scope=mine` 本身就是 `{ ownerId }`，
  展开合并时后面的 `ownerId` 筛选会把它覆盖，传个别人的 id 就能列出别人的活动。
- **「能不能动这个人」要按他的全部权限判，且不看账号是否启用**：只在改角色时检查、或用会对停用账号抛错的
  接口取权限，就会出现「停用管理员 → 重置密码 → 再启用」接管超级管理员的路径。
- **跨大版本的物料迁移必须以「节点记录的版本」为准**：所有新建节点的路径（设计器、AI 补丁）都要盖上版本号，
  否则将来升大版本时，这些节点会被当成 1.0.0 再迁移一遍。

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
