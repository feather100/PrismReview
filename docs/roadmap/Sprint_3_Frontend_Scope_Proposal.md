# 🚀 PrismReview Sprint 3.0: 前端范围建议书 (Frontend Scope Proposal)

## 1. 当前 MVP 前端 Freeze 状态 (Sprint 2.7 归档)
目前前端体验已经冻结，具备完整连贯的单体评审演示能力：
- **首页 Demo Dashboard**：提供“创建 Mock 演示评审”路线，以及支持真实 DB Opinions 演练的 ID 注入入口。
- **Diagnosis 状态机 CTA**：根据评审流所处的生命周期 (`ready` / `running` / `completed` / `failed`)，动态切换操作按钮（确认评审团 / 进入会议室 / 查看报告），并附带严密的防误触状态拦截。
- **Meeting SSE**：基于 Server-Sent Events 实现的实时打字机效果及智能体气泡渲染，涵盖网络异常降级（防白屏保护）。
- **Report API**：彻底打通了 `GET /api/reviews/{reviewId}/report` 的真实 API 接口，并已完成强类型映射。
- **最近评审 localStorage**：作为临时缓存方案，在首页展示并持久化刚刚访问的评审入口。

## 2. Sprint 3 推荐主线
**优先推荐方向**：开发正式的“评审列表页 / 我的评审” (Review List Page)。

**原因**：目前的 `localStorage` 机制只是为了填补 MVP 演示断层的临时体验补丁（Demo 入口）。随着架构走向业务化，我们需要将其向真实的业务系统入口演进，提供可靠的数据列出、追溯与导航能力，并与后端侧重点实现自然对齐。

## 3. 前端建议任务
- **新增“我的评审”页面**：引入包含分页、筛选（可选）的 Ant Design 列表/表格页结构。
- **列表数据获取**：对接 `GET /api/reviews` 拉取真实评审列表。
- **字段渲染支持**：列表需至少支持展示 状态 Tag (`status`)、标题 (`title`) 以及 创建时间。
- **行级操作 (Row Actions)**：针对每条评审，基于其状态动态提供快捷操作链路：
  - 查看诊断
  - 进入会议室
  - 查看报告
- **首页演进**：将首页现有的“最近评审”模块进行重构，升级为“最近评审 + 我的评审入口”。

## 4. UI 约束与原则
- **中文产品体验**：继续保持坚定、友好的全量中文产品语境。
- **契约先行 (不猜字段)**：严格杜绝前端臆造 API 结构。所有涉及 `GET /api/reviews` 的列表联调，**必须**等待 reasonix (后端) 给出明确的 DTO 及契约后再进行接入。
- **静默占位**：导出 PDF / Markdown、同步 Jira 以及会议人工干预等高阶按钮，本 Sprint 继续维持 `disabled` 状态。

## 5. 暂缓事项 (Out of Scope)
在 Sprint 3 期间，以下复杂性需求继续延后，不纳入前端开发排期：
- 接入真实大模型交互 (Real LLM)。
- 将 Runner 进程与 UI 直连。
- 真实实现 PDF / Jira 打通。
- 搭建 RAG 前端管理及配置页面。
- 复杂的 RBAC 与多租户权限控制。
