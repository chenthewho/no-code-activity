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
| Renderer | http://localhost:5180 | 活动页 `?id=<activityId>` |

> 端口说明：3306 / 6379 / 3000 / 5174 在开发机上常被其它项目占用，
> 本项目统一偏移到 3307 / 6381 / 3100 / 5180。渲染器开了 `strictPort`——
> 设计器 iframe 按固定地址加载它，端口漂移必须直接失败而不是让画布空白。

## 常用命令

```bash
pnpm build          # 全量构建
pnpm test           # 全量测试（113 项）
pnpm typecheck
pnpm lint
```

## 已完成（M0 / M1 / M2）

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

## 下一步（M3）

奖品配置与抽奖（Redis 原子扣减）、表单提交、活动预约、渠道链接、SSO 对接、
埋点上报、COS STS 直传。详见 [开发规划](docs/development-plan.md)。

## 文档

- [开发规划](docs/development-plan.md) — 架构、协议、里程碑与关键决策
