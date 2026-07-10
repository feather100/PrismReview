# Sprint 1 Planning Gate Review

> 日期：2026-07-06  
> 输入：Worker import/test 修复、antigravity Implementation Plan、reasonix Frontend Delivery Spec  
> 结论：前端规格放行；Worker 修复基本放行但需可复现测试；后端三模块 Implementation Plan 不放行，需重写为 SoT-first 版本。

## 1. 结论

- Frontend Delivery Spec：通过，可作为前端 Sprint 1 交付输入。
- Component Specs & Tokens：通过，可作为 UI 实现依据。
- Worker import 修复：方向正确，统一为 `from src...`，但本评审环境未能复跑 Python；必须保留可复现命令。
- antigravity Implementation Plan：不通过。该计划重定义了已有 Prisma 模型，和 `apps/api/prisma/schema.prisma`、`docs/predesign/05_Data_Model_API_Event_Spec.md` 冲突。

## 2. 必须修正的问题

### P0. 不允许重定义已有 Prisma Schema

当前计划中提出新增/更新：

- `AgentRole` 内联 `systemPrompt/defaultWeight/isCustom`。
- 新增 `ReviewRole` 关联表。
- 新增 `Document` / `DocumentChunk` 表。

这些与现有 SoT 冲突：

- 角色配置已经拆为 `agent_roles` + `agent_role_versions`。
- 评审角色选择当前存放在 `reviews.role_selection` JSON，MVP 不新增 `ReviewRole`。
- 知识库已经是 `knowledge_documents` + `knowledge_chunks`，不新增 `Document`。

裁决：Sprint 1 不改 Prisma schema，除非先更新 `docs/predesign/05_Data_Model_API_Event_Spec.md` 和 `DECISIONS.md`。

### P1. 角色名称和预置角色口径错误

计划写“架构师、产品、安全、PMO、QA”，但 PrismReview MVP 预置角色是：

- CTO
- CFO
- PMO
- Compliance
- UserAdvocate

裁决：Role Service 必须基于 seed 中的五个预置角色。

### P1. Knowledge Mock Upload 边界需收窄

允许做：

- 接收 metadata 或 mock file info。
- 写入 `knowledge_documents` 一条记录。
- 状态可直接置为 `ready`。
- 可选写入 1-2 条 mock `knowledge_chunks`。

不允许做：

- 新增 `Document` 表。
- 真实 OCR、真实 embedding、真实外部模型调用。

## 3. 放行的前端输入

`docs/design/Frontend_Delivery_Spec.md` 可进入实现，但其中 G01-G24 需要转化为 API backlog。P0 缺口优先处理：

- G01 诊断 JSON schema。
- G05 可用角色 API。
- G10 SSE 协议。
- G13 Report grade。
- G17 风险矩阵影响/概率。
- G21 权限 API。
- G22 snake_case/camelCase 策略。
- G24 错误码映射。

## 4. 下一步准入任务

### reasonix

先输出新的 SoT-first Implementation Plan，不直接编码。

必须遵守：

- 不改 Prisma schema。
- Role Service 使用现有 `agent_roles` / `agent_role_versions`。
- Review Draft 使用现有 `reviews` 表和 `role_selection` JSON。
- Knowledge Mock Upload 使用现有 `knowledge_documents` / `knowledge_chunks`。
- API 返回字段需明确 snake_case 到 camelCase 的转换策略。
- 外部模型仍保持 mock provider。

### antigravity

停止产出后端 schema 计划，专注前端交付规格：组件 props、页面状态、API 字段映射、Ant Design token。

## 5. 最终裁决

No-Go for backend coding until Implementation Plan is rewritten against current SoT.

Go for frontend scaffolding based on design specs, as long as API calls are mocked and aligned to the P0 gap list.
