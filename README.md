# PrismReview

> **多 Agent 智能评审中枢** — 让一群"专家"为你的方案多轮辩论，由 AI Moderator 收敛出一份可量化、可溯源的正式评审报告。

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/feather100/PrismReview)
[![Tests](https://img.shields.io/badge/tests-205%2F205%20green)](docs/coordination/Sprint_6.0_Full_Stack_Review_Report.md)
[![License](https://img.shields.io/badge/license-see%20LICENSE-blue)](LICENSE)
[![Language](https://img.shields.io/badge/language-TypeScript-3178c6)](https://www.typescriptlang.org/)
[![Stack](https://img.shields.io/badge/stack-NestJS%2010%20%2B%20Next.js%2014-000)](https://nodejs.org/)
[![Roadmap](https://img.shields.io/badge/P1%E2%80%93P5-done-success)](docs/roadmap/Sprint_9.0_Product_Roadmap_Reset.md)
[![Status](https://img.shields.io/badge/status-production--orange)](docs/coordination/ACTIVE_SPRINT.md)

---

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

### 三步起

```bash
# 1. 拉起基础设施（postgres / redis / minio）
docker compose up -d

# 2. 安装依赖并初始化数据库
pnpm install
cd apps/api && pnpm prisma:generate && pnpm prisma:migrate deploy && pnpm prisma:seed && cd ../..

# 3. 并行启动 web + api
pnpm dev
```

### 探活

```bash
# Web 存活（Next.js 默认 3000）
curl -f http://localhost:3000 && echo "web ok"

# 完整链路自愈（跑通 create→diagnose→start→report）
node scripts/smoke-runtime.js
```

启动后访问 **http://localhost:3000** 进入 Web 控制台。

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

详见 [LICENSE](LICENSE)。（仓库当前未内置 LICENSE 文件，请在首次发布前补充。）
