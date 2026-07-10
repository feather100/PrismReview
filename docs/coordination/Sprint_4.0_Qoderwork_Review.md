# Sprint 4.0 Runner/Queue Scope Proposal — 独立复审报告

> 审查方：QoderWork（独立于 reasonix）  
> 审查日期：2026-07-09  
> 审查模式：只读审查，未修改任何代码或文档  
> 审查对象：方案文档，非代码

---

## Gate 结论：Go（附 P1 条件项）

Sprint 4.0 方案文档完整描述了从独立脚本 runner 演进到 BullMQ Queue Worker 的架构路径，严格遵守了"startReview 不阻塞"的核心原则，保留了 provider guard，分阶段计划清晰可执行。文档覆盖了 retry/timeout/partial failure/idempotency 等关键可靠性场景，schema 评估结论合理。但存在 1 项 P1 需要在 Sprint 4.1 合同文档中补充说明（meeting.complete 的协调机制），否则 Sprint 4.2 实现时可能出现歧义。建议进入 Sprint 4.1，P1 在 4.1 中闭环后再进入 4.2。

---

## 1. 复审重点逐项验证

### 1.1 是否保持 startReview < 1s

**文档声明**（Section 4）：

```
POST /reviews/{id}/start

1. 校验 roleSelection 存在
2. 校验 status = ready
3. 修改 status = running
4. 读取 roleIds → 为每个角色 enqueue agent.turn.execute job
5. 立即返回 { sessionId, status: 'running' }

总耗时 < 50ms（无 provider 调用，无 DB 写入）
```

**评估**：

| 步骤 | 耗时预估 | 评估 |
|------|----------|------|
| 校验 roleSelection | ~1ms（Prisma findFirst） | ✅ |
| 校验 status | ~1ms（同上查询） | ✅ |
| 修改 status = running | ~2ms（Prisma update） | ✅ |
| 读取 roleIds | ~1ms（已在 roleSelection 中） | ✅ |
| enqueue N jobs | ~5-10ms（BullMQ addBulk 到 Redis） | ✅ |
| **总计** | **~10-15ms** | ✅ **远低于 1s** |

**红线声明**（Section 4）：
- ✅ 不执行 provider
- ✅ 不写 review_turns（job 执行时写）
- ✅ 不直接调用 LLM
- ✅ 不阻塞 HTTP 响应

**结论：✅ 设计合理，startReview < 1s 可保证。**

---

### 1.2 是否禁止 HTTP 请求内执行 provider/LLM

**文档声明**（Section 1.3）：

```
LM Studio 单次调用 30s+，3 个角色串行约 90s+。阻塞在 HTTP 请求内会导致：
- 前端白屏 90s+
- 网关超时（通常 30s）
- 浏览器放弃请求

此原则不可妥协。
```

**架构保证**（Section 2 方案 C）：

```
POST /start → 立即返回 + enqueue N jobs
                   ↓
              BullMQ Queue (Redis)
                   ↓
              Worker 进程消费 job
                   ↓
              调用 provider → 写 DB
```

Provider 执行发生在 Worker 进程，与 API 进程分离。HTTP 请求仅负责 enqueue，不等待 job 完成。

**红线汇总**（Section 7）：6 个 Sprint 阶段均声明"不调真实 LLM（除非显式授权）"。

**结论：✅ 架构层面彻底隔离 HTTP 请求与 provider 执行。**

---

### 1.3 是否保留 provider guard

**文档声明**（Section 5）：

```
getProvider()
  → MODEL_PROVIDER 未设置 / "mock" → mock（默认，零依赖）
  → MODEL_PROVIDER=lmstudio + ALLOW_EXTERNAL_MODEL_CALLS=true → lmstudio
  → MODEL_PROVIDER=lmstudio + allow 不是 true → 抛 GUARD 错误
  → 其他值 → 抛 Unsupported provider error
```

**继承机制**：

```
Queue Worker 使用相同的 getProvider()，因此 guard 自动生效。
Worker 进程与 API 进程共享环境变量，没有额外配置。
```

**与 Sprint 1.9 对齐**（Sprint 1.9 Section 3.2）：

| provider | guard 检查 | Sprint 4.0 一致 |
|---|---|---|
| mock | 不需要 | ✅ |
| lmstudio | MODEL_PROVIDER=lmstudio + ALLOW_EXTERNAL_MODEL_CALLS=true | ✅ |
| openai (未来) | ALLOW_EXTERNAL_MODEL_CALLS=true + API key 存在 | ✅ |

**结论：✅ guard 机制完整继承，Worker 自动受保护。**

---

### 1.4 Queue 方案是否考虑 retry/timeout/partial failure/idempotency

#### 1.4.1 Retry 策略

**文档声明**（Section 3.3）：

| 参数 | 值 | 评估 |
|------|-----|------|
| max retries | 3 次 | ✅ 合理，避免无限重试 |
| backoff | 指数退避（2s, 4s, 8s） | ✅ 避免雪崩 |
| 超时 | 120s | ✅ 与现有 TIMEOUT_MS 一致 |

#### 1.4.2 Timeout 策略

**文档声明**（Section 3.4）：

```
- 单次 provider 调用超时: 120s
- 超时后 review_turn.status = timeout，标记失败，继续下一个 job
- 不阻塞其他 job
```

**与 Sprint 1.9 对齐**（Section 3.3）：

| 场景 | Sprint 1.9 | Sprint 4.0 | 一致 |
|---|---|---|---|
| Provider 超时 120s | turn.timeout | turn.timeout | ✅ |
| HTTP 错误 | turn.failed | turn.failed | ✅ |
| JSON 解析失败 | turn.failed | turn.failed | ✅ |
| 字段缺失 | turn.failed | turn.failed | ✅ |

#### 1.4.3 Partial Failure 策略

**文档声明**（Section 3.5）：

```
N 个 job 中 M 个成功：
- review.status = completed（只要 > 0 个成功）
- review_opinions 只写入成功 turn
- Report 标注 incompleteAgents
- 全部失败：review.status = failed
```

**与 Sprint 1.9 对齐**（Section 5.3）：

```
5 个 role 中 2 个 failed → report 包含 3 个 opinion
→ status: completed (partial)
→ report 标注缺失 Agent
```

**评估**：策略一致，但"只要 > 0 个成功"的阈值是否合理？

- 5 个角色中仅 1 个成功 → status=completed 但评审价值有限
- 建议：可在 Sprint 4.1 合同文档中讨论是否引入最低阈值（如 ≥ 50% 成功才算 completed，否则为 partial 或 failed）

**风险等级**：P2（可延后讨论）

#### 1.4.4 Idempotency（幂等性）

**文档声明**（Section 8.3 边界场景测试）：

```
Idempotency（重复 enqueue）→ Queue 层面由 jobId 去重
```

**Sprint 1.9 幂等设计**（Section 4.2）：

```javascript
// 查该 review 是否已有 completed/failed 的 turn
const existingTurns = await prisma.reviewTurn.findMany({ where: { reviewId } });
if (!force && existingTurns.some(t => t.status === 'completed')) {
  console.log(`Review ${reviewId} already has completed turns. Use --force to re-run.`);
  return;
}
```

**评估**：Sprint 4.0 的幂等策略描述较简略（仅"jobId 去重"），Sprint 1.9 的独立脚本有更详细的 DB 层幂等检查。Queue Worker 是否也需要类似的 DB 层幂等检查（防止 job 重复执行时重复写入 review_turns）？

**风险等级**：P2（可在 Sprint 4.1 中补充说明）

**结论：✅ retry/timeout/partial failure 设计完整，idempotency 基本覆盖但可补充细节。**

---

### 1.5 是否说明 schema 是否足够

**文档声明**（Section 6）：

| 需求 | 当前 | 足够？ |
|---|---|---|
| review_turns 存储 job 状态 | ✅ 已有 status/startedAt/completedAt | ✅ |
| review_opinions 存储 AgentTurnResult | ✅ 已有全部字段 | ✅ |
| job 持久化 | BullMQ 使用 Redis | ✅ 已有 Redis |
| job 状态追溯 | Queue 自带 | ✅ |
| 新增 jobs 表？ | ❌ 不需要 | BullMQ 管理 job 生命周期 |

**结论**：

```
当前 14 张表 + Redis 足够，无需新增表。
```

**与 Sprint 1.9 对齐**（Section 1.1-1.2）：

- ReviewTurn 字段映射完整 ✅
- ReviewOpinion 字段映射完整 ✅
- rawText 存储与脱敏策略已定义 ✅

**结论：✅ schema 评估结论合理，无需变更。**

---

### 1.6 是否避免直接接前端或真实 LLM

**红线汇总**（Section 7）：

| Sprint | 不调真实 LLM | 不改前端 | LM Studio 受 guard 保护 |
|--------|-------------|----------|------------------------|
| 4.1 | ✅ | ✅ | ✅ |
| 4.2 | ✅ | ✅ | ✅ |
| 4.3 | ✅ | ✅ | ✅ |
| 4.4 | ✅（除非显式授权） | ✅ | ✅ |

**Sprint 4.4 说明**：

```
- 允许 Worker 使用 MODEL_PROVIDER=lmstudio
- 实证：LM Studio 30s+ 调用在 Worker 中正常
- LM Studio 仍受 guard 保护
- 不引入其他外部 provider
```

**结论：✅ 前端零变更，真实 LLM 仅在 Sprint 4.4 且受 guard 保护下允许。**

---

### 1.7 分阶段计划是否可执行

| Sprint | 阶段 | 交付 | 红线 | 可执行性 |
|--------|------|------|------|----------|
| 4.1 | 设计 | 本文档定稿 | 不写代码，不改 schema | ✅ 纯文档 |
| 4.2 | Mock Queue | turn-executor.service.ts + BullMQ + mock provider | 不调真实 LLM，startReview < 1s，不改 schema | ✅ 有明确边界 |
| 4.3 | SSE from DB | getMeetingStream 从 DB 读取 | 不改 schema，不阻塞 startReview，不引入 WebSocket | ✅ 依赖 4.2 完成 |
| 4.4 | LM Studio | Worker 使用 LM Studio | LM Studio 受 guard 保护，不引入其他 provider | ✅ 依赖 4.2+4.3 完成 |

**依赖链**：

```
4.1（设计）→ 4.2（Mock Queue）→ 4.3（SSE from DB）→ 4.4（LM Studio）
```

每个 Sprint 有明确的输入/输出文档和红线约束，可独立 Gate。

**结论：✅ 分阶段计划清晰，依赖链合理，可执行。**

---

### 1.8 是否存在过度设计或遗漏风险

#### 1.8.1 过度设计评估

| 设计点 | 评估 |
|--------|------|
| BullMQ 选型 | ✅ 与 NestJS 生态一致，@nestjs/bullmq 已有依赖声明 |
| Redis 复用 | ✅ 已有 Redis 基础设施 |
| 不新增 jobs 表 | ✅ BullMQ 自带 job 管理，避免冗余 |
| 分 4 个 Sprint | ✅ 渐进式，每个 Sprint 可独立验证 |

**无过度设计迹象。**

#### 1.8.2 遗漏风险识别

**P1 — meeting.complete 协调机制未指定**

Section 3.1 定义两种 job：

```
agent.turn.execute       { reviewId, roleId, roleCode, turnIndex, objective, provider? }
meeting.complete         { reviewId }
```

Section 3.6 描述流程：

```
所有 agent.turn.execute completed
                    ↓
           review_turns 全部 done
                    ↓
          meeting.complete job 执行
```

**问题**：文档未说明 meeting.complete 如何被触发。BullMQ 不会自动"等待所有 job 完成"，需要显式协调机制。

**可能的实现方式**（文档未指定）：

1. **BullMQ Flows**：parent-child job 关系，parent（meeting.complete）等待所有 children（agent.turn.execute）完成
2. **DB 计数器**：每个 agent.turn.execute 完成后检查该 review 的 review_turns 是否全部 done，若是则 enqueue meeting.complete
3. **轮询 job**：单独 job 定期检查 review_turns 状态

**风险**：实现方式不明确可能导致 Sprint 4.2 实现分歧或返工。

**建议**：在 Sprint 4.1 合同文档中显式指定协调机制（推荐方式 2：DB 计数器，与 Sprint 1.9 的幂等检查一致）。

---

**P2 — Worker 进程部署与运维**

文档未讨论：
- Worker 进程如何部署（与 API 同进程？独立进程？独立容器？）
- 进程监控与告警（job 失败率、队列积压）
- 并发限制（同时执行多少个 job？100 个 review 同时 start 会怎样？）

**风险等级**：P2（可在后续 Sprint 中逐步完善，不阻塞当前方案）

---

**P2 — Partial Failure 阈值**

Section 3.5："只要 > 0 个成功"即 status=completed。

**潜在问题**：5 个角色中仅 1 个成功，评审价值有限但仍标记为 completed。

**建议**：可在 Sprint 4.1 中讨论是否引入最低成功率（如 ≥ 50%），或引入 `partial` 状态。

**风险等级**：P2（产品层面决策，不阻塞技术方案）

**结论：✅ 无过度设计。P1 遗漏（meeting.complete 协调）需在 Sprint 4.1 补充。**

---

## 2. 与 Sprint 1.9 的一致性验证

Sprint 4.0 是 Sprint 1.9 的 Phase C 实现。关键对齐检查：

| 维度 | Sprint 1.9 | Sprint 4.0 | 一致 |
|------|-----------|-----------|------|
| startReview 不阻塞 | ✅ Phase B 已保证 | ✅ Phase C 继承 | ✅ |
| Provider guard | ✅ Section 3.2 | ✅ Section 5 | ✅ |
| ReviewTurn status 枚举 | queued/retrieving/thinking/speaking/completed/timeout/failed/skipped | queued/active/completed/failed | ⚠️ 见下 |
| Timeout 120s | ✅ Section 3.3 | ✅ Section 3.4 | ✅ |
| Partial failure 处理 | ✅ Section 5.3 | ✅ Section 3.5 | ✅ |
| 幂等策略 | ✅ Section 4.2 | ⚠️ 简略（jobId 去重） | ⚠️ 可补充 |
| SSE 数据来源 | Phase A mock, Phase B runner 写 DB, Phase C SSE 读 DB | ✅ Section 3.8 | ✅ |

**ReviewTurn status 差异**：

Sprint 1.9 定义了细粒度状态：`queued → retrieving → thinking → speaking → completed`

Sprint 4.0 Section 3.2 简化为：`queued → active → completed`

**评估**：Sprint 4.0 的简化可能是为了方案概述简洁。实际实现时是否需要保留细粒度状态（用于 SSE 进度展示）？

**风险等级**：P2（可在 Sprint 4.1 合同文档中明确）

---

## 3. 方案对比评估

Sprint 4.0 Section 2 对比了 3 种方案：

| 方案 | 复杂度 | startReview 阻塞 | 自动触发 | 崩溃恢复 | 实时性 | 生产可用 |
|------|--------|-----------------|----------|----------|--------|----------|
| A: 独立脚本（当前） | ⭐ | ✅ 否 | ❌ 手动 | ❌ | ❌ | ❌ |
| B: fire-and-forget | ⭐⭐ | ✅ 否 | ✅ | ❌ | ❌ | ❌ |
| C: Queue Worker（推荐） | ⭐⭐⭐ | ✅ 否 | ✅ | ✅ | ✅ | ✅ |

**评估**：

- 方案 A 已是现状（Phase B），Sprint 4.0 正确识别其局限性
- 方案 B 的进程管理风险（多请求场景混乱）评估准确
- 方案 C 的 BullMQ 选型与 NestJS 生态一致，复杂度可控

**结论：✅ 方案 C 推荐合理。**

---

## 4. 测试计划评估

Sprint 4.0 Section 8 定义了测试扩展：

| 测试类型 | 覆盖 | 评估 |
|----------|------|------|
| smoke-runtime 扩展 | Queue enqueue、worker 消费、SSE 读 DB、partial failure | ✅ 关键路径 |
| smoke-runner 演进 | 保留现有 11 个测试 + 新增 Queue 与 runner 并行验证 | ✅ 向后兼容 |
| 边界场景 | Bad JSON、Timeout、Partial failure、Retry、Idempotency、Guard | ✅ 完整 |

**结论：✅ 测试计划覆盖关键场景。**

---

## P0 阻塞项

**无。**

---

## P1 建议项

### P1-1: meeting.complete 协调机制未指定

- **位置**: `Sprint_4.0_Runner_Queue_Scope_Backend.md` Section 3.1, 3.6
- **现状**: 文档声明 meeting.complete 在"所有 turn 完成后触发"，但未说明触发机制
- **影响**: Sprint 4.2 实现时可能出现歧义，不同开发者可能选择不同协调方式
- **建议**: 在 Sprint 4.1 合同文档中显式指定。推荐方案：每个 agent.turn.execute job 完成后查询该 review 的 review_turns 表，若全部 status ∈ {completed, failed, timeout}，则 enqueue meeting.complete。这与 Sprint 1.9 的 DB 层幂等检查风格一致。
- **Gate 条件**: Sprint 4.1 合同文档须包含此机制说明，方可进入 Sprint 4.2。

---

## P2 可延后项

### P2-1: Worker 进程部署与运维未讨论

- **位置**: Sprint 4.0 全文
- **现状**: 未说明 Worker 进程如何部署、监控、限流
- **影响**: 生产部署时可能需要额外设计
- **建议**: 可在 Sprint 4.2 或后续 Sprint 中补充。当前阶段聚焦功能实现，运维可后置。

### P2-2: Partial Failure 阈值未定义

- **位置**: Section 3.5
- **现状**: "只要 > 0 个成功"即 status=completed
- **影响**: 极端情况下（5 个角色仅 1 个成功）评审价值有限但仍标记完成
- **建议**: 可在 Sprint 4.1 中讨论是否引入最低成功率或 partial 状态。产品层面决策。

### P2-3: ReviewTurn status 细粒度未继承

- **位置**: Section 3.2
- **现状**: Sprint 1.9 定义 retrieving/thinking/speaking 细粒度状态，Sprint 4.0 简化为 active
- **影响**: SSE 进度展示可能不够精细
- **建议**: 可在 Sprint 4.1 合同文档中明确是否保留细粒度状态。

### P2-4: Idempotency 细节可补充

- **位置**: Section 8.3
- **现状**: 仅提及"Queue 层面由 jobId 去重"
- **影响**: DB 层幂等（防止重复写入 review_turns）未明确
- **建议**: 可在 Sprint 4.1 中补充 DB 层幂等检查逻辑，与 Sprint 1.9 Section 4.2 对齐。

---

## 是否建议进入 Sprint 4.1

**建议进入。** Sprint 4.0 方案文档质量高，架构设计合理，与 Sprint 1.9 高度对齐，分阶段计划可执行。

**进入条件**：
- P1-1（meeting.complete 协调机制）须在 Sprint 4.1 合同文档中显式指定
- Sprint 4.1 合同文档须包含 P1-1 解决方案，方可进入 Sprint 4.2

**建议后续路径**：

```
Sprint 4.1（合同文档，含 P1-1 补充）
    ↓
Sprint 4.2（Mock Queue，startReview enqueue jobs）
    ↓
Sprint 4.3（SSE 从 DB 读取真实 turn/opinion）
    ↓
Sprint 4.4（LM Studio guarded integration）
```

---

## 涉及文档

| 文档 | 审查结论 |
|------|----------|
| `docs/coordination/Sprint_4.0_Runner_Queue_Scope_Backend.md` | ✅ 通过，附 P1 条件 |
| `docs/implementation/Sprint_1.9_Agent_Turn_Persistence_Design.md` | ✅ 对齐验证通过 |
| `docs/coordination/AGENT_COORDINATION_PROTOCOL.md` | ✅ 流程遵循 |
| `docs/coordination/ACTIVE_SPRINT.md` | ✅ Sprint 4.0 状态确认 |
