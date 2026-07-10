# Sprint 3.10 Review Detail Timeline UI — 独立复审报告

> 审查方：QoderWork（独立于 antigravity）  
> 审查日期：2026-07-09  
> 审查模式：只读审查，未修改任何代码  

---

## Gate 结论：Go（无 P0 阻塞项）

Sprint 3.10 在 DiagnosisPage 中新增了评审进度时间线模块，严格基于 `GET /reviews/{id}` + `GET /reviews/{id}/diagnosis` 两个现有接口推导，未触碰 report 接口、未新增 API 字段、未改变按钮状态机。时间线推导逻辑覆盖全部 5 种主状态 + failed 分支，中文文案完整，无英文主提示泄漏。tsc 由提交方确认 0 errors。建议进入下一 Sprint。

---

## 1. 数据源验证：是否只使用 GET review + GET diagnosis

### 1.1 API 调用审计

`DiagnosisPage.tsx:25-39` 的 `fetchDiagnosisData` 函数：

```
第 29 行: apiClient.getReview(reviewId)   → GET /reviews/{id}
第 32 行: apiClient.getDiagnosis(reviewId) → GET /reviews/{id}/diagnosis
```

仅 2 次 API 调用。无 `getReport`、无 `saveRoleSelection`、无 `startReview`、无新增接口。

### 1.2 时间线推导输入

`DiagnosisPage.tsx:86-107` 的推导逻辑仅依赖两个变量：

| 变量 | 来源 | 用途 |
|------|------|------|
| `review?.status` | `getReview` 返回的 status 字段 | 判断当前处于哪个阶段 |
| `data`（是否非 null） | `getDiagnosis` 返回的诊断结果 | 辅助 failed 状态的步骤定位 |

**结论：时间线模块完全基于 Sprint 3.9 方案 A（前端组合现有接口）实现，零后端变更。**

---

## 2. 是否没有调用 report 接口判断时间线

- `fetchDiagnosisData` 中无 `apiClient.getReport` 调用 ✅
- 时间线推导逻辑中无 report 相关判断 ✅
- `completed` 状态通过 `review?.status === 'completed'` 判断，不依赖 report API 确认 ✅

**结论：时间线完全不依赖 report 接口。**

---

## 3. 是否没有新增 API 字段猜测

| 使用的字段 | 类型定义 | 后端返回 | 匹配 |
|-----------|---------|---------|------|
| `review.status` | `ReviewResponse.status: string` | ✅ DB status 字段 | ✅ |
| `data` (null/非 null) | `DiagnosisResponse \| null` | ✅ 200 null 或完整对象 | ✅ |

未使用 `review.roleSelection`、`review.diagnosis`、`review.report` 等 DTO 中不存在的字段。

**结论：无新增字段猜测。**

---

## 4. 状态推导正确性验证

### 4.1 推导矩阵

```
第 86-107 行:
```

| status | currentStep | stepsStatus | nextActionText | 评估 |
|--------|-------------|-------------|----------------|------|
| `draft` | 1 | process | "下一步：开始诊断" | ✅ 步骤 0（创建评审）已完成，聚焦步骤 1 |
| `ready` | 2 | process | "下一步：确认评审团" | ✅ 步骤 0-1（创建+诊断）已完成，聚焦步骤 2 |
| `running` | 3 | process | "下一步：等待会议完成" | ✅ 步骤 0-2（创建+诊断+组局）已完成，聚焦步骤 3 |
| `interrupted` | 3 | process | "下一步：等待会议完成" | ✅ 与 running 一致 |
| `summarizing` | 3 | process | "下一步：等待会议完成" | ✅ 与 running 一致 |
| `completed` | 4 | finish | "下一步：查看评审报告" | ✅ 全部 5 步完成，`finish` 状态使 Steps 组件显示全绿 |
| `failed` | 条件 | error | "评审失败，请查看错误信息" | ✅ 见下方详细分析 |

### 4.2 failed 状态分支

```
第 103-106 行:
if (review?.status === 'failed') {
  stepsStatus = 'error';
  currentStep = data ? 3 : 1;
}
```

| 子场景 | data | currentStep | 语义 | 评估 |
|--------|------|-------------|------|------|
| 诊断前失败 | null | 1 | 在"开始诊断"步骤失败 | ✅ 合理（如 diagnose 调用失败） |
| 诊断后失败 | 非 null | 3 | 在"进入评审会议"步骤失败 | ✅ 合理（如 meeting/summarize 失败） |

`error` status 使 Steps 组件在当前步骤显示红色错误标记，之前步骤为完成态，之后步骤为等待态。视觉上清晰传达失败位置。

### 4.3 未覆盖状态：diagnosing / archived

| status | 行为 | 评估 |
|--------|------|------|
| `diagnosing` | 未显式处理，走默认值 `currentStep=0, stepsStatus='process'` | P2 — 过渡态极短暂（mock 同步完成），但建议显式映射到步骤 1 + process |
| `archived` | 未显式处理，走默认值 `currentStep=0, stepsStatus='process'` | P2 — 归档评审应显示已完成或归档态 |

**结论：5 种主状态 + failed 的推导逻辑正确，与 Sprint 3.9 方案 A 的伪代码一致。diagnosing/archived 两个边缘状态可后续优化。**

---

## 5. 是否没有改变现有按钮状态机

### 5.1 按钮渲染条件逐项对比

| 按钮 | Sprint 3.8 条件 | Sprint 3.10 条件 | 变化 |
|------|----------------|------------------|------|
| 开始诊断 | `review?.status === 'draft'` (第 176 行) | `review?.status === 'draft'` (第 176 行) | ✅ 无变化 |
| 确认评审团 | `review?.status === 'ready'` (第 185 行) | `review?.status === 'ready'` (第 185 行) | ✅ 无变化 |
| 进入会议室 | `running \|\| interrupted \|\| summarizing` (第 195 行) | 同 (第 195 行) | ✅ 无变化 |
| 查看评审报告 | `review?.status === 'completed'` (第 203 行) | 同 (第 203 行) | ✅ 无变化 |
| 评审失败 | `review?.status === 'failed'` (第 211 行) | 同 (第 211 行) | ✅ 无变化 |

### 5.2 逻辑守卫

| 守卫 | 位置 | 评估 |
|------|------|------|
| `handleConfirm` 前置检查 `review?.status !== 'ready'` | 第 131 行 | ✅ 未变 |
| `isReviewStateError` 错误分类 | 第 10-13 行 | ✅ 未变 |
| `isConfirmEnabled` 检查 `data && recommendedRoles.length > 0` | 第 166 行 | ✅ 未变 |

**结论：按钮状态机零变动。**

---

## 6. 是否没有引入新的推进状态按钮

时间线模块（第 109-128 行 `timelineModule`）为纯展示组件：

- 使用 `<Card>` 包裹 + `<Steps>` 渲染 ✅
- 无 `onClick` 处理器 ✅
- 无 `router.push` 导航 ✅
- 无 `apiClient` 调用 ✅
- 下一步动作文本（`nextActionText`）为纯 `<Typography.Text>` 展示 ✅

原有的操作按钮（开始诊断、确认评审团、进入会议室、查看评审报告）保持不变，未被时间线模块替代或新增。

**结论：时间线模块为只读信息展示，不引入任何新的状态推进能力。**

---

## 7. tsc 状态

提交方确认 `apps/web tsc --noEmit`: **0 errors**。当前环境无法跨平台执行 tsc，以提交方结果为准。

---

## 8. 英文主提示扫描

| 位置 | 内容 | 评估 |
|------|------|------|
| 第 112 行 | "评审进度" | ✅ 中文 |
| 第 120-124 行 | "创建评审" / "开始诊断" / "确认评审团" / "进入评审会议" / "生成评审报告" | ✅ 全中文 |
| 第 92 行 | "下一步：开始诊断" | ✅ 中文 |
| 第 95 行 | "下一步：确认评审团" | ✅ 中文 |
| 第 98 行 | "下一步：等待会议完成" | ✅ 中文 |
| 第 102 行 | "下一步：查看评审报告" | ✅ 中文 |
| 第 106 行 | "评审失败，请查看错误信息" | ✅ 中文 |

**结论：时间线模块无英文主提示泄漏。**

---

## P0 阻塞项

**无。**

---

## P1 建议项

**无。** 时间线模块实现干净、聚焦，未引入需要修复的问题。

---

## P2 可延后项

### P2-1: diagnosing 状态未显式映射

- **文件**: `DiagnosisPage.tsx:86-107`
- **现状**: `diagnosing` 不在任何 if 分支中，走默认值 `currentStep=0`
- **影响**: 时间线会显示"创建评审"为当前进行中步骤，实际应为"开始诊断"
- **风险**: 极低（mock 后端同步完成 diagnose，diagnosing 态在 UI 上几乎不可见）
- **建议**: 添加 `diagnosing` 到 `draft` 分支或单独映射到 `currentStep=1`

### P2-2: archived 状态未显式映射

- **文件**: `DiagnosisPage.tsx:86-107`
- **现状**: `archived` 不在任何 if 分支中，走默认值 `currentStep=0`
- **影响**: 已归档评审的时间线显示不准确
- **建议**: 添加 archived 分支，可映射为 `stepsStatus='finish'` + 特殊标注

### P2-3: Card bodyStyle 属性在 Ant Design v5 中已废弃

- **文件**: `DiagnosisPage.tsx:110`
- **现状**: `<Card style={{ marginBottom: 24 }} bodyStyle={{ padding: '16px 24px' }}>`
- **说明**: Ant Design v5 推荐使用 `styles={{ body: { ... } }}` 替代 `bodyStyle`。当前代码功能正常但会产生控制台 deprecation warning。
- **建议**: 后续版本迁移时统一替换

### P2-4 ~ P2-11: 从 Sprint 3.8 延续

| # | 描述 | 文件 |
|---|------|------|
| P2-4 | new/page.tsx 英文注释残留 | `reviews/new/page.tsx:26` |
| P2-5 | isReviewStateError 仍依赖 message 子串匹配 | `DiagnosisPage.tsx:10-13` |
| P2-6 | ReportPage "opinions" 英文 | `ReportPage.tsx:123` |
| P2-7 | ReportPage Action Items 状态列未映射中文 | `ReportPage.tsx:98` |
| P2-8 | ContextPanel 硬编码占位文本 | `MeetingPage.tsx:160` |
| P2-9 | 后端 REVIEW_STATUS_FLOW 仅作文档用途 | `reviews.service.ts:12-22` |
| P2-10 | 后端 MOCK_ROLES 死代码 | `reviews.service.ts:25-31` |
| P2-11 | useEffect 依赖 lint 警告 | `DiagnosisPage.tsx:41-43` |

---

## 涉及文件清单

| 文件路径 | Sprint 3.10 变更 | 审查结论 |
|----------|-----------------|----------|
| `apps/web/src/features/diagnosis/DiagnosisPage.tsx` | 新增 timelineModule + 推导逻辑 + draft 空态精简 | ✅ 通过 |
| `apps/web/src/lib/api-client/client.ts` | 未变更 | ✅ |
| `apps/web/src/app/reviews/page.tsx` | 未变更 | ✅ |
| `apps/web/src/app/reviews/new/page.tsx` | 未变更 | ✅ |
| `apps/web/src/features/meeting/MeetingPage.tsx` | 未变更 | ✅ |
| `apps/web/src/features/report/ReportPage.tsx` | 未变更 | ✅ |

---

## 是否建议进入下一 Sprint

**建议进入。** Sprint 3.10 的时间线模块精准落地了 Sprint 3.9 方案 A 的设计：

1. 仅使用 `getReview` + `getDiagnosis` 两个接口推导，零后端变更 ✅
2. 不调用 report 接口，不新增 API 字段猜测 ✅
3. 5 种主状态 + failed 分支推导逻辑正确，与状态机一致 ✅
4. 现有按钮状态机零变动，无新增推进状态按钮 ✅
5. 时间线模块为纯展示组件，中文文案完整，无英文泄漏 ✅

变更仅涉及 1 个文件（DiagnosisPage.tsx），影响面可控。
