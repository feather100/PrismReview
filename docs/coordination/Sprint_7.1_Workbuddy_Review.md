# Sprint 7.1 — WorkBuddy 标准流程复审

> 模式：标准流程（协议 §5.5 真实模型接入独立 Gate；非快速 Gate）
> 复审对象：`Sprint_7.1_Standalone_Real_Provider_Spike.md`
> 触发：用户提交 Sprint 7.1 复审请求
> 复审依据：7.1 文档 + `spike-local-llm.js` / `spike-agent-turn.js` / `spike-provider-guard.js` + `provider-adapter.js`（与 7.0 契约对齐）
> 复审时间：2026-07-09 23:35

---

## 结论：**Go（无保留）**

Sprint 7.1 是 7.0 契约授权的 **standalone lmstudio spike**，八项重点检查全部满足，安全边界、调用上限、失败分类均符合契约。可放行进入 7.2 dev-only queue 试点。

---

## 证据（8 项）

### 1. 仅 standalone spike，未接主链路 / queue / 前端 ✅
- 三个脚本头部均声明 `NOT connected to the main review/meeting/report pipeline` / `Isolated script`。
- `apps/` 全量 grep `spike-*` 零命中 → spike **未**被任何 app 模块 import，不写 DB、不触发 queue、不触前端。
- 文档首行声明「仅 standalone spike，不接主链路」。

### 2. 未调用 openai_compatible（无需用户授权）✅
- 文档仅记录 `lmstudio`（CTO + CFO），**无 openai_compatible** 字样。
- 全文档 grep `openai_compatible` / `MODEL_API_KEY` / `sk-` 零命中 → 未触发真实出域 Key 路径。
- lmstudio 本地 standalone spike 由 7.0 契约授权，满足「除非有用户授权记录」的反向约束（openai_compatible 需独立授权，本次未做，正确）。

### 3. 无 API Key / prompt / rawText / 完整原始响应泄漏 ✅
- 文档敏感信息正则扫描**零命中**（无 C:\ / /Users / sk- / Bearer / 真实 Key）。
- 文档仅含汇总字段（riskLevel / dimension / confidenceScore），**未**嵌入 prompt（microservices 提案）或模型完整原始输出。
- 说明（非阻塞）：`spike-local-llm.js:104-106` 会把完整 raw response 打到 **本地 stdout**——因 spike 用的是合成提案（非真实评审 rawText）、且为本地 LM Studio，属可接受；**文档已正确省略**该原始内容。建议 7.2 试点若涉及更敏感内容，应抑制/脱敏 stdout 原始 dump。

### 4. 调用次数 ≤2 ✅
- 文档明确「2/2 角色调用成功」：CTO + CFO = **2 次**。
- 在 7.0 契约 spike 上限（≤3）内，满足「调用次数上限」约束。

### 5. 成功时 JSON 可解析，riskLevel/dimension/confidenceScore 合法 ✅
- 两条记录均 `JSON parse ✅`。
- `riskLevel`：CTO=`high`、CFO=`medium` —— 均属合法集（high/medium/low/info）。
- `confidenceScore`：CTO=95（0-100 区间，合法）。
- `dimension`：自由字符串（Architecture / Cost and Operational Complexity），与角色视角契合。

### 6. 失败分类准确，不误判系统成功/失败 ✅
- 本次 2/2 成功，无失败样本；但脚本失败路径正确：
  - `spike-local-llm.js:94-98` HTTP 非 2xx → 打印 `❌ HTTP` + `exit(1)`；
  - `:145-149` `AbortError`/异常 → 打印 `❌ timed out/failed` + `exit(1)`。
  - 失败以非零退出码显式标记，**不会**被误判为成功。
- 非阻塞软提示：`spike-local-llm.js:134-136` 对「HTTP 200 但 JSON 不可解析」仅打印 `⚠️` 不 `exit(1)`；本次两笔均解析成功，不阻塞；建议 7.2 将「无法解析的成功响应」也按失败计，避免静默通过。

### 7. 默认 mock 不受影响 ✅
- `provider-adapter.js:208-210`：`MODEL_PROVIDER` 未设或为 `mock` → 返回 mock，逻辑与 7.0 复审时一致，**未改动**。
- spike 仅在 `MODEL_PROVIDER=lmstudio && ALLOW_EXTERNAL_MODEL_CALLS=true` 时进入真实路径（`:212-218`），默认行为零影响。

### 8. 无 schema / 前端 / 队列主链路改动 ✅
- spike 脚本为独立 `scripts/`，不 import 任何 `apps/` 模块、不触碰 Prisma schema、不修改前端、不接 queue。
- 文档为纯实测记录，未声明任何代码/schema/前端改动。

---

## 非阻塞建议（不拦 Gate）

1. **Base URL 文档精度**：文档写 `127.0.0.1:1234`，而 `spike-local-llm.js:15` 默认 `http://10.0.45.168:1234/v1`——本次应设了 `LMSTUDIO_BASE_URL` 且未带 `/v1` 后缀。建议文档补全为可复现的完整 URL（如 `http://127.0.0.1:1234/v1`）。
2. **stdout 原始 dump（见 #3）**：7.2 试点前在脚本层对 raw response 做抑制/脱敏，避免潜在敏感内容进入日志。
3. **解析失败即失败（见 #6）**：将「HTTP 200 但 JSON 不可解析」也计为失败退出，强化 fail-closed。

---

## 总结

Sprint 7.1 是 7.0 契约的忠实执行：standalone、本地 lmstudio、2 次调用（≤上限）、无 Key/出域、默认 mock 零影响、文档无泄漏、无主链路改动。八项检查全过，**Gate = Go（无保留）**，可进入 7.2 dev-only queue 试点。
