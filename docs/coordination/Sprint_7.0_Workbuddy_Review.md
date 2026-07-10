# Sprint 7.0 — Real Provider Pilot Contract 标准流程复审

> 模式：标准流程（非快速 Gate；本 Sprint 仅为真实 Provider 试点的"合同"环节，不实现、不接主链路）
> 复审对象：`docs/coordination/Sprint_7.0_Real_Provider_Pilot_Contract.md`
> 复审人：WorkBuddy（只读 Gate 模式）
> 复审时间：2026-07-09 23:08
> 复审依据：契约全文 + `scripts/provider-adapter.js`（`getProvider()` Guard 实现）+ spike 脚本密钥扫描 + 敏感信息扫描交叉核对

---

## 结论：**Go（无保留）**

八项重点检查全部通过。契约与既有 Guard 实现（`provider-adapter.js`）逐字段对齐，默认 mock 不变、明确不接主链路、API Key/成本/数据安全/出域管控齐全、lmstudio 与 openai_compatible 风险区分清晰、失败即停与调用上限明确，且本 Sprint 纯文档、无真实调用、无密钥、无绝对路径。后续拆分为 7.1 spike → 7.2 dev-only pilot → 7.3 doc，粒度足够窄且各自带独立 Gate。

---

## 证据（8 条）

1. **明确不走快速 Gate** ✅
   - 头部（`:3`）声明"标准流程，非快速 Gate"；红线（`:7`）触发协议 §5.5 独立 Gate；
   - §0（`:20`）明确"凡涉真实外部模型，一律走独立 Gate：Provider Contract → Key 与预算审查 → standalone spike → qoderwork Review → Gate 判定"，本 Sprint 仅为该链路合同环节。

2. **默认 mock 不变** ✅
   - §3.3（`:83`）"默认仍 mock"；§3.1 env 表 `MODEL_PROVIDER` 默认 `"mock"`（`:60`）；
   - 已核对 `provider-adapter.js:208-210`：`getProvider()` 在 `MODEL_PROVIDER` 未设置/`mock` 时返回 mock，与契约一致。

3. **禁止直接接主链路** ✅
   - §7 显式禁止六条（`:131-140`）：#1 不接 `startReview`、#2 不接默认 queue、#3 不改前端、#4 不改 schema、#5 不提交/打印 API Key、#6 不批量/重试/扩大调用；
   - §0 范围表（`:15-18`）三条"不做"与之对应，并复用既有 Guard（不重造）。

4. **覆盖 API Key / 成本 / 数据安全** ✅
   - §4 成本与安全（`:89-99`）：Key 不进代码/文档/日志（`sk-...` 占位、4.4E 已验证 `(unset)` 遮罩）、单次预算上限 `$0.05`/call、`$0.10`/session、失败即停不自动 retry、Circuit Breaker（`openai_compatible` 连续 5 次失败→15 min OPEN）；
   - §5 数据安全（`:103-111`）：不发送敏感原文、prompt 最小化、日志脱敏（`modelOutputRef`/`reasoningSummary` 仅结构化摘要、`Bearer ***` 正则脱敏）、出域管控（`openai_compatible` 7.2 前禁发真实原文，仅允许合成/示例）。

5. **区分 lmstudio 与 openai_compatible 风险** ✅
   - §2 Provider 候选表（`:43-48`）明确：lmstudio=本地/零成本/无 Key/无出域（首选）；openai_compatible=需 Key/产生成本/原文出域需管控；
   - §4 Circuit Breaker 仅 `openai_compatible` 启用（lmstudio 本地无成本不启用，`:96`）；§5 出域管控明确为 `openai_compatible` 专用（`:111`）。

6. **失败即停、调用次数上限** ✅
   - §1 试点容量上限（`:33-35`）：7.1 spike ≤ 3 次成功调用、7.2 dev-only queue ≤ 5 次；
   - §4（`:95`）失败即停：超时/5xx/解析失败/401·403 → 单次结束，不自动 retry、不扩大调用；401·403 与 Guard 错误不 fallback；
   - §3.1（`:68`）`MODEL_DAILY_CALL_LIMIT` 默认 100（已核对 `provider-adapter.js:38` 一致）。

7. **无代码改动 / 无真实调用 / 无密钥** ✅
   - 契约自述（`:4`/`:168-169`）"只写合同文档，不改代码、不真实调用"；
   - 密钥扫描：契约文档仅出现变量名 `MODEL_API_KEY` / 标志名 `ALLOW_EXTERNAL_MODEL_CALLS` / 条件说明 `MODEL_PROVIDER=lmstudio`，无 `sk-`、无 `C:\`、无真实 Key；
   - spike 脚本（`spike-local-llm.js`/`spike-agent-turn.js`/`spike-provider-guard.js`）密钥扫描零命中，无硬编码 Key 或自动真实调用；
   - `provider-adapter.js` env 变量名（`MODEL_PROVIDER`/`ALLOW_EXTERNAL_MODEL_CALLS`/`MODEL_API_KEY`/`MODEL_BUDGET_LIMIT`/`MODEL_DAILY_CALL_LIMIT` 等）与契约 §3.1 表逐字一致，启用矩阵（`:72-79`）与代码 `:208-234` 行为完全吻合（fail-closed 验证逻辑对齐）。

8. **后续 Sprint 拆分足够窄** ✅
   - §8（`:144-153`）拆为 7.0 合同 → 7.1 standalone spike（仅脚本、角色≤2、不接 queue/startReview/前端）→ 7.2 dev-only queue pilot（专用 pilot review、dev 环境、≤5 次、仍走独立 Gate）→ 7.3 文档刷新；每环节边界清晰，串联"任一环节未走完对应独立 Gate 不得进入默认主链路"（`:153`）。

---

## 说明（非阻塞）

- 契约引用了已存在的 spike 脚本（`spike-provider-guard.js`/`spike-agent-turn.js`，源自 Sprint 4.4E），但 7.0 本 Sprint 不执行；其 Key 遮罩实践（4.4E `(unset)`）作为 §4 依据被复用，未重造。7.1 实现时须以 §6 五项验收 + §10 标准流程 Gate 证据（实跑记录/成本估算/Key 遮罩/tsc 0 errors）为准。
- 输出文件：`docs/coordination/Sprint_7.0_Workbuddy_Review.md`
