# Next Steps — PrismReview 未来 3 个 Sprint

> Generated: 2026-07-15 · Context: 紧接全面审查报告 [docs/coordination/Codebase_Audit_Report.md](coordination/Codebase_Audit_Report.md) 落地 P0/P1 修复与 GitHub 门面打磨之后。
> Goal: 从"可跑 demo"转向"可体验的 MVP + 清晰的 P6 上车路径"。3 个 Sprint 每 Sprint ~2 周。

本路线图把 Codebase Audit Report 中所有 **P2** 项、Sprint 9.0 Product Roadmap Reset 的 **P6 第 1 波**、以及用户新提出的 **"前端产品化重设计"** 合并成可执行的 3 个 Sprint，每个 Sprint 含：目标 / 范围 / 验收标准 / 预估复杂度 / 依赖 / 是否适合社区贡献。

---

## Sprint A · 前端产品化重设计 + Dashboard（~2 周）

> **为什么先做前端**：P0–P5 当前的"后端真实能力"已经非常强（多轮辩论 / 加权评分 / 来源溯源 / HITL / 硬闸 / RBAC / 审计 / 版本化 Prompt / 蒸馏 Memory），但前端还停留在"早期 demo"——既没把这些后端能力反映出来，也没有产品化的视觉和导航。这是目前 star 转化和 demo 体验的最大瓶颈。

### 目标

- 把 Next.js 前端从"单页面 demo 控制台"升级为**产品化的多视图应用**：一个清晰的 Dashboard + 模块化侧边导航 + 完整的 9 状态工作流可视化 + 所有 P0–P5 能力都在前端有对应视图或入口。
- 视觉上对齐 2026 年 SaaS 观感（卡片化 / 排版层次 / 留白 / 动效 / Dark mode）。
- 后端 schema、API 契约**零改动** —— 所有新视图对接现有 controller。

### 范围

1. **AppShell 产品化**
   - `layout.tsx` / `AppLayout.tsx` 升级：增大导航密度（Reviews / Roles / Audit / Knowledge / Prompts / Workflows / Quality 每个模块至少 1 入口）、折叠式侧栏、Breadcrumb、User chip（展示 platformRole + 登出占位）。
   - 包：新增 `components/layout/` 子组件（Sidebar / Topbar / Breadcrumb / UserMenu），当前沿用 `antd`，不再引入新 UI 库（红线：不引新依赖除非 Gate）。

2. **Dashboard（首页重做）** — 替换当前 `app/page.tsx` 的"Demo 工具卡"
   - 顶部 4 个统计 KPI 卡：活跃评审数 / 已完成 / P0 风险数 / 今日 token 占位。
   - "快速操作"区：一键创建评审 / 继续最近评审 / 查看审计日志。
   - "最近评审"表：接入真实 `apiClient.getReviews`，状态色带 + 进度条（基于 currentRound / maxRounds）。
   - 接入 `/api/workflows` 下拉显示可用 preset。

3. **Reviews · 列表视图强化**
   - 状态色带替换纯 Tag，增加状态圆点 + 进度条（currentRound / maxRounds）。
   - 快速筛选 Tab 状态桶（活跃 / 已完成 / 中断 / 归档）+ 全文搜索（已有，优化样式）。

4. **Reviews · 详情/诊断视图升级**
   - 顶部 Timeline（`Steps` 已有组件）保留，下方右栏"ContextPanel" 对接 review objective + 真正的 `Data`，替换硬编码字符串。
   - 雷达图：把 `risk score` 列表升级为雷达图（可用 `recharts` 或纯 SVG），**新增依赖需 Gate** —— 建议用纯 SVG 自绘 `components/charts/Radar.tsx` 避免新依赖。

5. **Reviews · Meeting 视图升级**
   - 三栏布局保留，细化每个 SpeechCard（角色 icon / 状态点 / 风险等级 pill / 维度 pill / 展开全文）。
   - 新增"Moderator 决策卡"（在每轮 summarized 事件到来时渲染 Moderator decision + reasoning + ruleCheckResult，需后端把 ModeratorDecision 推到 SSE 或 GET 回传**前置调研：现有 API 已暴露 `/api/reviews/:id` 上 reporting；新增前端 GET 抓 SSE 的 `moderator.narrate` 事件**。
   - 新增"HITL 操作区"：Interrupt / Resume / Submit Human Turn（对接 `interrupt / resume / meetings` 三个已存在端点）。
   - 已完成的会议展示 aggregate metrics（复用 `MeetingHeader`）。

6. **Reviews · Report 视图升级**
   - 顶部 verdict + 评分卡保留，加入雷达图（维度分数 vs. max），展示 action item 状态流转，低置信意见红色高亮 + "加入复核清单"按钮占位。
   - `providerSummary` 区（已有）改为可折叠的"来源摘要"面板。

7. **新增模块入口页（MVP 列表即可，不追求全功能）**
   - `/roles` — 角色库列表（CTO / CFO / PMO / Compliance / User Advocate ⋯）。
   - `/audit` — 审计日志表（action / actor / time / detail）。
   - `/knowledge` — 文档库列表 + 上传入口占位。
   - `/prompts` — Prompt 模板注册表（Active version / 历史 / 回滚按钮）。
   - `/workflows` — preset 列表 + 每 preset 的维度权重预览。
   - 每个入口页至少该有个 list view + 一个 CTA；不需要完整 CRUD，**优先对齐后端已有 controller**。

8. **视觉与可访问性**
   - 全局引入主题色板 + 中/英双语文案（zh-CN 主，EN 辅助）+ 排版层级。
   - 添加 aria-label / 键盘可达性核心修复。
   - **Dark mode**：通过 antd `ConfigProvider` + `theme.ts` 增加 dark 切换占位。

### 验收标准

- [ ] 8 个以上页面/视图可访问（Dashbaord / Review List / Diagnosis / Meeting / Report / Roles / Audit / Knowledge / Prompts / Workflows ≥ 8）。
- [ ] 单拎任何一个 P0–P5 能力（多轮辩论 / 评分 / 溯源 / HITL / 硬闸 / RBAC / 审计 / Prompt 版本 / Memory），前端至少 1 个对应页面或区块。
- [ ] `tsc --noEmit` (web) 0 errors；`pnpm build` web 通过。
- [ ] 不引入新 npm 依赖（雷达图纯 SVG 自绘）**除非经快速 Gate 通过**。
- [ ] `smoke-runtime.js` 链路仍通过（新首页 Demo 流程兼容）。

### 预估复杂度

⭐⭐⭐（中高）。多为重复性的 "view + apiClient + antd 组件" 拼接，但页面数量多（8+）。建议拆给 1 个主程 + 1~2 contributor 并行。

### 依赖

- 后端：9 个 controller 全部就绪（roles / audit / knowledge / workflows / reviews / users），无需后端改动。
- 如有未暴露字段（如 ModeratorDecision 在 SSE 的 narrate 事件），优先 **前端 friendly fallback**（GET review 时附送 lastModeratorDecision），必要时加最小化的新 API。

### 是否适合社区贡献

✅ **非常适合 `good first issue`**：每个模块入口页（roles / audit / knowledge / prompts / workflows）都可以独立认领，单个 PR 范围清晰。sprint 启动后建议：
- `feat(frontend): add Roles library page` — good first issue
- `feat(frontend): add Audit log page` — good first issue
- `feat(frontend): add Knowledge base page` — good first issue
- `feat(frontend): add Prompt registry page` — good first issue
- `feat(frontend): add Workflow presets page` — good first issue

---

## Sprint B · P6 可观测性 + CI 稳定（~2 周）

> 目标：为迈入规模化铺好"看得见的基建"——把 CI 的真绿信度提升 + 成本/质量数据采集点埋好，为后续 multi-worker 做准备。

### 目标

- CI 绿信度：真实跑完 `tsc + smoke` 全套；把 README 的 CI badge 变成真正反映 main 分支状态。
- OTel 可观测性接入最小化：在 ReviewOrchestrator / QueueService / ModelAdapter 三个关键路径埋 span，输出到 stdout（dev）+ OTLP（prod 预留）。
- 成本数据采集点：在 `ModelAdapter.complete()` 内累计 `usage.totalTokens / totalCost` 落库，Reporting 时附 cost 摘要。
- 编写第一批 **Jest 单元测试**覆盖"编排脊柱核心"：路由决策、moderator 硬闸逻辑、幂等键判定（全部 mock DB）。

### 范围

1. **CI 升级**
   - 把 `.github/workflows/ci.yml` 跑通：`tsc + smoke-runtime + smoke-queue + smoke-sse + secrets scan`。
   - 稳定服务启动（healthcheck + retry 等待）。
   - 加 `concurrency` 取消同分支旧 run（已配）。
   - 在 README 把 CI badge URL 指向真实 workflow。

2. **OTel 最小接入**
   - 新包：`@opentelemetry/api` + `@opentelemetry/sdk-trace-base` + `@opentelemetry/resources` + `@opentelemetry/semantic-conventions`。dev 时用 `ConsoleSpanExporter`，prod 时通过 `OTEL_EXPORTER_OTLP_ENDPOINT` 切 OTLP（**通过快速 Gate** 引入依赖）。
   - 埋点点位：`graph-runtime` 节点进出、`moderator.decide`、`model-adapter.complete`、`queue.enqueue → complete`、`checkpointer.save / load`。
   - 红线：OTel 失败**绝不**影响主链路（用 noop tracer）。

3. **Cost/Summary 数据采集**
   - 提 `usage.token` / `cost` 累计路径到 `Review.usage` 字段（Review 模型 `metadata` / 专用列），Reporting 报告追加 "Cost" 小节。
   - Sprint 仅落数据采集点 + 报告小节；**不做实时成本仪表盘**（那是 Sprint C）。

4. **Jest 单测 · Phase 1**
   - 配置：`apps/api/jest.config.ts` + `ts-jest`；仅跑 `src` 单测（不动现有 smoke 脚本）。
   - 覆盖：
     - `graph-runtime.spec.ts`：`route()` 决策 / TERMINAL_STATUSES / `isTerminalStatus` / 收敛条件。
     - `moderator.spec.ts`：`computeRuleCheck` 在 `max_rounds = 1/2/3`、`max_turns_per_reviewer` 越界 / 收敛 override。
     - `idempotency.spec.ts`：幂等键相同 turn 只执行一次；不同 round/version 不视为冲突。
     - `provider-factory.spec.ts`：`mock` / `lmstudio` / `openai_compatible` + `ALLOW_EXTERNAL_MODEL_CALLS` 的 6 种组合。
   - mock：`PrismaService` / `QueueService` / `ModelAdapter` 全部 jest mock，不连 DB。

### 验收标准

- [ ] `pnpm test` (api) 至少跑 4 个新 spec、≥ 30 个 assertions，全部通过。
- [ ] CI on push+PR 全绿；README CI badge 反映实际 main 状态。
- [ ] OTel：dev 启动看到 stdout span 输出；移除 SDK 后链路仍工作（graceful noop）。
- [ ] Report 返回体附 `cost` / `tokenUsage` 小节（mock 值 0）。

### 预估复杂度

⭐⭐⭐（中高）。主要是新工具链（Jest + OTel）接入与相关 mock 编写，业务逻辑本身不变。

### 依赖

- Sprint A 的前端 Report 改动（cost 小节展示）可以在 Sprint B 同步 review。

### 是否适合社区贡献

✅ 部分适合：
- `test(api): add graph-runtime route unit tests` — good first issue
- `test(api): add provider-factory resolve tests` — good first issue
- `chore(ci): stabilize CI services boot` — medium, core-maintainer

---

## Sprint C · 规模化上车 + 队列/Worker（~2 周）

> 目标：把 P6 最大的风险项——**AgentRuntime worker 进程抽取**——用最小化可行方案先做第一步：把 **QueueService 从纯内存换成 BullMQ**（单 API 进程 + 单 worker 配置），而不是直接跳到 Celery。

### 目标

- 把 turn 执行从 API 内 in-process 迁移到 BullMQ worker，API 进程不再被 LLM 调用阻塞。
- 保留既有 in-process 模式作为 fallback（`QUEUE_DRIVER=memory|bullmq`），保证默认 mock 演示不受影响。
- 保留现有前端 / smoke / SSE 契约。

### 范围

1. **BullMQ 接入（单 worker）**
   - 启用 `@nestjs/bullmq` + `bullmq` 依赖（已在 `apps/api/package.json`，先前未使用）。
   - 配置 `BullModule.forRoot({ connection: Redis })`；注入 `review.start` Queue。
   - 新增 `bullmq-consumer.service.ts`（`@Processor('review.start')`）承接 turn 执行逻辑——从 `queue.service.ts` 把 `executeJob` 迁移来，配合 `getReviews` 的 turn 串行/并行语义。
   - `env.gate`：`QUEUE_DRIVER=bullmq` 显式启用，默认 in-process。

2. **Worker 进程抽离**
   - 新增 `apps/api/src/worker.ts`（独立的 NestJS `Microservice` 上下文，仅加载 reviews / prisma / bullmq）。
   - `pnpm dev` 默认起 web + api + 一个 worker（单进程 local）；K8s / prod 时 `pnpm worker` 可独立扩。

3. **Celery worker 定位**
   - `apps/worker` 保留但**明确标注**（已完成，见 PR for worker README），**本轮不再推进**。BullMQ 是 TS-native 优先路径；Celery 留给"真正需要 Python NLP 库 (unstructured / langchain)" 的未来专项。

4. **可观测性联动**
   - Sprint B 的 OTel spans 新增 bullmq enqueue / process / complete 节点。

### 验收标准

- [ ] `QUEUE_DRIVER=memory`（默认）行为完全不变（`smoke-*` 全通过）。
- [ ] `QUEUE_DRIVER=bullmq` 下完整链路工作；worker 可独立重启，Review 继续进行。
- [ ] API 进程在 turn 执行期间可响应其他请求（不再被阻塞）。
- [ ] 单 review 最大 still ≤ 30s / turn（mock 模式 0ms）。

### 预估复杂度

⭐⭐⭐⭐（高）。需要深入 NestJS BullMQ、job state machine、失败重试、idempotency。建议 core maintainer 主理，contributor 配写 test。

### 依赖

- Sweep A (前端契约不变) ✅；Sweep B (jest config) ✅ — BullMQ 迁移须有单测覆盖。

### 是否适合社区贡献

⚠️ 有限适合。核心抽离是 core-maintainer 任务。contributor 可认领：
- `test(api): add BullMQ consumer idempotent tests` — medium
- `docs: document QUEUE_DRIVER and worker process model` — good first issue

---

## 时间线概览

```
|  Sprint  |  周  | 主题                           | 关键交付                |
|----------|------|--------------------------------|-------------------------|
| Sprint A | W1-2 | 前端产品化重设计 + Dashboard   | 页面 ≥ 8 / zero-dep     |
| Sweep B  | W3-4 | 可观测性 + CI 稳定 + Jest      | 4 spec / OTel / cost    |
| Sweep C  | W5-6 | BullMQ worker 抽取             | QUEUE_DRIVER=bullmq     |
```

## 风险与降级策略

- **风险 A**：前端产品化工作量大，超出 2 周。降级：优先完成 Dashboard + Review 三视图 + 1 个模块入口页（roles）；其余模块入口留 v1.1。
- **风险 B**：OTel SDK 引入导致默认 install 变大 / 构建变慢。降级：把 OTel 设为 `optionalDependencies`，不装也能跑；dev 文档注明。
- **风险 C**：BullMQ 迁移影响既有 smoke 稳定性。降级：保留 in-process fallback，PR 期间 smoke 双模式对比 3 次 PR 再移除。

## 下一步动作（本周内）

1. 认领 Sprint A：拆模块入口页为 5 个 `good first issue`，贴到 GitHub。
2. 启动 Sprint B：本地跑一次 `jest --init` 试水，评估 spec 数量。
3. 把本文件并入 [ACTIVE_SPRINT.md](coordination/ACTIVE_SPRINT.md) 的 P6 段滚动。
