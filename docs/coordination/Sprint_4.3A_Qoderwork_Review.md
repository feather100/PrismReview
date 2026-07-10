# Sprint 4.3A Meeting SSE DB Turns Contract — 独立复审报告

> 审查方：QoderWork（独立于 reasonix）  
> 审查日期：2026-07-09  
> 审查模式：只读审查，未修改任何代码或文档  
> 审查对象：`docs/coordination/Sprint_4.3A_Meeting_SSE_DB_Turns_Contract.md`

---

## Gate 结论：Go（无 P0 / P1 阻塞项）

Sprint 4.3A 合同完整定义了 Meeting SSE 从 DB 读取 review_turns / review_opinions 的策略，同时保留 mock fallback 确保零白屏。事件映射覆盖 Sprint 1.3 全部 8 种事件类型，DB replay / running partial / completion 判断均有明确策略。经与前端 MeetingPage.tsx 和 useMeetingSSE.ts 交叉验证，现有前端代码无需修改即可消费 DB replay 事件。Sprint 4.3B 实现边界清晰可控。建议进入 Sprint 4.3B。

---

## 1. 是否保留 mock fallback

**结论：✅ 明确保留。**

Section 2.1 优先级策略：

```
1. 查询 review_turns + review_opinions
2. 如果有 DB turns → 从 DB 读取
3. 如果无 DB turns → 使用 mock fallback（现有行为）
4. 不允许空流 → 至少发一个 event
```

Section 7.1 条件矩阵中的 fallback 触发场景：

| 场景 | 行为 | 评估 |
|------|------|------|
| running + 无 DB turns | mock fallback | ✅ 覆盖 queue 尚未处理的窗口 |
| running + 异常（queue 未触发） | mock fallback | ✅ 兜底 |
| completed + 无 DB turns | mock fallback | ✅ 异常兜底 |

Section 2.2 明确声明"不允许因为 DB 空导致会议室白屏"。

**与 Sprint 4.2 实现的衔接**：Sprint 4.2 的 in-memory queue 处理 3 个 mock turn 约需 ~700ms。在这段窗口内，前端跳转 Meeting 页后 SSE 连接建立，此时 DB 尚无 turns → 走 mock fallback。待 queue 写入 turns 后，下次 SSE 连接将走 DB replay。设计合理。

---

## 2. DB turn/opinion 到 SSE event 映射是否完整

**结论：✅ 全部 8 种事件类型覆盖，payload 字段完整映射。**

逐事件对比 Sprint 1.3 合同与 Sprint 4.3A DB 映射：

| 事件类型 | Sprint 1.3 定义 | Sprint 4.3A DB 映射 | 一致 |
|----------|----------------|---------------------|------|
| `meeting.started` | status, totalAgents, totalTurnsPlanned | review.roleSelection.roles.length | ✅ |
| `heartbeat` | timestamp | 运行时生成 | ✅ |
| `agent.turn.started` | turnId, roleId, roleCode, roleName, turnIndex | review_turns + agent_roles JOIN | ⚠️ 见 P2-1 |
| `agent.message.delta` | turnId, roleCode, delta | reviewOpinion.recommendation | ⚠️ 见 P2-2 |
| `agent.message.completed` | turnId, roleCode, content, riskLevel, dimension, recommendation, confidenceScore | reviewOpinion 全字段 | ✅ |
| `agent.turn.completed` | turnId, roleCode, durationMs | reviewTurn.completedAt - startedAt | ✅ |
| `meeting.completed` | status, totalTurns | review.status + reviewTurns COUNT | ⚠️ 见 P2-3 |
| `meeting.error` | code, message | 异常情况 | ✅ |

**Event Envelope 格式**：Section 3.1 定义了 eventId / reviewId / sessionId / timestamp / sequence / payload 结构，与 Sprint 1.3 Section 2 的 `MeetingEventEnvelope` 完全一致。

**事件顺序**：DB replay 按 turnIndex ASC 排序，每个 turn 推送 started → delta → completed → turn.completed 四事件序列，与 Sprint 1.3 Section 4 的顺序一致。

---

## 3. 前端现有事件契约是否不破坏

**结论：✅ 前端代码无需修改即可消费 DB replay 事件。**

经与 `MeetingPage.tsx` 和 `useMeetingSSE.ts` 交叉验证：

### 3.1 useMeetingSSE 事件注册

```typescript
// useMeetingSSE.ts:68-77
const eventTypes = [
  'meeting.started', 'heartbeat', 'agent.turn.started',
  'agent.message.delta', 'agent.message.completed',
  'agent.turn.completed', 'meeting.completed', 'error'
];
```

Sprint 4.3A 合同产生的所有事件类型均在此列表中注册。✅

### 3.2 MeetingPage 事件处理兼容性

| 事件 | MeetingPage 消费字段 | Sprint 4.3A 提供 | 兼容 |
|------|---------------------|-----------------|------|
| `meeting.started` | （无 payload 字段消费） | — | ✅ |
| `agent.turn.started` | `roleCode`, `roleId`, `roleName`, `turnId` | 全部提供 | ✅ |
| `agent.message.delta` | `turnId`, `delta` | 全部提供 | ✅ |
| `agent.message.completed` | `turnId`, `content`, `riskLevel`, `dimension` | 全部提供 | ✅ |
| `agent.turn.completed` | `roleCode` | 提供 | ✅ |
| `meeting.completed` | （无 payload 字段消费） | — | ✅ |
| `error` | `message`（含 fallback） | 提供 | ✅ |

### 3.3 turnId 处理

MeetingPage 使用 `data.turnId` 作为 opaque 标识符，仅用于 `c.turnId === data.turnId` 匹配（line 51, 57）。不解析 turnId 格式。因此 Sprint 1.3 的 `${reviewId}-turn-${turnIndex}` 与 Sprint 4.3A 的 `reviewTurn.id`（UUID）均可正常工作。

### 3.4 meeting.completed 处理

MeetingPage (line 73-77):
```typescript
case 'meeting.completed':
  setMeetingStatus('completed');
  setAgents(prev => prev.map(a => ({ ...a, status: 'done' })));
  break;
```

**注意**：前端不读取 `payload.status` 字段，直接设置 `meetingStatus='completed'`。这意味着即使后端发送 `status: 'failed'`，前端仍显示"已完成"状态。见 P2-3。

### 3.5 SSE 连接关闭

useMeetingSSE (line 59-62):
```typescript
if (resolvedType === 'meeting.completed') {
  es.close();
  setConnectionStatus('completed');
}
```

收到 `meeting.completed` 后关闭连接。无论 payload.status 值如何，连接都会正确关闭。✅

**结论：前端代码 100% 兼容，无需任何修改。**

---

## 4. running partial turns 策略是否明确

**结论：✅ 策略完整且参数化。**

Section 5 定义了三层策略：

### 4.1 已有 turns 的回放

```
1. 立即回放已 completed 的 turns（同 §4.1 节奏：250ms/事件，1秒/轮）
```

### 4.2 轮询等待新 turns

| 条件 | 间隔 | 评估 |
|------|------|------|
| 有 completed turns | 每 2 秒轮询 | ✅ 及时响应 |
| 连续 2 次无新 turn | 退避至 5 秒 | ✅ 减少 DB 压力 |
| 连续 6 次无新 turn | 退避至 10 秒 + heartbeat | ✅ 深度退避 |

### 4.3 超时与心跳

| 参数 | 值 | 评估 |
|------|-----|------|
| 60 秒无新 turn | 开始发 heartbeat（每 5 秒） | ✅ 保持连接活跃 |
| 120 秒无新 turn | 发 meeting.error (timeout) | ✅ 避免永久挂起 |
| 300 秒总等待上限 | 自动关闭 SSE 连接 | ✅ 最终兜底 |

**评估**：轮询 + 退避 + 心跳 + 超时的组合策略完整，不会出现连接永远挂起的情况。

---

## 5. completed DB replay 是否不会卡住

**结论：✅ 有明确防卡住保障。**

### 5.1 正常路径（Section 4.1）

```
1. 查询所有 review_turns（ORDER BY turnIndex ASC）
2. 每个 turn JOIN review_opinion
3. 一次性生成所有事件
4. 每秒推送 1 个 turn 的 4 个事件（250ms/事件）
5. 全部推完后发 meeting.completed
6. 关闭连接
```

有限事件 + 固定节奏 = 有限时间完成。3 个 turn → 3 秒推完。✅

### 5.2 异常防护（Section 4.2）

```
不允许 completed review 永远 pending:
- review.status = completed 时，DB 一定有全部 turns
- 如果 DB 缺失部分 turns → 发 meeting.error + 关闭
- 不会挂起
```

### 5.3 failed review（Section 7.1）

```
failed + 有 turns → DB replay
failed + 无 turns → meeting.error
```

**评估**：无论正常还是异常路径，SSE 连接都有明确的终止条件（meeting.completed 或 meeting.error + 关闭），不会无限挂起。

---

## 6. draft/ready 是否仍禁止连接

**结论：✅ 明确禁止。**

Section 7.1 条件矩阵：

| review status | 行为 |
|---|---|
| `draft` | ❌ error: "review not running" |
| `ready` | ❌ error: "review not running" |

Section 7.2 Error 条件：

```
draft/ready → 400 (SSE event: error)
```

**与 Sprint 1.3 一致**：Sprint 1.3 前置条件表声明"Review status 不是 running → 400"。draft 和 ready 都不是 running，因此被拒绝。✅

**与前端的双重防护**：MeetingPage.tsx (line 108-119) 在前端层面也对 draft/ready 做了拦截，显示"该评审尚未开始"的 Alert 提示，不会发起 SSE 连接。

**注意**：fallback 矩阵仅显式列出 draft/ready，未覆盖全部 9 种状态。diagnosing / interrupted / summarizing / archived 未显式说明。见 P2-4。

---

## 7. 是否没有要求前端修改

**结论：✅ 合同明确要求前端零修改。**

Section 9 Sprint 4.3B 实现边界：

```
❌ 不改前端
```

Section 9 关键原则第 1 条：

```
1. 事件格式与 Sprint 1.3 完全一致，前端不需要改动
```

**验证**：经 Section 3 交叉验证（见本报告 Section 3），前端代码确实无需修改。事件类型、envelope 格式、payload 字段名均兼容。唯一差异（turnId 格式、delta 内容来源、meeting.completed status 扩展）均为前端不依赖的字段或值。

---

## 8. Sprint 4.3B 实现边界是否足够窄

**结论：✅ 边界清晰且最小化。**

Section 9 允许/禁止清单：

**允许**（仅后端 SSE 改造）：
- ✅ reviews.gateway.ts + reviews.service.ts 改造
- ✅ smoke-runtime / smoke-sse 新增 4-5 个测试
- ✅ 保留 mock fallback

**禁止**：
- ❌ 不接真实 LLM
- ❌ 不改前端
- ❌ 不改 schema
- ❌ 不引入 WebSocket
- ❌ 不接入 Worker/BullMQ
- ❌ 不修改 Provider Guard

**评估**：Sprint 4.3B 聚焦于 SSE gateway 层的 DB 读取改造，不涉及前端、schema、LLM、基础设施变更。是一个可独立 Gate 的最小实现单元。

---

## 与 Sprint 1.3 合同的偏差记录

以下是 Sprint 4.3A 相对于 Sprint 1.3 合同的有意偏差，均经评估为前端兼容：

| # | 维度 | Sprint 1.3 | Sprint 4.3A | 前端影响 |
|---|------|-----------|-------------|----------|
| P2-1 | turnId 格式 | `${reviewId}-turn-${turnIndex}` | `reviewTurn.id` (UUID) | 无（opaque 标识符） |
| P2-2 | delta 内容 | mock 完整内容 | `reviewOpinion.recommendation` | 无（前端直接拼接） |
| P2-3 | meeting.completed status | 仅 `'completed'` | `'completed' \| 'failed'` | 无（前端不读取此字段） |
| — | durationMs | 固定 3000 | `completedAt - startedAt` | 无（前端不消费此字段） |

---

## P0 阻塞项

**无。**

---

## P1 建议项

**无。**

---

## P2 可延后项

### P2-1: turnId 格式从复合字符串变为 UUID

- **位置**: Section 3.2 `agent.turn.started`
- **Sprint 1.3**: `turnId: ${reviewId}-turn-${turnIndex}`
- **Sprint 4.3A**: `turnId: reviewTurn.id`（Prisma UUID）
- **影响**: 前端将 turnId 作为 opaque 标识符使用（仅用于 `===` 匹配），不解析格式。功能无影响。
- **建议**: 在 Sprint 4.3B 实现时，mock fallback 路径保持使用现有 `${reviewId}-turn-${turnIndex}` 格式（与 Sprint 1.3 一致），DB replay 路径使用 UUID。两种格式前端均兼容。

### P2-2: agent.message.delta 内容来源变更

- **位置**: Section 3.2 `agent.message.delta`
- **Sprint 1.3**: delta 来自 MOCK_AGENT_CONTENT 的 `content` 字段（完整评审意见，~80 字）
- **Sprint 4.3A**: delta 来自 `reviewOpinion.recommendation`（改进建议，~30 字）
- **影响**: 前端对 delta 的拼接使用 `c.content + data.delta`（MeetingPage.tsx:51），仅做追加，不依赖长度或内容。后续 `agent.message.completed` 会用 `content` 字段覆盖。功能无影响。
- **建议**: Sprint 4.3B 实现时可考虑使用 `reviewOpinion.issue` 作为 delta 内容（更丰富），或保留 recommendation。这是内容质量选择，不影响技术正确性。

### P2-3: meeting.completed status 扩展为 'completed' | 'failed'

- **位置**: Section 3.2 `meeting.completed`
- **Sprint 1.3**: `status: 'completed'`（字面量类型）
- **Sprint 4.3A**: `status: review.status`（`'completed' | 'failed'`）
- **影响**: MeetingPage.tsx 收到 `meeting.completed` 后执行 `setMeetingStatus('completed')` 但不读取 `payload.status`。当所有 turn 失败时，用户看到"已完成"状态但实际评审失败，缺少错误指示。
- **当前风险**: 低 — Sprint 4.3B 使用 mock provider，所有 turn 总是成功。全部失败场景仅在 Sprint 4.4（真实 LLM）后可能出现。
- **建议**: Sprint 4.3B 实现时，当 `completedCount === 0`（全部失败），先发一个 `meeting.error` 事件（code: 'ALL_TURNS_FAILED', message: '所有评审角色执行失败'），再发 `meeting.completed`。这样前端能展示错误 banner。

### P2-4: Fallback 矩阵未覆盖全部 9 种 review 状态

- **位置**: Section 7.1
- **已覆盖**: draft / ready / running / completed / failed
- **未覆盖**: diagnosing / interrupted / summarizing / archived
- **影响**: 
  - `diagnosing` / `archived` → 应返回 error（非 running），与 draft/ready 一致
  - `interrupted` → 前端当前允许 SSE 连接（`isSSEEnabled` 包含 interrupted），合同未明确
  - `summarizing` → 前端当前允许 SSE 连接，合同未明确
- **建议**: 在 Sprint 4.3B 实现时明确：
  - diagnosing / archived → error（同 draft/ready）
  - interrupted → DB replay + polling（同 running）
  - summarizing → DB replay + polling（同 running）

### P2-5: DB replay 节奏与 mock SSE 节奏差异

- **位置**: Section 4.1
- **Sprint 1.3 mock**: 400ms/event，3 turns × 4 events + 3 overhead = 15 events → ~6 秒
- **Sprint 4.3A DB replay**: 250ms/event，1 秒/turn → 3 turns → ~3 秒
- **影响**: DB replay 比 mock 快约 2 倍。前端不依赖特定事件间隔，仅按到达顺序渲染。功能无影响。
- **建议**: Sprint 4.3B 实现时可根据实际体验调整间隔。当前 250ms 合理。

---

## Sprint 4.2 P2 闭环追踪

| P2 编号 | 描述 | Sprint 4.3A 状态 |
|---------|------|-----------------|
| P2-3 | ReviewTurn 细粒度状态 (retrieving/speaking) | 未闭环 — Sprint 4.3A 合同中 ReviewTurn 状态流转为 queued→thinking→completed，未引入 retrieving/speaking。可在 Sprint 4.3B 或后续 Sprint 中补充。 |

---

## 是否建议进入 Sprint 4.3B

**建议进入。** Sprint 4.3A 合同文档质量高，完整定义了 SSE DB turns 的读取策略：

1. mock fallback 明确保留，零白屏保障 ✅
2. 全部 8 种事件类型完整映射到 DB 字段 ✅
3. 经前端代码交叉验证，前端零修改 ✅
4. running partial turns 策略有轮询 + 退避 + 心跳 + 超时四层保障 ✅
5. completed DB replay 有防卡住机制（异常时发 error + 关闭） ✅
6. draft/ready 禁止连接与 Sprint 1.3 一致 ✅
7. Sprint 4.3B 实现边界足够窄（仅 gateway + service 改造） ✅

Sprint 4.3B 可依据 Section 9 的允许/禁止清单开工，合同足以支撑实现和测试。
