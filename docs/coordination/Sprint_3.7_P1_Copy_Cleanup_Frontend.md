# Sprint 3.7 — P1 Copy Cleanup (Frontend)

## 1. 概览

根据 `docs/coordination/Sprint_3.6_Qoderwork_Review.md` 提供的 Code Review 反馈，本次 Sprint 专项修复了前端由于英文兜底文案和脆弱字符串匹配导致的 4 个 P1 问题。

## 2. 修复明细

### 2.1 首页 Demo 兜底英文清理
- **位置**：`apps/web/src/app/page.tsx`
- **修复**：将 `Failed to create mock demo review.` 改为更符合业务语境的中文化报错：`创建 Mock 演示评审失败，请稍后重试。`

### 2.2 MeetingPage SSE 错误兜底英文清理
- **位置**：`apps/web/src/features/meeting/MeetingPage.tsx`
- **修复**：在 SSE 错误处理分支 `case 'error'` 中，将 fallback 文案 `Server encountered an error during the meeting.` 改为了 `会议流连接异常，请稍后重试。`

### 2.3 DiagnosisPage 状态机错误匹配重构
- **位置**：`apps/web/src/features/diagnosis/DiagnosisPage.tsx`
- **修复**：提取了 `isReviewStateError` 统一辅助函数，检查错误消息中是否包含 `status|状态|allow|VALIDATION_ERROR`，替代了散落在多处的易碎中英文子串硬编码判断，在保证状态机安全的同时提升了代码鲁棒性。

### 2.4 Diagnosis 404 回退文案清理
- **位置**：`apps/web/src/lib/api-client/client.ts`
- **修复**：在 `getDiagnosis` 捕获到 404 错误时，将其默认填充的 `Invalid review ID` 更替为纯正的中文翻译 `评审 ID 无效或不存在。`

## 3. 验证情况

- `apps/web tsc` 检查：**0 errors** ✅
- 后端契约一致性：无任何 API 字段、后端逻辑或状态机变动，完全兼容当前系统 ✅

## 4. Frontend Gate
**Go ✅** - 所有遗留的 P1 Copy 问题清理完毕，页面反馈体验实现闭环。
