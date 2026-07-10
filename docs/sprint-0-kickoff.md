# Sprint 0 Kickoff — 设计冻结与技术决策 (包含 14 张表)

> 依据：docs/predesign/00_README.md ~ 10_Risk_Decision_Log.md
> 日期：2026-07-06
> 状态：已通过 M0 评审，进入 Sprint 0.5

---

## 1. 技术栈确认

### 1.1 最终推荐

| 层 | 选定 | 理由 | 替代方案 |
|---|---|---|---|
| Web 前端 | **Next.js 14+ (App Router) + React 18 + TypeScript** | SSR/ISR 可选，复杂交互友好，monorepo 共享类型 | - |
| API / BFF | **NestJS 10 + TypeScript** | 与前端共享 TS 类型，模块化架构清晰，Guard/Interceptor 原生支持 RBAC | Python FastAPI（若 AI 编排过重） |
| Agent Worker | **Python 3.11+** | LangChain/LangGraph 生态最成熟，NLP 工具链完善 | - |
| 任务队列 | **Redis + BullMQ (NestJS) + Celery (Python)** | API 侧 BullMQ 原生集成 NestJS，Worker 侧 Celery 更灵活 | 统一用 Redis + BullMQ Bridge |
| 主数据库 | **PostgreSQL 15+** | JSONB、事务、权限模型支持 | - |
| 向量数据库 | **pgvector (PostgreSQL 扩展)** | 零额外运维，MVP 足够；后续可迁移 Qdrant/Milvus | Qdrant（需额外部署） |
| 对象存储 | **MinIO (本地) / S3 (生产)** | S3 兼容 API，成本可控 | - |
| 全文检索 | **PostgreSQL FTS** | MVP 无需额外 OpenSearch | OpenSearch |
| 实时通信 | **SSE + WebSocket** | SSE 单向流用于 Agent 发言推送，WebSocket 用于双向干预 | 纯 SSE |
| 认证 | **OIDC 抽象 + MVP 本地密码** | 保留 OIDC/SAML 接口，MVP 先 username+password + JWT | Auth0 / Keycloak |
| 可观测性 | **OpenTelemetry + Prometheus + Grafana** | 标准协议，不锁定厂商 | - |

### 1.2 待决策项

| 问题 | 建议 | 依据 |
|---|---|---|
| **API 语言** | **NestJS (TypeScript)** — 与前端共享类型，monorepo 统一包管理 | 若后续 AI 编排大量下沉到 API 层（而非 Worker），则 Python FastAPI 更优。建议 MVP 先用 NestJS，Worker 通信通过 Queue/API |
| **模型供应商** | **OpenAI GPT-4o / Claude 3.5 Sonnet** 起步，预留多模型路由接口 | 企业数据合规问题：是否允许文档离境到公有云 API？见风险清单 |
| **monorepo 工具** | **pnpm + Turborepo** | npm workspaces + Nx 亦可；pnpm 硬链接效率高，Turborepo 缓存成熟 |
| **Python 包管理** | **uv + Poetry** | 或纯 uv（新一代 Rust 编写），比 pipenv/pip 快 10-100x |
| **ORM** | API (TS): **Prisma** / Worker (Python): **SQLAlchemy + Alembic** | Drizzle ORM 可选（更轻量但生态较少） |

### 1.3 偏离前置设计包说明

- 前置设计推荐了 FastAPI 与 NestJS 二选一，未明确倾向。本文选择 NestJS。
- 前置设计未指定 monorepo 工具（仅建议 monorepo），本文选择 pnpm + Turborepo。
- 前置设计未指定 ORM，本文选择 Prisma (TS) + SQLAlchemy (Python)。
- 前置设计未指定 Python 包管理工具，本文推荐 uv + Poetry。

---

## 2. Monorepo 初始化方案

### 2.1 目录结构

```
prismreview/
├── apps/
│   ├── web/                    # Next.js 前端
│   ├── api/                    # NestJS API / BFF
│   └── worker/                 # Python Agent Worker + 文档处理
├── packages/
│   ├── shared-types/           # TypeScript 共享类型（zod schemas + interfaces）
│   ├── schemas/                # JSON Schema / Pydantic schema（用于 Worker 校验）
│   ├── prompts/                # Agent/Chairman 提示词模板（YAML）
│   └── config/                 # eslint / tsconfig / prettier / env
├── db/
│   ├── migrations/             # Prisma migrations（TS 侧）
│   ├── seeds/                  # 预置数据 seed
│   └── schema/                 # SQLAlchemy models（Python 侧，与 Prisma 对齐）
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── e2e/
│   ├── fixtures/               # 测试用方案文档
│   └── evaluation/             # AI 评测集
├── docs/
│   ├── architecture/
│   ├── api/
│   ├── product/
│   └── runbooks/
├── scripts/                    # 工具脚本
├── docker-compose.yml          # PostgreSQL + Redis + MinIO + Worker
├── package.json                # pnpm workspace root
├── pnpm-workspace.yaml
├── turbo.json                  # Turborepo pipeline
├── .env.example
└── README.md
```

### 2.2 初始化步骤（Sprint 0 内执行）

```bash
# 1. 根目录
pnpm init
pnpm add -g turbo

# 2. pnpm workspace
# pnpm-workspace.yaml:
#   packages:
#     - "apps/*"
#     - "packages/*"

# 3. 创建 apps/web (Next.js)
pnpm create next-app apps/web --typescript --app --tailwind --eslint

# 4. 创建 apps/api (NestJS)
#   使用 @nestjs/cli 或手动搭建
pnpm create @nestjs/core apps/api
#   添加: @nestjs/websockets, @nestjs/bullmq, @nestjs/throttler

# 5. 创建 apps/worker (Python)
#   mkdir apps/worker && cd apps/worker
#   uv init --python 3.11
#   deps: langchain, langgraph, sqlalchemy, psycopg2, celery, redis,
#         openai, anthropic, unstructured[pdf]

# 6. 创建 packages
mkdir packages/shared-types packages/schemas packages/prompts packages/config
#   每个 package 初始化自己的 package.json

# 7. 初始化 Prisma
cd apps/api && pnpm add prisma @prisma/client
pnpm prisma init

# 8. 配置 Turborepo
pnpm add -D turbo
# turbo.json: pipeline for build, lint, test

# 9. Docker Compose
#   services: postgres, redis, minio
```

### 2.3 共享类型策略

```
packages/shared-types/src/
├── entities/          # 业务实体接口（与 Prisma model 一一映射）
│   ├── tenant.ts
│   ├── user.ts
│   ├── agent-role.ts
│   ├── review.ts
│   └── ...
├── api/               # 请求/响应 DTO
│   ├── review.dto.ts
│   ├── role.dto.ts
│   └── ...
├── events/            # 事件类型
│   ├── review.events.ts
│   └── ...
└── enums/             # 共享枚举
    ├── review-status.ts
    ├── risk-level.ts
    └── ...
```

Python Worker 通过从 `packages/schemas/` 读取 Pydantic 模型定义来保持类型对齐（或 CI 中自动生成 Python 类型）。

### 2.4 偏差记录

- 前置设计包含 `packages/ui/` — Sprint 0 不初始化，等 antigravity 输出设计系统后补充。
- 前置设计 `services/` 是独立目录，本文将其作为 NestJS modules 治理，不拆成独立包。

---

## 3. 核心服务边界

### 3.1 服务/模块矩阵

| 模块 | API (NestJS Module) | Worker (Python) | DB 表 | 对外依赖 |
|---|---|---|---|---|
| **Auth & Tenant** | `auth.module.ts` + `tenants.module.ts` | — | `tenants`, `users`, `departments` | OIDC Provider (预留) |
| **Review** | `reviews.module.ts` | `diagnose-review.job` | `reviews` | Queue → Worker |
| **Role** | `roles.module.ts` | — | `agent_roles`, `agent_role_versions` | — |
| **Knowledge** | `knowledge.module.ts` | `parse-document.job`, `embed-document.job` | `knowledge_documents`, `knowledge_chunks` | Object Storage, Vector DB |
| **Orchestration** | `orchestration.module.ts` | `run-agent-turn.job` | `review_turns`, `review_opinions` | Queue, SSE/WS |
| **Report** | `reports.module.ts` | `summarize-report.job`, `export-report.job` | `reports`, `action_items` | Object Storage |
| **Action** | `actions.module.ts` | `integration-worker.job` | `action_items` | Webhook (预留) |
| **Audit & Event** | `audit.module.ts` | — | `audit_logs`, `events` | — |
| **Admin** | `admin.module.ts` | — | 复用各表 | — |

### 3.2 层间通信规范

```
Web (Next.js)
  │ REST / SSE / WebSocket
  ▼
API Gateway (NestJS)        ← 认证、限流、租户注入
  │
  ├─ CRUD 操作 → 直接 DB (Prisma)
  ├─ 异步任务 → Queue (BullMQ)
  │                │
  │                ▼
  │              Worker (Python / Celery)
  │                │  → DB 写入 (SQLAlchemy)
  │                │  → 模型 API 调用
  │                │  → 向量检索
  │                │
  │                ▼  ← SSE/WS 推送状态
  └─ 实时推送  ──────────→ Web (Server-Sent Events)
```

### 3.3 API 模块内部结构（以 Review Module 为例）

```
apps/api/src/modules/reviews/
├── reviews.module.ts
├── reviews.controller.ts
├── reviews.service.ts
├── reviews.gateway.ts            # WebSocket
├── dto/
│   ├── create-review.dto.ts
│   ├── update-roles.dto.ts
│   └── ...
├── guards/
│   └── review-ownership.guard.ts
└── tests/
    ├── reviews.service.spec.ts
    └── reviews.controller.spec.ts
```

### 3.4 Worker Job 拓扑

```
                  ┌─────────────────┐
                  │  Document Queue │
                  │  parse-document │──→ embedding worker
                  └────────┬────────┘
                           │ready
                           ▼
                  ┌─────────────────┐
                  │  Review Queue   │
                  │  diagnose-review│──→ Chairman diagnosis
                  └────────┬────────┘
                           │confirmed
                           ▼
                  ┌─────────────────┐
                  │ Agent Turn Queue│
                  │  run-agent-turn │──→ LLM + RAG + validation
                  └────────┬────────┘
                           │all completed
                           ▼
                  ┌─────────────────┐
                  │  Report Queue   │
                  │  sumarize-report│──→ aggregation + export
                  └─────────────────┘
```

### 3.5 偏差记录

- 前置设计将 `services/` 列为独立目录，Sprint 0-MVP 阶段将其实现为 NestJS Modules，不做独立微服务部署。
- 前置设计未明确定义 Queue ↔ SSM/WS 的回传机制，本文补充为：Worker 完成任务后通过 Redis Pub/Sub → API 层 → SSE 推向前端。

---

## 4. 数据库初版 Schema

共 **14 张表**：tenants, departments, users, agent_roles, agent_role_versions, knowledge_documents, knowledge_chunks, reviews, review_turns, review_opinions, reports, action_items, audit_logs, business_events。

### 4.1 ER 概览

```
tenants 1──N users
tenants 1──N departments
users   N──1 departments
tenants 1──N agent_roles
users   N──1 agent_roles (created_by)
agent_roles 1──N agent_role_versions
tenants 1──N knowledge_documents
knowledge_documents 1──N knowledge_chunks
tenants 1──N reviews
reviews 1──N review_turns
reviews 1──N review_opinions
reviews 1──1 reports
reports 1──N action_items
tenants 1──N audit_logs
```

### 4.2 表定义（Prisma Schema 风格）

<details>
<summary><b>tenants</b></summary>

```prisma
model Tenant {
  id        String   @id @default(uuid()) @db.Uuid
  name      String
  region    String   @default("cn")       // cn | global
  status    String   @default("active")   // active | suspended
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  users          User[]
  departments    Department[]
  agentRoles     AgentRole[]
  knowledgeDocs  KnowledgeDocument[]
  reviews        Review[]
  auditLogs      AuditLog[]

  @@map("tenants")
}
```
</details>

<details>
<summary><b>departments</b>（前置设计表定义中未明确，从 user.department_id 推断）</summary>

```prisma
model Department {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  name      String
  createdAt DateTime @default(now()) @map("created_at")

  tenant Tenant @relation(fields: [tenantId], references: [id])
  users  User[]

  @@map("departments")
}
```
</details>

<details>
<summary><b>users</b></summary>

```prisma
model User {
  id            String   @id @default(uuid()) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  departmentId  String?  @map("department_id") @db.Uuid
  email         String   @unique
  name          String
  passwordHash  String   @map("password_hash")
  platformRole  String   @default("user") @map("platform_role") // super_admin | enterprise_admin | department_admin | user
  status        String   @default("active")                     // active | disabled
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  tenant     Tenant     @relation(fields: [tenantId], references: [id])
  department Department? @relation(fields: [departmentId], references: [id])
  reviews    Review[]

  @@map("users")
}
```
</details>

<details>
<summary><b>agent_roles</b></summary>

```prisma
model AgentRole {
  id              String   @id @default(uuid()) @db.Uuid
  tenantId        String   @map("tenant_id") @db.Uuid
  departmentId    String?  @map("department_id") @db.Uuid
  name            String
  code            String   // 角色代号，如 "CTO", "CFO"
  type            String   @default("preset") // preset | custom | marketplace
  status          String   @default("enabled") // enabled | disabled | deleted
  activeVersionId String?  @map("active_version_id") @db.Uuid
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  tenant         Tenant             @relation(fields: [tenantId], references: [id])
  versions       AgentRoleVersion[]
  activeVersion  AgentRoleVersion?  @relation("ActiveVersion", fields: [activeVersionId], references: [id])

  @@map("agent_roles")
}
```
</details>

<details>
<summary><b>agent_role_versions</b></summary>

```prisma
model AgentRoleVersion {
  id                     String   @id @default(uuid()) @db.Uuid
  roleId                 String   @map("role_id") @db.Uuid
  version                Int
  systemPrompt           String   @map("system_prompt")
  dimensions             Json     @default("[]")  // 审查维度数组
  outputSchema           Json     @map("output_schema")
  knowledgeCollectionIds String[] @map("knowledge_collection_ids")
  createdBy              String   @map("created_by") @db.Uuid
  createdAt              DateTime @default(now()) @map("created_at")

  role          AgentRole @relation(fields: [roleId], references: [id])
  activeForRole AgentRole? @relation("ActiveVersion")

  @@unique([roleId, version])
  @@map("agent_role_versions")
}
```
</details>

<details>
<summary><b>knowledge_documents</b></summary>

```prisma
model KnowledgeDocument {
  id            String   @id @default(uuid()) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  scope         String   @default("global") // global | role | department
  ownerRoleId   String?  @map("owner_role_id") @db.Uuid
  filename      String
  mimeType      String   @map("mime_type")
  sizeBytes     BigInt   @map("size_bytes")
  storageUri    String   @map("storage_uri")
  status        String   @default("uploading") // uploading | parsing | chunking | indexing | ready | parse_failed | index_failed
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  tenant Tenant           @relation(fields: [tenantId], references: [id])
  chunks KnowledgeChunk[]

  @@map("knowledge_documents")
}
```
</details>

<details>
<summary><b>knowledge_chunks</b></summary>

```prisma
model KnowledgeChunk {
  id            String   @id @default(uuid()) @db.Uuid
  documentId    String   @map("document_id") @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  content       String
  metadata      Json     @default("{}")    // {page, heading, paragraphIndex, ...}
  reviewStatus  String   @default("pending_review") @map("review_status") // pending_review | approved | rejected | deprecated
  embeddingRef  String?  @map("embedding_ref")
  createdAt     DateTime @default(now()) @map("created_at")

  document KnowledgeDocument @relation(fields: [documentId], references: [id])
  tenant   Tenant            @relation(fields: [tenantId], references: [id])

  @@index([documentId])
  @@index([tenantId])
  @@map("knowledge_chunks")
}
```
</details>

<details>
<summary><b>reviews</b></summary>

```prisma
model Review {
  id            String   @id @default(uuid()) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  createdBy     String   @map("created_by") @db.Uuid
  title         String
  objective     String
  inputType     String   @default("text")   // file | text | both
  mode          String   @default("round_robin") // round_robin | free_debate | blind_consensus | red_blue
  status        String   @default("draft")  // draft | diagnosing | ready | running | interrupted | summarizing | completed | failed | archived
  diagnosis     Json?                        // Chairman 诊断书
  roleSelection Json?   @map("role_selection") // 角色与权重配置
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  tenant   Tenant        @relation(fields: [tenantId], references: [id])
  creator  User          @relation(fields: [createdBy], references: [id])
  turns    ReviewTurn[]
  opinions ReviewOpinion[]
  report   Report?

  @@index([tenantId])
  @@index([createdBy])
  @@map("reviews")
}
```
</details>

<details>
<summary><b>review_turns</b></summary>

```prisma
model ReviewTurn {
  id            String    @id @default(uuid()) @db.Uuid
  reviewId      String    @map("review_id") @db.Uuid
  turnIndex     Int       @map("turn_index")
  phase         String?   // 阶段标识
  roleVersionId String    @map("role_version_id") @db.Uuid
  status        String    @default("queued") // queued | retrieving | thinking | speaking | completed | timeout | failed | skipped
  startedAt     DateTime? @map("started_at")
  completedAt   DateTime? @map("completed_at")
  createdAt     DateTime  @default(now()) @map("created_at")

  review   Review           @relation(fields: [reviewId], references: [id])
  opinions ReviewOpinion[]

  @@index([reviewId, turnIndex])
  @@map("review_turns")
}
```
</details>

<details>
<summary><b>review_opinions</b></summary>

```prisma
model ReviewOpinion {
  id               String    @id @default(uuid()) @db.Uuid
  reviewId         String    @map("review_id") @db.Uuid
  turnId           String    @map("turn_id") @db.Uuid
  dimension        String
  riskLevel        String    @map("risk_level") // high | medium | low | info
  issue            String
  recommendation   String
  citations        Json      @default("[]")
  confidenceScore  Int       @map("confidence_score") // 0-100
  reasoningSummary String?   @map("reasoning_summary")
  modelOutputRef   String?   @map("model_output_ref")
  feedback         String?   // valuable | adopted | false_positive | ignored
  createdAt        DateTime  @default(now()) @map("created_at")

  review Review     @relation(fields: [reviewId], references: [id])
  turn   ReviewTurn @relation(fields: [turnId], references: [id])

  @@index([reviewId])
  @@map("review_opinions")
}
```
</details>

<details>
<summary><b>reports</b></summary>

```prisma
model Report {
  id       String   @id @default(uuid()) @db.Uuid
  reviewId String   @unique @map("review_id") @db.Uuid
  status   String   @default("generating") // generating | ready | failed
  content  Json?                            // 六章结构
  htmlUri  String?  @map("html_uri")
  pdfUri   String?  @map("pdf_uri")
  docxUri  String?  @map("docx_uri")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  review      Review       @relation(fields: [reviewId], references: [id])
  actionItems ActionItem[]

  @@map("reports")
}
```
</details>

<details>
<summary><b>action_items</b></summary>

```prisma
model ActionItem {
  id          String    @id @default(uuid()) @db.Uuid
  reviewId    String    @map("review_id") @db.Uuid
  reportId    String    @map("report_id") @db.Uuid
  title       String
  description String?
  ownerId     String?   @map("owner_id") @db.Uuid
  priority    String    @default("p2") // p0 | p1 | p2 | p3
  status      String    @default("open") // open | assigned | in_progress | blocked | done | canceled
  dueDate     DateTime? @map("due_date")
  createdAt   DateTime  @default(now()) @map("created_at")
  updatedAt   DateTime  @updatedAt @map("updated_at")

  report Report @relation(fields: [reportId], references: [id])

  @@index([reportId])
  @@map("action_items")
}
```
</details>

<details>
<summary><b>audit_logs</b>（前置设计建议但未提供表定义，本文补充）</summary>

```prisma
model AuditLog {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  userId    String?  @map("user_id") @db.Uuid
  action    String   // resource.action 如 "review.created"
  resource  String   // 操作对象类型
  resourceId String? @map("resource_id")
  detail    Json?    // 操作详情
  ipAddress String?  @map("ip_address")
  userAgent String?  @map("user_agent")
  createdAt DateTime @default(now()) @map("created_at")

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@index([tenantId, createdAt])
  @@index([action])
  @@map("audit_logs")
}
```
</details>

<details>
<summary><b>events</b>（业务事件埋点，前置设计建议但未提供，本文补充）</summary>

```prisma
model BusinessEvent {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  userId    String?  @map("user_id") @db.Uuid
  eventName String   @map("event_name") // review_created | agent_speaking | ...
  properties Json    @default("{}")
  requestId String?  @map("request_id")
  sessionId String?  @map("session_id")
  createdAt DateTime @default(now()) @map("created_at")

  tenant Tenant @relation(fields: [tenantId], references: [id])

  @@index([tenantId, eventName, createdAt])
  @@map("business_events")
}
```
</details>

### 4.3 索引规划

| 表 | 索引 | 理由 |
|---|---|---|
| `users` | `(tenant_id, email)` unique | 租户内邮箱唯一 |
| `agent_roles` | `(tenant_id, code)` unique | 租户内角色代号唯一 |
| `agent_role_versions` | `(role_id, version)` unique | 版本号递增 |
| `knowledge_documents` | `(tenant_id, status)` | 按租户和状态查 |
| `knowledge_chunks` | `(document_id)` | 按文档查 chunk |
| `reviews` | `(tenant_id, created_by, status)` | 工作台查询 |
| `review_turns` | `(review_id, turn_index)` | 按评审和轮次查 |
| `review_opinions` | `(review_id)` | 按评审查全部意见 |
| `audit_logs` | `(tenant_id, created_at)` | 审计查询 |
| `business_events` | `(tenant_id, event_name, created_at)` | 事件分析 |

### 4.4 偏差记录

- 前置设计未定义 `departments` 表（仅在 User 中引用 `department_id`），本文显式补充。
- 前置设计未定义 `audit_logs` 表，本文补充实践级定义。
- 前置设计未定义 `business_events` 表（仅列出事件名），本文补充完整表定义。
- 前置设计使用 `timestamp` 泛型，本文统一为 `DateTime` + `@db.Timestamptz`。

### 4.5 pgvector 临时偏离（Sprint 1 Mock）

**背景**：`postgres:16-alpine` 标准镜像不包含 `pgvector` 扩展，`docker-entrypoint-initdb.d` 中的 `CREATE EXTENSION vector` 会失败并导致容器退出。

**状态**：**Sprint 1 Mock 阶段可接受**。Knowledge 检索当前使用 PostgreSQL `LIKE`（大小写不敏感），无需向量检索。

**恢复方案**（RAG Spike 前必须择一执行）：
1. **推荐**：将 base image 切换为 `pgvector/pgvector:pg16`（官方镜像，预装 vector 扩展）。
2. 或保留 `postgres:16-alpine`，在 init 脚本中从源码编译安装 pgvector。
3. 或使用独立向量库（Qdrant / Milvus）替代 pgvector。

---

## 5. AI/RAG Spike 计划

### 5.1 目标

验证从文档上传 → 语义检索 → Agent 输出的完整链路可行性，产出延迟和质量的基准数据。

### 5.2 Spike 范围

```
文档上传 (PDF/MD/TXT)
  → 解析 (unstructured / markdown-it)
    → 分块策略对比 (fixed-size / recursive / semantic)
      → Embedding 模型选择 (text-embedding-3-small / ada-002 / local)
        → pgvector 存储与索引 (IVFFlat / HNSW)
          → 检索测试 (query → Top-K chunks)
            → RAG 注入 → Agent 结构化输出
```

### 5.3 对比维度

| 维度 | 选项 A | 选项 B | 选项 C |
|---|---|---|---|
| 分块策略 | RecursiveCharacterTextSplitter (800ch, overlap 200) | Semantic chunker (按段落/标题) | Markdown header-based |
| Embedding | `text-embedding-3-small` (1536d) | `text-embedding-3-large` (3072d) | 本地模型 `bge-small-zh` |
| 向量索引 | IVFFlat (lists=100) | HNSW (m=16, ef=64) | 暴力搜索 (小数据) |
| Top-K | 3 | 5 | 10 |
| Reranker | 无 | Cohere Rerank 3 | 交叉编码器 |

### 5.4 验收标准

1. 能从 PDF/MD 中正确提取文本和段落结构。
2. 分块后每个 chunk 800-1200 字，边界完整（不切断句子）。
3. 语义检索 Top-5 命中率（人工标注相关度）≥ 70%。
4. Agent 输出能正确引用 chunk_id，不存在性校验通过（引用 != 空且 ID 存在）。
5. 检索 P95 ≤ 3 秒（含 embedding 生成）。
6. 诊断书首屏 P95 ≤ 10 秒（含文档解析 + 初步检索）。

### 5.5 实现路径（Sprint 0 内）

```
步骤 1: 在 apps/worker 中搭建 Python 文档解析 pipeline
  - 输入: 3 份测试文档 (1 PDF, 1 MD, 1 TXT)
  - 输出: 解析后的纯文本 + 段落元数据

步骤 2: 实现分块器和 embedding 调用
  - 对比 2-3 种分块策略
  - 输出: chunks + vector embeddings

步骤 3: 搭建 pgvector 并测试检索
  - 创建 extension + 表 + HNSW 索引
  - 对测试 query 执行检索
  - 输出: recall 指标 + 延迟报表

步骤 4: 端到端 RAG → Agent 输出
  - 用 mock LLM 或真实 API 生成结构化意见
  - 输出: 验证 output schema 合规 + 引用可追溯
```

### 5.6 Spike 输出

1. 分块策略选型建议 + 召回率对比表格。
2. Embedding 模型选型建议 + 延迟/成本对比。
3. pgvector 索引参数建议。
4. RAG → Agent 输出链路验证报告。
5. 若自研 pipeline 成本高 → 推荐 LangChain / LlamaIndex 集成方案。

### 5.7 偏差记录

- 前置设计 Spike 计划较笼统，本文补充了具体对比维度和验收标准。

---

## 6. 风险清单

### 6.1 延续自前置设计的风险

| # | 风险 | 等级 | 缓解措施 | Sprint 0 行动 |
|---|---|---|---|---|
| R01 | Agent 输出质量不足 | 🔴 高 | 低信心标记 + 人工反馈环 + 评测集 | Sprint 0 创建 3 份评测 baseline |
| R02 | RAG 引用不准确 | 🔴 高 | 引用 ID 校验 + 人工审核 Chunk + 废弃状态 | Spike 验证引用回溯链路 |
| R03 | 多 Agent 编排不稳定 | 🔴 高 | 状态机 + 超时 + 重试 + 部分报告机制 | Worker 设计包含超时/降级 |
| R04 | 企业数据合规 | 🔴 高 | 脱敏策略 + 租户隔离 + 审计日志 | API 层 tenant context 注入 |
| R05 | 开发范围膨胀 | 🔴 高 | MVP 锁定核心闭环 | 本文已标注所有偏差为待决策 |
| R06 | UI 信息量过大 | 🟡 中 | 三栏布局 + 渐进展开 | 等待 antigravity IA 输出 |
| R07 | 第三方集成拖慢 MVP | 🟡 中 | Adapter + Mock 先行 | Action Item Push 用 mock |

### 6.2 Sprint 0 新增风险

| # | 风险 | 等级 | 缓解措施 |
|---|---|---|---|
| R08 | 模型 API 密钥管理未落实 | 🟡 中 | Sprint 0 确定密钥管理方案（环境变量 / Vault / 加密存储） |
| R09 | 文档解析对复杂 PDF（表格、扫描件）效果未知 | 🟡 中 | Spike 优先测试非结构化 PDF；若效果差，预设 "需人工预处理" 选项 |
| R10 | NestJS + Python Worker 双语言带来类型对齐成本 | 🟡 中 | 定义 schema 同步 CI 步骤：Prisma ↔ Python Pydantic 自动生成 |
| R11 | pgvector 在 10 万级 chunk 后性能未知 | 🟡 中 | Spike 测试 1 万/10 万级检索延迟，预留迁移 Qdrant 选项 |
| R12 | antigravity 与 reasonix 节奏不同步 | 🟡 中 | 明确接口契约优先于 UI 实现；API 按 OpenAPI 先出，前端消费 |

### 6.3 待决策项裁决（经 M0 评审确认）

| # | 问题 | 裁决 | 影响模块 |
|---|---|---|---|
| D01 | 首批行业是否限定？ | **限定为技术/产品方案评审**，不泛化 | Role prompt 设计 |
| D02 | 模型供应商选型？ | **可抽象**，Spike 可测 GPT/Claude；MVP **不绑定单一模型** | Worker、API |
| D03 | 是否允许企业文档离开企业环境？ | **默认不允许**；仅测试租户/脱敏样例可用外部模型，**生产需显式开关** | Worker、安全架构 |
| D04 | 是否需要人工终审签字？ | **不强制**，但报告状态预留 `human_review_required` | Report status |
| D05 | MVP 是否必须 PDF/DOCX 原生导出？ | **HTML/MD 即可**，PDF/DOCX 延后 | Report export |
| D06 | Action Items 是否必须首版打通 Jira？ | **Mock adapter**，真实集成延后 | Integration |
| D07 | 是否需要私有化部署作为 MVP 前提？ | **Docker Compose 本地部署为基线**，私有化增强延后 | 部署架构 |

---

## 7. Sprint 0 执行步骤

```
Step 1: 本文件产出 ← 当前
Step 2: 技术栈与待决策项提交产品确认
Step 3: monorepo 初始化（pnpm + turborepo + next + nest + worker scaffold）
Step 4: Docker Compose 搭建（postgres + redis + minio）
Step 5: Prisma schema 初版 + 初始 migration
Step 6: seed 脚本（预置 5 角色）
Step 7: AI/RAG Spike 启动
Step 8: E2E 测试 base（Playwright 初始化 + 第一个用例）
Step 9: Sprint 0 回顾 → 修正后进入 Sprint 1
```

---

> **本文档所有偏差均已 inline 标注。D01-D07 已通过 M0 评审确认（见 6.3 节）。**
> 下一动作：reasonix 进入工程骨架初始化；antigravity 输出高保真 UI。
