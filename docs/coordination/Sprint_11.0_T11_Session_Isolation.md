# Sprint 11.0 — T11: 会话级隔离加固（Session Isolation）

> **分支：** codex/t11-session-isolation（基于 main 726ec34）
> **基线：** docs/research/phase3-task-list-20260803.md T11（Lavern 模式 H：会话级状态隔离）
> **日期：** 2026-08-03
> **状态：** ✅ 完成（tsc 0 error / jest 204 全绿，含新增 2 例；无 schema 变更）

---

## 1. 目标

核对并发评审间状态隔离，验证终态清理；补并发回归测试，确保"5 场评审并发无串场"。

## 2. 隔离审计结论（架构已达标，补验证）

| 状态载体 | 隔离方式 | 结论 |
|---------|---------|------|
| orchestrator.runningReviews | Map 按 reviewId 键控 | ✅ |
| orchestrator.interruptTimers | Map 按 reviewId 键控 | ✅ |
| queue.processedIds | jobId 含 reviewId；cleanupReview 按 reviewId 清扫 | ✅ |
| usage / turns / opinions | 全部从 DB 聚合（buildState），无内存累计 | ✅ |
| Moderator / ScoringPass / Lifecycle / Scoring | 无共享可变状态（仅 prisma） | ✅ |
| 终态清理 | completed/aborted → cleanupReview（删 Maps + 扫 processedIds） | ✅ |

## 3. 改动清单

| 文件 | 改动 |
|------|------|
| tests/session-isolation.spec.ts（新增） | ① 5 场并发 MockModerator.decide（不同 reviewId 各自数据：agree/escalate/risk_gate/quiet/empty）→ 各自决策正确、信号不串场；② 5 场并发 ScoringPass.run → 各场维度分只写入本场意见 |

> 注：审计发现无需代码改动（架构本就隔离）；本任务交付"验证 + 文档"。

## 4. 验证

- `npx tsc --noEmit`：0 error
- `npx jest`：204/204（新增 2 例）
- 并发实证：r-agree→converge（allAgreeOk=true）、r-escalate→escalate（allAgreeOk=false）、r-gate→risk_gate_hitel、r-quiet→converge、r-empty→converge——互不污染
- ScoringPass：r1 得 43（high-12）、r2 得 59（low+4），各自只写本场

## 5. 已知边界

- 并发测试基于共享 mock prisma（按 reviewId 过滤），真实并发以 DB 隔离为准；
- BullMQ worker 抽取（P6）后，跨进程隔离需再验证（内存态仅进程内）。
