# no-code-activity

零代码活动页平台：拖拉拽生成营销活动页，一套 DSL 驱动设计器预览与线上渲染。

## 结构

```
apps/
  admin/      管理后台 + 设计器（React + Vite + TanStack Router + antd）
  renderer/   C 端活动页运行时（独立构建，产物发 CDN）
  server/     NestJS 后端（Prisma + MySQL + Redis）
packages/
  shared/     通用类型 / 常量 / 权限码字典
  dsl/        DSL 类型定义 + zod 校验 + 版本迁移（协议中枢）
  materials/  物料组件库（设计器与渲染器共用）
```

三条不可动摇的架构约定：

1. **物料只有一份实现**。`packages/materials` 同时被设计器画布和线上渲染器消费，
   `componentMap`、工具箱列表、DSL 校验白名单全部从同一张物料总表派生。
2. **画布是真实渲染器**。设计器用 iframe 承载 `apps/renderer`，预览跑的就是线上代码，
   不存在「画布好看、线上错位」。
3. **发布产物不可变**。每次发布生成版本快照，回滚只切 `publishedVersion` 指针。

## 本地启动

```bash
nvm use                      # Node 22（见 .nvmrc，最低 20.11）
pnpm install

docker compose up -d         # MySQL(3307) + Redis(6381)
cp apps/server/.env.example apps/server/.env
pnpm --filter @nca/server prisma:push
pnpm --filter @nca/server seed     # 权限、角色、admin 账号、物料注册表

pnpm dev                     # 或分别启动三个服务
```

| 服务 | 地址 | 说明 |
|---|---|---|
| Server | http://localhost:3100/api/v1 | Swagger 在 `/api/v1/docs` |
| Admin | http://localhost:5173 | 默认账号 `admin` / `admin123` |
| Renderer | http://localhost:5180 | 活动页 `?id=<activityId>`；宿主模拟器 `/host-sim.html?id=<activityId>` |

> `.env.example` 默认 `SSO_PROVIDER=mock`、`HOST_AUTH_MODE=mock`：服务端自带模拟 IdP 与宿主登录，
> 不接真实账号体系也能把 C 端登录、后台 SSO 跑通；生产环境配成 mock 会直接启动失败。

> 端口说明：3306 / 6379 / 3000 / 5174 在开发机上常被其它项目占用，
> 本项目统一偏移到 3307 / 6381 / 3100 / 5180。渲染器开了 `strictPort`——
> 设计器 iframe 按固定地址加载它，端口漂移必须直接失败而不是让画布空白。

## 常用命令

```bash
pnpm build          # 全量构建
pnpm test           # 全量测试（343 项）
pnpm typecheck
pnpm lint
```

## 已完成（M0 – M4）

### M0 / M1 / M2 · 基建、MVP 闭环、设计器

- **DSL 协议**：FinalDSL / 物料协议 / 动作协议 / manifest；校验分两级——
  草稿容忍「还没填完」，发布严格拦截；含引用完整性检查与版本迁移链
- **物料库**：Page、Container、Text、Image、Button、Modal、Countdown、Swiper、RankList、
  Lottery（九宫格/转盘抽奖）、Login（登录入口）、BindRole（区服角色绑定）；
  三个活动组件只管交互与展示，中奖结果、登录态、绑定关系一律由绑定的状态/数据源喂进来
- **后端**：RBAC、活动 CRUD、草稿自动保存、发布与回滚、模板中心、物料注册表、
  资源上传、C 端 runtime 接口
- **渲染器**：递归渲染、condition/loop 容器、受限表达式求值（不用 eval）、
  事件动作编排、数据源引擎、宿主适配层、rem 移动端适配
- **设计器**：iframe 画布（点选/描边/拖拽落点）、propsSchema 驱动的设置器、
  事件编排、数据源配置、撤销重做、自动保存、存为模板、发布
- **自由摆放**：任意组件都可切成绝对定位，拖本体改坐标、拖八向手柄改尺寸；
  切换定位方式时按当前渲染位置补齐 top/left/width，元素不跳位也不收缩；
  流式节点拖本体则是重排。一次拖拽一步撤销
- **AI Agent**：`/ai` 工作台用六张中断卡片把「一句话 → 可发布的活动」串起来，
  设计器右侧另有一个一问一答的 AI 面板改局部；AI 只产出 DSL 补丁，
  不直接写 DSL，落库走的还是运营手工搭建那条路。
  详见 [AI Agent 技术文档](docs/ai-agent.md)

### M3 · 发布与业务能力

- **奖品与抽奖**：Redis Lua 原子选奖 + 扣减，按人限次、按天限流；表单提交、活动预约
- **渠道链接与埋点报表**：渠道码落地链接、PV / 点击 / 转化、Top 节点与趋势
- **统一登录（SSO）**：OIDC 授权码 + PKCE。C 端登录后带一次性票据跳回，换成独立签发的
  C 端 token（与后台 token 互不通用）；宿主登录用一次性 code 到服务端换身份；小程序外层
  `wx.login` 换票据。活动配置了登录方式时，抽奖 / 表单 / 预约只认登录用户。后台也支持 SSO
- **COS + STS 直传**：素材由浏览器凭「只能写这一个对象」的临时密钥直传到桶，服务端只签发
  与确认；发布产物写桶并带永久缓存头。签名算法自实现，单测向量由官方 SDK 计算

### M4 · 多宿主与打磨

- **多宿主**：浏览器、SDK 竖/横屏、游戏中心、LDQ、微信小程序 web-view 共用同一份 DSL；
  原生容器注入桥接、iframe 宿主走 postMessage 桥、小程序走 JSSDK；横屏里的竖版稿收成居中一列；
  设计器可按任一宿主预览，开发期有并排五宿主的模拟器。接入方式见 [宿主接入文档](docs/host-bridge.md)
- **性能**：骨架屏、React 分包、DSL 与 JS 并行拉取、发布时自动标记首屏关键图片并预加载
- **运行监控与告警**：每次访问上报一个结局（渲染成功 / 加载失败 / DSL 校验失败 / 超时），
  外加白屏、JS 错误；节点级错误边界让单个组件出错不再白屏。看板展示失败率、白屏率、
  首屏 P50/P90、问题活动；告警规则推送企业微信 / 飞书 / 钉钉
- **权限细化**：功能权限之外加数据权限——没有「全部活动」范围的人只能碰自己负责或参与协作的活动；
  奖品、渠道、报表、审计、监控各自独立授权；改角色即时生效、停用即刻失效；
  用户与角色管理防提权；审计日志脱敏
- **物料版本升级**：节点记录物料版本，小版本向后兼容、大版本必须随代码提供迁移（CI 守卫），
  渲染器与设计器读取时自动升级，发布前拦截「物料比渲染器新」；物料管理页看用量与待升级数
- **操作审计**：变更接口自动落审计
- **灰度发布**：新版本先给指定渠道、白名单或一定比例的设备看，监控按版本对比新旧版失败率，
  没问题再一键转全量；转全量、停止、回滚都只切指针
- **版本对比**：发布前看「本次改动」、回滚前看两版差异——按组件、属性路径、事件、数据源、页面设置列出
- **逐节点曝光**：按钮、抽奖、表单等组件进入视口记曝光，报表按组件给出曝光、点击率、转化率
- **预约场次**：按场次配置时间与名额，服务端原子占位不超卖，开场即截止；预约组件可单场或列表展示剩余名额

详见 [开发规划](docs/development-plan.md) 的完成情况与实施记录。

> AI 功能需要配 `ANTHROPIC_API_KEY`（见 `apps/server/.env.example`）。
> 不配也不影响其余功能——只有调 AI 接口时才报「未配置」。

## 文档

- [开发规划](docs/development-plan.md) — 架构、协议、里程碑与关键决策
- [AI Agent 技术文档](docs/ai-agent.md) — 工作流与中断点、补丁协议、能力注册表、
  权限模型、提示词与缓存、Checkpointer、扩展指南与已知限制
- [宿主接入文档](docs/host-bridge.md) — 给 SDK / 游戏中心 / 小程序接入方：宿主识别、
  桥接方法、登录 code 校验、postMessage 协议、小程序登录页与分享、横屏规则、联调方式
