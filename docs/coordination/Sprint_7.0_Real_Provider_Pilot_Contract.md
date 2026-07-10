# Sprint 7.0 — Controlled Real Provider Pilot Contract

> **类型**：reasonix 后端契约（标准流程，非快速 Gate）
> **模式**：只写合同文档，**不改代码**、**不真实调用外部模型**
> **目标**：设计真实 Provider 小流量试点方案，验证真实模型成功路径，但**不得默认接入主链路**
> **依据文档**：`Sprint_4.4A_Provider_Guard_Contract.md`（env var / Guard / 预算 / 输出 JSON）、`Sprint_4.4E_OpenAI_Compatible_Spike_Backend.md`（standalone spike 模式）、`Sprint_5.1_Observability_Backend.md`（modelOutputRef / providerSummary 落库语义）、`Sprint_5.7_MVP_Freeze_Next_Track.md` §5 路线 B（独立 Gate 要求）、`MVP_RELEASE_SNAPSHOT.md` §7 下一阶段候选 #3
> **红线**：真实 LLM 首次接入 → 触发协议 §5.5 独立 Gate；本 Sprint 仅定合同，不实现、不接主链路

---

## 0. 本 Sprint 边界（Scope）

| 做 | 不做 |
|----|------|
| 定义试点范围、Provider 候选、Guard 配置、成本/安全/数据边界、验收标准、后续拆分 | 不改任何 `.ts` / `scripts` / `schema.prisma` |
| 复用 Sprint 4.4A 既有 `getProvider()` Guard 与 `AgentTurnResult` 契约（不重造） | 不真实调用 `lmstudio` / `openai_compatible` |
| 明确"不接 startReview 主链路 / 不接默认 queue / 不改前端 / 不改 schema" | 不在文档/代码/日志写入 API Key |
| 规定 7.1 spike / 7.2 dev-only queue pilot / 7.3 demo 刷新 的拆分 | 不默认启用真实模型 |

> 凡涉及真实外部模型，一律走**独立 Gate**（协议 §5.5 + 5.7 §5 路线 B）：Provider Contract → Key 与预算审查 → standalone spike → qoderwork Review → Gate 判定。本 Sprint 仅为该链路的"合同"环节。

---

## 1. 试点范围（Pilot Scope）

| 规则 | 说明 | 违反即 No-Go |
|------|------|--------------|
| **standalone spike 优先** | 真实调用只在 `scripts/spike-provider-guard.js` / `scripts/spike-agent-turn.js` 等独立脚本内进行，不进入 queue / startReview / Meeting SSE 任何主链路 | P0 |
| **最多 1–2 个角色** | 单次试点覆盖角色数 ≤ 2（如仅 `CTO` 或 `CTO`+`CFO`），不覆盖全部 5 预置角色 | P0 |
| **禁止批量调用** | 不循环遍历所有 review / 所有角色批量发起真实调用；每次人工触发、显式指定 `--role` | P0 |
| **禁止默认启用真实模型** | 不设置 `MODEL_PROVIDER` 时系统仍走 `mock`；真实模型仅在显式设置 env 的 spike 会话内生效，且不影响任何默认 demo | P0 |

**试点容量上限（建议）**：
- 7.1 spike：每 provider 最多验证 **3 次**成功调用（1–2 角色 × 1–2 次），纯成功路径探针。
- 7.2 dev-only queue pilot：限定在**专用 pilot review**（非默认 demo review），角色 ≤ 2，调用次数 ≤ 5。

---

## 2. Provider 候选（Provider Candidates）

> 语义与 `Sprint_4.4A` §1 / §7 完全一致；本表聚焦"试点维度"取舍。

| Provider | 标识符 | 类型 | 优点 | 风险 / 限制 | 试点定位 |
|----------|--------|------|------|-------------|----------|
| **LM Studio** | `lmstudio` | 本地进程 | 零成本、离线、无 Key、无数据出域 | 质量/速度不稳定（Gemma-4-12b 约 30–40s/角色，中文质量 ⭐⭐⭐） | 首选试点（安全边界最宽） |
| **OpenAI Compatible** | `openai_compatible` | 外部 API | 质量更强（如 DeepSeek-V4-Flash / GLM-5.2 中文 ⭐⭐⭐⭐⭐） | 需 `MODEL_API_KEY`、产生成本、方案原文出域需管控 | 验证成功路径的"强模型"样本 |

**试点顺序建议**：先 `lmstudio`（本地、零外泄风险）跑通成功路径 → 再 `openai_compatible`（仅在有 Key 且通过预算/数据安全审查后）做一次小流量验证。

---

## 3. Guard（复用 Sprint 4.4A，不重造）

> 以下 Guard 已在 `scripts/provider-adapter.js` `getProvider()` 实现并 fail-closed（见 4.4A §3、4.7 证据）。本 Sprint 仅"引用 + 约束试点用法"，**不修改** Guard 逻辑。

### 3.1 环境变量合同（沿用 4.4A §2）

| 变量 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `MODEL_PROVIDER` | `"mock" \| "lmstudio" \| "openai_compatible"` | 选择 provider | `"mock"` |
| `ALLOW_EXTERNAL_MODEL_CALLS` | `"true" \| ""` | 是否允许外部调用（生产安全闸） | `""`（禁止） |
| `MODEL_BASE_URL` | URL | lmstudio / openai_compatible 的 Base URL | `http://127.0.0.1:1234/v1`（lmstudio 示例） |
| `MODEL_API_KEY` | string | **仅 `openai_compatible` 需要** | 不设置（mock/lmstudio 不需要） |
| `MODEL_NAME` | string | 模型名 | `google/gemma-4-12b` |
| `MODEL_TIMEOUT_MS` | number | 超时（毫秒） | `120000` |
| `MODEL_MAX_TOKENS` | number | 最大 token | `2048` |
| `MODEL_BUDGET_LIMIT` | number | 单次会话预算（美元） | `0.10` |
| `MODEL_DAILY_CALL_LIMIT` | number | 每日最大调用次数 | `100` |

### 3.2 启用矩阵（沿用 4.4A §3.1）

| MODEL_PROVIDER | ALLOW_EXTERNAL_MODEL_CALLS | MODEL_API_KEY | 结果 |
|----------------|----------------------------|---------------|------|
| 未设置 / `mock` | 任意 | 任意 | ✅ mock（默认） |
| `lmstudio` | `"true"` | 不需要 | ✅ lmstudio |
| `lmstudio` | 非 `"true"` | 任意 | ❌ GUARD |
| `openai_compatible` | `"true"` | 存在且非空 | ✅ openai_compatible |
| `openai_compatible` | `"true"` | 未设置 | ❌ GUARD（MODEL_API_KEY required） |
| `openai_compatible` | 非 `"true"` | 任意 | ❌ GUARD |

### 3.3 试点专属约束

- **默认仍 mock**：任何未显式设置 `MODEL_PROVIDER` 的进程（含 demo、queue、SSE）一律 `mock`，真实 provider 只在 spike 专用进程内通过 env 注入生效。
- **`MODEL_API_KEY` 仅 `openai_compatible` 需要**：lmstudio 不得要求 Key；若 openai_compatible 未设 Key，Guard 必须 fail-closed（不 fallback、不调用）。
- **Guard 不可绕过**：试点脚本必须经由 `getProvider()`，不得直接 `fetch` 外部 endpoint 跳过 Guard。

---

## 4. 成本与安全（Cost & Safety）

| 规则 | 要求 | 来源 |
|------|------|------|
| **API Key 不进代码/文档/日志** | Key 仅存本地环境变量 / `.env`（已 gitignore）；文档用 `sk-...` 占位；日志/错误/HTTP 响应中不得出现完整 Key（4.4E 已验证 `(unset)` 遮罩） | 4.4A §3.2 |
| **单次调用预算上限** | 启用 `MODEL_BUDGET_LIMIT`（建议试点值 `$0.05`/call、`$0.10`/session）；超预算 → 拒绝调用并 fallback mock（4.4A §4.2） | 4.4A §4 |
| **失败即停，不自动扩大调用** | 超时 / 5xx / JSON 解析失败 / 401·403 → 单次结束，**不自动 retry 外部 provider**、不扩大调用次数；401·403 与 Guard 错误**不 fallback**（配置错误，须显式修复） | 4.4A §4.2 / §5.1 |
| **Circuit Breaker（仅 openai_compatible）** | 连续 5 次失败 → OPEN，15 分钟内拒绝外部调用；lmstudio 本地无成本不启用 | 4.4A §4.3 |
| **Silent Fallback 禁止** | 任何 fallback 必须 `warn` 日志 `[Fallback] ${provider} → mock, reason: ${reason}` + Report 标注 `source: 'mock_fallback'` | 4.4A §5.2 |

**试点强化**：7.1 spike 每次运行前打印当前预算/限额配置摘要（Key 仍遮罩），运行后打印实际调用次数与估算成本，便于人工核对"未超上限、未自动扩大"。

---

## 5. 数据安全（Data Safety）

| 规则 | 要求 | 来源 |
|------|------|------|
| **不发送敏感原文** | 发送给外部 provider 的方案内容须脱敏/最小化；不发送用户原始文档全文、不发送内部凭据/PII | 协议红线 + 5.7 §5 路线 B |
| **prompt 最小化** | spike 文案仅含"角色 + 维度 + 方案摘要（≤ N 字）"，不含调试上下文、不含 API Key、不含其他角色完整意见 | 4.4A §6.3（统一输出） |
| **日志脱敏** | `modelOutputRef` 仅存结构化摘要（providerSource / modelName / durationMs / fallback）；`reasoningSummary` 仅含 provider/model/reason，≤200 字符；完整 prompt / rawText **不写入任何字段**；401·403 错误消息 `Bearer ***` 正则脱敏 | 5.1 证据 3 |

**出域管控（openai_compatible 专用）**：7.2 之前不得向任何外部 endpoint 发送"真实业务评审原文"；试点允许发送**合成/示例方案摘要**验证成功路径，待 5.7 §5 路线 B 的"Key 管理与预算审查"书面确认后，方可评估真实数据出域。

---

## 6. 验收标准（Acceptance Criteria）

> 以下为 7.1 spike 必须逐条满足的验收项（Gate 证据来源）。

| # | 验收项 | 判定方法 |
|---|--------|----------|
| 1 | **HTTP 成功** | spike 收到 provider 2xx 响应，且 `getProvider()` 未抛 GUARD |
| 2 | **JSON 可解析** | 响应体按 4.4A §6.2 解析为合法 `AgentTurnResult`（对象 / `[0]` / 剥离 ```json 后解析）；非 JSON → 不计为成功 |
| 3 | **riskLevel / dimension / confidenceScore 合法** | `riskLevel ∈ {high,medium,low,info}`；`dimension` 非空字符串；`confidenceScore ∈ [0,100]`（缺失默认 50） |
| 4 | **modelOutputRef / providerSummary 正确记录** | 落地 `modelOutputRef` JSON：`providerSource ∈ {lmstudio, openai_compatible}`（真实态，非 `mock`）、`modelName` 正确、`fallback:false`、`durationMs>0`；聚合 `providerSummary` 形状 `{totalTurns, bySource, fallbackCount, failedCount, models, hasRealProvider:true}` 正确 |
| 5 | **无 key 泄漏** | 全链路 grep `sk-` / 完整 Key = 0；日志/错误/响应中 Key 遮罩；`.env` 不进 Git |

**额外 Gate 证据（标准流程 §6.3）**：7.1 须附 spike 实跑记录（调用次数、HTTP 状态、解析结果、providerSummary 样本、成本估算、Key 遮罩截图/日志脱敏证明）；`tsc --noEmit` 0 errors（若 spike 触及 TS）；失败分支守卫已确认。

---

## 7. 明确禁止（Explicit Prohibitions）

| # | 禁止项 | 理由 |
|---|--------|------|
| 1 | **不接 `startReview` 主链路** | 真实模型不得进入创建评审 → 启动评审主流程；触发协议 §5.5 独立 Gate 红线 |
| 2 | **不接默认 queue** | 不得把真实 provider 注入 `queue.service.ts` 的 `executeAgentTurn()` 默认路径；试点仅走 standalone spike / 专用 pilot review |
| 3 | **不改前端** | 报告页 / 诊断页 / Meeting 页 UI 不变；真实模型标签（"真实模型参与"）已在 5.3 实现，无需前端改动 |
| 4 | **不改 schema** | 复用既有 `modelOutputRef`（String?）/ `reasoningSummary`（String?）；不新增/迁移 Prisma 字段 |
| 5 | 不提交 / 不打印 API Key | 见 §4 成本与安全 |
| 6 | 不做批量 / 自动重试 / 自动扩大调用 | 见 §1 试点范围 + §4 失败即停 |

---

## 8. 后续 Sprint 拆分（Follow-up Sprint Breakdown）

| Sprint | 类型 | 目标 | 边界 |
|--------|------|------|------|
| **7.0**（本 Sprint） | reasonix 合同 | 真实 Provider 小流量试点合同 | 只写文档，不实现 |
| **7.1 Standalone Real Provider Spike** | 实现 + 验证 | 用 `spike-provider-guard.js` / `spike-agent-turn.js` 验证 lmstudio → openai_compatible 成功路径；满足 §6 验收 5 项 | 仅 standalone 脚本；角色 ≤ 2；不接 queue/startReview/前端；Key 不落文档 |
| **7.2 Dev-only Queue Pilot** | 实现 + 验证 | 在**专用 pilot review**（非默认 demo）以 dev-only 方式接入真实 provider 到 queue 路径，验证 DB opinions 落地与 providerSummary 聚合 | 不影响默认 mock demo；限 dev 环境；调用次数 ≤ 5；仍走独立 Gate |
| **7.3 Demo / Runbook Refresh** | 文档 | 将"真实 Provider 试点"步骤写入 `MVP_Demo_Runbook.md` / `Frontend_Demo_QA_Checklist.md`，并补"真实模型参与"标签的实测证据 | 只改文档；不接默认主链路 |

**Gate 串联**：7.0（合同）→ 7.1（spike 实跑 + qoderwork Review + Gate）→ 7.2（dev-only pilot + qoderwork Review + Gate）→ 7.3（文档刷新）。任一环节未走完对应独立 Gate，不得进入"默认接入主链路"。

---

## 9. 与既有文档的关系

- **复用（不重造）**：`Sprint_4.4A` 的 env var / Guard 矩阵 / 预算 / 输出 JSON 契约；`Sprint_4.4E` 的 standalone spike 模式与 Key 遮罩实践；`Sprint_5.1` 的 `modelOutputRef` / `providerSummary` 落库语义。
- **对齐**：`Sprint_5.7` §5 路线 B（独立 Gate 要求）；`MVP_RELEASE_SNAPSHOT.md` §7 下一阶段候选 #3（Controlled Real Provider Pilot）。
- **未解决（继承技术债）**：真实模型成功路径尚未端到端验证（5.7 §3 P1 / 4.7 P2-1）——本 Sprint 7.0+7.1 即为此而设；spike 脚本不输出 token 用量/成本估算（4.7 P2-2）——7.1 应补。

---

## 10. 本 Sprint 交付与 Gate 状态

- **交付物**：本契约文档 `docs/coordination/Sprint_7.0_Real_Provider_Pilot_Contract.md`（仅文档）。
- **代码变更**：无。
- **真实模型调用**：无（本 Sprint 不执行 spike）。
- **Gate 定位**：标准流程的合同环节；待 7.1 实现后由 qoderwork Review + Gate 凭 §6 证据判定。本 Sprint 自身作为"合同被采纳"即视为推进条件，不替代 7.1 的运行 Gate。
- **红线合规**：未改代码 / 未接主链路 / 未调真实模型 / 未写 Key / 无绝对路径。
