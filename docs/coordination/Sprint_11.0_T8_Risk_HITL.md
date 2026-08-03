# Sprint 11.0 — T8: 风险分级 HITL（Risk-Graded Human-in-the-Loop）

> **分支：** codex/t8-risk-hitel（基于 main 3654998）
> **基线：** docs/research/phase3-task-list-20260803.md T8（Lavern 模式 G：置信度路由人工门控）
> **日期：** 2026-08-03
> **状态：** ✅ 完成（tsc 0 error / jest 187 全绿，含新增 3 例；迁移 #5 待 DB 环境应用）

---

## 1. 目标

HITL 触发从"固定/升级"改为**按风险与置信度路由**：
- 存在 **riskLevel=high 且有效置信度 < 60** 的意见 → **必过人工门**（risk_gate_hitel → interrupted）；
- 其余（低风险 / 高置信度）→ 自动放行（保留审计）；
- 人工放行 = **resume**（置 humanGateApproved=true），120s 超时兜底保留。

## 2. 改动清单

| 文件 | 改动 |
|------|------|
| prisma/schema.prisma | Review 新增 `human_gate_approved`（默认 false）+ 迁移 #5 |
| graph-runtime.ts | ModeratorDecisionType 增 `risk_gate_hitel`；ReviewState.humanGateApproved |
| moderator.ts | `RISK_GATE_MIN_CONFIDENCE=60` + `countRiskGateFindings()`（score??confidence < 60 的 high 意见数）；风险门接入两处收敛点（round≥2 收敛信号 + 默认收敛） |
| llm-moderator.ts | ALLOWED_DECISION_TYPES + 代码强制：LLM 想 converge 但风险门未放行 → risk_gate_hitel（LLM 不可绕过人工门） |
| review-orchestrator.ts | routeAfterSummarized（risk_gate_hitel→interrupted）；buildState/persistState 带 humanGateApproved；**resume() 置 humanGateApproved=true**（人工放行） |
| tests | 新增 3 例：低置信度→risk_gate_hitel、高置信度→converge、humanGateApproved→跳过 |

## 3. 设计要点

- **优先级**：风险门只在**即将收敛**时拦截（round≥2 收敛信号命中 + 默认收敛路径）；不阻断 escalate（T7）与 continue_debate（还在辩论中）；
- **有效置信度** = score（ScoringPass，T4）?? reviewer confidenceScore ?? 0——T4 后 score 优先；
- **LLM 不可绕过**：代码强制 risk_gate_hitel（与硬闸同原则）；
- **放行语义**：resume = 人工放行（与手动 interrupt 的 resume 共用），后续收敛不再拦截；
- **审计**：ModeratorDecision 记录（decisionType=risk_gate_hitel + reasoning + ruleCheckResult）。

## 4. 验证

- `npx tsc --noEmit`：0 error
- `npx jest`：187/187
- 决策链实证：`round-2 type=risk_gate_hitel`（高风险低置信度）；高置信度（≥60）→ converge
- 迁移 #5（human_gate_approved）待 DB 环境应用

## 5. 已知边界

- 阈值 60 为常量（未入 workflow 配置）；后续可挪入 WorkflowConfig.humanGate；
- 人工门放行语义 = resume（"继续"即放行），真正的"逐条裁决人工界面"属前端任务；
- 风险门在 round-1 冲突延迟收敛（默认路径）同样生效（经默认收敛前的检查）。

## 6. 与后续任务衔接

- T10（校准对照）：`countRiskGateFindings` 的有效置信度口径与评分聚合一致，可复用；
- 前端：risk_gate_hitel 中断展示与 resume 按钮。
