# Sprint 5.2 — P4 Tool + HITL Contract

> **角色**：workbuddy-docs（纯文档，fast-gate）
> **模式**：快速 Gate（§7.1 — 纯文档、不改 schema/状态机/模型/前端/依赖）
> **架构权威**：`docs/roadmap/Sprint_9.0_Product_Roadmap_Reset.md`（§2 决策 #6 A2A 反模式 / §6 rationale / §11 P4 范围）
> **前置**：Sprint 5.1 Go（commit `0f56520`，P3 Prompt+Memory 入库）
> **日期**：2026-07-14
> **Owner**：workbuddy-docs
> **目的**：把 P4（Tool + HITL）展开为可实现 Backend Contract：MCP 工具层接口、Moderator 工具审批中断、人工轮次 override、真 LLM Moderator 接入点、Prisma schema 增量声明。**本 Contract 只写 spec，不实现**。

---

## 1. 路线图位置与当前状态

### 1.1 路线图进度

```
P0 MVP        ✅
P1 编排脊柱    ✅
P2 Model Adapter ✅
P3 Prompt + Memory ✅
→ P4 Tool + HITL  ← 本 Contract
P5 Workflow + 评分
P6 规模化（权限审计部分已完成）
```

### 1.2 已核实的代码事实

| 能力 | 现状 | 位置 |
|------|------|------|
| HITL interrupt/resume API | `POST /interrupt` + `/resume` 仅翻 DB status，**不真正暂停 orchestrator**（turns 仍在 queue 跑） | `reviews.service.ts` + controller |
| HITL 状态流转 | `running → interrupted → running` 在 `REVIEW_STATUS_FLOW` + P1 状态机中声明 | `graph-runtime.ts` / `REVIEW_STATUS_FLOW` |
| Mock Moderator | 决策走确定性规则（轮次+硬闸），**无 LLM 接入路径** | `orchestrator/moderator.ts` |
| ModelAdapter P2 注入位 | `ctx.modelAdapter` 已实现（mock / lmstudio / openai_compatible），通过 `createProviderAdapter()` | `review-orchestrator.ts` |
| 工具调用（tool call） | **无** — reviewer/Moderator 不调外部工具 | — |
| A2A 反模式 | 设计禁止 reviewer 互联，**未实现**（当前无 reviewer 间通信代码） | 9.0 §6 rationale #6 |
| Knowledge P3 接口 | `KnowledgeService.getKnowledgeContext()` mock 空 | `modules/knowledge/` |
| 报告生成 | `ReportingService` 雏形在 `reviews.service.ts`（getReport / exportMarkdown），**无 Moderator 叙事注入** | `reviews.service.ts` |

### 1.3 三条承重决策对 P4 的约束

| 决策 | P4 影响 |
|------|---------|
| **决策 #2**（Moderator = LLM Agent + 硬闸） | P4 把 Mock Moderator 替换为 `LlmModerator`（真 LLM），通过 `ctx.modelAdapter` 调用；仍须显式 env + Gate |
| **决策 #6**（A2A 反模式，只采纳 MCP for tools） | Tool 层**只**走 MCP 协议；禁止 reviewer 间直接通信 |
| **决策 #1**（Graph 脊柱 + Code 叶子） | Tool node 是 graph 节点（spine），tool 执行函数是叶子 |

---

## 2. Tool 层契约

### 2.1 设计原则

- **工具仅经 MCP**：不直连任何外部服务；MCP server 是唯一工具提供者
- **Moderator 审批**：Moderator 决定本轮可以使用哪几个 tool（防止 tool 滥用）
- **Reviewer 禁止自由调研**：reviewer 不能自行调 tool，只能请求 Moderator 提供工具结果
- **mock 默认**：默认不调真实 MCP server（工具调用返回空或 stub）

### 2.2 ToolType 分类

```ts
export type ToolType =
  | 'knowledge_search'     // KB/RAG 检索（via MCP，替代 P3 预留的 KnowledgeService 接入位）
  | 'code_analysis'        // 代码静态分析（via MCP）
  | 'web_search'           // 外部搜索（via MCP，可选）
  | 'calculation'          // 计算/估算（via MCP，可选）
  | 'custom';              // 用户自定义工具（via MCP）

export interface ToolDefinition {
  readonly name: string;                  // "knowledge_search"
  readonly type: ToolType;
  readonly description: string;
  readonly inputSchema: JsonSchema;       // 工具输入 schema
  readonly mcpServerRef: string;          // MCP server 标识（env 配置名，如 "knowledge"）
  readonly enabled: boolean;
}

export interface ToolCallRequest {
  readonly id: string;
  readonly reviewId: string;
  readonly round: number;
  readonly requestedBy: 'moderator';      // 只有 Moderator 可以请求工具（A2A 禁止 reviewer 直接调）
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly approvedBy: string;            // ModeratorDecision.id
  readonly status: 'pending' | 'executing' | 'completed' | 'failed' | 'denied';
  readonly result?: unknown;
  readonly deniedReason?: string;
  readonly createdAt: string;
  readonly completedAt?: string;
}
```

### 2.3 ToolRegistry 接口

```ts
export interface ToolRegistry {
  /** 注册工具定义（启动时或动态） */
  registerTool(def: ToolDefinition): Promise<void>;

  /** 列出 Moderator 本轮可选的工具清单（附启用状态） */
  listAvailableTools(round: number, phase: string): Promise<ToolDefinition[]>;

  /** 执行工具调用（经 Moderator 审批后） */
  executeTool(request: Omit<ToolCallRequest, 'id' | 'createdAt' | 'status'>): Promise<ToolCallRequest>;

  /** 获取审批日志 */
  getApprovalLog(reviewId: string, round?: number): Promise<ToolCallRequest[]>;
}
```

### 2.4 Tool 执行节点（Graph 节点）

```ts
// orchestrator 新增节点
export interface ToolNodeContext {
  readonly toolCallId: string;            // 关联的 ToolCallRequest
  readonly registry: ToolRegistry;
  readonly checkpointer: Checkpointer;
}

// Tool node 行为：
// 1. 读 ToolCallRequest（已有 approvedBy → Moderator 已审批）
// 2. 调 registry.executeTool()
// 3. 写 ToolCallRequest 完成态 + result
// 4. 条件边：completed → 下一节点（running 或 summarized）/ failed → summarized（降级）
```

### 2.5 MCP 接入策略

| 决策 | 结论 |
|------|------|
| 引入 MCP SDK？ | **P4 仅预留接口位**，不安装真实 `@modelcontextprotocol/sdk` |
| mock 下行为？ | `executeTool()` 返回 stub 结果（如 knowledge_search → `[]`） |
| 真实接入时机？ | **安装 MCP SDK 须独立 Gate**（P4 实施时不启用真实 MCP server） |
| 配置位置 | `MCP_SERVER_{NAME}_URL` / `MCP_SERVER_{NAME}_TOKEN` 环境变量（文档描述，不硬编码） |

---

## 3. HITL（Human-in-the-Loop）中断契约

### 3.1 当前 Gap

现有 `/interrupt` 只是 DB status 翻牌 — 不会实际阻止 queue 继续跑 turn。P4 要闭合这个 gap：**interrupt 必须真正暂停 orchestrator，resume 必须从中断点恢复**。

### 3.2 三种 HITL 场景

| 场景 | 触发方 | 行为 |
|------|--------|------|
| **Manual Interrupt** | 用户（`POST /interrupt`） | 暂停 orchestrator：停止派发新 turn → 等当前 turn 完成 → 锚 `interrupted` checkpoint → **不触发 summarize** |
| **Tool Approval Gate** | Moderator 决策 → 工具调用中断 | 锚 checkpoint → 注入工具调用结果 → **可选**等人工确认 |
| **Human Turn Override** | 用户在某 round 显式提供意见 | `POST /reviews/:id/meetings` 提交人工意见 → 写入 ReviewOpinion（`source: 'human'`）→ 继续 |

### 3.3 状态机修正

新增转换与节点：

```
running → interrupted     [POST /interrupt 或 Moderator 工具审批中断]
interrupted → running     [POST /resume  或 人工 override 提交]
interrupted → summarized  [人工 override 完成后直接汇总]
```

节点图：

```
created → diagnosed
       → running(r1) → [turns 终态] → Moderator.decide()
                                   ├→ [converge]          → summarized → completed
                                   ├→ [continue_debate]   → summarized → running(r2)
                                   ├→ [tool_approval]      → tool_node
                                   │                         ├→ [tool_completed] → summarized
                                   │                         ├→ [tool_failed]    → summarized (降级)
                                   │                         └→ [needs_human_confim] → interrupted
                                   └→ [force_stop]        → aborted
interrupted → running     [resume() 或 human_turn()]
interrupted → summarized  [human_override + finalize]
```

### 3.4 interrupt 实现要求

```ts
// orchestrator 新增 interrupt 能力
async interrupt(reviewId: string): Promise<void> {
  // 1. 拉 orchestrator 内部 running flag（阻止下一轮 turn 派发）
  // 2. 等到当前 turn 全部终态（terminal for round）
  // 3. 写 ReviewCheckpoint(reviewId, 'interrupted', state)   // resume 锚点
  // 4. 写 Review status = 'interrupted' + currentNodeId='interrupted'
  // 5. 写 ModeratorDecision(decisionType='tool_approval' 或 'force_stop', reasoning='HITL manual interrupt')
}
```

### 3.5 resume 实现要求

```ts
async resume(reviewId: string): Promise<void> {
  // 1. load checkpoint where nodeId='interrupted'
  // 2. 检查 review.status === 'interrupted'
  // 3. 恢复 orchestrator running flag
  // 4. write status='running', write checkpoint nodeId='running'
  // 5. 从中断点继续：若 tool_call 待完成 → re-dispatch tool_node; 否则 → 派发下一轮 turn
}
```

### 3.6 Human Turn Override API

```ts
POST /api/reviews/:reviewId/meetings
Body: { round: number, opinions: Array<{
  dimension: string, riskLevel: 'high'|'medium'|'low'|'info',
  issue: string, recommendation: string, confidenceScore: number, citations?: string[]
}> }
```

- 校验：review 在 `running` 或 `interrupted` + 该 round 未汇总
- 写入：`ReviewOpinion.source = 'human'` + `ReviewTurn.status = 'completed'`（人工 turn 跳过 LLM）
- 可选 resume：若 review 处于 `interrupted`，提交后自动 resume

---

## 4. 真 LLM Moderator 接入

### 4.1 当前位

- `ctx.modelAdapter` 已实现 P2 三态 adapter（mock / lmstudio / openai_compatible）
- `orchestrator/moderator.ts` 是 `MockModerator`（确定性）
- `LlmModerator` 未实现

### 4.2 LlmModerator 接口

```ts
export interface LlmModerator {
  // 与 MockModerator 同签名，替换 decision 生成方式
  decide(state: ReviewState, ctx: NodeCtx): Promise<ModeratorDecisionType>;
  // 新方法：生成汇总叙事
  narrate(state: ReviewState, ctx: NodeCtx): Promise<string>;
  // 新方法：提议本回合可用工具
  proposeTools(state: ReviewState, ctx: NodeCtx): Promise<ToolDefinition[]>;
}
```

### 4.3 接入策略

| 决策 | 结论 |
|------|------|
| 何时接入真实 LLM Moderator？ | **显式 env + Gate**：`MODERATOR_PROVIDER=llm`（默认 unset → MockModerator） |
| mock 默认行为 | `MODERATOR_PROVIDER` 未设置 → ReviewOrchestrator 构造 `MockModerator`（已有） |
| 真 LLM 路径 | `MODERATOR_PROVIDER=llm && ALLOW_EXTERNAL_MODEL_CALLS=true` → `LlmModerator`（经 `ctx.modelAdapter`） |
| 失败降级 | LLM 调用失败 → fail-closed → 回退 `MockModerator.decide()` + 审计 `providerSource='fallback_mock'` |
| prompt 来源 | `PromptService.compose()` 生成 Moderator 的 system prompt（含工具列表 + 状态摘要） |
| 硬闸 | "LLM 在循环里，代码在边界上" — 硬闸仍是代码强制，`RuleCheckResult` 仍由 Moderator 执行层校验（LLM 不可覆盖） |
| 反对 sanity check | 收敛 override 时 LLM 反对理由须过 sanity check（非空 + 引用具体未决冲突） → 接口已留（`terminate_proposal`），P4 落地 |
| Provider 选择 | LlmModerator 复用既有 `provider/createProviderAdapter()` factory（不重新发明轮子），通过 env（`MODEL_PROVIDER`）选择底层 provider；LongCat 是其中一个 provider 选项（见 §4.6） |
| 重试 / 限流 | 429 → 读 `error.retry_after` → 指数退避（最多 2 次）；401/403/4xx → GUARD 不可重试；5xx/网络错误 → 可重试（降级 MockModerator） |

### 4.4 Moderator 决策审计增强

```ts
export interface ModeratorDecision {
  // 既有字段保留 + 新增
  readonly proposedTools?: string[];      // Moderator 本轮提议的工具名列表
  readonly toolApprovalReasoning?: string; // 审批工具的理由
  readonly llmRawOutput?: string;          // LLM 原始输出（脱敏，仅 providerSource=llm 时填写）
  readonly sanityCheckResult?: {           // 反对 sanity check 结果
    readonly oppositionAllowed: boolean;   // false = 反对被驳回（系统强停仍生效）
    readonly sanityReason: string;
  };
}
```

### 4.6 Provider 选项（LongCat 参考）

LlmModerator 通过既有 `createProviderAdapter()` factory 获得 ModelAdapter, `MODEL_PROVIDER` 决定底层 provider。P4 不新建 LongCat 专有 adapter（与 Sprint 2.1 既有 `OpenAICompatibleAdapter` 复用）。

| Provider | `MODEL_PROVIDER` | 底层 Base URL | 默认模型 | 备注 |
|----------|------------------|---------------|----------|------|
| Mock（默认） | unset / `mock` | — | — | 不调外部、零成本 |
| LM Studio | `lmstudio` | `http://127.0.0.1:1234/v1` | 本地加载 | dev-only, ≤3 cap |
| **LongCat** | `longcat` | `https://api.longcat.chat/openai/v1` | `LongCat-2.0` | OpenAI 兼容, env-gated |
| OpenAI 兼容（通用） | `openai_compatible` | `MODEL_BASE_URL` | `MODEL_NAME` | 任意兼容端点 |

**LongCat 调用参考**（OpenAI 兼容协议，供 LlmModerator 调试用）：

- Bearer <REDACTED>：`Authorization: Bearer ${process.env.MODEL_API_KEY}`（不落库/不提交/回报中不输出 key 原文）
- 请求体：`{ model, messages:[{role:'system',content},{role:'user',content}], temperature:input.temperature ?? 0.7, max_tokens:input.maxTokens ?? 2000 }`
- 限流：HTTP 429 + body.error.retry_after（秒）→ 指数退避重试（最多 2 次）
- 解析：`choices[0].message.content` → text；`usage` → ModelOutput.usage

> 仅 `ALLOW_EXTERNAL_MODEL_CALLS=true` + `MODEL_PROVIDER=longcat` + `MODEL_API_KEY` 三条件同时满足时启用真实 LongCat。缺 key → factory 返回 MockAdapter（GUARD）。

### 4.7 P4 实施范围（env-gated 部分）

| 任务 | 本次是否实施真实 LLM | mock 行为 |
|------|---------------------|-----------|
| LlmModerator 类 + 接口 | ✅ 实现类 | `MODERATOR_PROVIDER` 未 set 时不构造 |
| PromptService.composeForModerator() | ✅ | prompt 走 P3 PromptService |
| proposeTools() (LLM 提议工具) | ✅ 实现 + env-gated | mock: 返回空数组（不提议工具） |
| narrate() (LLM 叙事) | ✅ 实现 + env-gated | mock: 返回固定叙事 |
| decide() (LLM 决策) | ✅ 实现 + env-gated | mock: 走 MockModerator.decide() 降级 |
| sanityCheck() (反对过sanity) | ✅ 实现 | mock: 恒 true（mock 不提反对） |
| MCP 真实调用 | ❌ 不实现（预留 `ToolRegistry.executeTool` mock stub） | 返回空/fixed stub |
| `@modelcontextprotocol/sdk` 引入 | ❌ 不引入（独立 Gate） | — |

---

## 5. Prisma Schema 增量（delta 清单，**不实施**）

> 仅声明；实施在 5.2 实现 Sprint，走**标准 Gate**（动 schema + 状态机）。

### 5.1 新增表

```model ToolCallRequest {
  id            String   @id @default(uuid()) @db.Uuid
  reviewId      String   @map("review_id") @db.Uuid
  round         Int
  requestedBy   String   @map("requested_by")  // 'moderator'
  toolName      String   @map("tool_name")
  input         Json     @default("{}")
  approvedBy    String?  @map("approved_by")    // ModeratorDecision.id
  status        String   @default("pending")   // pending|executing|completed|failed|denied
  result        Json?
  deniedReason  String?  @map("denied_reason")
  createdAt     DateTime @default(now()) @map("created_at")
  completedAt   DateTime? @map("completed_at")

  review Review @relation(fields: [reviewId], references: [id])
  @@index([reviewId, round])
  @@map("tool_call_requests")
}

model ToolDefinitionRecord {
  id           String   @id @default(uuid()) @db.Uuid
  name         String   @unique
  type         String                         // knowledge_search|code_analysis|web_search|calculation|custom
  description  String
  inputSchema  Json     @map("input_schema")
  mcpServerRef String   @map("mcp_server_ref")
  enabled      Boolean  @default(true)
  createdAt    DateTime @default(now()) @map("created_at")

  @@map("tool_definitions")
}
```

### 5.2 既表加列

```model ModeratorDecision {
  // 既有字段保留
  proposedTools        String[] @default([]) @map("proposed_tools")
  toolApprovalReasoning String? @map("tool_approval_reasoning")
  llmRawOutput         String? @map("llm_raw_output")
  sanityCheckResult    Json?   @map("sanity_check_result")
}

model ReviewOpinion {
  // 既有字段保留
  source String? @default("llm")   // 'llm' | 'human' | 'mock'
}
```

### 5.3 不触碰

- 既有 `Review / ReviewTurn / ReviewCheckpoint / QualityReport / ReviewerMemory / ProjectMemory / PromptTemplateRecord` 表
- `AgentRole / AgentRoleVersion` 表
- `User / AuditLog / Tenant / Department` 表（Sprint 5.0/5.1 稳定）

---

## 6. API 契约保留边界

### 6.1 保持不变的对外接口

所有既有 reviews / roles / quality / audit / users / knowledge 端点不动。

### 6.2 P4 新增

| 端点 | 方法 | 权限 | 说明 |
|------|------|------|------|
| `/api/reviews/:id/meetings` | POST | `review.write` | 人工 turn override（`source='human'`） |
| `/api/reviews/:id/interrupt` | POST | `review.write` | **改造** — 真正暂停 orchestrator（wait-for-terminal + anchor checkpoint） |
| `/api/reviews/:id/resume` | POST | `review.write` | **改造** — 从 `interrupted` checkpoint resume，自动续跑 |
| `/api/reviews/:id/tool-requests` | GET | `role.read` | 查看工具审批日志 |

### 6.3 P4 环境变量（新增 + 复用的既有变量）

| 变量 | 默认 | 说明 |
|------|------|------|
| `MODERATOR_PROVIDER` | unset (→ MockModerator) | `llm` = 真 LLM Moderator（经 factory 选底层 provider） |
| `MCP_SERVER_KNOWLEDGE_URL` | unset | KB/RAG MCP server 端点（显式 set 才启用） |

**底层 provider 选择**（复用 Sprint 2.1 既有变量，不新建机制）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `ALLOW_EXTERNAL_MODEL_CALLS` | `false` | 总闸：`true` 才允许真实 LLM 调用 |
| `MODEL_PROVIDER` | unset (→ mock) | `longcat` / `lmstudio` / `openai_compatible` |
| `MODEL_BASE_URL` | 按 provider 默认 | LongCat = `https://api.longcat.chat/openai/v1` |
| `MODEL_NAME` | 按 provider 默认 | LongCat = `LongCat-2.0` |
| `MODEL_API_KEY` | unset | Real provider 密钥（不落库/不提交） |

> 底层 provider 选择 = 对 `createProviderAdapter()` 已有行为的复用；P4 不修改 factory provider-routing 逻辑。

---

## 7. 技术边界

### In（P4）

- `ToolRegistry` 接口 + mock stub 实现（不引入真实 MCP SDK）
- `LlmModerator` 类（env-gated，默认不启用）
- Moderator 工具审批中断（`tool_approval` 决策 + `tool_node`）
- HITL 真正暂停/恢复（`interrupt`/`resume` 闭合 gap）
- Human turn override API（`source='human'`）
- sanity check（反对须过 sanity check 才放行）
- 审计增强（proposedTools / toolApprovalReasoning / llmRawOutput / sanityCheckResult）
- 2 张新表（ToolCallRequest / ToolDefinitionRecord）+ 既表加列（ModeratorDecision / ReviewOpinion.source）

### Out（后续 phase）

- 真实 MCP SDK 安装与 MCP server 通信（P4 仅 stub，独立 Gate）
- 可配置 workflow / 评分（P5）
- AgentRuntime worker 抽取 + OTel（P6）
`ToolApprovalLog` 前端查看（可选独立 Gate）

### P4 红线

- **A2A 禁止**：reviewer 不调工具；仅经 Moderator + graph 脊柱
- 工具仅经 MCP（不直连）
- 真 LLM Moderator 仅显式 env + Gate（`MODERATOR_PROVIDER=llm && ALLOW_EXTERNAL_MODEL_CALLS=true`）
- 默认 mock 演示（`MODERATOR_PROVIDER` 未 set → MockModerator 路径）
- 失败降级（LLM fail → MockModerator fallback）
- 硬闸仍代码强制（LLM 不可覆盖）
- schema delta 实施走**标准 Gate**
- 不 `--force`

---

## 8. 验证期望

| 验证项 | 期望 |
|--------|------|
| `tsc --noEmit` | 0 errors |
| 默认 mock smoke | 31/31 |
| interrupt 真正暂停（下一 turn 不派发） | 验证：interrupt 后 queue 暂停 |
| resume 从中断点续跑 | 验证：resume 后从 `interrupted` checkpoint 续 |
| human turn override 写入 source='human' | 验证：GET /report 包含 human opinion |
| LlmModerator env-gated | 验证：未 set `MODERATOR_PROVIDER` → MockModerator 路径；set `=llm` 未 set `ALLOW_EXTERNAL` → fail-closed → fallback mock |
| mock ToolRegistry 返回 stub | 验证：tool_node 不阻塞流程 |
| sanity check | 验证：反对理由空/无引用 → 驳回；反对理由引用具体冲突 → 允许 |
| 审计完整性 | each decision 含 proposedTools + 各字段 |
| 回归 | 既有 reviews/roles/quality/audit/users 端点不破 |

---

## 9. Gate 模式声明

### 9.1 本 Contract Sprint（5.2）= 纯文档，fast-gate

| §7.1 条件 | 本 Sprint 5.2 | 结论 |
|-----------|---------------|------|
| 1. 不改 Prisma schema | ✅ 仅声明 delta | 满足 |
| 2. 不改状态机实现 | ✅ 仅声明目标 | 满足 |
| 3. 不涉及真实 LLM/MCP 首次接入 | ✅ 仅描述接口位 | 满足 |
| 4. 不改前端主页面 | ✅ 前端零改动 | 满足 |
| 5. 不引入新外部依赖 | ✅ 无依赖变更 | 满足 |

**结论**：5.2 为**纯文档**，符合快速 Gate 模式。

### 9.2 本 Contract 指定的 5.2 实现 Sprint = 标准 Gate

> ⚠️ 5.2 实现 Sprint 不得走 fast-gate。本 Contract 的 §5（Prisma schema 增量）+ §3（状态机实施）将实际改动 schema 与状态机实现，触发 §5.2/§5.4 + §7.1 退回标准流程。实现 Sprint 须走**标准 Gate**。

---

## 附：交付物清单

| 文件 | 类型 |
|------|------|
| `docs/coordination/Sprint_5.2_P4_Tool_HITL_Contract.md` | 新增（本文件） |
| `docs/coordination/ACTIVE_SPRINT.md` | 更新（滚动到 5.2） |

> 未执行 `git commit` / `push`。文档就绪后回报 Codex，走 fast-gate 再决定。
