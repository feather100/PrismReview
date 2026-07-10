# Sprint 7.1 — Standalone Real Provider Spike

> LM Studio 本地模型受控验证。仅 standalone spike，不接主链路。

---

## 0. LM Studio Base URL 规范

**Base URL 必须包含 `/v1`**，例如：

- `http://127.0.0.1:1234/v1` ✅
- `http://10.0.45.168:1234/v1` ✅（局域网）
- `http://127.0.0.1:1234` ❌（缺少 /v1，LM Studio OpenAI-compatible endpoint 在 /v1 路径下）

---

## 1. 验证结果

### CTO

| 项目 | 值 |
|---|---|
| Provider | lmstudio (本地) |
| Model | google/gemma-4-12b |
| Base URL | http://127.0.0.1:1234/v1 |
| Duration | 88s |
| HTTP | 200 ✅ |
| JSON parse | ✅ |
| riskLevel | high ✅ |
| dimension | Architecture ✅ |
| confidenceScore | 95 ✅ |
| API Key / prompt / rawText 泄漏 | 无 ✅ |

### CFO（追加验证）

| 项目 | 值 |
|---|---|
| Duration | 68s |
| riskLevel | medium ✅ |
| dimension | Cost and Operational Complexity ✅ |
| JSON parse | ✅ |

---

## 2. 验收清单

| 检查项 | CTO | CFO |
|---|---|---|
| 脱敏记录（无 API Key） | ✅ | ✅ |
| HTTP 成功 | ✅ | ✅ |
| JSON 可解析 | ✅ | ✅ |
| riskLevel 合法 | ✅ | ✅ |
| confidenceScore 合法 | ✅ | ✅ |
| 空 content / reasoning_content 处理 | ✅（无此场景） | ✅ |
| 无 API Key / prompt / rawText 泄漏 | ✅ | ✅ |

---

## 3. 结论

**LM Studio local provider 成功路径已验证。** 2/2 角色调用成功，JSON 输出规范，无安全性问题。

- 耗时 68-88s（本地模型，可接受）
- 风险判定与角色视角契合（CTO→架构, CFO→成本）
- 适合作为 Sprint 7.2 的 dev-only queue 试点模型

---

## 4. Sprint 7.1B Spike Hygiene Hardening

### 修改

- `spike-provider-guard.js`：抑制完整 raw response 输出（需 `DEBUG_PROVIDER_RAW=true` 才打印）
- `spike-provider-guard.js`：JSON parse / schema 错误 → exit code 非 0
- 文档：明确 LM Studio Base URL 必须包含 `/v1`

### 验证

- 默认 mock spike 仍通过 ✅
- smoke-provider-robustness 14/14 ✅
