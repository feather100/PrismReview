# Sprint 11.0 连续性交接文档（T7 起点）

> **用途：** 记录 Sprint 11.0（阶段 3）已完成的沉淀，保证后续 T7+ 会话不丢上下文。
> **写于：** 2026-08-03（T1–T6 收官后更新）
> **适用对象：** 继续执行 T7+ 的 Codex/Agent 会话

---

## 1. 现在在哪

| 项 | 值 |
|----|----|
| 主线 | Sprint 11.0（阶段 3 落地）：**T1–T6 全部完成并合入 main** |
| main | `473e1a3`（已推送；jest 182/182，tsc 0 error） |
| 数据库 | Postgres（docker-compose）**已迁移 16/16**（T1/T2/T4 + Sprint 10.1 全部实跑应用） |
| 任务清单 | `docs/research/phase3-task-list-20260803.md`（T1–T14，P0 六项 ✅） |
| 下一步 | **T7（可升级辩论）** → T8（风险分级 HITL）→ T9（段落锚点）→ T10（校准对照）→ T11（并发加固） |

## 2. 已完成（Sprint 11.0）

| 任务 | 核心内容 | 提交 |
|------|---------|------|
| T1 意见生命周期 + 内容键去重 | ReviewOpinion status/dedup/merged/canonical + OpinionLifecycleService | 68382f9 |
| T2 收敛信号 | stance + allAgree/noNewArguments/maxRounds 三选一收敛 | a050f4e |
| T3 评分纪律 | workflow.scoreDiscipline + distribution/inflationWarning + prompt 注入 | 58c7d81 |
| T4 观察/判断分离 | ScoringPass（score 优先于 reviewer 自评）+ 迁移已应用 | f1309a8 |
| T5 按动作降级 | classifyTurnError + 降级矩阵（单 turn fallback_mock / fail_closed） | 473e1a3 |
| T6 成本硬闸 | cost-model + workflow.maxCostUsd 分档 + 超限强制收敛 + 审计 | 473e1a3 |

另有：Sprint 10.1 收口（d6a9d32）、polish ④⑤⑥（738f2a5）、部署迁移清单（044d060）。

## 3. 下一步：T7（可升级辩论）

**任务清单原文**：
> Moderator 决策增加 `escalate`：意见在 maxRounds 内未收敛 → 触发"扩大评审"（增加 1–2 个 reviewer persona 或加 1 轮）→ 仍不收敛 → `escalate_to_human`（HITL）。涉及 moderator.ts、hard-gates.ts、reviews.service.ts。估算 2–3 人日。验收：端到端演示"高争议评审 → 自动扩容 → 未决转人工"。

**现成基础**（T2/T4 已铺好）：
- `moderator.ts`：`ConvergenceSignals` / `computeRuleCheck` / `loadRoundEvidence` / Mock 决策链（"round≥2 未收敛 → continue_debate"分支是 escalate 的接入点）；
- `OpinionLifecycleService.transition()`（T1）：挑战/接受/拒绝/降级的落库与审计已就绪；
- HITL 已有基础：interrupted 状态 + 120s 超时自动恢复（review-orchestrator）——T7 的 `escalate_to_human` 可复用。

**T7 建议改动面**：
1. `ModeratorDecisionType` 增 `escalate`（graph-runtime）+ `routeAfterSummarized` 处理；
2. Mock 决策链：round≥2 未收敛且 round < maxRounds → 先 escalate（扩容 1–2 角色）再继续；
3. 扩容实现：orchestrator 向 review.roleSelection 增加 persona 并重派发；
4. 仍不收敛 → `escalate_to_human`（HITL 中断，复用 interrupted + timeout）。

## 4. 环境与工作约定（重要）

- **数据库已可用**：docker compose up -d postgres（healthy）；`cd apps/api && npx prisma migrate status` 应为 up to date（16/16）；
- **迁移**：migrations 目录被 gitignore（仓库惯例，不入库）；改 schema 后 `npx prisma generate` + 手写迁移 SQL + `npx prisma migrate deploy`；
- **测试**：`cd apps/api && npx jest`（182 例基线）；`npx tsc --noEmit`（0 error 基线）；
- **行尾陷阱**：仓库文件多为 CRLF，node/PowerShell 改文件锚点按实际行尾写；多行 JS 模板字符串易炸（中文引号/转义）；
- **分支纪律**：新任务建 `codex/tX-*` 分支 → 提交 → 推送 → `git checkout main && git merge --no-ff` → push main；
- **测试文件**：`apps/api/src/tests/*.spec.ts`（opinion-lifecycle / convergence-signals / score-discipline / scoring-pass / degradation-cost）。

## 5. 研究文档索引（决策依据）

`docs/research/`：phase1-design-patterns（模式 Q 对应 T7）、phase3-task-list（T1–T14 + 进度）、score-credibility-validation-plan（T10 验收基准）、gold-standard-kit（人工数据收集）。
`docs/coordination/`：Sprint_11.0_T1~T6 交付文档、Sprint_11.0_Summary、Deployment_Migration_Checklist。

## 6. 遗留事项

- [ ] 讨论是否取消 migrations 目录 gitignore（建议入库）；
- [ ] CI 增加 `prisma migrate deploy` + `migrate status` 检查作业；
- [ ] e2e verify 冒烟（需启动 API + DB，目前 DB 已就绪可跑）；
- [ ] gold standard 人工收集（5 份脱敏文档 + 3 位专家）。

---

> **交接结论：T7 从 `main`（473e1a3）建 `codex/t7-escalation` 开始；本文档 + 任务清单 + 各交付文档构成完整上下文。**