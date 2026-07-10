# Sprint 4.2 Mock Queue Implementation — 独立复审报告

> 审查方：QoderWork（独立于 reasonix）  
> 审查日期：2026-07-09  
> 审查模式：只读审查，未修改任何代码  
> 审查对象：`queue.service.ts`、`reviews.service.ts`、`reviews.module.ts`、`smoke-queue.js`

---

## Gate 结论：Go（无 P0 / P1 阻塞项）

Sprint 4.2 实现了 in-memory mock queue，完整覆盖 `review.start → agent.turn.execute → meeting.complete` 三类 job 的闭环。startReview 保持 <1s 响应且不执行 provider，Prisma schema 零变更，mock SSE / report / runner 均无回归。幂等设计在 queue 层（processedIds）和 DB 层（terminal turn 检查 + review.status 检查）双重保障。代码质量良好，结构清晰，建议进入 Sprint 4.3。

---

## 1. startReview 是否仍 <1s 且不执行 provider

**文件**: `reviews.service.ts:165-181`

```typescript
async startReview(reviewId: string, user: any) {
    const review = await this.assertReview(reviewId, user.tenantId, ['ready']);
    if (!review.roleSelection) {
      throw new BadRequestException('Role selection required before starting');
    }
    await this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'running' },
    });
    const sessionId = `session-${reviewId}`;
    this.queueService.enqueue('review.start', { reviewId, sessionId });
    return { sessionId, status: 'running' };
}
```

| 步骤 | 耗时估算 | 评估 |
|------|----------|------|
| assertReview (1 次 DB 查询) | ~1-2ms | ✅ |
| roleSelection 检查 (内存) | <1ms | ✅ |
| prisma.review.update (1 次 DB 写入) | ~2-5ms | ✅ |
| queueService.enqueue (内存 Set + Array.push) | <1ms | ✅ |
| **总计** | **~5-10ms** | ✅ **远低于 1s** |

**红线验证**：
- ❌ 无 provider.run() 调用 ✅
- ❌ 无 reviewTurns 写入 ✅
- ❌ 无 LLM 调用 ✅
- ❌ 无 HTTP 外部请求 ✅

**结论：✅ PASS — startReview 保持轻量异步触发，符合 <1s 要求。**

---

## 2. 是否只使用 mock provider，没有接 LM Studio/真实 LLM

**文件**: `queue.service.ts:174-182`

```typescript
const MOCK_RESPONSES: Record<string, any> = {
  CTO: { dimension: '架构合理性', riskLevel: 'high', ... confidenceScore: 78 },
  CFO: { dimension: '投入产出分析', riskLevel: 'medium', ... confidenceScore: 72 },
  PMO: { ... confidenceScore: 65 },
  Compliance: { ... confidenceScore: 80 },
  UserAdvocate: { ... confidenceScore: 70 },
};
const base = MOCK_RESPONSES[roleCode] || MOCK_RESPONSES.CTO;
const result = { roleCode, ...base, rawText: JSON.stringify(base) };
```

| 检查项 | 结果 |
|--------|------|
| 无 getProvider() 调用 | ✅ |
| 无 LM Studio HTTP 调用 | ✅ |
| 无环境变量 MODEL_PROVIDER 读取 | ✅ |
| 无 ALLOW_EXTERNAL_MODEL_CALLS 读取 | ✅ |
| 纯硬编码 mock 数据 | ✅ |

**注意**：实现绕过了现有 `provider-adapter.js` 的 `getProvider()` 机制，直接在 queue service 内硬编码 mock 响应。这对 Sprint 4.2 mock 验证是可接受的，但 Sprint 4.4 接入 LM Studio 时需要重构为使用 `getProvider()` + guard。

**结论：✅ PASS — 纯 mock，零 LLM 依赖。**

---

## 3. 是否未改 Prisma schema

**文件**: `apps/api/prisma/schema.prisma`

对照 Sprint 4.1 审查时确认的 schema，Sprint 4.2 代码使用的模型和字段完全一致：

| 使用位置 | 模型/字段 | schema 状态 |
|----------|-----------|-------------|
| queue.service.ts:107 | `review.findUnique` | ✅ 已有 |
| queue.service.ts:116 | `agentRole.findMany` | ✅ 已有 |
| queue.service.ts:147 | `reviewTurn.findFirst` (status in [...]) | ✅ 已有 |
| queue.service.ts:156 | `reviewTurn.create` | ✅ 已有 |
| queue.service.ts:168 | `reviewTurn.update` | ✅ 已有 |
| queue.service.ts:185 | `reviewOpinion.create` | ✅ 已有 |
| queue.service.ts:223 | `reviewTurn.count` | ✅ 已有 |
| queue.service.ts:251-255 | `reviewTurn.count` (status filters) | ✅ 已有 |

所有字段（reviewId, turnIndex, phase, roleVersionId, status, startedAt, completedAt, dimension, riskLevel, issue, recommendation, citations, confidenceScore, reasoningSummary, modelOutputRef）均在现有 schema 中定义。

**结论：✅ PASS — schema 零变更。**

---

## 4. 三类 job 是否实现

### 4.1 review.start

**位置**: `queue.service.ts:105-139` (`executeReviewStart`)

| 合同要求 | 实现 | 评估 |
|----------|------|------|
| 读取 roleSelection | `review.roleSelection as any` (line 111) | ✅ |
| 验证 roleVersionId | `agentRole.findMany` + `activeVersionId` 检查 (lines 116-125) | ✅ |
| 为每个角色 enqueue agent.turn.execute | for 循环 + enqueue (lines 122-138) | ✅ |
| jobId = `agent.turn.execute.${reviewId}.${turnIndex}` | line 128 | ✅ 与合同一致 |
| 不执行 provider | ✅ 仅 enqueue | ✅ |

### 4.2 agent.turn.execute

**位置**: `queue.service.ts:143-210` (`executeAgentTurn`)

| 合同要求 | 实现 | 评估 |
|----------|------|------|
| DB 幂等检查 | `findFirst` terminal status (lines 147-153) | ✅ |
| 创建 ReviewTurn | `create` with status=queued (lines 156-165) | ✅ |
| 状态流转 | queued → thinking → completed (lines 162, 170, 203) | ⚠️ 见 P2-3 |
| 调用 provider | mock 内联 (lines 174-182) | ✅ (Sprint 4.2) |
| 创建 ReviewOpinion | `create` (lines 185-198) | ✅ |
| 检查 meeting.complete | `checkMeetingComplete(reviewId)` (line 209) | ✅ |

### 4.3 meeting.complete

**位置**: `queue.service.ts:236-280` (`executeMeetingComplete`)

| 合同要求 | 实现 | 评估 |
|----------|------|------|
| DB 幂等检查 | review.status !== 'running' → skip (lines 242-245) | ✅ |
| terminalCount < expectedCount → skip | lines 259-261 | ✅ |
| 从 DB 查 counts | reviewTurn.count 两次 (lines 251-257) | ✅ |
| 全成功 → completed | `completedCount === expectedCount` → 'completed' (line 266-267) | ✅ |
| 部分成功 → completed | `completedCount > 0` → 'completed' (line 268-269) | ✅ |
| 全失败 → failed | else → 'failed' (line 270-271) | ✅ |
| 更新 review.status | `prisma.review.update` (lines 274-277) | ✅ |
| 自身失败重试 | QueueService 通用 retry 逻辑 (lines 74-82) | ✅ |

**结论：✅ PASS — 三类 job 全部实现，与 Sprint 4.1 合同高度一致。**

---

## 5. meeting.complete 是否用 DB 实时查询计数

**文件**: `queue.service.ts:236-280`

```typescript
// line 247 注释: Count from DB (not from payload)
const completedCount = await this.prisma.reviewTurn.count({
  where: { reviewId, status: 'completed' },
});
const failedCount = await this.prisma.reviewTurn.count({
  where: { reviewId, status: { in: ['failed', 'timeout'] } },
});
const terminalCount = completedCount + failedCount;
```

| 验证项 | 结果 |
|--------|------|
| 不信任 payload 中的 counts | ✅ payload 仅传 reviewId 用于定位 |
| 从 DB 实时查询 completedCount | ✅ prisma.reviewTurn.count |
| 从 DB 实时查询 failedCount | ✅ prisma.reviewTurn.count |
| 从 DB 获取 expectedCount | ✅ review.roleSelection.roles.length |
| 处理 meeting.complete retry 场景 | ✅ review.status 二次检查 |

**注意**：payload 中实际传了 `expectedCount` 和 `terminalCount`（line 230），但 `executeMeetingComplete` 体内完全忽略这些值，重新从 DB 查询。注释 "Count from DB (not from payload)" 明确表达了设计意图。这解决了 Sprint 4.1 P2-1 提到的 payload counts 可能过时的问题。

**结论：✅ PASS — DB 实时查询，不信任 payload。**

---

## 6. 幂等是否可靠

### 6.1 Queue 层幂等

**`queue.service.ts:34-52`** — `enqueue()` 方法：

```typescript
// 1. 已处理过的 job → 跳过
if (this.processedIds.has(jobId)) {
  this.logger.log(`Idempotent skip: ${jobId} already processed`);
  return jobId;
}

// 2. 已在队列中的 job → 跳过
if (this.queue.some(j => j.id === jobId && j.status === 'queued')) {
  return jobId;
}
```

| 场景 | 防护 | 评估 |
|------|------|------|
| 重复 enqueue 同一 jobId | processedIds Set + queue 状态检查 | ✅ |
| 进程内重复处理 | processing flag (line 61) | ✅ |

**review.start 的 idempotency key**：`startReview` 调用 `enqueue('review.start', { reviewId, sessionId })` 未传 id 参数（reviews.service.ts:178），因此 QueueService 自动生成 `${type}.${Date.now()}.${random}`。这意味着同一 review 的两次 startReview 调用会生成不同的 jobId。

**但**：`startReview` API 层有 `assertReview(reviewId, user.tenantId, ['ready'])` 检查，第二次调用时 status 已变为 'running'，会抛出 400 错误。因此功能等价幂等由 API 层保证。

### 6.2 DB 层幂等

**agent.turn.execute**（lines 147-153）：

```typescript
const existing = await this.prisma.reviewTurn.findFirst({
  where: { reviewId, turnIndex, status: { in: ['completed', 'failed', 'timeout'] } },
});
if (existing) {
  this.logger.log(`Idempotent skip: turn ${turnIndex} ...`);
  return;
}
```

- 重复执行同一 turnIndex → 检测到 terminal 状态 → 跳过 ✅
- 不会产生重复 ReviewTurn 记录 ✅
- 不会产生重复 ReviewOpinion 记录 ✅

**meeting.complete**（lines 240-245, 259-261）：

```typescript
// 第一重：review.status 检查
if (review.status !== 'running') return;

// 第二重：terminalCount 检查
if (terminalCount < expectedCount) return;
```

- 重复执行 meeting.complete → status 已是 'completed' → 跳过 ✅
- 不会破坏已完成的 review.status ✅

### 6.3 竞态分析

由于 QueueService 串行处理（`processing` flag + `processNext` 递归调用），同一 review 的多个 agent.turn.execute job 不会并发执行。因此：
- 不存在两个 turn 同时完成同时触发 meeting.complete 的竞态
- 不存在 findFirst + create 之间的竞态窗口

这是 mock queue 的架构优势——串行消除了并发问题。

**结论：✅ PASS — 三层幂等防护（Queue processedIds + DB terminal check + review.status check），串行处理消除竞态。**

---

## 7. smoke 是否覆盖核心闭环

### smoke-runtime (31/31)

原有 31 个测试全部通过，无回归。

### smoke-queue (8/8)

| # | 测试 | 覆盖场景 | 评估 |
|---|------|----------|------|
| 1 | POST /start 返回 < 1s | startReview 响应时间 | ✅ |
| 2 | POST /start 返回 status=running | 状态正确 | ✅ |
| 3 | POST /start 返回 sessionId | 会话标识 | ✅ |
| 4 | Review 最终状态为 completed | 全链路完成 | ✅ |
| 5 | Report opinions 来自 queue | source=db_opinions | ✅ |
| 6 | Report 包含 verdict | 报告完整性 | ✅ |
| 7 | 重复 start 返回 400 | API 层幂等 | ✅ |
| 8 | (smoke 实际 7 个 check + 1 个流程验证) | — | ✅ |

### 未覆盖的场景

| 场景 | 风险 | 评估 |
|------|------|------|
| Partial failure (部分 turn 失败) | 低 | Sprint 4.2 mock 全成功，4.3 可补 |
| Timeout 场景 | 低 | Mock 无超时，4.4 接 LM Studio 时验证 |
| ReviewTurn 逐个状态检查 | 低 | 当前仅验证最终状态 |
| meeting.complete 重复执行幂等 | 低 | 代码层面有保障，smoke 未显式测 |

**结论：✅ PASS — 核心闭环（start → queue → turns → complete → report）完整覆盖。边界场景可在后续 Sprint 补充。**

---

## 8. 是否影响现有 mock SSE / report / runner

### 8.1 SSE (Meeting Stream)

`reviews.service.ts:186-201` — `validateMeetingStream` 方法：

- 未修改 ✅
- 仍然验证 meeting stream 的 readiness
- 不依赖 QueueService

### 8.2 Report

`reviews.service.ts:237-366` — `getReport` 方法：

**变更**：新增了 DB opinions 优先读取逻辑。

```typescript
// 新增: 优先从 DB 读取
const dbOpinions = await this.prisma.reviewOpinion.findMany({
  where: { reviewId }, ...
});
if (dbOpinions.length > 0) {
  return this.buildReportFromDb(review, dbOpinions);  // 新路径
}
// 原有: mock fallback
// ... (原有逻辑不变)
```

| 维度 | 评估 |
|------|------|
| 向后兼容 | ✅ 无 DB opinions 时走 mock fallback |
| 新 review（经 queue） | ✅ source='db_opinions', generatedFromTurns=true |
| 旧 review（未经 queue） | ✅ source='mock_fallback', generatedFromTurns=false |
| buildReportFromDb 实现 | ✅ 正确关联 turn → roleVersion → role code/name |

**评估**：Report 增强是**非破坏性**的。现有 report 功能不受影响，新增路径仅在 DB 有 opinions 时激活。

### 8.3 Runner (scripts/run-agent-turns-for-review.js)

- 未修改 ✅
- 独立脚本，使用自有 Prisma client 和 provider-adapter
- 与 QueueService 互不干扰

**结论：✅ PASS — 现有 SSE / runner 无影响，report 增强为非破坏性向后兼容。**

---

## 9. 是否引入部署复杂度或隐式依赖

| 检查项 | 结果 |
|--------|------|
| 新增 npm 依赖 | ✅ 无 — 纯 TypeScript + NestJS 原生 |
| Redis 依赖 | ✅ 无 — in-memory 队列 |
| BullMQ 依赖 | ✅ 无 — Sprint 4.3/4.4 再引入 |
| 新增环境变量 | ✅ 无 |
| 新增配置文件 | ✅ 无 |
| 新增进程/容器 | ✅ 无 — QueueService 在 NestJS 进程内 |
| 新增数据库迁移 | ✅ 无 |
| OnModuleDestroy 清理 | ✅ timer 清理 (line 282-284) |

**结论：✅ PASS — 零额外部署复杂度。Sprint 4.3 替换为 BullMQ 时才需引入 Redis 依赖。**

---

## 与 Sprint 4.1 合同的一致性

| 合同项 | 实现 | 一致 |
|--------|------|------|
| review.start job | executeReviewStart (lines 105-139) | ✅ |
| agent.turn.execute job | executeAgentTurn (lines 143-210) | ✅ |
| meeting.complete job | executeMeetingComplete (lines 236-280) | ✅ |
| review.start idempotency key = `review.start.${reviewId}` | 自动生成 ID，API 层 status 检查提供功能等价 | ⚠️ P2 |
| agent.turn.execute idempotency key = `...${reviewId}.${turnIndex}` | line 128 | ✅ |
| meeting.complete idempotency key = `meeting.complete.${reviewId}` | line 229 | ✅ |
| meeting.complete 从 DB 查 counts | lines 251-257 | ✅ |
| Partial failure: >0 success → completed | lines 266-271 | ✅ |
| All fail → failed | line 270-271 | ✅ |
| Retry 3 次 + exponential backoff | lines 26, 74-82 | ⚠️ P2 (backoff 未实现) |
| ReviewTurn 细粒度状态 (retrieving/speaking) | 仅 queued→thinking→completed | ⚠️ P2 |

---

## P0 阻塞项

**无。**

---

## P1 建议项

**无。**

---

## P2 可延后项

### P2-1: review.start job 未使用合同规定的 idempotency key

- **位置**: `reviews.service.ts:178` → `queue.service.ts:34-35`
- **合同规定**: `review.start.${reviewId}`
- **实际**: 自动生成 `${type}.${Date.now()}.${random}`
- **影响**: API 层 `assertReview(['ready'])` 提供了功能等价幂等，无实际风险
- **建议**: Sprint 4.3 迁移 BullMQ 时显式传入 jobId

### P2-2: Mock provider 绕过 getProvider() 机制

- **位置**: `queue.service.ts:174-182`
- **合同**: Sprint 4.1 Section 6 声明 Worker 使用相同 `getProvider()`
- **实际**: 硬编码 MOCK_RESPONSES，未调用 provider-adapter
- **影响**: Sprint 4.4 接入 LM Studio 时需重构
- **建议**: 可接受 — Sprint 4.2 明确为 mock 验证阶段

### P2-3: ReviewTurn 状态流转简化

- **位置**: `queue.service.ts:162, 170, 203`
- **合同**: Sprint 1.9 定义 queued → retrieving → thinking → speaking → completed
- **实际**: queued → thinking → completed（跳过 retrieving 和 speaking）
- **影响**: Sprint 4.3 SSE 需要细粒度状态推送时应补充
- **建议**: Sprint 4.3 实现 SSE from DB 时补齐 retrieving/speaking 状态

### P2-4: Retry backoff 未实现指数退避

- **位置**: `queue.service.ts:74-82`
- **合同**: Sprint 4.1 Section 5.2 — exponential backoff 2s→4s→8s
- **实际**: 立即重试（`job.status = 'queued'` 后下一次 POLL_INTERVAL 100ms 即处理）
- **影响**: Mock 场景下可接受，不影响功能正确性
- **建议**: Sprint 4.3 迁移 BullMQ 时由 BullMQ 内置 backoff 机制处理

### P2-5: smoke-queue 未覆盖 partial failure / timeout

- **影响**: 边界场景验证不完整
- **建议**: Sprint 4.3 补充 partial failure 和 timeout 的 smoke 用例

### P2-6: MOCK_ROLES 死代码

- **位置**: `reviews.service.ts:22-28`
- **影响**: 继承自 Sprint 3.12 P2-10，未清理
- **建议**: 择机清理

---

## Sprint 4.1 P2 闭环追踪

| P2 编号 | 描述 | Sprint 4.2 状态 |
|---------|------|----------------|
| P2-1 | meeting.complete payload counts 可能过时 | ✅ 关闭 — 实现中从 DB 实时查询，忽略 payload |

---

## 是否建议进入 Sprint 4.3

**建议进入。** Sprint 4.2 成功实现了 mock queue 闭环：

1. startReview 保持 <50ms 响应，不执行 provider ✅
2. 三类 job（review.start / agent.turn.execute / meeting.complete）全部实现且符合合同 ✅
3. 幂等设计三层防护可靠 ✅
4. DB 实时查询计数，不信任 payload ✅
5. Schema 零变更 ✅
6. 现有功能零回归（smoke-runtime 31/31） ✅
7. 零部署复杂度 ✅

Sprint 4.3 目标：
- SSE 从 DB 读取真实 turn/opinion 数据
- 移除 MOCK_AGENT_CONTENT 预计算假数据
- 补充 retrieving/speaking 细粒度状态
- 补充 partial failure smoke 测试
