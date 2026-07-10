# PrismReview — MVP Demo Runbook

> 目标：让 PrismReview MVP 可以被稳定演示，减少手工步骤。

---

## 1. 启动依赖

### 1.1 基础设施（Docker）

```powershell
# 从项目根目录
docker compose up -d
```

验证（3 个容器均应 healthy）：

```powershell
docker compose ps
# prismreview-postgres   Up (healthy)
# prismreview-redis      Up (healthy)
# prismreview-minio      Up (healthy)
```

### 1.2 数据库 migration

```powershell
cd apps/api
pnpm prisma:migrate --name init
pnpm prisma:seed
cd ../..
```

### 1.3 后端 API

```powershell
# 方式 A：直接调用 nest 可执行文件
apps/api/node_modules/.bin/nest.CMD start --watch

# 方式 B：通过 pnpm
cd apps/api
pnpm dev
```

API 服务默认运行在 `http://localhost:4000/api`

### 1.4 前端

```powershell
# 新建终端
apps/web/node_modules/.bin/next.CMD dev
```

前端默认运行在 `http://localhost:3000`

---

## 2. Demo 路线 A — 纯 Mock 演示

适合首次展示，不依赖任何外部模型。

> **LLM 依赖说明（Sprint 7.5 冻结）**：路线 A 是默认 Demo，**完全不需要任何 LLM / 外部模型 / 付费 API**。所有 opinion 由内置 mock provider 生成（0ms），来源摘要显示 `Mock(N)`，无任何"真实模型参与"标签。本路线即为 MVP 稳定演示基线，无需 LM Studio，也不应被描述为"需要模型"。

### 2.1 一键设置

```powershell
node scripts/setup-demo-review.js
```

输出示例：

```
🎬 PrismReview — One-Click Demo Setup

  ✅ Review created: "PrismReview MVP Demo"
  ✅ Diagnosed — 5 tags, 5 roles available
  ✅ Roles saved: CTO, CFO, PMO
  ✅ Review started (status: running)

============================================================
  🎬 Demo Ready — Review ID: a1b2c3d4...
============================================================
  Diagnosis:   http://localhost:3000/reviews/{id}
  Meeting:     http://localhost:3000/reviews/{id}/meeting
  Report:      http://localhost:3000/reviews/{id}/report
  SSE Stream:  http://localhost:4000/api/reviews/{id}/meeting/stream
============================================================
  Route:       A (pure mock)
  Report src:  mock_fallback
  Roles:       CTO, CFO, PMO
============================================================
```

### 2.2 演示步骤

| 步骤 | 操作 | 预期结果 |
|---|---|---|
| 1 | 打开 Diagnosis URL | 显示方案摘要、风险雷达图、5 个推荐角色 |
| 2 | 打开 Meeting URL | 显示静态三栏布局（Agent 席位/发言流/上下文面板） |
| 3 | 打开 Report URL | 显示六章结构报告，source=**mock_fallback**；报告底部"生成来源摘要"显示 `Mock(N)`，无真实模型标签 |
| 4 | 点击报告页右上角"导出 Markdown" | 浏览器下载 `prismreview-{id前8位}.md`，文件非空，含评审标题/目标/结论/来源摘要/风险/意见（详见 §10） |

---

## 3. Demo 路线 B — Runner + DB Opinions

适合演示真实数据写入流程，使用 mock provider（无需 LM Studio）。

> **LLM 依赖说明（Sprint 7.5 冻结）**：路线 B 同样**不依赖任何 LLM / 外部模型 / 付费 API**。Runner 使用内置 mock provider 将 opinion 真实写入 DB（`providerSource=mock`），来源摘要显示 `Mock(N)`，无"真实模型参与"标签。路线 A 与 B 是 MVP 默认演示的全部范围，二者均零外部模型依赖。

### 3.1 一键设置

```powershell
node scripts/setup-demo-review.js --with-runner
```

额外输出：

```
  ✅ Runner: mock provider, turns completed
  Route:       B (runner + DB opinions)
  Report src:  db_opinions
```

**重跑同一 review（观察幂等跳过）**：`setup-demo-review.js` 默认**每次新建**一个 review。若想对**已有** review 重跑 wrapper 并观察 runner 的幂等跳过行为，需显式传入 `--review-id=<id>`（dev/test 辅助参数，用于对已有 review 重跑 wrapper、**不新建** review）：

```powershell
node scripts/setup-demo-review.js --with-runner --review-id=<id>
```

此时 runner 检测到该 review 已有 completed turns，会输出：

```
  ✅ Runner: idempotent skip (turns already completed)
```

这是**预期行为**，不是失败。如需重新生成 turns，使用 `--force`：

```powershell
node scripts/run-agent-turns-for-review.js <reviewId> --force
```

### 3.2 演示步骤

| 步骤 | 操作 | 预期结果 |
|---|---|---|
| 1 | 打开 Diagnosis URL | 同路线 A |
| 2 | 确认 runner 输出 | 3/3 turns completed，CTO/CFO/PMO 各有 opinion |
| 3 | 打开 Report URL | 显示真实 DB opinions，source=**db_opinions**；报告底部"生成来源摘要"显示各角色 provider 分布 |
| 4 | 查看 opinions | 每条来自不同角色，有 dimension/riskLevel/confidenceScore |
| 5 | 点击报告页右上角"导出 Markdown" | 同路线 A：浏览器下载非空 `.md`，内容与 DB opinions 报告一致（详见 §10） |

---

## 4. 常见问题

### 4.1 CORS 错误

**现象**：前端访问 API 时浏览器提示 CORS 错误。

**检查**：
```powershell
curl http://localhost:4000/api/auth/me
```
如果返回 JSON 说明 API 正常。

**修复**：确保 API `main.ts` 中 CORS 配置了 `http://localhost:3000`。

### 4.2 服务没起

**现象**：`setup-demo-review.js` 返回 `connect ECONNREFUSED`。

**检查**：
```powershell
# API
curl http://localhost:4000/api/auth/me

# Docker
docker compose ps
```

### 4.3 Report 返回 400

**现象**：查看未 start 的 review 的 report 返回 400。

**原因**：Report API 要求 review 状态为 `running` / `completed` / `failed`。
`setup-demo-review.js` 会自动 start review，所以正常情况下不会出现。

**手动修复**：检查 review 状态：
```powershell
curl http://localhost:4000/api/reviews/{reviewId}
```

### 4.4 LM Studio 慢

**说明**：LM Studio **不是默认演示依赖**。默认使用 `mock` provider（0ms 响应）。
如果启用了 `MODEL_PROVIDER=lmstudio`，Gemma-4-12b 的推理时间约 30-40 秒/角色。

**建议**：纯演示时不设置 `MODEL_PROVIDER`，保持默认 mock。

### 4.5 重跑 Route B 时出现 "idempotent skip"

`--review-id=<id>` 是 **dev/test 辅助参数**：用于对**已有 review** 重跑 `setup-demo-review` wrapper，**不新建** review，从而观察 runner 的幂等跳过行为。

**现象**：对同一个 `completed` review 重跑（携带 `--review-id`）时输出：

```powershell
node scripts/setup-demo-review.js --with-runner --review-id=<id>
```

```
✅ Runner: idempotent skip (turns already completed)
```

**两种重跑情形的预期差异（务必区分）**：

| 场景 | 命令 | 预期结果 |
|------|------|----------|
| 对已有 `completed` review 重跑（带 `--review-id`） | `node scripts/setup-demo-review.js --with-runner --review-id=<id>` | **idempotent skip**，是预期行为，**不是失败** |
| 不带 `--review-id` 再次运行 `--with-runner` | `node scripts/setup-demo-review.js --with-runner` | **新建**一个 review，通常会再次执行 3/3 turns completed，**不会**触发 skip |

**原因**：不带 `--review-id` 时，wrapper 默认创建一个新 review 并完整跑完 runner，因此不会命中"已有 completed turns"的跳过分支。只有显式传入 `--review-id` 指向已有 review 时，才会进入幂等跳过逻辑。`idempotent skip` 是 **预期行为**，不是失败。

**如需重新生成 turns**：

```powershell
node scripts/run-agent-turns-for-review.js <reviewId> --force
```

---

## 5. Runner 独立使用

如果需要手动控制 runner（而非 `--with-runner`）：

```powershell
# 默认（幂等 — 已有 completed 则跳过）
node scripts/run-agent-turns-for-review.js <reviewId>

# 强制重新执行
node scripts/run-agent-turns-for-review.js <reviewId> --force
```

---

## 6. 验证清单

演示前运行以下命令确认一切正常：

```powershell
# 后端编译
cd apps/api && npx tsc --noEmit --incremental false

# 全量 smoke
cd ../.. && node scripts/smoke-runtime.js

# Runner smoke
node scripts/smoke-runner.js

# Demo 设置（路线 A）
node scripts/setup-demo-review.js

# Demo 设置（路线 B）
node scripts/setup-demo-review.js --with-runner
```

---

## 7. 依赖关系

```
                 ┌────────────┐
                 │ Docker     │  ← PostgreSQL, Redis, MinIO
                 └─────┬──────┘
                       │
                 ┌─────▼──────┐
                 │ API        │  ← NestJS, Prisma
                 │ :4000      │
                 └─────┬──────┘
                       │
          ┌────────────┼────────────┐
          │            │            │
   ┌──────▼─────┐ ┌───▼────┐ ┌────▼─────┐
   │ Frontend   │ │ Runner │ │ LM Studio│
   │ :3000      │ │ (可选)  │ │ (可选)    │
   └────────────┘ └────────┘ └──────────┘
```

- **Minimum demo（路线 A）**：Docker + API + Frontend
- **With runner（路线 B）**：Docker + API + Frontend + Runner
- **With LM Studio**：Docker + API + Frontend + Runner + LM Studio

---

## 8. 报告页：生成来源摘要（来源可观测性）

Sprint 5.1–5.3 为报告页增加了"**生成来源摘要**"模块（`providerSummary`），用于直观展示每份报告由哪些 provider 生成、是否发生过 fallback 或失败。**该模块仅读取已落库的 `modelOutputRef`，不调用任何模型，不展示 prompt / 原始输出 / API Key。**

### 8.1 五态 providerSource 含义

每条 opinion 的 `modelOutputRef` 含一个 `providerSource` 字段，取值与含义如下：

| providerSource | 含义 | 是否真实模型 | 摘要标签 |
|----------------|------|--------------|----------|
| `mock` | 默认 mock provider 成功返回（0ms） | 否 | 无特殊标签 |
| `lmstudio` | 本地 LM Studio 模型成功返回（如 Gemma-4-12b） | 是 | 计入"真实模型参与" |
| `openai_compatible` | OpenAI-compatible 付费接口成功返回 | 是 | 计入"真实模型参与" |
| `fallback_mock` | 运行时 fallback 回退到 mock（`fallback: true`） | 否 | 计入"已发生 Fallback" |
| `failed` | guard 拦截 / 401·403 鉴权失败（`fallback: false`） | 否 | 计入"存在失败 Turn" |

> 说明：`mock` 与 `fallback_mock` 的区别在于是否"主动回退"——前者是默认走 mock，后者是真实 provider 不可用时兜底回 mock。两者都不会让报告崩溃，但 `fallback_mock` 会在摘要中提示"已发生 Fallback"。

### 8.2 摘要模块展示内容

报告页底部"生成来源摘要"展示：

- **总发言数**：`totalTurns`，等于所有 opinion 数量。
- **来源分布**：`Mock(N) / LMStudio(N) / OpenAI(N) / Fallback(N) / Failed(N)`，对应后端 `bySource` 五态。
- **条件标签**：
  - `hasRealProvider === true` → 蓝色标签 **"真实模型参与"**（有 lmstudio 或 openai_compatible 参与）
  - `fallbackCount > 0` → 橙色标签 **"已发生 Fallback"**（有 turn 回退到 mock）
  - `failedCount > 0` → 红色标签 **"存在失败 Turn"**（有 turn 因 guard / 鉴权失败）

### 8.3 缺失 providerSummary 时页面表现

`providerSummary` 是**可选字段**。当后端未返回（老数据 / 解析异常）时，前端通过 `&&` 短路守卫整块跳过该模块，**页面其余部分正常渲染，不白屏、不报错**。这是 Demo 稳定性的关键保障。

### 8.4 MVP Demo 无需真实 LLM / 付费 API

- **默认路线 A（纯 mock）**：所有 opinion 来源均为 `mock`，摘要显示 `Mock(N)`，无真实模型标签。完全不需要 LM Studio 或任何付费 API。
- **路线 B（runner + DB opinions）**：使用 mock provider 写入 DB，`providerSource` 仍为 `mock`，摘要同样显示 `Mock(N)`。
- 只有在显式设置 `MODEL_PROVIDER=lmstudio` 或 `openai_compatible` 并配置对应 endpoint / key 后，摘要才会出现 LMStudio / OpenAI 分布与"真实模型参与"标签。

> 结论：**MVP Demo 全程默认 mock 即可完成，零外部模型依赖、零付费 API 调用。** 来源可观测性模块只是把"实际用了什么 provider"透明展示出来，不改变任何演示流程。

---

## 9. Demo 文档与代码一致性说明

- 本文档 §8 对应 Sprint 5.1（后端可观测性落库）、Sprint 5.2（Report API `providerSummary` 字段）、Sprint 5.3（前端展示模块）三项已实现能力。
- 本文档仅描述演示行为，**不修改任何代码**。如需变更展示逻辑，须回到对应 Sprint 的 Backend / Frontend 文档走流程。
- 快速 Gate 模式（协议 §7）适用：本 Runbook 刷新不涉及 schema / 状态机 / 真实 LLM 首次接入 / 前端主页面改动 / 新外部依赖。

---

## 10. 报告页：导出 Markdown 演示（Sprint 6.3）

Sprint 6.2 已在报告页启用"**导出 Markdown**"按钮（Sprint 6.0 契约 + 6.1 后端 `GET /api/reviews/{id}/report/export.md`）。本节点描述演示时如何展示，并澄清边界。

### 10.1 按钮位置与启用条件

- **位置**：报告页（Report）Header 右侧，与"导出 PDF""同步至 Jira（未连接）"并列。
- **启用条件**：仅当报告成功加载（review `status=completed` 且 `report` 数据就绪）后按钮才可点击；加载中 / 出错 / 无数据时不渲染该按钮，天然防误触。
- **交互**：点击后按钮进入 `loading` 态防连击，导出失败时弹出中文提示（`导出 Markdown 失败，请稍后重试。`）。

### 10.2 PDF / Jira 仍 disabled（未接入）

> **本轮仅启用 Markdown 导出。PDF 导出与 Jira 同步后端尚未实现，对应按钮保持 `disabled`，点击无效。**

| 按钮 | 状态 | 说明 |
|------|------|------|
| 导出 Markdown | **启用** | 走后端 `export.md` 接口，浏览器下载 |
| 导出 PDF | disabled | 后端未实现 PDF 渲染，暂不可点 |
| 同步至 Jira（未连接） | disabled | 未接入 Jira，暂不可点 |

### 10.3 导出的 Markdown 包含什么

Markdown 完全由后端基于既有 `getReport()` 聚合**服务端生成**（不前端拼装、不调用 provider、不调真实模型），结构见 Sprint 6.0 契约 §3。主要章节：

- **头部**：评审标题、评审目标（objective）、Review ID、状态、模式、生成时间（导出时刻）、数据来源（`mock_fallback` / `db_opinions`）、意见数量、真实生成标志。
- **评审结论**：`verdict` 中文映射（`approved`→通过 / `conditionally_approved`→有条件通过 / `rejected`→不通过 / 其他→未给出）。
- **生成来源摘要**：`providerSummary`（总轮次、Mock/LMStudio/OpenAI/Fallback/Failed 五态分布、使用模型、fallback/failed 计数）。
- **执行摘要**：`executiveSummary`。
- **评审指标**：P0 风险数 / 总风险数 / 采纳率 / 评审耗时等 `metrics`。
- **风险清单**：`risks[]`（等级/来源/维度/描述）。
- **各角色评审意见**：`opinions[]`（维度/风险/问题/建议/置信度）。
- **改进行动项**：`actionItems[]`。
- **低置信度意见**：`lowConfidenceItems[]`（若有）。
- 安全：导出**不含** `rawText` 全文、`modelOutputRef` 原始 JSON、API Key、用户 prompt / 文件内容（详见 Sprint 6.0 §4 安全与脱敏）。

### 10.4 默认 mock 路线也能导出（无需真实模型）

- 导出逻辑**复用 `getReport`**，全程不调用任何 provider、不发起真实模型推理、不消耗付费 API。
- **路线 A（纯 mock）** 与 **路线 B（mock runner + DB opinions）** 的报告均可正常导出，文件名与内容一致；
- 只有在显式设置 `MODEL_PROVIDER=lmstudio` / `openai_compatible` 并配置 endpoint / key 时，报告才会出现"真实模型参与"标签——但导出动作本身与是否真实模型**无关**，默认 mock 即可演示完整导出能力。

### 10.5 文件命名与验证

- **文件名**：后端返回 `Content-Disposition: attachment; filename="prismreview-{reviewId前8位}.md"`；前端优先采用该文件名，缺失时 fallback 为 `prismreview-{reviewId}.md`。
- **验证下载**：下载后文件非空（数 KB Markdown），首行 `# PrismReview 评审报告`，可肉眼确认含评审目标、评审结论、生成来源摘要、风险清单、专家意见等章节。
- **接口自测（可选）**：

```powershell
# 用 completed review 的 id 验证导出接口（默认 mock 即可）
curl -i "http://localhost:4000/api/reviews/{reviewId}/report/export.md" `
  -H "Authorization: Bearer test-token"
# 预期：200 + Content-Disposition: attachment; filename="prismreview-{前8位}.md"
#       + 非空 text/markdown 正文
```

> 注：本节仅为演示行为说明，**不修改任何代码**（Sprint 6.3 文档刷新）。如需变更导出结构/字段，须回到 Sprint 6.0 契约或对应后端 Sprint 走流程。

---

## 11. Dev-only LM Studio 路线（Sprint 7.5 冻结）

> 本节定义**可选、非默认**的"真实本地模型"演示路线。它是 MVP 的**扩展能力**，不是默认 Demo 的一部分；默认 Demo（路线 A / B）始终零 LLM 依赖（见 §2 / §3 / §8.4）。
> 本路线的落地基于 Sprint 7.2（合同）→ 7.3（实现 `MODEL_PILOT_MAX_ROLES` 硬约束，Gate: Go）→ 7.4（本地 LM Studio 端到端 15/15 PASS，Gate: Go）。

### 11.1 启用前提（显式 env guard，缺一不可）

仅当以下 env 在**独立 pilot 进程**内联设置时，队列才会调用本地 LM Studio；否则一律走默认 mock。

| 变量 | 必须值 | 说明 |
|------|--------|------|
| `MODEL_PROVIDER` | `lmstudio` | 仅本地 LM Studio 被允许走 queue；`openai_compatible` 暂不接 queue |
| `ALLOW_EXTERNAL_MODEL_CALLS` | `true` | 总开关；缺省/非 `true` 即 GUARD → 该 turn 标记 `failed` 且不 fallback |
| `MODEL_BASE_URL` | 含 `/v1`（如 `http://127.0.0.1:1234/v1`） | LM Studio OpenAI 兼容端点 |
| `MODEL_NAME` | 已加载的模型（如 `google/gemma-4-12b`） | 模型未加载则调用失败 → 见 §11.4 |

> **关键**：`.env` 默认 `MODEL_PROVIDER="mock"`、`ALLOW_EXTERNAL_MODEL_CALLS=false`，常驻 :4000 实例**永远是 mock**。pilot 仅在专用端口（如 :4100）以**进程内联 env** 启动，不污染默认实例、不污染 `.env`、不写入文档。

### 11.2 单 review ≤ 3 调用上限（代码硬约束）

- 由 Sprint 7.3 的 `applyPilotRoleCap()` 在**派发前**截断：`MODEL_PILOT_MAX_ROLES` 未设/非法 → 默认 **3**；仅正整数取该值。
- 即使演示时提交 5 个角色，实际仅 **3 个 turn** 调用 LM Studio，3 条 `reviewOpinions` 写入。
- 该上限由**代码保证**，pilot env 关闭时完全不影响默认 mock（mock 路径零额外行为）。
- 这是**成本与合规硬上限**，不是软建议：任何 pilot 演示不得声称"调用了 >3 次真实模型"。

### 11.3 来源可观测性（报告页如实反映）

开启 pilot 后，报告页"生成来源摘要"按实际落库 `providerSource` 显示：

- `lmstudio` 命中 → 蓝色 **"真实模型参与"** 标签（`hasRealProvider=true`），`LMStudio(N)` 分布。
- `fallback_mock` 命中（运行时失败兜底）→ 橙色 **"已发生 Fallback"** 标签，`Fallback(N)` 分布。
- `failed` 命中（guard / 401·403）→ 红色 **"存在失败 Turn"** 标签，`Failed(N)` 分布。
- Markdown 导出同样包含 `providerSummary`，内容与报告一致（见 §10.3）。

### 11.4 弱输出 / 失败不代表系统失败

LM Studio 本地模型（如 Gemma-4-12b）质量与速度**不稳定**。以下情形**已被设计覆盖、属预期行为、不代表 PrismReview 系统故障**：

| 情形 | 系统行为 | 摘要表现 | 是否系统失败 |
|------|----------|----------|--------------|
| 调用超时（`MODEL_TIMEOUT_MS`） | 单次 fallback 到 mock，不重试真实 provider | `fallback_mock` + 橙标 | **否**（兜底成功） |
| 空内容 / 非法 JSON | 归为 runtime → `fallback_mock` | `fallback_mock` + 橙标 | **否**（兜底成功） |
| guard 未开 / auth 失败（401·403） | `failed` + `NO_RETRY`，不 fallback | `failed` + 红标 | **否**（fail-closed 正确拦截） |
| 弱质量 opinion（低置信度） | 正常落库，如实展示 | `lmstudio` + 蓝标（低 `confidenceScore`） | **否**（如实记录弱输出） |

> **口径铁律**：不得把 `fallback_mock` / `failed` 包装成"真实模型成功"；也不得因真实模型弱输出/failed 而宣称"系统不可用"。以上均为受控、可观测、可恢复的演示分支。

### 11.5 openai_compatible / 付费 API 未启用

- **本 MVP 不启用任何付费 API / `openai_compatible`**。
- `openai_compatible` 不仅需要 `ALLOW_EXTERNAL_MODEL_CALLS=true`，还必须提供 `MODEL_API_KEY`；缺 Key 即结构性 GUARD，永不静默启用（Sprint 7.4 场景 C 已验证）。
- 任何涉及 API Key / 出域数据传输的演示**均不在 MVP 范围内**，需另开独立 Gate（见 `Sprint_7.0` 路线 C / 后续 Pilot）。
- Demo 话术：**"MVP 默认与可选 pilot 均不涉及付费 API；真实模型仅限本地 LM Studio、显式 env、≤3 capped。"**

### 11.6 与默认 Demo 的关系

- 默认受众演示走 **路线 A（纯 mock）** 或 **路线 B（mock runner + DB opinions）**，二者零外部模型依赖、零风险、可无限重放。
- Dev-only LM Studio 路线（本节）是**给有本地 LM Studio 的开发/评审者**的"真实模型成功路径验证"演示，**非对外标准 Demo**，且需显式 env + 受控上限。
- 无论走哪条路线，前端、schema、导出、来源摘要模块均**不区分**"是否真实模型"——它们只读取已落库的 `providerSource`，行为一致、稳定。

> 注：本节为演示冻结语义说明，**不修改任何代码**。pilot 行为细节以 Sprint 7.2（合同）/ 7.3（实现复审）/ 7.4（E2E）为准。

