# Sprint 11.0 连续性交接文档（T3 起点）

> **用途：** 防上下文污染——本会话将转向 Sprint 10.1 收口（另一领域），此文档保证后续 T3 会话不丢上下文。
> **写于：** 2026-08-03
> **适用对象：** 继续执行 T3+ 的 Codex/Agent 会话

---

## 1. 现在在哪

| 项 | 值 |
|----|----|
| 主线任务 | Sprint 11.0（阶段 3 落地）：T1 ✅ / T2 ✅ / T3 待开始 |
| 任务清单 | `docs/research/phase3-task-list-20260803.md`（含执行进度表） |
| 分支 | `codex/t1-opinion-lifecycle`（68382f9，已推送）→ `codex/t2-convergence-signals`（a050f4e，已推送） |
| **T3 起点分支** | **`codex/t2-convergence-signals`**（T3 应新建 `codex/t3-score-discipline` 从它分出） |
| 当前 checkout | `feature/sprint-10.1-provider-security`（Sprint 10.1 收口专用，**与 T3 无关**） |

## 2. 已完成（Sprint 11.0）

### T1 意见生命周期 + 内容键去重（commit 68382f9）
- ReviewOpinion 新增 `status/resolution_reason/dedup_key/merged_reviewer_ids/canonical_opinion_id` + `(review_id, dedup_key)` 索引；
- 新增 `orchestrator/opinion-lifecycle.ts`：`OpinionLifecycle`（纯状态机/去重/审计）+ `OpinionLifecycleService`（finalizeReview/transition）；
- 报告/评分只统计 reportable（accepted/downgraded/candidate），rejected 仅审计可查；
- 交付文档 `docs/coordination/Sprint_11.0_T1_Opinion_Lifecycle.md`。

### T2 收敛信号显式化（commit a050f4e）
- ReviewOpinion 新增 `stance`（agree/disagree/neutral）；
- `computeRuleCheck(state, gates, signals?)`：round≥2 用显式信号，round-1/旧调用向后兼容；
- 新增共享 `loadRoundEvidence()`（highRiskCount + allAgree + noNewArguments dedup 代理）；
- Mock/Llm Moderator 决策链重构；硬闸与收敛分离；
- 交付文档 `docs/coordination/Sprint_11.0_T2_Convergence_Signals.md`。

## 3. 下一步：T3（评分纪律入模板 + 通胀检测）

**任务清单原文**（phase3-task-list T3）：
> workflow 模板注入"默认 5–6 分锚定 + 分布约束 + 分数通胀检测"（来源：manuscript-review-skill 模式 N）

**关键文件（已摸清）**：
- `apps/api/src/modules/workflow/workflow.registry.ts` —— 4 预设 workflow（enterprise/code-review/research/thesis），WorkflowConfig 目前只有 scoringWeights/verdictThresholds，**无评分纪律字段**；
- `apps/api/src/modules/reviews/scoring/scoring.service.ts` —— ScoringResult 目前有 dimensionScores/overallScore/verdict/adoptedRate/coverage/configSnapshot，**无 distribution/inflationWarning**；
- `apps/api/src/modules/prompt/prompt.service.ts` —— composeForModerator（T2 已加收敛信号段）。

**T3 建议改动面**（设计已备）：
1. WorkflowConfig 增 `scoreDiscipline: { defaultAnchor: number; maxAbove70Pct: number; requireJustificationAbove70: boolean }`（0–100 分制：defaultAnchor≈55，maxAbove70Pct≈0.3）；
2. ScoringService 输出增 `distribution: { mean; stddev; above70Pct }` + 通胀检测 `inflationWarning`（超限不阻断，进审计）；
3. prompt 注入评分纪律（"默认锚定 + 高分须论证"）。

**验收标准**（任务清单原文）：通胀检测单测；prompt 版本化注册表有新版本记录。

## 4. 环境与工作约定（重要）

- **本地无 Postgres**：schema 改完跑 `npx prisma generate`（不需要 DB），`prisma migrate dev` 无法执行；迁移 SQL 手写放在 `apps/api/prisma/migrations/20260803…/`，**migrations 目录被 .gitignore 忽略（仓库惯例），不入库**；
- **测试**：`cd apps/api && npx jest`（90 例全绿基线）；类型检查 `npx tsc --noEmit`（0 error 基线）；
- **行尾陷阱**：仓库文件多为 CRLF，node/PowerShell 改文件时锚点要按实际行尾写（`\r\n`）；多行字符串替换用「中文引号」避免 JS 语法炸；
- **分支纪律**：新任务新建 `codex/tX-*` 分支；提交信息 `feat: ... (Sprint 11.0)`；推送到 origin；
- **测试文件位置**：`apps/api/src/tests/*.spec.ts`（opinion-lifecycle.spec.ts / convergence-signals.spec.ts 是 T1/T2 新增）。

## 5. 研究文档索引（决策依据）

`docs/research/`：
- phase1-design-patterns-20260803.md（15 项模式，T3 对应模式 N）
- phase3-task-list-20260803.md（T1–T14 任务 + 进度）
- score-credibility-validation-plan-20260803.md（T3/T10 的验收基准：ρ≥0.70 / MAE≤10 / 通胀 ≤0.30）

## 6. Sprint 10.1（本次收口对象，与 T3 无耦合）

- 分支 `feature/sprint-10.1-provider-security`，WIP 在工作树（未提交）；
- No-Go 剩余项：P0-4（QualityService.providerPolicy 未初始化）、P1-2（testConnection SSRF 防御纵深）、P1-3（迁移备份/回滚）、P1-1（注释）；
- 收口完成后应在 `docs/coordination/Sprint_10.1_*` 留 Round 3 结论。

---

> **交接结论：T3 从 `codex/t2-convergence-signals` 建 `codex/t3-score-discipline` 开始；本文档与任务清单/交付文档构成完整上下文，无需回看 Sprint 10.1 会话。**
