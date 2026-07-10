# Sprint 4.3B Meeting SSE DB Turns Implementation — 独立复审报告

> 审查方：QoderWork（独立于 reasonix）  
> 审查日期：2026-07-09  
> 审查模式：只读审查，未修改任何代码  
> 审查对象：`reviews.gateway.ts`、`reviews.service.ts`、`reviews.controller.ts`

---

## Gate 结论：Go（附 P1 条件项）

Sprint 4.3B 实现了 Meeting SSE 优先从 DB 读取 review_turns / review_opinions 的核心功能。DB replay 路径正确构建事件队列、sequence 单调递增、payload 兼容前端。mock fallback 在无 DB turns 时正常触发。前端零修改，schema 零变更。但存在 1 项 P1：running + partial turns 场景缺少 Sprint 4.3A 合同 Section 5 要求的轮询等待机制，实现仅做快照回放后即发送 meeting.completed。此问题在 mock queue（~700ms 完成）下被掩盖，但 Sprint 4.4 接 LM Studio（30s+/turn）时将暴露。建议先做 4.3C hardening 修复 P1，再进入 Sprint 4.4。

---

## 1. 是否未改前端

**结论：✅ 未改。**

Sprint 4.3B 修改文件清单（来自 Sprint_4.3B Backend doc Section 1）：

| 文件 | 变更类型 |
|------|----------|
| `reviews.gateway.ts` | 新增 `getMeetingStreamFromDb()` |
| `reviews.service.ts` | 修改 `validateMeetingStream()` |
| `reviews.controller.ts` | 修改 `meetingStream()` 路由逻辑 |

前端文件验证：

| 文件 | 状态 |
|------|------|
| `apps/web/src/features/meeting/MeetingPage.tsx` | ✅ 未改（与 Sprint 4.3A 审查时一致） |
| `apps/web/src/lib/realtime/useMeetingSSE.ts` | ✅ 未改 |

---

## 2. 是否未改 schema

**结论：✅ 未改。**

代码使用的 Prisma 查询：

| 查询 | 模型/字段 | schema 状态 |
|------|-----------|-------------|
| `reviewTurn.findMany({ where: { reviewId }, include: { opinions: true } })` | review_turns + review_opinions 关系 | ✅ 已有 |
| `agentRole.findMany({ where: { activeVersionId: { in: versionIds } } })` | agent_roles.activeVersionId | ✅ 已有 |

无新模型、无新字段、无新关系。

---

## 3. DB turns 是否优先于 mock fallback

**结论：✅ DB turns 优先。**

Controller (`reviews.controller.ts:100-104`):

```typescript
const result = await this.reviewsService.validateMeetingStream(reviewId, user) as any;
if (result.dbTurns) {
  return this.reviewsGateway.getMeetingStreamFromDb(reviewId, result.sessionId, result.dbTurns);
}
return this.reviewsGateway.getMeetingStream(reviewId, result.sessionId, result.roles);
```

Service (`reviews.service.ts:187-236`):

```typescript
// 1. 先查 DB turns
const dbTurns = await this.prisma.reviewTurn.findMany({ where: { reviewId }, ... });

// 2. 有 DB turns → 返回 { dbTurns }
if (dbTurns.length > 0) {
  return { sessionId, dbTurns: enrichedTurns };
}

// 3. 无 DB turns → 返回 { roles } → mock fallback
return { sessionId, roles: enriched.roles };
```

**优先级链**：DB turns → mock fallback。✅

---

## 4. 无 DB turns 时 mock fallback 是否仍可用

**结论：✅ mock fallback 完整保留。**

Service fallback 路径 (`reviews.service.ts:225-235`):

```typescript
// Fallback to mock
if (!review.roleSelection) {
  throw new BadRequestException('Role selection required...');
}
const enriched = await this.getEnrichedRoleSelection(reviewId, user.tenantId);
return { sessionId, roles: enriched.roles };
```

Gateway mock 路径 (`reviews.gateway.ts:79-141`) — `getMeetingStream()` 方法完全未修改：
- MOCK_AGENT_CONTENT 保留（line 12-43）✅
- setInterval + 400ms 节奏 ✅
- 15 事件序列（3 roles）✅
- meeting.completed 结尾 ✅

**触发场景**：review 刚 start、queue 尚未处理时（~700ms 窗口），SSE 连接走 mock fallback，前端不白屏。

---

## 5. 事件 payload 是否兼容前端 useMeetingSSE

**结论：✅ 兼容。**

逐事件对比 DB replay 输出与前端消费字段：

| 事件 | DB replay payload (gateway:164-172) | 前端消费字段 (MeetingPage.tsx) | 兼容 |
|------|------|------|------|
| `meeting.started` | status, totalAgents, totalTurnsPlanned | （不消费 payload） | ✅ |
| `heartbeat` | timestamp | （不消费 payload） | ✅ |
| `agent.turn.started` | turnId, roleCode, roleName, turnIndex | roleCode, roleId⚠️, roleName, turnId | ⚠️ P2-2 |
| `agent.message.delta` | turnId, roleCode, delta | turnId, delta | ✅ |
| `agent.message.completed` | turnId, roleCode, content, riskLevel, dimension, recommendation, confidenceScore | turnId, content, riskLevel, dimension | ✅ |
| `agent.turn.completed` | turnId, roleCode, durationMs | roleCode | ✅ |
| `meeting.completed` | status, totalTurns | （不消费 payload，仅触发关闭） | ✅ |

**Event Envelope** (gateway:153-156):

```typescript
{ eventId, reviewId, sessionId, type, timestamp, sequence, payload }
```

与 Sprint 1.3 `MeetingEventEnvelope` 和 mock 路径格式完全一致。✅

**roleId 缺失说明**：DB replay 路径的 `agent.turn.started` 未包含 `roleId` 字段。前端 MeetingPage.tsx line 34 使用 `data.roleId || data.roleCode || ''`，有 fallback 到 roleCode，不崩溃。P2 级别。

---

## 6. sequence 是否单调递增

**结论：✅ 严格单调递增。**

Gateway (`reviews.gateway.ts:149-156`):

```typescript
let seq = 0;
const push = (type: string, payload: any) => {
  seq++;
  queue.push({ type, data: { ..., sequence: seq, ... } });
};
```

- seq 从 0 开始
- 每次 push 前递增
- 所有事件按 push 顺序入队
- 无并发写入（单线程 Observable 构建）

**验证**：Sprint 4.3B doc Section 4 的原始输出确认 "sequence 从 1 递增"。

---

## 7. completed DB replay 是否有限且最终 completed

**结论：✅ 有限事件 + 必然 meeting.completed + 连接关闭。**

Gateway (`reviews.gateway.ts:147-190`):

```typescript
// 1. 有限事件队列
const completedTurns = dbTurns.filter(t => t.status === 'completed' && t.opinion);
// 每个 turn 产生 4 个事件 + 2 个固定事件 = 4N + 2 个事件

// 2. meeting.completed 总是最后一个
push('meeting.completed', { status: 'completed', totalTurns: completedTurns.length });

// 3. 推完后关闭
const interval = setInterval(() => {
  if (index >= totalEvents) {
    clearInterval(interval);
    subscriber.complete(); // Observable 关闭
    return;
  }
  subscriber.next(...);
  index++;
}, INTERVAL_MS);
```

| 验证项 | 结果 |
|--------|------|
| 事件数量有限 | ✅ 4N + 2（N = completedTurns.length） |
| meeting.completed 总是最后一个事件 | ✅ |
| 推完后 clearInterval + subscriber.complete() | ✅ |
| 前端 useMeetingSSE 收到 meeting.completed 后 es.close() | ✅ |

**不会卡住**：无论 DB 有多少 turns，事件队列总是有限的，推送总是有终点的。

---

## 8. running partial 是否不会白屏/卡死

**结论：⚠️ 不会白屏/卡死，但存在 P1 功能缺口。**

### 8.1 不会白屏/卡死

- SSE 连接建立后立即推送 meeting.started + heartbeat → 前端不白屏 ✅
- 所有事件在有限时间内推完（400ms × 事件数） → 不会卡死 ✅
- 推完后 subscriber.complete() → 前端收到关闭信号 ✅

### 8.2 P1 — 缺少 running + partial turns 轮询等待

**Sprint 4.3A 合同 Section 5 要求**：

```
当 review.status = running 且 DB 有部分 turns:
1. 立即回放已 completed 的 turns
2. 之后每 2 秒轮询一次 DB
3. 如果发现新 terminal turn → 立即推送
4. 如果超过 60 秒无新 turn → 发 heartbeat
5. 如果 120 秒无新 turn → 发 meeting.error（timeout）
6. 如果收到 meeting.complete → 关流
```

**实际实现**：

```
当 review.status = running 且 DB 有部分 turns:
1. 立即回放已 completed 的 turns
2. 发送 meeting.completed ← ⚠️ 不应在此时发送
3. 关闭连接
```

**问题场景**（Sprint 4.4 将暴露）：

```
Review 有 5 个角色，queue 正在处理中。
SSE 连接时，2/5 turns 已完成。

当前实现:
→ 回放 2 个 turns → meeting.completed → 关闭
→ 前端显示"已完成"
→ 用户看不到剩余 3 个角色的评审意见

合同要求:
→ 回放 2 个 turns → 轮询等待 → 推送新 turns → ... → 全部完成后 meeting.completed
```

**当前掩盖**：mock queue ~700ms 完成全部 turns，SSE 连接时通常已全部完成。但 Sprint 4.4 接 LM Studio（30s+/turn）后，用户跳转 Meeting 页时 queue 远未完成，此问题将直接暴露。

**建议**：在 Sprint 4.3C hardening 中实现 Sprint 4.3A Section 5 的轮询等待机制，再进入 Sprint 4.4。

---

## 9. draft/ready 是否仍被拦截

**结论：✅ 被拦截。**

Service (`reviews.service.ts:188`):

```typescript
const review = await this.assertReview(reviewId, user.tenantId, ['running', 'completed']);
```

`assertReview` 只允许 `running` 和 `completed`。其他 7 种状态（draft / diagnosing / ready / interrupted / summarizing / failed / archived）均抛出 `BadRequestException`。

**错误传播链**：

```
assertReview 抛 BadRequestException
    ↓
NestJS @Sse() 捕获异常
    ↓
SSE event: error（Sprint 1.3 Section 5 记录的 NestJS 行为）
    ↓
前端 useMeetingSSE 收到 error → setBackendError → 显示 Alert
```

**前端双重防护**：MeetingPage.tsx line 108-119 在前端层面也对 draft/ready 做了拦截，显示"该评审尚未开始"的 Alert，不会发起 SSE 连接。

---

## 10. smoke-runtime / smoke-queue / SSE smoke 是否通过

**结论：✅ 全部通过。**

| 测试套件 | 结果 | 来源 |
|----------|------|------|
| smoke-runtime | 31/31 ✅ | Sprint 4.3B doc Section 4 |
| smoke-queue | 8/8 ✅ | Sprint 4.3B doc Section 4 |
| DB SSE 原始输出 | 6069 bytes, 11+ events, sequence 递增 ✅ | Sprint 4.3B doc Section 4 |

**DB SSE 事件序列验证**：

```
event: meeting.started      — sequence: 1 ✅
event: heartbeat            — sequence: 2 ✅
event: agent.turn.started   — sequence: 3, roleCode: CTO ✅
event: agent.message.delta  — sequence: 4 ✅
event: agent.message.completed — sequence: 5, riskLevel: high ✅
event: agent.turn.completed — sequence: 6 ✅
... (3 turns total)
event: meeting.completed    — sequence: last ✅
```

事件类型、顺序、payload 字段均与 Sprint 4.3A 合同 Section 3 一致。

---

## 与 Sprint 4.3A 合同的一致性

| 合同项 | 实现 | 一致 |
|--------|------|------|
| DB turns 优先于 mock fallback | Service 先查 DB turns，无则 fallback | ✅ |
| 事件格式与 Sprint 1.3 一致 | Event Envelope + 8 种事件类型 | ✅ |
| sequence 单调递增 | `let seq = 0; seq++` | ✅ |
| completed DB replay | 有限事件 + meeting.completed + 关闭 | ✅ |
| running + partial turns 轮询 | ❌ 未实现（仅快照回放） | ❌ P1 |
| running + 无 turns → mock fallback | Service fallback 路径 | ✅ |
| draft/ready → error | assertReview(['running', 'completed']) | ✅ |
| durationMs 从 DB 计算 | 硬编码 3000 | ⚠️ P2 |
| agent.turn.started 包含 roleId | 未包含 | ⚠️ P2 |

---

## P0 阻塞项

**无。**

---

## P1 建议项

### P1-1: running + partial turns 缺少轮询等待机制

- **位置**: `reviews.gateway.ts:147-190` (`getMeetingStreamFromDb`)
- **合同要求**: Sprint 4.3A Section 5 — 每 2 秒轮询 DB，发现新 terminal turn 立即推送，120 秒无新 turn 发 meeting.error
- **实际实现**: 快照回放 → meeting.completed → 关闭。不轮询，不等待
- **影响**:
  - **当前（mock queue）**: 掩盖 — turns ~700ms 完成，SSE 连接时通常已全部完成
  - **Sprint 4.4（LM Studio）**: 暴露 — 30s+/turn，SSE 连接时 queue 远未完成，用户看到提前"已完成"
- **修复建议**: 在 `getMeetingStreamFromDb` 中增加参数 `reviewStatus`，当 status='running' 时：
  1. 回放已有 turns
  2. 启动 setInterval 每 2 秒查询 DB 新 terminal turns
  3. 发现新 turn → 推送 4 个事件
  4. 所有 turns terminal → meeting.completed + 关闭
  5. 120 秒无新 turn → meeting.error + 关闭
- **Gate 条件**: 建议在 Sprint 4.3C hardening 中修复，修复后方可进入 Sprint 4.4

---

## P2 可延后项

### P2-1: durationMs 硬编码为 3000

- **位置**: `reviews.gateway.ts:169`
- **合同**: Sprint 4.3A Section 3.2 — `durationMs: reviewTurn.completedAt - reviewTurn.startedAt`
- **实际**: `durationMs: 3000`（与 mock 路径一致）
- **影响**: 前端 MeetingPage 不消费 durationMs 字段（仅在 agent.turn.completed 中使用 roleCode）。功能无影响。
- **建议**: 实现真实 durationMs 计算。`validateMeetingStream` 已返回 `startedAt` 和 `completedAt`（line 211-212），gateway 可直接使用。

### P2-2: agent.turn.started 缺少 roleId

- **位置**: `reviews.gateway.ts:166`
- **mock 路径**: 包含 `roleId: role.roleId`（line 116）
- **DB 路径**: 未包含 roleId
- **影响**: 前端 MeetingPage line 34 使用 `data.roleId || data.roleCode || ''`，fallback 到 roleCode。功能无影响。
- **建议**: 在 enrichedTurns 中添加 roleId（从 agentRole 查询），保持与 mock 路径一致。

### P2-3: 全部 turn 失败时不发 meeting.error

- **位置**: `reviews.gateway.ts:158, 172`
- **现状**: `completedTurns` 过滤 `status === 'completed' && t.opinion`。如果所有 turn 失败，completedTurns 为空，事件序列为 meeting.started → heartbeat → meeting.completed(totalTurns=0)
- **影响**: 前端显示"已完成"但无评审意见，缺少错误提示。继承自 Sprint 4.3A P2-3。
- **建议**: 当 completedTurns.length === 0 时，先发 meeting.error（code: 'ALL_TURNS_FAILED'），再发 meeting.completed。

### P2-4: 未新增专用 SSE smoke 测试脚本

- **影响**: DB SSE 验证依赖手工原始输出检查，无可重复运行的自动化测试
- **建议**: 新增 `scripts/smoke-sse.js`，覆盖 DB replay + mock fallback 两条路径

---

## Sprint 4.3A P2 闭环追踪

| P2 编号 | 描述 | Sprint 4.3B 状态 |
|---------|------|-----------------|
| P2-1 | turnId 格式 UUID vs 复合字符串 | ✅ 关闭 — DB 路径使用 UUID，mock 路径使用复合字符串，前端均兼容 |
| P2-2 | delta 内容源 | ✅ 关闭 — DB 路径使用 `o.recommendation`，符合合同 |
| P2-4 | fallback 矩阵未覆盖全部 9 态 | ⚠️ 部分闭环 — assertReview 仅允许 running/completed，其他状态均被拒绝（包括 interrupted/summarizing） |
| P2-5 | DB replay 节奏 | ✅ 关闭 — 实现使用 400ms，与 mock 一致 |

---

## 是否建议进入 Sprint 4.4

**建议先做 Sprint 4.3C hardening，再进入 Sprint 4.4。**

理由：

P1-1（running + partial turns 轮询缺失）在 Sprint 4.4 接 LM Studio 时将直接暴露为用户可见的功能缺陷。mock queue 的 ~700ms 完成时间掩盖了此问题，但 30s+/turn 的真实 LLM 无法掩盖。

**建议 Sprint 4.3C 范围**：

1. 实现 running + partial turns 轮询等待（Sprint 4.3A Section 5）
2. 修复 durationMs 从 DB 计算（P2-1）
3. 添加 roleId 到 agent.turn.started（P2-2）
4. 全部失败时发 meeting.error（P2-3）
5. 新增 smoke-sse.js 自动化测试（P2-4）

**Sprint 4.3C Gate 通过后，进入 Sprint 4.4 — LM Studio Guarded Integration。**
