# Sprint 11.0 — T4: Scoring Pass（观察与判断分离）

> **分支：** codex/t4-scoring-pass（基于 main 044d060）
> **基线：** docs/research/phase3-task-list-20260803.md T4（源自《phase1-design-patterns》模式 O：AssessmentAI 观察/判断分离）
> **日期：** 2026-08-03
> **状态：** ✅ 完成（tsc 0 error / jest 161 全绿，含新增 11 例；迁移 16/16 实跑应用）

---

## 1. 目标

1. 评审员产出**观察**（issue/recommendation/citations/riskLevel），不再自评分（confidenceScore 可选）；
2. 收敛后由 **ScoringPass**（Moderator 侧）基于全部观察聚合每个维度的质量分，写入 `ReviewOpinion.score`；
3. 评分聚合 **score 优先**于 reviewer 自评 confidenceScore（回退兼容）；
4. 与 T3 scoreDiscipline 衔接：mock 评分公式以 defaultAnchor 为锚（防通胀 + 风险惩罚）。

## 2. 改动清单

| 文件 | 改动 |
|------|------|
| prisma/schema.prisma | ReviewOpinion 新增 `score Int?`（Moderator 评分 pass 的维度质量分 0-100） |
| 迁移 20260803000002_t4_scoring_pass | 本地 SQL（已实跑应用） |
| orchestrator/opinion.ts | `confidenceScore?` 可选（观察不带分）；新增 `score?` 字段与校验 |
| scoring/scoring-pass.ts（新增） | 纯函数 `computeDimensionScores`（锚定 55 + 风险微调 high-12/medium-5/low+4/info+8，clamp 0-100）；`ScoringPassService`（读意见 → 计算 → 事务写 score → 审计） |
| scoring/scoring.service.ts | 聚合与分布改用**有效分** = `score ?? confidenceScore ?? 0` |
| orchestrator/review-orchestrator.ts | completed 分支：**先 ScoringPass → 再 finalizeReview**（评分在去重前，失败非阻塞回退自评分） |
| queue/service.ts | 意见创建 confidenceScore 占位 50（观察不带分时） |
| provider/model-adapter.ts | buildSystemPrompt 注明 confidenceScore 可选（评审员不再自评） |
| reporting/service.ts | 报告意见映射增加 `score` 字段 |
| reviews.module.ts | 注册 ScoringPassService |
| tests/scoring-pass.spec.ts（新增） | 11 例：评分公式 / 服务写分与审计 / 有效分聚合 / validateOpinion 可选校验 |

## 3. 设计要点

- **语义修正**：confidenceScore 原被当作"维度质量分"使用（评审员自评 → 通胀源）；T4 后 `score` 是 Moderator 侧质量分，confidenceScore 降级为自评/回退；
- **公式确定性**：mock ScoringPass = T3 锚定 55 ± 风险微调，clamp [0,100]——与 ScoringService.riskPenalty 方向一致但语义是"质量分"；
- **顺序**：收敛 → ScoringPass（给全部 reportable 意见写分）→ finalize（同题去重）——重复意见的 score 不影响最终报告；
- **回退链**：ScoringPass 失败 → score=null → 聚合回退 confidenceScore（或占位 50）→ 报告不空白；
- **LLM 路径**：ScoringPass 目前是 mock 确定性实现；接口已隔离，后续可接 LLM 聚合（如 LlmModerator 同款 adapter）。

## 4. 验证

- `npx tsc --noEmit`：0 error
- `npx jest`：161/161（T1 20 + T2 17 + T3 16 + T4 11 + 原有 97）
- 日志实证：`ScoringPass r1: scored=2 dims=2 (anchor=55)`；ScoringService 按 score 聚合（overall=43）
- 迁移：`prisma migrate deploy` 应用 `20260803000002_t4_scoring_pass`，schema up to date（16/16）

## 5. 已知边界

- 观察-判断分离的"评审员不带分"在 prompt 层是**可选**（兼容旧模型输出）；强约束（评审员输出必须无分）留作后续若需要；
- mock 评分公式是确定性启发式，非校准分数——校准交给 T10 评分可信度验证（gold standard）；
- 前端报告已带 score 字段，UI 展示优先级调整留待前端任务。

## 6. 与后续任务衔接

- **T5（按动作降级）**：ScoringPass 失败降级路径可与 provider 降级链统一；
- **T10（评分可信度验证）**：`score` 字段是 AI 评分对照的直接输入（gold standard 的 AI 侧数据源）。
