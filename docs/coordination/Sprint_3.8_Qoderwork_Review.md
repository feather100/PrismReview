# Sprint 3.8 Review Creation UX Polish — 独立复审报告

> 审查方：QoderWork（独立于 antigravity）  
> 审查日期：2026-07-09  
> 审查模式：只读审查，未修改任何代码  

---

## Gate 结论：Go（无 P0 阻塞项）

Sprint 3.8 为纯前端 UX 优化，未触碰后端/API/状态机。三项交互改进（表单引导增强、draft 向导式空态、列表主操作按状态推演）均正确实现，未引入新的字段猜测、状态机漏洞或英文主提示。tsc 由提交方确认 0 errors。建议进入下一 Sprint。

---

## 1. 是否只做 UX，不改后端/API/状态机

| 文件 | 变更类型 | 是否涉及后端/API/状态机 |
|------|---------|----------------------|
| `apps/web/src/app/reviews/new/page.tsx` | 表单提示文案 + success toast | ❌ 纯 UX |
| `apps/web/src/features/diagnosis/DiagnosisPage.tsx` | Draft 空态 UI 重设计（Empty → Steps 向导） | ❌ 纯 UX |
| `apps/web/src/app/reviews/page.tsx` | 列表首按钮文案按状态动态化 | ❌ 纯 UX |
| `apps/web/src/lib/api-client/client.ts` | 未变更 | — |

**结论：本次 Sprint 仅修改前端 UI 层，所有 API 调用签名、状态守卫、错误处理逻辑均与 Sprint 3.7 保持一致。**

---

## 2. 新建评审表单 UX

### 2.1 中文提示

| 元素 | 内容 | 语言 | 结果 |
|------|------|------|------|
| 表单标题 | "新建架构评审" | 中文 | ✅ |
| 字段标签 | "评审标题" / "评审目标" / "评审模式" / "评审材料 (内容)" | 中文 | ✅ |
| 必填校验 | "请输入评审标题" / "请输入评审目标" | 中文 | ✅ |
| 输入占位符 | "例如: 订单中心微服务重构方案评审" / "在此处粘贴您的方案内容..." | 中文 | ✅ |
| 帮助文字 | "一句话概括本次评审希望解决的核心问题或达成的目标" | 中文 | ✅ |
| 模式说明 | "轮询发言 (Round Robin)" / "自由辩论 (Free Debate)" | 中英对照 | ✅ |
| 附件警告 | "当前支持文本/Markdown 粘贴，附件上传暂未接入。"（#faad14 橙色） | 中文 | ✅ |
| 成功 Toast | "评审已创建，正在进入诊断页。" | 中文 | ✅ |
| 错误兜底 | "创建评审失败。" | 中文 | ✅ |
| 按钮文案 | "提交评审" / "取消" / "返回我的评审" | 中文 | ✅ |

### 2.2 Loading 状态

- `useState(false)` 初始值（第 13 行）✅
- 提交时 `setLoading(true)`（第 17 行）✅
- `finally` 中 `setLoading(false)`（第 31 行），无论成功失败均复位 ✅
- 提交按钮 `loading={loading}`（第 94 行）✅

### 2.3 防重复提交

- Ant Design 的 `Button loading` 属性在 loading 为 true 时自动禁用按钮并展示 spinner ✅
- `handleFinish` 中 `try/catch/finally` 确保 loading 状态始终正确复位 ✅
- 无竞态窗口：API 调用为串行（createReview → push），不存在并行请求

**结论：表单 UX 完备，中文提示全覆盖，loading 和防重复提交机制健全。**

---

## 3. Draft 诊断页流程引导

### 3.1 变更对比

| 维度 | Sprint 3.7（旧） | Sprint 3.8（新） |
|------|-----------------|-----------------|
| 组件 | `<Empty>` + 按钮 | `<Steps>` 向导 + 大标题 + 按钮 |
| 文案 | "该评审尚未开始诊断" | "评审材料已提交，开始您的 AI 架构评审之旅" |
| 信息密度 | 低（仅有描述 + 按钮） | 高（4 步路线图 + 当前聚焦 + 引导语） |
| 误读风险 | 易被理解为"数据没查到" | 明确传达"流程已就绪，等待启动" |

### 3.2 Steps 向导验证

```
第 95-103 行:
Steps current={0} (高亮第一步)
├── 开始诊断: "解析文档并生成方案画像"
├── 确认评审团: "为您匹配最适合的 AI 专家"
├── 进入会议: "专家团多维度的实时探讨"
└── 查看报告: "输出结构化风险与意见"
```

- `current={0}` 正确指向第一步 ✅
- 4 个里程碑与实际业务流程一致（diagnose → confirm roles → meeting → report）✅
- 描述文案全中文 ✅
- Steps 组件正确从 antd 导入（第 3 行）✅

### 3.3 按钮与守卫

- 诊断按钮保留了 `loading={diagnosing}` + `onClick={handleDiagnose}` ✅
- loading 文案 "系统诊断中..." 中文 ✅
- `handleDiagnose` 逻辑未变：调用 `createDiagnosis` → refetch → `isReviewStateError` 守卫 ✅
- 引导语 "点击上方按钮，系统将为您生成风险摘要并推荐专家评审团。" 中文 ✅

### 3.4 契约一致性

Sprint 3.4 契约规定 draft 状态下 `GET /diagnosis` 返回 `null`，前端应显示引导。当前实现：
- `getDiagnosis` 返回 null → `setData(null)` → `!data && review?.status === 'draft'` → 渲染 Steps 向导 ✅
- 非 draft 且 `!data` → 渲染 `<Empty description="未找到该评审的诊断结果。" />` ✅（兜底态保持）

**结论：Draft 空态从"错误感"成功转型为"流程引导"，体验提升显著，与后端契约完全一致。**

---

## 4. 列表主操作按状态推演

### 4.1 按钮文案变化

```
第 120 行:
{isDraft ? '开始诊断' : isReady ? '确认评审团' : '查看诊断'}
```

| 状态 | 按钮文案 | 按钮样式 | 跳转目标 | 评估 |
|------|---------|---------|---------|------|
| draft | 开始诊断 | primary | `/reviews/{id}` (DiagnosisPage) | ✅ 引导用户启动诊断 |
| ready | 确认评审团 | primary | `/reviews/{id}` (DiagnosisPage) | ✅ 引导用户确认角色 |
| diagnosing | 查看诊断 | link | `/reviews/{id}` | ✅ 只读查看 |
| running | 查看诊断 | link | `/reviews/{id}` | ✅ 只读查看 |
| interrupted | 查看诊断 | link | `/reviews/{id}` | ✅ 只读查看 |
| summarizing | 查看诊断 | link | `/reviews/{id}` | ✅ 只读查看 |
| completed | 查看诊断 | link | `/reviews/{id}` | ✅ 只读查看 |
| failed | 查看诊断 | link | `/reviews/{id}` | ✅ 只读查看 |
| archived | 查看诊断 | link | `/reviews/{id}` | ✅ 只读查看 |

### 4.2 其余按钮规则

| 按钮 | 禁用条件 | Tooltip | 结果 |
|------|---------|---------|------|
| 进入会议室 | draft / ready / failed | "请先完成诊断并确认评审团" 等 | ✅ 未变 |
| 查看报告 | !completed | "评审尚未开始，暂无报告" 等 | ✅ 未变 |

### 4.3 评估

按钮文案动态化逻辑清晰，三元表达式简洁无嵌套。主操作（primary 样式）始终指向"用户当前最应该做的事"，次要操作退化为 link 样式。与 Sprint 3.5/3.6 的状态门控规则完全兼容。

**结论：列表主操作推演合理，用户体验提升，无状态机风险。**

---

## 5. 新风险排查

### 5.1 字段猜测

本次 Sprint 未新增任何 API 字段引用。DiagnosisPage 的 Steps 向导使用纯前端文案，不依赖后端数据。✅

### 5.2 状态机漏洞

| 检查项 | 结果 |
|--------|------|
| DiagnosisPage 状态守卫（draft→诊断, ready→确认, handleConfirm 前置检查） | ✅ 未变 |
| MeetingPage SSE 延迟连接 | ✅ 未变 |
| ReportPage 状态门控 | ✅ 未变 |
| 列表按钮禁用规则 | ✅ 未变 |

### 5.3 英文主提示

| 文件 | 扫描结果 |
|------|---------|
| `new/page.tsx` | ✅ 全中文 |
| `DiagnosisPage.tsx` Steps 向导 | ✅ 全中文 |
| `reviews/page.tsx` 按钮文案 | ✅ 全中文 |

**残留英文（均非主提示，与 Sprint 3.7 一致）**:
- `MeetingPage.tsx:42` — `data.dimension || 'General'`
- `ReportPage.tsx:123` — `{data.opinionCount} opinions`
- `ReportPage.tsx:98` — actionItems 状态列英文枚举

### 5.4 useEffect 重复请求

- `DiagnosisPage.tsx:41-43` — `[reviewId]` 依赖，与 Sprint 3.6/3.7 一致 ✅
- `reviews/page.tsx:52-54` — `[pagination.current, pagination.pageSize, statusFilter]` ✅

### 5.5 按钮竞态

- 新建评审：loading 状态 + Ant Design 自动禁用 ✅
- 诊断按钮：diagnosing 状态 + Ant Design 自动禁用 ✅
- 确认评审团：submitting 状态 + Ant Design 自动禁用 ✅

**结论：无新增风险。**

---

## P0 阻塞项

**无。**

---

## P1 建议项

**无。** 本次 Sprint 的 UX 改进精准、聚焦，未引入需要修复的问题。

---

## P2 可延后项

### P2-1: new/page.tsx 代码注释残留英文

- **文件**: `apps/web/src/app/reviews/new/page.tsx:26`
- **内容**: `// Navigate to diagnosis or reviews depending on user choice, but for now we provide options in a modal, or just route to diagnosis page`
- **问题**: 开发阶段遗留的英文注释，不影响功能但影响代码整洁度
- **建议**: 清理或改为中文注释

### P2-2 ~ P2-9: 从 Sprint 3.7 延续

| # | 描述 | 文件 |
|---|------|------|
| P2-2 | isReviewStateError 仍依赖 message 子串匹配 | `DiagnosisPage.tsx:10-13` |
| P2-3 | ReportPage "opinions" 英文 | `ReportPage.tsx:123` |
| P2-4 | ReportPage Action Items 状态列未映射中文 | `ReportPage.tsx:98` |
| P2-5 | ContextPanel 硬编码占位文本 | `MeetingPage.tsx:160` |
| P2-6 | 后端 REVIEW_STATUS_FLOW 仅作文档用途 | `reviews.service.ts:12-22` |
| P2-7 | 后端 MOCK_ROLES 死代码 | `reviews.service.ts:25-31` |
| P2-8 | 后端英文错误消息 | `reviews.service.ts` 多处 |
| P2-9 | useEffect 依赖 lint 警告 | `DiagnosisPage.tsx:41-43` 等 |

---

## 涉及文件清单

| 文件路径 | Sprint 3.8 变更 | 审查结论 |
|----------|-----------------|----------|
| `apps/web/src/app/reviews/new/page.tsx` | 附件警告提示 + success toast 文案 | ✅ 通过，P2-1 注释残留 |
| `apps/web/src/features/diagnosis/DiagnosisPage.tsx` | Draft 空态：Empty → Steps 向导 | ✅ 通过 |
| `apps/web/src/app/reviews/page.tsx` | 列表首按钮文案按状态动态化 | ✅ 通过 |

---

## 是否建议进入下一 Sprint

**建议进入。** Sprint 3.8 的 UX Polish 在三个关键触点（创建 → 初始引导 → 列表导航）上显著提升了产品体验：

1. 新建表单的附件限制警告和行文感 success toast 消除了用户困惑
2. Draft 诊断页从"看起来像报错"转变为清晰的 4 步路线图向导，降低了业务黑盒感
3. 列表主操作按钮从静态文案进化为状态感知引导，让用户注意力聚焦于"当前能做什么"

变更范围精准（3 文件、纯 UX 层），未引入任何技术回归。
