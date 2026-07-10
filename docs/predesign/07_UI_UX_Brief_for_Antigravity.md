# 07. UI/UX Brief for antigravity

## 1. 设计目标

antigravity 需要把 PrismReview 设计成“企业级、可信、透明、有智能感但不炫技”的评审工作台。

关键词：

- 专业、冷静、清晰。
- 多角色协作感。
- AI 输出可追溯。
- 风险优先级一眼可辨。
- 长流程不压迫，状态始终明确。

## 2. 视觉方向

### 2.1 品牌隐喻

Prism = 棱镜。方案输入像一道白光，系统将其拆解成技术、商业、交付、合规、用户体验等多个光谱维度。

建议视觉元素：

- 低饱和深蓝/靛紫作为主色。
- 风险等级使用明确但不过度刺眼的红/橙/黄/蓝。
- 轻量光谱渐变用于诊断书和角色卡片。
- 卡片式信息分层，避免聊天应用既视感过强。

### 2.2 基础色板建议

| 用途 | 颜色建议 |
|---|---|
| Primary | Indigo / Blue |
| AI Accent | Violet / Cyan gradient |
| High Risk | Red |
| Medium Risk | Orange |
| Low Risk | Yellow / Amber |
| Info | Slate / Blue |
| Success | Green |
| Background | Cool gray / near white |

## 3. 关键页面设计任务

### 3.1 工作台

设计重点：让用户知道“现在我该做什么”。

组件：

- 快捷发起评审按钮。
- 本月评审概览。
- 最近评审列表。
- 我的 Action Items。
- 待人工确认低信心意见。

### 3.2 发起评审

设计重点：降低提交门槛。

需要状态：

- 空白上传。
- 拖拽 hover。
- 上传中。
- 解析成功。
- 解析失败但可继续。
- 文本粘贴模式。

### 3.3 方案诊断书

这是产品第一关键“哇点”。

必须呈现：

- 方案摘要。
- 领域标签。
- 风险维度雷达图或条形分布。
- 推荐角色列表。
- 每个角色的邀请理由。
- 权重调节。
- 相似历史评审入口。

交互要求：

- 角色卡片可增删。
- 权重可用 slider 或 stepper。
- 快速模式入口明显但不喧宾夺主。

### 3.4 评审会议室

这是产品核心操作界面。

布局建议：三栏结构。

```text
左：Agent 委员席位
中：实时发言流
右：上下文 / 引用 / 干预 / 风险摘要
```

必须状态：

- Agent queued。
- retrieving。
- speaking。
- completed。
- timeout。
- failed。
- skipped。

发言卡片必须展示：

- 角色头像/代号。
- 审查维度。
- 风险等级。
- 信心指数。
- 引用数量。
- 建议。
- 展开查看证据。

### 3.5 报告页

设计重点：从“AI 说了很多”整理成“我该如何决策”。

模块：

- 顶部结论：整体评级、主要风险、建议动作。
- 风险矩阵：高/中/低 + 影响/概率。
- 分维度详评。
- Action Items 表格。
- 低信心意见。
- 证据链。
- 导出/分享/反馈。

### 3.6 角色管理

需要体现配置复杂但不吓人。

页面：

- 角色列表：预置/自定义分组。
- 角色详情：基本信息、Prompt、维度、知识库、版本。
- 新建角色向导。
- 版本历史抽屉。

### 3.7 知识库管理

页面：

- 左侧目录树。
- 右侧文档表格。
- 上传面板。
- 处理进度。
- Chunk 审核详情。
- 检索测试弹窗。

## 4. 组件清单

- AppShell / Sidebar / Topbar。
- ReviewStatusBadge。
- RiskLevelBadge。
- ConfidenceBadge。
- AgentRoleCard。
- AgentSeat。
- DiagnosisPanel。
- RiskRadar / RiskMatrix。
- EvidenceCitationPopover。
- StreamingMessageCard。
- HumanInterventionModal。
- ActionItemTable。
- KnowledgeUploadDropzone。
- ChunkReviewCard。
- PermissionDeniedState。
- EmptyState。

## 5. 响应式要求

MVP Web 优先。

移动端至少支持：

- 查看报告。
- 查看 Action Items。
- 查看评审历史摘要。

不要求移动端完整配置角色和知识库。

## 6. 可用性细节

- 所有 AI 执行超过 3 秒必须显示进度状态。
- 所有“不可逆/高影响”操作必须二次确认。
- 对低信心意见避免用“错误”表达，使用“待人工确认”。
- 用户应随时知道当前评审是否还在运行、是否卡住、是否可离开页面。
- 引用证据必须能一键展开，显示来源文件、页码/段落、相关片段。

## 7. antigravity 输出物建议

1. 信息架构图。
2. P0 页面低保真线框。
3. 核心流程高保真：发起评审 → 诊断书 → 会议室 → 报告。
4. 设计系统：颜色、字体、间距、卡片、状态、图标。
5. 关键组件库。
6. 交互原型。
7. 异常态与空状态稿。

## 8. 需要产品确认的问题

- 是否采用深色模式作为会议室默认？建议不是默认，但可提供夜间模式。
- Agent 头像是抽象图标、人设插画，还是企业风 icon？建议企业风抽象头像。
- 报告页整体评级是否用分数、等级，还是“建议通过/有条件通过/不建议通过”？建议 MVP 用等级 + 建议动作。
