# Sprint 7.3 — Dev-only Queue LM Studio Pilot Implementation (Backend)

> **类型**：reasonix 后端实现 + dev-only 实测（标准流程，非快速 Gate）
> **模式**：只改后端 queue/pilot 相关代码 + smoke 脚本；不改前端、不改 schema、不接 openai_compatible、不让真实 provider 成为默认、不调用真实模型（除非用户本地显式设 env）
> **上游契约**：`Sprint_7.2_Dev_Queue_Provider_Pilot_Contract.md`（Go，合同被采纳）+ `Sprint_7.2_Workbuddy_Review.md`（Go）
> **本 Sprint 目标**：按 7.2 合同实现 dev-only queue LM Studio pilot 的**最小必要变更**，使 7.2 识别出的真实缺口（`MODEL_PILOT_MAX_ROLES` 硬约束）落地，并补充 dev pilot smoke 覆盖合同 §8 / 本任务测试矩阵；默认 mock demo 100% 不变。
> **红线合规**：未改前端 / 未改 schema / 未接 openai_compatible / 未让真实 provider 成为默认 / 未调用真实模型（本环境仅对 dead 端口做连接以证明 fallback 触发，无任何真实模型推理）。

---

## 0. 本 Sprint 边界（Scope）

| 做 | 不做 |
|----|------|
| 实现 `MODEL_PILOT_MAX_ROLES` 硬约束（仅 dev pilot 生效，默认 3，不影响 mock） | 不改前端 |
| 新增 `scripts/smoke-dev-pilot.js` 覆盖 dev pilot 测试矩阵 | 不改 Prisma schema |
| 在 `.env.example` 登记 `MODEL_PILOT_MAX_ROLES` 说明 | 不接 openai_compatible 到 queue |
| 复用并验证既有 `getProvider()` / provider-adapter / queue fallback 分类 | 不让真实 provider 成为默认 |
| 跑通 in-process smoke + tsc 证据 | 不调用真实模型（除非用户本地显式设 env） |

> **关键事实（与 7.2 一致）**：经 7.2 只读核对，`queue.service.ts` 的 `executeAgentTurn()` 已通过 `getProvider()` 接入 provider-adapter，并已实现 guard→failed / auth→failed / runtime→fallback_mock / success 四类落库，`modelOutputRef.providerSource ∈ {lmstudio, fallback_mock, failed}` 与 `providerSummary.hasRealProvider` 均已正确。因此 7.3 的**真实代码缺口仅为 `MODEL_PILOT_MAX_ROLES` 硬约束**（7.2 §3/§10 标注），其余为验证 + 文档。

---

## 1. 实现变更（最小必要）

### 1.1 `apps/api/src/modules/reviews/queue/queue.service.ts`

新增 `applyPilotRoleCap(roles)` 私有方法，并在 `executeReviewStart()` 中应用：

- **触发条件（pilot-only）**：仅当 `MODEL_PROVIDER=lmstudio` **且** `ALLOW_EXTERNAL_MODEL_CALLS=true` 时生效；其余一切模式（默认 / mock / 未设置）**原样返回全量角色**，因此默认 mock demo 完全不变。
- **取值规则（合同"不设时不限制或默认 3"）**：
  - env 未设置 / 空 → 默认 `3`
  - env = 正整数 → 取该值
  - env 非法（如 `abc`、`0`、`-2`）→ 回退 `3`
- **一致性保证**：当发生截断时，将**裁剪后的** `roleSelection.roles` 持久化回 review，使下游 `checkMeetingComplete` / `executeMeetingComplete` 的 `expectedCount`（读自 DB）与已派发的 turn 数一致，避免 review 永远停留在 `running`。该写操作仅在 pilot 截断路径发生，mock/default 路径无任何额外 DB 写。
- **断言**：`tsc --noEmit` 0 errors（见 §5）。

落库语义与 7.2 §5 完全一致，未改动：
- guard/auth → `failed` + `NO_RETRY`，不 fallback
- runtime/timeout/invalid JSON → 单次 `fallback_mock` + `warn`，不写 raw response，不重试真实 provider
- success → `providerSource='lmstudio'`

### 1.2 `.env.example`

新增 dev pilot 段，登记 `MODEL_PILOT_MAX_ROLES=3` 及说明：仅 pilot 生效、默认 3、非法回退 3、不影响 mock、生产/CI/demo 不得设置。

### 1.3 `scripts/smoke-dev-pilot.js`（新增）

纯 in-process 烟雾测试（无需 server/DB/LM Studio），复用**真实** `provider-adapter` 模块，并镜像 `queue.service.ts` 的 `executeAgentTurn` 分类树与 `modelOutputRef` 序列化逻辑，以在无 live 服务的情况下证明合同。覆盖见 §4。

---

## 2. 用户需求逐条对齐

| # | 需求 | 实现 / 证据 |
|---|------|------------|
| 1 | `getProvider()` 默认 mock | adapter `:208-210` 未改；smoke-dev-pilot §1 通过 |
| 2 | provider 调用仅发生在 `agent.turn.execute` | queue.service.ts 唯一调用点未变；`startReview` 仅 `update + enqueue`（reviews.service.ts:166-182 未改） |
| 3 | `startReview` HTTP 生命周期只 `update + enqueue`，不执行 provider | reviews.service.ts 未改；smoke-runtime §11 已验（HTTP <1s 返回 running） |
| 4 | `MODEL_PROVIDER=lmstudio` + `ALLOW_EXTERNAL_MODEL_CALLS=true` 时 `agent.turn.execute` 可调用 lmstudio；`modelOutputRef.providerSource ∈ {lmstudio, fallback_mock, failed}`；`providerSummary.hasRealProvider` 正确 | 既有实现已满足；`hasRealProvider` 由 `buildProviderSummary`（reviews.service.ts:412-444）按 `bySource` 含 `lmstudio/openai_compatible` 计算 |
| 5 | `MODEL_PROVIDER` 未设置 / mock → smoke-queue / demo 完全保持 mock | 本 Sprint 任何变更均 gate 在 pilot env；smoke-dev-pilot §1/§7 证明 mock 不受 `MODEL_PILOT_MAX_ROLES` 影响 |
| 6 | Guard/config/auth → `failed` + `NO_RETRY`，不 fallback | queue.service.ts `:187-205`/`:226-243` 未改；smoke-dev-pilot §2/§3 证明 fail-closed |
| 7 | Runtime/timeout/invalid JSON → `fallback_mock` + warn，不写 raw response | queue.service.ts `:244-257` 未改；smoke-dev-pilot §4 证明 runtime→fallback_mock 且序列化干净 |
| 8 | 可选但推荐：`MODEL_PILOT_MAX_ROLES`，仅 dev pilot，默认不影响 mock，写入 `.env.example` | **本 Sprint 实现**（§1.1/§1.2）；默认 3 / 不设不限制，按合同执行；smoke-dev-pilot §7 覆盖 |

---

## 3. 安全（延续 7.2 §7，零新增风险）

- **不写 raw prompt / raw response**：`modelOutputRef` 仅存结构化 `observability`（无 `rawText`）；lmstudio adapter 的 `rawText` 字段在 queue 写 opinion 时被丢弃，仅取 `dimension/riskLevel/issue/recommendation/confidenceScore/reasoningSummary/modelOutputRef`。smoke-dev-pilot §6 扫描 `rawText/rawResponse/api_key/apiKey/sk-/Bearer/Authorization/prompt` 全部 clean。
- **不输出 `DEBUG_PROVIDER_RAW`**：queue 路径无该分支（仅在 7.1B spike 脚本）。
- **仅收 objective**：`provider.run(roleCode, objective)` 传 `review.objective`，非用户原文。
- **API Key 不进代码/日志**：lmstudio 无 Key；401/403 日志 `Bearer ***` 脱敏；openai_compatible 在本 pilot 被结构性排除（无 Key → GUARD）。smoke-dev-pilot §3 证明。

---

## 4. 测试矩阵与证据

### 4.1 要求覆盖（用户测试 #5 + #6）

| 覆盖项 | 结果 | 证据 |
|--------|------|------|
| 默认 mock 路径不变 | ✅ | smoke-dev-pilot §1（默认→mock、mockProvider 结构正确） |
| lmstudio guard 未开启时 fail closed | ✅ | smoke-dev-pilot §2（ALLOW 未设 / false → GUARD） |
| lmstudio env 开启但 provider runtime error → fallback_mock | ✅ | smoke-dev-pilot §4（dead 端口触发 runtime，queue 镜像产出 `fallback_mock`，无 `NO_RETRY`，序列化可解析且 clean） |
| `modelOutputRef` 可 `JSON.parse` | ✅ | smoke-dev-pilot §5（四变体均可解析） |
| `providerSource` 区分 mock / lmstudio / fallback_mock / failed | ✅ | smoke-dev-pilot §5（四值互斥 distinct=4/4） |
| 不含 rawText / raw response / API Key / prompt | ✅ | smoke-dev-pilot §6（四变体 + lmstudio ref 扫描 clean） |

### 4.2 标准 smoke（用户测试 #1–#4）

- `smoke-runtime.js`、`smoke-queue.js`、`smoke-export.js`：**本 Sprint 未改动**，默认 mock 行为保持不变；需运行中的 API 服务（Postgres + Redis）方可端到端运行，命令见 §5。
- `smoke-provider-robustness.js`：**本 Sprint 未改动**，in-process 可独立运行，结果见 §5（14/14 通过）。
- `smoke-dev-pilot.js`：**新增**，in-process 可独立运行，结果见 §5（23/23 通过）。

---

## 5. 验证命令与结果

> 环境：Windows / Node 22.22.2（managed）。in-process smoke 不依赖 server/DB。

### 5.1 tsc（类型证据）
```bash
cd apps/api
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```
**结果：`0 errors`** ✅

### 5.2 dev pilot smoke（新增，本 Sprint 核心证据）
```bash
node scripts/smoke-dev-pilot.js
```
**结果：`23/23 passed, 0 failed`** ✅
覆盖：默认 mock 不变 / lmstudio guard fail-closed（2 例）/ openai_compatible 排除 / lmstudio runtime→fallback_mock（adapter 抛错 + queue 镜像）/ 四变体 modelOutputRef JSON.parse / providerSource 互斥判别 / 四变体 + lmstudio ref 安全扫描 clean / MODEL_PILOT_MAX_ROLES 逻辑（pilot 截断 3/2、非法回退 3、mock 不截断、未设 provider 不截断）。

### 5.3 provider robustness smoke（既有，未改）
```bash
node scripts/smoke-provider-robustness.js
```
**结果：`14/14 passed, 0 failed`** ✅

### 5.4 标准 HTTP smoke（需运行中的 stack；本环境无 live DB/Redis，未执行）
下列命令在标准 dev 环境（已 `pnpm prisma migrate dev` + `pnpm --filter @prismreview/api dev`）下运行，默认 mock 行为保持：
```bash
node scripts/smoke-runtime.js          # 测试 #1
node scripts/smoke-queue.js            # 测试 #2
node scripts/smoke-export.js           # 测试 #3
node scripts/smoke-dev-pilot.js        # 测试 #4 + #5/#6 覆盖
```

### 5.5 dev pilot 端到端（人工 dev 步骤，合同 §8 验收，本环境未跑真实模型）
仅在用户本地显式设置 env 时执行（不进 CI / 生产 / 默认 demo）：
```bash
# 终端 A：启动 pilot 实例（指向本地已加载模型的 LM Studio，端口 1234）
MODEL_PROVIDER=lmstudio \
ALLOW_EXTERNAL_MODEL_CALLS=true \
MODEL_BASE_URL=http://127.0.0.1:1234/v1 \
MODEL_NAME=google/gemma-4-12b \
MODEL_PILOT_MAX_ROLES=3 \
pnpm --filter @prismreview/api dev

# 终端 B：构造专用 pilot review（≤3 角色）并跑 smoke
node scripts/smoke-queue.js            # 预期：turn 达终态，providerSource 含 lmstudio
# 验收：GET /report source=db_opinions；providerSummary.hasRealProvider=true；export.md 含来源摘要且不含 rawText/prompt/apiKey
```

---

## 6. 修改文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `apps/api/src/modules/reviews/queue/queue.service.ts` | 修改 | 新增 `applyPilotRoleCap()`；`executeReviewStart()` 应用 pilot 硬约束（仅 lmstudio+allow 生效，默认 3，截断时回写 roleSelection 以保持 meeting 计数一致） |
| `.env.example` | 修改 | 新增 `MODEL_PILOT_MAX_ROLES` 段与说明 |
| `scripts/smoke-dev-pilot.js` | 新增 | dev pilot in-process smoke（23 项，覆盖 §4.1 矩阵） |

**未改动**：前端、Prisma schema、provider-adapter.js 既有逻辑、reviews.service.ts（startReview / buildProviderSummary / exportMarkdown）、smoke-runtime.js / smoke-queue.js / smoke-export.js / smoke-provider-robustness.js。

---

## 7. 红线合规声明

- ✅ 未改前端
- ✅ 未改 schema
- ✅ 未接 openai_compatible（结构性排除：无 Key → GUARD；smoke §3 证明）
- ✅ 未让真实 provider 成为默认（默认 mock 不变；cap 仅 pilot 生效）
- ✅ 未调用真实模型（仅对 dead 端口做连接以证明 fallback 触发；无真实推理）
- ✅ 无绝对路径 / 无 Key 进代码或文档

---

## 8. Gate 状态

- **本 Sprint 定位**：标准流程实现环节，待 qoderwork 复审 + Gate 凭 §5 证据（tsc 0 errors、dev-pilot 23/23、provider-robustness 14/14、标准 smoke 默认 mock 不变）判定。
- **真实模型端到端验收**：留待用户本地按 §5.5 执行（dev-only，需 LM Studio 与显式 env）。
- **后续**：7.4 Demo / Runbook Refresh（纯文档）。
