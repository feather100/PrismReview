# Sprint 4.2 — Mock Queue Implementation

> 实现最小后端 mock queue / mock worker 链路，验证 review.start → agent.turn.execute → meeting.complete。

---

## 1. Queue/Worker 形态

**方案：in-memory 队列**（`queue.service.ts`）

| 属性 | 值 |
|---|---|
| 依赖 | 无（setTimeout 原生） |
| Redis | 不要求 |
| BullMQ | 不要求 |
| 持久化 | 无（进程重启丢失） |
| 并发 | 单线程串行处理 |
| 适用于 | Sprint 4.2 mock 验证 |

**选择理由**：
- 零额外依赖
- 本地 smoke 稳定运行
- 不引入复杂部署要求
- Sprint 4.3 或 4.4 可替换为 BullMQ

---

## 2. 实现文件

| 文件 | 说明 |
|---|---|
| `apps/api/src/modules/reviews/queue/queue.service.ts` | 核心队列服务（新增） |
| `apps/api/src/modules/reviews/reviews.module.ts` | 注册 QueueService（修改） |
| `apps/api/src/modules/reviews/reviews.service.ts` | startReview 注入 QueueService，enqueue review.start（修改） |
| `scripts/smoke-queue.js` | 队列专用 smoke 测试（新增） |

---

## 3. Job 流程

```
POST /start (API)
  │
  ├── review.status = running  (< 10ms)
  ├── enqueue('review.start', { reviewId })
  └── return { sessionId, status: 'running' }  (< 50ms)

  Queue 处理（异步）:
  review.start
    ├── 读取 roleSelection
    ├── 验证 roleVersionId
    └── 为每个 role enqueue agent.turn.execute

  agent.turn.execute (每个 role 一个)
    ├── DB 幂等检查（已有 terminal turn 则 skip）
    ├── 创建 ReviewTurn (queued → thinking → completed)
    ├── 创建 ReviewOpinion
    ├── 调用 mock provider（0ms）
    └── 检查 terminal count → 全部完成则 enqueue meeting.complete

  meeting.complete
    ├── DB 幂等检查（review.status 已非 running 则 skip）
    ├── DB 查询 terminalCount（不信任 payload）
    └── review.status = completed | failed
```

---

## 4. 幂等策略

| 场景 | 机制 |
|---|---|
| 重复 enqueue（同 jobId） | `processedIds` Set 去重 |
| 重复 agent.turn.execute | DB 查 existing terminal turn |
| 重复 meeting.complete | DB 查 review.status ≠ running |
| review.start 幂等 | processedIds Set + jobId |

---

## 5. 验证结果

### smoke-runtime (31/31) ✅

全部 31 个原有用例通过，无回归。

### smoke-queue (8/8) ✅

| 测试 | 结果 |
|---|---|
| POST /start 返回 < 1s | ✅ 实测 < 50ms |
| POST /start 返回 status=running | ✅ |
| POST /start 返回 sessionId | ✅ |
| Review 最终状态为 completed | ✅ |
| Report opinions 来自 queue | ✅ 3 条，source=db_opinions |
| Report 包含 verdict | ✅ |
| 重复 start 返回 400 | ✅ |

### 队列详细日志

```
Enqueued: review.start
Enqueued: agent.turn.execute (turn 1)
Enqueued: agent.turn.execute (turn 2)
Enqueued: agent.turn.execute (turn 3)
Completed: review.start
Turn 1/CTO: high risk, 78 confidence
Turn 2/CFO: medium risk, 72 confidence
Turn 3/PMO: medium risk, 65 confidence
Completed: meeting.complete → review = completed
```

---

## 6. 禁止事项遵守

| 红线 | 状态 |
|---|---|
| 不改前端 | ✅ |
| 不接真实 LLM | ✅ |
| 不接 LM Studio | ✅ |
| 不改 Prisma schema | ✅ |
| 不接 Meeting SSE 读取 DB turns | ✅（Sprint 4.3 做） |
| 不做 UI | ✅ |

---

## Backend Gate

**Go ✅** — 队列链路验证通过，可以进入 Sprint 4.3。
