# Sprint 7.4 — LM Studio Dev-only Capped E2E Trial

> **模式**：Dev-only 后端链路验证 + 记录（非 Gate；承接 7.3 Go）
> **执行人**：workbuddy-coder
> **前置复审**：`Sprint_7.3_Workbuddy_Review.md`（Go，无保留）
> **日期**：2026-07-10
> **结论**：**PASS** — 真实本地 LM Studio 端到端跑通，单 review 硬上限 3 条由代码 cap 保证，无泄漏、无超发、无默认 provider 变更。

---

## 1. 范围与红线

- ✅ 仅 dev-only、本地 LM Studio（`google/gemma-4-12b`，`http://127.0.0.1:1234/v1`）。
- ✅ 禁止 `openai_compatible` / 付费 API（结构上 fail-closed，需 `MODEL_API_KEY` 才启用，本环境不设 Key）。
- ✅ 总调用上限由 **7.3 代码 cap**（`MODEL_PILOT_MAX_ROLES`，不设 → 默认 3）保证，单 review ≤ 3。
- ✅ 不改 schema、不改前端、不接 paid API、不扩大调用次数。
- ✅ 本 Sprint **零源码改动**，仅新增 2 个验证脚本（证据/可复现）。

## 2. 环境

| 项 | 值 |
|----|----|
| API 实例 | 专用 pilot 实例，端口 **4100**（与常驻 mock 实例 :4000 隔离） |
| 进程内队列 | `QueueService` 为内存队列，随进程独立；pilot 实例独占其队列 |
| 数据库 | 复用 dev Postgres `prismreview`（同一库，review 行隔离删除） |
| LM Studio | `127.0.0.1:1234`，已加载 `google/gemma-4-12b` |
| Pilot env（仅本进程内联，未写入 `.env`） | `MODEL_PROVIDER=lmstudio` `ALLOW_EXTERNAL_MODEL_CALLS=true` `MODEL_BASE_URL=http://127.0.0.1:1234/v1` `MODEL_NAME=google/gemma-4-12b` `MODEL_PILOT_MAX_ROLES` **未设（→3）** |
| 常驻默认实例 :4000 | 仍为 `MODEL_PROVIDER="mock"`（`.env` 未改，默认 mock 100% 不变） |

## 3. 执行链路（真实 HTTP）

```
POST /api/reviews            → draft
POST /api/reviews/:id/diagnose → ready（mock 诊断，仅取推荐角色）
GET  /api/reviews/:id/diagnosis → 取 5 个 preset roleId
POST /api/reviews/:id/roles  → roleSelection（提交 5 角色，验证 cap 截断）
POST /api/reviews/:id/start  → status=running + enqueue('review.start')  ← 计时 <1s
  └─ 进程内队列: review.start → applyPilotRoleCap(5→3) → 3× agent.turn.execute
        └─ 每个 turn 调真实 LM Studio（google/gemma-4-12b）→ 写 reviewOpinion
  └─ meeting.complete → status=completed
GET  /api/reviews/:id/report → 200（含 providerSummary）
```

## 4. 验证结果（任务 §3）

| # | 验证项 | 结果 | 实测 |
|---|--------|------|------|
| 1 | startReview < 1s（HTTP 生命周期不调 provider） | ✅ | **10.5 ms** |
| 2 | review_turns 最多 3 条 | ✅ | **3** |
| 3 | review_opinions 最多 3 条 | ✅ | **3** |
| 4 | providerSource = lmstudio / fallback_mock / failed 可区分 | ✅ | `{"lmstudio":3}`（happy path 全 lmstudio） |
| 5 | providerSummary.hasRealProvider 正确 | ✅ | report=`true`，DB 实测=`true` 一致 |
| 6 | fallbackCount / failedCount 正确 | ✅ | report=0/0，DB 实测=0/0 一致 |
| 7 | Report API 返回 200 | ✅ | HTTP **200** |
| 8 | 单 review ≤ 3（cap 由代码保证） | ✅ | 提交 5 角色 → 实际 3 turns/3 opinions |
| 9 | 无 raw response / API Key / prompt 泄漏 | ✅ | 全量扫描 clean（见 §5） |

**E2E 汇总：10/10 checks passed。** REVIEW_ID=`96085be8-...-c36cf8498531`，FINAL_STATUS=`completed`，START_MS=10.5。

## 5. 泄漏扫描

对每条 `reviewOpinion`（含 `modelOutputRef`）做正则扫描，模式包含：`sk-...`、`api_key`、`Bearer ...`、rawText、系统提示词片段（"you are a technical reviewer"）。
**结果：clean** —— 队列仅落库结构化字段（dimension/riskLevel/issue/recommendation/confidenceScore）+ `modelOutputRef`（仅 `providerSource/providerName/modelName/fallback/durationMs`），不写 raw response、不写 prompt、不写 Key。

`modelOutputRef` 示例结构（成功路径，来自 `queue.service.ts:264`）：
```json
{ "providerSource": "lmstudio", "providerName": "lmstudio",
  "modelName": "google/gemma-4-12b", "fallback": false, "durationMs": 1234 }
```
可直接 `JSON.parse`，含 `providerSource` 字段（任务 §3 第 5 项要求）。

## 6. 鲁棒性演示（任务 §4，真实 LM Studio，非 dead-port 模拟）

`scripts/e2e-dev-pilot-robustness.js` 针对**运行中的真实 LM Studio** 验证失败分类矩阵：

| # | 场景 | 真实行为 | 分类 | 结果 |
|---|------|----------|------|------|
| A | `MODEL_TIMEOUT_MS=1` 真实调用超时（AbortError: "This operation was aborted"） | 单次 fallback 到 mock | `fallback_mock` + warn，不写 raw、不重试真实 provider | ✅ |
| B | `MODEL_PROVIDER=lmstudio` 但 `ALLOW_EXTERNAL_MODEL_CALLS≠true` | `getProvider()` 抛 GUARD | `failed` + `NO_RETRY`（不 fallback） | ✅ |
| C | `MODEL_PROVIDER=openai_compatible` 无 `MODEL_API_KEY` | `getProvider()` 抛 GUARD | 付费 API 永不静默启用 | ✅ |
| D | `modelOutputRef` 结构 | 恒为 `JSON.stringify` 对象 | 可 `JSON.parse`，含 `providerSource` | ✅ |

**鲁棒性汇总：5/5 checks passed。**

> 注：LM Studio 对未知 `model` 名表现宽容（直接服务已加载模型，不报错），故"坏模型名"无法触发错误；超时路径（合同明确列为"超时"）用于演示真实运行时失败 → `fallback_mock`，符合"不得手动包装成成功"。

## 7. 上限与合规确认

- **单 review ≤ 3**：happy path 提交 5 角色，代码 cap 截断为 3 → 3 turns / 3 opinions。上限由 7.3 代码（`applyPilotRoleCap`）硬保证，pilot env 关闭时不影响默认 mock。
- **无超发**：本 trial 共 1 条 review × 3 次真实 LM Studio 调用 = 3 次，远低于 cap。
- **默认值不变**：`.env` 仍为 `MODEL_PROVIDER="mock"`、`ALLOW_EXTERNAL_MODEL_CALLS=false`，常驻 :4000 实例仍为 mock；真实 provider 从未成为默认。
- **未接 openai_compatible / 付费 API**：需 `MODEL_API_KEY`，本环境不设 → 结构性 GUARD。
- **未改 schema / 前端 / pilot 源码**：本 Sprint 仅新增验证脚本，源码零改动。

## 8. 清理

- 停止专用 pilot 实例（pid 16264，端口 4100 已释放）。
- 删除 dev review 及其 3 turns / 3 opinions（Prisma 级联），`exists=false` 验证已移除。
- dev Postgres 回到 trial 前状态（review 计数不变）。

## 9. 可复现命令

```bash
# 1) 启动专用 pilot 实例（内联 pilot env，不污染 .env）
cd apps/api
PORT=4100 DATABASE_URL="postgresql://prismreview:prismreview@localhost:5432/prismreview?schema=public" \
REDIS_URL="redis://localhost:6379" WEB_ORIGIN="http://localhost:3000" \
MINIO_ENDPOINT="localhost:9000" MINIO_ACCESS_KEY="prismreview" MINIO_SECRET_KEY="prismreview-secret" MINIO_BUCKET="prismreview" \
MODEL_PROVIDER="lmstudio" ALLOW_EXTERNAL_MODEL_CALLS="true" \
MODEL_BASE_URL="http://127.0.0.1:1234/v1" MODEL_NAME="google/gemma-4-12b" \
ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL="false" \
node dist/main.js

# 2) 受控 E2E（happy path，真实 LM Studio，cap=3）
cd apps/api
NODE_PATH="$PWD/node_modules" DATABASE_URL="postgresql://prismreview:prismreview@localhost:5432/prismreview?schema=public" \
node ../../scripts/e2e-dev-pilot-lmstudio.js
# → 10/10 passed

# 3) 鲁棒性演示（真实 LM Studio 失败分类）
NODE_PATH="$PWD/node_modules" \
node ../../scripts/e2e-dev-pilot-robustness.js
# → 5/5 passed
```

> 实际运行需本机 LM Studio 已加载模型且 `MODEL_NAME` 匹配 `/v1/models` 返回。

## 10. 结论

Sprint 7.4 在 **dev-only、本地 LM Studio、禁止付费/ openai_compatible** 约束下，跑通了真实后端链路（`startReview → 内存队列 → agent turns → report`）：startReview 10.5ms、单 review 严格 ≤3（代码 cap 保证）、`providerSource=lmstudio`、`hasRealProvider=true`、fallback/failed 计数正确、Report API 200、全量无 raw/Key/prompt 泄漏。鲁棒性矩阵（真实超时→fallback_mock、guard→failed、openai_compatible 关闭）亦全部通过。**全链路 15/15 验证通过，红线全守，建议 Gate = Go。**
