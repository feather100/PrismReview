# PrismReview 代码审查计划（Review Plan）

> 生成日期：2026-07-16
> 作者：WorkBuddy 审查会话
> 承接：07-15 `Codebase_Audit_Report.md`（基线已建，本计划聚焦真实薄弱点，不重复已有结论）
> 目标：给出一份可执行、分阶段、带优先级的审查路线，最终独立复核报告区别于已有 audit

---

## 0. 项目现状速览（审查前事实基线）

| 维度 | 现状 |
|------|------|
| 架构 | pnpm + turbo monorepo，模块化单体（不拆微服务） |
| `apps/api` | NestJS 10 + Prisma + PostgreSQL 16，约 8,100 LOC，端口 4000，核心编排层 |
| `apps/web` | Next.js 14 + React 18 + TypeScript，端口 3000；路由：reviews / admin / audit / knowledge / prompts / roles / workflows |
| `apps/worker` | Python Celery（parse / embed / summarize / export / diagnose / run_agent_turn）——**当前未与 api 接线，孤立实现** |
| 编排脊柱 | `apps/api/src/modules/reviews/orchestrator/` 9 文件，约 1,541 LOC：`review-orchestrator`(646) / `llm-moderator`(275) / `moderator`(213) / `graph-runtime`(170) + `postgres-checkpointer` / `idempotency` / `hard-gates` / `opinion` / `index` |
| 数据模型 | Prisma **23 个 model**（Review / ReviewTurn / ReviewOpinion / Report / ActionItem / AuditLog / BusinessEvent / ReviewCheckpoint / ModeratorDecision / QualityReport / ReviewerMemory / ProjectMemory / LlmProvider / PromptTemplateRecord / ToolCallRequest / ToolDefinitionRecord / Tenant / Department / User / AgentRole / AgentRoleVersion / KnowledgeDocument / KnowledgeChunk） |
| 测试 | **无任何正式单元测试**（`*.test.ts` 仅存在于 node_modules）；只有 16 个 `scripts/*.js`（smoke / verify / spike / e2e / setup）作为唯一回归网 |
| 安全 | 默认全 mock；RBAC = `JwtAuthGuard`(mock 注入 user) + `PermissionsGuard`(OR 语义) + `AuditInterceptor`；Provider Key AES-256-GCM 加密 |
| 已补齐项 | LICENSE ✅ / `.env.example` ✅ / `.github/workflows/ci.yml` ✅ / `docs/coordination/Codebase_Audit_Report.md` ✅ / `docs/roadmap/Next_Steps.md` ✅ |

### 已有 audit（07-15）关键结论
- orchestrator 与 RBAC 是最强资产，**S-A-F-E，无 P0/P1**。
- 遗留 P2：
  1. `QueueService` 为内存数组（BullMQ 死依赖未接线）
  2. `@RequirePermissions` 仅覆盖 `POST /reviews`，其余端点裸奔
  3. mock `JwtAuthGuard` 注入真实 user 形态，安全态势 README 需讲清
  4. `MODEL_BASE_URL` 未来租户可控时是 SSRF 面
  5. 无单测

> 本计划**不再重复**上述已确认结论，阶段 1/2 以"独立验证 + 深挖竞态/越权"为主。

---

## 1. 审查阶段总览

| 阶段 | 内容 | 预估 | 优先级 |
|------|------|------|--------|
| 阶段 0 | 校准基线（tsc / smoke / 秘钥扫描） | 0.5 天 | 🔴 最高 |
| 阶段 1 | 核心编排深审（状态机 / checkpoint / HITL / moderator / 幂等） | 1.5 天 | 🔴 最高 |
| 阶段 2 | 安全与多租户边界（RBAC 覆盖 / 越权面 / Key 管理 / SSRF） | 1 天 | 🟡 中 |
| 阶段 3 | 测试体系补强（引入 Jest / 核心逻辑单测 / CI 接入） | 1–2 天 | 🟠 高 |
| 阶段 4 | 卫生与债务清理（worker 定性 / BullMQ 死依赖 / 调试产物） | 0.5 天 | 🟢 低 |

**总计预估**：约 4.5–6 人日。

---

## 2. 阶段 0 · 校准基线

目标：确认"声称通过"是否真的通过，避免在幻觉基线上审查。

- [ ] `pnpm install`
- [ ] `tsc --noEmit` 分别在 `apps/api` 与 `apps/web` 跑通，确认 0 error
- [ ] `docker compose up -d` 拉起 PG / Redis / MinIO
- [ ] 全量执行 `scripts/*.js`（16 个），逐一记录 pass / fail / 超时
- [ ] 秘钥扫描复核：
  ```bash
  git grep -nE "sk-[A-Za-z0-9]{20}|Bearer [A-Za-z0-9._-]{20}|AIza[0-9A-Za-z_-]{20}"
  ```
- **产出**：`基线快照.md`（tsc 结果 / smoke 通过率 / 秘钥扫描命中）——作为后续判断的地基。

---

## 3. 阶段 1 · 核心编排深审（最高价值）

重点目录：`apps/api/src/modules/reviews/orchestrator/`

- [ ] **9 值状态机完整性**（`graph-runtime.ts`）
  - `route()` 是否为纯函数（无副作用、可重放）
  - 终态是否为闭集，`isTerminalStatus` 是否单一真相源
  - 非法转移是否兜底、不会卡死
- [ ] **checkpoint / resume 健壮性**（`postgres-checkpointer.ts`）
  - 崩溃后能否从最近节点续跑
  - 序列化是否完整（opinion / round / decision 是否都落库）
- [ ] **HITL 中断/恢复 + 120s 超时**（`review-orchestrator.ts` + `graph-runtime.ts`）
  - `interrupted → running` 回路有无竞态 / 重复恢复
  - 超时兜底是否真的自动恢复
- [ ] **Moderator 收敛与硬闸**（`moderator.ts` / `llm-moderator.ts` / `hard-gates.ts`）
  - `max_rounds` / `max_turns_per_reviewer` 是否代码强制、LLM 不可覆盖
  - mock moderator 与 llm moderator 决策路径是否一致
- [ ] **幂等**（`idempotency.ts`）
  - 幂等键是否真正防重放（并发 start / 重复 human-turn）
- **产出**：编排层专项复核结论 + 一张状态机转移图（mermaid / ASCII）。

---

## 4. 阶段 2 · 安全与多租户边界

- [ ] **`@RequirePermissions` 覆盖缺口清单**
  - 通读 `ReviewsController` / `LlmProviderController` 等，列出所有未注解端点
  - 评估裸奔端点的实际越权面（租户隔离是否兜底）
- [ ] **租户隔离验证**
  - 所有 Prisma 查询是否强制带 `tenantId`（grep `where:` 不含 tenantId 的查询）
  - 因 mock guard 固定 tenantId，需人工构造越权场景验证
- [ ] **Provider Key 管理**
  - AES-256-GCM 加解密路径核实
  - 确认 key 不落日志（`AuditInterceptor` scrub）、不返前端（response DTO 屏蔽）
- [ ] **SSRF / CORS / env-gate**
  - `MODEL_BASE_URL` 是否可被租户层设置（当前仅 ops env）
  - CORS 是否 `WEB_ORIGIN || localhost`，缺 allow-list
  - 真 LLM 调用是否 fail-closed（`ALLOW_EXTERNAL_MODEL_CALLS` 门控）
- **产出**：RBAC 覆盖矩阵 + 越权风险清单。

---

## 5. 阶段 3 · 测试体系补强（最大结构性缺口）

项目零单测是最高优先级债务。

- [ ] 引入 Jest（api），web 测试策略另定（Vitest / Playwright 可选）
- [ ] 优先为**纯函数 / 决策逻辑**补单测：
  - 状态机 `route()`（所有合法 + 非法转移）
  - moderator 决策（continue / converge / stop）
  - 幂等键（`idempotency.ts`）
  - `hard-gates.ts`（max_rounds / max_turns 边界）
  - `ScoringService` 加权多维评分
- [ ] 把现有 `scripts/*.js` 中稳定的 smoke / verify 纳入 CI（`.github/workflows/ci.yml` 已存在，扩展即可）
- **产出**：核心编排逻辑单测覆盖 + CI 单测门禁。

---

## 6. 阶段 4 · 卫生与债务清理

- [ ] **`apps/worker` 定性**
  - 是否 P6 预留 / 并行实现 / 遗留死码
  - **结论写入 README**：当前未接线，贡献者勿误判为生产路径
- [ ] **BullMQ 死依赖**
  - `apps/api/package.json` 声明 `@nestjs/bullmq` + `bullmq`，但 `BullModule` 从未 import
  - 要么 P6 接线，要么移除死依赖
- [ ] **根目录调试产物**
  - `_diag.json` / `_r1.json` / `_rid.txt` / `fix_uuid.js` / `fix_uuid2.js` / `setup-test-review.js`
  - 已 gitignore，但物理文件仍在，确认是否清理
- **产出**：债务清单 + 处理建议（标记 / 删除 / 保留）。

---

## 7. 交付物与里程碑

| 里程碑 | 交付物 | 完成判据 |
|--------|--------|----------|
| M0 | `基线快照.md` | tsc 0 error + smoke 通过率 + 秘钥扫描结果 |
| M1 | `orchestrator 复核报告` | 状态机图 + 5 项深审结论 |
| M2 | `安全边界报告` | RBAC 矩阵 + 越权清单 |
| M3 | 单测 PR | 核心逻辑有测试 + CI 绿 |
| M4 | `债务清单` | worker/bullmq/调试产物处理建议 |

---

## 8. 红线约束（沿用项目约定，审查中不可违反）

1. 不提交真实密钥（环境变量只写占位 `sk-xxxx`）
2. 默认 mock；真模型调用仅显式 env 门控，且有 dev-only 数量上限
3. 不 `--force` push，不绕过 Gate 流程
4. 不在 `node_modules` / `data/` / `.workbuddy/` / `.reasonix/` 做 git 操作
5. 改 Prisma schema / 状态机 / 模型调用 / 前端 / 依赖时，跑完整验证再继续
6. 不引入 bcrypt 做真实密码哈希（约定 `mock_password_hash` 占位）
7. A2A 反模式禁止：专家 Agent 之间不直接互联，只经 Moderator
8. Memory 只存蒸馏 profile，绝不存聊天历史原文

---

## 9. 下一步

- 本计划确认后，建议从 **阶段 0 + 阶段 1** 同步启动（最快暴露心脏组件问题）。
- 每完成一个阶段，更新对应 M* 交付物，并在 `docs/coordination/ACTIVE_SPRINT.md` 记录 Gate 进度。
- 如要展开执行，可追加 `TaskCreate` 拆分到具体文件级任务。

---

## 10. 执行进度（2026-07-16 已执行完毕）

> 全部阶段已完成。详细结论见 `docs/coordination/Review_2026-07-16_Report.md`。

| 里程碑 | 状态 | 关键产出 |
|--------|------|----------|
| M0 基线 | ✅ | api+web tsc 0 error；秘钥扫描 0 命中；更正"无单测"过时结论（已有 46→53 测试） |
| M1 编排深审 | ✅ | F1 graph边冗余 / F2 HITL崩溃安全 / F3 死边 / F4 moderator冲突收敛语义（均 P2，**已由 Claude Code 批次闭环**） |
| M2 安全边界 | ✅ | **F5 SSRF 已修复** + **F6 lmstudio 白名单已修复** + **F7 provider 控制器 RBAC 已修复**（defense 模块经核查不存在）；F8/F9 列 P6 |
| M3 测试补强 | ✅ | 新增 `moderator.decide.spec.ts`（7测试）；CI 加 `unit` job；turbo.json 修复 |
| M4 债务清理 | ✅ | worker 孤立（README 已标注 P6 零接线）/ BullMQ 死依赖（已从 package.json 移除）/ 调试产物 —— 均已闭环 |

**WorkBuddy 落地修复**：SSRF guard（`crypto.ts` `assertPublicUrl`）、provider 白名单加 `lmstudio`、Jest 接入 CI、`turbo.json` `tasks` 键。验证：tsc 0 error + jest 53 passed。

**Claude Code 修复批次（2026-07-16 13:36，已闭环）**：经 WorkBuddy 提示词驱动，执行 P1–P5。改动 6 文件（`review-orchestrator.ts` / `llm-provider.controller.ts` / `graph-runtime.ts` / `moderator.ts` / `package.json` / `README.md`）：
- P1(F2) HITL 启动恢复：`onModuleInit` async + `recoverInterruptedReviews()` 重挂 120s timer，幂等。
- P2(F7) `llm-provider.controller` 补 `@RequirePermissions`（admin.access / role.read）。
- P3(F1/F3) 删除 `Graph.edges`/`buildGraph` 死边 + README 降级为"状态机编排脊柱"。
- P4(F4) `moderator.ts` 高危冲突分支补 `logger.warn`（行为保留）。
- P5 移除未接线 `bullmq`/`@nestjs/bullmq` + README 标注 worker P6 孤立。

**WorkBuddy 实地复核**：磁盘改动与红线全部属实且通过 —— api/web tsc 0 error、jest **53/53 passed**、SSRF guard 未触碰、CI 结构未破坏。仅余 F8（多租户越权端到端测试）、F9（`LLM_SECRET` 生产强制）两项 P6 hardening 建议。详见 `Review_2026-07-16_Report.md` §4。
