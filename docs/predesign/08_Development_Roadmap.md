# 08. Development Roadmap

## 1. 团队协作假设

- reasonix：负责工程实现、架构落地、接口、AI 编排、测试代码。
- antigravity：负责 UI 信息架构、视觉、交互原型、组件规范。
- 产品负责人：确认范围、验收标准、开放问题。
- QA：测试计划、验收用例、质量门禁。

## 2. 里程碑总览

| 里程碑 | 周期 | 目标 |
|---|---:|---|
| M0 前置设计确认 | 1 周 | 完成本设计包评审，确认 MVP 范围 |
| M1 工程骨架 | 1-2 周 | monorepo、基础服务、DB、Auth、RBAC |
| M2 管理基础 | 2-3 周 | 角色管理、知识库上传、检索 mock |
| M3 评审闭环 Alpha | 3-4 周 | 发起评审、诊断 mock、组局、会议流 mock、报告 mock |
| M4 AI/RAG 接入 Beta | 4-5 周 | 真实 RAG、真实 Agent、Round-Robin、信心指数 |
| M5 自由辩论与白盒报告 | 3-4 周 | Free Debate、人机干预、报告结构化、证据链 |
| M6 管理与验收 | 2-3 周 | 审计、权限补齐、测试、性能、安全检查 |

MVP 总周期建议：12-16 周。

## 3. Sprint 拆解

### Sprint 0：设计冻结与技术 Spike

- 确认 MVP 功能边界。
- 选择技术栈和模型供应商。
- 验证文档解析、embedding、向量检索链路。
- antigravity 输出核心流程线框。

### Sprint 1：工程基础

- 初始化 monorepo。
- DB migration 基础表。
- Auth/Tenant/RBAC 骨架。
- API 错误码和日志规范。
- 前端 AppShell、路由、权限守卫。

### Sprint 2：角色中心

- 预置 5 角色 seed。
- 角色列表、详情、创建、版本管理 API。
- 角色管理 UI。
- Prompt 模板版本化。
- 单元测试。

### Sprint 3：知识库中心

- 文档上传。
- 文本解析 pipeline。
- Chunk 存储。
- 向量索引。
- 检索测试 API/UI。
- Chunk 审核状态。

### Sprint 4：发起评审与诊断书

- Review draft 创建。
- 文档/文本输入。
- Chairman 诊断 API。
- 推荐角色与权重调整。
- 方案诊断书 UI。

### Sprint 5：会议引擎 Round-Robin

- Review 状态机。
- Agent turn queue。
- RAG context 注入。
- 结构化输出校验。
- 实时流式输出。
- 会议室 UI 基础版。

### Sprint 6：报告与 Action Items

- Chairman 汇总报告。
- 六章结构渲染。
- 风险矩阵。
- Action Items 生成与状态。
- 意见反馈按钮。

### Sprint 7：自由辩论与人机干预

- Free Debate 调度。
- 新观点检测规则。
- 举手打断与条件注入。
- 受影响 Agent 补充意见。
- 报告记录干预历史。

### Sprint 8：管理、审计、硬化

- 权限矩阵补齐。
- 审计日志。
- 多租户隔离测试。
- 性能与超时策略。
- E2E 用例。
- 部署文档。

## 4. reasonix 任务输入格式建议

给 reasonix 的每个任务尽量包含：

- 背景目标。
- 涉及文件/模块。
- API/数据模型引用。
- 验收标准。
- 测试要求。
- 不做事项。

示例：

```text
实现 AgentRole 与 AgentRoleVersion CRUD。
依据：05_Data_Model_API_Event_Spec.md 与 04_Repository_Structure.md。
验收：支持预置角色 seed、自定义角色创建、保存为新版本、激活版本、禁用角色；系统提示词少于 200 字时返回 VALIDATION_ERROR。
测试：unit + integration。
不做：角色市场、跨部门发布。
```

## 5. antigravity 与 reasonix 对接节奏

| 时间 | antigravity 输出 | reasonix 消费 |
|---|---|---|
| Sprint 0 | IA + 低保真 | 路由和页面骨架 |
| Sprint 1 | 设计系统 draft | UI 基础组件 |
| Sprint 2 | 角色/知识库高保真 | 管理页实现 |
| Sprint 4 | 诊断书高保真 | 发起评审实现 |
| Sprint 5 | 会议室高保真 | 实时流 UI |
| Sprint 6 | 报告页高保真 | 报告渲染 |

## 6. 质量门禁

每个 Sprint 结束必须满足：

- 新 API 有 OpenAPI 或接口文档。
- 新表有 migration 和 seed/fixture。
- 核心逻辑有单元测试。
- 关键流程有至少一个集成或 E2E 用例。
- 权限边界经过测试。
- AI 输出 schema 有校验。

## 7. 发布策略

- Alpha：内部 demo，允许 mock 模型输出。
- Beta：接入真实模型和 RAG，限定测试租户。
- RC：权限、安全、审计、性能达到 MVP 验收。
- GA：完成部署文档、运维 runbook、回滚方案。
