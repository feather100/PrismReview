# Sprint 7.2 Dev-only Queue Real Provider Pilot Contract — WorkBuddy Review

> **模式**：标准流程（协议 §5.5 独立 Gate，非快速 Gate）
> **复审对象**：`Sprint_7.2_Dev_Queue_Provider_Pilot_Contract.md` + 代码只读核对（`queue.service.ts`、`provider-adapter.js`、`reviews.service.ts`、`reviews.controller.ts`）
> **触发**：用户提交 Sprint 7.2 契约复审
> **复审人**：WorkBuddy（只读 Gate 模式）
> **复审时间**：2026-07-10 07:52

---

## 结论：**Go（无保留）**

契约文档事实准确、与既有代码逐行吻合，10 项重点检查全部通过。本 Sprint 为纯合同文档（不改代码、不跑真实模型），核心价值在于明确 dev-only queue 试点的运行边界、失败分类与 7.3 真实缺口，且诚实标注了"queue 已具备真实 provider 接入能力、无需重造"的现状。

---

## 证据（10 项）

| # | 检查 | 结果 | 关键证据 |
|---|------|------|---------|
| 1 | dev-only，默认 mock 不变 | ✅ | `getProvider():208-210`（`if (!provider || 'mock') return mock`）逐行核实未改；契约 §1/§9 多处置 P0 红线 |
| 2 | 仅 lmstudio，openai_compatible 不进 queue | ✅ | 结构性控制：openai_compatible 需 `MODEL_API_KEY`（adapter `:227`）；lmstudio 试点不设这个 Key，故 openai_compatible 无法激活；契约 §1 明确 P0 排除 + §9 禁止项 #3 |
| 3 | startReview <1s，HTTP 生命周期不调模型 | ✅ | `reviews.service.ts:166-182` 仅 `assertReview` + `prisma.update` + `queueService.enqueue('review.start')` 即返回 `{sessionId,'running'}`；provider 仅在异步 job 内执行 |
| 4 | provider 只在 `agent.turn.execute` job 执行 | ✅ | `executeReviewStart():113-147` 仅 enqueue 子 job；`getProvider()`+`provider.run()` 唯一调用点在 `executeAgentTurn():181-212`（`:212`） |
| 5 | guard/auth/config error fail closed，不 fallback | ✅ | Guard `:187-205`（catch getProvider → failed turn + failed opinion stub + `NO_RETRY`）；Auth `:226-243`（401/403 → `NO_RETRY`、`Bearer ***` 脱敏）|
| 6 | runtime/timeout/invalid JSON fallback 规则清楚 | ✅ | runtime `:244-257` 单次 `fallback_mock` + `[Fallback]` warn + 不重试；timeout=AbortError→runtime（adapter `:110-111`）；invalid JSON=Unparseable→runtime（adapter `:140-142`）|
| 7 | modelOutputRef/providerSummary/Report/Markdown 可观测性覆盖 | ✅ | modelOutputRef `providerSource∈{lmstudio,fallback_mock,failed}`（`:201,:216,:239,:249`）；providerSummary 由既有 `buildProviderSummary` 聚合；Report 五态标签（MVP_SNAPSHOT §2 能力7）；Markdown export 含 providerSummary（6.1 已验）|
| 8 | 禁止 raw prompt/raw response/API Key 记录 | ✅ | `reviewOpinion.create():260-272` 仅结构化字段 + reasoningSummary + modelOutputRef，**不落 rawText**；`buildReasoningSummary():283-289` 仅 `src=\|model\|reason`；queue 无 `DEBUG_PROVIDER_RAW` 分支；lmstudio 无 Key；401/403 日志 `Bearer ***` 脱敏（`:227`）|
| 9 | 无代码改动、无真实模型调用 | ✅ | 契约全文为合同文档；所引代码行号与磁盘实现逐字吻合（即反映既有代码，非新增）；本 Sprint 不执行 pilot（验收留 7.3）|
| 10 | 7.3 实现边界足够窄 | ✅ | 7.3 = 实现 + dev-only 实测（不改默认 mock/前端/schema/不接 openai_compatible）；7.4 = 纯文档刷新；Gate 串联明确 |

---

## 代码核对细节（可信度支撑）

- **失败分类矩阵全部可达**：
  - Guard：`getProvider()` 在 `allow!=='true'` 抛 GUARD（adapter `:213-217`）→ queue `:187` catch → `NO_RETRY` ✅
  - Auth：`callOpenAICompatible` 非 2xx 抛 `API HTTP 401/403`（adapter `:129-131`）→ queue `:226` 判定 → `NO_RETRY` ✅
  - Runtime：`lmstudioProvider` 经 `callOpenAICompatible`（adapter `:163-173`，无 apiKey）→ 任何异常归 runtime → `:244-257` 单次 fallback ✅
  - 注：lmstudio 本地无鉴权，故 auth 分支在 lmstudio 试点实际不触发，但代码路径完整、可被 openai_compatible 复用——属正确复用，非缺陷。
- **provider 仅收 objective**：`provider.run(roleCode, objective):212`（objective 来自 `review.objective`，非用户原始文档全文）✅
- **幂等**：turn 终态 skip（`:155-161`）、meeting 状态 DB 重算 skip（`:321-324`）✅

---

## 非阻塞说明（供 7.3 参考，不拦 Gate）

- **调用上限为配置纪律，非代码硬约束**：契约 §3 诚实标注"代码未强制单 review ≤3 roles"（`executeReviewStart():130-146` 全量派发）。lmstudio 试点靠"专用 pilot review + 角色 ≤3 + 人工单次触发"控量；如需强约束，列入 7.3 可选 `MODEL_PILOT_MAX_ROLES`。本契约已对此留痕，符合要求。
- **openai_compatible 排除为策略约束**：queue 代码未写"禁止 openai_compatible"专属分支，依赖 (a) dev-only 人工 env 纪律 + (b) openai_compatible 需 `MODEL_API_KEY`（lmstudio 试点不设）双重结构性控制。契约 §1/§9 已明确 P0 排除并声明"另开独立 Gate"，足以作为合同级约束。
- **真实模型调用留待 7.3**：本 Sprint 不跑 pilot，§8 验收 6 项 + 标准流程 Gate 证据（Key 遮罩、turn/opinion 样本、providerSummary、export 安全扫描、失败分支构造、默认 mock 回归）均定为 7.3 实跑取证。

---

## 结论

Sprint 7.2 契约诚实、准确、与代码逐行对齐，10 项重点全过，且明确不走快速 Gate、不改默认 mock/前端/schema、不接 openai_compatible、不跑真实模型。**Gate = Go（无保留）**，合同被采纳即视为推进条件，待 7.3 实现 + dev-only 实测后凭 §8 证据走标准流程 Gate 判定。
