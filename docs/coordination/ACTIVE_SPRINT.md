# ACTIVE SPRINT

> 单一入口：所有 agent 开工前必须先读本文件，确认当前 Sprint 状态、输入/输出文档、负责人与 Gate 状态。
> 本文件随 Sprint 滚动更新，不归档。

---

## 当前状态

- **Current Sprint**: Sprint 11.0 — Phase 3（阶段 3 壁垒落地）：T1–T6 全部完成并合入 main
- **main**: `473e1a3`（已推送）；`tsc` 0 error / `jest` 182/182
- **数据库**: Postgres（docker-compose）已迁移 16/16（T1/T2/T4 + Sprint 10.1 实跑应用）
- **Last Updated**: 2026-08-03
- **Owner**: Codex 协调

---

## 阶段 3 任务进度（详见 docs/research/phase3-task-list-20260803.md）

| 任务 | 内容 | 状态 |
|------|------|------|
| T1 | 意见生命周期 + 内容键去重 | ✅ |
| T2 | 收敛信号显式化（allAgree/noNewArguments/maxRounds） | ✅ |
| T3 | 评分纪律 + 通胀检测 | ✅ |
| T4 | 观察/判断分离（ScoringPass） | ✅ |
| T5 | 按动作降级 | ✅ |
| T6 | 成本硬闸 + 强制收敛 | ✅ |
| T7 | 可升级辩论（未收敛 → 扩容 → 转人工） | 🔜 下一步 |
| T8–T11 | 风险分级 HITL / 段落锚点 / 校准对照 / 并发加固 | ⏳ P1 |
| T12–T14 | 滚动上下文 / 分层 / 复评闭环 | ⏳ P2 |

## 相关文档索引

- 交付文档：`docs/coordination/Sprint_11.0_T1~T6_*.md`（每任务一篇）+ `Sprint_11.0_Summary.md`
- 交接文档：`docs/coordination/Sprint_11.0_Continuity_Handoff.md`（T7 起点，开工前必读）
- 部署/迁移：`docs/coordination/Deployment_Migration_Checklist.md`
- 调研基线：`docs/research/`（phase1-patterns / phase3-task-list / verified-facts / score-credibility / gold-standard-kit）

## 下一步（T7：可升级辩论）

- 起点：main（473e1a3）→ 建 `codex/t7-escalation`
- 接入点：moderator.ts 决策链（round≥2 未收敛 → escalate）+ `routeAfterSummarized` + HITL（interrupted + 120s 超时已有）
- 验收：高争议评审 → 自动扩容 → 未决转人工

## 环境要点

- 数据库：`docker compose up -d postgres`；迁移状态 `npx prisma migrate status`（应为 up to date）
- migrations 目录被 gitignore（仓库惯例，不入库）；改 schema 后手写迁移 + `prisma migrate deploy`
- 测试：`cd apps/api && npx jest`（182 例基线）；类型：`npx tsc --noEmit`
- 分支纪律：`codex/tX-*` → 提交推送 → `git checkout main && git merge --no-ff` → push main

## 遗留事项

- [ ] 取消 migrations 目录 gitignore 的讨论（建议入库）
- [ ] CI 增加 `prisma migrate deploy` + `migrate status` 检查
- [ ] e2e verify 冒烟（DB 已就绪可跑）
- [ ] gold standard 人工收集（5 份脱敏文档 + 3 位专家）