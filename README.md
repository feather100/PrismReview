# PrismReview

> **多 Agent 智能评审中枢** — 让一群"专家"为你的方案多轮辩论，由 AI Moderator 收敛出一份可量化、可溯源的正式评审报告。

[![CI](https://github.com/feather100/PrismReview/actions/workflows/ci.yml/badge.svg)](https://github.com/feather100/PrismReview/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178c6)](https://www.typescriptlang.org/)
[![Stack](https://img.shields.io/badge/stack-NestJS%2010%20%2B%20Next.js%2014-000)](https://nodejs.org/)
[![Roadmap](https://img.shields.io/badge/P1%E2%80%93P5-done-success)](docs/roadmap/Sprint_9.0_Product_Roadmap_Reset.md)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)](CONTRIBUTING.md)

---

**多 Agent 智能评审中枢** — 丢一份企业方案 / 架构设计 / 需求文档进去，多个专家 Agent 多轮辩论，AI Moderator 收敛出一份**可量化、可溯源、可审计**的正式评审报告。默认全 mock，**零 API Key 即可 30 秒跑通 demo**。

把一份企业方案、架构设计或需求文档丢给 PrismReview，它会：

1. **诊断**方案类型，推荐一组评审专家（CTO / CFO / PMO / Compliance / 用户代言人 …）；
2. 让多位 **Reviewer Agent** 在 `round-1` 并行给出结构化意见；
3. 进入 **多轮辩论（Multi-Round Debate）**，由 **Moderator**（mock 或真 LLM）判定是否继续、收敛或强制停止；
4. **4 种预设 workflow**（企业 / 代码审查 / 科研 / 论文）驱动不同评分权重与轮次策略；
5. 产出带 **加权多维评分 + 来源可溯源 + Markdown 导出** 的正式评审报告。

整套编排跑在一条**自研 graph 脊柱**上：显式 9 值状态机 + checkpoint/resume + 条件路由 + HITL 中断恢复。**默认全 mock，零 API Key 即可一键把 demo 跑通。**

---

## ✨ 特性

- 🗣️ **多轮辩论（Multi-Round Debate）** — 多个专家 Agent 跨轮次交锋，由 Moderator 逼近共识，而非一次性问答。
- 🕸️ **graph 编排脊柱（Graph Orchestration Spine）** — 9 值状态机 + checkpoint/resume + 条件路由，崩了能从最近节点续跑。
- 🤖 **真 LLM Moderator（env-gated）** — 支持 LongCat-2.0 / LM Studio / OpenAI 兼容协议；失败自动降级 mock。
- 🔧 **MCP 工具层（预留）** — 工具仅经 MCP 协议；A2A 反模式禁止（专家不互联）。
- 🔒 **RBAC + 审计** — 4 级平台角色（super_admin / enterprise_admin / department_admin / user）+ 全链路审计日志。
- 📊 **加权多维评分（Weighted Scoring）** — 4 种预设 workflow 驱动不同维度权重；评分快照落库可审计。
- 🧠 **蒸馏式 Memory** — Reviewer/Project 蒸馏 profile（非聊天历史）+ 多轮 rolling summary 压缩。
- 📝 **版本化 Prompt** — 4 层组装（base/task/context/format）+ 版本注册表 + 回滚。
- 🚀 **一键可跑（Zero-Config Mock）** — `docker compose up` + `pnpm dev` 即起，默认 mock provider，无需任何模型 API Key。
- 📄 **Markdown 导出（Markdown Export）** — 正式评审报告一键导出，含评分小节。
- 🔍 **来源可观测（Provenance Observability）** — `providerSummary` 五态来源追踪：`mock / lmstudio / openai_compatible / fallback_mock / failed`。
- 🛡️ **硬闸兜底（Hard-Gate Guardrails）** — `max_rounds` / `max_turns_per_reviewer` 收敛硬闸，杜绝无限讨论。
- 🧹 **内存安全** — 终态自动清理运行时状态；HITL 超时兜底（120s 自动恢复）。

---

## 🏗️ 架构

```
                         ┌──────────────────────────────────┐
       Browser ───────▶ │  apps/web   (Next.js 14)          │
                         │  React 18 + TypeScript            │
                         └───────────────┬──────────────────┘
                                         │  REST / SSE
                                         ▼
                         ┌──────────────────────────────────┐
                         │  apps/api   (NestJS 10)            │
                         │  ┌────────────────────────────┐  │
                         │  │  ReviewOrchestrator         │  │  ← graph 编排脊柱
                         │  │   · 9-state machine         │  │
                         │  │   · checkpoint / resume      │  │
                         │  │   · HITL interrupt/resume    │  │
                         │  │   · Mock / Llm Moderator     │  │
                         │  └─────────────┬──────────────┘  │
                         │  ModelAdapter (P2)  · WorkflowRegistry (P5) │
                         │  ScoringService (P5) · ReportingService (P5) │
                         │  PromptService (P3) · MemoryService (P3)    │
                         │  ToolRegistry (P4) · AuditInterceptor       │
                         │  PermissionsGuard (RBAC, Sprint 5.0)        │
                         └──────────────────┬───────────────┘
                                            │  providerSource
                    ┌───────────────────────┼───────────────────────┐
                    ▼                       ▼                       ▼
              [ mock ]            [ LM Studio ]          [ LongCat-2.0 ]
              (default)           (dev-only ≤3)          (env-gated)
                                                     [ OpenAI-compatible ]

   ── Infra (docker compose) ───────────────────────────────────────────────
   PostgreSQL 16  ·  Redis 7  ·  MinIO     （checkpoints / artifacts / cache）
```

> 模块化单体（modular monolith），不拆微服务。当前所有编排在 `apps/api` 进程内完成（~8,100 LOC）；`AgentRuntime` 独立 worker 进程抽取列入 P6 规划，接口已预留。

---

## 🚀 快速开始

### 前置条件

- **Docker Desktop**（拉起 PostgreSQL / Redis / MinIO）
- **Node.js 22 LTS**（引擎要求 `>= 20`，22 已验证）
- **pnpm 9**（`corepack enable` 或 `npm i -g pnpm@9`）

### 30 秒起

```bash
# 1. 拉起基础设施（postgres / redis / minio）
docker compose up -d

# 2. 安装依赖并初始化数据库
pnpm install
cd apps/api && pnpm prisma:generate && pnpm prisma:migrate deploy && pnpm prisma:seed && cd ../..

# 3. 并行启动 web + api
pnpm dev
```

打开 **http://localhost:3000**，点击 **"创建 Mock 演示评审"**，一条完整的 create → diagnose → multi-round debate → report 链路就跑通了，全程纯 mock、不需要任何 API Key。不点击也行，用脚本一键：

```bash
node scripts/setup-demo-review.js          # 纯 mock，最快验证
node scripts/setup-demo-review.js --with-runner   # 额外落库 opinions，Report 报告更丰富
```

> 完整链路自愈可被 `node scripts/smoke-runtime.js` 验证。详见 [docs/demo/MVP_Demo_Runbook.md](docs/demo/MVP_Demo_Runbook.md)。

### 真实 LLM 模式（可选，显式 env 启用）

```bash
cd apps/api
ALLOW_EXTERNAL_MODEL_CALLS=true MODEL_PROVIDER=longcat \
  MODEL_BASE_URL=https://api.longcat.chat/openai/v1 \
  MODEL_NAME=LongCat-2.0 MODEL_API_KEY=<your-key> node dist/main.js
```

支持的 provider：`longcat` / `lmstudio`（本地）/ `openai_compatible`。**Moderator 也可切换为真 LLM**（追加 `MODERATOR_PROVIDER=llm`），失败自动降级 mock。默认始终 mock，默认安全。

---

## 🎬 Demo 路线

两种开箱即用的演示路径（均由 `scripts/setup-demo-review.js` 驱动，无需手写请求）：

| 路线 | 命令 | 说明 | Report 来源 |
|------|------|------|-------------|
| **Route A · 纯 mock** | `node scripts/setup-demo-review.js` | 默认 mock provider，零 Key 即可跑通主链路 | `mock` |
| **Route B · runner + DB** | `node scripts/setup-demo-review.js --with-runner` | 额外调用 `run-agent-turns-for-review.js` 落库 opinions | `db_opinions` |

脚本会打印 Review ID 与可访问链接：

```
  Diagnosis:   http://localhost:3000/reviews/{id}
  Meeting:     http://localhost:3000/reviews/{id}/meeting
  Report:      http://localhost:3000/reviews/{id}/report
  SSE Stream:  http://localhost:4000/api/reviews/{id}/meeting/stream
  Route:       A (pure mock) | B (runner + DB opinions)
```

### 真实 LLM 模式（可选）

显式 env 启用真实模型（默认始终 mock）：

```bash
cd apps/api
ALLOW_EXTERNAL_MODEL_CALLS=true \
MODEL_PROVIDER=longcat \
MODEL_BASE_URL=https://api.longcat.chat/openai/v1 \
MODEL_NAME=LongCat-2.0 \
MODEL_API_KEY=<your-key> \
node dist/main.js
```

支持的 provider：`longcat`（LongCat-2.0）/ `lmstudio`（本地）/ `openai_compatible`（任意兼容端点）。
Moderator 也可切换为真 LLM：追加 `MODERATOR_PROVIDER=llm`。失败自动降级 mock。

---

## 🤔 设计思路（为什么这样做）

> 以下节选自 [docs/roadmap/Sprint_9.0_Product_Roadmap_Reset.md](docs/roadmap/Sprint_9.0_Product_Roadmap_Reset.md) §2 三项承重决策。

- **为什么选 9 值状态机而不是自由 DAG？** 多轮辩论的核心难题是"收敛判定"。自由 DAG 一旦加入 HITL 中断 / Moderator 条件路由 / checkpoint resume，路径组合会爆炸、很难审计哪条分支做了什么决策。9 值状态机把全部生命周期收缩成一张**可验证、可序列化、可回放**的显式图，配合 `postgres-checkpointer` 就能在任何节点崩溃后从 checkpoint 续跑，而不是整场重跑。
- **为什么默认全 mock？** PrismReview 是**编排层**而不是模型层。评审的质量上限取决于模型，但编排的可靠性取决于工程。把模型调用抽到 `provider-factory` + `model-adapter` 两个接口后面，所有编排逻辑（状态机 / Moderator / Memory / 评分）就能在**零 Key、零成本**的前提下快速迭代与测试。真 LLM 一行 env 就能接。
- **为什么禁止 A2A（Agent 间直接互联）？** 如果让专家 Agent 彼此直接聊天，Moderator 无法审计每一步决策，收敛也无法保证。本项目采用**"Moderator 中心化"**：专家只向 Moderator 提交结构化 opinion，由 Moderator（mock 或真 LLM）挑人辩论、框定冲突、提出终止。硬闸（`max_rounds`、`max_turns_per_reviewer`）由代码强制、LLM 不可覆盖。

### 与现有方案对比

| 维度 | PrismReview | ChatGPT 直接问 | 传统评审会议 | CrewAI / LangGraph |
|------|-------------|----------------|--------------|---------------------|
| 评审模式 | 多 Agent **多轮辩论** + Moderator 收敛 | 单模型、单轮问答 | 真人多轮、高成本 | 可编排，但需自建 Moderator |
| 产出 | 结构化报告 + 加权评分 + Markdown 导出 | 自由文本，难量化 | 会议纪要，风格因人而异 | 需自行组装 |
| 溯源 | 每条意见溯源到 Agent + 模型 + provider 类型 | 无 | 难 | 框架依赖 |
| 成本 | 默认零（mock） | 按 token 计费 | 人力 $$$ | 需自建可观测 |
| 停机恢复 | checkpoint → 任意节点续跑 | 无 | 重开一场 | LangGraph 支持，CrewA​I 弱 |
| 工程定位 | 编排脊柱（own orchestration） | 端点 | 流程 | 框架 |

---

## 📚 文档索引

| 文档 | 内容 |
|------|------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 系统架构、编排脊柱、Moderator、数据模型、观测性 |
| [docs/roadmap/Sprint_9.0_Product_Roadmap_Reset.md](docs/roadmap/Sprint_9.0_Product_Roadmap_Reset.md) | 架构决策锁定（三项承重决策）+ P0–P6 路线图 |
| [docs/coordination/ACTIVE_SPRINT.md](docs/coordination/ACTIVE_SPRINT.md) | 当前 Sprint 与 Gate 记录 |
| [docs/coordination/Sprint_6.0_Full_Stack_Review_Report.md](docs/coordination/Sprint_6.0_Full_Stack_Review_Report.md) | 全栈审查报告（205 测试场景 + P1/P2 修复） |
| [docs/demo/MVP_Demo_Runbook.md](docs/demo/MVP_Demo_Runbook.md) | MVP Demo 操作手册 |
| [docs/coordination/AGENT_COORDINATION_PROTOCOL.md](docs/coordination/AGENT_COORDINATION_PROTOCOL.md) | Agent 协作协议（标准 Gate / 快速 Gate） |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献指南与开发环境 |

---

## 🗺️ 路线图进度

| 阶段 | 范围 | 状态 |
|------|------|------|
| **P0** | MVP mock demo：1 轮 + 报告 + Markdown 导出 | ✅ 完成 |
| **P1** | 编排脊柱：9 状态机 + checkpoint + 幂等 + opinion schema + mock Moderator + round-2 mock debater | ✅ 完成（Sprint 9.0–9.5b） |
| **P2** | Model Adapter 泛化 + 真 LLM 路由（LongCat / LM Studio / OpenAI 兼容）+ 质量评测 | ✅ 完成（Sprint 2.1 / 2.2 / 4.0） |
| **P3** | 版本化 Prompt 注册表 + Reviewer/Project Memory（蒸馏 profile）+ Rolling Summary | ✅ 完成（Sprint 5.1） |
| **P4** | MCP 工具层（预留）+ HITL 中断/恢复 + 真 LLM Moderator + 人类回合覆盖 | ✅ 完成（Sprint 5.2） |
| **P5** | 4 种预设 workflow + 加权多维评分 + 报告生成器 + 内存安全加固 | ✅ 完成（Sprint 5.3） |
| **P6** | 规模化 + 生产硬化：AgentRuntime worker 进程 + OTel 全链路 + 成本看板 + 多租户 | 🔜 下一阶段 |

---

## 🤝 贡献

欢迎 Issue / PR。开发环境搭建、分支与提交约定、标准 Gate 流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 📄 许可证

[MIT](LICENSE) © 2026 feather100。

是否觉得 PrismReview 有意思？欢迎 **Star ⭐** 持续关注，或直接到 [Discussions](https://github.com/feather100/PrismReview/discussions) 打个招呼 / 提出想要的功能。

---

### 推荐 GitHub Topics

如果你正准备分享这个项目，把这些 topic 加到仓库 About 里能显著提升搜索曝光：`multi-agent`, `code-review`, `llm`, `nestjs`, `nextjs`, `ai-orchestration`, `debate`, `rag`.
