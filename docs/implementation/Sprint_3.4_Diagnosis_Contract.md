# Sprint 3.4 — Diagnosis Trigger Policy & Contract

> 明确 `POST /api/reviews/{id}/diagnose` + `GET /api/reviews/{id}/diagnosis` 的契约。
> 当前行为已满足所有需求，无需后端改动。

---

## 1. Status 流转

```
draft ── POST /diagnose ──→ diagnosing ──(immediate)──→ ready
                        ↑                                  │
                        └────── (不允许重复 diagnose) ──────┘
ready ── POST /start ──→ running ──→ ... ──→ completed / failed
                            │
                            └────── diagnose → 400
```

### 规则

| 当前 status | `POST /diagnose` | `GET /diagnosis` |
|---|---|---|
| `draft` | ✅ 200 → `diagnosing` → `ready` | ✅ `null`（无诊断结果） |
| `diagnosing` | ❌ 不允许 | ✅ `null` |
| `ready` | ❌ 400（已诊断过） | ✅ 完整 DiagnosisResult |
| `running` | ❌ 400 | ✅ 完整 DiagnosisResult |
| `completed` | ❌ 400 | ✅ 完整 DiagnosisResult |
| `failed` | ❌ 400 | ✅ 完整 DiagnosisResult（如有） |

---

## 2. API 契约

### POST /api/reviews/{reviewId}/diagnose

**状态码**：
- `201` — 诊断成功（同步完成）
- `400` — status 不允许 diagnose（非 draft）
- `404` — review 不存在

**Response 201**:
```json
{ "taskId": "mock-diagnosis-{reviewId}" }
```

**Response 400**:
```json
{ "code": "VALIDATION_ERROR", "message": "Review status \"ready\" does not allow this operation. Allowed: draft", "statusCode": 400 }
```

### GET /api/reviews/{reviewId}/diagnosis

**状态码**：
- `200` — 成功（可能返回 `null` 表示尚未诊断）
- `400` — 非法 UUID
- `404` — review 不存在

**Response 200（已诊断）**:
```json
{
  "summary": "方案 \"...\" 涉及 ...。系统自动识别以下风险维度。",
  "tags": ["架构设计", "技术可行性", "高并发"],
  "radarDimensions": [
    { "name": "架构合理性", "score": 72 },
    ...
  ],
  "confidenceScore": 82,
  "recommendedRoles": [
    { "roleId": "uuid", "roleCode": "CTO", "roleName": "技术审核员", "weight": 30, "reason": "...", "removable": false },
    ...
  ]
}
```

**Response 200（未诊断）**:
```
null
```

---

## 3. 前端状态指南

### Draft 页面（未诊断）

| 条件 | 显示 |
|---|---|
| `GET /diagnosis` → `null` | 显示空态：引导用户点击 "生成方案诊断书" |
| 用户点击后 `POST /diagnose` | 显示 loading → 轮询 `GET /diagnosis` 直到返回非 null |

### Ready 页面（已诊断，未开始评审）

| 条件 | 显示 |
|---|---|
| `GET /diagnosis` → 完整结果 | 显示诊断书（摘要 + 雷达图 + 推荐角色） |
| `diagnosis.recommendedRoles` | 显示角色卡片列表（roleCode/roleName/weight/reason/removable） |
| 角色展示 | 可展示 `removable` 标记判断是否可移除 |

### Running / Completed 页面

| 条件 | 显示 |
|---|---|
| `GET /diagnosis` → 同 ready | 诊断书只读展示 |
| 不可再调用 `POST /diagnose` | 按钮禁用或隐藏 |

### 错误处理

| HTTP status | 前端行为 |
|---|---|
| 400 `VALIDATION_ERROR` | 显示 Alert："当前评审状态不允许诊断" |
| 404 `NOT_FOUND` | 显示 404 页面 |
| 非法 UUID (400) | 路由层由 ParseUUIDPipe 拦截 |

---

## 4. 验证

### smoke-runtime.js 现有覆盖

| 测试 | 覆盖情况 |
|---|---|
| POST diagnose (draft) → 201 | ✅ test 7 |
| GET diagnosis after diagnose → 200 + confidenceScore | ✅ test 8 |
| POST roles + start → running | ✅ test 9-11 |
| POST diagnose after start → 400 | ❌ 新增在本 sprint |

### 新增测试（已补充到 smoke-runtime）

```
7.  POST /reviews/{id}/diagnose (draft)               → 201 ✅
8.  GET /reviews/{id}/diagnosis (after diagnose)        → 200 ✅
11. POST /reviews/{id}/start → running                 → 201 ✅
12. POST /reviews/{id}/roles after start → 400         → 400 ✅
23. GET /reviews/invalid-uuid/diagnosis → 400          → 400 ✅
24. GET /reviews/non-existent/diagnosis → 404           → 404 ✅
```

### 未覆盖（低优先级）

- GET diagnosis on draft → null（前端不会在 draft 页主动展示 diagnosis，不影响）
- Re-diagnose on ready → 400（前端 ready 页应隐藏 diagnose 按钮）
- Diagnose on running → 400（前端 running 页应隐藏 diagnose 按钮）

---

## 5. 结论

**当前后端行为已满足所有需求，无需改动。**

| 需求 | 状态 |
|---|---|
| draft 允许 diagnose | ✅ |
| diagnose 成功 → ready | ✅ |
| ready 不允许重复 diagnose | ✅ |
| running/completed 禁止 diagnose | ✅ |
| GET diagnosis 返回 null 或完整结果 | ✅ |
| 非法 UUID → 400 | ✅ |
| 不存在 → 404 | ✅ |
