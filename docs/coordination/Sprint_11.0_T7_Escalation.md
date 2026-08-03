# Sprint 11.0 — T7: 可升级辩论（Escalation）

> **分支：** codex/t7-escalation（基于 main 81ea44f）
> **基线：** docs/research/phase3-task-list-20260803.md T7（PaperJury 模式 K：trial → 扩容 → escalate）
> **日期：** 2026-08-03
> **状态：** ✅ 完成（tsc 0 error / jest 184 全绿，含新增/更新 6 例；迁移 #4 待 DB 环境应用）

---

## 1. 目标

辩论未收敛时不再无限 continue_debate，而是可升级：
1. round≥2 未收敛 → **escalate**（面板扩容 1–2 个角色，重派发一轮）；
2. 扩容后仍未收敛 → **escalate_to_human**（HITL 中断，复用 interrupted + 120s 超时兜底）；
3. maxRounds 仍是最终硬闸（force_stop/abort）。

## 2. 改动清单

| 文件 | 改动 |
|------|------|
| prisma/schema.prisma | Review 新增 `escalation_count`（默认 0）+ 迁移 #4 |
| graph-runtime.ts | ModeratorDecisionType 增 `escalate`/`escalate_to_human`；ReviewState.escalationCount |
| moderator.ts | `ESCALATE_MAX=1`；决策链：round≥2 未收敛 → escalate（未扩容）→ escalate_to_human（已扩容）→ conflict-continue（round-1 兼容） |
| llm-moderator.ts | ALLOWED_DECISION_TYPES 增两个新类型 |
| review-orchestrator.ts | routeAfterSummarized（escalate→running / escalate_to_human→interrupted）；buildState/persistState 带 escalationCount；`expandRoles()`（从 agentRole 池挑未参与角色，优先非 preset）；`parkInterrupted()`（复用 HITL 中断 + 超时） |
| tests | moderator.decide.spec（round-2 冲突→escalate、扩容后→escalate_to_human、debateAfterRound=1 保留 continue_debate）；convergence-signals 用例按新语义更新 |

## 3. 设计要点

- **优先级**：escalate 先于 conflict-continue_debate（round≥2 未收敛即升级，不再无限辩论）；
- **扩容**：从 agentRole 池选未参与角色（优先非 preset 可加装），weight=20，reason='escalated'；无可用角色 → 直接转人工；
- **转人工**：escalate_to_human 与手动 interrupt 同路径（interrupted 状态 + 120s 超时自动恢复），审计由 ModeratorDecision 记录承载；
- **兼容**：round-1 冲突（debateAfterRound=1，code-review）仍走 continue_debate；maxRounds 仍是最终兜底。

## 4. 验证

- `npx tsc --noEmit`：0 error
- `npx jest`：184/184（新增/更新 6 例）
- 决策链实证：`round-2 type=escalate`；扩容后 `escalate_to_human`
- 迁移 #4（escalation_count）待 DB 环境（docker 当前未运行）应用：`prisma migrate deploy`

## 5. 已知边界

- 扩容角色池依赖 agentRole 数据（enabled 角色）；池空时直接转人工；
- 扩容后的新角色在 pilot 模式（MODEL_PILOT_MAX_ROLES）下可能被裁剪；
- escalate_to_human 的"人工处理"目前是 HITL 中断（resume 后继续），真正的人工裁决界面属于前端任务。

## 6. 与 T8 衔接

T8（风险分级 HITL）将把 HITL 触发从"固定/升级"改为"按风险与置信度路由"——escalate_to_human 的 parkInterrupted 机制可复用。
