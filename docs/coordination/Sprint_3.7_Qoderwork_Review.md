# Sprint 3.7 P1 Copy Cleanup — 独立复审报告

> 审查方：QoderWork（独立于 antigravity）  
> 审查日期：2026-07-09  
> 审查模式：只读审查，未修改任何代码  

---

## Gate 结论：Go（无 P0 阻塞项）

Sprint 3.6 复审报告中提出的 4 项 P1 全部关闭，状态机无回归，无新增英文用户可见主提示。tsc 由提交方确认 0 errors。建议进入下一 Sprint。

---

## 1. P1 关闭验证

### P1-1: 首页 Demo 英文 fallback — 已关闭 ✅

- **文件**: `apps/web/src/app/page.tsx:72`
- **修复前**: `err.message || 'Failed to create mock demo review.'`
- **修复后**: `err.message || '创建 Mock 演示评审失败，请稍后重试。'`
- **验证**: 纯正中文兜底，无英文残留。

### P1-2: MeetingPage SSE 错误兜底英文 — 已关闭 ✅

- **文件**: `apps/web/src/features/meeting/MeetingPage.tsx:80`
- **修复前**: `'Server encountered an error during the meeting.'`
- **修复后**: `'会议流连接异常，请稍后重试。'`
- **验证**: 纯正中文兜底，无英文残留。该文案会渲染到第 126 行 `<Alert message="会议异常" description={backendError}>` 的 description 区域，与中文标题一致。

### P1-3: handleDiagnose 字符串匹配脆弱 — 已关闭 ✅

- **文件**: `apps/web/src/features/diagnosis/DiagnosisPage.tsx:10-13, 52, 141`
- **修复前**: 两处散落的 `err.message?.includes('status')` 和 `err.message?.includes('does not allow this operation')`
- **修复后**: 提取统一辅助函数 `isReviewStateError`，使用正则 `/status|状态|allow|VALIDATION_ERROR/i` 匹配。`handleDiagnose`（第 52 行）和 `handleConfirm`（第 141 行）均引用此函数。
- **评估**:
  - 比原来的散落子串匹配更集中、更易维护
  - 新增 `VALIDATION_ERROR` 匹配项，与后端 `global-exception.filter.ts` 的 code 字段对齐
  - 正则中的 `allow` 和 `status` 存在宽泛匹配可能（如含 "not allowed" 的非状态错误也会命中），但因 `handleConfirm` 已有第 116 行 `review?.status !== 'ready'` 前置守卫，且误判仅影响 toast 文案选择（不跳过 API 调用），风险可控
  - **理想方案**（标记为 P2 技术债）：client.ts 抛出的 Error 携带 HTTP status 或后端 code，前端按结构化字段判断而非 message 子串

### P1-4: getDiagnosis 404 英文 fallback — 已关闭 ✅

- **文件**: `apps/web/src/lib/api-client/client.ts:200`
- **修复前**: `error.response?.data?.message || 'Invalid review ID'`
- **修复后**: `error.response?.data?.message || '评审 ID 无效或不存在。'`
- **验证**: 纯正中文兜底，无英文残留。

---

## 2. 状态机回归检查

| 规则 | 实现位置 | 结果 |
|------|----------|------|
| draft 只能开始诊断 | `DiagnosisPage:161` `review?.status === 'draft'` 条件渲染 | ✅ 未变 |
| ready 才能确认评审团 | `DiagnosisPage:170` UI 条件 + `DiagnosisPage:116` 逻辑守卫 | ✅ 未变 |
| draft/ready 不连 Meeting SSE | `MeetingPage:101` `isSSEEnabled` 白名单 | ✅ 未变 |
| draft/ready/running 不展示报告 | `ReportPage:40` 前置门控 | ✅ 未变 |
| handleConfirm 前置状态守卫 | `DiagnosisPage:116` `review?.status !== 'ready'` | ✅ 未变 |
| 按钮 loading 防竞态 | handleDiagnose/handleConfirm 的 diagnosing/submitting 标志 | ✅ 未变 |

**结论：状态机零变动，Sprint 3.5/3.6 的守卫全部保持。**

---

## 3. 英文用户可见主提示扫描

| 文件 | 扫描范围 | 结果 |
|------|---------|------|
| `page.tsx` | 所有 catch/Alert/Empty/Button/Tooltip | ✅ 无英文主提示 |
| `DiagnosisPage.tsx` | 所有 message.success/error/warning、Alert、Empty、Tooltip | ✅ 无英文主提示 |
| `MeetingPage.tsx` | 所有 Alert、Spin tip、error fallback | ✅ 无英文主提示 |
| `client.ts` | 所有 catch 分支的中文前缀和兜底文案 | ✅ 无英文兜底 |
| `ReportPage.tsx` | 状态门控、GradeTag、Alert | ✅ 无新增（P2 项仍在） |
| `reviews/page.tsx` | statusMap、Tooltip、Alert | ✅ 无变动 |
| `reviews/new/page.tsx` | 表单标签、placeholder、message | ✅ 无变动 |

**残留英文（均非主提示，可接受）**:
- `MeetingPage.tsx:42` — `data.dimension || 'General'`：技术默认值，后端通常提供 dimension
- `page.tsx:44` — Demo 评审标题/目标为英文：演示用 mock 数据，非错误文案
- `ReportPage.tsx:123` — `{data.opinionCount} opinions`：P2-1 延后项
- `ReportPage.tsx:98` — actionItems 状态列渲染后端英文枚举：P2-2 延后项

---

## 4. tsc 状态

提交方确认 `apps/web tsc --noEmit`: **0 errors**。当前环境无法跨平台执行 tsc，以提交方结果为准。

---

## P0 阻塞项

**无。**

---

## P1 建议项

**无。** Sprint 3.6 的 4 项 P1 已全部关闭，本次审查未发现新的 P1 问题。

---

## P2 可延后项

### P2-1: isReviewStateError 仍依赖 message 子串匹配

- **文件**: `DiagnosisPage.tsx:10-13`
- **现状**: 正则 `/status|状态|allow|VALIDATION_ERROR/i` 匹配 message 文本
- **风险**: `allow`/`status` 可能过度匹配非状态类错误
- **建议**: 后续让 client.ts 抛出带 `statusCode` 或 `code` 的结构化 Error 对象，前端按结构化字段判断
- **优先级**: 低（当前功能正常，`handleConfirm` 有前置守卫兜底）

### P2-2 ~ P2-9: 从 Sprint 3.6 延续

以下为 Sprint 3.6 复审报告中记录的 P2 项，Sprint 3.7 未涉及，继续跟踪：

| # | 描述 | 文件 |
|---|------|------|
| P2-2 | ReportPage "opinions" 英文 | `ReportPage.tsx:123` |
| P2-3 | ReportPage Action Items 状态列未映射中文 | `ReportPage.tsx:98` |
| P2-4 | ContextPanel 硬编码占位文本 | `MeetingPage.tsx:160` |
| P2-5 | 后端 REVIEW_STATUS_FLOW 仅作文档用途 | `reviews.service.ts:12-22` |
| P2-6 | 后端 MOCK_ROLES 死代码 | `reviews.service.ts:25-31` |
| P2-7 | 后端英文错误消息（前端中文前缀包裹，技术详情英文可接受） | `reviews.service.ts` 多处 |
| P2-8 | useEffect 依赖 lint 警告 | `DiagnosisPage.tsx:41-43`, `MeetingPage.tsx:89-99` |

---

## 涉及文件清单

| 文件路径 | Sprint 3.7 变更 | 审查结论 |
|----------|-----------------|----------|
| `apps/web/src/app/page.tsx:72` | 英文 fallback → 中文 | ✅ P1-1 关闭 |
| `apps/web/src/features/meeting/MeetingPage.tsx:80` | 英文 fallback → 中文 | ✅ P1-2 关闭 |
| `apps/web/src/features/diagnosis/DiagnosisPage.tsx:10-13,52,141` | 提取 isReviewStateError 统一函数 | ✅ P1-3 关闭 |
| `apps/web/src/lib/api-client/client.ts:200` | 英文 fallback → 中文 | ✅ P1-4 关闭 |

---

## 是否建议进入下一 Sprint

**建议进入。** Sprint 3.7 精准关闭了 Sprint 3.6 复审报告中的全部 4 项 P1，变更范围小且聚焦（4 个文件、5 处修改），未引入任何状态机回归或新的英文主提示。前端用户可见文案已实现全链路中文化闭环。
