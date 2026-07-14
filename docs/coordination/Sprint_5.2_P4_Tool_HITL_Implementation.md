# Sprint 5.2 — P4 Tool + HITL 实现

> **角色**：workbuddy-coder（标准 Gate）
> **模式**：标准 Guard（2 新表 + 既表加列 + 新模块 + 状态机改动 + LLM Moderator env-gated）
> **架构权威**：`docs/coordination/Sprint_5.2_P4_Tool_HITL_Contract.md`
> **基线**：main = `0f56520`（Sprint 5.1 已入库）
> **日期**：2026-07-14
> **Owner**：workbuddy-coder

---

## 0. 开工三连查（强制 P0）

```bash
git rev-parse --show-toplevel   # = D:/workspace/PrismReview
git status --short
git remote -v                   # = feather100/PrismReview
git pull --ff-only origin main  # 快进到 0f56520
```

---

## 1. 必读

1. `docs/coordination/Sprint_5.2_P4_Tool_HITL_Contract.md`（权威）
2. 既有 L1 代码：`orchestrator/moderator.ts` / `orchestrator/review-orchestrator.ts` / `graph-runtime.ts` / `queue.service.ts` / `reviews.service.ts` / `reviews.controller.ts` / `provider/model-adapter.ts` / `provider/provider-factory.ts`

---

## 2. Schema 变更

按 Contract §5 实施：

- 新表 `ToolCallRequest`（@@index([reviewId, round])）
- 新表 `ToolDefinitionRecord`（@@unique name）
- `ModeratorDecision` 加 `proposedTools String[]` / `toolApprovalReasoning String?` / `llmRawOutput String?` / `sanityCheckResult Json?`
- `ReviewOpinion` 加 `source String?` (default 'llm')

`prisma migrate dev` → apply → `migrate status` = up to date → `prisma generate`。

---

## 3. 实现任务

### 3.1 ToolRegistry（mock stub）

**新建 `modules/tool/tool.registry.ts`**

- `registerTool(def)` → 落 `ToolDefinitionRecord`（若 name 存在则 update）
- `listAvailableTools(round, phase)` → 返回 enabled=true 的工具（mock 返回空列表或固定 stub）
- `executeTool(request)` → mock：创建 ToolCallRequest(status='completed') + result 为 stub（knowledge_search → `{ chunks: [] }`）；不调真实 MCP
- `getApprovalLog(reviewId, round?)` → 读 ToolCallRequest

**新建 `modules/tool/tool.module.ts`**（providers ToolRegistry + exports）。

### 3.2 LlmModerator（env-gated，核心新增）

**新建 `modules/reviews/orchestrator/llm-moderator.ts`**

与 `MockModerator` 同签名 + 3 个新方法, **复用既有 factory 选 provider**（不新建 LongCat 专有 adapter — 与 Sprint 2.1 既有 `OpenAICompatibleAdapter` 复用）。

```ts
export class LlmModerator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelAdapter: ModelAdapter,  // 经 createProviderAdapter() 注入（LongCat 在其中）
    private readonly promptService: PromptServiceImpl,  // P3
  ) {}

  // 替代 MockModerator.decide() — 真 LLM 决策（经 modelAdapter）
  async decide(state: ReviewState, ctx: NodeCtx): Promise<ModeratorDecision> {
    // 1. prompt = await this.promptService.composeForModerator(state)
    // 2. try: raw = await this.modelAdapter.complete({ prompt, system, temperature: 0.3, maxTokens: 1000 })
    //     catch → return this.fallbackDecision(state, 'adapter_failure')  // 降级 MockModerator
    // 3. 解析 JSON → { decisionType, reasoning, proposedTools }（parse 失败 → fallback）
    // 4. 执行代码硬闸校验（RuleCheckResult — 强制），越界 → force_stop override
    // 5. 填充审计字段（llmRawOutput=raw 脱敏, proposedTools, toolApprovalReasoning）
    // 6. 落 ModeratorDecision
  }

  async narrate(state: ReviewState, ctx: NodeCtx): Promise<string> {
    // LLM 生成本轮汇总叙事（供 ReportingService 使用）
    // 失败降级： "第 N 轮评审已完成，共识/分歧如下..."
  }

  async proposeTools(state: ReviewState, ctx: NodeCtx): Promise<string[]> {
    // LLM 提议本轮可用工具名（knowledge_search / code_analysis 等）
    // 失败降级：返回空数组（不提议工具）
  }

  // sanity check（反对须过 sanity）
  sanityCheck(oppositionReason: string, state: ReviewState): { allowed: boolean; reason: string } {
    // oppositionReason 非空 + 引用具体冲突字段名/维度名 → allowed=true
    // 否则 → allowed=false + reason="反对理由不具体"
  }

  private fallbackDecision(state: ReviewState, reason: string): ModeratorDecision {
    // 临时构造 MockModerator 调 decide → 转换为当前格式 + providerSource='fallback_mock' + llmRawOutput=reason
  }
}
```

**环境门控 + Provider 选择**（复用 Sprint 2.1 既有 `createProviderAdapter()`）:

- `MODERATOR_PROVIDER === 'llm' && ALLOW_EXTERNAL_MODEL_CALLS === 'true'` → `LlmModerator`（modelAdapter = createProviderAdapter() 按 MODEL_PROVIDER 决定底层: longcat / lmstudio / openai_compatible）
- 否则 → `MockModerator`（既有）
- `MODERATOR_PROVIDER === 'llm' && ALLOW_EXTERNAL !== 'true'` → fail-closed → MockModerator + 审计 `providerSource='guard_error'`
- `review-orchestrator.ts` 构造时读 env 决定; adapter 构造所需 `MODEL_API_KEY` 由 factory GUARD（缺 key → MockAdapter）

**LongCat 调用契约**（OpenAI 兼容，经 OpenAICompatibleAdapter 接入）:
- Base URL: `process.env.MODEL_BASE_URL || 'https://api.longcat.chat/openai/v1'`
- Model: `process.env.MODEL_NAME || 'LongCat-2.0'`
- Bearer <REDACTED>：`process.env.MODEL_API_KEY`（不落库/不提交/回报中不输出）
- 429 → `error.retry_after` → 指数退避最多 2 次（adapter 内置）
- 解析：`choices[0].message.content` → text

### 3.3 HITL interrupt/resume 真正闭合

**改造 `review-orchestrator.ts`**：

新增内部 flag `private runningReviews: Map<string, { interrupted: boolean }>`：

```ts
async interrupt(reviewId: string): Promise<void> {
  const entry = this.runningReviews.get(reviewId);
  if (entry) entry.interrupted = true;          // 1. 阻止下一轮 turn 派发
  // 2. 等当前 turn 终态（复用 checkMeetingComplete 逻辑或 polling）
  // 3. 写 checkpoint(reviewId, 'interrupted', state)
  // 4. 写 status='interrupted' + currentNodeId='interrupted'
  // 5. 写 ModeratorDecision('tool_approval', 'HITL manual interrupt')
}

async resume(reviewId: string): Promise<void> {
  // 1. load checkpoint where nodeId='interrupted'
  // 2. status 必须 'interrupted'（否则 400）
  // 3. runningReviews flag 恢复为 { interrupted: false }
  // 4. 写 checkpoint(reviewId, 'running', state)
  // 5. 写 status='running'
  // 6. 从断点续跑：若 tool_call 未完成 → redispatch; 否则 → 派发下一轮 turn（调 queue.enqueue）
}
```

在 `hanleTurnsComplete` / turn 派发循环中加 `if (entry?.interrupted) return;` 阻断。

**改造 `reviews.controller.ts`**：
- `POST /interrupt` → 调 `orchestrator.interrupt(reviewId)`（替代直接翻 DB）
- `POST /resume` → 调 `orchestrator.resume(reviewId)`

**改造 `reviews.service.ts`**：
- `archiveReview` 中 running → interrupted 逻辑保持（仍先中断再归档）
- `interrupt()` 保留为轻量 backup（DB 翻牌），orchestrator.interrupt 为真正暂停

### 3.4 Human Turn Override API

**新建 `POST /api/reviews/:reviewId/meetings`**（reviews.controller.ts）：

```ts
@Post(':reviewId/meetings')
@RequirePermissions('review.write')
async submitHumanTurn(
  @CurrentUser() user: AuthUser,
  @Param('reviewId', ParseUUIDPipe) reviewId: string,
  @Body() dto: HumanTurnDto,  // { round, opinions: HumanOpinion[] }
) {
  // 1. assertReview(reviewId, tenantId, ['running','interrupted'])
  // 2. assert 该 round 未被 summarize
  // 3. 校验 opinions 字段（dimension/riskLevel/issue/recommendation/confidenceScore）
  // 4. 创建 ReviewTurn(status='completed', round=dto.round, phase='human') → 幂等键 (.r{round}::human)
  // 5. 创建 ReviewOpinion(source='human', ...) → 每条 opinion
  // 6. 调 orchestrator.checkMeetingComplete(reviewId)（若该 round turns 齐 → 触发 summarize 流）
  // 7. 若 review.status==='interrupted' → 自动调 orchestrator.resume(reviewId)
}
```

**新建 `modules/reviews/dto/human-turn.dto.ts`**：
- `round: number` (Min 1)
- `opinions: { dimension, riskLevel, issue, recommendation, confidenceScore, citations? }[]` (Min 1)

### 3.5 Tool Node Graph 集成（可选 — 本次仅 node stub）

**改造 `orchestrator/graph-runtime.ts`**：
- `ReviewState` 新增字段 `pendingToolCalls?: string[]`（ToolCallRequest ids）
- 新增 graph 节点 `'tool_node'`（函数体：调 toolRegistry.executeTool + 更新 ReviewState）
- 新增节点 `'interrupted'`（函数体：写 checkpoint + 空转等待 resume）
- `ModeratorDecisionType` 加 `'tool_approval'`

**改造 `orchestrator/review-orchestrator.ts`** 的 graph 构建：
- edges 加：`summarized -(tool_approval)→ tool_node -(completed)→ summarized`
- edges 加：`summarized -(tool_approval + needs_human)→ interrupted`
- edges 加：`interrupted -(resume)→ running`
- edges 加：`interrupted -(human_override)→ summarized`

### 3.6 ReportingService 叙事注入（接口位）

**在 `reviews.service.ts` 的 `getReport()` 中**：
- 读 `ModeratorDecision WHERE decisionType='converge'` 的 `reasoning` 作为叙事来源（替代纯 mock 叙事）
- 接口位已留（`getReport` 读 ModeratorDecision 表），本次仅接线不调 LLM

### 3.7 AppModule + ReviewsModule 注册

```ts
// app.module.ts
imports: [..., ToolModule]
providers 加 ToolModule 依赖

// reviews.module.ts
imports: [..., PromptModule, MemoryModule] → imports: [..., PromptModule, MemoryModule, ToolModule]
providers: [..., LlmModerator] +  env-gated 构造逻辑放 review-orchestrator factory
```

---

## 4. In / Out

**In**：ToolRegistry mock / LlmModerator (env-gated) / HITL interrupt-resume 真闭合 / Human turn override / sanity check / 2 新表 / 既表加列 / ModeratorDecisionType +tool_approval / graph node stub

**Out**：真实 MCP SDK / 真实 MCP server 通信 / workflow 配置化（P5）/ worker 抽取（P6）

---

## 5. 红线

| # | 红线 |
|---|------|
| 1 | 仅 Contract §5 schema delta |
| 2 | 不改 apps/web |
| 3 | 不写密钥；MODERATOR_PROVIDER 门控；不引入 bcrypt/MCP SDK |
| 4 | 不提交 .env/node_modules/data/.reasonix/.workbuddy |
| 5 | 不 --force push |
| 6 | A2A 禁止（reviewer 不调工具） |
| 7 | LLM Moderator 失败降级 MockModerator |
| 8 | 硬闸代码强制（LLM 不可覆盖） |
| 9 | memory/chat 不存原文 |
| 10 | verify 脚本 gitignored |
| 11 | 未 commit / push / --force |

---

## 6. 验收标准

### 6.1 静态
- tsc api=0 / web=0
- migrate status = up to date（1 migration）
- 密钥 scan exit=1

### 6.2 运行时
- smoke 31/31
- verify-sprint-5.2 ≥ 22 场景 PASS
- 9.5b 22/22 / review-history 16/16 / quality 32/32 / sprint-5 22/22 / sprint-5.1 20/20 全回归绿

### 6.3 verify-sprint-5.2 场景（≥ 22 项）

| S# | 场景 | 期望 |
|----|------|------|
| T1 | ToolRegistry.listAvailableTools 返回 enabled 列表 | PASS |
| T2 | ToolRegistry.executeTool 落 ToolCallRequest(status='completed') | PASS |
| T3 | ToolRegistry mock knowledge_search result = `{ chunks: [] }` | PASS |
| T4 | ModeratorDecisionType 含 'tool_approval' | PASS |
| T5 | LlmModerator.decide 在 env-gated 外不构造 | PASS |
| T6 | MODERATOR_PROVIDER 未 set → orchestrator 构造 MockModerator（smoke 可达） | PASS |
| T7 | MODERATOR_PROVIDER=llm + ALLOW_EXTERNAL!=true → fail-closed fallback mock | PASS |
| T8 | interrupt review → runningReviews.flag=true + 无新 turn 派发 | PASS |
| T9 | interrupt 后 status=interrupted + checkpoint nodeId='interrupted' 存在 | PASS |
| T10 | resume 后 status=running + 从中断点续跑 | PASS |
| T11 | resume 非 interrupted 态 → 400 | PASS |
| T12 | POST /meetings source='human' 写入 ReviewOpinion | PASS |
| T13 | human turn 后 checkMeetingComplete → round turns 齐触发 summarize | PASS |
| T14 | human turn 在 interrupted 态 → 自动 resume | PASS |
| T15 | human turn 重复提交（同 round）幂等 → skip | PASS |
| T16 | sanityCheck 反对理由空 → allowed=false | PASS |
| T17 | sanityCheck 反对理由引用具体维度名 → allowed=true | PASS |
| T18 | LLM 决策 override 硬闸（越界）→ force_stop + RuleCheckResult.passed=false | PASS |
| T19 | report 读 ModeratorDecision reasoning 作为叙事来源 | PASS |
| T20 | audit interceptor 捕获 POST /meetings → action='review.human_turn' | PASS |
| T21 | GET /tool-requests 返回审批日志（role.read 权限） | PASS |
| T22 | 无 RBAC 权限用户调 POST /meetings → 403 | PASS |

---

## 7. 实施顺序

1. schema + migration → `migrate status` up to date
2. ToolRegistry + ToolModule → 单元测
3. LlmModerator + env-gated 构造逻辑 → 单测
4. HITL interrupt/resume 改造 orchestrator + controller
5. Human turn override API
6. graph node stub + edges
7. sanity check + 审计增强
8. 全量回归 + 写 verify-sprint-5.2 脚本
9. 回报 Codex，不 commit

---

## 8. 交付物

| 文件 | 类型 |
|------|------|
| `modules/tool/tool.registry.ts` | 新建 |
| `modules/tool/tool.module.ts` | 新建 |
| `modules/reviews/orchestrator/llm-moderator.ts` | 新建 |
| `modules/reviews/orchestrator/graph-runtime.ts` | 修改（+tool_approval / +tool_node / +interrupted node） |
| `modules/reviews/orchestrator/review-orchestrator.ts` | 修改（interrupt/resume + 构造 LlmMod env-gated） |
| `modules/reviews/queue/queue.service.ts` | 修改（runningReviews flag 阻断） |
| `modules/reviews/reviews.controller.ts` | 修改（interrupt/resume 走 orchestrator + 加 /meetings） |
| `modules/reviews/reviews.service.ts` | 修改（interrupt backup + human turn DTO） |
| `modules/reviews/dto/human-turn.dto.ts` | 新建 |
| `prisma/schema.prisma` | 修改 |
| `prisma/migrations/xxx_add_p4_tool_hitl/` | 新建 |
| `app.module.ts` | 修改 |
| `reviews.module.ts` | 修改 |
| `scripts/verify-sprint-5.2-tool-hitl.js` | 新建（gitignore） |
| `docs/coordination/ACTIVE_SPRINT.md` | 修改 |

纪律：不引入新 npm 包 / 不跑真实 MCP server / 不伪造验证 / 不 commit/push/--force。

---

## 9. 回报模板

```
【Sprint 5.2 workbuddy-coder 交付报告】

## 三连查 ✓

## 范围（git status 文件列表）

## P0 红线
- schema delta 仅 Contract §5 / web 未动 / A2A 遵守
- MODERATOR_PROVIDER env-gated / LLM 失败降级 MockModerator
- 不 --force / 不 commit

## 验证
- tsc api=0 / tsc web=0
- migrate status = up to date (1 migration)
- smoke 31/31
- verify-sprint-5.2 N/N (≥22)
- 9.5b 22/22 / review-history 16/16 / quality 32/32 / sprint-5 22/22 / sprint-5.1 20/20 全绿
- git status 未提交

## 结论
建议标准 Guard 复审 / Go / No-Go
```
