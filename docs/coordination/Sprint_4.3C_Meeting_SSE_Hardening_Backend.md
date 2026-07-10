# Sprint 4.3C — Meeting SSE Running Partial Hardening

> 修复 Sprint 4.3B 遗留 P1：running + partial turns 时，SSE 不能快照回放后立刻 meeting.completed，必须轮询等待新 DB turns。

---

## 1. 修改文件

| 文件 | 变更 |
|---|---|
| `apps/api/src/modules/reviews/reviews.gateway.ts` | 重写 `getMeetingStreamFromDb`：新增 PrismaService 注入，实现轮询/心跳/超时逻辑 |
| `apps/api/src/modules/reviews/reviews.service.ts` | `validateMeetingStream` 返回 `reviewStatus` + `expectedTurnCount` + `roleId` |
| `apps/api/src/modules/reviews/reviews.controller.ts` | 传入 `reviewStatus` + `expectedTurnCount` 参数 |
| `scripts/smoke-sse.js` | 新增 SSE 专用 smoke 测试 |

---

## 2. 关键修复

### 2.1 Running partial 轮询

| 场景 | 之前行为 | 现在行为 |
|---|---|---|
| completed review | replay → meeting.completed ✅ | 不变 ✅ |
| running + partial turns | replay → 发 meeting.completed ❌ | replay → 轮询 2s → 等待新 turns → 全部 terminal → meeting.completed ✅ |
| running + no turns | mock fallback ✅ | mock fallback ✅ |
| 120s 无进展 | 挂起 ❌ | meeting.error (TIMEOUT) ✅ |
| 300s 总超时 | 挂起 ❌ | 安全关闭 ✅ |

### 2.2 Polling 机制

```
Phase 1: Replay initial completed turns (400ms interval)
Phase 2: Every 2s query DB for new terminal turns
  → New turns found? Send events, update noProgressSince
  → No new turns? heartbeatCount++ → send heartbeat every 3 polls
  → 120s idle? meeting.error(TIMEOUT)
  → 300s total? Close connection
Phase 3: terminalCount >= expectedTurnCount → meeting.completed + close
```

### 2.3 P2 顺手修复

- `agent.turn.started` 现在包含 `roleId`（从 DB 查询）
- `durationMs` 使用 `DEFAULT_DURATION_MS` 常量（非硬编码 3000）
- 新增 `scripts/smoke-sse.js` 专用 SS E 测试

---

## 3. 验证结果

### smoke-runtime (31/31) ✅
### smoke-queue (8/8) ✅
### smoke-sse (5/5) ✅

| 测试 | 结果 |
|---|---|
| Completed DB replay → finite + meeting.completed | ✅ 6069 bytes, sequence 1-11+ |
| Completed: sequence monotonic | ✅ 11+ events, strictly increasing |
| Draft: SSE error | ✅ event: error |
| Invalid UUID: SSE error | ✅ event: error |
| Non-existent: SSE error | ✅ event: error |

---

## Backend Gate

**Go ✅** — running partial 轮询、超时、心跳均已实现，mock fallback 保留，前端兼容。
