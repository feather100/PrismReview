# Sprint 5.3 — Frontend Provider Summary Display

## 1. 概览

本次 Sprint 在未进行后端改动与未接写新 API 的前提下，顺利在前端报告页 (ReportPage) 成功展示了由后端透传而来的 `providerSummary`（大模型调用来源摘要）字段。

## 2. 界面与契约更新明细

### 2.1 `client.ts` 契约增强
根据 Sprint 5.2 的后端约定，我们在 `ReportResponse` 类型中注入了可选的 `providerSummary` 字段，包含了以下全量统计维度：
- `totalTurns` (总发言数)
- `bySource` (Mock / LMStudio / OpenAI_Compatible / Fallback_Mock / Failed 细分统计)
- `fallbackCount` & `failedCount` (告警阈值)
- `models` (调用的模型列表)
- `hasRealProvider` (真实模型判断位)

### 2.2 `ReportPage.tsx` 视图注入
在报告页标题区域下方，以次级浅灰背景模块 (`#f5f5f5`) 的形式植入了这套统计大盘。
- **动态性与防御性渲染**：模块包裹在 `{data.providerSummary && ...}` 之下。如果是旧版数据或无该字段抛出，则静默折叠，保证了向下兼容性。
- **信息铺展**：
  - 核心数值：展示了总发言数与模型数组。
  - 数据分布透视：直观拼装展示各种 provider 的命中次数。
  - 风险感知 Tags：
    - 若 `hasRealProvider` 命中，点亮蓝色“真实模型参与”标签。
    - 若发生 `fallbackCount > 0`，激活醒目的橙色“已发生 Fallback”标签。
    - 针对最危急的 `failedCount > 0`，强制亮起红色“存在失败 Turn”标签以提醒人工介入。

## 3. 验证情况

- `apps/web tsc` 检查：**0 errors** ✅
- 组件解耦：纯纯粹粹的视图层补齐，未改动任何业务状态机、按钮链路。完全遵循前后端协作契约，没有猜解后端状态。

## 4. Frontend Gate
**Go ✅** - 透视化的大模型供给链统计面板已经上线。
