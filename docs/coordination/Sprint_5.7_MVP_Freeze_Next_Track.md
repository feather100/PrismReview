# Sprint 5.7 — MVP Freeze & Next Track Selection

> 总结 Sprint 1–5.6 当前 MVP 状态，给出下一阶段推荐路线。
> 只写规划，不改代码。

---

## 1. 当前已完成能力清单

| 能力 | 状态 | 关键端点/脚本 |
|---|---|---|
| 创建评审 | ✅ | `POST /api/reviews` |
| 方案诊断 (Mock Chairman) | ✅ | `POST /api/reviews/{id}/diagnose` + `GET /diagnosis` |
| 角色管理 (5 预置) | ✅ | `GET/POST/DELETE /api/roles` |
| 确认评审团 | ✅ | `POST /api/reviews/{id}/roles` + `POST /start` |
| Queue Mock Runner | ✅ | In-memory queue → `review_turns` + `review_opinions` |
| Meeting SSE (DB turns + mock fallback) | ✅ | `GET /api/reviews/{id}/meeting/stream` |
| Report API (source=db_opinions/mock_fallback) | ✅ | `GET /api/reviews/{id}/report` |
| Provider 可观测性 (providerSummary) | ✅ | `modelOutputRef` JSON + `reasoningSummary` |
| Provider Guard (mock/lmstudio/openai_compatible) | ✅ | `provider-adapter.js` + budget/circuit |
| Provider 鲁棒性测试 | ✅ | 14 种格式解析验证 |
| 一键 Demo (Route A/B) | ✅ | `scripts/setup-demo-review.js --with-runner` |
| Demo Runbook | ✅ | `docs/demo/MVP_Demo_Runbook.md` |
| QA / Freeze 报告 | ✅ | `docs/demo/Backend_Demo_Freeze_QA.md` |
| Smoke 测试 | ✅ | runtime 31, queue 15, SSE 5, robustness 14, runner 15 |

---

## 2. 当前红线保持

| 红线 | 状态 |
|---|---|
| 默认 mock provider | ✅ 不设置 MODEL_PROVIDER 时走 mock |
| 不默认调用真实模型 | ✅ ALLOW_EXTERNAL_MODEL_CALLS 默认 false |
| 不泄露 API Key | ✅ 日志脱敏 + .gitignore |
| Schema 未迁移 | ✅ 14 张表，自 Sprint 1 未改 |
| 不改前端 | ✅ 所有 Sprint scope 遵守 |

---

## 3. 当前已知 P2 / 技术债

| 项目 | 类型 | 影响 |
|---|---|---|
| 真实模型成功路径未验证 | P1 | LM Studio 已本地跑通，openai_compatible 未验证 |
| BullMQ / 持久队列未接 | P2 | 当前 in-memory queue，进程重启丢失 |
| Meeting SSE running partial 轮询未测试 | P2 | polling 代码就绪，缺少自动测试 |
| PDF / MD 导出未接 | P2 | Report API 只返回 JSON |
| Jira / 外部集成 | P2 | Action Items 存 Mock 状态 |
| 权限 / 审计细化 | P2 | Mock user + audit_logs 表空 |
| pgvector / 知识库 | P2 | Docker 已移除 pgvector，检索用 LIKE |
| real_document_to_external_model 开关遗留 | P2 | .env.example 已清理，逻辑未跟进 |

---

## 4. 三条候选路线

### 路线 A — Report Markdown/PDF Export

| 维度 | 说明 |
|---|---|
| 业务价值 | 方案评审可导出正式报告，满足企业落地需求 |
| 技术风险 | ⭐ 低 — 前端渲染 + 后端 template，无外部依赖 |
| 验收标准 | `GET /api/reports/{id}/export?format=md` → 下载 MD；PDF 可延后 |
| 建议 Sprint | 1 个 Sprint（后端 template + 前端 export button） |

**门槛低、风险小、产出可见。** 适合作为 Demo 后的"最后一公里"补齐。

### 路线 B — Controlled Real Provider Pilot

| 维度 | 说明 |
|---|---|
| 业务价值 | 验证真实 AI 评审质量，是产品核心差异化的基石 |
| 技术风险 | ⭐⭐⭐ 中高 — 需 API Key 管理、预算控制、输出质量评估 |
| 验收标准 | 3 个真实 review 跑通，quality score > 70%（人工判定），无预算超支 |
| 建议 Sprint | 2-3 个 Sprint（E2E spike → quality eval → guard hardening） |

**产品价值最高、用户视角最可见。** 适合作为下一个核心里程碑。

### 路线 C — BullMQ Persistent Queue

| 维度 | 说明 |
|---|---|
| 业务价值 | 架构健康 — Queue 持久化、Worker 独立、崩溃恢复 |
| 技术风险 | ⭐⭐ 中 — BullMQ 已声明依赖，需 Worker 进程分离 |
| 验收标准 | Queue job 存活于 Redis 重启，worker 独立部署，durable 不丢 job |
| 建议 Sprint | 2 个 Sprint（BullMQ 接入 → Worker 独立 + SSE 从 DB 读取） |

**架构收益最高，但用户不可见。** 适合作为"真实 Provider 上线前"的前置工程。

---

## 5. 推荐路线与理由

**推荐：B → A → C**

```
B. Controlled Real Provider Pilot (Sprint 6.0–6.2)
   ↓ 验证真实 AI 评审质量后
A. Report Export (Sprint 6.3)
   ↓ Demo 闭环：创建 → 诊断 → 真实评审 → 导出报告
C. BullMQ (Sprint 6.4+)
   ↓ 为生产部署准备
```

### 理由

1. **B 先做**：产品差异化核心是 AI 评审质量。真实 model 输出质量、延迟、成本的数据是目前最大未知项。不验证这一环，后续所有工作都可能偏离真实场景。

2. **A 紧跟**：B 完成后，用户可从创建到导出完整闭环。这是 MVP 的 "最后一张拼图"。

3. **C 最后**：Queue 持久化是生产级部署的前提，但在 Demo 阶段 in-memory queue 够用。技术债明确且可控。

### 不推荐的组合

- **C 优先**：不可见收益，且 Demo 环境不需要持久队列。
- **A 单独做**：产出是静态文档，无法展示 AI 核心能力。

### Gate 与红线提示

> 无论选择哪条路线，凡涉及**前端主交互**、**真实外部模型**、**新外部依赖**的变更，**不可**用快速 Gate 直接放行。各路线强制流程如下（标准/独立 Gate 定义见 `docs/coordination/AGENT_COORDINATION_PROTOCOL.md` 第 5–6 节）。

#### 路线 A — Report Markdown/PDF Export

- **涉及范围**：前端"导出按钮"从 `disabled` 走向 `enabled`，解除当前"导出按钮禁用"状态；后端新增 export template / 端点。
- **红线提示**：涉及前端主页面交互（按钮禁用态解除）+ 后端新端点，属于**主链路前端改动**。
- **必须走标准流程**（不可用快速 Gate 直接放行）：
  1. **Backend Contract**：定义 export 端点、格式（md/pdf）、字段映射。
  2. **Frontend / Backend 实现**：后端 template + 前端按钮 `enabled` 逻辑。
  3. **qoderwork Review**。
  4. **Gate 判定**（凭文档 + `tsc` / `smoke` / 手动验收证据）。
- **明确禁止**：以"风险低"为由用快速 Gate 跳过上述标准流程。

#### 路线 B — Controlled Real Provider Pilot

- **涉及范围**：首次真实外部模型成功路径验证（`lmstudio` / `openai_compatible` 付费接口）。
- **触发协议红线**：真实 LLM / API Key / 预算 / 数据安全。
- **必须走独立 Gate**（不得直接接主链路）：
  1. **Provider Contract**：`docs/coordination/Sprint_4.4A_Provider_Guard_Contract.md` 已定义 guard / 预算 / 超时 / fallback。
  2. **Key 管理与预算审查**：API Key 入 `.env`（已 gitignore），预算上限与熔断策略书面确认。
  3. **standalone spike**：先验证 `mock / lmstudio / openai_compatible` guard（见 `Sprint_4.4B`），**不接主链路**。
  4. **qoderwork Review**。
  5. **Gate 判定**。
- **明确禁止**：在 standalone spike / Key 审查 / Provider Contract 完成前，将真实 provider 直接接入 `startReview` 或 mock queue 主链路。

#### 路线 C — BullMQ Persistent Queue

- **涉及范围**：引入新外部依赖 BullMQ（Redis queue），Queue 行为从 in-memory 变为持久化。
- **红线提示**：新外部依赖 + Redis queue 行为变化，影响"不改 schema / 不改 `startReview` <1s 原则"等既有红线边界。
- **必须走标准流程**（不可快速 Gate）：
  1. **Queue Contract**：定义 BullMQ job / worker / durable 语义、SSE 从 DB 读取衔接。
  2. **Implementation**：BullMQ 接入 → Worker 进程独立。
  3. **smoke / e2e**：覆盖 Redis 重启 job 存活、worker 崩溃恢复、durable 不丢 job。
  4. **qoderwork Review**。
  5. **Gate 判定**。
- **明确禁止**：以"已声明依赖"为由用快速 Gate 跳过 contract / e2e。

#### 推荐顺序 ≠ 可跳过 Gate

- 推荐路线 **B → A → C** 仅为**产品优先级排序**，不代表任何一条路线可省略对应 Gate。
- 即使先做 B，也必须完成「路线 B 独立 Gate」；即使 A 风险低，也必须完成「路线 A 标准流程」；即使 C 是工程前置，也必须完成「路线 C contract + e2e」。
- 任一路线若未走完对应 Gate，Gate 结论不得为 Go。
