# Sprint 4.1 Queue Contract Document — 独立复审报告

> 审查方：QoderWork（独立于 reasonix）  
> 审查日期：2026-07-09  
> 审查模式：只读审查，未修改任何代码或文档  
> 审查对象：`docs/coordination/Sprint_4.1_Queue_Contract_Backend.md`

---

## Gate 结论：Go（无 P0 / P1 阻塞项）

Sprint 4.1 Queue Contract 文档将 Sprint 4.0 的方案概述细化到了可直接实现的程度。Sprint 4.0 复审中的 P1-1（meeting.complete 协调机制）已在 Section 3 完整闭环，包含触发机制、三重幂等防护、竞态条件处理和伪代码。三种 job 类型（review.start / agent.turn.execute / meeting.complete）的 payload、preconditions、side effects、idempotency key 均定义清晰，足以支撑 Sprint 4.2 的实现。经与 Prisma schema 交叉验证，"不改 schema"的红线可兑现。建议进入 Sprint 4.2。

---

## 1. meeting.complete 协调机制是否明确

**结论：✅ 明确。Sprint 4.0 P1-1 已闭环。**

### 1.1 expectedTurnCount 来源

Section 3.3 显式声明：

```
review.roleSelection.roles.length
```

并注明"不是 COUNT(review_turns)"，将 roleSelection 定义为"应该执行的 turn 数量"的单一真相来源。

**评估**：来源明确，且选择正确。roleSelection 在 startReview 前已确定，不会被后续流程修改。

### 1.2 terminal 状态判断

Section 3.1 步骤 3 和 Section 3.2 伪代码均显式列出：

```typescript
status: { in: ['completed', 'failed', 'timeout'] }
```

**评估**：与 Sprint 1.9 Section 1.3 定义的状态机一致（completed/timeout/failed 为 terminal；queued/retrieving/thinking/speaking 为非 terminal）。skipped 未列入 terminal，但 skipped 在 Sprint 4.2 范围内不会触发（无用户跳过机制），不影响正确性。

### 1.3 防重复 enqueue

Section 3.2 定义三重防护：

| 层 | 机制 | 评估 |
|---|---|---|
| DB 层 | meeting.complete job 体内检查 review_turns 是否全部 terminal | ✅ 双重验证 |
| Queue 层 | BullMQ jobId `meeting.complete.${reviewId}` 唯一性 | ✅ 去重 |
| 语义层 | 幂等执行：review.status 已是非 running → skip | ✅ 结果一致 |

Section 3.4 竞态条件处理：两个 turn 同时完成 → 同时看到 terminalCount === expectedCount → 同时 enqueue → BullMQ jobId 唯一 → 第二个返回已存在 job → 即使罕见地双写，语义层兜底。

**评估**：竞态分析完整，三层防护互为兜底，无遗漏风险。

---

## 2. startReview 是否仍保持 <1s 且不执行 provider

**结论：✅ 保持。**

Section 4 定义了 startReview 的 6 步流程：

```
1. 校验 review.status === 'ready'          (~1ms, Prisma findFirst)
2. 校验 review.roleSelection 存在且非空    (内存判断)
3. review.status = 'running'               (~2ms, Prisma update)
4. 读取 roleSelection.roles → 构建角色列表  (内存操作)
5. enqueue review.start job                (~5ms, BullMQ add to Redis)
6. 返回 { sessionId, status: 'running' }   (立即响应)
```

红线声明与验证：

| 红线 | 验证 |
|------|------|
| 不执行任何 provider | ✅ 流程中无 provider.run() 调用 |
| 不写 review_turns | ✅ 由 agent.turn.execute job 体内写 |
| 不直接调用 LLM | ✅ 无 LLM 调用 |
| HTTP 响应 < 50ms | ✅ 仅含 1 次 DB update + 1 次 Redis enqueue |

**设计亮点**：Sprint 4.1 引入 `review.start` 中间编排 job（Sprint 4.0 中 startReview 直接 enqueue N 个 turn job），使 startReview 只需 1 次 enqueue 操作，进一步降低响应延迟。turn 拆分逻辑移入 worker，解耦更彻底。

---

## 3. Job payload / preconditions / side effects / idempotency 是否足够实现

**结论：✅ 三种 job 合同均达到可实现级别。**

### 3.1 review.start (Section 1.1)

| 维度 | 评估 |
|------|------|
| Payload (`ReviewStartPayload`) | ✅ reviewId, sessionId, roles[], objective, tenantId — 足够构建 turn jobs |
| Preconditions | ✅ status=running + roleSelection 存在 + 队列无重复 key |
| Side effects | ✅ 仅 enqueue N 个 agent.turn.execute，不执行 provider |
| Idempotency | ✅ key = `review.start.${reviewId}`，BullMQ dedup |
| Failure | ✅ enqueue 失败 → retry 3 次；部分成功 → 整体 retry，子 job idempotency key 防重 |

### 3.2 agent.turn.execute (Section 1.2)

| 维度 | 评估 |
|------|------|
| Payload (`AgentTurnExecutePayload`) | ✅ reviewId, turnIndex, roleId, roleCode, roleVersionId, objective, tenantId — 足够执行 provider |
| Preconditions | ✅ DB 层幂等：已有 completed turn → 直接返回 |
| Side effects | ✅ 7 步流程链完整（创建 turn → 状态流转 → provider 调用 → 写 opinion → 检查 meeting.complete） |
| Idempotency | ✅ key = `agent.turn.execute.${reviewId}.${turnIndex}` — 同 review + turnIndex 只执行一次 |
| Failure | ✅ 4 种失败场景均有对应 status 和后续处理 |

### 3.3 meeting.complete (Section 1.3)

| 维度 | 评估 |
|------|------|
| Payload (`MeetingCompletePayload`) | ⚠️ 见 P2-1 |
| Preconditions | ✅ 所有 turn 均为 terminal + 由最后一个 terminal turn 触发 + DB 二次验证 |
| Side effects | ✅ 计算最终 status + 更新 review.status |
| Idempotency | ✅ key = `meeting.complete.${reviewId}` |
| Failure | ✅ 自身失败 → retry 3 次，仍失败则 review.status 维持 running + 人工介入 |

---

## 4. partial failure / retry / timeout 是否有合同

**结论：✅ 均有合同。**

### 4.1 Retry（Section 5.2）

| Job | Max retries | Backoff | Timeout |
|-----|-------------|---------|---------|
| review.start | 3 | exponential 2s→4s→8s | 30s |
| agent.turn.execute | 3 | exponential 2s→4s→8s | 120s |
| meeting.complete | 3 | exponential 2s→4s→8s | 10s |

**评估**：参数合理。agent.turn.execute 的 120s timeout 与 Sprint 1.9 的 TIMEOUT_MS 一致，与 LM Studio 单次调用 30s+ 的现实匹配。

### 4.2 Timeout（Section 1.2, 3.4）

- Provider 超时 120s → `ReviewTurn.status = timeout` → 继续下一个 job
- 不阻塞其他 turn

**评估**：与 Sprint 1.9 Section 3.3 对齐。

### 4.3 Partial Failure（Section 1.3）

| 条件 | review.status | 备注 |
|---|---|---|
| 全部 completed | `completed` | 理想情况 |
| >= 50% completed | `completed` | partial，report 标注 incompleteAgents |
| < 50% completed (> 0) | `completed` | 严重不完整，report 标注 |
| 0 completed | `failed` | 完全失败 |

**评估**：阈值策略明确。"任何 > 0 成功即 completed"是一个产品决策，文档忠实记录。测试用例（Section 7.1 第 41-42 条）覆盖了 partial 和 all-fail 场景。

### 4.4 Idempotency

- review.start: `review.start.${reviewId}` + BullMQ dedup
- agent.turn.execute: `agent.turn.execute.${reviewId}.${turnIndex}` + DB 层检查
- meeting.complete: 三重防护（见 Section 1.3）

**评估**：每种 job 均有 queue 层 + DB 层双重幂等保障。

---

## 5. Provider guard 是否没有被绕过

**结论：✅ 未被绕过。**

Section 6 明确声明 Worker 使用与 API 相同的 `getProvider()`，共享环境变量。Guard 规则表与 Sprint 4.0 Section 5 和 Sprint 1.9 Section 3.2 完全一致。

关键约束：
- Worker 不得绕过 guard ✅
- Worker 进程与 API 进程共享环境变量 ✅
- 新增 provider 只需修改 provider-adapter.js + guard ✅

Sprint 4.2 范围内只使用 mock provider（Section 8 红线），LM Studio 仅在 Sprint 4.4 引入且受 guard 保护。

---

## 6. Sprint 4.2 实现边界是否足够窄

**结论：✅ 边界清晰且足够窄。**

Section 8 显式列出允许/禁止清单：

**允许**（均为 mock queue 基础设施）：
- BullMQ + Redis mock queue
- mock provider
- startReview enqueue review.start
- review.start 拆分 turn jobs
- 写 ReviewTurn / ReviewOpinion
- meeting.complete 幂等
- smoke-runtime 扩展

**禁止**：
- ❌ LM Studio / 真实 LLM
- ❌ 前端/UI 变更
- ❌ Schema 变更
- ❌ SSE from DB（Sprint 4.3）

**评估**：Sprint 4.2 聚焦于 Queue 基础设施验证，所有外部依赖（LLM、前端、SSE）均推迟。这是一个可独立 Gate 的最小实现单元。

---

## 7. 是否存在需要 schema 但没说明的地方

**结论：✅ 无遗漏。经 Prisma schema 交叉验证确认。**

实际 Prisma schema（`apps/api/prisma/schema.prisma`）关键验证：

| 合同需求 | Schema 现状 | 足够 |
|---|---|---|
| ReviewTurn.status 支持 8 种细粒度值 | **`String @default("queued")`**（非 enum），注释已列出所有值含 `interrupted_pending` | ✅ |
| Review.status 支持 9 种状态 | **`String @default("draft")`**（非 enum），注释已列出全部 9 态 | ✅ |
| ReviewOpinion 字段完整 | 含 dimension/riskLevel/issue/recommendation/confidenceScore/citations/reasoningSummary/modelOutputRef/feedback | ✅ |
| Review.roleSelection JSON | `Json?` 类型，支持 roles 数组 | ✅ |
| BullMQ job 持久化 | Redis（已有依赖声明） | ✅ |
| 不需要新增表 | BullMQ 管理 job 生命周期 | ✅ |

**关键发现**：ReviewTurn.status 是 `String` 类型而非 Prisma enum，因此所有细粒度状态值（queued / retrieving / thinking / speaking / completed / timeout / failed / skipped）无需 schema 迁移即可使用。"不改 schema"的红线可以兑现。

Section 9 也明确说明 Sprint 4.0 简化的 `queued → active → completed` 仅用于方案概述，实现时恢复细粒度。这与 schema 现状一致。

---

## P0 阻塞项

**无。**

---

## P1 建议项

**无。** Sprint 4.0 复审中的 P1-1（meeting.complete 协调机制）已在本文档 Section 3 完整闭环。

---

## P2 可延后项

### P2-1: meeting.complete payload 的 counts 字段可能过时

- **位置**: Section 1.3 `MeetingCompletePayload`
- **现状**: payload 包含 `completedCount`、`failedCount`、`timedOutCount`，在 `onTurnComplete` 时计算
- **风险**: meeting.complete job 如果 retry，payload 中的 counts 是 enqueue 时刻的快照，非执行时刻的真实值
- **建议**: 在合同中明确 meeting.complete job 体内应从 DB 重新计算 counts（Section 1.3 side effect 第 1 步"根据 success/failure 比例计算最终 status"已隐含此意，但应更显式地声明"忽略 payload 中的 counts，从 DB 读取"）

### P2-2: ReviewTurn.status 注释含 `interrupted_pending` 但合同未涉及

- **位置**: `schema.prisma:182` 注释列出 `interrupted_pending`
- **现状**: Sprint 4.1 合同未提及此状态
- **风险**: 低 — Sprint 4.2 范围内不实现中断/恢复功能
- **建议**: 在合同中标注 `interrupted_pending` 为 future（Sprint 4.x 中断恢复特性时使用）

### P2-3: review.start 引入额外编排层级

- **位置**: Section 1.1
- **现状**: Sprint 4.0 方案中 startReview 直接 enqueue N 个 turn job；Sprint 4.1 改为 startReview → review.start → N 个 turn jobs
- **影响**: 增加一层间接，turn 启动延迟增加（Worker 须先拾取 review.start job）
- **评估**: 这是合理的设计选择（startReview 更轻量，编排逻辑内聚到 worker），但值得在合同中记录此 trade-off

### P2-4: Worker 部署与运维未讨论

- **位置**: 全文
- **现状**: 未说明 Worker 进程如何部署（同进程 / 独立进程 / 独立容器）、监控告警、并发限制调优
- **建议**: 可在 Sprint 4.2 实现时补充，不阻塞合同审查

---

## Sprint 4.0 P1 闭环确认

| P 编号 | 描述 | Sprint 4.1 处理 | 状态 |
|--------|------|----------------|------|
| P1-1 | meeting.complete 协调机制未指定 | Section 3 完整闭环：DB 计数器方案 + 三重幂等防护 + 竞态分析 + 伪代码 | ✅ 关闭 |

---

## Sprint 1.9 对齐验证

| 维度 | Sprint 1.9 | Sprint 4.1 | 一致 |
|------|-----------|-----------|------|
| ReviewTurn status 枚举 | queued/retrieving/thinking/speaking/completed/timeout/failed/skipped | 同上（Section 9 明确恢复细粒度） | ✅ |
| ReviewOpinion 字段映射 | 完整映射表 | 继承（Section 6 确认 schema 足够） | ✅ |
| Provider guard | 4 种行为 | 同上（Section 6） | ✅ |
| Timeout 120s | Section 3.3 | Section 5.2 | ✅ |
| rawText 脱敏 | Section 1.4 | Sprint 4.2 不涉及（mock provider） | ✅ |
| startReview 不阻塞 | Section 2.1 | Section 4 | ✅ |

---

## 是否建议进入 Sprint 4.2

**建议进入。**

Sprint 4.1 合同文档质量高，将 Sprint 4.0 的方案概述细化到了可直接编码的级别：

1. 三种 job 类型的 payload / preconditions / side effects / idempotency 完整定义
2. meeting.complete 协调机制闭环（触发条件 + 三重幂等 + 竞态处理 + 伪代码）
3. startReview 合同保持 < 50ms 响应，红线清晰
4. Retry / timeout / partial failure 均有参数化合同
5. Provider guard 继承链完整
6. Schema 兼容性经实际 Prisma 文件验证通过
7. Sprint 4.2 实现边界足够窄（仅 mock queue + mock provider）

Sprint 4.2 可依据 Section 8 的允许/禁止清单开工，合同足以支撑实现和测试。
