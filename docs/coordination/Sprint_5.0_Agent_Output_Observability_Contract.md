# Sprint 5.0 — Agent Output Observability Contract

> 设计真实 Agent 输出的可观测性方案。
> 只写合同文档，不改代码，不改 schema。

---

## 1. 当前 Schema 评估

### 1.1 ReviewTurn 字段

| 信息需求 | 当前字段 | 是否足够 | 备注 |
|---|---|---|---|
| providerSource | — | ❌ 无字段 | 需通过 `modelOutputRef` JSON 或新字段 |
| fallback (mock→real→mock) | — | ❌ 无字段 | 同上 |
| errorReason | — | ❌ 无字段 | `status=failed` 后无具体原因 |
| modelName | — | ❌ 无字段 | 可放在 `modelOutputRef` JSON 中 |
| durationMs | `startedAt` + `completedAt` | ✅ 可计算 | `completedAt - startedAt` |
| rawText 脱敏摘要 | `modelOutputRef` | ⚠️ 部分够 | `String?` 可存 URL 或 key，不存全文 |

### 1.2 ReviewOpinion 字段

| 信息需求 | 当前字段 | 是否足够 | 备注 |
|---|---|---|---|
| providerSource | — | ❌ 无字段 | |
| generatedBy (mock/real/fallback) | — | ❌ 无字段 | |
| rawText 脱敏摘要 | `modelOutputRef` | ⚠️ | 可存 JSON：`{provider, model, fallback, sanitizedChunk}` |
| 执行耗时 | — | ❌ 无字段 | `ReviewTurn.completedAt - startedAt` 可推算 |

### 1.3 结论：不改 schema 可表达什么

| 信息 | 表达方式 | 落库 | 日志 |
|---|---|---|---|
| providerSource | `modelOutputRef` JSON blob | ✅ | ✅ |
| fallback 标记 | `modelOutputRef` JSON 中的 `fallback: true` | ✅ | ✅ |
| modelName | `modelOutputRef` JSON 中的 `model` | ✅ | ✅ |
| errorReason | `reasoningSummary` (String?) | ✅ | ✅ |
| durationMs | `completedAt - startedAt` | ✅ | ✅ |
| rawText 全文 | ❌ 不落库 | — | ✅ |
| API Key / prompt | ❌ 禁止 | — | ❌ |

---

## 2. modelOutputRef JSON 合同

### 2.1 标准化结构

```typescript
interface ModelOutputRef {
  provider: 'mock' | 'lmstudio' | 'openai_compatible' | 'fallback_mock';
  model?: string;
  fallback?: boolean;
  fallbackReason?: string;
  errorReason?: string;       // 仅失败时
  durationMs?: number;
  tokens?: { prompt: number; completion: number };
  costEstimate?: number;
  sanitizedChunk?: string;    // rawText 脱敏后前 500 字符
}
```

### 2.2 各场景填充

| 场景 | provider | fallback | errorReason | model |
|---|---|---|---|---|
| mock (默认) | `mock` | false | — | `mock` |
| lmstudio 成功 | `lmstudio` | false | — | `google/gemma-4-12b` |
| lmstudio 失败 → mock | `fallback_mock` | true | 失败原因 | `google/gemma-4-12b` |
| openai_compatible 成功 | `openai_compatible` | false | — | `DeepSeek-V4-Flash` |
| openai_compatible 401/403 | `openai_compatible` | false | `Auth error 401` | `DeepSeek-V4-Flash` |
| openai_compatible 失败 → mock | `fallback_mock` | true | `Timeout 120s` | `DeepSeek-V4-Flash` |

---

## 3. Report API 暴露策略

### 3.1 新增字段（不改 schema，仅 DTO）

```typescript
export class ReportResponseDto {
  // 现有字段...
  @Expose() source: string;              // 'db_opinions' | 'mock_fallback'
  @Expose() sourceProvider?: string;     // 摘要：'mock' / 'lmstudio (2/3) + fallback (1/3)'
  @Expose() opinionCount: number;
  @Expose() generatedFromTurns: boolean;
}
```

**实现方式**：Service 层从 `modelOutputRef` 聚合计算。

### 3.2 不新增字段

`sourceDetail` 暂不引入。前端通过 `source` + `sourceProvider` 两字段即可区分来源和类型。详细 provider 信息留给日志/调试。

---

## 4. Meeting SSE 暴露策略

**暂不暴露 providerSource 给前端。**

原因：
1. Meeting SSE 是实时演示界面，用户关注内容而非生成来源
2. providerSource 属于调试/审计信息，不适合客户端可见
3. 避免 prompt injection / 敏感信息泄露
4. 前端 MeetingPage 当前稳定，不增加新字段风险

**后续**：如需暴露，通过 event metadata 单独评估（新 Gate）。

---

## 5. 前端展示建议

### 5.1 报告页

```
┌─ 评审报告 ────────────────────────┐
│ 生成来源：Mock 模拟评审            │
│ ┌─ 来源标签 ─────────────────────┐ │
│ │ 🟢 Mock（CTO/CFO/PMO）        │ │
│ └────────────────────────────────┘ │
│ 或：                             │
│ │ 🟡 混合（lmstudio 2/3 + 回退 1）│ │
│ │ 🔴 失败（401 认证失败）        │ │
└──────────────────────────────────┘
```

### 5.2 标签建议

| sourceProvider | 中文 Tag | 颜色 |
|---|---|---|
| `mock` | `Mock 模拟` | 🟢 |
| `lmstudio (N/N)` | `LM Studio` | 🟡 |
| `lmstudio (2/3) + fallback(1/3)` | `部分回退` | 🟠 |
| `openai_compatible (N/N)` | `AI 模型` | 🔵 |
| `401/403 failed` | `认证失败` | 🔴 |

### 5.3 实现方式

前端根据 `ReportResponseDto.sourceProvider` 字段渲染对应标签。`sourceProvider` 由后端聚合生成（不暴露原始 `modelOutputRef` JSON）。

---

## 6. 隐私与安全

### 6.1 rawText 脱敏

`modelOutputRef` 中的 `sanitizedChunk` 必须满足：
- 不存完整 prompt
- 不存 API Key（`Authorization: Bearer [redacted] — 永不存在任何字段中）
- 不存原始方案文本
- 仅存模型输出的前 500 字符（已足够判断质量）

### 6.2 日志脱敏

日志中的错误消息需脱敏：
- `Authorization: Bearer [redacted] → "[redacted]"`
- `sk-xxxxxxxxxxxxxxxx` → `sk-****xxxx`

### 6.3 禁止存储

| 数据 | 禁止 |
|---|---|
| API Key | ✅ |
| 用户 prompt 原文 | ✅ |
| 文件内容 | ✅ |
| IP 地址 | 仅审计日志（已有 audit_logs 表） |

---

## 7. 分阶段计划

### 5.1 后端最小落库/日志（本周）

- 修改 `executeAgentTurn`：provider 结果写入 `modelOutputRef` JSON（标准化结构）
- 失败时写入 `reasoningSummary`（错误原因）
- 日志脱敏（provider 名 / 样本 / 耗时 / tokens）
- **不改 schema**

### 5.2 Report API 暴露摘要（下周）

- 新增 `ReportResponseDto.sourceProvider` 字段
- 从 `modelOutputRef` 聚合：每个 review 所有 opinions 的 provider 统计
- `"mock"` / `"lmstudio (2/3)"` / `"mixed (2 mock + 1 lmstudio)"` / `"failed (auth)"`
- smoke-runtime 扩展

### 5.3 前端中文展示（配合 antigravity）

- antigravity 读取 `sourceProvider` 渲染中文标签
- 报告页上方显示生成来源 Tag
- 颜色按提案 §5.2

---

## 8. 红线

- ✅ 不真实调用外部模型
- ✅ 不改 Prisma schema（modelOutputRef String? 已存在）
- ✅ 不破坏 mock fallback
- ✅ 不影响现有 demo
- ✅ 不暴露 API Key / raw prompt
- ✅ Meeting SSE 不暴露 providerSource
