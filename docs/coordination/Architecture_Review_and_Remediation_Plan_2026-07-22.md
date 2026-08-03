# PrismReview 架构评审意见、改进措施与实施计划

> 文档性质：架构评审结论 + 整改总计划 + Agent 派工入口  
> 日期：2026-07-22  
> 评审基线：`main@056607c`  
> 适用流程：`docs/coordination/AGENT_COORDINATION_PROTOCOL.md` 标准 Gate  
> 目标读者：后端实现 Agent、前端实现 Agent、独立审查 Agent、最终 Gate 负责人  
> 本文只定义整改范围与验收标准，不直接修改产品代码。

---

## 0. 执行摘要

PrismReview 当前已经具备较完整的多 Agent 评审 MVP：Next.js 前端、NestJS API、Prisma/PostgreSQL 数据模型、自研 Graph 编排、Moderator 决策、Checkpoint、Provider Adapter、评分、报告与审计骨架均已落地。正式构建、API/Web TypeScript 类型检查和编排核心单测均能通过。

架构方向总体正确，但“生产边界”尚未闭合。当前系统适合本地演示、单进程验证和继续演进，不适合按真实多租户 SaaS 标准直接上线。阻塞生产化的核心问题不是功能数量，而是以下五类基础能力：

1. 真实身份认证与资源级授权尚未落地。
2. 多租户隔离在 Provider、Prompt、质量报告等路径存在缺口。
3. Provider 密钥、SSRF 与外部模型调用策略存在高风险旁路。
4. Agent Turn 仍由 API 进程内内存队列执行，不具备持久化、横向扩展和可靠恢复能力。
5. 状态机、Checkpoint、接口契约和 CI 门禁存在分散、漂移或失效问题。

本计划锁定以下架构方向：

- 保留“模块化单体”，现阶段不拆微服务。
- 新建 TypeScript `AgentRuntime` worker，使用 BullMQ + Redis；不继续扩展当前 Python/Celery 占位层。
- PostgreSQL 是业务状态唯一事实来源，Redis 只承担任务传递、租约和短期事件通知。
- 身份认证使用标准 OIDC/JWT；Mock 用户只能在显式本地开发模式启用。
- 所有租户数据访问统一经过资源授权策略，不允许 Service 自行决定是否过滤 `tenantId`。
- API 传输契约使用 OpenAPI 生成前端 Client；领域状态只保留一个权威定义。

---

## 1. 已核实基线

### 1.1 技术栈

| 层 | 当前实现 | 结论 |
|---|---|---|
| Web | Next.js 14、React 18、Ant Design、Axios、Zustand | 可继续使用 |
| API | NestJS 10、Prisma 5、PostgreSQL 16 | 适合继续保持模块化单体 |
| 编排 | 自研最小 Graph Runtime + Moderator + Checkpoint | 方向正确，需加强一致性 |
| 队列 | API 进程内数组 + `setTimeout` | 仅适合 Mock/MVP，必须替换 |
| Worker | Python/Celery 占位工程，Job 均为 TODO | 未接线，不应作为现有能力 |
| 实时事件 | SSE + API 内 DB 轮询 | 小规模可用，需补认证与通知层 |
| 契约 | 后端 DTO、前端手写类型、`shared-types` 并存 | 已发生漂移 |
| CI | 类型检查、Jest、Smoke、Secret Scan | 基础存在，但 Lint 与迁移门禁不可靠 |

### 1.2 验证结果

评审期间完成以下只读验证：

| 验证项 | 结果 |
|---|---|
| `pnpm build` | 通过，API 与 Web 正式构建成功 |
| API `tsc --noEmit` | 0 errors |
| Web `tsc --noEmit` | 0 errors |
| API Jest | 4 suites / 53 tests 全部通过 |
| `pnpm lint` | 失败，API 未安装或配置 ESLint |
| Worker Python 单测 | 当前机器无 Python 运行时，未执行 |
| Docker DB/Redis Smoke | 本次评审未启动全栈，未重跑 |

### 1.3 正面评价

- Graph 脊柱、普通代码叶子、Moderator 硬闸的组合符合本产品领域。
- 默认 Mock、真实模型显式开启、Provider 来源留痕是正确的安全方向。
- Checkpoint、ModeratorDecision、ReviewTurn、ReviewOpinion 等实体为恢复和审计提供了基础。
- 当前规模下继续采用模块化单体，成本和收益优于拆微服务。
- 编排纯逻辑已有可用单测基础，适合后续扩充成系统级测试。

---

## 2. 架构问题与评审意见

### AR-P0-01：身份认证实际上未生效

**证据**

- `apps/api/src/common/guards/jwt-auth.guard.ts` 无条件注入固定 `enterprise_admin` 用户。
- Guard 不解析、不验证 Bearer Token，也不校验签名、Issuer、Audience、过期时间或用户状态。
- `apps/web/src/lib/api-client/client.ts` 使用公开环境变量中的固定 `test-token`。

**影响**

- 任意请求都可获得企业管理员身份。
- RBAC 装饰器即使存在，也建立在伪造身份上。
- 审计日志记录的是固定用户，无法承担追责用途。

**评审意见**

在真实 JWT/OIDC 落地前，系统不得对外宣称已具备生产级认证、RBAC 或审计能力。

### AR-P0-02：资源授权和租户隔离不完整

**证据**

- `ReviewsController` 明确保留“多数路由 RBAC pending”注释。
- `QualityService.listQualityReports()` 和 `getQualityReport()` 不接收用户上下文，也不按租户过滤。
- `LlmProvider` 模型没有 `tenantId`，当前 Provider 配置全局共享。
- `PromptTemplateRecord` 没有 `tenantId`，不同租户可能读取或覆盖同一角色模板。
- 各 Service 分别手写 `tenantId`/`createdBy` 条件，没有统一资源策略。

**影响**

- 部分读取路径可能跨租户暴露数据。
- `enterprise_admin`、`department_admin`、普通用户的资源可见范围没有统一语义。
- 新模块容易遗漏租户过滤，风险会随功能增长扩大。

**评审意见**

必须建立统一的 `AccessPolicy`/`ResourceScope` 层，并把租户字段作为数据模型和查询接口的强制参数。仅靠 Controller 装饰器不足以实现资源级授权。

### AR-P0-03：Provider 密钥和外部调用存在旁路

**证据**

- `ReviewsService.createReview()` 将 `dto.provider.apiKey` 原样写入 `Review.providerConfig` JSON。
- `QueueService.resolveAdapter()` 对每次评审覆盖项直接设置 `ALLOW_EXTERNAL_MODEL_CALLS='true'`。
- 每次评审的 `baseUrl` 未经过统一 `assertPublicUrl()` 校验。
- `LlmProviderService.validate()` 是异步函数，但创建和更新路径未保证正确 `await` 后再持久化。
- 管理型 `LlmProvider.apiKeyEnc` 已加密，但每次评审覆盖路径绕过了该机制。

**影响**

- 明文密钥进入业务表、备份、数据库快照和管理员查询面。
- 外部调用总开关可能被每次评审配置绕过。
- 用户可控 URL 可能形成 SSRF，连接测试还会携带解密后的 Authorization Header。

**评审意见**

Review 只能引用已授权的 Provider ID，不得保存 API Key。外部模型调用必须经过一个不可绕过的 `ProviderPolicy`，统一执行租户授权、URL 校验、密钥解析、预算和出站策略。

### AR-P0-04：Agent Turn 执行不具备生产可靠性

**证据**

- `QueueService` 使用内存数组保存 Job，串行 `setTimeout` 执行。
- API 进程直接完成 LLM 调用、Prompt 组装、解析和落库。
- 进程退出时只清理 Timer，不持久化等待中的任务。
- Python/Celery Worker 没有被 API、Compose 或开发脚本接入，所有 Job 主体仍是 TODO。

**影响**

- API 重启会丢失排队任务。
- 多 API 实例会各自维护队列，可能重复执行或漏执行。
- 慢模型调用占用 API 进程资源，影响普通请求和 SSE。
- 缺少可运营的重试、死信、并发限制、租约和任务超时。

**评审意见**

实现独立 TypeScript `AgentRuntime` Worker。BullMQ 负责可靠任务传递，PostgreSQL 负责业务状态；使用 Transactional Outbox 保证“状态变化”和“任务发布”不会分裂。

### AR-P1-01：状态转换与事务边界分散

**证据**

- `REVIEW_STATUS_FLOW` 只是说明，实际合法性由各方法中的 `assertReview(allowedStatuses)` 分散保证。
- `startReview()` 先把状态写成 `running`，再调用 Orchestrator；中间失败会留下半完成状态。
- `summarize()` 存在绕过 Moderator、直接从 `summarized` 写到 `completed` 的兼容路径。
- 删除评审逐表执行多个 Delete，没有单一事务边界。

**影响**

- 新功能可能引入未登记的状态跳转。
- API 异常、数据库异常或并发请求会留下不一致状态。
- 状态机难以进行模型检查和完整回归。

**评审意见**

建立唯一 `ReviewLifecycleService`，通过 Compare-and-Swap/版本号执行状态转换；状态更新、业务事件、Outbox 写入必须处于同一数据库事务。

### AR-P1-02：Checkpoint 并发序号存在竞态

**证据**

- `PostgresCheckpointer.save()` 先查询当前最大 `sequence`，再写入 `max + 1`。
- `(reviewId, sequence)` 虽有唯一约束，但并发保存时只能以冲突失败，缺少重试或数据库原子序列。

**影响**

- 并发节点完成、重复回调或多实例运行时可能无法保存 Checkpoint。
- Checkpoint 和 Review 当前节点可能不同步。

**评审意见**

Checkpoint 序号应由 Review 行版本、数据库锁或事务内原子计数生成，并对唯一冲突进行有限重试。Checkpoint 与 `currentNodeId/currentRound` 更新应在同一事务中完成。

### AR-P1-03：接口与领域类型已经漂移

**证据**

- `packages/shared-types` 仍定义旧状态：`draft/diagnosing/ready/summarizing`。
- Prisma 和 Orchestrator 使用：`created/diagnosed/running/summarized/...`。
- Web `api-client` 手工复制大量 Request/Response 接口，并包含多处 `any`。
- `packages/config`、`packages/prompts`、`packages/schemas` 声明了不存在的 `src/index.ts`。

**影响**

- 编译成功不能保证前后端契约一致。
- 状态增加或字段变化需要手工同步多个位置。
- 空包制造了已模块化的假象，也增加 Turbo 工作区噪声。

**评审意见**

使用 Nest OpenAPI 作为 HTTP 契约唯一来源，并生成前端 Client。领域状态在 API 的 domain 模块中单点定义，必要时通过生成过程输出只读共享类型。

### AR-P1-04：SSE 认证和扩展模型不完整

**证据**

- 浏览器原生 `EventSource` 无法携带当前 Axios 使用的 Authorization Header。
- 当前 Mock Guard 掩盖了这一问题；切换真实 Bearer Token 后 SSE 会失去认证路径。
- 每个连接每 2 秒轮询 ReviewTurn，并重复查询角色数据。
- 未实现 `Last-Event-ID` 重放语义和稳定的跨实例事件游标。

**影响**

- 真实认证上线时会议页可能直接断流。
- 连接数增长会线性增加数据库轮询负载。
- 多实例部署时事件连续性和恢复语义不明确。

**评审意见**

第一阶段使用同站 HttpOnly Cookie 或 BFF Token Exchange 解决 SSE 认证；第二阶段使用 Redis Pub/Sub/Streams 作为通知层，PostgreSQL 保持可回放事实来源。

### AR-P1-05：测试和 CI 不能证明系统级可靠性

**证据**

- 当前 Jest 只有 4 个纯逻辑 Suite，共 53 个测试。
- 没有前端组件测试、鉴权集成测试、租户隔离测试、数据库事务测试、队列崩溃恢复测试。
- `pnpm lint` 失败，API 没有可执行 ESLint 配置。
- CI 的 Prisma 迁移命令使用 `|| true`，可能掩盖迁移失败。
- Worker 测试未进入 Node/Turbo 主门禁。

**影响**

- CI 绿灯只能证明类型和部分编排规则正确。
- 最危险的安全、并发、恢复路径没有自动回归。

**评审意见**

CI 必须把 Lint、迁移、数据库集成、鉴权矩阵、租户隔离和 Worker Crash Recovery 纳入强制门禁；禁止对迁移失败容错放行。

### AR-P2-01：核心 Service 体积和职责过大

当前 `ReviewsService`、`QueueService`、`ReviewOrchestrator`、`QualityService` 均达到约 650-700 行。问题不在行数本身，而在应用命令、领域规则、数据访问、兼容路径和基础设施逻辑混在同一类中。

建议在不拆微服务的前提下，按以下边界拆分：

- Application Commands：创建、诊断、启动、中断、恢复、归档。
- Domain Lifecycle：状态转换、硬闸、幂等规则。
- Read Model：列表、详情、报告、会议流查询。
- Infrastructure Adapters：Queue、Provider、Checkpoint、SSE Notification。

---

## 3. 目标架构

```text
Browser / Next.js
       |
       | HTTPS + OIDC session / JWT
       v
NestJS Modular Monolith
  - AuthN / AccessPolicy
  - Review Application + Lifecycle
  - Orchestrator + Moderator
  - ProviderPolicy + SecretResolver
  - Reporting / Prompt / Memory / Knowledge
       |
       | transaction: state + business event + outbox
       v
PostgreSQL  <------------------------------+
       |                                    |
       | Outbox relay                       | result/checkpoint/opinion
       v                                    |
Redis + BullMQ -----> TypeScript AgentRuntime Worker
       |
       +---- Redis event notification -----> SSE Gateway

PostgreSQL = 业务事实与恢复来源
Redis      = 队列、租约、短期通知，不保存唯一业务事实
```

### 3.1 明确不做

- 不把 Auth、Review、Prompt、Reporting 拆成独立微服务。
- 不同时维护 TypeScript Worker 和 Python/Celery Worker 两套执行链路。
- 不在本轮整改中扩展 RAG、MCP 工具、更多 Provider 或新 UI。
- 不通过增加 Prompt 文案解决预算、重试、收敛或安全问题。
- 不以“Smoke 能跑通”替代安全、并发和崩溃恢复测试。

---

## 4. 分阶段实施计划

所有 Sprint 都必须走标准 Gate。涉及 Schema、状态机、认证、真实模型和队列，不允许快速 Gate。

### Sprint 10.1：Provider Security Emergency Hardening

**目标**

先关闭无需大范围重构即可修复的密钥、SSRF 和外部调用旁路。

**Owner 建议**

- Backend/Contract：reasonix 或后端实现 Agent
- Review：qoderwork，只审查不改代码
- Gate：Codex / 用户

**实施任务**

1. 删除新建 Review 时接受和持久化明文 `apiKey` 的路径。
2. 为 `LlmProvider` 增加最小 `tenantId` 归属，并给现有数据提供明确回填 Migration。
3. Review 创建只允许提交 `llmProviderId`，并校验 Provider 属于当前租户且处于可用状态。
4. 修正 `LlmProviderService.validate()` 所有调用点，确保异步 URL 校验完成后才能写库。
5. Provider 创建、更新、连接测试、实际 Completion 全部复用同一个 `ProviderPolicy.assertAllowed()`。
6. 禁止业务代码直接写入 `ALLOW_EXTERNAL_MODEL_CALLS='true'`；开关只能来自服务端可信配置和租户策略。
7. 对日志、异常、审计 Detail、DTO 序列化执行密钥泄露检查。
8. 增加 SSRF 测试：localhost、IPv4/IPv6 loopback、RFC1918、link-local、metadata IP、DNS 解析到私网、非 HTTP 协议。

**允许修改**

- Provider DTO、Service、Policy、Review 创建 DTO、相关 Schema/Migration、测试。

**禁止事项**

- 不新增真实 Provider。
- 不调用真实付费模型做验证。
- 不把 API Key 放入前端环境变量、Review JSON 或日志。

**验收标准**

- 数据库中不存在新写入的明文 Provider Key。
- `ALLOW_EXTERNAL_MODEL_CALLS=false` 时，任何用户输入都不能启用外部调用。
- 所有 SSRF 阻断用例返回 4xx 且不会发出网络请求。
- API/Web `tsc`、Jest、Provider 专项测试、Secret Scan 全绿。

### Sprint 10.2：Real AuthN + Tenant Authorization

**依赖**：Sprint 10.1 Go。

**目标**

建立可生产使用的身份、租户和资源授权边界。

**实施任务**

1. 定义 `AuthMode=mock|oidc`；`mock` 仅允许 `NODE_ENV=development|test` 且显式启用。
2. 接入标准 JWT 验证：签名、Issuer、Audience、过期时间、Subject、Tenant Claim。
3. 根据 `sub + tenantId` 查询本地 User，校验用户状态和平台角色；不信任 Token 中直接携带的权限列表。
4. 建立 `AccessPolicy`：`canReadReview`、`canWriteReview`、`canAdminTenant`、`scopeForReviewList` 等资源策略。
5. 为 Reviews、Quality、Provider、Prompt、Audit、Users、Knowledge 全量补权限声明和资源级校验。
6. 复核 10.1 已增加的 `LlmProvider.tenantId`，并为 `PromptTemplateRecord`、`QualityReport` 补齐租户归属或通过强关系获得租户作用域。
7. 明确 `super_admin` 跨租户能力，并默认拒绝其他角色跨租户访问。
8. 设计 SSE 认证：优先同站 HttpOnly Cookie；若保持跨域 Bearer，则实现短时 SSE Ticket，不在 URL 放长期 Token。
9. 前端增加登录态失效处理、401/403 区分和无权限页面；不在浏览器存储长期高权限 Token。

**验收矩阵**

| 场景 | 期望 |
|---|---|
| 无 Token 访问受保护接口 | 401 |
| 伪造/过期/错误 Audience Token | 401 |
| 普通用户读取自己的 Review | 200 |
| 普通用户读取同租户他人 Review | 403 或 404，按 Contract 固定 |
| Department Admin 读取其他部门 Review | 拒绝 |
| Tenant A 读取 Tenant B QualityReport | 拒绝 |
| Tenant A 列出 Provider/Prompt | 不出现 Tenant B 数据 |
| 被禁用用户持有未过期 Token | 拒绝 |
| SSE 未认证连接 | 401 |
| SSE 合法会话 | 持续收到事件且刷新策略明确 |

**Gate 要求**

- 必须提供至少两租户、四角色的自动化授权矩阵。
- 必须验证数据库直接存在跨租户数据时 API 仍不会泄露。
- Mock Auth 在 production 配置下必须启动失败或强制禁用。

### Sprint 10.3：Durable AgentRuntime Contract

**依赖**：Sprint 10.2 的租户与身份字段定义稳定。可与 10.2 后半段文档工作并行，但代码不得抢先。

**目标**

先定义可靠执行契约，再接 BullMQ，避免把当前 QueueService 原样搬到 Worker。

**本 Sprint 只做契约和最小 Schema，不切流量。**

**契约必须定义**

1. Job 类型：`review.round.dispatch`、`agent.turn.execute`、`review.round.complete`。
2. Job Envelope：`jobId`、`tenantId`、`reviewId`、`turnId`、`round`、`attempt`、`traceId`、`createdAt`、`schemaVersion`。
3. 幂等键：至少包含 `reviewId + round + roleVersionId + phase`。
4. Claim/Lease：Worker 身份、租约到期时间、心跳周期、失联后的重新领取规则。
5. Retry 分类：可重试网络错误、不可重试认证/Schema/Guard 错误、退避策略和最大次数。
6. DLQ：进入条件、人工重放权限、重放是否复用原幂等键。
7. Outbox：状态事务提交后发布，发布成功标记，重复发布可安全消费。
8. Result：Opinion、usage、providerSource、errorClass、duration、模型引用的落库顺序。
9. 取消与中断：HITL Interrupt 如何阻止新 Job、如何处理正在执行的模型调用。
10. 安全：Job 只携带 Provider ID，不携带明文密钥和完整用户 Token。

**交付物**

- `Sprint_10.3_AgentRuntime_Contract_Backend.md`
- 必要的 additive Prisma Migration
- Job Schema 验证器及纯逻辑测试
- Outbox Relay 的最小接口，不接真实 Worker

**验收标准**

- Contract 能完整描述重复投递、Worker 崩溃、API 崩溃、Redis 短时不可用和人工中断。
- Migration 在空库和历史库都能执行。
- Outbox 重复扫描不会制造重复 ReviewTurn。

### Sprint 10.4：BullMQ AgentRuntime Implementation in Shadow Mode

**依赖**：Sprint 10.3 Go。

**目标**

实现 TypeScript Worker 和完整故障语义，但先以显式 Feature Flag 运行，不切换默认执行链路。

**实施任务**

1. 新建 `apps/agent-runtime`，复用 API 的 Job Contract 和 Provider Adapter 公共接口。
2. 引入 BullMQ，配置独立 Queue、Worker、QueueEvents 和 DLQ。
3. 抽象统一 `AgentRuntimePort`；默认仍走现有 MVP 路径，Shadow Mode 才走 BullMQ，便于对照验证。
4. Worker 按租户、Provider 和 Review 限制并发；默认 Mock 仍可零外部依赖运行。
5. 实现 Job 心跳、超时、AbortSignal、有限重试和失败分类。
6. Worker 结果以幂等事务写入 ReviewTurn/ReviewOpinion/BusinessEvent。
7. 新 Worker 路径上的 Orchestrator 依据数据库事实推进，不依赖 Worker 进程内回调。
8. 使用 Redis 通知 SSE Gateway 有新状态，SSE 收到通知后从数据库读取事实。
9. 更新 Docker Compose、开发命令、健康检查和优雅停机；README 明确 Shadow Mode 尚非默认链路。
10. 保留旧 QueueService 和 Python/Celery 占位工程，不在本 Sprint 删除；最终清理由 10.5 Cutover 完成。

**强制故障演练**

| 演练 | 通过条件 |
|---|---|
| Job 入队后 API 立刻退出 | Worker 仍能完成，API 恢复后状态正确 |
| 模型调用中 Worker 被终止 | Lease 到期后重试，不产生重复 Opinion |
| Redis 重启 | 已提交业务状态不丢失，Outbox 恢复发布 |
| 同一 Job 重复投递 3 次 | 只产生一个终态 Turn |
| 两个 Worker 并发 | 不重复执行同一幂等任务 |
| Review 被 interrupt | 不再派发新 Turn，运行中 Turn 按 Contract 取消或完成后 Park |
| 不可重试 Provider 错误 | 直接进入明确失败态，不重复计费 |

**Gate 要求**

- 必须是独立 Queue Gate，不能与普通 UI 功能一起放行。
- 必须提供 Worker Crash Recovery 视频或可复现命令日志。
- 默认 Mock 全链路 Smoke 必须继续通过，且 Feature Flag 关闭时行为不变。
- 本 Sprint Gate 只允许 Shadow Mode Go，不代表生产流量 Cutover Go。

### Sprint 10.5：Lifecycle Consistency, Checkpoint Hardening and Worker Cutover

**依赖**：Sprint 10.4 Shadow Mode Go。

**目标**

把状态机从分散条件提升为唯一、可事务化、可并发验证的领域能力，并在一致性基础完成后正式切换到 AgentRuntime Worker。

**实施任务**

1. 建立单一 `ReviewStatus` 权威定义和 `ReviewLifecycleService`。
2. 所有状态变更必须声明 `from`、`to`、Actor、Reason、Version。
3. Review 增加乐观锁版本；状态更新使用 Compare-and-Swap。
4. `start`、`interrupt`、`resume`、`complete round`、`archive`、`delete` 使用明确事务边界。
5. Checkpoint Sequence 改为事务内原子生成，并与 Review 当前节点一起提交。
6. 移除绕过 Orchestrator 的兼容状态推进路径，或在 Contract 中显式标记为管理命令。
7. 增加状态机模型测试：所有合法边、所有非法边、并发双 Start、双 Resume、重复 Complete。
8. 定义恢复扫描：启动时如何发现 `running`、`interrupted`、过期 Lease、未发布 Outbox。
9. 将 BullMQ `AgentRuntimePort` 切换为默认路径，旧 QueueService 只保留一个有期限的回滚开关。
10. 完成 Cutover Smoke 和观察期后删除旧内存队列执行代码。
11. 将 `apps/worker` Python/Celery 工程移入 archived/contrib 区或删除，仓库只保留一个正式 Worker。

**验收标准**

- 代码中不存在任意 `prisma.review.update({ status: ... })` 的自由写入；必须经 Lifecycle API。
- 并发两次 Start 只有一次成功派发。
- Checkpoint 不出现重复 Sequence，恢复点与 Review 当前节点一致。
- 任意失败都不会留下“状态已推进但任务未发布”的窗口。
- 默认 Mock、真实 Provider 和 HITL 路径均通过 Worker 执行，API 进程不再直接执行 Completion。
- 回滚开关、观察期和删除旧链路的时间点均有记录。

### Sprint 10.6：Contract, CI and Test Gate Completion

**依赖**：可在 10.3 后启动契约工具调研；最终合并应在 10.5 后。

**目标**

消除契约漂移，建立可阻止架构回归的工程门禁。

**实施任务**

1. 为 Nest API 引入 OpenAPI 文档生成，覆盖全部正式 Controller DTO。
2. 从 OpenAPI 生成前端类型化 Client，替换手写 Axios 接口和主要 `any`。
3. 删除或修复 `packages/config`、`packages/prompts`、`packages/schemas` 空包。
4. 删除旧 `shared-types` 状态，或改为由权威 Schema 生成。
5. 安装并配置 ESLint，使根目录 `pnpm lint` 可执行。
6. CI 移除 Prisma Migration 的 `|| true`；分别验证空库 Deploy 和历史基线升级。
7. 增加 API + PostgreSQL 集成测试、Auth/Tenant 矩阵、Outbox/Worker 恢复测试。
8. 增加前端最小测试：登录失效、403、状态按钮矩阵、SSE 断线恢复。
9. 为关键模块设定覆盖目标，不以全仓机械覆盖率代替风险场景。
10. 更新 README/ARCHITECTURE，明确已完成能力、实验能力和未完成能力。

**最终 CI 必须包含**

```text
install --frozen-lockfile
prisma generate
lint
api typecheck
web typecheck
unit tests
database integration tests
fresh migration deploy
upgrade migration deploy
mock full-stack smoke
auth and tenant isolation suite
worker crash-recovery suite
secret scan
production build
```

---

## 5. 依赖顺序与并行规则

```text
10.1 Provider Security
        |
        v
10.2 AuthN + Tenant Authorization
        |
        v
10.3 AgentRuntime Contract -----> 10.6 Contract/CI 前置工作
        |
        v
10.4 BullMQ Worker Shadow Mode
        |
        v
10.5 Lifecycle Consistency + Worker Cutover
        |
        +------------------------> 10.6 最终合并与总 Gate
```

### 可以并行

- 10.1 的安全测试与 Provider Service 修复可以并行，但由一个 Agent 负责最终整合。
- 10.2 后端认证契约确定后，前端登录态/403/SSE Ticket 可并行实现。
- 10.3 完成 Job Envelope 后，10.6 可开始 OpenAPI 和 Lint 基础工作。
- 10.4 Worker Shadow Mode 实现期间，可由独立 Review Agent 编写故障演练脚本，但不得修改 Worker 核心代码。

### 必须串行

- Prisma Schema Migration 同一时间只允许一个实现 Agent 修改。
- Review 状态机和 Checkpoint 同一时间只允许一个实现 Agent 修改。
- Provider 密钥模型未完成前，不得开始真实模型扩展。
- AgentRuntime Contract 未通过 Gate，不得接入 BullMQ 正式流量。
- Worker Cutover 未稳定前，不得删除旧 QueueService 兼容路径。

---

## 6. Agent 派工模板

每个实现 Agent 收到任务时，应使用下面的固定输入，避免只收到一句“修一下架构”。

### 6.1 实现 Agent 必读输入

1. 本文对应 Sprint 章节。
2. `docs/coordination/AGENT_COORDINATION_PROTOCOL.md`。
3. `docs/ARCHITECTURE.md`。
4. 对应上游 Contract 文档。
5. 当前 `ACTIVE_SPRINT.md`。

### 6.2 实现 Agent 输出要求

- 先提交 Contract/Implementation 文档，再提交代码。
- 列出所有修改文件和 Schema 影响。
- 明确 In/Out，不顺手扩功能。
- 提供可复现验证命令和实际结果。
- 说明回滚方式、兼容期和数据迁移策略。
- 不提交 `.env`、真实 Token、真实 API Key、运行数据或临时调试文件。

### 6.3 Review Agent 检查重点

- 是否完整解决根因，而不是只隐藏入口。
- 是否存在绕过统一 Policy/Lifecycle/Queue 的旁路。
- 是否新增跨租户查询或返回敏感字段。
- 是否对并发、重复投递、失败恢复给出证据。
- 是否用 `|| true`、吞异常、Mock 自动回退掩盖失败。
- 是否保持默认 Mock 不调用真实模型。
- 是否修改了 Contract 但未同步前端生成 Client。

### 6.4 Gate 结论规则

- 任一 P0 未关闭：No-Go。
- Schema、状态机、真实 Auth、真实 Queue 无迁移/回滚/故障证据：No-Go。
- 仅 TypeScript 编译通过但没有风险场景测试：No-Go。
- 真实模型被默认启用或可由用户输入绕过：No-Go。
- 跨租户自动化矩阵任一失败：No-Go。

---

## 7. 总体完成定义

只有同时满足以下条件，PrismReview 才可以从“可演进 MVP”进入“生产候选版本”：

- [ ] 生产环境不存在 Mock 身份注入路径。
- [ ] 所有业务数据具有明确租户作用域，并通过自动化跨租户测试。
- [ ] Review 不保存明文 Provider Key，外部调用策略不可绕过。
- [ ] 用户可控 Provider URL 经过同步语法与异步 DNS/IP 安全校验。
- [ ] Agent Turn 全部由持久 Worker 执行，API 重启不丢任务。
- [ ] 重复 Job、Worker 崩溃和 Redis 重启不制造重复 Opinion。
- [ ] 状态转换、Checkpoint 和 Outbox 具备一致事务语义。
- [ ] SSE 在真实认证下工作，并具备断线恢复策略。
- [ ] 前后端契约由 OpenAPI 生成，不再维护漂移的手写副本。
- [ ] `pnpm lint`、类型检查、单测、集成测试、迁移测试、Smoke 和 Build 全绿。
- [ ] CI 不吞掉迁移、测试、Lint 或安全扫描失败。
- [ ] README 和 ARCHITECTURE 对安全能力、Worker 能力和实验能力的描述与代码一致。

---

## 8. 建议优先级

| 优先级 | Sprint | 原因 |
|---|---|---|
| 立即 | 10.1 Provider Security | 关闭密钥、SSRF 和外部调用旁路 |
| 立即 | 10.2 AuthN + Tenant | 生产安全边界的前提 |
| 高 | 10.3 AgentRuntime Contract | 可靠执行的设计前提 |
| 高 | 10.4 Worker Shadow Mode | 验证持久 Worker、崩溃恢复和并发语义 |
| 高 | 10.5 Lifecycle + Cutover | 在一致性基础上正式迁出 API 执行链路 |
| 中高 | 10.6 Contract/CI | 防止上述能力再次回归 |

在 10.1 和 10.2 完成前，应冻结以下工作：新增真实 Provider、新增外部工具、新增付费模型、扩大用户范围或部署到公网。在 10.5 Cutover 完成前，应把系统定位为单进程 MVP，不做多实例扩容承诺。

---

## 9. 最终评审结论

**结论：架构方向 Go，生产上线 No-Go。**

继续采用模块化单体、自研 Graph 编排和硬闸 Moderator 是合理选择；现阶段不需要推倒重写。整改应围绕安全边界、持久执行、一致性和契约治理展开，而不是继续叠加 Agent 功能。

推荐立即派发 Sprint 10.1，由独立 Review Agent 在实现后进行标准 Gate。10.1 未 Go 前，不并行修改 Provider Schema 的其他任务。
