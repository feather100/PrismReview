# Sprint 1.9 — Agent Turn Persistence Design

> 设计如何把 Provider Adapter 的 `AgentTurnResult` 写入 `review_turns` / `review_opinions` 并接入 Meeting SSE。
> 暂不实现。不改代码，不改 Prisma schema。

---

## 1. 数据写入策略

### 1.1 ReviewTurn 字段映射

| 字段 | 来源 | 说明 |
|---|---|---|
| `id` | `@default(uuid())` | — |
| `reviewId` | Review.id | — |
| `turnIndex` | 当前轮次号（从 1 递增） | 根据 `COUNT(reviewTurns) + 1` 计算 |
| `phase` | String — 预留阶段标识 | Sprint 1.9 固定为 `"round_robin"` |
| `roleVersionId` | AgentRole.activeVersionId | 从 `roleSelection` 中的 `roleId` JOIN 查询 |
| `status` | Enum: `queued` → `retrieving` → `thinking` → `speaking` → `completed` / `timeout` / `failed` / `skipped` | 见 1.3 |
| `startedAt` | `new Date()` | Turn 开始执行时写入 |
| `completedAt` | `new Date()` | Turn 完成/失败/超时时写入 |

### 1.2 ReviewOpinion 字段映射

| AgentTurnResult 字段 | ReviewOpinion 字段 | 转换 |
|---|---|---|
| `roleCode` | —（不直接存储） | 通过 `turnId` → `ReviewTurn.roleVersionId` → `AgentRole.code` 追溯 |
| `dimension` | `dimension` | 直接存储 |
| `riskLevel` | `riskLevel` | 直接存储（`"high"` / `"medium"` / `"low"` / `"info"`） |
| `issue` | `issue` | 直接存储 |
| `recommendation` | `recommendation` | 直接存储 |
| `confidenceScore` | `confidenceScore` | 直接存储（`Int`） |
| — | `citations` | Mock 阶段固定为 `[]` |
| — | `reasoningSummary` | 可选：取 `rawText` 前 200 字符 |
| `rawText` | `modelOutputRef` | 存储路径或摘要；见 1.4 脱敏策略 |
| — | `feedback` | 初始为 `null`，由人工反馈填充 |

### 1.3 ReviewTurn status 流转

```
queued ──→ retrieving ──→ thinking ──→ speaking ──→ completed
                          │                         │
                          │                         ├──→ timeout
                          │                         └──→ failed
                          └──→ skipped
```

- `queued`：Turn 已创建，等待执行
- `retrieving`：正在检索上下文（RAG / 知识库）
- `thinking`：正在调用 provider
- `speaking`：输出已就绪，SSE 推送中
- `completed`：正常完成
- `timeout`：provider 超时
- `failed`：provider 返回错误 / JSON 解析失败
- `skipped`：用户手动跳过

### 1.4 rawText 存储与脱敏

- **存储位置**：`ReviewOpinion.modelOutputRef`（`String?`）
- **存储内容**：`AgentTurnResult.rawText`
- **脱敏策略**：
  - Mock 阶段不需要脱敏
  - LM Studio 本地环境不需要脱敏
  - 后续 external provider：写入前对 rawText 做 PII 扫描 / 脱敏
  - 脱敏方式：正则替换（邮箱、IP、电话号码等）— 具体实现在接入 external provider 时定义
- **删除策略**：`modelOutputRef` 在 report 生成后可清除（或保留用于审计）

---

## 2. 运行链路

### 2.1 核心约束

**`POST /start` 不得阻塞**。LM Studio 单角色 30s+，多角色串行会导致前端长时间卡住，破坏 `Diagnosis → Confirm Committee → startReview → Meeting` 主链路。

`startReview` 必须：
- 立即返回 `{ status: 'running', sessionId }`
- 不等待任何 provider 执行
- 保持现有前端跳转体验不变

### 2.2 startReview 后的触发流程

```
POST /reviews/{id}/start
  │
  ├── status: draft → running
  ├── 立即返回 { status: 'running', sessionId }
  │
  └── [后续由 Phase B 独立 runner 执行]
```

ReviewTurn 的创建和执行不在 `POST /start` 中发生，而是由独立脚本或 queue worker 完成。

### 2.3 方案对比

| 方案 | 优点 | 缺点 | 采用阶段 |
|---|---|---|---|
| **Mock SSE**（当前） | 不阻塞 startReview，前端可先行 | 数据不真实 | Phase A |
| **独立脚本 runner** | 不阻塞 API，可手动验证 DB 写入 | 需手动触发 | Phase B |
| **Queue worker**（BullMQ/Celery） | 不阻塞，可扩展，崩溃可恢复 | 需引入新依赖 | Phase C |
| **Job + 真实 SSE 推送** | 全链路真实 | 实现复杂 | Phase D |

**正式方案**：Provider 执行不应跑在 HTTP request 生命周期里。必须通过独立进程或队列执行。

---

## 3. Provider 策略

### 3.1 Provider 选择（getProvider 逻辑）

```
MODEL_PROVIDER 值     → 使用 provider
未设置 或 "mock"      → mock（默认，无额外依赖）
"lmstudio"           → LM Studio（本地，需授权）
其他                 → 抛 UnsupportedProviderError
```

### 3.2 Guard 策略（未来扩展）

```
provider            guard 检查
───────             ──────────────────────────
mock                不需要
lmstudio            MODEL_PROVIDER=lmstudio + ALLOW_EXTERNAL_MODEL_CALLS=true
openai (未来)        ALLOW_EXTERNAL_MODEL_CALLS=true + API key 存在
anthropic (未来)     ALLOW_EXTERNAL_MODEL_CALLS=true + API key 存在
```

### 3.3 超时、重试、JSON 解析失败

| 场景 | 处理 | ReviewTurn.status |
|---|---|---|
| Provider 超时（默认 120s） | 记录错误消息，跳过当前 turn | `timeout` |
| HTTP 错误（4xx / 5xx） | 记录 HTTP status + body，跳过 | `failed` |
| JSON 解析失败 | 记录 rawText 前 300 字符，跳过 | `failed` |
| 字段缺失（如无 `riskLevel`） | 记录错误详情，跳过 | `failed` |
| Guard 拦截 | 不创建 turn，抛回调用方 | — |

重试策略：Phase B 不做自动重试。重试由用户手动触发（UI 上的 "重试" 按钮）。

---

## 4. 迁移计划

```
Phase A [当前]
├── Mock SSE 完全独立
├── provider-adapter 已就绪（mock + lmstudio）
├── guard 已实现
├── startReview 不阻塞，立即返回
└── 不写 DB

Phase B [下一 Sprint — 独立 runner]
├── 新增 scripts/run-agent-turns-for-review.js
│   └── 手动传 reviewId：node scripts/run-agent-turns-for-review.js <reviewId>
├── 功能：
│   ├── 读取 review.roleSelection
│   ├── 串行执行 provider.run()（mock 或 lmstudio）
│   ├── 写入 review_turns（每 turn）
│   ├── 写入 review_opinions（每 turn 成功时）
│   └── 执行完后将 review.status → completed
├── GET /reviews/{id}/report 可选改为从 DB 读取
├── Meeting SSE 仍 mock（不改）
├── 可重复执行时的幂等策略：
│   ├── 先查该 review 是否已有 completed/failed 的 turn
│   ├── 有则跳过，避免重复写入
│   └── 支持 --force 参数重新执行所有 turn
├── 不改 Prisma schema
├── 不接 startReview 主链路
└── 进程崩溃风险：runner 中途崩溃则部分 turn 已写入，剩余未执行。
    手动重新执行时，幂等检查跳过已完成 turn 即可。

Phase C [后续 Sprint — 引入 Queue]
├── 引入 BullMQ（与 NestJS 集成）或 Celery（Python Worker）
├── startReview 在返回前 enqueue N 个 job（每 role 一个）
├── Worker 消费 job → 调用 provider → 写 DB
├── 进程崩溃恢复：job 有重试机制，queue 持久化
├── SSE 从 job/DB events 推送实时进度
├── ReviewTurn.status 通过 queue events 更新
└── 支持 interrupted / resume

Phase D [后续 Sprint — 真实 Agent]
├── 替换 mock provider 为真实 Agent 执行
├── 多模型路由
├── RAG 检索注入
├── SSE 从 job/DB events 推送真实进度
└── Worker 独立部署
```

### 4.1 Phase B 实现步骤（草案）

```
Step 1: 创建 scripts/run-agent-turns-for-review.js
        Usage: node scripts/run-agent-turns-for-review.js <reviewId> [--force]

Step 2: runner 功能
  ├── 校验 review 存在且 status = running
  ├── 读取 review.roleSelection → 角色列表
  ├── 幂等检查：查 review_turns，已有 completed 则跳过
  ├── 对每个 role 串行执行：
  │   ├── 创建 ReviewTurn（status=queued → startedAt=now）
  │   ├── 调用 provider.run(roleCode, objective)
  │   ├── 成功 → 创建 ReviewOpinion + ReviewTurn.completed
  │   ├── 失败/超时 → ReviewTurn.failed + errorMessage
  │   └── 每步打印进度到控制台
  └── 所有 turn 完成后 → review.status = completed

Step 3: GET /reviews/{id}/report 可选改为从 DB 读取 opinion
        ├── 如果 review 有 review_opinions，从 DB 读取
        └── 如果没有（Phase A 的 review），返回 mock 数据（保持向后兼容）
```

### 4.2 Phase B Runner 幂等设计

```javascript
// 伪代码
async function runTurns(reviewId, force = false) {
  const review = await prisma.review.findFirst({ where: { id: reviewId, status: 'running' } });
  if (!review) throw new Error('Review not found or not running');

  const existingTurns = await prisma.reviewTurn.findMany({ where: { reviewId } });
  if (!force && existingTurns.some(t => t.status === 'completed')) {
    console.log(`Review ${reviewId} already has completed turns. Use --force to re-run.`);
    return;
  }

  const roles = review.roleSelection.roles;
  for (const [i, role] of roles.entries()) {
    // Check if this turn already done (idempotent)
    const existing = existingTurns.find(t => t.turnIndex === i + 1 && t.status === 'completed');
    if (existing && !force) {
      console.log(`  Turn ${i+1}/${roles.length}: ${role.roleCode} — already completed, skipping`);
      continue;
    }

    // Execute
    const turn = await prisma.reviewTurn.create({ data: { reviewId, turnIndex: i+1, status: 'queued', ... } });
    try {
      const result = await provider.run(role.roleCode, review.objective);
      await prisma.reviewOpinion.create({ data: { reviewId, turnId: turn.id, ...result } });
      await prisma.reviewTurn.update({ where: { id: turn.id }, data: { status: 'completed' } });
    } catch (err) {
      await prisma.reviewTurn.update({ where: { id: turn.id }, data: { status: 'failed' } });
    }
  }
}
```

---

## 5. 测试计划

### 5.1 Unit Tests

| 测试 | 工具 | 覆盖 |
|---|---|---|
| `mockProvider` 返回正确结构 | Jest | 5 个 roleCode 各返回对应 dimension |
| `lmstudioProvider` guard 拦截 | Jest | env 未设置时 throw |
| `lmstudioProvider` JSON 解析 | Jest | 正常 / markdown 包裹 / 数组格式 |
| `getProvider` 4 种行为 | Jest | mock / lmstudio+allow / lmstudio guard / 未知 provider |
| `stripMarkdown` | Jest | 有 fence / 无 fence / 混合 |
| `normalizeParsed` | Jest | 对象 / 数组 / 大小写 |

### 5.2 Smoke Tests

```
# startReview 响应时间
POST /api/reviews/{id}/start → 响应时间 < 1s（不得执行 provider）

# Phase B runner
node scripts/run-agent-turns-for-review.js <reviewId> → 全部 turn completed
node scripts/run-agent-turns-for-review.js <reviewId> → 幂等跳过（第二次运行无变化）
node scripts/run-agent-turns-for-review.js <reviewId> --force → 重新执行所有 turn

# Report 从 DB 读取
GET /api/reviews/{id}/report → 展示已写入的 opinion 数据

# 无 opinion 时保持向后兼容
GET /api/reviews/{id}/report → 返回 mock 数据（Phase A 遗留 review）
```

### 5.3 Bad JSON / Timeout / Guard 测试

```
# Guard blocked (no env)
MODEL_PROVIDER=lmstudio node scripts/spike-agent-turn.js
→ exit 1 + "MODEL PROVIDER GUARD"

# Bad JSON — provider returns unparseable
lmstudioProvider 收到非 JSON → 抛 Error → turn.failed

# Timeout — provider 无响应
→ 120s 后 turn.timeout
→ 继续下一个 turn
→ report 中标注完整性风险

# Partial agent failure
5 个 role 中 2 个 failed → report 包含 3 个 opinion
→ status: completed (partial)
→ report 标注缺失 Agent
```

### 5.4 性能基准

| 场景 | 目标 |
|---|---|
| `POST /start` 响应时间 | **< 1s**（不执行 provider） |
| Phase B runner 写 turn/opinion | mock provider < 5s（5 个 role） |
| LM Studio 单 role | ~30s（模型推理时间，非 API 瓶颈） |
| 重复 runner（幂等跳过） | < 1s |

---

## 6. 不做事项

- ✅ `POST /start` 内执行 provider
- ✅ 不改 Prisma schema
- ✅ 不接 RAG / Embedding / MinIO
- ✅ 不让前端直接调用 LLM
- ✅ 不引入 Worker / Celery（Phase C 再引入）
- ✅ 不做 citation 检索
- ✅ 不做多轮辩论（仅一轮 Round-Robin）
- ✅ Phase B runner 进程崩溃不恢复（手动重试时幂等跳过）
