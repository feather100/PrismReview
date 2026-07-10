# Sprint 1.3 — Meeting Event Contract

> 定义 `GET /api/reviews/{reviewId}/meeting/stream` 的 SSE 事件协议。
> Antigravity 可依据本契约开发 Meeting UI 的事件消费逻辑。
> 本阶段无前端接入，无真实 Agent 执行，无 WebSocket。

---

## 1. Transport

- **Protocol**: Server-Sent Events (SSE, `text/event-stream`)
- **Endpoint**: `GET /api/reviews/{reviewId}/meeting/stream`
- **Auth**: JWT (`JwtAuthGuard`), 注入 `CurrentUser` 用于租户隔离
- **Content-Type**: `text/event-stream`
- **Encoding**: UTF-8

### 前置条件

| 条件 | 行为 |
|---|---|
| `reviewId` 不是合法 UUID v4 | 400 `VALIDATION_ERROR` |
| Review 不存在或不属于当前 tenant | 404 `NOT_FOUND` |
| Review status 不是 `running` | 400 `Review must be running to stream meeting events` |
| Review 的 `roleSelection` 为空 | 400 `Role selection required before streaming meeting events` |

### 断连策略

- 客户端断开后，Sprint 1.3 **不做 resume**，需重新请求 stream。
- 后续 Sprint 可基于 `sequence` 实现断点续传。
- Mock 不发送保活心跳（仅模拟一次 `heartbeat` 事件）。

---

## 2. Event Envelope

所有 SSE `data` 行统一包装为 JSON 对象：

```typescript
interface MeetingEventEnvelope<T = unknown> {
  eventId: string;          // 全局唯一: `${reviewId}-${sequence}`
  reviewId: string;
  sessionId: string;        // 固定值: `session-${reviewId}`
  type: MeetingEventType;
  timestamp: string;        // ISO 8601
  sequence: number;         // 从 1 递增
  payload: T;
}

type MeetingEventType =
  | 'meeting.started'
  | 'agent.turn.started'
  | 'agent.message.delta'
  | 'agent.message.completed'
  | 'agent.turn.completed'
  | 'meeting.completed'
  | 'meeting.error'
  | 'heartbeat';
```

### SSE 线格式

```
event: meeting.started
data: {"eventId":"uuid-1","reviewId":"...","sessionId":"session-...","type":"meeting.started","timestamp":"2026-07-07T12:00:00.000Z","sequence":1,"payload":{...}}

event: heartbeat
data: {"eventId":"uuid-2","reviewId":"...","sessionId":"session-...","type":"heartbeat","timestamp":"...","sequence":2,"payload":{}}

...
```

---

## 3. Payload Types

### `meeting.started`

```typescript
interface MeetingStartedPayload {
  status: 'running';
  totalAgents: number;          // roleSelection 中的角色数
  totalTurnsPlanned: number;    // 固定 = totalAgents (一轮)
}
```

### `agent.turn.started`

```typescript
interface AgentTurnStartedPayload {
  turnId: string;               // `${reviewId}-turn-${turnIndex}`
  roleId: string;
  roleCode: string;
  roleName: string;
  turnIndex: number;            // 从 1 递增
}
```

### `agent.message.delta`

```typescript
interface AgentMessageDeltaPayload {
  turnId: string;
  roleCode: string;
  delta: string;                // 文本片段，Mock 中每次发送完整内容
}
```

### `agent.message.completed`

```typescript
interface AgentMessageCompletedPayload {
  turnId: string;
  roleCode: string;
  content: string;              // 完整发言内容
  riskLevel: 'high' | 'medium' | 'low' | 'info';
  dimension: string;
  recommendation: string;       // 改进建议
  confidenceScore: number;      // 0-100
}
```

### `agent.turn.completed`

```typescript
interface AgentTurnCompletedPayload {
  turnId: string;
  roleCode: string;
  durationMs: number;           // Mock: 固定 3000
}
```

### `meeting.completed`

```typescript
interface MeetingCompletedPayload {
  status: 'completed';
  totalTurns: number;
}
```

### `meeting.error`

```typescript
interface MeetingErrorPayload {
  code: string;
  message: string;
}
```

### `heartbeat`

```typescript
interface HeartbeatPayload {
  timestamp: string;
}
```

---

## 4. Event Sequence (Mock)

```
sequence  event                          interval
──────────────────────────────────────────────────
   1      meeting.started                — (immediate)
   2      heartbeat                      +500ms
   3      agent.turn.started (Agent 1)   +500ms
   4      agent.message.delta            +200ms
   5      agent.message.completed        +500ms
   6      agent.turn.completed           +300ms
   7      agent.turn.started (Agent 2)   +500ms
   8      agent.message.delta            +200ms
   9      agent.message.completed        +500ms
  10      agent.turn.completed           +300ms
  11      agent.turn.started (Agent 3)   +500ms
  12      agent.message.delta            +200ms
  13      agent.message.completed        +500ms
  14      agent.turn.completed           +300ms
  15      meeting.completed              +500ms
```

**Mock 数据来源**: `roleSelection` JSON 中保存的角色，从 `agent_roles` 表 JOIN 获取 `roleCode`、`roleName`。

**Mock 内容**: 每个 Agent 根据其角色输出一段结构化意见：
- CTO: 架构合理性/性能
- CFO: 投入产出/成本效益
- PMO: 排期/资源依赖
- Compliance: 合规/数据安全
- UserAdvocate: 用户体验/可用性

**总耗时**: ~7 秒（15 事件 × ~500ms 平均间隔）

---

## 5. Error / Disconnect Strategy

### 重要说明：NestJS @Sse() 的异常处理行为

NestJS 的 `@Sse()` 装饰器**总是返回 HTTP 200**，即使 handler 抛出异常。
异常不会被转换为常规 HTTP 错误码，而是被捕获并作为 SSE `event: error` 行发送。

因此：
- **所有 meeting/stream 的响应都是 HTTP 200**（包括错误情况）。
- 客户端必须解析 SSE 数据行来判断成功或失败，**不能依赖 HTTP status code**。
- 成功时收到 `meeting.started` → ... → `meeting.completed` 事件序列。
- 失败时收到 `event: error` 行，附带错误消息文本。

### 错误场景对照

| 场景 | HTTP Status | 实际响应 | 客户端判断方式 |
|---|---|---|---|
| Invalid UUID | 200 | SSE `event: error` + `data: Validation failed (uuid v 4 is expected)` | 检查第一行是否为 `event: error` |
| Review 不存在 | 200 | SSE `event: error` + `data: Review not found` | 同上 |
| Review 非 running | 200 | SSE `event: error` + `data: Review status "ready" does not allow this operation...` | 同上 |
| roleSelection 为空 | 200 | SSE `event: error` + `data: Role selection required before streaming meeting events` | 同上 |
| 客户端断连 | — | Observable cleanup (`clearInterval`) | 浏览器 EventSource 触发 `onerror` |
| 重连需求 | — | Sprint 1.3 不做 resume；后续可基于 `sequence` 实现 | — |

### 对比：非 SSE 端点

非 SSE REST 端点（`/roles`, `/reviews`, `/auth/me` 等）的行为不变：
- `ParseUUIDPipe` → HTTP 400 `VALIDATION_ERROR`
- `NotFoundException` → HTTP 404 `NOT_FOUND`
- `BadRequestException` → HTTP 400

---

## 6. 限制

- Mock 最多模拟 3 个 Agent turn（取 roleSelection 中前 3 个角色）。
- 不做 delta 分片（一次 `message.delta` 即包含完整内容）。
- 不写 `review_turns` / `review_opinions` 表。
- 不调模型 / Worker / Celery。
- 不改 Prisma schema。
