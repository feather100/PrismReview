# Sprint 7.4 — WorkBuddy 快速 Gate 复审

> **模式**：快速 Gate（仅查 P0/P1）
> **复审对象**：`docs/coordination/Sprint_7.4_LMStudio_Capped_E2E.md`
> **基线**：`Sprint_7.3_Workbuddy_Review.md`（Go，无保留）
> **日期**：2026-07-10
> **结论**：**Go（无保留）** — 7 项 P0/P1 全部通过，且全部证据对照磁盘实际代码取证。

---

## 证据（5 条）

1. **仅 lmstudio，未接 openai_compatible / 付费 API**
   `provider-adapter.js:221-232` 中 `openai_compatible` 必须 `ALLOW_EXTERNAL_MODEL_CALLS=true` **且** `MODEL_API_KEY` 才启用，缺 Key 即 `throw GUARD`；7.4 两个脚本均不设 `MODEL_API_KEY`（robustness 场景 C 显式用 `MODEL_API_KEY:''` 验证 GUARD 关闭付费 API）。`scripts/e2e-dev-pilot-lmstudio.js:8` 声明并仅驱动 `MODEL_PROVIDER=lmstudio`。

2. **单 review ≤3 调用/turn**
   `queue.service.ts:180-196 applyPilotRoleCap()`：仅 `lmstudio + allow` 时截断，环境变量未设 → 默认 `max=3`（:188），非法值回退 3（:191-193）。文档实证提交 5 角色 → 实际 3 turns / 3 opinions，上限由代码硬保证，pilot env 关闭时不影响默认 mock。

3. **startReview 仍 <1s，provider 不在 HTTP 生命周期调用**
   `startReview`（`:166-182`）仅 `update + enqueue('review.start')`，无 provider 调用；provider 唯一调用点在 `executeAgentTurn():261`（队列 job 内，脱离 HTTP 生命周期）。文档实测 `START_MS=10.5`。

4. **providerSource 区分 lmstudio / fallback_mock / failed，providerSummary 反映真实来源/失败**
   `queue.service.ts`：成功路径 `providerSource = result.provider`（lmstudio，:265）；guard/auth → `failed`（:250/:288，`NO_RETRY` 不 fallback）；runtime → `fallback_mock`（:298，单次 + warn）。`reviews.service.ts:412-444 buildProviderSummary` 聚合 `bySource`、计数 `fallbackCount/failedCount`、`hasRealProvider` 正确识别 lmstudio。文档 `{"lmstudio":3}`、report `hasRealProvider=true` 与 DB 一致。

5. **弱输出未被包装成成功；无 Key / raw prompt / 敏感输出泄漏**
   `lmstudioProvider`（:163）成功才返回 `provider:'lmstudio'`；未解析响应 `throw Unparseable`（:141）→ 被 `executeAgentTurn` catch 归为 runtime → `fallback_mock`，**不**伪造成功。Bearer 令牌在 auth 分支 `replace(/Bearer .../g,'Bearer ***')`（:276）脱敏；DB 仅落结构化字段 + `modelOutputRef`（含 `providerSource/providerName/modelName/fallback/durationMs`，无 rawText/prompt/Key）；`apps/api/src` 全文无 `7.4` 标记、`apps/web` 无 pilot 接线 → 零源码/前端改动，红线全守。

---

## 说明

- 本 Sprint 为零源码改动（仅新增 2 个验证脚本），所有结论对照 7.3 已通过的源码实现 + 文档实证得出，无需重复实跑（E2E 15/15 已由执行方在当地 LM Studio 环境完成）。
- 与文档一项技术细节一致：LM Studio 对未知 model 名宽容（直接服务已加载模型），故"弱输出"如实记录为低置信度 opinion 或（不可解析时）fallback_mock，均未被包装为业务成功。
