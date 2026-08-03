# ACTIVE SPRINT

> 单一入口：所有 agent 开工前必须先读本文件，确认当前 Sprint 状态、输入/输出文档、负责人与 Gate 状态。
> 本文件随 Sprint 滚动更新，不归档。

---

## 当前状态

- **Current Sprint**: Sprint 11.0 — Phase 3（阶段 3 壁垒落地）：**T1–T11 全部完成并合入 main**
- **main**: `1f3f4ef`（已推送）；`tsc` 0 error / `jest` 204/204
- **数据库**: Postgres 迁移基线 16/16（已应用）；T7/T8/T9 的 3 个迁移（escalation_count / human_gate_approved / passages+passage_refs）待 DB 环境应用
- **Last Updated**: 2026-08-03
- **Owner**: Codex 协调

---

## 阶段 3 任务进度（详见 docs/research/phase3-task-list-20260803.md）

| 任务 | 内容 | 状态 |
|------|------|------|
| T1–T6 | P0：生命周期/收敛/纪律/评分分离/降级/成本 | ✅ |
| T7 | 可升级辩论（escalate → 扩容 → 人工） | ✅ |
| T8 | 风险分级 HITL（高风险低置信度 → 人工门） | ✅ |
| T9 | 段落级锚点（passageId + passageRefs） | ✅ |
| T10 | 评分校准对照（AI vs 人工 + 标记） | ✅ |
| T11 | 会话隔离验证（并发回归测试） | ✅ |
| T12–T14 | 滚动上下文 / 确定性-语义分层 / 复评闭环 | ⏳ P2 |

## 相关文档索引

- 交付文档：`docs/coordination/Sprint_11.0_T1~T11_*.md` + `Sprint_11.0_Summary.md`
- 交接文档：`docs/coordination/Sprint_11.0_Continuity_Handoff.md`（T7 起点，已过时——下一步 T12 前需更新）
- 部署/迁移：`docs/coordination/Deployment_Migration_Checklist.md`
- 调研基线：`docs/research/`（phase1-patterns / phase3-task-list / verified-facts / score-credibility / gold-standard-kit）

## 下一步（P2 或收尾）

- **待应用迁移**：T7/T8/T9 的 3 个迁移（docker 启动后 `prisma migrate deploy`）
- **遗留**：migrations gitignore 讨论、CI 迁移检查、e2e 冒烟、gold standard 人工收集
- **P2（T12–T14）**：可选继续，或转入产品化/前端（报告 passage 跳转、risk_gate_hitel UI、成本看板）

## 环境要点

- 数据库：`docker compose up -d postgres`；迁移 `npx prisma migrate status/deploy`
- migrations 目录被 gitignore（仓库惯例，不入库）
- 测试：`cd apps/api && npx jest`（204 例基线）；类型：`npx tsc --noEmit`
- 分支纪律：`codex/tX-*` → 提交推送 → `git checkout main && git merge --no-ff` → push main