# no-code-activity

零代码活动页平台：拖拉拽生成营销活动页，一套 DSL 驱动设计器预览与线上渲染。

## 结构

```
apps/
  admin/      管理后台 + 设计器（React + Vite + TanStack Router）
  renderer/   C 端活动页运行时（独立构建，产物发 CDN）
  server/     NestJS 后端
packages/
  shared/     通用类型 / 常量 / 工具
  dsl/        DSL 类型定义 + zod 校验 + 版本迁移（协议中枢）
  materials/  物料组件库（设计器与渲染器共用）
```

设计器与渲染器**共用同一份 `materials` 与 `dsl`**，这是保证「画布所见 = 线上所得」的前提。

## 开发

```bash
nvm use            # Node 22（见 .nvmrc，最低要求 20.11）
pnpm install
pnpm dev           # 全部应用
pnpm build
pnpm typecheck
pnpm lint
pnpm test
```

## 文档

- [开发规划](docs/development-plan.md) — 架构、协议、里程碑
