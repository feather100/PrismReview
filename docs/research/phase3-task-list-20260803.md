# 阶段 3 任务清单（考古落地）

> **版本：** v1.0（2026-08-03）
> **输入：** 《phase1-design-patterns-20260803.md》15 项模式 + 现状代码核对（apps/api/src/modules）
> **用途：** 作为阶段 3"聚焦壁垒"的执行清单，与 P6 路线图合并排期
> **说明：** 每条任务标注【现状】与【增量】，避免重复造已有能力。

## 执行进度（滚动更新）

| 任务 | 状态 | 完成日期 | 说明 |
|------|------|---------|------|
| T1 意见生命周期 + 内容键去重 | ✅ 完成 | 2026-08-03 | 交付见《Sprint_11.0_T1_Opinion_Lifecycle.md》；报告只输出 accepted/downgraded（candidate 兜底），rejected 仅审计可查 |
| T2 收敛判定显式化 | ✅ 完成 | 2026-08-03 | 交付见《Sprint_11.0_T2_Convergence_Signals.md》；终止条件 = 全员AGREE / noNewArguments / maxRounds 三选一 |
| T3 评分纪律入模板 + 通胀检测 | ✅ 完成 | 2026-08-03 | 交付见《Sprint_11.0_T3_Score_Discipline.md》；workflow.scoreDiscipline + distribution/inflationWarning + prompt 注入 |
| T4 观察与判断分离 | ✅ 完成 | 2026-08-03 | 交付见《Sprint_11.0_T4_Scoring_Pass.md》；ScoringPass 基于观察聚合维度分（score 优先于 reviewer 自评） |
| T5 按动作降级 | ✅ 完成 | 2026-08-03 | 交付见《Sprint_11.0_T5_T6_Degradation_Cost.md》；classifyTurnError 策略提炼 + 降级矩阵 + 测试 |
| T6 预算硬闸启用 + 成本 hooks | ✅ 完成 | 2026-08-03 | 交付见《Sprint_11.0_T5_T6_Degradation_Cost.md》；成本模型 + workflow maxCostUsd + 超限强制收敛 |
| T7 可升级辩论 | ✅ 完成（2026-08-03） | 见《Sprint_11.0_T7_Escalation.md》 | escalate/escalate_to_human + 面板扩容 + HITL |
| T8 风险分级 HITL | ✅ 完成（2026-08-03） | 见《Sprint_11.0_T8_Risk_HITL.md》 | 高风险低置信度 → 人工门；resume 放行 |
| T9–T14（P1/P2） | ⏳ 未开始 | — | 见下文 |

---

## 〇、现状快照（2026-08-03 代码核对）

### 已具备（考古确认，不重复做）

| 能力 | 代码位置 | 说明 |
|------|---------|------|
| 加权多维评分 | reviews/scoring/scoring.service.ts | DimensionScore（weight Σ=1 / confidenceAvg / riskPenalty）+ overallScore + Verdict + Coverage + ConfigSnapshot 审计 |
| 意见结构 | reviews/orchestrator/opinion.ts | StructuredOpinion：dimension/riskLevel/issue/recommendation/citations/confidenceScore/providerSource(5 态) |
| Moderator 双实现 | reviews/orchestrator/moderator.ts | MockModerator / LlmModerator（env-gated）+ 硬闸 computeRuleCheck |
| 4 预设 workflow | workflow/workflow.registry.ts | enterprise/code-review/research/thesis 纯 TS 常量 + 权重 Σ=1 校验 |
| 质量评测模块 | reviews/quality/quality.service.ts（703 行） | 已有评测基础设施 |
| checkpoint/resume | reviews/orchestrator/postgres-checkpointer.ts | 已有 |
| 硬闸 | reviews/orchestrator/hard-gates.ts + moderator.ts | maxRounds/maxTurnsPerReviewer/minRounds/maxTokens |

### 关键缺口（考古发现）

| 缺口 | 证据 |
|------|------|
| 意见无生命周期状态 | opinion.ts 只有静态字段，无 candidate/challenged/accepted/rejected/downgraded，无内容键去重 |
| 收敛判定过弱 | moderator.ts `convergenceOk = reviewersSpoke`（"都发言过"就算收敛） |
| 预算硬闸未启用 | `maxCostPerReview: 0`（P1 禁用，注释写明 P2 启用） |
| Reviewer 直接打分 | StructuredOpinion 直接带 confidenceScore（无"先观察后判断"阶段） |
| 无评分纪律约束 | workflow 模板无分数分布/通胀检测 |
| 无升级路径 | Moderator 只有轮次硬闸，无"意见未收敛 → 扩大陪审 → 升级人工" |
| 无段落级锚点 | citations 是字符串数组，无 passage_id 结构 |
| HITL 触发无风险分级 | 现有 HITL 超时兜底，无"低风险自动过"逻辑 |

---

## 一、P0 任务（先做，形成壁垒核心）

### T1 意见生命周期 + 内容键去重（来源：PR Council 模式 A）—— ✅ 已完成（2026-08-03，见《Sprint_11.0_T1_Opinion_Lifecycle.md》）

- **现状：** opinion.ts 静态结构，多 reviewer 同题意见重复入报告
- **改造：**
  1. Opinion 增加 `status: candidate|challenged|accepted|rejected|downgraded` 与 `resolutionReason`；
  2. 增加内容键去重：`(dimension, normalizedIssueKey) → opinionId`，重复意见自动归并并记录来源 reviewer 列表；
  3. 每次状态迁移写 audit 日志（复用 modules/audit）；
  4. 报告只输出 accepted + downgraded（保留 rejected 供审计查询）。
- **涉及文件：** orchestrator/opinion.ts、scoring/scoring.service.ts、reporting/reporting.service.ts、prisma schema（ReviewOpinion 加列）
- **估算：** 2–3 人日
- **验收：** 单元测试覆盖"同题归并 / 质疑→接受 / 降级保留历史 / 迁移审计事件"；报告不含 rejected

### T2 收敛判定显式化（来源：Solutioning Room 模式 Q）—— ✅ 已完成（2026-08-03，见《Sprint_11.0_T2_Convergence_Signals.md》）

- **现状：** `convergenceOk = reviewersSpoke`（过弱）
- **改造：** 收敛 = 三选一触发：
  1. **全员 AGREE**：最近一轮所有 reviewer 输出 `agree` 信号（opinion 增加可选 `stance: agree|disagree|neutral`）；
  2. **no-new-arguments**：Moderator 判定本轮无新论点（llm-moderator 输出 `noNewArguments: bool` + 理由）；
  3. **硬闸兜底**：maxRounds。
- **涉及文件：** orchestrator/moderator.ts（computeRuleCheck）、llm-moderator.ts、opinion.ts
- **估算：** 1–2 人日
- **验收：** mock 与 llm 两条路径收敛语义一致（复用 computeRuleCheck 设计）；测试覆盖三触发条件

### T3 评分纪律入模板 + 通胀检测（来源：manuscript 模式 N）—— ✅ 已完成（2026-08-03，见《Sprint_11.0_T3_Score_Discipline.md》）

- **现状：** workflow 模板只有维度权重，无分数分布约束
- **改造：**
  1. WorkflowConfig 增加 `scoreDiscipline: { defaultAnchor: 5.5, maxFractionAbove7: 0.3, requireJustificationAbove7: true }`（10 分制映射到现有 0–100）；
  2. ScoringService 输出增加 `distribution: { mean, stddev, above70Pct }`；
  3. 通胀检测：above70Pct 超限 → scoring 结果标记 `inflationWarning`（不阻断，仅提示 + 审计）；
  4. Moderator prompt 注入"默认锚定 + 高分须论证"纪律。
- **涉及文件：** workflow/workflow.registry.ts、scoring/scoring.service.ts、packages/prompts
- **估算：** 1.5–2.5 人日
- **验收：** 通胀检测单测；prompt 版本化注册表有新版本记录

### T4 观察与判断分离（来源：AssessmentAI 模式 O）—— ✅ 已完成（2026-08-03，见《Sprint_11.0_T4_Scoring_Pass.md》）

- **现状：** Reviewer 直接产出带 confidenceScore 的 opinion
- **改造：**
  1. Reviewer 阶段一输出 `observation`（结构化观察，**无分数**）：{ dimension, issue, evidence, citations }；
  2. Moderator 收敛后，新增 `scoring pass`：由 Moderator（mock 确定性 / llm）基于全部 observation 聚合给出维度分数与置信度；
  3. opinion 保留 confidenceScore，但来源变为 scoring pass 而非 reviewer 直接打分。
- **涉及文件：** orchestrator/review-orchestrator.ts、moderator.ts、scoring/scoring.service.ts、opinion.ts
- **估算：** 3–4 人日
- **验收：** 端到端测试"reviewer 输出不含 score 字段"；评分仅来自 scoring pass；报告分数可追溯到 observation

### T5 按动作降级（来源：PR Council 模式 C）—— ✅ 已完成（2026-08-03，见《Sprint_11.0_T5_T6_Degradation_Cost.md》）

- **现状：** provider 失败整体降级 mock（provider-factory 有 fallback 链）
- **改造：** 将降级细化到"动作级"：
  - Reviewer 意见生成：仍走真实 LLM，失败单 reviewer 降级 mock；
  - Moderator 决策：LLM 不可用 → 确定性决策链（`无新论点 → 收敛 → 否则按意见生命周期兜底处理 → finalize`）；
  - 降级事件写 providerSource（复用 5 态：`fallback_mock`）。
- **涉及文件：** reviews/provider/provider-factory.ts、orchestrator/moderator.ts、llm-moderator.ts
- **估算：** 1.5–2.5 人日
- **验收：** 注入 LLM 失败时：reviewer 意见仍真实、仅 Moderator 降级；providerSource 正确标记

### T6 预算硬闸启用 + 成本 hooks（来源：Lavern 模式 H）—— ✅ 已完成（2026-08-03，见《Sprint_11.0_T5_T6_Degradation_Cost.md》）

- **现状：** `maxCostPerReview: 0`（禁用）
- **改造：**
  1. 接入 v1.2 第十节成本模型：按模型单价 × token 估算每轮成本；
  2. 启用 maxCostPerReview（默认按 workflow 档位给上限：快速 ¥X / 标准 ¥Y / 深度 ¥Z）；
  3. 成本超限 → 强制收敛（进入评分阶段）+ 审计事件。
- **涉及文件：** orchestrator/hard-gates.ts、moderator.ts（computeRuleCheck）、usage 模型（prisma）
- **估算：** 2–3 人日
- **验收：** 超预算评审被强制终止并产出部分报告；成本审计可查

---

## 二、P1 任务

### T7 可升级辩论 / 升级路径（来源：PaperJury 模式 K）—— ✅ 已完成（2026-08-03，见《Sprint_11.0_T7_Escalation.md》）

- **改造：** Moderator 决策增加 `escalate`：意见在 maxRounds 内未收敛 → 触发"扩大评审"（增加 1–2 个 reviewer persona 或加 1 轮）→ 仍不收敛 → `escalate_to_human`（HITL）
- **涉及：** moderator.ts、hard-gates.ts、reviews.service.ts
- **估算：** 2–3 人日
- **验收：** 端到端演示"高争议评审 → 自动扩容 → 未决转人工"

### T8 风险分级 HITL（来源：Lavern 模式 G）

- **改造：** HITL 触发从"固定"改为"按风险/置信度路由"：
  - 高风险维度（riskLevel=high 且 confidenceAvg < 阈值）→ 必过人工门；
  - 其余 → 自动放行（保留可查审计）；
  - 现有 120s 超时兜底保留。
- **涉及：** reviews/human-turn、orchestrator/hard-gates.ts、scoring
- **估算：** 1.5–2.5 人日
- **验收：** 高风险/低风险两条路径的测试

### T9 段落级锚点 passage_id（来源：PaperJury 模式 J）

- **改造：** 文档解析（knowledge 模块或新增 parse 工具）输出段落级 `passageId`；opinion.citations 升级为 `[{passageId, excerpt}]`；报告支持跳转原文
- **涉及：** knowledge/knowledge.service.ts、opinion.ts、reporting、web 前端展示
- **估算：** 3–4 人日（含前端）
- **验收：** 一条意见可点击跳转到原文段落；报告导出含 passageId

### T10 校准上下文 + 评分对照（来源：AssessmentAI 模式 P）

- **改造：** quality.service 增加"评分校准"模式：
  1. 人工打分的 gold standard 文档注入评审上下文（校准锚点）；
  2. AI 分 vs 人工分对照输出（|Δ| 分布 + 相似度）；
  3. 超过阈值（|Δ|>15 或相似度<0.40）自动标记待人工复核。
- **涉及：** reviews/quality/quality.service.ts、knowledge、scoring
- **估算：** 2–3 人日
- **验收：** 校准 run 产出对照表；标记逻辑单测

### T11 会话级隔离加固（来源：Lavern 模式 H）

- **现状：** NestJS DI 单例 + reviewId 参数隔离（需核对是否完全隔离）
- **改造：** 核对并发评审间状态隔离；将每场评审的运行时状态（rollup/usage/opinions）绑定 reviewId 生命周期，终态清理（现有内存安全已做，补并发测试）
- **估算：** 1–2 人日
- **验收：** 并发 5 场评审无串场；终态清理验证

---

## 三、P2 任务

### T12 排除自己历史的滚动上下文（来源：Solutioning Room 模式 R）
- Reviewer 上下文排除自己上轮意见（防回声）；滚动窗口保留最近 N 轮
- **估算：** 1 人日

### T13 确定性检查与语义评审分层（来源：PaperJury 模式 I）
- 把 schema 校验/引用解析/去重/段落定位沉淀为确定性层，语义层只做判断（架构梳理，不一次性重构）
- **估算：** 2 人日（梳理 + 文档）

### T14 复评闭环四态（来源：PaperJury 模式 L）
- 预留"评审→修订→复评"状态机：holds/weakened/contradicted/now-unsupported
- **估算：** 2 人日（仅设计 + 数据模型预留，不实现闭环）

---

## 四、依赖与排期（建议顺序）

```
Sprint A（P0，约 2 周）
  T1(意见生命周期) → T2(收敛显式化) → T4(观察判断分离) ── 三者有数据依赖，顺序推进
  T3(评分纪律) / T5(按动作降级) / T6(预算硬闸) ── 可并行

Sprint B（P1，约 1.5 周）
  T7(升级路径，依赖 T1/T2) → T8(风险分级 HITL，依赖 T7)
  T9(段落锚点) / T10(校准对照，依赖 T3/T4) / T11(并发加固) ── 可并行

Sprint C（P2，机动）
  T12 / T13 / T14
```

**关键路径：** T1 → T2 → T7 → T8（评审闭环主线）；T3 → T10（评分可信度验证主线，与《评分可信度验证方案》文档配合）。

## 五、与 P6 路线图衔接

| P6 项 | 与任务关系 |
|-------|-----------|
| AgentRuntime worker 进程 | T6（成本 hooks）需接入 worker；T13 分层为其铺垫 |
| OTel 全链路 | T1（生命周期事件）/ T2（收敛信号）直接成为 OTel span 语义 |
| 成本看板 | T6 产出成本数据 |
| 多租户 | T11 前置 |

## 六、工时汇总

- P0：约 12–17 人日（2 周）
- P1：约 10–14 人日（1.5 周）
- P2：约 5 人日（机动）
- **合计：约 27–36 人日**

---

> **文档版本：** v1.0（2026-08-03）
> **下一步：** T1 开工前先落《评分可信度验证方案》（作为 T3/T10 的验收基准）；P0 建议以 T1→T2→T4 为主线串行推进。
