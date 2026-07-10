# Sprint 4.3B — Meeting SSE DB Turns Implementation

> 实现 Meeting SSE 优先读取 DB `review_turns` / `review_opinions`；无 DB turns 时保留 mock fallback。

---

## 1. 修改文件

| 文件 | 变更 |
|---|---|
| `apps/api/src/modules/reviews/reviews.gateway.ts` | 新增 `getMeetingStreamFromDb()` 方法 |
| `apps/api/src/modules/reviews/reviews.service.ts` | `validateMeetingStream()` 优先查 DB，支持 `completed` 状态 |
| `apps/api/src/modules/reviews/reviews.controller.ts` | 根据返回类型选择 mock 或 DB SSE |

---

## 2. DB 优先逻辑

```
SSE 连接 (/meeting/stream)
  │
  ├── 查询 review_turns + review_opinions
  │
  ├── 有 DB turns → getMeetingStreamFromDb()
  │   └── 从 DB 数据构建事件队列
  │       └── 400ms 间隔推送（与 mock 节奏一致）
  │       └── 推完后发 meeting.completed + 关闭
  │
  └── 无 DB turns → getMeetingStream() (mock fallback)
      └── 现有行为不变（MOCK_AGENT_CONTENT + roleSelection）
```

---

## 3. Fallback 条件

| 场景 | 行为 |
|---|---|
| review.running + 有 DB turns | ✅ DB replay |
| review.running + 无 DB turns（刚 start） | ✅ mock fallback |
| review.completed + 有 DB turns | ✅ DB replay（新增支持） |
| review.completed + 无 DB turns | ❌ 异常（回退 mock fallback 不白屏） |
| draft/ready | ❌ SSE error (event: error) |

---

## 4. 验证结果

### smoke-runtime (31/31) ✅
无回归，全部通过。

### smoke-queue (8/8) ✅
队列链路完整。

### DB SSE 原始输出

```
event: meeting.started      — sequence: 1, totalAgents: 3
event: heartbeat            — sequence: 2
event: agent.turn.started   — sequence: 3, roleCode: CTO
event: agent.message.delta  — sequence: 4
event: agent.message.completed — sequence: 5, riskLevel: high
event: agent.turn.completed — sequence: 6
event: agent.turn.started   — sequence: 7, roleCode: CFO
... (3 turns total)
event: meeting.completed    — sequence: last
```

- 6069 bytes, 11+ events
- 来自 DB review_turns / review_opinions 的真实数据（非 MOCK_AGENT_CONTENT）
- sequence 从 1 递增

---

## 5. 禁止事项

| 红线 | 状态 |
|---|---|
| 不改前端 | ✅ 事件格式不变，前端无需修改 |
| 不改 schema | ✅ |
| 不接真实 LLM | ✅ |
| 不接 WebSocket | ✅ |
| 不移除 mock fallback | ✅ `MOCK_AGENT_CONTENT` 保留，无 DB 时自动 fallback |

---

## Backend Gate

**Go ✅** — Meeting SSE 已完成从 DB 读取真实 queue 结果的实现，mock fallback 保留，前端兼容。
