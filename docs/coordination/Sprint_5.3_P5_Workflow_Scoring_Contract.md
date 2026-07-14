# Sprint 5.3 — P5 Workflow + Scoring Contract

> **角色**：workbuddy-docs（纯文档，fast-gate）
> **模式**：快速 Gate（§7.1 — 纯文档、不改 schema/状态机/模型/前端/依赖）
> **架构权威**：`docs/roadmap/Sprint_9.0_Product_Roadmap_Reset.md`（§6 rationale / §11 P5 范围）
> **前置**：Sprint 5.2 Go（commit `2924856`，P4 Tool+HITL 入库）
> **日期**：2026-07-14
> **Owner**：workbuddy-docs
> **目的**：把 P5（Workflow + Scoring）展开为可实现 Backend Contract：可配置 WorkflowRegistry、加权评分引擎、报告生成器抽象、Prisma schema 增量声明。**本 Contract 只写 spec，不实现**。

---

## 1. 路线图位置与当前状态

### 1.1 路线图进度

```
P0 MVP          ✅
P1 编排脊柱      ✅
P2 Model Adapter ✅
P3 Prompt+Memory ✅
P4 Tool+HITL     ✅
→ P5 Workflow + Scoring  ← 本 Contract
P6 规模化（权限审计部分已完成）
```

### 1.2 已核实的代码事实

| 能力 | 现状 | 位置 |
|------|------|------|
| Review.mode 字段 | 文本列 `default("round_robin")`，枚举注释 round_robin / free_debate / blind_consensus / red_blue | `schema.prisma` |
| CreateReview.mode DTO | 仅 `@IsEnum(['round_robin','free_debate'])` 校验 | `dto/create-review.dto.ts` |
| list reviews 筛选 | 按 mode 字符串筛选 | `dto/list-reviews-query.dto.ts` |
| 报告生成 | `reviews.service.ts.getReport()` + `buildReportFromDb()` + `exportMarkdown()` — **单体方法，未抽象为 Service** | `reviews.service.ts` |
| 评分 logic | 仅 `p0RiskCount` + `totalRiskCount` + `confidenceScore`；**无加权多维评分** | `reviews.service.ts` |
| verdict | 任何 high risk → conditionally_approved；否则 approved；**无权重驱动** | `reviews.service.ts:509` |
| 叙事来源 (P4) | `loadNarrative()` 读 ModeratorDecision converge | `reviews.service.ts:521` |
| 维度数据源 | `ReviewOpinion.confidenceScore` (int) + `riskLevel` (枚举) + `dimension` (text) | `schema.prisma` |
| 导出 | `/api/reviews/:id/report/export.md` 已有 | `reviews.controller.ts` |

### 1.3 三条承重决策对 P5 的约束

| 决策 | P5 影响 |
|------|---------|
| **决策 #1**（Graph 脊柱 + Code 叶子） | Workflow = 预设配置，**不**新增 graph 节点；驱动 P1 既有的节点参数（rounds / phase / tools） |
| **决策 #6**（不引入新运行时依赖） | Workflow 配置化用 JSON 列 + 纯 TS 配置对象；不引入 workflow engine 库 |
| **审计红线** | 评分权重必须可审计（权重维度快照落 `Review.scoringConfig`） |

---

## 2. 设计原则

| 原则 | 实现方式 |
|------|----------|
| **Workflow 配置化** | 预设 + 自定义；JSON 列存配置；不引入新运行时依赖 |
| **评分加权多维** | 每维度权重 (0–1) × 归一化置信度 → 加权总分 → 阈值判 verdict |
| **审计追踪** | 评分时 snapshot 权重 + 各维度得分 → `Review.scoringConfig` Json 列 |
| **mock 兼容** | 评分引擎对 mock opinions（无真实模型输出）仍可用 deterministic 权重计算 |
| **向后兼容** | 旧 report 字段保留；`scoringConfig` nullable；旧 `export.md` 格式不变 |

---

## 3. WorkflowRegistry 契约

### 3.1 设计决策

**Workflow = 配置对象,不是新的 Graph 节点。**

P5 的 4 个 preset 对应 4 份配置，通过既有的 `Review.mode` 字段（重命名语义为 `workflowId`，旧值 `'round_robin'` 映射到 `enterprise` preset 保持兼容）驱动以下参数：

| 参数 | 作用对象 | P1 节点改造量 |
|------|----------|---------------|
| `turnPhasePattern` | round-1 / round-N 的 phase 序列 | queue.service 读 workflow config |
| `maxRounds` / `minRounds` | 轮次边界 | hard-gates 读 workflow config |
| `debateAfterRound` | 从第几轮开始可进 debate | moderator 读 workflow config |
| `availableTools` | Moderator 可用工具子集 | tool registry filter by workflow |
| `scoringWeights` | 评分权重向量 | scoring weights map |

**不新增节点 — Workflow 是参数化现有节点行为的配置层。**

### 3.2 Workflow 预设定义

```ts
export type WorkflowId = 'enterprise' | 'code-review' | 'research' | 'thesis';

export interface WorkflowConfig {
  readonly id: WorkflowId;
  readonly nameZh: string;                // "企业评审" | "代码审查" | "科研评审" | "论文评审"
  readonly description: string;
  readonly maxRounds: number;
  readonly minRounds: number;
  readonly debateAfterRound: number;      // >= 此轮方允许 tool_approval / continue_debate
  readonly turnPhasePattern: TurnPhase[];  // round-1 默认 ['round_robin']; 可配 ['round_robin','round_robin','debate']
  readonly availableTools: ToolType[];     // P4 ToolType[] 子集
  readonly scoringWeights: ScoringWeights; // 维度 → 权重
  readonly verdictThresholds: VerdictThresholds;
}

export interface ScoringWeights {
  // dimension → weight (0~1, 各维度权重之和 = 1)
  readonly byDimension: Record<string, number>;
  // fallback: 未指定权重的维度 = 均衡分配
  readonly fallback: 'uniform' | 'confidence' | 'risk';
}

export interface VerdictThresholds {
  readonly approved: number;                // >= threshold → approved
  readonly conditionallyApproved: number;   // >= threshold → conditionally_approved
  // < conditionallyApproved → rejected
}
```

### 3.3 4 个预设配置

```ts
export const PRESET_WORKFLOWS: Record<WorkflowId, WorkflowConfig> = {
  enterprise: {
    id: 'enterprise', nameZh: '企业评审',
    description: '通用企业方案评审（P1 默认编排）',
    maxRounds: 3, minRounds: 1, debateAfterRound: 2,
    turnPhasePattern: ['round_robin'],
    availableTools: ['knowledge_search'],
    scoringWeights: {
      byDimension: {
        '架构合理性': 0.25, '投入产出分析': 0.2, '交付风险': 0.15,
        '数据安全与合规': 0.25, '用户体验': 0.15,
      },
      fallback: 'uniform',
    },
    verdictThresholds: { approved: 75, conditionallyApproved: 50 },
  },
  'code-review': {
    id: 'code-review', nameZh: '代码审查',
    description: 'Pull Request / 代码变更评审',
    maxRounds: 2, minRounds: 1, debateAfterRound: 2,
    turnPhasePattern: ['round_robin'],
    availableTools: ['code_analysis', 'knowledge_search'],
    scoringWeights: {
      byDimension: {
        '代码质量': 0.3, '安全风险': 0.3, '性能影响': 0.2, '可维护性': 0.2,
      },
      fallback: 'risk',
    },
    verdictThresholds: { approved: 80, conditionallyApproved: 55 },
  },
  research: {
    id: 'research', nameZh: '科研评审',
    description: '研究方案 / 基金申请评审',
    maxRounds: 3, minRounds: 2, debateAfterRound: 2,
    turnPhasePattern: ['round_robin', 'round_robin', 'debate'],
    availableTools: ['knowledge_search', 'calculation'],
    scoringWeights: {
      byDimension: {
        '创新性': 0.3, '可行性': 0.25, '科学价值': 0.25, '方法论': 0.2,
      },
      fallback: 'uniform',
    },
    verdictThresholds: { approved: 70, conditionallyApproved: 45 },
  },
  thesis: {
    id: 'thesis', nameZh: '论文评审',
    description: '学位论文 / 期刊审稿',
    maxRounds: 2, minRounds: 2, debateAfterRound: 2,
    turnPhasePattern: ['round_robin', 'debate'],
    availableTools: ['knowledge_search'],
    scoringWeights: {
      byDimension: {
        '原创性': 0.25, '技术深度': 0.25, '写作质量': 0.2, '实验设计': 0.3,
      },
      fallback: 'uniform',
    },
    verdictThresholds: { approved: 75, conditionallyApproved: 50 },
  },
};
```

### 3.4 WorkflowRegistry 接口

```ts
export interface WorkflowRegistry {
  /** 获取 workflow 配置（preset 优先；未识别 → enterprise 兜底） */
  resolve(workflowId: string): WorkflowConfig;

  /** 列出可用 preset（供前端/新建评审下拉） */
  listPresets(): WorkflowConfig[];

  /** 验证自定义 workflow 配置（维度权重之和 = 1） */
  validateCustom(config: Partial<WorkflowConfig>): { ok: boolean; errors: string[] };
}
```

### 3.5 mode 字段兼容

| 现有 mode 值 | 映射 |
|--------------|------|
| `'round_robin'` | → `enterprise` preset（完全兼容） |
| `'free_debate'` | → `code-review` preset |
| 新增 workflowId | `'enterprise'` / `'code-review'` / `'research'` / `'thesis'`（与 preset ID 对齐） |
| 未知值 | 兜底 → `enterprise` preset |

> `CreateReview.mode` DTO 扩展 `@IsEnum(['enterprise','code-review','research','thesis','round_robin','free_debate'])`；旧值路由到新 preset。

---

## 4. ScoringService（评分引擎）契约

### 4.1 设计决策

**评分 = 加权平均，不可引入 ML 模型。**

- 评分函数：让 `opinion dimension × 归一化置信度 × 维度权重` → 加权总分
- 归一化：`confidenceScore / 100`（已有 0–100 整数）
- 风险维度得分的反向信号：若某维度 `riskLevel = high` → 该维度得分 × 0.5；medium → × 0.8；low/info → × 1.0
- 最终 0–100 整数；阈值从 `workflow.scoringWeights` 读取

### 4.2 ScoringService 接口

```ts
export interface DimensionScore {
  readonly dimension: string;
  readonly weight: number;          // 来自 workflow.scoringWeights / fallback
  readonly confidenceAvg: number;    // 该维度所有 opinion 的平均 confidenceScore
  readonly riskPenalty: number;     // 0.5 | 0.8 | 1.0（基于最高 riskLevel）
  readonly weightedScore: number;   // confidenceAvg × riskPenalty × weight × 100
}

export interface ScoringResult {
  readonly workflowId: WorkflowId;
  readonly dimensionScores: DimensionScore[];
  readonly overallScore: number;           // 加权总分 0–100
  readonly verdict: 'approved' | 'conditionally_approved' | 'rejected';
  readonly adoptedRate: number;             // recommendation 类意见被保留比例（沿用 P1 语义）
  readonly coverage: {                      // 维度覆盖审计
    readonly expected: string[];           // workflow.scoringWeights.byDimension 键
    readonly covered: string[];            // opinions 中出现的维度
    readonly missing: string[];            // expected - covered
  };
  readonly configSnapshot: {               // 审计 snapshot
    readonly weights: Record<string, number>;
    readonly thresholds: VerdictThresholds;
  };
}

export interface ScoringService {
  /** 计算评分结果（从 opinions 聚合） */
  score(reviewId: string, workflowId: string): Promise<ScoringResult>;

  /** 评分结果持久化到 Review 表（snapshot） */
  saveScoringResult(reviewId: string, result: ScoringResult): Promise<void>;

  /** 读取历史评分配置快照 */
  getScoringSnapshot(reviewId: string): Promise<ScoringResult | null>;
}
```

### 4.3 权重 fallback 策略

| fallback 策略 | 计算方式 |
|---------------|----------|
| `uniform` | 各出现维度权重 = 1 / N（N = opinions 中出现的不重复维度数） |
| `confidence` | 权重 ∝ 该维度 opinions 的平均 confidenceScore |
| `risk` | 权重 ∝ 该维度最高 riskLevel 的严重度（high → 3 / medium → 2 / low → 1） |

> `enterprise` preset 显式指定权重 → fallback 策略仅覆盖未在 `byDimension` 中的维度。

### 4.4 verdict 判定

```ts
// 阈值逻辑：
if (overallScore >= thresholds.approved)             → 'approved'
else if (overallScore >= thresholds.conditionallyApproved) → 'conditionally_approved'
else                                                  → 'rejected'
```

---

## 5. ReportingService 抽象

### 5.1 当前问题

报告生成逻辑（`getReport` / `buildReportFromDb` / `exportMarkdown`）内联在 `ReviewsService` 中 — P1–P4 各 Sprint 各自加入叙事源、维度评分、human opinion source 等，**未抽象成独立 Service**。P5 把它们抽出来。

### 5.2 接口

```ts
export interface ReportingService {
  /** 生成完整报告（含评分 + 叙事 + risks/actionItems） */
  generateReport(reviewId: string, user: AuthUser): Promise<ReportResponseDto>;

  /** Markdown 导出（沿用 P1 格式，追加评分小节） */
  exportMarkdown(reviewId: string, user: AuthUser): Promise<string>;

  /** 评分驱动的报告 small-section（追加到 export.md） */
  renderScoringSection(result: ScoringResult): string;
}
```

### 5.3 与既有 ReviewsService 边界

| 职责 | 归属 |
|------|------|
| CRUD + 状态机流转（diagnose/start/summarize/interrupt/resume） | ReviewsService（既有） |
| turn 执行（queue enqueue） | QueueService（既有） |
| Moderator 决策 / memory 聚合 | ReviewOrchestrator（既有） |
| **评分 + 叙事 + 报告组装 + 导出** | **ReportingService（新建）** |

> `ReviewsService.getReport` 在 P5 后委托 `ReportingService.generateReport()`；旧方法保留作 deprecated wrapper（back compat 30 天）。

### 5.4 报告格式扩展

`export.md` 追加"评分"小节：

```markdown
---
## 评分（workflow: {workflowName}，阈值: ≥{approved}=通过 / ≥{conditionallyApproved}=有条件通过）

| 维度 | 权重 | 置信度均值 | 风险惩罚 | 加权得分 |
|---|---|---|---|---|
| 架构合理性 | 0.25 | 82 | ×1.0 (low) | 20.5 |
| 数据安全与合规 | 0.25 | 70 | ×0.5 (high) | 8.75 |
| ... |
| **总分** | 1.0 | — | — | **68** |

**结论**: 有条件通过（分 68 / 阈值 75）
**缺失维度**: 用户体验（配置中预期但未覆盖）
```

---

## 6. 与已有模块集成点

### 6.1 orchestrator（P1）

| 接口位 | 改造量 |
|--------|--------|
| `WorkflowRegistry.resolve(review.mode)` → 在 orchestrator.start() 读取 | 新增 workflowConfig 字段传入 |
| hard-gates 读 `workflowConfig.maxRounds` 替代 env 常量 | hard-gates.ts 改造 |
| moderator.decide 读 `workflowConfig.debateAfterRound` | moderator.ts 小改 |

### 6.2 LlmModerator（P4）

| 接口位 | 改造量 |
|--------|--------|
| PROPOSE_TOOLS 时 filter by `workflowConfig.availableTools` | llm-moderator.ts 加 workflow config |
| narrative 调用方传入 workflow 名（报告小节标题） | 小改 |

### 6.3 queue.service（P1）

| 接口位 | 改造量 |
|--------|--------|
| 派发 phase 读 `workflowConfig.turnPhasePattern[round-1]` | queue.service 小改 |

### 6.4 reviews.controller

| 接口位 | 改造量 |
|--------|--------|
| `CreateReview.mode` 校验扩展 + 兼容旧值 | DTO 小改 |
| `GET /workflows` 新端点（返回 preset 列表） | controller 加 1 route |
| Report 返回值含 `scoringConfig` 字段（新 DTO 属性） | DTO 小改 |

### 6.5 Export API

| 接口位 | 改造量 |
|--------|--------|
| `GET /reviews/:id/report/export.md` 走 `ReportingService.exportMarkdown()` | 委托 |

---

## 7. Prisma Schema 增量（delta 清单，**不实施**）

### 7.1 Review 表加列

```model Review {
  // ... 既有字段保留
  scoringConfig Json? @map("scoring_config")  // P5 新增：ScoringResult 的快照
}
```

### 7.2 新增表

> **本次不新增表** — workflow 预设写在纯 TS 常量中（满足"不引入新运行时依赖"红线）。未来若需用户自定义 workflow，再抽表。

### 7.3 ReportResponseDto 加字段

```ts
export class ReportResponseDto {
  // ... 既有字段保留
  @Expose() scoring?: {                    // P5 新增
    workflowId: string;
    workflowName: string;
    overallScore: number;
    dimensionScores: Array<{ dimension: string; weight: number; weightedScore: number }>;
    verdict: string;                        // 评分驱动 verdict（覆盖既有简单判定）
    coverage: { expected: string[]; covered: string[]; missing: string[] };
  };
}
```

### 7.4 不触碰

- `ModeratorDecision`（P4 表）
- `ToolCallRequest` / `ToolDefinitionRecord`（P4 表）
- `ReviewerMemory` / `ProjectMemory` / `PromptTemplateRecord`（P3 表）
- `User` / `AuditLog` / `Tenant` / `Department`（Sprint 5.0 表）

---

## 8. API 契约保留边界

### 8.1 保持不变的对外接口

所有既有 reviews / roles / quality / audit / users / knowledge / meetings / interrupt / resume 端点不动。

### 8.2 P5 新增

| 端点 | 方法 | 权限 | 说明 |
|------|------|------|------|
| `/api/workflows` | GET | `role.read` | 列出 preset 列表 |
| `/api/reviews` | POST | `review.create` | mode 扩展为 workflowId（兼容旧值） |

### 8.3 修改的对外接口

| 端点 | 变更 |
|------|------|
| `/api/reviews/:id/report` | 返回增多 `scoring` 对象 |
| `/api/reviews/:id/report/export.md` | 追加"评分"小节 |

---

## 9. 技术边界

### In（P5）

- `WorkflowRegistry` 接口 + 4 个 preset 常量
- `ScoringService` 接口 + 实现（加权评分 + verdict + audit snapshot）
- `ReportingService` 抽象（从 ReviewsService 抽取 + 评分小节）
- Review 表加 `scoringConfig` Json 列（1 个新 migration）
- hard-gates / queue.service / llm-moderator 读 workflow config
- `GET /workflows` 新端点
- `CreateReview.mode` DTO 扩展 + compat 路由

### Out（后续 phase）

- AgentRuntime worker 抽取 + OTel（P6）
- 用户自定义 workflow 表（V2 再做）
- 实时流式评分更新
- 复杂 ML 评分模型（V2 再做）

### P5 红线

- Workflow **不**引入新运行时依赖（纯 JSON + TS 常量）
- 评分权重**可审计**（snapshot 落 `scoringConfig` Json + audit log `review.scored`）
- 不 `--force`
- Schema delta 实施走**标准 Gate**
- mock opinions 评分仍可 deterministic 计算（fallback uniform + risk penalty）
- `ReviewsService.getReport` 保留 deprecated wrapper（30 天 back compat）

---

## 10. 验证期望

| 验证项 | 期望 |
|--------|------|
| `tsc --noEmit` | 0 errors |
| smoke | 31/31 |
| WorkflowRegistry.resolve('round_robin') → enterprise preset | PASS |
| WorkflowResolver 未知值 → enterprise 兜底 | PASS |
| ScoringService.score() → overallScore 0–100 整数 + workflow 阈值 verdict | PASS |
| dimension 缺失 → `coverage.missing` 非空 | PASS |
| `scoringConfig` snapshot 写入 Review 表 | PASS |
| `export.md` 含"评分"小节 | 文本断言 |
| reportingService 与 reviewsService 协作不破 | 既有 report 返回字段完整 |
| 回归 | 既有 reviews/roles/quality/audit/users/meetings/interrupt 端点不破 |

---

## 11. 实施顺序建议

1. schema 改 (scoringConfig) + migration
2. WorkflowRegistry（纯 TS 常量 + 接口）
3. ScoringService（评分引擎 + audit snapshot）
4. ReportingService 抽取（from ReviewsService）
5. hard-gates / queue.service / llm-moderator 接 workflow config
6. `GET /workflows` endpoint + CreateReview DTO 扩展
7. 数据迁移（旧 Review 无 scoringConfig → nullable，兼容）
8. verify-sprint-5.3 脚本
9. 全量回归

---

## 12. Gate 模式声明

### 12.1 本 Contract Sprint（5.3）= 纯文档，fast-gate

| §7.1 条件 | 本 Sprint 5.3 | 结论 |
|-----------|---------------|------|
| 1. 不改 Prisma schema | ✅ 仅声明 delta | 满足 |
| 2. 不改状态机实现 | ✅ 仅声明配置层接口 | 满足 |
| 3. 不涉及真实 LLM/Embedding 首次接入 | ✅ 无模型调用 | 满足 |
| 4. 不改前端主页面 | ✅ 前端零改动 | 满足 |
| 5. 不引入新外部依赖 | ✅ 无依赖变更 | 满足 |

**结论**：5.3 为**纯文档**，符合快速 Gate 模式。

### 12.2 本 Contract 指定的 5.3 实现 Sprint = 标准 Gate

> ⚠️ 5.3 实现 Sprint 不得走 fast-gate。本 Contract 的 §7（Prisma schema 增量）将**实际改动 schema**，触发 §5.4 + §7.1 退回标准流程。实现 Sprint 须走**标准 Gate**。

---

## 附：交付物清单

| 文件 | 类型 |
|------|------|
| `docs/coordination/Sprint_5.3_P5_Workflow_Scoring_Contract.md` | 新增（本文件） |
| `docs/coordination/ACTIVE_SPR|INT.md` | 更新（滚动到 5.3；5.2 推进为 Go） |

> 未执行 `git commit` / `push`。文档就绪后回报 Codex，由 Codex 走 fast-gate。
