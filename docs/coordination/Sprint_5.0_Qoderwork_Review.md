# Sprint 5.0 Agent Output Observability Contract — 独立复审报告

> 审查方：QoderWork（独立于 reasonix）  
> 审查日期：2026-07-09  
> 审查模式：快速 Gate（只查 P0/P1，证据 ≤ 5 条）  
> 审查对象：`docs/coordination/Sprint_5.0_Agent_Output_Observability_Contract.md`  
> 交叉验证：`scripts/provider-adapter.js`（232 行）、`queue.service.ts`（320 行）、`.env.example`（52 行）、`reviews.gateway.ts`（252 行）、`reviews.service.ts`、`schema.prisma`、`ACTIVE_SPRINT.md`

---

## Gate: **Go** ✅

无 P0 / P1 阻塞项。合同设计完备，可作为 5.1 实现阶段的输入依据。

---

## 证据（5 条）

### 证据 1 — 零 schema 变更 + mock/real/fallback/failed 四态可区分 ✅

合同 §1.3 明确"不改 schema"，所有可观测字段复用现有 `modelOutputRef`（String?）和 `reasoningSummary`（String?）。

§2.1 定义 `ModelOutputRef` JSON 结构，§2.2 场景矩阵完整覆盖四态：

| 场景 | `provider` | `fallback` | `errorReason` |
|------|-----------|-----------|---------------|
| 默认 mock | `mock` | false | — |
| lmstudio 成功 | `lmstudio` | false | — |
| lmstudio 失败→mock | `fallback_mock` | true | 失败原因 |
| openai 成功 | `openai_compatible` | false | — |
| openai 401/403 | `openai_compatible` | false | `Auth error 401` |
| openai 失败→mock | `fallback_mock` | true | `Timeout 120s` |

`provider` 字段使用 `fallback_mock` 区分主动 mock 与 fallback mock，`errorReason` 记录失败原因。四态区分清晰。

`ReportResponseDto` 新增 `sourceProvider?` 为 DTO 层聚合字段（不改 schema，仅 Service 层计算）。✅

### 证据 2 — 零 API Key / prompt / 敏感 rawText 泄漏风险 ✅

合同 §6 三节覆盖完整安全边界：

- **§6.1 rawText 脱敏**：`sanitizedChunk` 仅存模型输出前 500 字符，禁止存完整 prompt、API Key、原始方案文本
- **§6.2 日志脱敏**：Bearer token → `[redacted]`，`sk-xxx` → `sk-****xxxx`
- **§6.3 禁止存储表**：API Key、用户 prompt 原文、文件内容、IP 地址均禁止

交叉验证现有代码：`queue.service.ts:205` 已有 Bearer 正则脱敏；`provider-adapter.js:36` 仅 env 读取；`spike-provider-guard.js:31` 遮罩 `***last4`；`.env.example:35` 仅占位符 + WARNING；`.gitignore` 排除 `.env` / `.env.local` / `.env.*.local`。

合同与代码一致，四禁（代码/文档/日志/Git）完整。✅

### 证据 3 — 401/403 fail closed + 普通 runtime fallback mock + warn ✅

合同 §2.2 明确 401/403 场景 `fallback=false`、`errorReason` 有值，不进入 mock fallback。

交叉验证 `queue.service.ts:203-216`（Sprint 4.4D 实现，本 Sprint 未改）：

```
401/403 → logger.error + ReviewTurn.status='failed' + throw NO_RETRY → 不 fallback
其他运行时错误 → logger.warn('[Fallback]') + mockProvider(roleCode) → fallback mock
```

三层分流逻辑与合同完全一致。✅

### 证据 4 — Report / SSE / 前端向后兼容 ✅

- **Report API**（§3）：新增 `sourceProvider?` 为 optional DTO 字段，现有 `source` / `opinionCount` 等字段不变。Service 层从 `modelOutputRef` 聚合计算，不改变现有 Report 结构。
- **Meeting SSE**（§4）：明确"暂不暴露 providerSource 给前端"，理由充分（实时演示关注内容、防 prompt injection、前端稳定优先）。`reviews.gateway.ts` 零改动。
- **前端**（§5）：仅为建议（标签颜色/中文文案），不涉及本 Sprint 交付，留给 5.3 阶段。

所有现有 API 契约、SSE 事件格式、前端组件均不受影响。✅

### 证据 5 — 分阶段计划足够窄，可进入 5.1 实现 ✅

§7 分阶段计划：

| 阶段 | 范围 | 窄度评估 |
|------|------|---------|
| 5.1 后端最小落库 | `executeAgentTurn` 写 modelOutputRef JSON + 失败写 reasoningSummary + 日志脱敏 | ✅ 仅改 queue.service.ts，不改 schema/API/前端 |
| 5.2 Report API 摘要 | 新增 `sourceProvider` DTO + 聚合逻辑 + smoke 扩展 | ✅ 独立于 5.1，可分步 |
| 5.3 前端中文展示 | antigravity 渲染标签 | ✅ 完全独立 |

5.1 范围极窄：仅 `queue.service.ts` 一个文件的 `executeAgentTurn` 方法，写入 JSON 到已有 `modelOutputRef` 字段。不改 schema、不改 API 路由、不改 DTO。满足快速 Gate 触发条件。

---

## P0 阻塞项

无。

## P1 建议项

无。

## P2 可延后项

| # | 描述 | 说明 |
|---|------|------|
| P2-1 | `mockProvider()` 返回 `provider: 'mock'`，fallback 场景需区分 `fallback_mock` | 5.1 实现时需在 `executeAgentTurn` fallback 分支覆写 `provider: 'fallback_mock'` |
| P2-2 | ACTIVE_SPRINT.md 仍显示 Sprint 4.7，未更新到 5.0 | 合同层面不影响实现，但应在 5.1 前同步 |
| P2-3 | 真实 API 调用成功路径仍未端到端验证 | 继承自 4.4E，待设置 API Key 后补充 |

---

## 结论

Sprint 5.0 合同设计完备：schema 零变更、四态可区分、安全边界清晰、向后兼容、分阶段粒度可控。所有现有代码与合同声明一致。建议进入 5.1 实现阶段。
