# Sprint 11.0 — T3: Score Discipline（评分纪律入模板 + 通胀检测）

> **分支：** codex/t3-score-discipline（基于 codex/t2-convergence-signals）
> **基线：** docs/research/phase3-task-list-20260803.md T3（源自《phase1-design-patterns》模式 N：manuscript-review-skill 评分纪律）
> **日期：** 2026-08-03
> **状态：** ✅ 完成（tsc 0 error / jest 106 全绿，含新增 16 例）

---

## 1. 目标

1. Workflow 模板内置评分纪律（默认锚定 + 高分占比上限 + 高分须论证）——防 LLM 分数通胀；
2. ScoringService 输出分数分布（mean/stddev/above70Pct）+ **inflationWarning**（超限提示，不阻断）；
3. 纪律注入评审员 system prompt（默认锚定 + 高分须论证）；
4. 审计快照可回放（configSnapshot 含 scoreDiscipline）。

## 2. 改动清单

| 文件 | 改动 |
|------|------|
| workflow/workflow.registry.ts | 新增 `ScoreDiscipline` 接口 + `DEFAULT_SCORE_DISCIPLINE`（55/0.3/true）；4 个 preset 各配 discipline（enterprise/thesis 55·0.3、code-review 60·0.25、research 50·0.3）；`WorkflowConfig.scoreDiscipline?`（可选，兼容存量自定义配置）；validateCustom 校验 |
| scoring/scoring.service.ts | 新增 `ScoreDistribution` + 纯函数 `computeScoreDistribution`；`ScoringResult.distribution / inflationWarning`；`configSnapshot.scoreDiscipline` 审计快照；logger 打印通胀告警 |
| provider/model-adapter.ts | 新增 `ScoreDisciplineHint` + `buildScoreDisciplineText(discipline, isZh)`（版本化文本 v1） |
| queue/service.ts | 注入 WorkflowRegistry；turn 执行时从 DB 读 review.mode → resolve workflow → 纪律文本追加到 system prompt（compose/兜底两条路径统一） |
| report-response.dto.ts + reporting.service.ts | ReportScoringDto 暴露 distribution / inflationWarning / scoreDiscipline |
| tests/score-discipline.spec.ts（新增） | 16 例：分布纯函数 / preset 配置 / validateCustom / 通胀检测（含 rejected 排除）/ 纪律文本 |

## 3. 设计要点

- **口径**：分布与通胀基于 **reportable** 意见（accepted/downgraded/candidate；rejected 不计入，与 T1 一致）；
- **触发**：`above70Pct > maxAbove70Pct` → `inflationWarning=true`（不阻断评分/verdict，仅日志 + 报告标注 + 快照可查）；
- **锚定语义**：0–100 分制，`defaultAnchor` 55 ≈ manuscript 的 5.5/10；code-review 更严（60 锚定 / 0.25 上限）；
- **prompt 注入**：两条路径（promptService.compose / buildSystemPrompt 兜底）统一在 queue 追加纪律段，避免语义分叉；mode 从 DB 读取（executeAgentTurn 无 review 对象）；
- **向后兼容**：scoreDiscipline 可选，缺省回退 DEFAULT_SCORE_DISCIPLINE；旧自定义 workflow 不受影响。

## 4. 验证

- `npx tsc --noEmit`：0 error
- `npx jest`：106/106（T1 20 + T2 17 + T3 16 + 原有 53）
- 日志实证：`INFLATION(>70=66.7% > 30.0%)` / `INFLATION(>70=100.0% > 30.0%)`

## 5. 已知边界

- 纪律段为**代码级版本化文本**（buildScoreDisciplineText v1），未走 PromptTemplateRecord 注册表版本（DB 模板注册表 bump 留作可选 follow-up；"版本可追溯"由常量版本 + 审计快照满足）；
- 通胀检测是**提示性**的，不改变 verdict（决策影响留给 T10 评分可信度验证）；
- mock 回复默认置信度 50–80 之间，个别 preset 可能在 mock 下触发通胀提示——属预期（mock 数据固定）。

## 6. 与后续任务的衔接

- **T4（观察与判断分离）**：Moderator 聚合打分时应复用 `computeScoreDistribution` 与 `scoreDiscipline`；
- **T10（评分可信度验证）**：`inflationWarning` 直接成为《评分可信度验证方案》的"分数通胀检测"工程指标（阈值 0.30 与验证方案一致）。
