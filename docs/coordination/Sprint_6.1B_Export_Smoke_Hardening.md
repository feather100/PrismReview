# Sprint 6.1B — Export Smoke Hardening

> 只补 smoke-export.js 断言，不改业务功能。

---

## 1. 新增断言

| 新增测试 | 类型 |
|---|---|
| Not contain sk- (API key pattern) | 敏感禁出 |
| Not contain prompt | 敏感禁出 |
| Not contain api_key | 敏感禁出 |
| Contains provider summary section | 内容完整性 |
| Contains total turns | 内容完整性 |
| Contains Mock count | 内容完整性 |
| Contains Fallback count | 内容完整性 |
| Contains Failed count | 内容完整性 |
| Mock fallback path: Status 200 | mock_fallback 路径 |
| Mock fallback path: Contains source info | mock_fallback 路径 |

## 2. 验证

```
smoke-export: 21/21 ✅ (+10 from Sprint 6.1)
```
