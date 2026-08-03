# Sprint 11.0 — T2: Convergence Signals（收敛信号显式化）

> **分支：** codex/t2-convergence-signals（基于 codex/t1-opinion-lifecycle）
> **基线：** docs/research/phase3-task-list-20260803.md T2（源自《phase1-design-patterns》模式 Q：Solutioning Room 全员 AGREE）
> **日期：** 2026-08-03
> **状态：** ✅ 完成（tsc 0 error / jest 90 全绿，含新增 17 例）

---

## 1. 目标

把 Moderator 的终止条件从「各 reviewer 已发言」（`convergenceOk = reviewersSpoke`）升级为显式三选一：

1. **全员 AGREE**：本轮所有意见 `stance === 'agree'`（确定性，DB 判定）；
2. **no-new-arguments**：本轮无新论点（LLM 判定；mock 用 T1 dedupKey 重叠作确定性代理）；
3. **maxRounds 硬闸**：轮次到顶强制停止（既有硬闸，不变量）。

## 2. 改动清单

| 文件 | 改动 |
|------|------|
| prisma/schema.prisma | ReviewOpinion 新增 `stance`（agree/disagree/neutral，默认 neutral） |
| 迁移 20260803000001_t2_convergence_stance | 本地 SQL（migrations 目录按仓库惯例不入库） |
| orchestrator/opinion.ts | `OpinionStance` 类型 + `normalizeStance()` + validateOpinion 校验 |
| orchestrator/moderator.ts | ① `ConvergenceSignals` 接口 + `RuleCheckResult.allAgreeOk/noNewArgumentsOk`；② `computeRuleCheck(state, gates, signals?)`——round≥2 用信号、否则保留旧启发式（向后兼容）；③ 新增共享 `loadRoundEvidence()`（冲突计数 + allAgree + noNewArguments）；④ MockModerator 决策链重构 |
| orchestrator/llm-moderator.ts | 决策前加载信号（allAgree + LLM 的 noNewArguments）；硬闸强停只由硬性条件触发；LLM 无权在无收敛信号时强行 converge（代码强制 continue_debate） |
| queue/service.ts | 意见创建写入 `stance: normalizeStance(result.stance)` |
| prompt/service.ts | composeForModerator 增加收敛信号说明 + 输出格式含 `noNewArguments` |
| tests/convergence-signals.spec.ts（新增） | 17 例：computeRuleCheck 语义 / loadRoundEvidence / MockModerator 三选一 / normalizeStance |

## 3. 设计要点

- **向后兼容：** `computeRuleCheck` 不传信号 = 旧行为（reviewersSpoke）；round-1 恒走旧启发式（首轮意见即基线，无"同意"可度量）；round≥2 才用显式信号。
- **Mock 的 noNewArguments 代理：** 本轮全部非空 dedupKey ⊆ 更早轮次 dedupKey → 无新论点（利用 T1 内容键去重）。空键保守视为有新论点。
- **LLM 路径约束：** 硬闸（maxRounds/maxTokens/maxCost/maxTurns）→ force_stop 不变；收敛缺失不再 force_stop，而是 continue_debate（修正了旧逻辑把"未收敛"当"异常"的问题）；LLM 想 converge 但无信号 → 代码强制 continue_debate（LLM 不可覆盖）。
- **决策链顺序（Mock）：** 硬闸 → round-1 无发言异常 → minRounds → maxRounds → **round≥2 收敛信号 → converge** → 冲突 continue_debate → **round≥2 未收敛 continue_debate** → 冲突延迟 → @expert 申辩 → 默认 converge。

## 4. 验证

- `npx tsc --noEmit`：0 error
- `npx jest`：90/90（含 T1 20 例 + T2 17 例 + 原有 53 例）
- 既有 moderator.spec / moderator.decide.spec 全部保持绿（向后兼容验证）

## 5. 已知边界

- 全员 AGREE 依赖 reviewer 输出 `stance`；当前 mock 回复未带 stance（默认 neutral），实际触发 allAgree 收敛需真 LLM 或后续 mock 辩论回复增强；
- noNewArguments 是文本级 dedup 代理，语义级"无新论点"由 LLM 判定（llm-moderator）；
- 本轮未动 `ReviewOpinion.round` 落库（loadRoundEvidence 经 reviewTurn.round 定位轮次，不依赖 opinion.round）。

## 6. 与 T3/T4 的衔接

- T4（观察与判断分离）可复用 `loadRoundEvidence` 的轮次意见加载；
- T7（可升级辩论）可在"round≥2 未收敛"分支叠加 escalate 到更大陪审团/人工。
