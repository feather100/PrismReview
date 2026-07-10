# Sprint 4.6 Provider Robustness Harness — 独立复审报告

> 审查方：QoderWork（独立于 reasonix）
> 审查日期：2026-07-09
> 审查模式：只读审查，未修改任何代码
> 审查对象：`docs/coordination/Sprint_4.6_Provider_Robustness_Backend.md`
> 交叉验证：`scripts/provider-adapter.js`（238 行）、`scripts/smoke-provider-robustness.js`（107 行）、`queue.service.ts`（320 行）、`.env.example`（52 行）、`ACTIVE_SPRINT.md`

---

## Gate: **Go** ✅

无 P0 / P1 阻塞项。所有安全关键检查通过。

---

## 证据摘要（5 条）

### 证据 1 — 零真实外部调用 + API Key 零泄漏 ✅

`smoke-provider-robustness.js` 仅调用 `stripMarkdown` 和 `normalizeParsed`（纯函数），不触发任何 HTTP 请求。`provider-adapter.js` 中 API Key 仅通过 `process.env.MODEL_API_KEY` 读取（line 36），日志输出经 `***` + `slice(-4)` 遮罩（`spike-provider-guard.js:31`），Bearer token 在 `queue.service.ts:205` 经正则脱敏。`.env.example` 仅含占位符 `sk-...`，`.gitignore` 排除 `.env` / `.env.local` / `.env.*.local`。

### 证据 2 — Guard / 401/403 fail closed 完整保持 ✅

`queue.service.ts` 三层错误分流与 Sprint 4.4D 完全一致，未做任何改动：
- Guard 错误 → `NO_RETRY` + `reviewTurn.status = 'failed'`（lines 186-197）
- 401/403 → `NO_RETRY` + `reviewTurn.status = 'failed'`（lines 204-211）
- 运行时错误 → fallback mock + `logger.warn`（lines 212-215）

`provider-adapter.js` 的 `getProvider()` 工厂 Guard 矩阵（lines 205-235）不变，三条件（provider type / ALLOW_EXTERNAL_MODEL_CALLS / MODEL_API_KEY）全部 fail closed。

### 证据 3 — Parser / Normalizer 增强覆盖全面 ✅

`provider-adapter.js` 变更点：
1. **导出扩展**（line 238）：新增导出 `stripMarkdown`、`normalizeParsed`，供测试直接调用。
2. **`normalizeParsed` 增强**（lines 89-103）：
   - 大小写不敏感匹配 `confidenceScore`（line 97：`key.toLowerCase().replace('_', '') === 'confidencescore'`）
   - 字符串自动转数字（line 98：`parseFloat(v) || 50`）
   - 数组取 `[0]`（line 90）、null/非对象返回 null（line 91）

`smoke-provider-robustness.js` 14 个测试全部通过（已验证）：

| # | 场景 | 结果 |
|---|------|------|
| 1 | 标准 JSON | ✅ |
| 2 | Markdown 包裹 JSON | ✅ |
| 3 | JSON 数组取首元素 | ✅ |
| 4 | `riskLevel: "HIGH"` 大写值 | ✅ normalize 保留原值，provider 层 `.toLowerCase()` |
| 5 | `CONFIDENCESCORE` 全大写 key | ✅ 正确映射为 `confidenceScore` |
| 6 | 空 content（Gemma reasoning） | ✅ 抛错，不静默通过 |
| 7 | 非 JSON 文本 | ✅ JSON.parse 失败 |
| 8 | 缺 `riskLevel` | ✅ normalize 通过，provider 层 `!parsed.riskLevel` 拦截 |
| 9 | 缺 `dimension` | ✅ 可恢复，默认 `''` |
| 10 | `riskLevel: "critical"` 非法值 | ✅ 保留原值，业务层判定 |
| 11 | `confidenceScore: "85"` 字符串 | ✅ `parseFloat` 转 number |
| 12-14 | Mock provider 三场景 | ✅ |

### 证据 4 — 默认 mock / queue / SSE 无回归 ✅

| 组件 | 验证 |
|------|------|
| `queue.service.ts` | 320 行，与 Sprint 4.4D 完全一致，零改动 |
| `reviews.gateway.ts` | 252 行，三相 SSE 架构不变 |
| `reviews.service.ts` | 未改 |
| `reviews.controller.ts` | 131 行，未改 |
| `schema.prisma` | 未改 |
| `.env.example` | 52 行，`MODEL_PROVIDER="mock"` + `ALLOW_EXTERNAL_MODEL_CALLS=false` 不变 |
| smoke-runtime | 31/31 ✅ |
| smoke-queue | 8/8 ✅ |
| smoke-sse | 5/5 ✅ |
| tsc | 0 errors ✅ |

### 证据 5 — ACTIVE_SPRINT.md 已更新至 Sprint 4.5，但 4.6 未同步 ⚠️

Header 显示 `Current Sprint: Sprint 4.5`（从 4.4C 更新到 4.5），但 Sprint 4.6 的实现文档未反映在 ACTIVE_SPRINT.md 中。Gate 记录区域标签仍为 "当前 Sprint 4.4C"，输入/输出文档列表也未更新。不影响代码正确性，但违反协作协议"开工前必须先读 ACTIVE_SPRINT.md"的一致性要求。

---

## P0 阻塞项

无。

## P1 建议项

无。

## P2 可延后项

| # | 描述 | 来源 |
|---|------|------|
| P2-1 | smoke-queue 仍未覆盖 Guard/Fallback/401 场景 | 继承自 4.4C（第 4 个 Sprint） |
| P2-2 | lmstudio provider 仍含 checkBudget/checkCircuit（合同仅要求 openai_compatible） | 继承自 4.4B（第 5 个 Sprint） |
| P2-3 | ACTIVE_SPRINT.md Gate 区域标签停留在 4.4C，未同步至 4.6 | 4.6 新增 |
| P2-4 | 真实 API 调用成功路径仍未端到端验证（两次 spike 均为 Guard-blocked） | 继承自 4.4E |
| P2-5 | spike 脚本不输出 token 用量 / 成本估算 | 继承自 4.4E |

---

## 变更统计

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `scripts/provider-adapter.js` | 修改 | +2 exports（stripMarkdown, normalizeParsed）；normalizeParsed 增强（大小写不敏感 + string→number） |
| `scripts/smoke-provider-robustness.js` | 新增 | 107 行，14 个鲁棒性测试 |
| `docs/coordination/Sprint_4.6_Provider_Robustness_Backend.md` | 新增 | 68 行，验证报告 |

**零主链路代码变更**——queue.service.ts、gateway、service、controller、schema、前端均未修改。
