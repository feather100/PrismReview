# Sprint 3.12 Timeline P2 Cleanup — 独立复审报告

> 审查方：QoderWork（独立于 antigravity）  
> 审查日期：2026-07-09  
> 审查模式：只读审查，未修改任何代码

---

## Gate 结论：Go（无 P0 / P1 阻塞项）

Sprint 3.12 针对 Sprint 3.10 遗留的 3 项 P2（diagnosing 状态未显式映射、archived 状态未显式映射、Card bodyStyle 已废弃）逐一完成修复。修复范围严格收敛于 DiagnosisPage.tsx 一个文件，未触碰 API 层、未改动按钮状态机、未新增任何后端调用。时间线推导逻辑现已覆盖全部 9 种状态（draft / diagnosing / ready / running / interrupted / summarizing / completed / failed / archived），无遗漏分支。建议进入下一 Sprint。

---

## 1. 复审重点逐项验证

### 1.1 diagnosing 状态显式映射

**文件**: `DiagnosisPage.tsx:93-95`

```typescript
} else if (review?.status === 'diagnosing') {
  currentStep = 1;
  nextActionText = '诊断中，请稍候';
}
```

| 验证项 | 结果 |
|--------|------|
| 是否显式处理 `diagnosing` | ✅ 有独立 if 分支 |
| currentStep 是否正确 | ✅ 值为 1，与"开始诊断"步骤对齐 |
| nextActionText 是否中文 | ✅ "诊断中，请稍候" |
| stepsStatus 是否正确 | ✅ 保持默认值 `'process'`，表示步骤进行中 |

**Sprint 3.10 P2-1 关闭。**

---

### 1.2 archived 状态显式映射

**文件**: `DiagnosisPage.tsx:106-109`

```typescript
} else if (review?.status === 'archived') {
  currentStep = 4;
  stepsStatus = 'finish';
  nextActionText = '该评审已归档，仅可查看历史记录';
}
```

| 验证项 | 结果 |
|--------|------|
| 是否显式处理 `archived` | ✅ 有独立 if 分支 |
| currentStep 是否正确 | ✅ 值为 4，与 completed 一致（全部步骤完成） |
| stepsStatus 是否正确 | ✅ 设为 `'finish'`，Steps 组件全绿 |
| nextActionText 是否中文 | ✅ "该评审已归档，仅可查看历史记录" |
| 是否暗示任何操作能力 | ✅ 文案明确告知"仅可查看"，无误导 |

**Sprint 3.10 P2-2 关闭。**

---

### 1.3 Ant Design v5 bodyStyle 替换

**文件**: `DiagnosisPage.tsx:117`

```typescript
<Card style={{ marginBottom: 24 }} styles={{ body: { padding: '16px 24px' } }}>
```

| 验证项 | 结果 |
|--------|------|
| 是否移除 `bodyStyle` | ✅ 已替换为 `styles={{ body: {...} }}` |
| 功能是否等价 | ✅ padding 值一致 `'16px 24px'` |
| 是否引入控制台 warning | ✅ 使用 v5 推荐 API，无 deprecation warning |

**Sprint 3.10 P2-3 关闭。**

---

### 1.4 按钮状态机验证

逐按钮比对 Sprint 3.10（基准）与 Sprint 3.12（当前）：

| 按钮 | 渲染条件 | Sprint 3.10 行号 | Sprint 3.12 行号 | 变化 |
|------|----------|------------------|------------------|------|
| 开始诊断 | `review?.status === 'draft'` | 183 | 183 | ✅ 无变化 |
| 确认评审团 | `review?.status === 'ready'` | 192 | 192 | ✅ 无变化 |
| 进入会议室 | `running \|\| interrupted \|\| summarizing` | 202 | 202 | ✅ 无变化 |
| 查看评审报告 | `review?.status === 'completed'` | 210 | 210 | ✅ 无变化 |
| 评审失败 | `review?.status === 'failed'` | 218 | 218 | ✅ 无变化 |

逻辑守卫：

| 守卫 | 位置 | 评估 |
|------|------|------|
| `handleConfirm` 前置检查 `review?.status !== 'ready'` | 第 138 行 | ✅ 未变 |
| `isReviewStateError` 正则 | 第 10-13 行 | ✅ 未变 |
| `isConfirmEnabled` 检查 `data && recommendedRoles.length > 0` | 第 173 行 | ✅ 未变 |

**结论：按钮状态机零变动，Sprint 3.12 严格遵守红线要求。**

---

### 1.5 API 调用审计

`fetchDiagnosisData`（第 25-39 行）调用清单：

```
第 29 行: apiClient.getReview(reviewId)   → GET /reviews/{id}
第 32 行: apiClient.getDiagnosis(reviewId) → GET /reviews/{id}/diagnosis
```

仅 2 次 API 调用，与 Sprint 3.10 完全一致。无 `getReport`、无 `saveRoleSelection`、无 `startReview`、无新增接口。

**结论：未新增任何 API 调用。**

---

### 1.6 时间线是否依赖 report 接口

- `fetchDiagnosisData` 中无 `apiClient.getReport` 调用 ✅
- 时间线推导逻辑中无 report 相关判断 ✅
- `completed` 状态通过 `review?.status === 'completed'` 判断，不依赖 report API ✅

**结论：时间线完全不依赖 report 接口。**

---

## 2. 全状态覆盖验证（9 态矩阵）

Sprint 3.12 修复后，时间线推导逻辑覆盖所有 9 种合法状态：

| # | status | currentStep | stepsStatus | nextActionText | 评估 |
|---|--------|-------------|-------------|----------------|------|
| 1 | `draft` | 1 | process | "下一步：开始诊断" | ✅ |
| 2 | `diagnosing` | 1 | process | "诊断中，请稍候" | ✅ **本次新增** |
| 3 | `ready` | 2 | process | "下一步：确认评审团" | ✅ |
| 4 | `running` | 3 | process | "下一步：等待会议完成" | ✅ |
| 5 | `interrupted` | 3 | process | "下一步：等待会议完成" | ✅ |
| 6 | `summarizing` | 3 | process | "下一步：等待会议完成" | ✅ |
| 7 | `completed` | 4 | finish | "下一步：查看评审报告" | ✅ |
| 8 | `archived` | 4 | finish | "该评审已归档，仅可查看历史记录" | ✅ **本次新增** |
| 9 | `failed` | data?3:1 | error | "评审失败，请查看错误信息" | ✅ |

9 种状态均有显式分支，无默认值遗漏风险。

---

## 3. 是否引入新的推进状态按钮

时间线模块（第 116-135 行 `timelineModule`）为纯展示组件：

- 使用 `<Card>` + `<Steps>` 渲染 ✅
- 无 `onClick` 处理器 ✅
- 无 `router.push` 导航 ✅
- 无 `apiClient` 调用 ✅
- `nextActionText` 为纯 `<Typography.Text>` 展示 ✅

**结论：时间线模块为只读信息展示，不引入任何新的状态推进能力。**

---

## 4. tsc 状态

提交方确认 `apps/web tsc --noEmit`: **0 errors**。当前环境无法跨平台执行 tsc，以提交方结果为准。

---

## 5. 英文主提示扫描

| 位置 | 内容 | 评估 |
|------|------|------|
| 第 95 行 | "诊断中，请稍候" | ✅ 中文 |
| 第 109 行 | "该评审已归档，仅可查看历史记录" | ✅ 中文 |
| 第 119 行 | "评审进度" | ✅ 中文 |
| 第 127-131 行 | "创建评审" / "开始诊断" / "确认评审团" / "进入评审会议" / "生成评审报告" | ✅ 全中文 |

**结论：本次新增内容无英文主提示泄漏。**

---

## 6. 变更范围确认

| 文件路径 | Sprint 3.12 变更 | 审查结论 |
|----------|-----------------|----------|
| `apps/web/src/features/diagnosis/DiagnosisPage.tsx` | 新增 diagnosing/archived 分支 + bodyStyle→styles 替换 | ✅ 通过 |
| `apps/web/src/lib/api-client/client.ts` | 未变更 | ✅ |
| `apps/web/src/app/reviews/page.tsx` | 未变更 | ✅ |
| `apps/web/src/app/reviews/new/page.tsx` | 未变更 | ✅ |
| `apps/web/src/features/meeting/MeetingPage.tsx` | 未变更 | ✅ |
| `apps/web/src/features/report/ReportPage.tsx` | 未变更 | ✅ |

变更仅涉及 1 个文件（DiagnosisPage.tsx），影响面最小化。

---

## P0 阻塞项

**无。**

---

## P1 建议项

**无。** Sprint 3.12 的三项修复均精准落地，未引入需要修复的新问题。

---

## P2 可延后项

### 从 Sprint 3.10 继承（P2-4 ~ P2-11）

以下 P2 项在 Sprint 3.12 范围外，状态不变，继续留档：

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

## Sprint 3.10 P2 关闭记录

| P2 编号 | 描述 | Sprint 3.12 处理 | 状态 |
|---------|------|-----------------|------|
| P2-1 | diagnosing 状态未显式映射 | 新增独立分支，currentStep=1 | ✅ 关闭 |
| P2-2 | archived 状态未显式映射 | 新增独立分支，currentStep=4, finish | ✅ 关闭 |
| P2-3 | Card bodyStyle deprecated | 替换为 styles={{ body: {...} }} | ✅ 关闭 |

Sprint 3.10 提出的 3 项 P2 全部关闭。

---

## 是否建议进入下一 Sprint

**建议进入。** Sprint 3.12 精准完成了 ACTIVE_SPRINT.md 定义的 P2 清理目标：

1. diagnosing 状态显式映射到步骤 1 + "诊断中，请稍候" ✅
2. archived 状态显式映射到步骤 4 + finish + "仅可查看" ✅
3. Ant Design v5 bodyStyle → styles 替换 ✅
4. 按钮状态机零变动 ✅
5. API 调用零新增 ✅
6. 全 9 种状态显式覆盖，无遗漏分支 ✅

变更仅涉及 DiagnosisPage.tsx 一个文件，影响面最小化。

建议下一步可进入：
- **Sprint 3.13 — 遗留 P2 跟进**（英文文案 / 注释残留等）
- 或 **Sprint 4.0 — Runner / Queue Scope Proposal**
