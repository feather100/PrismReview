# Sprint 9.0 — Architecture Refactor Kickoff（Product Roadmap Reset）

> **角色**：workbuddy-docs（纯文档，fast-gate）
> **模式**：快速 Gate（协议 §7.1 — 纯文档、不改 schema/状态机/模型/前端/依赖）
> **基线**：Sprint 8.3 Go（MVP Demo RC 完成，`9dbcf97`）+ `docs/demo/MVP_Demo_Runbook.md` 现状能力锚点
> **日期**：2026-07-13
> **Owner**：workbuddy-docs
> **目的**：把已锁定的三项承重架构决策固化为单一事实来源（architecture lock + 6 阶段路线图），供后续 9.1+ 代码 Sprint 遵循。本 Sprint **只写文档，不实现**。

---

## 1. 目的与背景

### 1.1 MVP RC 已完成

截至 Sprint 8.3（Gate: Go，commit `9dbcf97`），PrismReview MVP Demo RC 主线已收口，稳定能力见 `MVP_RELEASE_SNAPSHOT.md` 与 `MVP_Demo_Runbook.md`：

- 页面：首页 / 我的评审 / 新建评审 / 诊断 / 会议室 / 报告页。
- 主链路：默认 Mock Demo；Queue + agent turns + meeting complete；Report API 支持 `db_opinions` 与 `mock_fallback`；`providerSummary` 闭环；LM Studio dev-only capped ≤3；`openai_compatible`/付费 API 未启用。
- 红线（冻结态）：默认 mock、真模型仅显式 env + Gate、不 `--force`、不未经 Gate 改 schema。

### 1.2 启动架构重构

MVP 验证了"多专家评审"的核心价值，但其编排仍是**隐式线性流**（create → diagnose → run turns → summarize → report）。为演进到愿景"**AI 多专家评审系统（Multi-Agent Review Board）**"——多轮辩论、Moderator 控制流程、可插拔模型与工具——必须先建立**显式编排脊柱**与**架构护栏**。

本次 Sprint（9.0）**不写代码**：它把 Codex（总协调）与用户已完成的架构重构讨论锁定为三项承重决策，固化为后续 9.1+ 代码 Sprint 的单一事实来源。所有实现决策推迟到对应 phase，并各自走标准/独立 Gate。

### 1.3 红线全部保留

本重构**不削弱任何 MVP 红线**：
- 默认 mock（含 Moderator 默认 mock）。
- 真模型仅显式 env + Gate 后启用。
- 不 `--force` 推送。
- 不经 Gate 不动 Prisma schema / 状态机实现。

---

## 2. 已锁定决策（三项，原样写入，结论不可改写）

> 以下三项决策由 Codex + 用户讨论锁定，**必须原样遵循，后续 Sprint 不得改写结论**。任何 phase 的实现都以此为准，偏离须回到本文件与 Codex 复核。

### 决策 1 — 编排栈：TS 端到端 + 自研最小 graph runtime

- **范式**：**Graph 脊柱 + Code 叶子**。
  - 脊柱用 **LangGraph 范式**（显式状态机 + checkpoint + HITL 中断 + 条件路由），但**自研最小 TS graph runtime**（节点 = 函数、边含条件路由、State 对象、Checkpointer 接口，Postgres/Redis 后端），**不引入 `@langchain/langgraph` 全量依赖**。
  - 若自研过重，退路是把 `@langchain/langgraph` 隔离在一个 `Orchestrator` 接口后、可整体替换——但**默认走自研**。
- **叶子用普通代码**：一个 reviewer turn = 组 prompt + 调模型 + 解析 + 落库，不做 50 节点图。
- **不取 DeepAgents 做地基**：其 plan-and-execute 自主性与"专家禁止自由聊天、Moderator 严格控制流程"相悖。可借其分层子任务模式给工具密集型 sub-agent，不做核心。
- **CrewAI / Google ADK**：模式可参考，框架不取（Python 栈 / 想 own 编排 / checkpoint 弱 / 长流程不老练）。

### 决策 2 — Moderator：LLM Moderator Agent + 硬闸脊柱（"LLM 在循环里，代码在边界上"）

- **Moderator 是 LLM Agent**：判断（挑谁辩论、框定冲突、写汇总叙事、写报告）、终止提议。
- **硬闸（代码强制，LLM 不可覆盖）**：`max_rounds` / `max_tokens_per_review` / `max_cost_per_review` / `max_turns_per_reviewer`。
- **收敛 override**：`min_rounds` 后若收敛分低于阈值，系统可强停；LLM 提反对理由须过 sanity check 才放行。
- **决策审计**：每条 Moderator 决策 + 推理 + 校验结果落库。
- **可测试性 mitigation**：golden-path 测试（固定 seed → 期望决策模式）+ 决策日志 + v1 shadow 模式（LLM 跑、规则层可 veto，信任建立后逐步放开）。
- **P1 用 mock Moderator**（默认 mock 红线）；真 LLM Moderator 在 P2/P3 模型层就绪后接，仍需显式 env + Gate。

### 决策 3 — 重构入口：P1 编排脊柱先行

- 重构从 **P1 编排脊柱** 开始，先把现有隐式线性流抬升到显式状态机 + checkpoint + 幂等 + 结构化 opinion schema + mock Moderator + round-2 mock debater；模型泛化、Prompt/Memory/RAG、Tool/HITL、Workflow/评分、规模化生产硬化依次在 P2–P6 展开。
- 理由：脊柱是后续所有 phase 的地基；先固化编排与护栏，再往上叠加能力，避免"能力先行、编排后补"导致的返工。

---

## 3. 编排范式：Graph 脊柱 + Code 叶子

### 3.1 为什么是 Graph 脊柱

多专家评审天然是**有状态、可分支、可中断、可恢复**的流程：
- 每轮 reviewer 发言后，Moderator 决定"收敛 / 继续辩论 / 升级冲突 / 终止"。
- 中途崩溃（进程挂掉、LLM 超时）必须能从最近 checkpoint resume，而不是整场重跑。
- 人工干预（HITL）需要在特定节点暂停等待外部输入。

LangGraph 范式（显式状态机 + checkpoint + HITL 中断 + 条件路由）正好覆盖这些诉求，但其**全量依赖**对 PrismReview 过重——我们需要的是"范式"而非"框架"。

### 3.2 自研最小 graph runtime（TS）

只实现够用的内核，接口对齐 LangGraph 心智模型，**不**引入 `@langchain/langgraph`：

| 概念 | 自研实现 | 后端 |
|------|----------|------|
| 节点（Node） | 普通 TS 函数 `(state) => Partial<State>` | — |
| 边（Edge） | 静态边 + **条件路由**（`(state) => nextNodeId`） | — |
| State 对象 | 强类型 `ReviewState`（review / turns / rounds / moderator 决策） | Postgres 持久化 |
| Checkpointer | `Checkpointer` 接口：`save(state, nodeId)` / `load(reviewId)` | **Postgres**（Redis 可选缓存层） |

**退路条款**：若自研在 9.x 中暴露出过重/不稳，允许把 `@langchain/langgraph` 隔离进 `Orchestrator` 接口背后做整体替换——但 9.0 锁定的**默认路径是自研**。

### 3.3 为什么不是 DeepAgents / CrewAI / Google ADK

| 候选 | 结论 | 理由 |
|------|------|------|
| **DeepAgents** | **不做地基** | plan-and-execute 自主性，与"专家禁止自由聊天、Moderator 严格控制流程"相悖；可借其分层子任务模式给**工具密集型 sub-agent**（如需要查 KB 的 reviewer），但核心编排不用它 |
| **CrewAI** | **不取框架** | Python 栈，与 TS 端到端诉求冲突；checkpoint 弱、长流程不老练 |
| **Google ADK** | **不取框架** | 同上；且想 own 编排、不愿被框架绑定 |

### 3.4 Code 叶子

- 一个 reviewer turn 的叶子实现就是**普通代码**：组 prompt → 调 `ModelAdapter` → 解析 → 落库。
- 不做"50 节点图"——专家内部逻辑是函数，不是子图。图只用于**编排层**（谁在何时发言、何时辩论、何时收敛）。

---

## 4. Moderator 设计：LLM Agent + 硬闸脊柱

> 核心命题：**LLM 在循环里，代码在边界上。**

### 4.1 Moderator 是 LLM Agent（决策权）

Moderator 负责评审会内的"软决策"：
- 挑谁辩论（哪两个专家意见冲突最值得深挖）。
- 框定冲突（给辩论定范围，防止跑题）。
- 写汇总叙事（每轮 `summarized` 的叙事）。
- 写最终报告（P5 前由 `ReportingService` 组装，Moderator 提供叙事与结论建议）。
- 提终止提议（"已收敛，建议 completed"）。

### 4.2 硬闸（代码强制，LLM 不可覆盖）

| 硬闸 | 作用 | 越界行为 |
|------|------|----------|
| `max_rounds` | 评审会最大轮次 | 到达即强停，不论 Moderator 是否想继续 |
| `max_tokens_per_review` | 单场评审 token 上限 | 超限即截断后续 turn 调度 |
| `max_cost_per_review` | 单场评审成本上限 | 超预算即停（P2 成本计量就绪后生效） |
| `max_turns_per_reviewer` | 单专家最大发言数 | 超过不再派发该专家 turn（泛化 `MODEL_PILOT_MAX_ROLES=3` 硬 cap） |

> 这些闸由**代码保证**，LLM 输出无法覆盖——这是"避免无限讨论"的工程约束，不是 prompt 工程（见 §5 设计 rationale #2）。

### 4.3 收敛 override

- 设 `min_rounds`：在此之前即使 Moderator 想停，也须跑满至少 `min_rounds` 轮，避免过早收敛。
- `min_rounds` 之后，若**收敛分**低于阈值（专家意见仍发散），系统可**强停**并标记 `aborted`/需人工复核，而非无休止辩论。
- 若 LLM Moderator 对强停提**反对理由**，须过 **sanity check**（如：反对理由非空、引用了具体未决冲突）才放行继续；否则维持系统强停。

### 4.4 决策审计

- 每条 Moderator 决策（含：选谁辩论、收敛/继续、终止提议、反对 sanity 结果）连同**推理**与**校验结果**落库。
- 审计表是 v1 shadow 模式（§4.5）与可观测性的锚点。

### 4.5 可测试性 mitigation（信任建立路径）

| 手段 | 说明 |
|------|------|
| golden-path 测试 | 固定 seed → 期望决策模式（确定性回归，验证"给定状态，Moderator/规则应做 X"） |
| 决策日志 | 每条决策 + 推理 + 校验落库，事后可回放核对 |
| v1 shadow 模式 | LLM Moderator 跑，规则层可 **veto**；信任建立后逐步放开 LLM 自主度 |

### 4.6 P1 默认 mock Moderator

- P1 用 **mock Moderator**：按预置规则（轮次计数 + 硬闸）推进流程，不调真实 LLM，保证默认 mock 红线。
- 真 LLM Moderator 在 **P2/P3**（模型层 + Memory/Prompt 就绪）后接入，仍须显式 env + Gate。

---

## 5. 系统架构：模块化单体 + AgentRuntime worker

### 5.1 带逃生舱的模块化单体（不上微服务）

- **单体优先**：9 个有界 NestJS 模块，模块间只通过**公共接口**通信，不共享内部状态。
- **唯一现在就抽独立进程的是 `AgentRuntime` worker**：LLM 调用 30–40s/turn，不能阻塞 API 进程；复用现有 Runner/Queue 模式（见 §9 映射）。
- **逃生舱**：每个模块的接口都干净定义，未来任一模块可单独抽成服务而**不重写**其他模块。

### 5.2 九个有界模块

| 模块 | 职责 | 进程 |
|------|------|------|
| `ReviewOrchestrator` | graph 脊柱 + Moderator 逻辑（编排核心） | API 进程 |
| `AgentRuntime` | reviewer turn 执行 + tool loop | **独立 worker 进程** |
| `ModelAdapter` | provider 抽象 + guard（统一模型入口） | 被 AgentRuntime 调用 |
| `MemoryService` | reviewer/project 蒸馏 profile 存储 | API 进程 |
| `KnowledgeService` | KB / RAG 接入（via tool） | API 进程 |
| `PromptService` | 版本化 prompt 注册表 | API 进程 |
| `ArtifactService` | 报告产物（Markdown 等） | API 进程 |
| `WorkflowService` | 可配置 workflow（P5） | API 进程 |
| `ReportingService` | 报告生成与聚合 | API 进程 |

### 5.3 进程边界与数据流（P1 视角）

```
┌─────────────── API 进程 ───────────────┐        ┌──── AgentRuntime worker ────┐
│ ReviewOrchestrator (graph + Moderator)  │ 派发   │ reviewer turn 执行           │
│      │ 节点转移 → Checkpointer → Postgres│──────▶│   → ModelAdapter → 解析 → 落库 │
│      │                                   │◀──────│  tool loop (P4)              │
│ ReportingService / ArtifactService      │ 读库   └─────────────────────────────┘
│ MemoryService / PromptService / ...     │
└─────────────────────────────────────────┘
```
- API 进程不被 LLM 调用阻塞；AgentRuntime worker 异步执行 turn，状态经 Checkpointer 落 Postgres，API 从 DB 读进度（沿用 SSE 从 DB 读的模式）。

---

## 6. 设计 rationale：架构师视角的刻意分歧

> 这些是**主动选择**而非妥协。后续 Sprint 若想偏离，须在本文件登记并说明理由。

1. **Moderator 是带硬闸的 LLM Agent，不是自由 Agent** —— 决策权在 LLM，但边界在代码。
2. **避免无限讨论是工程约束问题**（`max_rounds` / 预算 / 收敛分硬闸），**不是 prompt 问题** —— 不靠"请尽量简洁"来收敛。
3. **不吞框架，拿范式**；自研 graph runtime —— 要 LangGraph 的心智，不要它的体积与绑定。
4. **Reviewer Memory 是蒸馏 profile，不是聊天历史** —— 存"这个专家擅长什么、偏见是什么"，不存"他上周说了什么"。
5. **模块化单体 + 一个 worker 进程，不上微服务** —— 9 模块有界但同进程（除 AgentRuntime），避免过度工程。
6. **A2A 是本系统反模式**（设计禁止 reviewer 互联），只采纳 **MCP for tools** —— 专家之间不直接通信，所有协作经 Moderator 与 graph 脊柱；工具通过 MCP 接入。

---

## 7. 模型路由与成本控制

### 7.1 ModelAdapter 统一接口

- 所有模型调用经 `ModelAdapter`：屏蔽 provider 差异，统一 `complete(prompt, opts) → ParsedOpinion`。
- 现 `ALLOW_EXTERNAL_MODEL_CALLS` + 5 态 `providerSource` 的 guard 逻辑泛化为 `ModelAdapter` 内的 guard + 可观测出口（见 §9）。

### 7.2 OpenAI 兼容一招吃 6 家

- 统一走 **OpenAI-compatible** 协议：LM Studio（本地）、OpenAI、Azure、Anthropic（兼容层）、本地 vLLM、任意兼容端点，共用一个适配实现。
- 不每家写一个 SDK 集成；新增 provider = 加一条 endpoint 配置，而非加一套代码。

### 7.3 成本分层

| 层 | 说明 |
|----|------|
| 默认层 | mock（0 成本，零外部依赖） |
| dev-only 层 | LM Studio 本地（无出域、无付费） |
| 付费层 | `openai_compatible` 等，须显式 env + Gate + 预算（`max_cost_per_review`） |

- 付费层永远**非默认**；缺 Key / 未开 guard → 结构性 GUARD，永不静默启用（延续 MVP 红线）。

### 7.4 缓存与预算

- 相同 prompt（同 review/role/round 指纹）命中缓存 → 不重复计费（P2 落地）。
- 预算在 `ModelAdapter` 内累计，`max_cost_per_review` 触发即停（与 §4.2 硬闸协同）。

---

## 8. Memory 分层与长上下文

### 8.1 四层 Memory

| 层 | 内容 | 生命周期 |
|----|------|----------|
| **Session** | 单场评审会的临时上下文（当前 round、未决冲突） | 评审会结束即清 |
| **Reviewer** | **蒸馏 profile**：该专家擅长的维度、典型偏见、历史强弱项（**非聊天历史**） | 跨评审会长期沉淀 |
| **Project** | 项目级知识（方案背景、历史决策、约束） | 项目周期 |
| **KB** | 外部知识库 / RAG 检索结果（via tool，P4） | 按需检索 |

### 8.2 Rolling Summary（长上下文管理）

- 多轮辩论上下文膨胀时，用 **rolling summary** 压缩历史发言为增量摘要，避免 token 爆炸。
- 摘要由 `MemoryService` 维护，可审计、可回放。
- 关键：reviewer memory 只存**蒸馏 profile**，绝不把每轮原文当"记忆"塞回——这是设计 rationale #4 的落地。

---

## 9. Prompt 架构

### 9.1 分层组装

- Prompt 由**基础层（角色定义）+ 任务层（本轮指令）+ 上下文层（memory/KB 注入）+ 格式层（输出 schema）** 组装，而非单块写死。
- 便于 P3 的版本化与 A/B。

### 9.2 版本化注册表

- 每个 Prompt 模板有版本号（`PromptService` 管理），变更留痕、可回滚。
- 与决策审计同源：哪版 prompt 产出哪条 opinion 可溯。

### 9.3 Prompt Library + 可审计

- 预置角色（CTO/CFO/PMO 等）prompt 入 Library，新角色 = 加模板而非改代码。
- 所有 prompt 落库快照，报告可附"用哪版 prompt 生成"，满足可审计红线。

---

## 10. 与 PrismReview 现状映射表

> 证明 refactor **非 greenfield**：每一项既有能力都有明确的演进落点，不是推倒重来。

| 既有能力 | 演进成 |
|----------|--------|
| Provider guard（`ALLOW_EXTERNAL_MODEL_CALLS` + 5 态 `providerSource`） | `ModelAdapter` + `ModelRouter` + 成本/护栏 |
| `MODEL_PILOT_MAX_ROLES=3` 硬 cap | `max_turns_per_reviewer` / `max_rounds` 硬闸 |
| Runner + Queue + idempotent skip | `AgentRuntime` worker + turn 幂等 |
| `modelOutputRef` / `reasoningSummary` | 审计 / 可观测 + OTel span 锚点 |
| Report API + `providerSummary` + Markdown 导出 | `ReportingService` + `ArtifactService` |
| Mock 默认 + LM Studio dev-only | **红线保留** |

---

## 11. 6 阶段路线图（P0–P6）

> 每阶段标 **In / Out / 红线**。9.0 锁定路线，各 phase 实现时各自走标准/独立 Gate。

### P0 现状（done）
- **范围**：MVP mock demo，1 轮，报告 + Markdown 导出。
- **状态**：已完成（8.3 Go，`9dbcf97`）。

### P1 编排脊柱
- **In**：状态机 + checkpoint + 幂等 + opinion schema + mock Moderator + round-2 mock debater（详见 §12）。
- **Out**：Model Adapter 泛化（P2）、Prompt/Memory/RAG（P3）、Tool/HITL（P4）、可配置 workflow/评分（P5）、规模化+生产硬化（P6）。
- **红线**：默认 mock（含 Moderator）；真模型仅显式 env + Gate；schema 变更走**标准 Gate**（非 fast-gate，见 §13）；不 `--force`。

### P2 Model Adapter + 路由
- **In**：provider guard 泛化成 `ModelAdapter`，成本计量/预算/fallback，real model 仍非默认。
- **Out**：Prompt/Memory/RAG、Tool/HITL、Workflow/评分、规模化。
- **红线**：付费模型仍非默认；成本硬闸生效；引入新依赖须 Gate。

### P3 Prompt + Memory
- **In**：版本化 prompt 注册表、reviewer/project memory（蒸馏 profile，非聊天历史）、rolling summary、KB/RAG via tool。
- **Out**：Tool/HITL、Workflow/评分、规模化。
- **红线**：memory 不存聊天历史；KB 接入走 tool、不直连。

### P4 Tool + HITL
- **In**：MCP 工具层、Moderator 工具审批中断、人工轮次 override、真 LLM Moderator 接入。
- **Out**：Workflow/评分、规模化。
- **红线**：A2A 禁止（专家不互联）；工具仅经 MCP；真 LLM Moderator 仍需显式 env + Gate。

### P5 Workflow + 评分
- **In**：可配置 workflow（科研/企业/code-review/论文）、加权多维评分、报告生成器。
- **Out**：规模化+生产硬化。
- **红线**：workflow 配置化不引入新运行时依赖；评分权重可审计。

### P6 规模化 + 生产硬化
- **In**：抽 `AgentRuntime` worker 进程（多实例）、OTel 全链路、成本看板、多租户/权限/审计。
- **红线**：多租户隔离不破坏默认 mock 演示；OTel 不阻塞主链路。

---

## 12. P1 详细范围（重构入口）

### 12.1 In（P1 交付）

1. **评审会状态机显式化**（替换现有隐式线性流）：
   ```
   created → diagnosed
          → running(r1, 并行 reviewer turns)
          → summarized(Moderator)
          → [running(r2, debate) → summarized]*   ← 可重复
          → completed / failed / aborted
   ```
2. **自研最小 graph runtime（TS）**：节点 + 边（含条件路由）+ State + Checkpointer 接口（**Postgres 后端**，崩了能 resume）。
3. **现有流重构上脊柱**；**round-2 debate 用 mock debater 跑通**（默认 mock 下安全，硬闸 `max_rounds` 兜底，不依赖真实模型）。
4. **结构化 opinion schema**（版本化 + 校验），泛化现有 opinion 结构。
5. **Turn 幂等**：在 `(review_id, reviewer_id, round)` 上幂等，泛化现有 "idempotent skip"。
6. **Checkpoint/resume**：每节点转移后状态落库。
7. **LLM Moderator skeleton**（mock 默认）。
8. **API 契约不变**：现有 Report API / SSE / `setup-demo-review` 继续工作；**前端零改动**。

### 12.2 Out（P1 不做，留给后续 phase）

- Model Adapter 泛化（P2）、Prompt/Memory/RAG（P3）、Tool/HITL（P4）、可配置 workflow/评分（P5）、规模化+生产硬化（P6）。

### 12.3 round-2 mock debater 决策

- P1 的 round-2 "辩论"在**默认 mock**下用 **mock debater** 跑通：专家 turns 由 mock 生成，验证 graph 脊柱的"辩论→汇总"分支与硬闸 `max_rounds` 兜底逻辑。
- 不依赖真实模型，保证默认 mock 红线；真实辩论质量在 P2/P3 模型层就绪后自然提升，无需改脊柱。

### 12.4 P1 红线

- 默认 mock（**含 Moderator** mock）。
- 真模型仅显式 env + Gate。
- **schema 变更走标准 Gate**（非 fast-gate）：因动 schema + 状态机，触发协议 §5.2/§5.4 + §7.1 退回标准流程。
- 不 `--force`。

---

## 13. 红线合规核对（本 Sprint 9.0）

| 红线 | 状态 |
|------|------|
| 不改任何 `.ts` / `.tsx` / `.prisma` / 业务代码 | ✅ 本 Sprint 仅新增/更新 `docs/` |
| 不跑模型 | ✅ 无模型调用 |
| 不写密钥 | ✅ 文档仅描述 env 守卫语义，无真实 Key |
| 不动 Prisma schema | ✅ 未改 schema（P1 未来改动走标准 Gate） |
| 不改状态机实现 | ✅ 仅描述目标状态机，未改实现 |
| 不提交 `.env` / `node_modules` / `data` / `.reasonix` / `.workbuddy` / 日志 | ✅ 仅 `docs/` 变更 |
| 不 `--force` push | ✅ 未推送 |
| 未执行 `git commit` | ✅ 产出文档 + 自检后回报 Codex，由 Codex 走 fast-gate 再决定 |

---

## 14. Gate 触发条件自检（fast-gate）

依据协议 §7.1，快速 Gate 需**同时满足**以下全部条件：

| §7.1 条件 | 本 Sprint 9.0 | 结论 |
|-----------|---------------|------|
| 1. 不改 Prisma schema | ✅ 未改 | 满足 |
| 2. 不改状态机流转 | ✅ 仅描述目标状态机，未改实现 | 满足 |
| 3. 不涉及真实 LLM/Embedding/MinIO 首次接入 | ✅ 无模型调用 | 满足 |
| 4. 不改前端主页面 | ✅ 前端零改动 | 满足 |
| 5. 不引入新外部依赖 | ✅ 无依赖变更 | 满足 |

**结论**：本 Sprint 9.0 为**纯文档**，全部满足 §7.1 触发条件，**符合快速 Gate 模式**。P1 阶段若实际改动 schema/状态机实现，将触发 §5.2/§5.4 + §7.1 退回标准流程——此点已在 §12.4 与 §13 显式声明。

---

## 附：交付物清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `docs/roadmap/Sprint_9.0_Product_Roadmap_Reset.md` | 新增（本文件） | 主文档：architecture lock + 6 阶段路线图 |
| `docs/coordination/ACTIVE_SPRINT.md` | 更新 | 滚动到 9.0；Gate 表补 8.3 Go + 9.0 In Progress |

> 本 Sprint 未执行 `git commit` / `git push`。文档就绪后回报 Codex，由 Codex 走 fast-gate（workbuddy-review）再决定是否提交。
