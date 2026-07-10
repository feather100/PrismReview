# PrismReview 前置设计交付包

版本：v0.1  
日期：2026-07-06  
依据：`PRD_PrismReview_v1.0.md`  
目标：在正式开发前，为 reasonix 开发实现与 antigravity UI 设计提供统一产品、技术、协作、测试基线。

## 交付文件

| 文件 | 用途 | 主要使用方 |
|---|---|---|
| `01_Product_Design_Blueprint.md` | 产品定位、MVP 范围、模块边界、关键决策 | 产品 / reasonix / antigravity |
| `02_Information_Architecture_User_Flows.md` | 信息架构、导航、核心用户旅程、页面清单 | antigravity / 前端 |
| `03_Technical_Architecture.md` | 系统架构、服务拆分、AI/RAG/多租户/安全设计 | reasonix / 后端 / AI 工程 |
| `04_Repository_Structure.md` | 推荐目录结构、模块职责、命名规范 | reasonix |
| `05_Data_Model_API_Event_Spec.md` | 核心数据模型、API 草案、事件埋点规范 | reasonix / 测试 |
| `06_Agent_Orchestration_Spec.md` | Agent 角色、Chairman、会议模式、信心指数设计 | reasonix / AI 工程 |
| `07_UI_UX_Brief_for_Antigravity.md` | UI 设计任务书、页面优先级、视觉方向、组件要求 | antigravity |
| `08_Development_Roadmap.md` | 里程碑、Sprint 拆解、依赖、分工建议 | 项目管理 / reasonix |
| `09_Test_Strategy_and_Acceptance.md` | 测试策略、验收矩阵、E2E 用例、质量门禁 | QA / reasonix |
| `10_Risk_Decision_Log.md` | 关键风险、技术决策、待确认问题 | 全员 |

## 推荐使用顺序

1. 产品负责人先确认 `01` 与 `10` 中的范围、决策和开放问题。
2. antigravity 依据 `02` 与 `07` 输出信息架构、线框、视觉稿和交互原型。
3. reasonix 依据 `03`、`04`、`05`、`06` 搭建工程骨架与核心服务。
4. QA 与开发共同依据 `09` 建立验收用例与自动化测试。
5. 项目经理依据 `08` 组织里程碑与迭代节奏。

## MVP 建议

MVP 聚焦“可用、可信、可追溯”的核心评审闭环：

- 发起评审：上传/粘贴方案，一句话目标，选择会议模式。
- 动态组局：Chairman 生成方案诊断书，推荐 Agent，允许人工调整。
- 评审会议：优先实现轮流发言制与自由辩论制。
- 白盒输出：每条意见包含风险等级、引用、信心指数、改进建议。
- 报告生成：执行摘要、风险矩阵、分维度详评、Action Items、低信心意见。
- 管理后台：角色配置、知识库上传检索、基础权限与审计。

## 非 MVP 延后项

- 盲审与共识制、红蓝对抗制。
- 多维推演引擎与假设推演。
- 角色市场、组织知识自动沉淀、完整数据统计仪表盘。
- Jira/飞书/Linear 等第三方深度集成。
- 多语言完整本地化。
