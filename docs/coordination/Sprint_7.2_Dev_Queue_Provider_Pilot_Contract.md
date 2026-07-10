# Sprint 7.2 — Dev-only Queue Real Provider Pilot Contract

> **类型**：reasonix 后端契约（标准流程，非快速 Gate）
> **模式**：只写合同文档，**不改代码**、**不运行真实模型**
> **目标**：设计 **dev-only queue 真实 provider 试点方案**——允许在**显式 env guard** 下让 queue（`agent.turn.execute` job）调用 **LM Studio (`lmstudio`)**，验证 DB opinions 落地与 providerSummary 聚合，但**不得改变默认 mock demo**。
> **依据文档**：`Sprint_7.0_Real_Provider_Pilot_Contract.md`（试点总合同 / Guard / 成本安全 / 后续拆分）、`Sprint_7.1_Workbuddy_Review.md`（standalone lmstudio spike，Go）、`Sprint_7.1B_Workbuddy_Review.md`（spike hygiene 加固，Go）、`MVP_RELEASE_SNAPSHOT.md`（§4 安全边界 / §6 技术债 P1）
> **代码 grounding（只读核对，不改）**：`apps/api/src/modules/reviews/queue/queue.service.ts`、`scripts/provider-adapter.js`
> **红线**：真实 LLM 接入 queue → 触发协议 §5.5 独立 Gate；本 Sprint 仅定合同，不实现、不接默认主链路、不改默认 mock。

---

## 0. 本 Sprint 边界（Scope）

| 做 | 不做 |
|----|------|
| 定义 dev-only queue 试点的边界、启用条件、调用上限、queue 行为、fallback/failure 分类、可观测性、安全、验收、禁止、后续拆分 | 不改任何 `.ts` / `scripts` / `schema.prisma` |
| 复用 `queue.service.ts` **既有** `getProvider()` 接入与失败分类（不重造）、`provider-adapter.js` 既有 Guard | 不真实运行 `lmstudio` / 不跑 queue pilot（留待 7.3 实现 + 实测） |
| 明确"仅 LM Studio 优先、openai_compatible 暂不接 queue、默认 mock 不变" | 不接 `openai_compatible` 到 queue（除非另开 Gate） |
| 规定 7.3 实现 / 7.4 demo 刷新 的拆分 | 不改前端 / 不改 schema / 不让真实 provider 成为默认 |

> **关键事实（诚实标注）**：经只读核对，`queue.service.ts` 的 `executeAgentTurn()` **已**通过 `getProvider()` 接入 provider-adapter，并已实现 guard→failed / auth→failed / runtime→fallback_mock / success 四类落库（详见 §4/§5 引用行号）。因此"dev-only queue 调用 lmstudio"在**显式 env guard 下当前即可运行、无需改默认 mock**。本 Sprint 合同的核心价值在于：① 明确试点的**运行边界与验收**；② 识别 7.3 实现的**真实缺口**（调用上限强约束、raw dump 抑制确认等），避免把"已具备的能力"误报为"需新建"。

---

## 1. 试点边界（Pilot Boundary）

| 规则 | 说明 | 违反即 No-Go |
|------|------|--------------|
| **dev-only** | 仅在本地 / 开发环境、由人工显式设置 env 后运行；不进生产、不进 CI 默认路径、不进任何自动调度 | P0 |
| **默认 mock 不变** | 未显式设置 `MODEL_PROVIDER` 的进程（含默认 demo、Route A/B、SSE、CI）一律 mock；`getProvider():208-210` 未改，默认零外部依赖 | P0 |
| **仅 LM Studio 优先** | 本试点真实 provider 仅限 `lmstudio`（本地、零成本、无 Key、无数据出域） | P0 |
| **openai_compatible 暂不接 queue** | 除非**另开独立 Gate**（Key 管理 + 预算审查 + 数据出域评估），否则 queue 路径不启用 `openai_compatible`；本 Sprint 明确排除 | P0 |

**范围锚点**：试点限定在**专用 pilot review**（非默认 demo review），通过 `scripts/setup-demo-review.js --with-runner`（或等价 dev 脚本）在 dev 环境构造，人工触发一次，观察 DB 落地与 Report。

---

## 2. 启用条件（Activation Conditions）

> 复用 `provider-adapter.js` `getProvider()` / `getConfig()` 既有语义（Sprint 4.4A），本 Sprint **不新增/不修改** env 变量语义，仅约束试点取值。

| 变量 | 试点取值 | 说明 | 代码依据 |
|------|----------|------|----------|
| `MODEL_PROVIDER` | `lmstudio` | 选择 LM Studio provider | `provider-adapter.js:205, 212-219` |
| `ALLOW_EXTERNAL_MODEL_CALLS` | `true` | 外部调用安全闸；非 `true` → GUARD（fail-closed） | `:206, 213-217` |
| `MODEL_BASE_URL` | **必须含 `/v1`**（如 `http://127.0.0.1:1234/v1`） | LM Studio OpenAI 兼容端点；adapter 以 `${baseUrl}/chat/completions` 拼接，缺 `/v1` 将 404 | `:32, 115` |
| `MODEL_NAME` | LM Studio **已加载**的模型（如 `google/gemma-4-12b`） | 与本地已加载模型一致，否则报错 | `:33, 118` |

**启用矩阵（沿用 4.4A §3.1 / adapter `getProvider()`）**：

| MODEL_PROVIDER | ALLOW_EXTERNAL_MODEL_CALLS | 结果 |
|----------------|----------------------------|------|
| 未设置 / `mock` | 任意 | ✅ mock（默认，queue 走 `mockProvider`） |
| `lmstudio` | `true` | ✅ lmstudio（queue `executeAgentTurn` 走真实调用） |
| `lmstudio` | 非 `true` | ❌ GUARD → NO_RETRY failed（见 §5） |
| `openai_compatible` | 任意 | ⛔ 本试点禁用（另开 Gate） |

**试点专属约束**：
- `MODEL_API_KEY` 在 lmstudio 路径**不需要**、**不得设置**（LM Studio 本地无鉴权）。
- Guard 不可绕过：queue 必须经 `getProvider()`（`:181-186`），不得直接 `fetch` 外部 endpoint。

---

## 3. 调用上限（Call Limits）

| 规则 | 要求 | 现状（诚实核对） |
|------|------|------------------|
| **单次 review 最多 3 roles** | pilot review 的 `roleSelection.roles` 数 ≤ 3（如 CTO / CFO / PMO） | ⚠️ **代码未强制**：`executeReviewStart():130-146` 按 `roleSelection.roles` 全量派发 turn，不截断。试点期以**构造 pilot review 时只选 ≤3 角色**来满足；7.3 可选新增 `MODEL_PILOT_MAX_ROLES` 硬约束（见 §10） |
| **总调用数上限** | 复用 adapter 既有 `MODEL_DAILY_CALL_LIMIT`（默认 100）；试点建议下调至 `10` 以内 | ✅ adapter `checkBudget():54-59` 已实现每日调用上限（openai 路径强制；lmstudio 路径 `lmstudioProvider` 仅 `recordSuccess`，不主动 `checkBudget`——见下）。**注**：lmstudio 本地零成本，`checkBudget/checkCircuit` 仅在 openai 路径调用（`:180`）；lmstudio 靠"pilot review ≤3 roles + 人工单次触发"控量 |
| **失败即停 / fallback 策略明确** | runtime error → 单次 fallback_mock（不自动扩大调用）；guard/auth → failed（不 fallback）；**均不自动重试真实 provider** | ✅ 见 §5，`executeAgentTurn` 对 runtime error 捕获后单次 fallback、job 完成，**不重试真实 provider**；仅 guard/auth 抛 `NO_RETRY:`（`:204, 242`） |

**控量原则**：试点靠"**专用 pilot review + 角色 ≤3 + 人工单次触发 + 不批量遍历**"实现总量可控，而非依赖代码硬上限；若要强约束，列入 7.3。

---

## 4. queue 行为（Queue Behavior）

> 全部基于 `queue.service.ts` 只读核对，本 Sprint **不改** 这些行为。

| 要求 | 现状核对 | 代码依据 |
|------|----------|----------|
| **startReview 仍 <1s，不在 HTTP 生命周期执行 provider** | ✅ HTTP 侧仅 `enqueue('review.start', ...)`；queue 以 `setTimeout` 异步 `processNext`，provider 调用发生在**异步 job** 内，不阻塞 HTTP 响应 | `enqueue():34-52` + `scheduleProcessing():54-58`（`POLL_INTERVAL=100ms` 异步） |
| **provider 只在 `agent.turn.execute` job 中执行** | ✅ `review.start` 只派发子 job（不调 provider）；`getProvider()` + `provider.run()` 仅在 `executeAgentTurn()` 内 | `executeReviewStart():113-147`（仅 enqueue）；`executeAgentTurn():181-212`（唯一调用点） |
| **provider 只收 objective，不收全文** | ✅ `provider.run(roleCode, objective)` 传 `review.objective`，非用户原始文档/rawText | `executeAgentTurn():152, 212` |
| **meeting.complete 仍由 DB turn 状态判断** | ✅ `checkMeetingComplete` 从 DB `count` 终态 turn；`executeMeetingComplete` 再次从 DB 重算 completed/failed，幂等，不依赖 payload 计数 | `checkMeetingComplete():293-311` + `executeMeetingComplete():315-359` |

**试点不改动点**：job 类型（`review.start` / `agent.turn.execute` / `meeting.complete`）、DB 幂等（turn 终态 skip `:155-161`、meeting 状态 skip `:321-324`）、in-memory queue 结构均保持不变。

---

## 5. fallback / failure 分类（复用既有实现，不改）

> `executeAgentTurn()` 的错误分类**已实现**，本 Sprint 仅"引用 + 约束试点解读"，不修改。

| 场景 | 处理 | providerSource | 是否 fallback | 是否 retry | 代码依据 |
|------|------|----------------|---------------|-----------|----------|
| **Guard/config error**（`MODEL_PROVIDER=lmstudio` 但 `ALLOW≠true` 等） | turn=failed + failed opinion stub；抛 `NO_RETRY:` | `failed` | ❌ 不 fallback | ❌ NO_RETRY | `:187-205, 76-79` |
| **Auth error（HTTP 401/403）** | turn=failed + failed opinion；`Bearer ***` 脱敏；抛 `NO_RETRY:` | `failed` | ❌ 不 fallback | ❌ NO_RETRY | `:226-243` |
| **普通 runtime error**（5xx / 网络 / 其它非鉴权异常） | 单次 fallback → `mockProvider`；`warn` 日志 `[Fallback] lmstudio → mock`；job 完成 | `fallback_mock` | ✅ fallback | ❌ 不重试真实 provider | `:244-257` |
| **LM Studio timeout** | `AbortController` 触发 → `AbortError` → 归为 runtime error → fallback_mock | `fallback_mock` | ✅ | ❌ | adapter `:110-111, 127` → queue `:244-257` |
| **empty content / invalid JSON** | adapter `callOpenAICompatible` 抛 `Unparseable response` → runtime error → fallback_mock | `fallback_mock` | ✅ | ❌ | adapter `:140-142` → queue `:244-257` |
| **成功** | 用 provider 元数据；turn=completed | `lmstudio` | — | — | `:212-222` |

**契约裁定（与用户要求逐条对齐）**：
1. **普通 runtime error → `fallback_mock`**：✅ 是（`:244-257`）。fallback 必带 `warn` 日志且 opinion `modelOutputRef.providerSource='fallback_mock'`、`fallback:true`。
2. **guard/auth/config error → `failed`，不 fallback**：✅ 是（guard `:187-205`、auth `:226-243`），均抛 `NO_RETRY:` 立即失败、不重试、不 fallback。
3. **timeout / empty / invalid JSON**：✅ 统一归为 runtime error → 单次 fallback_mock（不自动重试真实 provider）。

> **无静默 fallback**：所有 fallback 均 `warn` 记录且在 Report 可见（`source` / providerSummary 体现）。

---

## 6. 可观测性（Observability）

| 要求 | 现状核对 | 代码依据 |
|------|----------|----------|
| `modelOutputRef.providerSource ∈ {lmstudio, fallback_mock, failed}` | ✅ 成功=`lmstudio`（`:216 result.provider`）；runtime→`fallback_mock`（`:249`）；guard/auth→`failed`（`:201, 239`） | `:201, 216, 239, 249, 270` |
| `providerSummary` 正确体现来源 | ✅ Report 聚合 `bySource / fallbackCount / failedCount / models / hasRealProvider`；本试点混合场景应体现 `lmstudio` 计数 + `hasRealProvider:true`（若有真实成功 turn） | 5.1 落库语义 + `modelOutputRef` JSON |
| Report 页能看到真实模型参与 / fallback / failed | ✅ 五态来源标签（Mock/LMStudio/OpenAI/Fallback/Failed）+ 蓝/橙/红条件标签（5.3–5.4 前端已实现，无需前端改动） | MVP_SNAPSHOT §2 能力 7 |

**验收观测口径**：pilot review 完成后，`GET /report` 的 `source=db_opinions`，`providerSummary.bySource.lmstudio ≥ 1`（成功路径）或对应 `fallback_mock` / `failed` 计数准确；`hasRealProvider` 仅当存在真实 `lmstudio` turn 时为 `true`。

---

## 7. 安全（Safety）

| 规则 | 要求 | 现状核对 |
|------|------|----------|
| **不记录 raw prompt / raw response** | opinion 仅存结构化字段 + `reasoningSummary`（≤200 字）+ `modelOutputRef`（结构化 JSON）；**不落 `rawText`** | ✅ `reviewOpinion.create():260-272` 未写 `rawText`；`buildReasoningSummary():283-289` 仅 `src=... \| model \| reason` |
| **不输出 `DEBUG_PROVIDER_RAW`** | queue 路径**无** `DEBUG_PROVIDER_RAW` 分支（该门控仅在 7.1B spike 脚本）；试点运行时**不得**设置该 env | ✅ queue 无 raw dump；spike 侧默认关闭（7.1B `:104-129` 门控） |
| **不把完整原文送模型** | provider 仅收 `objective`（目标摘要），非用户原始文档全文 | ✅ `provider.run(roleCode, objective):212` |
| **API Key 不进代码/文档/日志** | lmstudio 无 Key；日志 401/403 已 `Bearer ***` 脱敏 | ✅ `:227` 正则脱敏；文档零 Key（仅占位） |

---

## 8. 验收（Acceptance Criteria）

> 以下为 **7.3 实现 + dev-only 实测**必须逐条满足的验收项（Gate 证据来源）。本 Sprint 仅定义，不执行。

| # | 验收项 | 判定方法 |
|---|--------|----------|
| 1 | **创建测试 review** | 构造专用 pilot review（非默认 demo），`roleSelection.roles` ≤ 3 |
| 2 | **queue 执行 1–3 roles** | 设 `MODEL_PROVIDER=lmstudio` + `ALLOW_EXTERNAL_MODEL_CALLS=true` + `MODEL_BASE_URL(.../v1)` + `MODEL_NAME`，触发后 queue 派发并执行 1–3 个 `agent.turn.execute` job |
| 3 | **review_turns / review_opinions 写入** | DB `ReviewTurn` 各 turn 达终态（completed/failed）；`ReviewOpinion` 每 turn 一条，含 dimension/riskLevel/confidenceScore/modelOutputRef |
| 4 | **Report API `source=db_opinions`** | `GET /api/reviews/{id}/report` 返回 `source=db_opinions`（有 DB opinions） |
| 5 | **providerSummary 准确** | `hasRealProvider=true`（有真实 lmstudio 成功 turn）**或** fallback/failed 状态与实际一致（`bySource` / `fallbackCount` / `failedCount` 对得上 turn 结果） |
| 6 | **Markdown export 可导出且含安全摘要** | `GET /report/export.md` 200、非空；含 providerSummary/verdict/objective/risks/opinions；**不含** rawText / prompt / API Key / modelOutputRef 原始 JSON |

**额外 Gate 证据（标准流程）**：7.3 须附实测记录（env 配置摘要含 Key 遮罩、turn/opinion 落地样本、providerSummary 样本、Report source、export 首行与安全扫描结果）；`apps/api` `tsc --noEmit` 0 errors（若触及 TS）；失败分支（guard/auth/timeout/unparseable）至少构造 1 例验证分类正确；确认默认 mock（不设 env）回归通过（Route A/B 不受影响）。

---

## 9. 禁止（Explicit Prohibitions）

| # | 禁止项 | 理由 |
|---|--------|------|
| 1 | **不改前端** | 五态来源标签（真实模型参与 / fallback / failed）已在 5.3–5.4 实现，无需前端改动 |
| 2 | **不改 schema** | 复用既有 `ReviewTurn` / `ReviewOpinion` / `modelOutputRef`(String?) / `reasoningSummary`(String?)；不新增/迁移 Prisma 字段 |
| 3 | **不接 openai_compatible** | queue 路径本试点仅 lmstudio；openai_compatible 需另开独立 Gate（Key/预算/出域） |
| 4 | **不让真实 provider 成为默认** | 未显式设 env 一律 mock；`getProvider():208-210` 不改；不改任何默认 demo / CI / 调度 |
| 5 | 不设置 `DEBUG_PROVIDER_RAW` / 不落 rawText | 见 §7 安全 |
| 6 | 不批量遍历 review/角色、不自动重试真实 provider、不自动扩大调用 | 见 §3 调用上限 + §5 失败即停 |

---

## 10. 后续 Sprint 拆分（Follow-up Breakdown）

| Sprint | 类型 | 目标 | 边界 |
|--------|------|------|------|
| **7.2**（本 Sprint） | reasonix 合同 | dev-only queue 真实 provider 试点合同 | 只写文档，不实现、不运行 |
| **7.3 Implementation** | 实现 + dev-only 实测 | 在专用 pilot review 上以 dev-only 方式实跑 lmstudio 走 queue，满足 §8 验收 6 项；如需，补 `MODEL_PILOT_MAX_ROLES`（单 review ≤3 硬约束）与 lmstudio 路径的调用计量 | 不改默认 mock / 不改前端 / 不改 schema / 不接 openai_compatible；仍走独立 Gate |
| **7.4 Demo / Runbook Refresh** | 文档 | 将"dev-only queue 真实 provider 试点"步骤与"真实模型参与 / fallback / failed"实测证据写入 `MVP_Demo_Runbook.md` / `Frontend_Demo_QA_Checklist.md` | 只改文档；不接默认主链路 |

**Gate 串联**：7.2（合同）→ 7.3（实现 + dev-only 实测 + qoderwork Review + Gate）→ 7.4（文档刷新）。任一环节未走完对应独立 Gate，不得让真实 provider 进入默认主链路。

---

## 11. 与既有文档/代码的关系

- **复用（不重造）**：`queue.service.ts` 既有 `getProvider()` 接入、失败分类（guard/auth/runtime）、DB 幂等、`checkMeetingComplete`/`executeMeetingComplete` DB 驱动；`provider-adapter.js` 既有 Guard 矩阵 / `getConfig` / `mockProvider`；`Sprint_7.0` 试点总合同；`Sprint_7.1/7.1B` spike hygiene（DEBUG_PROVIDER_RAW 门控、parse 失败 fail-closed）。
- **对齐**：`Sprint_7.0` §8 拆分（7.2 dev-only queue pilot）；`MVP_RELEASE_SNAPSHOT.md` §4 安全边界（默认 mock / 真实 provider 需独立 Gate）、§6 技术债 P1（真实模型成功路径未端到端验证）。
- **本 Sprint 澄清的现状**：queue 已具备真实 provider 接入与失败分类能力（无需新建），7.3 的真实工作量在于 **dev-only 实测 + 验收取证 + 可选调用上限硬约束**，而非重造 provider 链路。

---

## 12. 本 Sprint 交付与 Gate 状态

- **交付物**：本契约文档 `docs/coordination/Sprint_7.2_Dev_Queue_Provider_Pilot_Contract.md`（仅文档）。
- **代码变更**：无。
- **真实模型调用**：无（本 Sprint 不执行 pilot）。
- **Gate 定位**：标准流程的合同环节；待 7.3 实现 + dev-only 实测后由 qoderwork Review + Gate 凭 §8 证据判定。本 Sprint 自身作为"合同被采纳"即视为推进条件，不替代 7.3 的运行 Gate。
- **红线合规**：未改代码 / 未接默认主链路 / 未改默认 mock / 未运行真实模型 / 未写 Key / 无绝对路径。
