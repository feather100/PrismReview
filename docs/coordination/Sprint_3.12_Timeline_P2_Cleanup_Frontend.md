# Sprint 3.12 — Review Timeline P2 Cleanup (Frontend)

## 1. 概览

本次 Sprint 基于 Code Review 发现的体验边界，对详情页 Timeline 进行了轻量的补充和底层 API 替换，主要补齐了处于异步诊断过程中的 `diagnosing` 和最终生命周期的 `archived` 这两个次要但容易带来疑虑的状态。

## 2. 清理细节

### 2.1 状态机映射补齐
针对 `DiagnosisPage.tsx` 中的 Timeline 组件：
- **`diagnosing`**：当发起诊断但还未完成前，Timeline 的焦点正确驻留在第 1 步 (开始诊断)，副文本由原先降级触发的其他状态变更为更精准的：`诊断中，请稍候`。
- **`archived`**：作为系统数据归档操作的终态，该状态在 UI 层面上与 `completed` 对齐，五大节点悉数 `finish`。但为了防止用户在只读的归档数据上寻求操作，将 Action 指引修改为了明确的：`该评审已归档，仅可查看历史记录`。

*注：未对核心按钮的状态机权限和路由策略进行任何变更，保证核心流程完全隔离。*

### 2.2 Ant Design v5 Deprecation 修复
去除了 `DiagnosisPage.tsx` 里已被 Ant Design v5 标记为过时 (deprecated) 的 `bodyStyle` API 用法：
- 原写法：`<Card bodyStyle={{ padding: '16px 24px' }}>`
- 新写法：`<Card styles={{ body: { padding: '16px 24px' } }}>`
以彻底消除控制台的 Warning。

## 3. 验证情况

- `apps/web tsc` 检查：**0 errors** ✅
- **映射验证**：
  - 代码分支完全覆盖了 `diagnosing` 与 `archived` 的独立场景，未改变 `draft`/`ready`/`running`/`completed` 的原有链路。
- 未添加任何后端调用或模型推断。

## 4. Frontend Gate
**Go ✅** - Timeline 模块对于 PrismReview 所有边缘业务状态的包容能力达到闭环。
