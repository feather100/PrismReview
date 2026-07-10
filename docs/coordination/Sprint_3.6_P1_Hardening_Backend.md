# Sprint 3.6 — P1 Hardening Backend Contract Check

> 验证 `GET /api/reviews/{id}/diagnosis` 行为与 Sprint 3.4 契约一致。
> 发现 1 个 P1 错误码问题并已修复。

---

## 1. 阅读文档

- `docs/implementation/Sprint_3.4_Diagnosis_Contract.md` ✅
- `docs/roadmap/Sprint_3_Scope_Proposal.md` ✅

---

## 2. 实际行为验证

### 验证结果

| 场景 | 期望 | 实际 | 一致？ |
|---|---|---|---|
| GET diagnosis before diagnose (draft) | 200, `null` | 200, `null` | ✅ |
| POST diagnose on draft | 201 | 201 | ✅ |
| GET diagnosis after diagnose | 200, 完整结果 | 200, confidence=82, 5 roles | ✅ |
| Re-diagnose on ready | 400 | 400 | ✅ |
| Diagnose on running | 400 | 400 | ✅ |
| Invalid UUID | 400 | 400 | ✅ |
| Non-existent review | 404 | 404 | ✅ |

### 修复：错误码不匹配

**问题**：`BadRequestException`（status=400）在 `GlobalExceptionFilter` 中没有 `case 400`，导致返回 `code: 'INTERNAL_ERROR'` 而非约定的 `code: 'VALIDATION_ERROR'`。

**修复**：在 `global-exception.filter.ts` 的 switch 中补充 `case 400: return { code: 'VALIDATION_ERROR', message, statusCode: 400 }`。

**修复后结果**：

```
Re-diagnose on ready:  status=400 code=VALIDATION_ERROR ✅
Diagnose on running:   status=400 code=VALIDATION_ERROR ✅
```

---

## 3. 最终契约表

| Review status | 请求 | HTTP status | Response code | Response body | 前端处理 |
|---|---|---|---|---|---|
| `draft` | `GET /diagnosis` | 200 | — | `null` | 显示空态，引导 "生成方案诊断书" |
| `draft` | `POST /diagnose` | 201 | — | `{ taskId }` | 显示 loading，轮询 GET /diagnosis |
| `ready` | `GET /diagnosis` | 200 | — | 完整 DiagnosisResult | 显示诊断书 + 推荐角色 |
| `ready` | `POST /diagnose` | 400 | `VALIDATION_ERROR` | `{ code, message, statusCode }` | 显示 Alert，按钮隐藏/禁用 |
| `running` | `GET /diagnosis` | 200 | — | 完整 DiagnosisResult | 只读展示诊断书 |
| `running` | `POST /diagnose` | 400 | `VALIDATION_ERROR` | `{ code, message, statusCode }` | 按钮隐藏/禁用 |
| `completed` | `GET /diagnosis` | 200 | — | 完整 DiagnosisResult | 只读展示 |
| `completed` | `POST /diagnose` | 400 | `VALIDATION_ERROR` | `{ code, message, statusCode }` | 按钮隐藏/禁用 |
| — | 非法 UUID | 400 | `VALIDATION_ERROR` | `{ code, message, statusCode }` | 路由层 ParseUUIDPipe 拦截 |
| — | 不存在 review | 404 | `NOT_FOUND` | `{ code, message, statusCode }` | 显示 404 页面 |

---

## 4. 错误码统一

所有后端错误响应统一格式：

```json
{
  "code": "VALIDATION_ERROR | NOT_FOUND | FORBIDDEN | CONFLICT | INTERNAL_ERROR",
  "message": "Human-readable description",
  "statusCode": 400 | 404 | 403 | 409 | 500
}
```

前端应优先检查 `statusCode` 判断错误类型，而非 `code` 字符串。

---

## 5. 变更清单

| 文件 | 变更 | 风险 |
|---|---|---|
| `apps/api/src/common/filters/global-exception.filter.ts` | 新增 `case 400: VALIDATION_ERROR` | 低（已有 401/403/404/409/422/429 模式） |

**不改 schema，不改状态机，不新增 API，不接 LLM/runner/RAG。** ✅

---

## 6. 验证

```
smoke-runtime: 31/31 passed ✅
tsc:           0 errors     ✅
```

---

## 7. Backend Gate

**Go ✅** — 契约一致，无需额外后端变更。

### 给 antigravity 的前端处理建议

1. **`GET /diagnosis` 返回 `null`**：前端应判断 `response.data === null`，显示空态组件，而非报错。
2. **status 判断**：前端应通过 `response.statusCode`（HTTP 状态码）判断错误类型，不应硬编码 `code` 字符串。
3. **诊断书字段**：前端可安全依赖 `summary`, `tags`, `radarDimensions[]`, `confidenceScore`, `recommendedRoles[]` 的存在性，无需 `?.` 链式判空（但建议保留防御性检查）。
4. **`removable`**：`recommendedRoles[].removable` 已由后端计算（preset = false, custom = true），前端无需重复逻辑。
5. **空态文案**：推荐显示 "暂无诊断数据，请先生成方案诊断书" + 引导按钮。
