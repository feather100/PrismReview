# Sprint 4.6 — Provider Robustness Harness

> 在不调用任何真实外部模型的前提下，建立 provider 输出鲁棒性测试。

---

## 1. 修改文件

| 文件 | 变更 |
|---|---|
| `scripts/provider-adapter.js` | 导出 `stripMarkdown`/`normalizeParsed`；`normalizeParsed` 增强：confidenceScore 大小写不敏感 + 字符串转数字 |
| `scripts/smoke-provider-robustness.js` | 新增 14 个鲁棒性测试 |

## 2. Parse/Normalize 行为

| 输入格式 | 结果 | 说明 |
|---|---|---|
| 标准 JSON | ✅ 正常解析 | — |
| ` ```json ` 包裹 | ✅ 正常解析 | Markdown 剥离 |
| JSON 数组 | ✅ 取 `[0]` | 自动展开 |
| `RiskLevel` uppercase | ✅ `riskLevel` | normalize 后保留原始值；provider 层 `.toLowerCase()` |
| `CONFIDENCESCORE` | ✅ `confidenceScore` | 大小写不敏感 |
| content 空（Gemma reasoning） | ❌ parseError | provider 层抛错 |
| 非 JSON 文本 | ❌ JSON.parse 失败 | provider 层抛错 |
| 缺 `riskLevel` | ❌ provider 层检测 | normalize 通过，provider 层 `if (!parsed.riskLevel) throw` |
| 缺 `dimension` | ✅ 可恢复 | normalize 通过，dimension 为 `''` |
| `riskLevel: "critical"` | ✅ 保留原始值 | 业务层决定有效性 |
| `confidenceScore: "85"` | ✅ 转 number | `parseFloat("85")` |
| 401/403 | ❌ fail closed | provider 层不 fallback |

## 3. 测试结果

```
smoke-provider-robustness: 14/14 ✅
```
