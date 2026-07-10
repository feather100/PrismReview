# Sprint 4.3C Meeting SSE Running Partial Hardening — 独立复审报告

> 审查方：QoderWork（独立于 reasonix）  
> 审查日期：2026-07-09  
> 审查模式：只读审查，未修改任何代码  
> 审查对象：`reviews.gateway.ts`、`reviews.service.ts`、`reviews.controller.ts`、`scripts/smoke-sse.js`

---

## Gate 结论：Go（无 P0 / P1 阻塞项）

Sprint 4.3C 成功修复了 Sprint 4.3B 的 P1（running + partial turns 过早 meeting.completed）。`getMeetingStreamFromDb` 重写为三阶段架构：Phase 1 回放初始 turns → Phase 2 检查是否已全部 terminal → Phase 3 轮询等待新 turns。Heartbeat、no-progress timeout (120s)、overall timeout (300s)、Observable cleanup 均完整实现。`sentTurnIds` Set 有效防止重复 replay。mock fallback 保留，前端零修改，schema 零变更。建议进入 Sprint 4.4。

---

## 1. running partial 是否不再提前 meeting.completed

**结论：✅ 修复正确。**

Gateway `getMeetingStreamFromDb` 三阶段架构（lines 97-250）：

```
Phase 1 (lines 138-144): Replay initial completed turns
Phase 2 (lines 147-151): If all turns already terminal → sendMeetingComplete → return
Phase 3 (lines 153-233): If running + partial → poll DB every 2s
                           → meeting.completed only when terminalCount >= expectedTurnCount
```

关键逻辑：

```typescript
// Phase 2: 仅当初始时已全部 terminal 才立即完成
const initialTerminalCount = initialTurns.filter(t => 
  ['completed', 'failed', 'timeout'].includes(t.status)
).length;
if (initialTerminalCount >= expectedTurnCount) {
  sendMeetingComplete();
  return;  // ← 只有 completed review 走此路径
}

// Phase 3: running + partial → 进入轮询
if (reviewStatus === 'running') {
  // poll() 每 2s 查询 DB，仅在 terminalCount >= expectedTurnCount 时 sendMeetingComplete
}
```

**与 Sprint 4.3B 对比**：

| 场景 | Sprint 4.3B | Sprint 4.3C |
|------|-------------|-------------|
| completed review | replay → meeting.completed ✅ | 不变 ✅ |
| running + partial | replay → meeting.completed ❌ | replay → poll → 等待 → meeting.completed ✅ |
| running + no turns | mock fallback ✅ | mock fallback ✅ |

---

## 2. 是否轮询 DB 等待新增 terminal turns

**结论：✅ 每 2 秒轮询。**

Polling 函数（lines 155-229）：

```typescript
const poll = async () => {
  // 1. 查询 DB
  const dbTurns = await this.prisma.reviewTurn.findMany({
    where: { reviewId },
    include: { opinions: true },
    orderBy: { turnIndex: 'asc' },
  });
  
  // 2. 过滤新 terminal turns（不在 sentTurnIds 中的）
  const newTurns = dbTurns
    .filter(t => ['completed', 'failed', 'timeout'].includes(t.status) && !sentTurnIds.has(t.id))
    .map(...);
  
  // 3. 发送新 turns
  for (const turn of newTurns) sendTurn(turn);
  
  // 4. 检查是否全部 terminal
  const terminalCount = dbTurns.filter(t => ['completed', 'failed', 'timeout'].includes(t.status)).length;
  if (terminalCount >= expectedTurnCount) {
    sendMeetingComplete();
    return;
  }
  
  // 5. 调度下一次轮询
  pollTimer = setTimeout(poll, 2000);
};

// 启动轮询
pollTimer = setTimeout(poll, 2000);
```

| 验证项 | 结果 |
|--------|------|
| 轮询间隔 2s | ✅ `setTimeout(poll, 2000)` |
| 查 DB 获取最新 turns | ✅ `prisma.reviewTurn.findMany` |
| 仅处理新 terminal turns | ✅ `!sentTurnIds.has(t.id)` |
| 全部 terminal 时停止 | ✅ `terminalCount >= expectedTurnCount` |
| 轮询中出错处理 | ✅ catch → meeting.error(POLL_ERROR) |

---

## 3. 是否 heartbeat / no-progress timeout / total timeout 处理清晰

**结论：✅ 三层超时机制完整。**

### 3.1 Heartbeat

```typescript
// lines 217-220
heartbeatCount++;
if (heartbeatCount % 3 === 0 && newTurns.length === 0) {
  push('heartbeat', { timestamp: ts() });
}
```

每 3 次轮询（6 秒）无新 turn 时发送 heartbeat。保持 SSE 连接活跃。

### 3.2 No-progress timeout (120s)

```typescript
// lines 202-207
const idleTime = Date.now() - noProgressSince;
if (idleTime > 120000) {
  push('meeting.error', { code: 'TIMEOUT', message: 'No progress for 120s' });
  subscriber.complete();
  return;
}
```

`noProgressSince` 在每次有新 turn 时重置（line 126）。120 秒无新 turn → meeting.error + 关闭。

### 3.3 Overall timeout (300s)

```typescript
// lines 236-243
overallTimer = setTimeout(() => {
  if (!hasCompleted) {
    push('meeting.error', { code: 'OVERALL_TIMEOUT', message: 'SSE connection timed out' });
    subscriber.complete();
  }
}, 300000);
```

从连接建立开始计时，300 秒后强制关闭。即使有新 turn 持续到达（重置 noProgressSince），300 秒总上限仍然生效。

### 3.4 超时场景矩阵

| 场景 | no-progress 120s | overall 300s | 结果 |
|------|-------------------|--------------|------|
| 所有 turn 卡住，无新进展 | ✅ 触发 TIMEOUT | — | meeting.error |
| turn 缓慢但持续到达 | ❌ 不触发（持续重置） | ✅ 触发 OVERALL_TIMEOUT | meeting.error |
| 全部正常完成 | ❌ 不触发 | ❌ 不触发 | meeting.completed |
| 客户端断连 | — | — | cleanup 清除 timers |

### 3.5 Observable cleanup

```typescript
// lines 245-248
return () => {
  if (pollTimer) clearTimeout(pollTimer);
  if (overallTimer) clearTimeout(overallTimer);
};
```

客户端断连时清除所有定时器，无资源泄漏。✅

---

## 4. 是否避免重复 replay 同一 turn

**结论：✅ 双重防护。**

**防护 1 — sendTurn 守卫**（lines 116-117）：

```typescript
if (sentTurnIds.has(turn.turnId)) return;
sentTurnIds.add(turn.turnId);
```

**防护 2 — poll 过滤**（line 171）：

```typescript
.filter(t => ['completed', 'failed', 'timeout'].includes(t.status) && !sentTurnIds.has(t.id))
```

即使 poll 返回已发送的 turn，sendTurn 也会跳过。两层保护互为兜底。

**meeting.completed 幂等**（lines 129-131）：

```typescript
const sendMeetingComplete = () => {
  if (hasCompleted) return;
  hasCompleted = true;
  ...
};
```

防止 meeting.completed 被发送两次。

---

## 5. sequence 是否单调递增

**结论：✅ 严格单调递增。**

```typescript
// line 101
let seq = 0;

// lines 110-112
const push = (type: string, payload: any) => {
  seq++;
  subscriber.next({ type, data: { ..., sequence: seq, ... } });
};
```

- seq 从 0 开始
- 每次 push 前递增
- 所有事件通过 push 发送
- JavaScript 单线程 + setTimeout，无并发 push

---

## 6. completed DB replay 是否仍有限关闭

**结论：✅ 有限事件 + 干净关闭。**

Completed review 路径（Phase 2, lines 147-151）：

```typescript
if (initialTerminalCount >= expectedTurnCount) {
  sendMeetingComplete(); // → meeting.completed + subscriber.complete()
  return;                // → 不进入轮询，不设定时器
}
```

`sendMeetingComplete`（lines 129-136）：

```typescript
const sendMeetingComplete = () => {
  if (hasCompleted) return;      // 幂等
  hasCompleted = true;
  push('meeting.completed', ...); // 最后事件
  if (pollTimer) clearTimeout(pollTimer);   // 清理（虽然 completed 时未设置）
  if (overallTimer) clearTimeout(overallTimer);
  subscriber.complete();          // 关闭 Observable
};
```

| 验证项 | 结果 |
|--------|------|
| 事件数量有限 | ✅ 4N + 2（N = completed turns） |
| meeting.completed 总是最后事件 | ✅ |
| subscriber.complete() 关闭流 | ✅ |
| 无残留定时器 | ✅ |

---

## 7. mock fallback 是否仍可用

**结论：✅ 完整保留。**

Controller (`reviews.controller.ts:100-104`)：

```typescript
if (result.dbTurns) {
  return this.reviewsGateway.getMeetingStreamFromDb(reviewId, result.sessionId, result.dbTurns, result.reviewStatus, result.expectedTurnCount);
}
return this.reviewsGateway.getMeetingStream(reviewId, result.sessionId, result.roles);
```

Gateway mock 路径（lines 54-89）— `getMeetingStream` 完全未修改：
- MOCK_AGENT_CONTENT 保留 ✅
- 400ms 间隔 ✅
- 事件序列完整 ✅
- meeting.completed 结尾 ✅

Service fallback 路径（lines 231-241）— 无 DB turns 时返回 `{ roles }` ✅

---

## 8. 是否未改前端 / 未改 schema / 未接 LLM

**结论：✅ 均未变更。**

| 红线 | 验证 |
|------|------|
| 不改前端 | ✅ MeetingPage.tsx / useMeetingSSE.ts 未改 |
| 不改 schema | ✅ Prisma 查询均为已有模型/字段 |
| 不接真实 LLM | ✅ 无 provider.run() 调用，无 MODEL_PROVIDER 读取 |
| 不接 LM Studio | ✅ |
| 不改 WebSocket | ✅ 仍用 SSE（@Sse 装饰器） |
| 不移除 mock fallback | ✅ MOCK_AGENT_CONTENT 保留 |

**新依赖注入**：ReviewsGateway 构造函数新增 `PrismaService`（line 29）。用于 polling DB 查询。这是 NestJS 标准 DI，PrismaService 已在模块中全局注册，无额外配置需求。

---

## 9. smoke 是否覆盖 running partial 场景

**结论：⚠️ 核心修复场景未覆盖。**

### smoke-sse (5/5)

| # | 测试 | 场景 | 评估 |
|---|------|------|------|
| 1 | Completed: finite replay + meeting.completed | completed review | ✅ |
| 2 | Completed: sequence monotonic | completed review | ✅ |
| 3 | Draft: SSE error | draft → error | ✅ |
| 4 | Invalid UUID: SSE error | 格式错误 | ✅ |
| 5 | Non-existent: SSE error | 不存在 review | ✅ |

### 未覆盖的场景

| 场景 | 重要性 | 评估 |
|------|--------|------|
| **running + partial → polling → meeting.completed** | 高 | ❌ 本 Sprint 核心修复，缺少自动化验证 |
| **no-progress timeout → meeting.error (TIMEOUT)** | 中 | ❌ 未测试 |
| **heartbeat during idle** | 低 | ❌ 未测试 |
| **mock fallback (running + no DB turns)** | 中 | ❌ 未测试 |

**原因分析**：running partial 场景难以自动化测试——mock queue ~700ms 完成全部 turns，要在 queue 处理中途连接 SSE 需要精确的时序控制，测试容易 flaky。

**代码审查确认**：虽然缺少自动化测试，但通过代码审查确认了 polling 逻辑的正确性：
- setTimeout(poll, 2000) 正确调度轮询 ✅
- sentTurnIds 防重复 ✅
- terminalCount >= expectedTurnCount 判断正确 ✅
- 超时/心跳/cleanup 完整 ✅

---

## Sprint 4.3B P1/P2 闭环追踪

| 编号 | 描述 | Sprint 4.3C 状态 |
|------|------|-----------------|
| P1-1 | running + partial turns 轮询等待 | ✅ **关闭** — Phase 3 polling 实现 2s 轮询 + 等待 terminal |
| P2-1 | durationMs 硬编码 3000 | ⚠️ 部分闭环 — 改为 `DEFAULT_DURATION_MS` 常量（line 23），但仍非从 startedAt/completedAt 计算 |
| P2-2 | agent.turn.started 缺 roleId | ✅ **关闭** — line 120 包含 `roleId: turn.roleId` |
| P2-3 | 全部失败不发 meeting.error | ❌ 未闭环 — 全部失败时仍发 meeting.completed(totalTurns=0) |
| P2-4 | 未新增 SSE smoke 测试 | ✅ **关闭** — 新增 `scripts/smoke-sse.js` 5 个测试 |

---

## P0 阻塞项

**无。**

---

## P1 建议项

**无。** Sprint 4.3B 的 P1（running partial 轮询）已在本 Sprint 关闭。

---

## P2 可延后项

### P2-1: In-poll overall timeout 检查为死代码

- **位置**: `reviews.gateway.ts:210-214`
- **问题**: 使用 `idleTime`（= `Date.now() - noProgressSince`）判断 300s，但 120s no-progress 检查（line 203）总是先触发。此分支不可达。
- **影响**: 无功能影响——真正的 300s overall timeout 由 `overallTimer`（line 236）独立处理。
- **建议**: 删除 lines 210-214 死代码，或改为使用连接开始时间（`const connectedAt = Date.now()`）判断。

### P2-2: durationMs 仍为常量而非实际计算

- **位置**: `reviews.gateway.ts:125`
- **合同**: Sprint 4.3A Section 3.2 — `durationMs: reviewTurn.completedAt - reviewTurn.startedAt`
- **实际**: `DEFAULT_DURATION_MS`（3000）
- **影响**: 前端不消费 durationMs 字段。功能无影响。
- **建议**: 改为 `new Date(turn.completedAt).getTime() - new Date(turn.startedAt).getTime()` 或 `DEFAULT_DURATION_MS` fallback。

### P2-3: running partial polling 缺少自动化测试

- **位置**: `scripts/smoke-sse.js`
- **问题**: Sprint 4.3C 核心修复（running + partial → polling → meeting.completed）无自动化验证
- **影响**: 后续重构可能引入回归
- **建议**: 可在 Sprint 4.4 中补充时序敏感测试，或用 integration test 模拟 queue 延迟

### P2-4: 全部 turn 失败时不发 meeting.error

- **位置**: `reviews.gateway.ts:132`
- **现状**: 当所有 turn 失败时，`sentTurnIds.size > 0`（failed turns 也发送 turn.started + turn.completed），发送 `meeting.completed({ status: 'completed', totalTurns: N })`
- **继承自**: Sprint 4.3A P2-3 / Sprint 4.3B P2-3
- **建议**: 可在 Sprint 4.4 中统一处理

---

## 是否建议进入 Sprint 4.4

**建议进入。** Sprint 4.3C 成功完成了加固目标：

1. P1 修复：running + partial turns 不再提前 meeting.completed ✅
2. Polling 机制：每 2s 查询 DB，正确等待新 terminal turns ✅
3. 超时体系：heartbeat (6s) + no-progress (120s) + overall (300s) 三层完整 ✅
4. 防重复：sentTurnIds Set + sendTurn 守卫 + poll 过滤 ✅
5. Sequence 单调递增 ✅
6. Completed replay 有限关闭 ✅
7. Mock fallback 保留 ✅
8. 前端/schema/LLM 零变更 ✅
9. smoke-sse 基础测试 5/5 ✅

SSE 后端已具备接入真实 LLM 的能力：
- startReview < 1s，不阻塞 ✅
- Queue 异步处理 turns ✅
- SSE 从 DB 读取真实数据 ✅
- Running + partial 正确等待 ✅
- 超时兜底完整 ✅

**建议下一步**：Sprint 4.4 — LM Studio Guarded Integration。
