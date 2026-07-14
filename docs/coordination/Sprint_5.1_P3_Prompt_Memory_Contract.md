# Sprint 5.1 — P3 Prompt + Memory Contract

> **角色**：workbuddy-docs（纯文档，fast-gate）
> **模式**：快速 Gate（协议 §7.1 — 纯文档、不改 schema/状态机实现/模型/前端/依赖）
> **架构权威**：`docs/roadmap/Sprint_9.0_Product_Roadmap_Reset.md`（§2 三项决策 / §8 Memory 四层 / §9 Prompt 架构 / §11 P3 范围）
> **基线**：Sprint 5.0 Go（commit `332b5b0`，RBAC + Audit + Users 已入库）
> **日期**：2026-07-14
> **Owner**：workbuddy-docs
> **目的**：把路线图 P3（Prompt + Memory）展开为**可实现的 Backend Contract**：PromptService 接口、MemoryService 接口、RollingSummary 契约、KB/RAG 接入点、Prisma schema 增量声明、与 P1 graph runtime 的集成位、API 契约保留边界。本 Sprint **只写 Contract，不实现**。

---

## 1. 背景与定位

### 1.1 路线图位置

```
P0 MVP        ✅ done
P1 编排脊柱    ✅ done (9.0–9.5b)
P2 Model Adapter ✅ done (2.1 + 2.2)
→ P3 Prompt + Memory  ← 本 Contract
P4 Tool + HITL
P5 Workflow + 评分
P6 规模化（权限/审计部分已做 5.0）
```

P3 是"能力层"的第一层——在编排脊柱（P1）和模型抽象（P2）就绪后，叠加**可控、可审计、可版本化的 Prompt 能力**与**蒸馏式 Memory 能力**。

### 1.2 已核实的代码事实（本 Contract 的输入基线）

| 能力 | 现状 | 位置 |
|------|------|------|
| AgentRoleVersion 表 | 已有 `systemPrompt` / `dimensions` / `outputSchema` / `version` | `schema.prisma` |
| prompt 实际组装 | 当前在 `provider/model-adapter.ts` 的 `SYSTEM_PROMPT` 常量 + `queue.service.ts` 拼 prompt | 硬编码，无版本化 |
| MemoryService 接口位 | `NodeCtx.memoryService?: MemoryService`（P3 注入位，当前 undefined） | `orchestrator/graph-runtime.ts` |
| PromptService 接口位 | `NodeCtx.promptService?: PromptService`（P3 注入位，当前 undefined） | `orchestrator/graph-runtime.ts` |
| Knowledge 模块 | 已有 `KnowledgeDocument` / `KnowledgeChunk` 表 + 基础 CRUD controller | `modules/knowledge/` |
| KB 状态字段 | `KnowledgeChunk.reviewStatus`（pending_review/approved/rejected/deprecated） | `schema.prisma` |
| 多轮上下文 | `ReviewOpinion` 按 round 存储；`ReviewTurn.round` 已加列 | P1 落地 |
| rolling summary | **无** — 当前多轮不压缩上下文 | — |
| prompt 版本审计 | **无** — 哪版 prompt 产出哪条 opinion 不可溯 | — |

### 1.3 三条承重决策的约束（9.0 §2，不可改写）

1. **决策 #4（rationale）**：Reviewer Memory 是**蒸馏 profile，不是聊天历史**——存"这个专家擅长什么、偏见是什么"，不存"他上周说了什么"。
2. **决策 #2**：真 LLM Moderator 在 P2/P3 模型层就绪后接入，仍须显式 env + Gate。P3 的 prompt 服务为 Moderator 的 prompt 统一管理做准备。
3. **决策 #1**：Graph 脊柱 + Code 叶子——PromptService / MemoryService 是"叶子"（普通 TS 函数），由 graph runtime 的 NodeCtx 注入到节点。

---

## 2. PromptService 契约

### 2.1 职责

- 管理**版本化 prompt 模板**注册表
- 按**四层组装**（基础层 + 任务层 + 上下文层 + 格式层）生成最终 prompt
- 每条 prompt 快照落库，与 opinion 产出可溯
- 预置角色 prompt 入 Library；新角色 = 加模板不改代码

### 2.2 接口

```ts
export interface PromptTemplate {
  readonly id: string;
  readonly roleCode: string;          // "CTO" | "CFO" | ... (关联 AgentRole.code)
  readonly version: string;           // 语义化 "1.0" / "1.1"
  readonly layer: PromptLayer;        // 见 §2.3
  readonly content: string;           // 模板内容（含 {{variable}} 占位）
  readonly metadata: PromptMetadata;  // 描述 / 创建者 / 变更原因
  readonly createdAt: string;
}

export type PromptLayer =
  | 'base'       // 角色定义（"你是技术审核员，负责..."）
  | 'task'       // 本轮指令（"请从以下维度评审..."）
  | 'context'    // memory / KB 注入（"该专家历史偏见：..."）
  | 'format';    // 输出 schema（"必须输出 JSON..."）

export interface PromptMetadata {
  readonly description: string;
  readonly createdBy: string;         // userId
  readonly changeReason?: string;     // 版本变更原因
  readonly schemaVersion: string;     // 关联 opinion schemaVersion "1.0"
}

export interface ComposedPrompt {
  readonly system: string;            // 组装后的 system prompt
  readonly user: string;              // 组装后的 user prompt
  readonly templateRefs: ReadonlyArray<{
    layer: PromptLayer;
    templateId: string;
    version: string;
  }>;                                  // 溯源：用哪版模板组装
}

export interface PromptService {
  /**
   * 组装一个 reviewer turn 的完整 prompt。
   * @param ctx.reviewId    当前评审（取上下文）
   * @param ctx.roleCode    角色代码
   * @param ctx.round       当前轮次
   * @param ctx.phase       'round_robin' | 'debate'
   * @param ctx.memoryService 可选注入（P3 实现时接入）
   */
  compose(ctx: PromptComposeCtx): Promise<ComposedPrompt>;

  /** 注册新模板版本 */
  registerTemplate(template: Omit<PromptTemplate, 'id' | 'createdAt'>): Promise<PromptTemplate>;

  /** 查询某角色某层的当前激活版本 */
  getActiveTemplate(roleCode: string, layer: PromptLayer): Promise<PromptTemplate | null>;

  /** 查询某角色所有版本历史 */
  getTemplateHistory(roleCode: string, layer?: PromptLayer): Promise<PromptTemplate[]>;

  /** 回滚到指定版本（创建新版本，内容复制自历史） */
  rollbackTo(roleCode: string, layer: PromptLayer, version: string): Promise<PromptTemplate>;
}

export interface PromptComposeCtx {
  readonly reviewId: string;
  readonly roleCode: string;
  readonly round: number;
  readonly phase: 'round_robin' | 'debate';
  readonly memoryService?: MemoryService;  // P3 注入位
}
```

### 2.3 四层组装规则

| 层 | 来源 | 组装逻辑 |
|----|------|----------|
| **base** | `PromptTemplate(layer='base', roleCode=CTO)` | 角色定义 + 职责描述；从 AgentRoleVersion.systemPrompt 同步（首次迁移） |
| **task** | `PromptTemplate(layer='task', roleCode=CTO)` | 本轮指令 + 维度列表；round-1 用"初始评审"模板，round≥2 用"辩论回应"模板 |
| **context** | MemoryService 注入（reviewer profile + session 状态） | 仅注入**蒸馏 profile**（维度擅长/偏见摘要），不注入原文历史 |
| **format** | `PromptTemplate(layer='format', roleCode=CTO)` | 输出 JSON schema；与 AgentRoleVersion.outputSchema 同步 |

> **组装顺序**：base → task → context → format，拼接为 `system` prompt；`user` prompt 由调用方注入（方案标题 + 目标 + 历史发言摘要）。

### 2.4 版本化规则

- 每次 `registerTemplate` 创建新版本（version 自增 "1.0" → "1.1"）
- 旧版本**不可变**（append-only），保证历史 opinion 可溯
- `rollbackTo` 创建新版本，内容复制自历史（不删旧版）
- 默认 mock 下，`compose` 返回的 `templateRefs` 仍正确填充（用于审计）

### 2.5 与现有 AgentRoleVersion 的关系

| 决策 | 结论 |
|------|------|
| 合并还是并行？ | **并行**：AgentRoleVersion 存"角色配置"（prompt + dimensions + schema），PromptService 存"prompt 版本历史"。首次迁移时，把 AgentRoleVersion.systemPrompt 同步为 PromptTemplate v1.0 base 层。 |
| 谁负责组装？ | PromptService 负责；queue.service.ts 不再直接拼 prompt，改为调 `promptService.compose()` |
| 审计落库 | ReviewOpinion 新增 `promptRefs` 字段（Json），记录组装所用模板 ID + 版本 |

---

## 3. MemoryService 契约

### 3.1 职责

- 管理**四层 Memory**（Session / Reviewer / Project / KB）
- 提供**蒸馏 profile** 读写（跨评审会长期沉淀）
- 提供 **rolling summary** 压缩（多轮上下文膨胀控制）
- **绝不存储聊天历史**（设计 rationale #4 红线）

### 3.2 四层 Memory 实现策略

| 层 | 生命周期 | 存储位置 | 实现策略 |
|----|----------|----------|----------|
| **Session** | 单场评审会 | `ReviewCheckpoint.stateJson`（既有） | 复用 P1 状态机；session 上下文（当前 round、未决冲突）已在 ReviewState 中 |
| **Reviewer** | 跨评审会长期 | 新表 `ReviewerMemory` | 蒸馏 profile：维度擅长/偏见/历史强弱项摘要 |
| **Project** | 项目周期 | 新表 `ProjectMemory` | 项目级知识（方案背景、历史决策、约束） |
| **KB** | 按需检索 | `KnowledgeChunk`（既有） | 通过 KnowledgeService 检索；P4 经 MCP tool 接入 |

### 3.3 Reviewer Memory（蒸馏 profile）

```ts
export interface ReviewerProfile {
  readonly roleCode: string;          // "CTO"
  readonly tenantId: string;
  readonly reviewerUserId: string;    // User.id（评审发起人或分配人）
  // 蒸馏维度（非聊天历史）
  readonly strengthDimensions: ReadonlyArray<{
    dimension: string;                // "架构合理性"
    confidenceAvg: number;            // 历史平均置信度
    reviewCount: number;              // 该维度参与评审次数
  }>;
  readonly biasIndicators: ReadonlyArray<{
    indicator: string;                // "倾向于高估技术风险"
    evidenceCount: number;            // 出现次数
    lastObservedAt: string;
  }>;
  readonly overallConfidenceAvg: number;
  readonly totalReviews: number;
  readonly lastReviewAt: string;
  readonly updatedAt: string;
}
```

> **蒸馏触发时机**：每场 review 完成后（`completed` / `aborted`），由 Moderator 节点调 `MemoryService.updateReviewerProfile(reviewId)`，从该场 opinions 聚合维度置信度 + 检测偏见模式。
>
> **mock 下**：蒸馏用确定性规则（如"该场 opinions 中 riskLevel=high 占比 >50% → biasIndicator='倾向于高风险标记'"），不调真实 LLM。

### 3.4 Project Memory

```ts
export interface ProjectMemory {
  readonly projectId: string;         // = Review.tenantId + 项目标识（首次可用 tenantId 代理）
  readonly tenantId: string;
  readonly background: string;        // 方案背景（摘要）
  readonly historicalDecisions: ReadonlyArray<{
    decision: string;                 // "2026-06 采用微服务架构"
    reviewId: string;                 // 来源
    decidedAt: string;
  }>;
  readonly constraints: ReadonlyArray<string>; // 约束清单
  readonly updatedAt: string;
}
```

> **写入时机**：review 完成后，从 report 提取关键决策 + 约束，追加到 ProjectMemory。
>
> **mock 下**：从 report.actionItems 提取标题作为 decision，constraints 留空。

### 3.5 MemoryService 接口

```ts
export interface MemoryService {
  // ── Reviewer 蒸馏 profile ──
  getReviewerProfile(roleCode: string, reviewerUserId: string, tenantId: string): Promise<ReviewerProfile | null>;
  updateReviewerProfile(reviewId: string): Promise<ReviewerProfile>;

  // ── Project 知识 ──
  getProjectMemory(tenantId: string, projectId?: string): Promise<ProjectMemory | null>;
  updateProjectMemory(reviewId: string): Promise<ProjectMemory>;

  // ── Rolling Summary ──
  /**
   * 压缩历史发言为增量摘要。
   * @param reviewId  当前评审
   * @param round     压缩目标轮次（压缩 round-1 到 round-N-1 的原文）
   * @returns 压缩后的摘要文本
   */
  compressRoundContext(reviewId: string, round: number): Promise<string>;

  /**
   * 获取当前可用的上下文摘要（供 prompt 组装注入）。
   */
  getContextSummary(reviewId: string): Promise<string>;

  // ── Session（复用 P1 状态机，不重复存储）──
  // Session 上下文由 ReviewState 管理，MemoryService 不直接读写
}
```

### 3.6 Rolling Summary 策略

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `compress_trigger_round` | 3 | round ≥ 3 时触发压缩（前两轮原文保留） |
| `max_context_tokens` | 8000 | 超过此阈值触发压缩 |
| `compression_ratio` | 0.3 | 压缩后保留原文 30% 长度 |

> **mock 下**：`compressRoundContext` 用确定性截断（取前 N 条 opinion 的 issue + recommendation 拼接），不调 LLM。真实压缩在 P2 模型层就绪后接入，仍须显式 env + Gate。

---

## 4. KB/RAG 接入点

### 4.1 当前状态

- `KnowledgeDocument` / `KnowledgeChunk` 表已存在
- `KnowledgeChunk` 有 `embeddingRef`（pgvector 占位）+ `reviewStatus` 审核态
- `modules/knowledge/` 有基础 CRUD controller
- **无 RAG 检索实现**（embeddingRef 为空）

### 4.2 P3 接入策略

| 决策 | 结论 |
|------|------|
| 何时做 RAG？ | P3 仅**预留接口位**，不实现真实 embedding 检索 |
| KB 如何接入 prompt？ | 通过 `MemoryService.getContextSummary()` 注入；P4 经 MCP tool 检索后注入 |
| P3 mock 下 KB 行为？ | `getContextSummary()` 返回空字符串或固定占位（"KB 未配置"） |

```ts
export interface KnowledgeService {
  /** P3 mock：返回空（KB 未配置） */
  searchRelevantChunks(reviewId: string, query: string, limit?: number): Promise<KnowledgeChunk[]>;

  /** P3 mock：返回空摘要 */
  getKnowledgeContext(reviewId: string): Promise<string>;
}
```

> P4 实现时，`searchRelevantChunks` 接真实 embedding 检索（pgvector 或外部 API），仍须显式 env + Gate。

---

## 5. 与 P1 Graph Runtime 集成

### 5.1 NodeCtx 注入

```ts
// orchestrator/graph-runtime.ts（P3 改造后）
export interface NodeCtx {
  // ... 既有字段保留
  readonly promptService: PromptService;     // P3 注入（替代 undefined）
  readonly memoryService: MemoryService;     // P3 注入（替代 undefined）
  readonly knowledgeService: KnowledgeService; // P3 注入
}
```

### 5.2 集成点

| 节点 | 集成行为 |
|------|----------|
| `running`（派发 turn 前） | 调 `promptService.compose()` 生成 prompt，注入到 turn payload |
| `summarized`（Moderator 汇总后） | 调 `memoryService.updateReviewerProfile()` + `updateProjectMemory()` |
| `completed` / `aborted`（终态） | 同上（确保终态也更新 memory） |
| `running`（round ≥ 3） | 调 `memoryService.compressRoundContext()` 压缩历史 |

### 5.3 queue.service.ts 改造

- 去掉 `SYSTEM_PROMPT` 常量 + 硬编码 prompt 拼接
- `executeAgentTurn` 改为调 `ctx.promptService.compose()` 取 prompt
- 组装结果写入 `ReviewOpinion.promptRefs`（Json 列）

---

## 6. Prisma Schema 增量（delta 清单，**不实施**）

> 仅声明 delta；实施在 5.1 实现 Sprint，走**标准 Gate**（动 schema）。

### 6.1 新增表

```model ReviewerMemory {
  id            String   @id @default(uuid()) @db.Uuid
  tenantId      String   @map("tenant_id") @db.Uuid
  roleCode      String   @map("role_code")
  reviewerUserId String  @map("reviewer_user_id") @db.Uuid
  profile       Json     // ReviewerProfile 序列化
  totalReviews  Int      @default(0) @map("total_reviews")
  lastReviewAt  DateTime? @map("last_review_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  @@unique([tenantId, roleCode, reviewerUserId])
  @@index([tenantId])
  @@map("reviewer_memories")
}

model ProjectMemory {
  id         String   @id @default(uuid()) @db.Uuid
  tenantId   String   @map("tenant_id") @db.Uuid
  projectId  String   @map("project_id")  // 首次用 tenantId 代理
  background String   @default("")
  decisions  Json     @default("[]")     // historicalDecisions 序列化
  constraints String[] @default([])
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@unique([tenantId, projectId])
  @@map("project_memories")
}

model PromptTemplateRecord {
  id           String   @id @default(uuid()) @db.Uuid
  roleCode     String   @map("role_code")
  layer        String   @map("layer")       // base | task | context | format
  version      String   @map("version")     // "1.0" / "1.1"
  content      String   @map("content")
  metadata     Json     @map("metadata")    // PromptMetadata 序列化
  createdBy    String   @map("created_by") @db.Uuid
  createdAt    DateTime @default(now()) @map("created_at")

  @@unique([roleCode, layer, version])
  @@index([roleCode, layer])
  @@map("prompt_templates")
}
```

### 6.2 既有表加列

```model ReviewOpinion {
  // ... 既有字段保留
  promptRefs Json? @map("prompt_refs")  // P3 新增：ComposedPrompt.templateRefs 序列化
}
```

### 6.3 不触碰

- `AgentRoleVersion` 表（保留，P3 仅同步数据到 PromptTemplateRecord）
- `KnowledgeDocument` / `KnowledgeChunk` 表（保留，P4 才动）
- `Review` / `ReviewTurn` 表（保留）

---

## 7. API 契约保留边界（红线）

### 7.1 保持不变的对外接口

- `POST /api/reviews` 等所有既有 reviews 端点
- `GET /api/roles` / `POST /api/roles` 等 roles 端点
- `GET /api/quality/*` 等 quality 端点
- `GET /api/audit/logs` 等 Sprint 5.0 新增端点
- `GET /api/users/*` 等 Sprint 5.0 新增端点
- SSE `/api/reviews/{id}/meeting/stream` 等

### 7.2 P3 新增内部接口（不新增对外 REST/SSE）

- PromptService / MemoryService / KnowledgeService 为**内部模块调用**，不直接暴露 REST
- 可选新增管理端点（P3 实现时走独立 Gate）：
  - `GET /api/admin/prompt-templates`（查询模板历史）
  - `POST /api/admin/prompt-templates`（注册新版本）
  - `GET /api/admin/reviewer-profiles`（查询蒸馏 profile）

> 上述管理端点**不在本 Contract 范围**，实施时单独声明。

---

## 8. 技术边界（In / Out）

### In（P3 交付）

- PromptService 接口 + 实现（版本化注册表 + 四层组装）
- MemoryService 接口 + 实现（蒸馏 profile + rolling summary + project memory）
- KnowledgeService 接口（mock 占位）
- 3 张新表（ReviewerMemory / ProjectMemory / PromptTemplateRecord）
- ReviewOpinion 加 `promptRefs` 列
- queue.service.ts 改造（调 PromptService 拼 prompt）
- graph runtime NodeCtx 注入 promptService / memoryService / knowledgeService
- 从 AgentRoleVersion 迁移 systemPrompt → PromptTemplateRecord v1.0
- 默认 mock（蒸馏用确定性规则；rolling summary 用截断；KB 返回空）

### Out（后续 phase）

- 真实 embedding / RAG 检索（P4）
- MCP tool 层（P4）
- 真 LLM Moderator 接入（P4）
- 可配置 workflow / 评分（P5）
- AgentRuntime worker 抽取（P6）
- 管理端点 REST API（单独 Gate）

### P3 红线

- 默认 mock（蒸馏 / rolling summary / KB 均不调真实 LLM）
- 真模型仅显式 env + Gate
- schema 变更（§6）实施走**标准 Gate**（非 fast-gate）
- 不 `--force`
- **memory 不存聊天历史**（设计 rationale #4 红线）

---

## 9. 验证期望（供 5.1 实现遵守）

| 验证项 | 期望 |
|--------|------|
| `tsc --noEmit` | 0 errors（apps/api） |
| 默认 mock 下 round-1 + round-2 + summarize + completed 跑通 | smoke 31/31 |
| `promptService.compose()` 返回的 `templateRefs` 包含 4 层模板 ID | 断言 |
| `ReviewOpinion.promptRefs` 写入非空 | 断言 |
| `memoryService.updateReviewerProfile()` 后 `ReviewerMemory` 表有记录 | 断言 |
| `memoryService.compressRoundContext()` round ≥ 3 返回非空摘要 | 断言 |
| AgentRoleVersion 数据迁移到 PromptTemplateRecord 后，base 层 v1.0 存在 | 断言 |
| 幂等：重复 `compose()` 返回相同 templateRefs | 断言 |
| 回归 | `setup-demo-review.js`（路线 A/B）、Report API、SSE 不破 |
| 审计 | 每条 opinion 可溯 prompt 版本 |

---

## 10. Gate 模式声明

### 10.1 本 Contract Sprint（5.1）= 纯文档，fast-gate

| §7.1 条件 | 本 Sprint 5.1 | 结论 |
|-----------|---------------|------|
| 1. 不改 Prisma schema | ✅ 仅声明 delta（§6），未实施 | 满足 |
| 2. 不改状态机实现 | ✅ 仅声明目标接口，未改代码 | 满足 |
| 3. 不涉及真实 LLM/Embedding/MinIO 首次接入 | ✅ 无模型调用 | 满足 |
| 4. 不改前端主页面 | ✅ 前端零改动 | 满足 |
| 5. 不引入新外部依赖 | ✅ 无依赖变更 | 满足 |

**结论**：5.1 为**纯文档**，符合快速 Gate 模式。

### 10.2 本 Contract 指定的 5.1 实现 Sprint = 标准 Gate

> ⚠️ **5.1 实现 Sprint 不得走 fast-gate**。本 Contract 的 §6（Prisma schema 增量）将**实际改动 schema**，触发协议 §5.4 + §7.1 退回标准流程。实现 Sprint 须走**标准 Gate**（tsc/smoke/verify 证据），由 Codex 裁决 Go/No-Go。

---

## 附：交付物清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `docs/coordination/Sprint_5.1_P3_Prompt_Memory_Contract.md` | 新增（本文件） | P3 Prompt + Memory Backend Contract |
| `docs/coordination/ACTIVE_SPRINT.md` | 更新 | 滚动到 5.1；5.0 推进为 Go（`332b5b0`），新增 5.1 In Progress |

> 本 Sprint 未执行 `git commit` / `git push`。文档就绪后回报 Codex，由 Codex 走 fast-gate 再决定是否提交。
