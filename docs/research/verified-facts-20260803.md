# PrismReview 调研数据核验表（verified facts）

> **核验日期：** 2026-08-03
> **核验方式：** GitHub REST API（`api.github.com/repos/{owner}/{repo}`）逐仓实测；arXiv abs 页面逐一确认；Gartner 数据来自官网新闻稿
> **用途：** 作为《20260803-competitive-landscape-research.md》v1.2 的数据层基线。后续任何修订只允许引用本表数值，禁止使用训练知识/记忆值替换。

---

## 一、30 个仓库实测数据

> star 数为 2026-08-03 抓取快照，随时间实时变化（±1 属正常波动）。

| # | 名称 | 仓库 | 实测 Stars | 状态 |
|---|------|------|-----------|------|
| 1 | Lavern | AnttiHero/lavern | 284 | ✅ |
| 2 | PR Review Agent Council | csy-csy123/pr-review-agent-council | 84 | ✅ |
| 3 | PaperJury | u7079256/paperjury | 858 | ✅ |
| 4 | The Solutioning Room | gauri-bhardwaj/solutioning-room-multiagent-orchestration | 0 | ✅ |
| 5 | MultiAgent-Doc-Review-Agent | louiswang524/MultiAgent-Doc-Review-Agent | 2 | ✅ |
| 6 | manuscript-review-skill | shaowen-ye/manuscript-review-skill | 18 | ✅ |
| 7 | agentic-paper-review | debashis1983/agentic-paper-review | 8 | ✅ |
| 8 | AssessmentAI | Fatima0923/AssessmentAI | 0 | ✅ |
| 9 | MetaGPT | FoundationAgents/MetaGPT | 69,641 | ✅ |
| 10 | TradingAgents | TauricResearch/TradingAgents | 95,389 | ✅ |
| 11 | Codesteward | Codesteward/codesteward | 38 | ✅ |
| 12 | ai-legal-claude | zubair-trabzada/ai-legal-claude | 1,606 | ✅ |
| 13 | FAROS | OpenNSWM-Lab/FAROS | 3,124 | ✅ |
| 14 | OpenReviewer | maxidl/openreviewer | 14 | ✅ |
| 15 | Eureka ML Insights | microsoft/eureka-ml-insights | 185 | ✅ |
| 16 | PromptKit | microsoft/PromptKit | 91 | ✅ |
| 17 | AuditPilot | Ricky-7-Yan/intelligent-audit-system | 1,164 | ✅ |
| 18 | mission-control | builderz-labs/mission-control | 5,905 | ✅ |
| 19 | Agentic-Research-Paper-Evaluator | DINAKAR-S/Agentic-Research-Paper-Evaluator | 1 | ✅ |
| 20 | ChatEval | **thunlp/ChatEval** | 341 | ✅ |
| 21 | LangGraph | langchain-ai/langgraph | 38,715 | ✅ |
| 22 | Semantic Kernel | microsoft/semantic-kernel | 28,409 | ✅ |
| 23 | AutoGen | microsoft/autogen | 60,175 | ✅ |
| 24 | Dify | langgenius/dify | 151,130 | ✅ |
| 25 | CrewAI | joaomdmoura/crewAI | 56,529 | ✅ |
| 26 | Pydantic AI | pydantic/pydantic-ai | 19,017 | ✅ |
| 27 | LlamaIndex Workflows | run-llama/llama_index | 51,324 | ✅ |
| 28 | Haystack 2.x | deepset-ai/haystack | 26,092 | ✅ |
| 29 | LangFlow | langflow-ai/langflow | 152,767 | ✅ |
| 30 | DSPy | stanfordnlp/dspy | 36,558 | ✅ |

---

## 二、论文引用核验

| arXiv ID | 标题 | 状态 |
|----------|------|------|
| 2305.14325 | Improving Factuality and Reasoning in Language Models through Multiagent Debate | ✅ 存在 |
| 2606.16322 | PaperJury: Due-Process Review for Bounded LaTeX Revision | ✅ 存在 |
| 2412.20138 | TradingAgents: Multi-Agents LLM Financial Trading Framework | ✅ 存在 |
| 2409.10566 | Eureka: Evaluating and Understanding Large Foundation Models | ✅ 存在 |
| 2306.05685 | Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena | ✅ 存在 |
| 2304.03442 | Generative Agents: Interactive Simulacra of Human Behavior | ✅ 存在 |
| 2212.08073 | Constitutional AI: Harmlessness from AI Feedback | ✅ 存在 |

---

## 三、v1.2 修正记录（相对 v1.1）

| 条目 | v1.1 值 | v1.2 实测值 | 修正说明 |
|------|---------|-------------|---------|
| MetaGPT star | ~50,000+（量级复核） | **69,641** | v1.1 误将 v1.0 的正确值 69,639 改为训练知识量级 50k |
| TradingAgents star | ~15,000+（量级复核） | **95,389** | v1.1 误将 v1.0 的正确值 95,383 改为训练知识量级 15k |
| ChatEval 仓库 URL | THUDM/ChatEval（404） | **thunlp/ChatEval**（341★） | v1.0 的 ChatEval-Evaluation/ChatEval 与 v1.1 的 THUDM/ChatEval 均为 404 |
| 3.1 领域地图 | OpenRevw | OpenReviewer | v1.1 声称已修正但实际未改 |
| 附录 A 置信度 | 4 项"未获取"🔴 + 2 项"量级复核"🟡 | 全部 🟢 API 实测 | "未获取"条目实际均可经 API 获取（0/2/0/1★） |
| Gartner 需求数据 | "60% 企业计划部署多 Agent" | 75% 已试点/部署 Agent；15% 考虑完全自主 Agent | 原表述未找到出处，改用 Gartner 2025-09-30 公开数据 |
| Codesteward 融资 | "获融资" | 38★（未检索到融资信息） | 融资声明无公开依据，已移除 |
| Du et al. 引用量 | 500+ | 待核验（改为定性表述） | 多平台口径不一（OpenAlex 90+ 明显低估），不作具体断言 |

---

## 四、核验方法备注

1. GitHub star 数随时间实时变化，本表为 2026-08-03 抓取快照；
2. 框架类仓库（#21–30）在 v1.0/v1.1 中未填 star，v1.2 一并补齐；
3. 需求侧叙事性数据（Gartner 调查、GitHub topic 数量）已在正文标注来源或核验日期；
4. 各项目"核心机制 / 借鉴价值"叙述仍基于 README 与二手资料，需在阶段 1 考古学习时以源码为准。
