# PrismReview

> 多 Agent 智能评审中枢 — 面向企业方案评审场景。

## 架构

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  apps/web    │     │  apps/api    │     │  apps/worker │
│  Next.js 14  │────▶│  NestJS 10   │────▶│  Python 3.11 │
│  React 18    │     │  Prisma      │     │  Celery      │
│  TypeScript  │     │  BullMQ      │     │  LangChain   │
└──────────────┘     └──────┬───────┘     └──────┬───────┘
                            │                     │
                            ▼                     ▼
                     ┌──────────────┐     ┌──────────────┐
                     │  PostgreSQL  │     │    Redis      │
                     │  + pgvector  │     │  + BullMQ     │
                     └──────────────┘     └──────────────┘
                            │
                            ▼
                     ┌──────────────┐
                     │    MinIO     │
                     │  Object Str  │
                     └──────────────┘
```

## 快速开始

### 前置条件

- Docker Desktop（启动 PostgreSQL、Redis、MinIO）
- Node.js >= 20 + pnpm 9
- Python 3.11+（Worker 使用，可选）

### Windows 启动推荐

某些环境下 `pnpm dev`（Turborepo）可能因非交互式检查慢或卡住，建议直接启动各服务：

```powershell
# 1. 启动基础设施
docker compose up -d

# 2. 安装依赖
pnpm install

# 3. 生成 Prisma Client 并执行 migration
cd apps/api
pnpm prisma:generate
pnpm prisma:migrate --name init
pnpm prisma:seed
cd ../..

# 4a. 启动 API（推荐 — 直接调用 nest 可执行文件）
apps/api/node_modules/.bin/nest.CMD start --watch

# 4b. 启动前端（新建终端）
apps/web/node_modules/.bin/next.CMD dev

# 4c. 或使用 Turborepo 并行启动（部分环境可能较慢）
pnpm dev
```

### Linux / macOS

```bash
# 1. 启动基础设施
docker compose up -d
# 2. 安装依赖
pnpm install
# 3. 数据库
cd apps/api && pnpm prisma:generate && pnpm prisma:migrate --name init && pnpm prisma:seed && cd ../..
# 4. 启动开发服务
pnpm dev          # 在根目录，turbo 并行启动 web + api

> **Windows 开发推荐**
> 如果 `pnpm dev` 触发非交互依赖检查或挂起，推荐分别独立启动：
> - API: `apps/api/node_modules/.bin/nest.CMD start --watch`
> - Web: `apps/web/node_modules/.bin/next.CMD dev`
```

### 验证

```bash
# API 冒烟测试 — 需先启动 API
node scripts/smoke-runtime.js

# 前端类型检查
cd apps/web && npx tsc --noEmit --incremental false && cd ../..
```

## 预置角色

| 代号 | 名称 | 视角 |
|---|---|---|
| CTO | 技术审核员 | 架构、可行性、性能、安全、技术债务 |
| CFO | 商业控制者 | 投入产出、预算、ROI、商业风险 |
| PMO | 交付守护者 | 排期、资源、依赖、延期风险 |
| Compliance | 合规审查员 | 法规、隐私、安全制度、许可证 |
| UserAdvocate | 用户代言人 | 体验、认知负荷、门槛、可用性 |

## 状态

Sprint 1.1 — Runtime Hardening + Diagnosis Polish。

## 临时偏离记录

- **本地 Docker 环境**：暂时禁用了 `pgvector`（回退为标准 PostgreSQL 镜像），仅限 Sprint 1 Mock 联调阶段。必须记录为临时偏离，**在 RAG Spike 启动前需恢复包含 pgvector 的完整环境方案**。
- **真实集成**：暂不做真实 RAG、Embedding、MinIO 操作以及真实的外部大模型调用，均使用 Mock。

> 详见 [docs/](docs/) 下的前置设计包与 Sprint 0 决策文档。
