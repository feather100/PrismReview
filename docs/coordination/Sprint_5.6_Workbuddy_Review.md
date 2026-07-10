# Sprint 5.6 — Runbook 最终文档补丁快速 Gate 复审

> 模式：快速 Gate（协议 §7 — 纯文档补丁，无代码变更）
> 复审人：WorkBuddy（只读 Gate 模式）
> 复审时间：2026-07-09 20:08
> 复审依据：`MVP_Demo_Runbook.md` + `setup-demo-review.js`（校验文档与代码一致）
> 前序：18:02 / 18:14 No-Go → 18:47 No-Go（wrapper 修但 smoke/Runbook 缺）→ 19:21 No-Go（缺 --review-id）→ 19:53 No-Go（Runbook 未说明 --review-id 且 §4.5 示例误导）→ 本次 Runbook 文档补丁

---

## 结论：**Go**

四项检查全部通过。Runbook 已正确说明 `--review-id` 是 dev/test 辅助参数、§4.5 示例改用 `--review-id=<id>`、并明确区分两种重跑情形；且仅为文档变更，代码/模型/schema/前端均未改动，文档描述与 wrapper 当前实现一致。

---

## 四项检查

| # | 检查 | 结果 | 关键依据 |
|---|------|------|---------|
| 1 | Runbook 说明 `--review-id` 是 dev/test 辅助参数 | ✅ | §3.1 `:120`「`--review-id=<id>`（dev/test 辅助参数，用于对已有 review 重跑 wrapper、**不新建** review）」；§4.5 `:197`「`--review-id=<id>` 是 **dev/test 辅助参数**…**不新建** review」 |
| 2 | §4.5 示例命令使用 `--review-id=<id>` | ✅ | §4.5 `:202` 示例：`node scripts/setup-demo-review.js --with-runner --review-id=<id>`（与 wrapper 用法 `:11` 一致） |
| 3 | 明确区分两种重跑情形 | ✅ | §4.5 `:209-216` 对照表：带 `--review-id` 重跑同一 `completed` review → **idempotent skip（预期，非失败）**；不带 `--review-id` → **新建** review，通常再跑 `3/3 turns completed`，**不会** skip。`:216` 给出原因 |
| 4 | 只改 Runbook，无代码/模型/schema/前端改动 | ✅ | 本轮回读对象为 Runbook；`setup-demo-review.js:22` 的 `--review-id` 解析逻辑与 19:53 一致、未变动；Runbook §9 `:332-336` 重申「不修改任何代码」「不涉及 schema/前端主页面/真实 LLM 首次接入」；无脚本设置 `MODEL_PROVIDER`/`ALLOW_EXTERNAL_MODEL_CALLS`，零真实模型调用 |

---

## 文档与代码一致性校验

- **带 `--review-id`（复用）**：wrapper `:53-65` 不新建、仅校验存在并加载 roles；`:99` 对内层 runner 传该 id；`:101-102` 命中 `Skipping` → `idempotent skip`。与 §3.1/§4.5 描述一致 ✅
- **不带 `--review-id`（新建）**：wrapper `:66-94` `POST /reviews` 新建 → `:99` 对新 review 跑 runner → `3/3 turns completed`。与 §4.5 `:214`「不会触发 skip」一致 ✅
- **smoke 实测**：`smoke-runner.js:98` 建 + `:106` `--review-id` 重跑 + `:107-108` 断言 idempotent skip / 无 runner failed，已覆盖该行为（见 19:53 复审）✅

---

## 小结

Sprint 5.6 全链路闭环：

1. **异常分类**：5.5 空 `runner failed:` 的「看似失败实为成功」误导表面，根因为 wrapper 脆弱字符串判定 + 无条件 `✅` → 已根除。
2. **最小修复**：wrapper 改 `runner.code===0` 判定 + 跳过专署标签；新增 `--review-id` 让幂等分支可达、可测。
3. **smoke 覆盖**：新增 Wrapper Smoke Tests，真实跑同 id 第二次并断言。
4. **Runbook 同步**：本次补丁补全 `--review-id` dev/test 说明、修正 §4.5 示例、明确两种重跑差异 —— 文档与代码完全对齐。

**Gate = Go（无保留）。** 5.6 可关闭。
