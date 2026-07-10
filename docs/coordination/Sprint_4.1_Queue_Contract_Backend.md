# Sprint 4.1 — Queue Contract Document

> 把 Sprint 4.0 的 Runner/Queue 方案细化到可实现级别。
> 不写代码，不改 schema，不改现有实现。

---

## 1. Job 类型定义

### 1.1 review.start

| 属性 | 值 |
|---|---|
| **Queue** | `review-orchestration` |
| **Job name** | `review.start` |
| **Idempotency key** | `review.start.${reviewId}` |

**Payload**:

```typescript
interface ReviewStartPayload {
  reviewId: string;
  sessionId: string;
  roles: Array<{ roleId: string; roleCode: string; roleVersionId: string; turnIndex: number; weight: number }>;
  objective: string;
  tenantId: string;
}
```

**Preconditions**:
- review.status === 'running'（由 startReview API 设置）
- review.roleSelection 存在且 > 0 个角色
- 队列中不存在相同 idempotency key 的活跃 job（BullMQ deduplication）

**Side effects**:
- 为 `roles[]` 中的每个角色 enqueue 一个 `agent.turn.execute` job
- 不在本 job 中执行任何 provider

**Success result**:
- N 个 `agent.turn.execute` 已 enqueue（不等待它们完成）

**Failure behavior**:
- enqueue 失败 → job 重试（retry 3 次）
- 如果初始 enqueue 部分成功部分失败 → 整体 job 重试

**Idempotency key**: `review.start.${reviewId}` — BullMQ 的 `removeOnComplete` + `dedup` 防止重复

---

### 1.2 agent.turn.execute

| 属性 | 值 |
|---|---|
| **Queue** | `agent-turn-execution` |
| **Job name** | `agent.turn.execute` |
| **Idempotency key** | `agent.turn.execute.${reviewId}.${turnIndex}` |

**Payload**:

```typescript
interface AgentTurnExecutePayload {
  reviewId: string;
  turnIndex: number;
  roleId: string;
  roleCode: string;
  roleVersionId: string;
  objective: string;
  tenantId: string;
}
```

**Preconditions**:
- `review_turns` 表中该 review + turnIndex 没有 status='completed' 的记录（DB 层幂等）
- 如果已经存在且 status='completed' → 直接返回，不执行

**Side effects**:

```
1. 创建/更新 ReviewTurn (status=queued)
2. ReviewTurn.status = retrieving
3. 调用 provider.run(roleCode, objective)
4. ReviewTurn.status = thinking
5. 创建 ReviewOpinion（成功时）
6. ReviewTurn.status = completed（成功）或 timeout/failed（失败）
7. 检查是否可以触发 meeting.complete（见 §3）
```

**Success result**:
- ReviewTurn.status = 'completed'
- ReviewOpinion 已写入

**Failure behavior**:
| 场景 | ReviewTurn.status | 下一步 |
|---|---|---|
| Provider 超时 120s | `timeout` | 重试或标记失败 |
| Provider HTTP 错误 | `failed` | 重试 |
| JSON 解析失败 | `failed` | 重试 |
| 重试 3 次仍失败 | `failed` | 不再重试，触发 meeting.complete（partial） |

**Idempotency key**: `agent.turn.execute.${reviewId}.${turnIndex}` — 同 review + turnIndex 只执行一次

---

### 1.3 meeting.complete

| 属性 | 值 |
|---|---|
| **Queue** | `review-orchestration` |
| **Job name** | `meeting.complete` |
| **Idempotency key** | `meeting.complete.${reviewId}` |

**Payload**:

```typescript
interface MeetingCompletePayload {
  reviewId: string;
  totalTurns: number;
  completedCount: number;
  failedCount: number;
  timedOutCount: number;
}
```

**Preconditions**:
- 该 review 的所有 `agent.turn.execute` 均已进入 terminal 状态（completed / failed / timeout）
- 由最后一个进入 terminal 状态的 `agent.turn.execute` job 触发
- `review_turns` 表中不存在 status='queued' 或 'retrieving' 或 'thinking' 的记录

**Side effects**:

```
1. 根据 success/failure 比例计算最终 status
2. 更新 review.status = completed 或 failed
3. 记录 meeting 完成信息（在 ReviewTurn 或 Review 中）
```

**Success result**:

| 条件 | review.status | 说明 |
|---|---|---|
| 全部 turn completed | `completed` | 理想情况 |
| ≥ 50% completed | `completed` | partial success，report 标注 incompleteAgents |
| < 50% completed（且 > 0） | `completed` | 同上，report 标注严重不完整 |
| 0 个 completed | `failed` | 完全失败 |

**Failure behavior**: 本 job 自身失败（如 DB 写入异常）→ retry 3 次。如果最后一次仍失败，review.status 维持在 `running`，需人工介入。

**Idempotency key**: `meeting.complete.${reviewId}` — 防止重复执行

---

## 2. 状态流转合同

### 2.1 Review.status 流转

```
           startReview                  所有 turns terminal
ready ──────────────→ running ──────────────────────────→ completed / failed
                          │                                      │
                          └── 部分 job 失败仍可 → completed       │
                                                                  │
                                             meeting.complete job 决定最终 status
```

### 2.2 ReviewTurn.status 流转

```
job 创建 → queued
              ↓
         retrieving (provider 准备)
              ↓
         thinking (provider 执行中)
              ↓
         speaking (输出就绪) ──→ completed
              │                      │
              │                      ├──→ timeout (120s 无响应)
              │                      └──→ failed (HTTP/JSON/guard 错误)
              └──→ skipped (用户跳过)
```

### 2.3 ReviewOpinion 写入时机

仅在 `ReviewTurn.status = completed` 时写入。其他状态（timeout/failed/skipped）不写 opinion。

---

## 3. meeting.complete 协调机制（P1 闭环）

### 3.1 触发机制

**方案：DB 计数器（由最后一个 terminal turn 触发）**

每个 `agent.turn.execute` job 完成后（无论 success/failure），执行以下步骤：

```
1. 写入 ReviewTurn（status=completed/failed/timeout）
2. 查询该 review 的 roleSelection，获取 expectedTurnCount
3. 查询该 review 的 review_turns，获取 terminalTurnCount
   （status IN ('completed', 'failed', 'timeout')）
4. 如果 terminalTurnCount === expectedTurnCount：
   a. 尝试 enqueue meeting.complete（幂等 key: meeting.complete.${reviewId}）
   b. 如果 enqueue 失败（如已存在），说明其他 terminal turn 已触发，不做任何事
5. 如果 terminalTurnCount < expectedTurnCount：
   → 不做任何事，等待其他 turn 完成
```

### 3.2 幂等防重

**三重防护**：

| 层 | 机制 |
|---|---|
| **DB 层** | meeting.complete job 体内先检查 review_turns 是否全部 terminal（双重验证） |
| **Queue 层** | BullMQ job deduplication by idempotency key |
| **语义层** | meeting.complete 幂等执行：无论执行多少次，review.status 结果一致 |

**伪代码**：

```typescript
async function onTurnComplete(reviewId: string) {
  const review = await prisma.review.findUnique({ where: { id: reviewId } });
  const expectedCount = (review.roleSelection as any).roles.length;

  const terminalCount = await prisma.reviewTurn.count({
    where: { reviewId, status: { in: ['completed', 'failed', 'timeout'] } },
  });

  if (terminalCount >= expectedCount) {
    // 尝试 enqueue meeting.complete（幂等 key 防止重复）
    await this.turnQueue.add('meeting.complete', { reviewId }, {
      jobId: `meeting.complete.${reviewId}`,
      removeOnComplete: true,
      removeOnFail: { count: 3 },
    });
  }
}
```

### 3.3 expectedTurnCount 的来源

```
review.roleSelection.roles.length
```

不是 `COUNT(review_turns)`。roleSelection 始终是"应该执行的 turn 数量"的单一真相来源。

### 3.4 竞态条件处理

两个 `agent.turn.execute` 同时完成，同时检查 terminalTurnCount，都可能看到 `terminalCount === expectedCount`，导致尝试 enqueue 两次 meeting.complete。

**处理方式**：

| 可能性 | 处理 |
|---|---|
| 两次 enqueue 同一 jobId | BullMQ 的 `jobId` 是唯一的，第二个 add 调用返回已存在的 job，不会重复执行 |
| 两次 enqueue 成功（罕见，仅有同进程同时写入） | meeting.complete 体内有 DB 幂等检查：如果 review.status 已经是非 running，skip |
| 两次 meeting.complete 顺序执行 | 幂等执行，结果一致 |

---

## 4. startReview 合同

```typescript
POST /reviews/{id}/start → 立即返回（< 50ms）

1. 校验 review.status === 'ready'          — assertReview
2. 校验 review.roleSelection 存在且非空    — BadRequestException
3. review.status = 'running'               — Prisma update
4. 读取 roleSelection.roles → 构建角色列表
5. enqueue review.start job                — BullMQ add
6. 返回 { sessionId, status: 'running' }   — 立即响应
```

**红线**：
- ✅ 不执行任何 provider
- ✅ 不写 review_turns（job 体内写）
- ✅ 不直接调用 LLM
- ✅ HTTP 响应 < 50ms（实测 ~15ms，含 enqueue 到 Redis）

---

## 5. Queue/Redis 合同

### 5.1 Queue 定义

| Queue name | 用途 | Consumer |
|---|---|---|
| `review-orchestration` | review.start + meeting.complete | Worker 进程 |
| `agent-turn-execution` | agent.turn.execute | Worker 进程 |

### 5.2 Retry/Backoff/Timeout

| 参数 | review.start | agent.turn.execute | meeting.complete |
|---|---|---|---|
| Max retries | 3 | 3 | 3 |
| Backoff | exponential 2s→4s→8s | exponential 2s→4s→8s | exponential 2s→4s→8s |
| Job timeout | 30s | 120s | 10s |
| Remove on complete | true | true | true |
| Remove on fail | count: 3 | count: 3 | count: 3 |

### 5.3 Worker Concurrency

| Queue | 初始并发 | 理由 |
|---|---|---|
| `review-orchestration` | 1 | 轻量编排，无外部调用 |
| `agent-turn-execution` | 3 | LM Studio 单次 30s+，3 个并行为均衡选择 |

**生产建议**：Worker concurrency 应通过环境变量配置，不硬编码。

---

## 6. Provider Guard 继承

Worker 进程使用与 API 进程相同的 `getProvider()`：

```
Worker 启动 → 读取环境变量 → getProvider() → 返回对应 provider
                                                  ↓
                                            agent.turn.execute job
                                            ↓
                                       provider.run(roleCode, objective)
```

**Guard 规则不变**：

| MODEL_PROVIDER | ALLOW_EXTERNAL_MODEL_CALLS | 结果 |
|---|---|---|
| 未设置 / "mock" | 任意 | ✅ mock |
| "lmstudio" | "true" | ✅ lmstudio |
| "lmstudio" | 非 "true" | ❌ 抛 GUARD 错误 |
| 其他值 | 任意 | ❌ 抛 Unsupported provider error |

**Worker 不得绕过 guard。** Worker 进程与 API 进程共享环境变量。

---

## 7. Smoke / Test 计划

### 7.1 smoke-runtime 扩展

```
现有 31 个测试 + 新增:

32. POST /start → 返回 < 1s（不执行 provider）
33. POST /start → enqueue review.start job（检查 Queue 状态）
34. review.start → enqueue N 个 agent.turn.execute jobs
35. agent.turn.execute → 创建 ReviewTurn (status=queued)
36. agent.turn.execute (mock) → ReviewTurn.completed + ReviewOpinion
37. agent.turn.execute (timeout mock) → ReviewTurn.timeout
38. terminal turn 检查 → enqueue meeting.complete
39. meeting.complete → review.status = completed
40. meeting.complete 幂等 → 重复调用不产生副影响
41. Partial failure: 3/5 success → review.status = completed + report 标注
42. All failed: 0/5 → review.status = failed
43. Duplicate enqueue → 同名 job 不重复执行
```

### 7.2 smoke-runner 演进

```
保留现有 11 个测试（runner 脚本仍可用）
新增 Queue worker 验证测试：
12. Queue worker 与 runner 输出一致的 turn/opinion
13. Queue worker 幂等与 runner 幂等行为一致
```

### 7.3 边界场景测试

| 场景 | 测试方式 | 预期 |
|---|---|---|
| Bad JSON | mock provider 返回非 JSON | turn.failed |
| Timeout 120s | mock provider 延迟 121s | turn.timeout |
| Partial failure | 3/5 成功 | review=completed, report 标注 |
| All failed | 0/5 成功 | review=failed |
| Retry exhaustion | provider 持续失败 4 次 | turn.failed, no more retry |
| Duplicate enqueue | 同 review+turnIndex 入队 2 次 | 仅执行 1 次 |
| Guard blocked | MODEL_PROVIDER 未设置 | job 中 mock provider 执行 |

---

## 8. Sprint 4.2 实现边界建议

如果进入 Sprint 4.2 实现，只允许：

```
✅ mock queue execution（BullMQ + Redis）
✅ mock provider（默认）
✅ startReview enqueue review.start
✅ review.start 拆分为 N 个 agent.turn.execute
✅ 每个 turn 写 ReviewTurn / ReviewOpinion（与当前 runner 逻辑一致）
✅ 最后一个 terminal turn 触发 meeting.complete
✅ meeting.complete 幂等
✅ smoke-runtime 扩展

❌ 不接 LM Studio
❌ 不接真实 LLM
❌ 不改前端
❌ 不改 UI
❌ 不改 schema
❌ 不接 SSE from DB（Sprint 4.3）
```

**Sprint 4.2 不修改 SSE。** `getMeetingStream` 保持现有的 mock 行为。Sprint 4.3 再改为从 DB 读取。

---

## 9. ReviewTurn status 枚举对齐

Sprint 1.9 定义的细粒度状态：

```
queued → retrieving → thinking → speaking → completed
                                                  → timeout
                                                  → failed
                                                  → skipped
```

Queue Worker 保留完整状态链（Sprint 4.0 简化的 `queued → active → completed` 仅用于方案概述，实现时恢复细粒度）。

**SSE 消费方式**：
- `retrieving` → 前端可显示"正在检索知识库"
- `thinking` → 前端可显示"正在分析…"
- `speaking` + completed → 前端可推送完整意见

---

## 10. 与其他文档的对照

| 文档 | 本文一致性 |
|---|---|
| `Sprint_4.0_Runner_Queue_Scope_Backend.md` | ✅ 继承全部设计，细化到可实现级别 |
| `Sprint_1.9_Agent_Turn_Persistence_Design.md` | ✅ ReviewTurn/ReviewOpinion 字段映射一致 |
| `Sprint_4.0_Qoderwork_Review.md` | ✅ P1-1 meeting.complete 协调已闭环 |
| `ACTIVE_SPRINT.md` | ✅ Sprint 4.1 目标已达成 |
