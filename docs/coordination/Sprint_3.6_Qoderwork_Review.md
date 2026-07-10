# Sprint 3.6 P1 Hardening — 独立复审报告

> 审查方：QoderWork（独立于 antigravity）  
> 审查日期：2026-07-09  
> 审查模式：只读审查，未修改任何代码  

---

## Gate 结论：Go（无 P0 阻塞项）

Sprint 3.6 的三项核心目标——diagnosis null/404 语义对齐、token 硬编码收敛、英文文案中文化——均已正确实现。文档-后端-前端三方契约一致，状态机回归无退化。存在 4 项 P1 建议项和若干 P2 延后项，均不阻塞发布。

---

## 1. Diagnosis null / 404 语义

### 1.1 三方一致性验证

| 场景 | 契约文档 (Sprint 3.4) | 后端实现 (reviews.service.ts) | 前端处理 (client.ts + DiagnosisPage.tsx) | 一致？ |
|------|----------------------|-------------------------------|------------------------------------------|--------|
| draft 未诊断 → GET /diagnosis | 200, `null` | 第 113 行 `if (!review.diagnosis) return null;` → 200 null | `getDiagnosis` 返回类型 `DiagnosisResponse \| null`，200 null 正常返回 | ✅ |
| draft 未诊断 → 页面渲染 | 显示空态 | — | `DiagnosisPage:81-101` 判断 `!data && review?.status === 'draft'` → 渲染 "该评审尚未开始诊断" 中文空态 | ✅ |
| ready/running/completed → GET /diagnosis | 200, 完整结果 | 返回 enriched DiagnosisResult | `setData(diagRes)` 正常渲染 | ✅ |
| 非 draft 重诊 → POST /diagnose | 400, VALIDATION_ERROR | `assertReview` 抛 BadRequestException | `handleDiagnose` catch 显示 "当前状态不允许重新诊断" | ✅ |
| 不存在的 review → GET /diagnosis | 404, NOT_FOUND | `NotFoundException('Review not found')` | `client.ts:199-201` 拦截 404 抛中文错误 "未找到该评审信息 (404)..." | ✅ |
| 非法 UUID → GET /diagnosis | 400, VALIDATION_ERROR | ParseUUIDPipe 拦截 | `client.ts:202` 走通用错误路径 "获取诊断结果失败: ..." | ✅ |

**结论：三方完全一致。draft 未诊断不会被前端误判为错误；不存在的 review 仍正确走错误态。**

### 1.2 代码变更审查

**`DiagnosisPage.tsx:20-34`**：原嵌套 try/catch 已被移除，`getReview` 和 `getDiagnosis` 现在处于同一 try 块中。当 `getDiagnosis` 返回 null（200 OK）时直接 `setData(null)`，不再经过 inner catch。这一简化与后端新行为完全匹配。

**`client.ts:189-206`**：`getDiagnosis` 返回签名从 `Promise<DiagnosisResponse>` 改为 `Promise<DiagnosisResponse | null>`。404 不再返回 "未找到诊断信息。请确保您输入的评审 ID 正确。"（误导性文案），而是返回 "未找到该评审信息 (404): ..." 并携带后端原始 message。语义更准确。

---

## 2. Token 清理

### 2.1 现状

**`client.ts:4`**：

```ts
const API_AUTH_TOKEN = process.env.NEXT_PUBLIC_API_AUTH_TOKEN || 'test-token';
```

所有 8 个 API 方法均通过 `Bearer ${API_AUTH_TOKEN}` 引用此常量。经逐行检查，文件中不存在任何散落的 `Bearer test-token` 硬编码。

### 2.2 评估

| 检查项 | 结果 |
|--------|------|
| 散落硬编码是否清除 | ✅ 7 处已替换为统一常量 |
| 是否集中管理 | ✅ 单点常量 `API_AUTH_TOKEN` |
| 环境变量注入路径是否明确 | ✅ `NEXT_PUBLIC_API_AUTH_TOKEN`，Next.js 标准约定 |
| 是否引入真实鉴权假象 | ✅ 无。fallback 为 `'test-token'`，注释和文档中均未暗示已接入真实鉴权 |
| 后续替换是否零改动 | ✅ 仅需配置环境变量，无需改代码 |

**结论：Token 清理彻底，结构合理。**

---

## 3. 英文用户文案

### 3.1 已中文化项（确认通过）

| 文件 | 位置 | 现状 |
|------|------|------|
| `client.ts` | 所有 catch 分支 | 中文前缀 + 后端 message 拼接，如 "获取评审列表失败: ..." |
| `client.ts:199-201` | getDiagnosis 404 | "未找到该评审信息 (404): ..." |
| `client.ts:261-262` | getReview 404 | "未找到该评审信息 (404)。请检查评审 ID 是否正确。" |
| `client.ts:264-265` | getReview 400 | "无效的请求 (400)。请检查请求参数。" |
| `DiagnosisPage.tsx` | 所有 Alert/Empty/Button | 全中文 |
| `MeetingPage.tsx` | 状态门控 Alert | "无法进入会议室" / "该评审尚未开始..." 中文 |
| `ReportPage.tsx` | 状态门控 | "该评审尚未完成（当前状态：...）" 中文 |
| `ReportPage.tsx:13` | GradeTag | approved→通过 / conditionally_approved→有条件通过 / rejected→拒绝 |
| `reviews/page.tsx:9-19` | statusMap | 9 个状态全部中文映射 |
| `reviews/new/page.tsx` | 表单标签/placeholder | 全中文 |

### 3.2 仍存在的英文文案

| # | 文件 | 位置 | 内容 | 严重度 |
|---|------|------|------|--------|
| E-1 | `page.tsx` (首页 Demo) | 第 72 行 | `err.message \|\| 'Failed to create mock demo review.'` | **P1** — 用户可见 Alert 兜底文案为英文 |
| E-2 | `MeetingPage.tsx` | 第 80 行 | `'Server encountered an error during the meeting.'` | **P1** — SSE error 事件的兜底文案为英文，会渲染到 "会议异常" Alert 的 description |
| E-3 | `ReportPage.tsx` | 第 123 行 | `{data.opinionCount} opinions` | **P2** — 数字后跟英文 "opinions"，可改为 "条专家意见" |
| E-4 | `ReportPage.tsx` | 第 98 行 | actionColumns 状态列直接渲染后端英文枚举（open/in_progress/done 等） | **P2** — 可映射为中文 |

**E-1 和 E-2 建议在合并前修复（P1），E-3 和 E-4 可延后（P2）。**

---

## 4. 状态机回归

### 4.1 前端状态守卫逐项验证

| 规则 | 实现位置 | 结果 |
|------|----------|------|
| draft 只能开始诊断 | `DiagnosisPage:156` `review?.status === 'draft'` 条件渲染按钮 | ✅ |
| ready 才能确认评审团 | `DiagnosisPage:165` UI 条件 + `DiagnosisPage:111` 逻辑守卫 `review?.status !== 'ready'` | ✅ |
| draft/ready 不连 Meeting SSE | `MeetingPage:101` `isSSEEnabled` 仅 running/interrupted/summarizing/completed 为 true | ✅ |
| draft/ready/running 不展示报告 | `ReportPage:40` 前置状态门控 + 中文提示 | ✅ |
| 非 draft 不可触发 diagnose | `DiagnosisPage:156` 按钮仅 draft 渲染；后端 `assertReview(['draft'])` 双重保险 | ✅ |
| 非 ready 不可 saveRoles+start | `DiagnosisPage:111` 前置守卫；后端状态机兜底 | ✅ |

### 4.2 后端状态机

**`REVIEW_STATUS_FLOW`（reviews.service.ts:12-22）**：9 状态流转表未变。

**注意**：`REVIEW_STATUS_FLOW` 常量仅作文档用途，实际状态守卫由 `assertReview` 中的硬编码数组执行。这不是 Sprint 3.6 引入的问题，是既有设计，记录为 P2 跟踪项。

### 4.3 后端 400 错误码修复

**`global-exception.filter.ts:54-55`**：新增 `case 400: return { code: 'VALIDATION_ERROR', message, statusCode: 400 }`。与契约文档约定的错误码格式一致。smoke-runtime 31/31 通过。

---

## 5. 新风险排查

### 5.1 useEffect 重复请求

| 文件 | useEffect 依赖 | 分析 | 结果 |
|------|---------------|------|------|
| `DiagnosisPage.tsx:36-38` | `[reviewId]` | `fetchDiagnosisData` 未在依赖中，但 reviewId 不变时 effect 不重触发 | ✅ 无风险 |
| `MeetingPage.tsx:89-99` | `[reviewId]` | 同上模式 | ✅ 无风险 |
| `MeetingPage.tsx:101-102` | `[reviewId, enabled]` | enabled 从 null→true 变化时触发 SSE 建连，符合预期 | ✅ 正确 |
| `ReportPage.tsx:33-55` | `[reviewId]` | 先 getReview 再 getReport，单链路 | ✅ 无风险 |
| `reviews/page.tsx:52-54` | `[pagination.current, pagination.pageSize, statusFilter]` | 各值变化时重新请求，符合分页预期 | ✅ 无风险 |

**结论：无新增 useEffect 重复请求风险。**

### 5.2 按钮竞态

| 场景 | 防护机制 | 结果 |
|------|----------|------|
| 连续点击 "开始诊断" | `diagnosing` state + Ant Design `loading` 属性自动禁用 | ✅ |
| 连续点击 "确认评审团" | `submitting` state + Ant Design `loading` 属性自动禁用 | ✅ |
| 诊断完成后再次点击 | 按钮仅在 `review?.status === 'draft'` 渲染，诊断完成后 refetch 更新 status 为 ready，按钮消失 | ✅ |
| Demo 页 "创建 Mock 演示" | `loading` state 控制 Spin/Button 切换 | ✅ |

**结论：无新增按钮竞态风险。**

### 5.3 新增 API 字段猜测

经对比 `client.ts` 中所有 interface 定义与后端 DTO/响应：

| 前端 Interface | 后端对应 | 字段匹配 |
|---------------|---------|---------|
| `DiagnosisResponse` | `DiagnosisResponseDto` | summary, tags, radarDimensions, confidenceScore, recommendedRoles ✅ |
| `RecommendedRole` | 后端 `recommendedRoles[]` | roleId, roleCode, roleName, weight, reason, removable ✅ |
| `ReviewResponse` | `ReviewResponseDto` | id, title, status ✅ |
| `ReportResponse` | `ReportResponseDto` | verdict, executiveSummary, metrics, risks, opinions, actionItems, lowConfidenceItems ✅ |
| `RoleSelectionInput` | `SaveRoleSelectionDto` | roleId, weight ✅ |

**结论：无新增字段猜测。所有前端类型定义与后端契约匹配。**

### 5.4 评审列表回归

**`reviews/page.tsx`**：statusMap 从 5 个状态扩展到 9 个（新增 diagnosing/interrupted/summarizing/archived），操作列按钮逻辑未变。列表 API 调用方式不变。

**结论：评审列表未受破坏。**

---

## P0 阻塞项

**无。**

---

## P1 建议项

### P1-1: 首页 Demo 英文兜底文案

- **文件**: `apps/web/src/app/page.tsx:72`
- **现状**: `setError(err.message || 'Failed to create mock demo review.')`
- **问题**: 当 `err.message` 为空时，用户看到英文错误提示
- **建议**: 改为 `'创建演示评审失败。'`
- **影响**: 仅 Demo 工具页面，非核心流程，但用户可见

### P1-2: MeetingPage SSE 错误兜底英文

- **文件**: `apps/web/src/features/meeting/MeetingPage.tsx:80`
- **现状**: `'Server encountered an error during the meeting.'`
- **问题**: 当 SSE error 事件的 `data.message` 为空时，Alert 显示英文
- **建议**: 改为 `'会议过程中服务端发生异常。'`
- **影响**: 会议进行中出错时用户可见

### P1-3: handleDiagnose 错误分类仍依赖字符串匹配

- **文件**: `apps/web/src/features/diagnosis/DiagnosisPage.tsx:47`
- **现状**: `err.message?.includes('status') || err.message?.includes('状态')`
- **问题**: Sprint 3.6 后端已统一返回 `code: 'VALIDATION_ERROR'`，但前端仍通过 message 子串匹配分类错误。后端 message 文案变更会导致前端分支失效。
- **建议**: 后续可改为检查 HTTP status 或 error code，但当前因后端 message 包含 "status" 字样所以功能正常。标记为技术债。
- **影响**: 功能正常但脆弱

### P1-4: getDiagnosis 404 fallback 中残留英文片段

- **文件**: `apps/web/src/lib/api-client/client.ts:200`
- **现状**: `throw new Error(\`未找到该评审信息 (404): ${error.response?.data?.message || 'Invalid review ID'}\`)`
- **问题**: 当后端未返回 message 时，fallback 文本 `'Invalid review ID'` 为英文
- **建议**: 改为 `'无效的评审 ID'`
- **影响**: 极端边界（后端 404 无 message 体），但可修复

---

## P2 可延后项

### P2-1: ReportPage 英文 "opinions" 文案

- **文件**: `apps/web/src/features/report/ReportPage.tsx:123`
- **现状**: `{data.opinionCount} opinions`
- **建议**: 改为 `{data.opinionCount} 条专家意见`

### P2-2: ReportPage Action Items 状态列未映射中文

- **文件**: `apps/web/src/features/report/ReportPage.tsx:98`
- **现状**: 直接渲染后端枚举值 open/assigned/in_progress/blocked/done/canceled
- **建议**: 添加中文映射表

### P2-3: ContextPanel 硬编码占位文本

- **文件**: `apps/web/src/features/meeting/MeetingPage.tsx:160`
- **现状**: `summary="使用 Go 微服务重构订单系统，替代遗留的 PHP 单体架构..."`
- **建议**: 从 diagnosis.summary 或 review.objective 动态传入

### P2-4: 后端 REVIEW_STATUS_FLOW 仅作文档用途

- **文件**: `apps/api/src/modules/reviews/reviews.service.ts:12-22`
- **现状**: 定义了 9 状态流转表，但 `assertReview` 使用硬编码数组，不引用此常量
- **建议**: 后续可让 `assertReview` 引用 `REVIEW_STATUS_FLOW` 避免漂移

### P2-5: 后端 MOCK_ROLES 死代码

- **文件**: `apps/api/src/modules/reviews/reviews.service.ts:25-31`
- **现状**: 定义了 5 个 mock 角色常量但从未引用（`buildMockDiagnosis` 改为从 DB 查询真实角色）
- **建议**: 清理

### P2-6: 后端 reviews.service.ts 多处英文错误消息

- **文件**: `apps/api/src/modules/reviews/reviews.service.ts`
- **涉及**: `'Review not found'`（第 79, 112, 370 行）、`'One or more roles not found or disabled'`（第 149 行）、`'Role selection required before starting'`（第 168 行）等
- **说明**: 这些消息会被前端 client.ts 的中文前缀包裹（如 "获取评审详情失败: Review not found"），技术详情保留英文可接受，但长期应 i18n 化

### P2-7: useEffect 依赖 lint 警告

- **文件**: `DiagnosisPage.tsx:36-38`, `MeetingPage.tsx:89-99`
- **现状**: `fetchDiagnosisData` / 内联函数未列入依赖数组
- **说明**: 不影响功能（reviewId 不变时不重触发），但违反 React exhaustive-deps 规则

---

## 涉及文件清单

| 文件路径 | Sprint 3.6 变更 | 审查结论 |
|----------|-----------------|----------|
| `apps/web/src/lib/api-client/client.ts` | token 收敛 + null 返回类型 + 404/400 中文拦截 | ✅ 通过，P1-4 建议修复 |
| `apps/web/src/features/diagnosis/DiagnosisPage.tsx` | 移除嵌套 try/catch，直接处理 null | ✅ 通过 |
| `apps/web/src/app/page.tsx` (首页 Demo) | 无变更（Sprint 3.6 未涉及） | P1-1 英文兜底仍存在 |
| `apps/web/src/features/meeting/MeetingPage.tsx` | 无变更（Sprint 3.5 修复保持） | P1-2 英文兜底仍存在 |
| `apps/web/src/features/report/ReportPage.tsx` | 无变更（状态门控正确） | P2-1/P2-2 英文文案 |
| `apps/web/src/app/reviews/page.tsx` | 无变更（Sprint 3.5 statusMap 保持） | ✅ |
| `apps/web/src/app/reviews/new/page.tsx` | 无变更 | ✅ |
| `apps/api/src/common/filters/global-exception.filter.ts` | 新增 case 400 → VALIDATION_ERROR | ✅ |
| `apps/api/src/modules/reviews/reviews.service.ts` | 无变更 | P2-4/P2-5/P2-6 技术债 |

---

## 是否建议进入下一 Sprint

**建议进入。** Sprint 3.6 的 P1 Hardening 目标已达成：

1. diagnosis null/404 语义三方一致，draft 空态正确，不存在 review 仍为错误态 ✅
2. token 硬编码已收敛为单点常量，环境变量路径清晰 ✅
3. 核心流程的用户可见文案已基本中文化 ✅
4. 状态机无回归，无新增 useEffect 重复请求、按钮竞态或字段猜测 ✅

P1-1 和 P1-2 可在下一 Sprint 开头快速修复（各一行改动）。P1-3 和 P2 项作为技术债正常跟踪。
