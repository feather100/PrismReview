# Sprint 4.0 — Runner/Queue Scope Proposal

> 设计未来如何把独立 runner / agent turns / queue 安全接入 PrismReview 主链路。
> 只做方案设计，不写代码，不改 schema。

---

## 1. 当前状态回顾

### 1.1 现有 runner

- **`scripts/run-agent-turns-for-review.js`**：独立 CLI 脚本，不接入主链路
- 串行执行 `provider.run()`（默认 mock）
- 写入 `review_turns` + `review_opinions`
- 完成后设置 `review.status = completed`
- 幂等：第二次运行检测已有 completed turn → 跳过
- `--force`：清理后重跑

### 1.2 review_turns / review_opinions 当前写入

- **仅由 runner 脚本写入**，API 层从不写这两个表
- `POST /start` 只改 status → `running`
- `POST /diagnose` 只改 status + `diagnosis` JSON
- Meeting SSE 完全独立，不从 DB 读取

### 1.3 startReview 为何不能阻塞

```
POST /start → 立即返回 { status, sessionId }  < 1s
                  ↓
          前端跳转 Meeting 页 (静态/Mock SSE)
                  ↓
          用户看到会议室 UI，认为"已开始"
```

LM Studio 单次调用 30s+，3 个角色串行约 90s+。阻塞在 HTTP 请求内会导致：
- 前端白屏 90s+
- 网关超时（通常 30s）
- 浏览器放弃请求

**此原则不可妥协**。

### 1.4 Meeting SSE 为何仍是 mock

- 无 Worker/Queue 基础设施。真实 SSE 需要从 `review_turns` 和 `review_opinions` 读取数据并实时推送。
- 当前 runner 是离线脚本，与 SSE 流无关。

---

## 2. 推荐架构：方案对比

### 方案 A：保持独立脚本 runner（当前）

| 维度 | 评价 |
|---|---|
| 复杂度 | ⭐ 最低 |
| startReview 阻塞 | ✅ 否 |
| 自动触发 | ❌ 需手动运行脚本 |
| 崩溃恢复 | ❌ 手动重跑 |
| 实时性 | ❌ SSE 无法接真实数据 |
| 生产可用 | ❌ 否 |

### 方案 B：API fire-and-forget dev runner

```
POST /start → 立即返回 { running }
             ↓ 后台进程:
               spawn('node scripts/run-agent-turns...')
```

| 维度 | 评价 |
|---|---|
| 复杂度 | ⭐⭐ 低 |
| startReview 阻塞 | ✅ 否 |
| 自动触发 | ✅ startReview 后自动执行 |
| 崩溃恢复 | ❌ 进程 crash → 数据丢失 |
| 进程管理 | ❌ 多请求场景混乱 |
| 生产可用 | ❌ 仅限 dev |

### 方案 C：正式 Queue Worker（推荐 ✅）

```
POST /start → 立即返回 + enqueue N jobs
                   ↓
              BullMQ Queue (Redis)
                   ↓
              Worker 进程消费 job
                   ↓
              写 review_turns / review_opinions
                   ↓
              SSE 从 DB 读取实时状态
```

| 维度 | 评价 |
|---|---|
| 复杂度 | ⭐⭐⭐ 中等 |
| startReview 阻塞 | ✅ 否 |
| 自动触发 | ✅ |
| 崩溃恢复 | ✅ job 自动重试 |
| 实时性 | ✅ SSE 可读取 |
| 生产可用 | ✅ |

**推荐：方案 C -> Queue Worker（BullMQ）**

理由：
1. 与现有技术栈一致（NestJS + Redis 已就绪，BullMQ 已有依赖声明）
2. 不阻塞 HTTP 请求
3. job 持久化 + 重试保证可靠性
4. SSE 可从 DB/job 状态读取真实进度
5. 架构对齐正式上线的姿态

---

## 3. Queue 方案边界

### 3.1 Job 类型

```
job name                  payload
────────────────────────────────────────────────────
agent.turn.execute       { reviewId, roleId, roleCode, turnIndex, objective, provider? }
meeting.complete         { reviewId }
```

- `agent.turn.execute`：每个角色一个 job
- `meeting.complete`：所有 turn 完成后触发，更新 review.status → completed

### 3.2 Job 状态

```
queued → active → completed
              ↘ failed (→ retry)
                  ↘ failed (max retries exhausted)
```

### 3.3 Retry 策略

- max retries: 3 次
- backoff: 指数退避（2s, 4s, 8s）
- 超时: 120s

### 3.4 Timeout 策略

- 单次 provider 调用超时: 120s（与现有 `TIMEOUT_MS` 一致）
- 超时后 `review_turn.status = timeout`，标记失败，继续下一个 job
- 不阻塞其他 job

### 3.5 Partial Failure 策略

N 个 job 中 M 个成功：
- `review.status = completed`（只要 > 0 个成功）
- `review_opinions` 只写入成功 turn
- Report 标注 `incompleteAgents`
- 全部失败：`review.status = failed`

### 3.6 review.status 流转

```
startReview  ──→ running
                    ↓
     所有 agent.turn.execute completed
                    ↓
           review_turns 全部 done
                    ↓
          meeting.complete job 执行
                    ↓
          review.status = completed
```

### 3.7 review_turns / review_opinions 何时写入

```
Job 开始  → 创建 ReviewTurn (status=queued)
Job 执行  → status=retrieving → thinking
Job 完成  → 创建 ReviewOpinion + ReviewTurn (status=completed)
Job 失败  → ReviewTurn (status=failed/timeout)
```

### 3.8 SSE 如何从 DB 获取数据

Meeting SSE endpoint 改为：

```
GET /meeting/stream
  → 查询该 review 的所有 ReviewTurn + ReviewOpinion
  → 按 turnIndex 排序
  → 逐条转换为 SSE 事件（type: agent.turn.started / agent.message.completed / agent.turn.completed / meeting.completed）
```

**关键变化**：SSE 不再预计算假数据，而是读取已写入 DB 的真实 turn/opinion。

---

## 4. startReview 原则（不可妥协）

```
POST /reviews/{id}/start

1. 校验 roleSelection 存在
2. 校验 status = ready
3. 修改 status = running
4. 读取 roleIds → 为每个角色 enqueue agent.turn.execute job
5. 立即返回 { sessionId, status: 'running' }

总耗时 < 50ms（无 provider 调用，无 DB 写入）
```

**红线**：
- ✅ 不执行 provider
- ✅ 不写 review_turns（job 执行时写）
- ✅ 不直接调用 LLM
- ✅ 不阻塞 HTTP 响应

---

## 5. Provider Guard

继承现有 `provider-adapter.js` 的 guard 机制：

```
getProvider()
  → MODEL_PROVIDER 未设置 / "mock" → mock（默认，零依赖）
  → MODEL_PROVIDER=lmstudio + ALLOW_EXTERNAL_MODEL_CALLS=true → lmstudio
  → MODEL_PROVIDER=lmstudio + allow 不是 true → 抛 GUARD 错误
  → 其他值 → 抛 Unsupported provider error
```

Queue Worker 使用相同的 `getProvider()`，因此 guard 自动生效。
Worker 进程与 API 进程共享环境变量，没有额外配置。

**未来扩展**：添加新的 provider（如 openai）只需修改 provider-adapter.js + guard，不涉及 Queue。

---

## 6. 数据库 / Schema

### 当前 schema 是否足够？

| 需求 | 当前 | 足够？ |
|---|---|---|
| `review_turns` 存储 job 状态 | ✅ 已有 status/startedAt/completedAt | ✅ |
| `review_opinions` 存储 AgentTurnResult | ✅ 已有全部字段 | ✅ |
| job 持久化 | BullMQ 使用 Redis | ✅ 已有 Redis |
| job 状态追溯 | Queue 自带 | ✅ |
| 新增 `jobs` 表？ | ❌ 不需要 | BullMQ 管理 job 生命周期 |

**结论：当前 14 张表 + Redis 足够，无需新增表。**

---

## 7. 分阶段计划

### Sprint 4.1 — Queue/Runner Contract Doc

- 输出本文档定稿
- 不写代码，不改 schema
- **红线**：不实现任何代码

### Sprint 4.2 — Mock Queue Execution

- 在 `apps/api/src/modules/reviews` 新增 `turn-executor.service.ts`
- 当前: 从 startReview enqueue mock jobs（仅创建 ReviewTurn，provider 仍 mock）
- Queue: 使 BullMQ Provider（NestJS `@nestjs/bullmq` 已声明）
- 消费者: `agentTurnProcessor` 调用现有 `provider-adapter` 的 mock
- 写 review_turns + review_opinions（与当前 runner 逻辑一致）
- SSE 仍 mock（Sprint 4.3 改）
- **红线**：
  - 不调真实 LLM
  - `POST /start` 仍 < 1s
  - 不改 schema

### Sprint 4.3 — SSE Read DB Turns

- 修改 `reviews.gateway.ts` 中的 `getMeetingStream`
- 从 `review_turns` + `review_opinions` 读取数据
- 按 turnIndex 排序，逐条发送 SSE 事件
- 移除预计算假数据（移除 `MOCK_AGENT_CONTENT`）
- 保留 mock provider（数据真实，但内容为 mock）
- **红线**：
  - 不改 schema
  - 不阻塞 startReview
  - SSE 仍用 `@Sse()`（不引入 WebSocket）

### Sprint 4.4 — LM Studio Guarded Integration

- 允许 Worker 使用 `MODEL_PROVIDER=lmstudio`
- 实证：LM Studio 30s+ 调用在 Worker 中正常
- smoke-runner 扩展：验证 Queue 写入的 turn/opinion
- smoke-runtime 扩展：验证 SSE 从 DB 读取
- **红线**：
  - LM Studio 仍受 guard 保护
  - 不引入其他外部 provider
  - 不改 schema

### 红线汇总

```
Sprint 4.1  4.2  4.3  4.4
  ✅   ✅    ✅    ✅  不调真实 LLM（除非显式授权）
  ✅   ✅    ✅    ✅  不改 schema
  ✅   ✅    ✅    ✅  不阻塞 startReview
  ✅   ✅    ✅    ✅  不引入 WebSocket
  ✅   ✅    ✅    ✅  不改前端
  ✅   ✅    ✅    ✅  LM Studio 受 guard 保护
```

---

## 8. 测试计划

### 8.1 smoke-runtime 扩展（Sprint 4.3）

```
现有 31 个测试 + 新增:
32. POST /start → enqueue jobs → queue 状态正确
33. Queue worker 消费 job → review_turns 写入
34. Queue worker 消费 job → review_opinions 写入
35. SSE /meeting/stream → 从 DB 读取 turn/opinion
36. Partial failure → 部分 turn failed, report 标注
```

### 8.2 smoke-runner 演进

```
当前 11 个测试（验证 runner 语义）
→ 保留（runner 脚本仍可用）
→ 新增：Queue worker 与 runner 并行验证（输出一致）
```

### 8.3 边界场景测试

| 场景 | 测试方式 |
|---|---|
| Bad JSON（provider 返回非 JSON） | mock provider 模拟 → turn.failed |
| Timeout（provider 超时 120s） | mock provider 模拟 → turn.timeout |
| Partial failure（3/5 成功） | mock provider 部分失败 → report 标注 |
| Retry（max retries 耗尽） | mock provider 持续失败 → turn.failed |
| Idempotency（重复 enqueue） | Queue 层面由 jobId 去重 |
| Guard blocked | MODEL_PROVIDER 不设置 → 不会创建 job |

---

## Backend Recommendation

**推荐方案：方案 C → Queue Worker（BullMQ）**

| Sprint | 阶段 | 交付 |
|---|---|---|
| 4.1 | 设计(当前) | 本文档 |
| 4.2 | Mock Queue | 写入 DB, `POST /start` enqueue jobs |
| 4.3 | SSE from DB | `getMeetingStream` 从 DB 读取 |
| 4.4 | LM Studio | Worker 使用 LM Studio |

**结论**：推荐分 4 个 Sprint 完成 Queue 接入，第 1 个 Sprint 不写代码。
