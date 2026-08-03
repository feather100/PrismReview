# Sprint 11.0 — T10: 评分校准对照（Score Calibration）

> **分支：** codex/t10-calibration（基于 main 2bfea25）
> **基线：** docs/research/phase3-task-list-20260803.md T10（AssessmentAI 模式 P）+ score-credibility-validation-plan 阶段 B
> **日期：** 2026-08-03
> **状态：** ✅ 完成（tsc 0 error / jest 202 全绿，含新增 8 例；无 schema 变更）

---

## 1. 目标

AI 分 vs 人工分（gold standard）对照：
1. 逐维度输出 |Δ| 分布 + 文本相似度；
2. 越阈值（|Δ|>15 或相似度<0.40）自动标记待人工复核；
3. 提供 REST 端点 `POST /api/quality/calibrate/:reviewId`；审计留痕。

## 2. 改动清单

| 文件 | 改动 |
|------|------|
| quality/calibration.ts（新增） | 纯函数：`computeSimilarity`（CJK 二元组 + 拉丁词 Jaccard，无 embedding）、`computeCalibration`（逐维度对照 + 标记 + MAE） |
| quality/quality.service.ts | `calibrate(reviewId, user, humanScores)`：AI 维度有效分（score 优先）+ 代表性意见文本 → 对照报告 + 审计（review.calibration.run）；注入 ScoringService/AuditService（可选） |
| quality/quality.controller.ts | `POST /quality/calibrate/:reviewId`（body: humanScores[]） |
| tests/calibration.spec.ts（新增） | 8 例：相似度 / \|Δ\| 标记 / 相似度标记 / 无文本 / 空输入 / 自定义阈值 |

## 3. 设计要点

- **无 embedding 依赖**：相似度用关键词 Jaccard（与 T9 passages 的 extractKeywords 复用）；
- **AI 侧口径**：维度有效分 = score ?? confidenceScore 均值（与 ScoringService 一致）；代表性文本取该维度第一条 reportable 意见的 issue；
- **标记规则**：\|Δ\|>15（deltaThreshold，可配）或（双方文本存在且相似度<0.40）→ flagged（reason 列出依据）；
- **审计**：`review.calibration.run`（mae/flaggedCount/total）。

## 4. 验证

- `npx tsc --noEmit`：0 error
- `npx jest`：202/202（新增 8 例）
- 无 schema 变更

## 5. 已知边界

- 相似度为轻量 Jaccard 近似，非语义 embedding；后续可升级到向量相似度；
- "人工评分注入评审上下文（校准锚点）"的 prompt 注入属评审侧改动（queue/reviewer prompt），T10 交付的是对照与标记机制（post-hoc）；
- 人工分数来源：gold-standard 工具包（scores-template.csv → 可对接本端点）。

## 6. 与评分可信度验证衔接

- `CalibrationReport.mae` 即验证方案指标（MAE ≤ 10 验收口径）；
- flagged 意见可回流 gold standard（逐步扩充人工数据集）。
