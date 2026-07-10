# Sprint 7.1B Spike Hygiene Hardening — WorkBuddy Review

> 模式：**标准流程**（协议 §5.5 独立 Gate，非快速 Gate）
> 复审对象：`scripts/spike-local-llm.js`、`scripts/spike-agent-turn.js`、`scripts/spike-provider-guard.js`、`scripts/provider-adapter.js`、`scripts/smoke-provider-robustness.js` + 7.1 协调文档
> 触发：用户提交 Sprint 7.1B Fix（针对前次 No-Go 的覆盖不全问题）
> 复审人：WorkBuddy（只读 Gate 模式）
> 复审时间：2026-07-09 23:59

---

## 结论：**Go（无保留）**

前次 No-Go 的核心阻塞（加固只覆盖 `spike-provider-guard.js`，真实产出 7.1 结果的 `spike-local-llm.js` / `spike-agent-turn.js` 仍默认 dump 完整响应且 parse 失败不 exit 非 0）已在本次 Fix 中闭环。三个 spike 脚本现已统一门控，8 项重点检查全部通过。

---

## 证据（8 项）

| # | 检查 | 结果 | 关键证据 |
|---|------|------|---------|
| 1 | spike-local-llm.js 默认不 dump raw/parsed 完整响应 | ✅ | `:104-109` raw 仅 `DEBUG_PROVIDER_RAW==='true'` 打印；`:124-129` parsed 同门控 |
| 2 | spike-agent-turn.js 默认不 dump full result/rawText | ✅ | `:51-55` 整段 `AgentTurnResult` 仅在 `DEBUG_PROVIDER_RAW==='true'` 打印 |
| 3 | DEBUG_PROVIDER_RAW 默认关闭，仅 true 打印完整内容 | ✅ | 三个脚本 grep 全部 `=== 'true'` 门控；无任何无门控的 `=== Raw Response`/`=== Full Result` 输出 |
| 4 | parse_error / invalid_schema 均 exit 非 0 | ✅ | local-llm `:134-136`（缺字段 exit 1）、`:140-143`（parse_error exit 1）；agent-turn `:60-62`（缺字段 exit 1）+ catch `:66-70` exit 1；guard `:65-68`（parse/schema exit 1） |
| 5 | spike-provider-guard.js 行为未回退 | ✅ | 与上次 No-Go 复审时逐行一致；`:52-56` 门控 + `:63-76` 错误分类/exit(1) 逻辑保留 |
| 6 | provider 默认 mock、queue/startReview/SSE/Report/前端未改 | ✅ | `getProvider():208-210` 仍 `if (!provider \|\| provider==='mock') return {name:'mock', run: mockProvider}`；`apps/` grep `spike-*` 零命中，未接入主链路 |
| 7 | smoke-provider-robustness 通过 | ✅ | 实跑 `14/14 passed, 0 failed`，exit 0（覆盖 normalizeParsed/stripMarkdown/mockProvider） |
| 8 | 文档无 raw response / API Key / prompt 泄漏 | ✅ | 7.1 协调文档 grep 原始响应 dump / `sk-` / `API_KEY=` / 整段 prompt 零命中；绝对路径/Bearer/secret 扫描零命中 |

---

## 非阻塞说明

- **smoke 未覆盖本次加固分支**：`smoke-provider-robustness.js` 是单测，未断言"默认不打印 Full Result"或"不可解析响应 exit 非 0"。当前结论基于**源码逐行核对**而非 smoke 执行验证；建议 7.2 前补一条脚本级断言（设/不设 `DEBUG_PROVIDER_RAW` 对比 stdout，及喂不可解析响应断言退出码）以闭环回归防护。
- **历史注释头**：`spike-local-llm.js:2` 标 `Sprint 1.7`、`spike-agent-turn.js:2` 标 `Sprint 1.8`，为早期命名遗留，不影响功能，可不改。
- **示例 prompt 仍在脚本内**：`spike-local-llm.js:41-60` 的 SYSTEM/USER_PROMPT 含示例 proposal（"Migrate the monolith..."），属 sample 输入非敏感数据；未写入任何交付文档。

---

## 结论

Sprint 7.1B 修复到位、三个 spike 脚本 hygiene 行为已统一对齐到 7.0 契约的 fail-closed 要求，默认 mock 与全部主链路（queue/startReview/SSE/Report/前端/schema）零改动，文档无泄漏。**Gate = Go（无保留）**，可放行进入 7.2 dev-only queue 试点。
