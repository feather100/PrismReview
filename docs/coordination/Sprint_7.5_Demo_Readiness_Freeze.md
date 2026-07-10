# Sprint 7.5 — Real Provider Demo Readiness Freeze

> **模式**：文档冻结（workbuddy-docs，纯文档，不改代码）
> **上游 Gate**：`Sprint_7.3_Workbuddy_Review.md`（Go，无保留）+ `Sprint_7.4_Workbuddy_Review.md`（Go，快速 Gate）+ `Sprint_7.4_LMStudio_Capped_E2E.md`（PASS，15/15）
> **冻结人**：WorkBuddy（docs）
> **冻结日期**：2026-07-10
> **目标**：冻结当前 Demo 语义——默认 Mock 可演示；LM Studio 仅 dev-only、显式 env、≤3 capped；openai_compatible / 付费 API 未启用。所有对外 Demo 话术与文档须与本文一致。

---

## 1. 当前可演示能力（可宣称）

以下能力已落地并验证，可在对外/对内向导演示中**明确宣称**：

| # | 能力 | 路线 | 验证依据 | 备注 |
|---|------|------|----------|------|
| 1 | 创建评审 / 诊断 / 确认评审团 / Meeting SSE / Report | 路线 A / B | Sprint 5.5 UI 实测 + smoke 全绿 | MVP 核心链路 |
| 2 | **纯 Mock 演示（零 LLM 依赖）** | 路线 A | §8.4；默认 mock 零模型调用 | **MVP 标准 Demo 基线** |
| 3 | **Runner + DB Opinions（mock 写入真实库）** | 路线 B | smoke-queue 15/15；db_opinions 端到端 | 仍零外部模型依赖 |
| 4 | **Markdown 导出**（后端生成、前端下载） | 路线 A / B | smoke-export 21/21；6.2 后端实跑非空 .md | PDF / Jira 仍 disabled |
| 5 | **生成来源摘要（providerSummary 来源可观测性）** | 路线 A / B | Sprint 5.5 实测（Mock 分布、无蓝标） | 仅读 modelOutputRef，不调模型 |
| 6 | **Dev-only 本地 LM Studio 真实模型成功路径** | 可选 pilot | Sprint 7.4 E2E 15/15（startReview 10.5ms、≤3、hasRealProvider=true、无泄漏） | **非默认、显式 env、≤3 capped** |
| 7 | **fallback_mock / failed 受控兜底可观测** | pilot 下 | Sprint 7.4 鲁棒性 5/5（超时→fallback、guard→failed） | 属预期分支，非系统失败 |

> 第 6、7 项是 **dev-only 验证能力**，不是 MVP 对外标准 Demo 的一部分；演示时应明确其"可选 / 受控"属性（见 §4 口径）。

---

## 2. 不可宣称能力（禁止对外宣称）

以下能力**未启用或未落地**，任何 Demo 话术、文档、截图均**不得**暗示其存在或默认可用：

| # | 禁止宣称项 | 状态 | 依据 |
|---|------------|------|------|
| 1 | **openai_compatible / 付费 API 已启用** | ❌ 未启用（结构 GUARD，缺 Key 永不启用） | Sprint 7.4 场景 C；provider-adapter.js:221-232 |
| 2 | **真实模型是默认 / 标准 Demo 依赖** | ❌ 默认 `MODEL_PROVIDER=mock`、`:4000` 恒 mock | .env 默认 + Sprint 7.4 §7 |
| 3 | **单 review 真实模型调用 > 3 次** | ❌ 代码硬约束 cap=3 | Sprint 7.3 `applyPilotRoleCap`；7.4 提交 5→实际 3 |
| 4 | **跨 review 批量真实调用 / 自动扩大调用** | ❌ 禁止；失败即停不重试真实 provider | Sprint 7.2 §3 / 7.0 合同 |
| 5 | **PDF 导出 / Jira 同步可用** | ❌ 后端未实现，按钮 disabled | Runbook §10.2 |
| 6 | **多用户 / 权限 / 鉴权** | ❌ 未接（仅 `test-token` 占位） | MVP_RELEASE_SNAPSHOT §6 |
| 7 | **BullMQ 持久队列** | ❌ 仍为进程内队列 | MVP_RELEASE_SNAPSHOT §6 |
| 8 | **把 fallback_mock / failed 包装成"真实模型成功"** | ❌ 口径铁律 | 本文 §4；Runbook §11.4 |
| 9 | **把弱输出 / failed 描述为"系统不可用"** | ❌ 受控可恢复分支 | 本文 §4；Runbook §11.4 |
| 10 | **数据出域 / 发送敏感原文给外部模型** | ❌ 仅送 objective；ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL=false | Sprint 7.0 §5；7.4 内联 env |

---

## 3. 环境变量矩阵（Demo 语义锚点）

> 所有变量均为后端进程 env，**不写入文档正文、不写密钥、不写本机绝对路径**。下表仅声明变量名与语义，值以占位/相对描述表达。

### 3.1 默认实例（常驻 :4000，MVP 标准 Demo）

| 变量 | 值 | 含义 |
|------|----|------|
| `MODEL_PROVIDER` | `mock` | 默认走 mock，零外部模型 |
| `ALLOW_EXTERNAL_MODEL_CALLS` | `false` | 关闭真实模型总开关 |
| `MODEL_PILOT_MAX_ROLES` | （注释/未设） | 不生效 |
| `MODEL_API_KEY` | （不设） | 无需，且不暴露 |
| `ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL` | `false` | 不发送原文 |

### 3.2 Dev-only LM Studio pilot 实例（如 :4100，进程内联，不污染 .env）

| 变量 | 必须值 | 含义 |
|------|--------|------|
| `MODEL_PROVIDER` | `lmstudio` | 仅本地 LM Studio 允许走 queue |
| `ALLOW_EXTERNAL_MODEL_CALLS` | `true` | 总开关开启 |
| `MODEL_BASE_URL` | 含 `/v1`（如 `http://127.0.0.1:1234/v1`） | LM Studio 本地端点 |
| `MODEL_NAME` | 已加载模型（如 `google/gemma-4-12b`） | 模型需预加载 |
| `MODEL_PILOT_MAX_ROLES` | 未设→3 / 正整数 | 单 review 调用上限（代码硬约束） |
| `MODEL_API_KEY` | （不设） | lmstudio 不需 Key |
| `ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL` | `false` | 仅送 objective |

### 3.3 付费 API（MVP 范围外，结构 GUARD）

| 变量 | 要求 | 行为 |
|------|------|------|
| `MODEL_PROVIDER` | `openai_compatible` | 需同时满足下行 |
| `ALLOW_EXTERNAL_MODEL_CALLS` | `true` | 总开关 |
| `MODEL_API_KEY` | **必须**（`sk-...` 占位） | 缺 → `getProvider()` 抛 GUARD，绝不静默启用 |

> **铁律**：默认实例与 pilot 实例 env 隔离；pilot env 仅进程内联，绝不回写 `.env`、绝不进入任何文档/日志/提交。

---

## 4. 风险与口径

### 4.1 真实模型弱输出 / 失败的演示口径

| 情形 | 系统行为 | 摘要标签 | 对外话术口径 |
|------|----------|----------|--------------|
| LM Studio 超时 | 单次 fallback_mock，不重试 | 橙标「已发生 Fallback」 | "本地模型超时，已受控兜底回 mock，**系统正常**" |
| 空内容 / 非法 JSON | runtime → fallback_mock | 橙标 | 同上，非业务失败 |
| guard 未开 / 401·403 | failed + NO_RETRY，不 fallback | 红标「存在失败 Turn」 | "权限/开关未配置，**fail-closed 正确拦截**，非系统崩溃" |
| 低置信度 opinion | 正常落库 | 蓝标（低 confidenceScore） | "如实记录本地模型弱输出" |

**两条不可逾越的口径红线**：
1. 不得把 `fallback_mock` / `failed` 说成"真实模型成功"。
2. 不得因真实模型弱输出 / failed 宣称"PrismReview 系统不可用"。

### 4.2 范围与合规风险

- **单 review ≤ 3**：由 `applyPilotRoleCap()` 代码保证，pilot 关闭时不影响默认 mock。任何 pilot 演示不得声称 >3 次真实调用。
- **不污染默认实例**：pilot 仅在独立端口、进程内联 env 启动；常驻 :4000 恒为 mock。
- **openai_compatible 结构 GUARD**：缺 Key 永不启用，避免付费 API 静默上线。
- **数据不出域**：仅送 `objective`，`ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL=false`。

### 4.3 已知限制 / 技术债（沿用 MVP_RELEASE_SNAPSHOT §6）

- 真实模型成功路径仅在 dev-only 验证，未作为对外标准 Demo（本冻结明确其"可选"属性）。
- 仓库非 git 工作区，diff 留痕弱（P2，建议接 VCS）。
- 前端三态（lmstudio/fallback_mock/failed）UI 正向渲染需 dev-only 演示触发，前端代码为 Sprint 5.3 既有、无 pilot 接线改动。

### 4.4 对外 Demo 推荐话术（冻结口径）

> "PrismReview MVP 默认演示**零外部模型依赖**：路线 A 纯 Mock、路线 B Mock Runner 写库，来源摘要显示 `Mock(N)`，无任何真实模型标签，可无限重放、零成本、零风险。
> 另有**可选**的 Dev-only 本地 LM Studio 路线：需显式环境开关、单 review 最多 3 次调用、弱输出会受控兜底——用于验证真实模型成功路径，但**不涉及任何付费 API**，且不是默认演示。"

---

## 5. 关联文档

- `docs/demo/MVP_Demo_Runbook.md`（§2/§3 LLM 依赖声明 + §8.4 + 新增 §11 Dev-only LM Studio 路线）
- `docs/demo/Frontend_Demo_QA_Checklist.md`（§5 来源摘要 + 新增 §7 真实模型参与可观测性核查）
- `docs/coordination/Sprint_7.2_Dev_Queue_Provider_Pilot_Contract.md`（合同）
- `docs/coordination/Sprint_7.3_Workbuddy_Review.md`（实现复审，Go）
- `docs/coordination/Sprint_7.4_LMStudio_Capped_E2E.md`（E2E，PASS）
- `docs/coordination/Sprint_7.4_Workbuddy_Review.md`（快速 Gate，Go）
- `docs/coordination/MVP_RELEASE_SNAPSHOT.md`（能力锚点 / 技术债）

---

## 6. 结论

本冻结文档锚定 PrismReview MVP 的 Demo 语义边界：**默认 Mock 可演示、零 LLM 依赖；LM Studio 仅 dev-only、显式 env、≤3 capped、弱输出受控兜底；openai_compatible / 付费 API 未启用且结构 GUARD。** 所有对外话术、Runbook、QA Checklist 已同步更新并与本文一致。后续若启用付费 API / 扩大调用 / 改默认，须另开独立 Gate，不得在本冻结语义下默认宣称。

**Gate 定位**：本文为文档冻结（workbuddy-docs），自身作为"冻结被采纳"即推进条件；其依赖的运行证据（Sprint 7.3 Go + 7.4 E2E 15/15）已齐备，无新增运行 Gate 阻塞。ACTIVE_SPRINT 滚动至 7.5，Gate Status = In Progress（待对外/Demo 实测回填时翻 Go）。
