# Sprint 4.3A — Meeting SSE DB Turns Contract

> 设计 Meeting SSE 如何从 DB `review_turns` / `review_opinions` 读取真实 mock queue 结果，同时保留现有 mock SSE fallback。
> 只写合同，不改代码。

---

## 1. 当前 SSE 行为

### 1.1 当前实现

`GET /api/reviews/{reviewId}/meeting/stream` (reviews.gateway.ts `getMeetingStream`)：

- 从 `roleSelection` 读取角色列表
- 查询 `MOCK_AGENT_CONTENT` 硬编码字典（CTO/CFO/PMO/Compliance/UA）
- 以 `setInterval` 400ms 逐条推送 11-15 个预构建事件
- 全程不查 `review_turns` / `review_opinions` 表

### 1.2 Mock fallback 的价值

- queue 处理需要时间（~700ms 对于 3 个 mock turn）
- 前端跳转 Meeting 页后，SSE 应**立即**开始推事件，不能等 queue
- mock fallback 保证：review 刚变成 `running` 时，前端不白屏

### 1.3 前端依赖的事件类型

前端 `MeetingPage` 消费以下事件（`Sprint_1.3_Meeting_Event_Contract.md`）：

```
meeting.started
heartbeat
agent.turn.started
agent.message.delta
agent.message.completed
agent.turn.completed
meeting.completed
meeting.error
```

---

## 2. DB Turns 读取策略

### 2.1 优先级

```
SSE 连接建立后：
1. 查询 review_turns + review_opinions
2. 如果有 DB turns → 从 DB 读取（策略见 §4-6）
3. 如果无 DB turns → 使用 mock fallback（现有行为）
4. 不允许空流 → 至少发一个 event（started 或 error）
```

### 2.2 不允许因为 DB 空导致会议室白屏

| DB turns 状态 | review status | 行为 |
|---|---|---|
| 无 turns | `running`（刚 start，queue 未处理） | mock fallback |
| 无 turns | `running`（异常：queue 未触发） | mock fallback |
| 部分 turns | `running` | 从 DB 读取已有 turns + 等待新 turns |
| 全部 turns | `completed` / `failed` | 从 DB 读取并 replay |

---

## 3. 事件映射

### 3.1 数据来源

| 事件字段 | DB 来源 | 备注 |
|---|---|---|
| `eventId` | `{reviewId}-{sequence}` | 运行时生成 |
| `reviewId` | review.id | — |
| `sessionId` | `session-{reviewId}` | — |
| `timestamp` | `new Date().toISOString()` | 推送到客户端的时间 |
| `sequence` | 从 1 递增 | 严格单调递增 |
| `payload` | 见下表 | — |

### 3.2 每个事件的 payload 来源

#### meeting.started

```typescript
payload: {
  status: 'running',
  totalAgents: review.roleSelection.roles.length,
  totalTurnsPlanned: review.roleSelection.roles.length,
}
// 来源: review.roleSelection（JSON 字段）
```

#### heartbeat

```typescript
payload: { timestamp: new Date().toISOString() }
// 运行时生成，无 DB 存储
```

#### agent.turn.started

```typescript
payload: {
  turnId: reviewTurn.id,           // UUID from review_turns.id
  roleId: agentRole.id,            // from agent_roles via roleVersionId
  roleCode: agentRole.code,        // "CTO"
  roleName: agentRole.name,        // "技术审核员"
  turnIndex: reviewTurn.turnIndex, // from review_turns.turnIndex
}
// 来源: review_turns + agent_roles（LEFT JOIN through roleVersionId）
```

#### agent.message.delta

```typescript
payload: {
  turnId: reviewTurn.id,           // from review_turns.id
  roleCode: agentRole.code,        // "CTO"
  delta: reviewOpinion.recommendation,  // 完整意见内容（一次推送，不分片）
}
// 来源: review_opinion.recommendation
```

#### agent.message.completed

```typescript
payload: {
  turnId: reviewTurn.id,
  roleCode: agentRole.code,
  content: reviewOpinion.issue + " " + reviewOpinion.recommendation,
  riskLevel: reviewOpinion.riskLevel,               // "high" | "medium" | "low" | "info"
  dimension: reviewOpinion.dimension,                // "架构合理性"
  recommendation: reviewOpinion.recommendation,      // 改进建议
  confidenceScore: reviewOpinion.confidenceScore,    // 0-100
}
// 来源: review_opinion
```

#### agent.turn.completed

```typescript
payload: {
  turnId: reviewTurn.id,
  roleCode: agentRole.code,
  durationMs: reviewTurn.completedAt - reviewTurn.startedAt,  // 实际耗时（ms）
}
// 来源: review_turns（startedAt, completedAt）
```

#### meeting.completed

```typescript
payload: {
  status: review.status,       // "completed" | "failed"
  totalTurns: completedCount,  // 来自 review_turns COUNT
}
// 来源: review.status + review_turns
```

#### meeting.error

```typescript
payload: { code: string, message: string }
// 异常情况，无 DB 存储
```

---

## 4. DB Replay 策略

### 4.1 已完成的 review（完全 DB）

```
当 review.status = completed 且 DB 有全部 turns:

1. 查询所有 review_turns（ORDER BY turnIndex ASC）
2. 每个 turn JOIN review_opinion
3. 一次性生成所有事件
4. 每秒推送 1 个 turn 的 4 个事件（started → delta → completed → turn.completed）
   间隔 250ms/事件，1 秒/轮
5. 全部推完后发 meeting.completed
6. 关闭连接

总耗时: N 个 turn × 1 秒
例: 3 个 turn → 3 秒推完全部
```

**为什么不全量瞬间推送**：
- 前端 MeetingPage 预期以流式展示
- 瞬间全量推可能导致 UI 卡顿
- 1 秒/轮的节奏与 mock SSE 一致，前端无需修改

### 4.2 不允许 completed review 永远 pending

- `review.status = completed` 时，DB 一定有全部 turns（queue 已完成）
- 如果 DB 缺失部分 turns → 发 `meeting.error` + 关闭
- 不会挂起

---

## 5. Running 中的策略

### 5.1 部分 turns 存在

```
当 review.status = running 且 DB 有部分 turns:

1. 立即回放已 completed 的 turns（同 §4.1 节奏）
2. 之后每 2 秒轮询一次 DB
3. 如果发现新 terminal turn → 立即推送
4. 如果超过 60 秒无新 turn → 发 heartbeat（每 5 秒）
5. 如果 120 秒无新 turn → 发 meeting.error（timeout）
6. 如果收到 meeting.complete → 关流
```

### 5.2 轮询间隔

| 场景 | 间隔 |
|---|---|
| 已有 completed turns | 每 2 秒轮询 |
| 连续 2 次轮询无新 turn | 每 5 秒轮询（退避） |
| 连续 6 次轮询无新 turn | 每 10 秒轮询并按 §5.1 发 heartbeat |

### 5.3 超时

- 总等待上限: 300 秒（5 分钟）
- 超过后自动关闭 SSE 连接
- 前端可重新连接

---

## 6. Completion 判断

### 6.1 review.status = completed

- 直接发 `meeting.completed`
- payload.status = review.status
- 然后关闭连接
- **幂等**：已发过 completed 的 review 再次连接时，只 replay 一次，不发第二个 completed

### 6.2 review.status = running 但 all turns terminal

- 等下一次轮询发现 `terminalCount === expectedCount`
- 发 `meeting.completed`（payload.status = 'completed'，即使 review.status 还是 running）
- **注意**：这发生在 meeting.complete job 执行前的一瞬间
- 下一轮轮询时发现 review.status 已是 completed，不做任何事

### 6.3 避免重复 complete event

| 场景 | 防护 |
|---|---|
| client 断线重连 | 新连接重新 replay（不跳过已发事件） |
| 同 review 多次 SSE 连接 | 每个连接独立计数，互不影响 |
| meeting.complete job 执行顺序 | review.status 由 queue 控制，SSE 只读不写 |

---

## 7. Fallback 边界

### 7.1 条件矩阵

| review status | has DB turns | 行为 |
|---|---|---|
| `draft` | — | ❌ error: "review not running" |
| `ready` | — | ❌ error: "review not running" |
| `running` | ✅ | ✅ DB replay + polling |
| `running` | ❌ | ✅ mock fallback（实时生成，同现有行为） |
| `running` | ⚠️ 部分 | ✅ 已完成的 DB replay + 轮询等待 |
| `completed` | ✅ | ✅ DB replay（一次性） |
| `completed` | ❌ | ⚠️ 异常：应始终有 turns，回退 mock fallback |
| `failed` | ✅ 或 ❌ | ✅ DB replay（有 turns）或 meeting.error |

### 7.2 Error 条件

| 条件 | 行为 |
|---|---|
| review 不存在 | 404 NOT_FOUND |
| 非法 UUID | 400 VALIDATION_ERROR |
| draft/ready | 400 (SSE event: error) |
| 超时 300 秒 | 发 meeting.error + 关闭 |

---

## 8. 测试计划

### 8.1 smoke-sse 或 smoke-runtime 扩展

| 测试 | 描述 |
|---|---|
| DB turns completed → SSE replay | 创建 review → diagnose → save roles → start → 等待 queue → SSE 连接 → 验证事件序列 |
| DB turns partial → SSE heartbeat + partial replay | 同上但在 queue 执行中途连接 SSE → 验证先收到已完成 turns → 再收到后续 |
| no DB turns → mock fallback | 创建 review → diagnose → save roles → start → 立即 SSE（queue 未处理）→ 验证收到 mock 事件 |
| draft/ready → error | draft/ready review 连接 SSE → 验证收到 `event: error` |
| event sequence 递增 | 验证所有事件的 sequence 字段严格递增 |
| 前端兼容 | 现有 MeetingPage 不改也能消费 DB replay 事件 |

### 8.2 smoke-queue 补充

- 新增验证：Start → queue 完成后 → SSE 连接 → 事件序列包含全部 3 个 turn 的 opinion 数据

---

## 9. Sprint 4.3B 实现边界

如果进入 Sprint 4.3B 实现，只允许：

```
✅ 后端 SSE gateway/service 改造（reviews.gateway.ts + reviews.service.ts）
✅ smoke-runtime 或 smoke-sse 新增 4-5 个测试
✅ 保留 mock fallback（不删除现有 MOCK_AGENT_CONTENT）
✅ 不改前端 MeetingPage（事件格式不变，前端无需修改）
✅ 不改 schema

❌ 不接真实 LLM
❌ 不改前端
❌ 不改 schema
❌ 不引入 WebSocket
❌ 不接入 Worker/BullMQ
❌ 不修改 Provider Guard
```

**关键原则**：
1. 事件格式与 Sprint 1.3 完全一致，前端不需要改动
2. mock fallback 保留，不做白屏
3. DB replay 与 mock SSE 使用相同的 event envelope
