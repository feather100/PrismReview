# Sprint 3.6 — P1 Hardening Frontend Contract Check

## 1. 清理范围

本次 Sprint 主要聚焦于前端代码的清理与固化，不包含任何新特性或状态机的变动。

### 1.1 Token 硬编码收敛
- **处理方式**：消除了 `apps/web/src/lib/api-client/client.ts` 中分散的 7 处 `Bearer test-token` 硬编码。
- **现状**：统一通过 `API_AUTH_TOKEN` 常量进行管理。优先读取环境变量 `NEXT_PUBLIC_API_AUTH_TOKEN`，如未配置则 fallback 为 `'test-token'`，为后续真实鉴权铺平道路，同时满足当前 Mock 测试需求。

### 1.2 英文兜底文案中文化与错误透传
- **处理方式**：不再武断地覆盖后端错误，保留了在报错中携带后端详细错误的能力（通过 `error.response?.data?.message` 拼接），确保开发者能看到真实原因。
- **状态码映射**：在 `getReview` 与 `getDiagnosis` 中特别对 `404 NOT_FOUND` 和 `400 VALIDATION_ERROR` (Invalid UUID 等) 进行了中文拦截翻译，例如：“未找到该评审信息 (404)。请检查评审 ID 是否正确。”，从而避免了英文直接漏到 UI 层面。

### 1.3 诊断结果的 Null/404 处理 (对齐 Reasonix 契约)
- **契约对齐**：根据 Reasonix 确认，当 Review 处于 `draft` 状态时，`GET /api/reviews/{id}/diagnosis` 会正常返回 `200` 状态码且 Body 为 `null`。
- **前端适配**：在 `client.ts` 中，`getDiagnosis` 的返回签名变更为 `Promise<DiagnosisResponse | null>`，且不再将其视作抛错。在 `DiagnosisPage.tsx` 中去除了多余的 404 捕获分支（直接根据 `data === null` 及 `review.status === 'draft'` 渲染中文空态和诊断按钮）。只有在发生真正的系统级 404 或网络错误时，才会展示报错卡片。

## 2. 变更文件清单

| 文件路径 | 变更项 | 风险评估 |
|---|---|---|
| `apps/web/src/lib/api-client/client.ts` | 抽离 `API_AUTH_TOKEN`，优化 404/400 及 `null` 的中文错误提示与类型 | 低（不影响主流程） |
| `apps/web/src/features/diagnosis/DiagnosisPage.tsx` | 移除 `getDiagnosis` 的嵌套 `try/catch`，直接基于 `null` 数据展示 draft 状态 | 低（对齐最新后端表现） |

## 3. 验证结果

- `apps/web tsc` 编译结果：**0 errors** ✅
- `draft` 评审进入诊断页：显示正常的中文空态（“该评审尚未开始诊断”）并可点击触发诊断 ✅
- 非法/不存在的评审 ID 访问：显示中文报错 `未找到该评审信息 (404)...` ✅
- `ready/running/completed`：原有状态机与 UI 的对应不受任何影响 ✅

## 4. Frontend Gate

**Go ✅** — 所有 P1 Hardening 遗留的交互与代码质量问题已清理完毕，前端完全符合当前契约预期。
