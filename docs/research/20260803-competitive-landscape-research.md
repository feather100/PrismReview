# PrismReview 竞品与借鉴项目调研报告

> **版本：** v1.2（数据层核验修订，2026-08-03）
> **调研日期：** 2026-08-03
> **调研人：** PrismReview 团队
> **调研方法：** 多维度并行网络检索 + GitHub 仓库分析 + 框架文档研究 + 商业 SaaS 桌面调研
> **调研范围：** 多 Agent 辩论/审议系统、AI 文档评审工具、Agent 编排框架、商业 SaaS/办公套件 AI、应用市场
> **修订说明：** 本版本按专家评审反馈（P0×3 / P1×5 / P2×4）全面修订：收窄结论 1 表述并新增商业扫描与需求侧证据、新增评分可信度验证方案、统一自研状态机口径、新增成本模型、修正事实错误。
> **v1.2 数据层消毒：** 全部 30 个项目的 star 与仓库 URL 已于 2026-08-03 经 GitHub API 实测复核；修正 v1.1 中 TradingAgents/MetaGPT 的 star 量级误判（API 实测为 95,389 / 69,641）、ChatEval 仓库地址（API 实测为 thunlp/ChatEval）、3.1 拼写与需求侧证据表述。核验明细见《verified-facts-20260803.md》。

---

## 📋 目录

- [一、执行摘要](#一执行摘要)
- [二、PrismReview 产品定位](#二prismreview-产品定位)
- [三、调研发现总览](#三调研发现总览)
- [四、Tier 1：最接近的结构性借鉴（8 个项目）](#四tier-1最接近的结构性借鉴8-个项目)
- [五、Tier 2：多 Agent 框架与产品（12 个项目）](#五tier-2多-agent-框架与产品12-个项目)
- [六、Tier 3：编排框架（10 个项目）](#六tier-3编排框架10-个项目)
- [七、商业与平台侧竞争扫描](#七商业与平台侧竞争扫描)
- [八、需求侧证据](#八需求侧证据)
- [九、评分可信度验证方案](#九评分可信度验证方案)
- [十、评审成本模型与分层策略](#十评审成本模型与分层策略)
- [十一、对比矩阵](#十一对比矩阵)
- [十二、关键论文参考](#十二关键论文参考)
- [十三、战略建议](#十三战略建议)
- [十四、行动方案](#十四行动方案)
- [附录 A：30 个项目速查表](#附录-a30-个项目速查表)
- [附录 B：搜索关键词与方法](#附录-b搜索关键词与方法)
- [附录 C：评审反馈响应追踪](#附录-c评审反馈响应追踪)

---

## 一、执行摘要

### 核心结论

1. **在开源/学术检索范围内**未发现与 PrismReview 完全对位的产品（多专家 persona + 多轮辩论 + 加权多维评分 + RBAC/审计 + 通用文档评审）。**商业 SaaS 与办公套件侧**存在功能部分重叠但定位不同的产品，需另行桌面调研后再下完整结论（详见[第七节](#七商业与平台侧竞争扫描)）。
2. **机制已被多领域验证：** 法律（Lavern）、学术（PaperJury）、代码（PR Review Agent Council）、架构（The Solutioning Room）都有相似模式，但各自只覆盖一个垂直领域。
3. **"多 persona × 多轮辩论 × 加权评分 × 审计溯源"的可组合能力**是 PrismReview 的最大差异化壁垒——目前没有项目把这四项组合在一起，更没有任何项目再加上 RBAC + 审计日志 + 来源溯源的企业级能力。
4. **编排层有大量成熟开源模式可借鉴**（非换库），PrismReview 的自研 9 值状态机脊柱可吸收 LangGraph 的 checkpoint 持久化、interrupt 语义、条件边等模式，无需整体迁移。

### 关键数据

| 维度 | 数据 |
|------|------|
| 调研项目总数 | 30+ |
| 结构性借鉴（Tier 1） | 8 个 |
| 框架与产品参考（Tier 2） | 12 个 |
| 编排框架（Tier 3） | 10 个 |
| 商业/平台侧扫描对象 | 8 个 |
| 覆盖领域 | 法律、学术、代码、架构、金融、教育、办公 SaaS、应用市场 |
| 完全对位竞品数量 | **0（开源/学术范围内）** |
| 潜在商业竞争者 | 3–5 个主体可能进入（见第七节） |
| 数据核验 | 30/30 项 GitHub API 实测（2026-08-03） |

### 关键风险提示

| 风险 | 说明 |
|------|------|
| **"0 竞品" ≠ "0 风险"** | 蓝海与死海在数据上无法区分，开源项目 star 普遍偏低可能暗示需求未被验证 |
| **评分可信度** | 加权多维评分若无验证协议，只是装饰性数字（见第九节验证方案） |
| **成本失控** | 多 persona × 多轮辩论的 token 成本会快速失控（见第十节成本模型） |
| **商业巨头进入** | Notion/飞书/Anthropic 等可能以功能升级方式进入该品类（见第七节） |

---

## 二、PrismReview 产品定位

### 一句话定位

> 多 Agent 智能评审中枢：把方案/架构/需求文档丢进去，多位专家 Agent 多轮辩论，由 Moderator 收敛出一份可量化、可溯源、可审计的正式评审报告。

### 核心能力

| 能力 | 说明 |
|------|------|
| 🗣️ 多轮辩论 | 多个专家 Agent 跨轮次交锋，由 Moderator 逼近共识 |
| 🕸️ 状态机编排脊柱 | 9 值状态机 + checkpoint/resume + 条件路由（自研，可审计） |
| 🤖 真 LLM Moderator | 支持多种 Provider，失败自动降级 mock |
| 🔐 加密 Provider Key | AES-256-GCM 静态加密 |
| 🔒 RBAC + 审计 | 4 级平台角色 + 全链路审计日志 |
| 📊 加权多维评分 | 4 种预设 workflow 驱动不同维度权重 |
| 🧠 蒸馏式 Memory | Reviewer/Project 蒸馏 profile + 多轮 rolling summary |
| 📝 版本化 Prompt | 4 层组装 + 版本注册表 + 回滚 |
| 📄 Markdown 导出 | 正式评审报告一键导出 |
| 🔍 来源可观测 | providerSummary 五态来源追踪 |
| 🛡️ 硬闸兜底 | max_rounds / max_turns_per_reviewer 收敛硬闸 |
| 🧹 内存安全 | 终态自动清理 + HITL 超时兜底 |

### 技术栈

- **前端：** Next.js 14 + React 18 + TypeScript
- **后端：** NestJS 10 + TypeScript
- **数据库：** PostgreSQL + Prisma
- **编排：** 自研 9 值状态机（承重决策，见 13.1 节）
- **Worker：** Python + Celery

---

## 三、调研发现总览

### 3.1 领域地图

```
                        ┌─────────────────────┐
                        │   PrismReview       │
                        │   通用文档评审       │
                        │   (楔子场景)         │
                        └─────────┬───────────┘
                                  │
          ┌───────────┬───────────┼───────────┬───────────┐
          ▼           ▼           ▼           ▼           ▼
     ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
     │ 法律    │ │ 学术    │ │ 代码    │ │ 金融    │ │ 教育    │
     │ Lavern  │ │PaperJury│ │PR Council│ │Trading  │ │Assessment│
     │         │ │OpenReviewer│ │CodeStew │ │ Agents  │ │   AI    │
     └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘
          │           │           │           │           │
          └───────────┴───────────┴───────────┴───────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
    ┌───────────┐      ┌───────────┐      ┌───────────┐
    │ 编排框架  │      │ 商业 SaaS │      │ 应用市场  │
    │LangGraph  │      │Notion/飞书│      │GPT Store  │
    │SK / Dify  │      │Confluence │      │Dify 模板  │
    └───────────┘      └───────────┘      └───────────┘
```

### 3.2 能力覆盖热力图

| 项目 | 多Persona | 多轮辩论 | 评分报告 | 状态机 | HITL | 审计 | 通用文档 |
|------|:---------:|:--------:|:--------:|:------:|:----:|:----:|:--------:|
| **PrismReview** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Lavern | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| PR Council | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| PaperJury | ❌ | ✅ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Solutioning | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Doc-Review | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| manuscript | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| AssessmentAI | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| MetaGPT | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| TradingAgents | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

> **结论：没有任何项目覆盖超过 4 列，PrismReview 是唯一覆盖全部 7 列的产品。**

---

## 四、Tier 1：最接近的结构性借鉴（8 个项目）

> 这些项目与 PrismReview 的"多专家 persona → 多轮辩论 → 评分报告"模式高度同构，值得深入研究其设计。

### 考古优先级（按评审反馈调整）

| 优先级 | 项目 | 升/降原因 |
|--------|------|----------|
| **P0** | PR Review Agent Council | FindingLifecycle 状态机最直接可借鉴 |
| **P0** | Lavern | 多轮验证循环 + 人工门控模式 |
| **P0** | PaperJury | ★升 P0：858★、有论文、dogfood 验证、风险分级门控 |
| P1 | manuscript-review-skill | 评分矩阵 UI |
| P1 | AssessmentAI | LangGraph 编排 + 权重配置 |
| P1 | The Solutioning Room | 有在线 demo、运行成本最低，可提前 |
| — | agentic-paper-review | 方法论参考，不克隆 |
| — | MultiAgent-Doc-Review-Agent | 用例参考，不克隆 |

---

### 1. Lavern — "An agentic law firm"

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/AnttiHero/lavern |
| **网站** | https://lavern.ai |
| **Stars** | 284 ★（API 实测，2026-08-03） |
| **License** | Apache-2.0 |
| **语言** | TypeScript |

**核心机制：**
- 67 个专家 AI Agent（59 专家 + 7 编排器）
- 证据驱动辩论（evidence-backed debate）
- 10 轮验证循环（10-pass verification loop）
- 强制人工门控（mandatory human gates）
- 支持 Anthropic、Mistral（EU）、Ollama 本地运行
- 三层验证体系

**与 PrismReview 的关系：** ★★★★★ 最接近的结构性匹配

**可借鉴的设计：**
- 10 轮验证循环的轮次控制机制
- 三层验证体系（自验证 → 交叉验证 → 人工门控）
- 67 个专家 persona 的分类与组织方式
- 证据溯源的引用机制

**差异：** 法律垂直领域、无加权评分 rubric、无通用 workflow

---

### 2. PR Review Agent Council (Debate Council)

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/csy-csy123/pr-review-agent-council |
| **Stars** | 84 ★（API 实测，2026-08-03） |
| **语言** | Python |

**核心机制：**
- 多角色评审：Security / Correctness / Test / Maintainability / Critic / Lead / ReportWriter / **Judge**
- Lead Debate Controller 驱动动态辩论循环：challenge → supplement evidence → rebut → merge → adjudicate
- FindingLifecycle 状态机：candidate → challenged → accepted → rejected → downgraded
- 标准化结构化报告（固定 JSON schema 渲染为 Markdown）
- AI Judge 质量评估：critical-issue coverage / evidence quality / severity accuracy / duplicate-noise control / actionability / report clarity

**与 PrismReview 的关系：** ★★★★★ 机制几乎 1:1 匹配

**可借鉴的设计：**
- **FindingLifecycle 状态机** — 比 PrismReview 的 9 值状态机更细粒度，值得吸收
- **AI Judge 独立评分** — 与评审流程分离的独立质量评估层
- **辩论循环的动态控制** — challenge/rebut/merge/adjudicate 四步循环
- **标准化报告 schema** — 固定 JSON → Markdown 的渲染管线

**差异：** 仅代码/PR 场景、无加权多维评分、无 HITL

---

### 3. PaperJury — "Due-Process Review for Bounded LaTeX Revision"

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/u7079256/paperjury |
| **论文** | https://arxiv.org/abs/2606.16322（核验日期：2026-08-03） |
| **Stars** | 858 ★（API 实测，2026-08-03） |
| **License** | MIT |
| **语言** | JavaScript (Claude Code skill) |

**核心机制：**
- review → verdict → revise → verify 多轮引擎
- 确定性脚本处理机械检查 + 语义 Agent 处理判断
- 争议问题进入独立审议轨道（deliberation track）
- 不同风险等级编辑获得不同门控（risk-tiered guardrails）
- 附带真实"dogfood"样本（before/after PDF + 人工验证运行报告）
- 同时提供 Claude Code skill 和 Codex skill 两种形态

**与 PrismReview 的关系：** ★★★★★ 多轮评审循环最接近

**可借鉴的设计：**
- **多轮循环的终止条件设计** — 何时停止迭代
- **审议轨道机制** — 争议问题的分流处理
- **风险分级门控** — 不同风险等级不同处理策略
- **dogfood 验证** — 用自身产品验证自身的方法论

**差异：** 单人 reviewer persona、学术场景、无加权多维评分

---

### 4. The Solutioning Room

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/gauri-bhardwaj/solutioning-room-multiagent-orchestration |
| **在线 Demo** | https://solutioning-room-multiagent-orchestration.onrender.com/ |
| **Stars** | 0 ★（API 实测，2026-08-03） |
| **语言** | Python (FastAPI + SSE) |

**核心机制：**
- 模拟工程设计评审
- 4 个角色：Backend Engineer / Product Manager / Architect / Engineering Manager
- **锚定偏差防止**：每个角色先独立陈述开场立场
- 实时辩论：@mention 彼此、信号 `AGREE:`
- 共识达成后，Engineering Manager 合成结构化 ADR（Architecture Decision Record）
- 共享 guardrails（"宪法"模式）附加到每个 system prompt

**与 PrismReview 的关系：** ★★★★★ persona 面板 + 辩论 + 结构化报告几乎映射

**可借鉴的设计：**
- **锚定偏差防止机制** — 独立开场再辩论，防止从众
- **实时辩论的 @mention 协议** — 角色间的交互协议
- **"宪法"模式** — 共享 guardrails 附加到所有 prompt
- **共识检测机制** — 何时判定共识已达成

**差异：** 无评分、无多轮迭代、输出 ADR 而非评分报告

---

### 5. MultiAgent-Doc-Review-Agent (Launch Document Reviewer)

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/louiswang524/MultiAgent-Doc-Review-Agent |
| **Stars** | 2 ★（API 实测，2026-08-03） |
| **语言** | Python |

**核心机制：**
- 产品发射文档评审
- 3 个专家 Agent：Product Manager / Data Scientist / Engineering
- 从不同视角评估 Google Docs 发射文档
- 输出：**0–10 分/类别 + 总体评估 + 可操作建议**
- 可自定义评估标准（YAML 配置）
- 支持 OpenAI / Anthropic / 本地模型（Ollama/vLLM）

**与 PrismReview 的关系：** ★★★★★ 用例最接近 PrismReview 实际场景

**可借鉴的设计：**
- **分类评分体系** — 每个类别独立评分
- **YAML 可配置评估标准** — 用户自定义 rubric
- **多模型支持架构** — Provider 抽象层设计

**差异：** 仅 3 个 persona、无多轮辩论、无加权聚合、无结构化报告模板

---

### 6. manuscript-review-skill (6-Agent Academic Review Panel)

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/shaowen-ye/manuscript-review-skill |
| **Stars** | 18 ★（API 实测，2026-08-03） |
| **License** | MIT |
| **语言** | JavaScript (Claude Code skill) |

**核心机制：**
- 模拟 6 位专家审稿人面板
- 角色：Architecture Strategist / Theory Mentor / Methods & Stats Reviewer / Application Advisor / Journal Editor / Senior Collaborator（+ 可选 ML 专家）
- 输出双语（EN/CN）标注 .docx，彩色逐段评审
- **量化评分矩阵（reviewer × section，1–10 分）**
- 优先级改进列表（Critical / Major / Minor）

**与 PrismReview 的关系：** ★★★★★ 评分矩阵最接近 PrismReview 的加权多维评分

**可借鉴的设计：**
- **reviewer × section 评分矩阵** — 本质上就是 PrismReview 的加权评分分解
- **双语标注报告** — 彩色逐段评审的 UI 模式
- **优先级分级** — Critical/Major/Minor 三级分类

**差异：** 学术场景、无多轮迭代、无辩论

---

### 7. agentic-paper-review

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/debashis1983/agentic-paper-review |
| **Stars** | 8 ★（API 实测，2026-08-03） |
| **License** | MIT |
| **语言** | Python |

**核心机制：**
- AI 驱动的研究论文评估
- 训练数据：46,748 条 ICLR 评审
- **多维评分**：Soundness / Presentation / Contribution
- 多特异性 related-work 搜索
- Claude Desktop MCP 集成
- **Spearman ρ = 0.74 与人类评审员相关性**

**与 PrismReview 的关系：** ★★★★☆ 多维评分 + 人类相关性验证

**可借鉴的设计：**
- **多维评分的维度设计** — 如何定义评分维度
- **与人类评审的相关性验证方法论** — 如何证明 AI 评分可信（参见第九节）
- **MCP 集成模式** — 与桌面 AI 工具的集成

**差异：** 单人评审、无面板/辩论、学术场景

---

### 8. AssessmentAI

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/Fatima0923/AssessmentAI |
| **Stars** | 0 ★（API 实测，2026-08-03） |
| **语言** | Python (LangGraph + LangChain + FAISS + Gradio) |

**核心机制：**
- 论文评估的多 Agent LLM 流水线
- **可配置评估 persona**（6 个参数：module level / discipline / marking approach / experience / feedback style / **criterion weights**）
- 7 节点 LangGraph StateGraph：preprocess → reasoning → scoring → feedback → moderation → human_extraction → analytics
- 双模式：AI-only 或 AI+人工对比（correlation / error analysis）
- FAISS RAG 用于有根据的评估
- HITL 标记异常值

**与 PrismReview 的关系：** ★★★★☆ 评分权重配置 + LangGraph 编排

**可借鉴的设计：**
- **criterion weights 配置** — 直接对应 PrismReview 的加权维度
- **AI+人工对比模式** — 验证 AI 评估质量的方法（参见第九节）
- **7 节点 LangGraph 编排** — 参考其状态机设计
- **HITL 异常值标记** — 人机协作的切入点

**差异：** 单人评估（非面板）、教育场景、无多轮辩论

---

## 五、Tier 2：多 Agent 框架与产品（12 个项目）

> 这些是底层框架或产品模式，PrismReview 可借鉴其架构或在其上构建。

---

### 9. MetaGPT — "First AI Software Company"

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/FoundationAgents/MetaGPT |
| **产品** | https://mgx.dev |
| **Stars** | 69,641 ★（API 实测，2026-08-03） |
| **License** | MIT |
| **语言** | Python |

**核心机制：** 分配 GPT 不同角色（PM / 架构师 / 项目经理 / 工程师）形成协作软件公司。一键需求输出用户故事、竞品分析、需求文档、数据结构、API、文档。

**借鉴价值：** ★★★★☆ **persona 协作模式的鼻祖**，PrismReview 的 CTO/CFO/PMO 面板的祖先。

---

### 10. TradingAgents — Multi-Agent LLM Financial Trading Framework

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/TauricResearch/TradingAgents |
| **论文** | https://arxiv.org/abs/2412.20138（核验日期：2026-08-03） |
| **Stars** | 95,389 ★（API 实测，2026-08-03） |
| **License** | Apache-2.0 |
| **语言** | Python |

**核心机制：** 多分析师 Agent（基本面/情绪/技术/辩论）评估交易机会，产出结构化报告，投资组合经理做决策。包含牛熊辩论机制。

**借鉴价值：** ★★★★☆ **辩论 + 结构化报告 + 决策**模式可复用。

---

### 11. Codesteward — "Agentic code review that knows your graph"

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/Codesteward/codesteward |
| **网站** | https://codesteward.ai |
| **Stars** | 38 ★（API 实测，2026-08-03） |
| **License** | Apache-2.0 |
| **语言** | TypeScript |
| **部署** | 自托管 |

**核心机制：** 多 Agent 代码评审 + 结构代码图（调用链/依赖/认证路径）。双模式：Gate（PR/MR 评审）和 Stewardship（长期分支治理）。产品 UI + Dashboard + 发现追踪 + 实时 Agent 活动。

**借鉴价值：** ★★★★☆ **最接近的产品形态**（自托管 + Dashboard + 多 Agent 评审）。

---

### 12. ai-legal-claude — AI Legal Assistant

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/zubair-trabzada/ai-legal-claude |
| **Stars** | 1,606 ★（API 实测，2026-08-03） |
| **语言** | Python (Claude Code skill) |

**核心机制：** 合同评审/风险分析/NDA 生成/合规审计/谈判策略/PDF 报告 — 14 技能、5 并行 Agent。

**借鉴价值：** ★★★★☆ 并行 Agent + 结构化报告的产品模式。

---

### 13. FAROS — Foundation AutoResearch Operating System

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/OpenNSWM-Lab/FAROS |
| **Stars** | 3,124 ★（API 实测，2026-08-03） |
| **语言** | Python |

**核心机制：** Blueprint 驱动的 AutoResearch 运行时，编排完整研究工作流：idea → experiment → paper → review。围绕 Blueprints / Capabilities / Profiles / Providers 构建。评审阶段是一等公民。

**借鉴价值：** ★★★★☆ 多阶段流水线 + 评审阶段一等公民的架构。

---

### 14. OpenReviewer — Specialized LLM for Scientific Paper Reviews

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/maxidl/openreviewer |
| **Demo** | https://huggingface.co/spaces/maxidl/openreviewer |
| **论文** | NAACL 2025 |
| **Stars** | 14 ★（API 实测，2026-08-03） |
| **语言** | Python |

**核心机制：** 8B 参数模型微调 79,000 条 ICLR/NeurIPS 评审。生成真实、批判性评审，遵循会议特定模板。处理完整 PDF（公式+表格）。

**借鉴价值：** ★★★★☆ 专家评审微调方法论可复用到 persona prompt。

---

### 15. Eureka ML Insights — Microsoft's Evaluation Framework

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/microsoft/eureka-ml-insights |
| **论文** | https://arxiv.org/abs/2409.10566（核验日期：2026-08-03） |
| **Stars** | 185 ★（API 实测，2026-08-03） |
| **License** | Apache-2.0 |
| **语言** | Python |

**核心机制：** 标准化基础模型评估框架，超越单一分数报告和排名。定义数据处理、推理、评估的自定义流水线。

**借鉴价值：** ★★★★☆ **"超越单一分数"哲学**直接对齐 PrismReview 的加权多维评分。

---

### 16. microsoft/PromptKit

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/microsoft/PromptKit |
| **Stars** | 91 ★（API 实测，2026-08-03） |

**核心机制：** 可组合 prompt 组件（persona / protocol / format），用于 bug 调查、设计文档、代码评审、安全审计。

**借鉴价值：** ★★★★☆ **persona prompt 工程化**方法直接可用。

---

### 17. AuditPilot (intelligent-audit-system)

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/Ricky-7-Yan/intelligent-audit-system |
| **Stars** | 1,164 ★（API 实测，2026-08-03） |

**核心机制：** 可审计企业 AI Agent + 证据驱动工作流 + 评估 harness + 人工评审 + 修复交付。

**借鉴价值：** ★★★★☆ **审计追踪 + 证据溯源**与 PrismReview 的 provenance 需求高度契合。

---

### 18. mission-control

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/builderz-labs/mission-control |
| **Stars** | 5,905 ★（API 实测，2026-08-03） |

**核心机制：** 自托管 AI Agent 控制平面 — dispatch / review runs / track spend。

**借鉴价值：** ★★★★☆ **产品层参考**：Agent 运行监控面板。

---

### 19. Agentic-Research-Paper-Evaluator

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/DINAKAR-S/Agentic-Research-Paper-Evaluator |
| **Stars** | 1 ★（API 实测，2026-08-03） |

**核心机制：** 5 个专家 Agent → ACCEPT / NEEDS REVISION / REJECT + 分数。

**借鉴价值：** ★★★★☆ 多 Agent 评审 + 裁决模式。

---

### 20. ChatEval

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/thunlp/ChatEval |
| **Stars** | 341 ★（API 实测，2026-08-03） |
| **发表** | NeurIPS 2023 |

**核心机制：** 多 Agent 辩论评估对话系统。目标 Agent 生成响应，多个评估 Agent 辩论并批判响应质量，达成共识评分。

**借鉴价值：** ★★★★☆ **辩论评估方法论**的学术基础。

---

## 六、Tier 3：编排框架（10 个项目）

> 这些是底层编排引擎，PrismReview 的"9 值状态机脊柱"可参考其**模式**（非整体迁移）。

---

### 21. LangGraph (LangChain)

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/langchain-ai/langgraph |
| **文档** | https://langchain-ai.github.io/langgraph/ |

**编排模型：** 状态机 / 有向图（有环或无环）。定义 State（TypedDict + reducer）、Nodes（状态变更函数）、Edges（条件路由）。原生支持循环 → 多轮循环。

| 能力 | 支持 |
|------|------|
| Checkpoint/Resume | ✅✅ 一等公民（Checkpointer 接口，SqliteSaver/PostgresSaver） |
| HITL | ✅✅ interrupt_before / interrupt_after 暂停执行，可检查/修改状态后继续 |
| Multi-agent | ✅ 原生 handoff 工具、send() 动态边、supervisor/hierarchical/swarm 模式 |
| Structured Output | ✅ with_structured_output / Pydantic |

**与 PrismReview 的映射：** ⭐⭐⭐ **最佳模式借鉴对象**
- 每轮辩论 = 一个循环
- 专家 Agent = 节点
- 收敛判断 = 条件边
- 评分 = 节点
- HITL 门控 = interrupt
- 长辩论可恢复 = Checkpointer

**⚠️ 语言边界：** LangGraph 是 Python 库，PrismReview 是 NestJS/TypeScript 栈。整体迁移 = 用另一种语言重写编排层，成熟度红利不会跨语言转移。**结论：借鉴模式，不换实现。**

---

### 22. Semantic Kernel Process Framework (Microsoft)

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/microsoft/semantic-kernel |

**编排模型：** Process Framework 显式为**状态机**（steps + events + state），专为长运行业务流程设计。

| 能力 | 支持 |
|------|------|
| Checkpoint/Resume | ✅✅ |
| HITL | ✅✅ 审批工作流 |
| Multi-agent | ✅ |
| Structured Output | ✅ |

**与 PrismReview 的映射：** ⭐⭐⭐ 最接近 1:1 的 phase 状态机。

**⚠️ 技术栈匹配度：** Semantic Kernel 偏 .NET/C#，虽有 Python/Java 版本但生态重心在微软栈。与 PrismReview 的 NestJS 栈存在语言边界。

---

### 23. AutoGen v0.4+ (Microsoft)

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/microsoft/autogen |

**编排模型：** 事件驱动 / 对话轮次。Agent 在轮次中交谈，终止条件结束循环。v0.4 分层架构（Core → AgentChat → Studio）。

| 能力 | 支持 |
|------|------|
| Checkpoint/Resume | ⚠️ 部分 |
| HITL | ✅ UserProxyAgent |
| Multi-agent | ✅✅ 核心优势：群聊、嵌套聊天、发言者选择 |
| Structured Output | ✅ |

**与 PrismReview 的映射：** ⭐⭐ 适合"专家群聊辩论"，但缺显式 phase 状态机。

---

### 24. Dify

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/langgenius/dify |

**编排模型：** 可视化工作流引擎（DAG 类图）。拖放节点：LLM / 知识 / 工具 / 条件 / 迭代。含 ReAct Agent 节点。

| 能力 | 支持 |
|------|------|
| Checkpoint/Resume | ⚠️ 有限 |
| HITL | ✅✅ 内置人工反馈/审批节点 |
| Multi-agent | ⚠️ 通过工作流调用子工作流 |
| Structured Output | ✅ |

**与 PrismReview 的映射：** ⭐⭐⭐ 最快产品化路径，可视化编排 + HITL 节点。

---

### 25. CrewAI

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/joaomdmoura/crewAI |

**编排模型：** 角色/流程驱动。Agent 有角色/目标/背景；分配任务；Crew 执行。支持 sequential / hierarchical / consensus 流程类型。

| 能力 | 支持 |
|------|------|
| Checkpoint/Resume | ⚠️ 非核心功能 |
| HITL | ⚠️ 通过自定义工具 |
| Multi-agent | ✅✅ 核心优势：角色化 Agent |
| Structured Output | ⚠️ |

**与 PrismReview 的映射：** ⭐⭐ persona 角色映射自然，但缺状态机、checkpoint、HITL。

---

### 26. Pydantic AI

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/pydantic/pydantic-ai |

**编排模型：** Agent 图（AgentGraph）+ 函数工具调用。图模式支持多步/多 Agent。

| 能力 | 支持 |
|------|------|
| Checkpoint/Resume | ⚠️ 非核心功能 |
| HITL | ⚠️ 通过工具调用 |
| Multi-agent | ✅ 图模式 |
| Structured Output | ✅✅ 核心优势：Pydantic 验证 |

**与 PrismReview 的映射：** ⭐⭐ **评分报告输出层**的最佳选择。

---

### 27. LlamaIndex Workflows

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/run-llama/llama_index |

**编排模型：** 事件驱动工作流 / 状态机。步骤由事件连接；共享 Context = 状态。支持循环、分支。异步优先。

| 能力 | 支持 |
|------|------|
| Checkpoint/Resume | ⚠️ Context 可序列化 |
| HITL | ⚠️ 通过等待外部事件的步骤 |
| Multi-agent | ⚠️ Agent 作为工作流步骤 |
| Structured Output | ✅ |

**与 PrismReview 的映射：** ⭐⭐ RAG 密集型评审的检索层。

---

### 28. Haystack 2.x (deepset)

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/deepset-ai/haystack |

**编排模型：** Pipeline / DAG + 条件路由。组件类型化；管道连接。条件分支，循环可能。

| 能力 | 支持 |
|------|------|
| Checkpoint/Resume | ⚠️ |
| HITL | ⚠️ 通过自定义组件 |
| Multi-agent | ⚠️ Agent 作为组件 |
| Structured Output | ✅✅ 强类型验证 |

**与 PrismReview 的映射：** ⭐⭐ 强类型管道 + 验证。

---

### 29. LangFlow

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/langflow-ai/langflow |

**编排模型：** 可视化 UI 构建 LangChain/LangGraph 流。拖放生成代码。DAG 类。

**与 PrismReview 的映射：** ⭐⭐ 快速原型化评审流，导出到 LangGraph 生产。

---

### 30. DSPy (Stanford NLP)

| 属性 | 值 |
|------|-----|
| **仓库** | https://github.com/stanfordnlp/dspy |

**编排模型：** 声明式模块组合。优化 prompt/signature，非 Agent 框架。

**与 PrismReview 的映射：** ⭐ **辩论 prompt 优化**的配套工具。

---

## 七、商业与平台侧竞争扫描

> **本节为 v1.1 新增，回应评审反馈 P1-4：原报告只覆盖开源/学术，对主打"通用商业文档评审"的产品竞争格局判断不完整。**

### 7.1 竞争层次模型

对 PrismReview 而言，竞争并非只有"另一个多 Agent 评审产品"，而是来自四个层次：

```
层次 1：直接对位产品  → 目前开源/学术范围内为 0
层次 2：商业 SaaS 功能覆盖 → Notion AI、飞书/钉钉、Confluence
层次 3：平台/应用市场  → GPT Store、Dify 模板、Coze 插件
层次 4：通用 LLM 直接替代 → ChatGPT/Claude/通义/Kimi + 定制 Prompt
```

### 7.2 办公套件 AI（层次 2）

| 产品 | 当前能力 | 与 PrismReview 的关系 | 进入可能性 |
|------|---------|----------------------|-----------|
| **Notion AI** | 文档总结、改写、问答、表格公式 | 单文档交互，无多角色辩论，无评分 | 中：可加"评审模式" |
| **飞书/钉钉 文档** | AI 助手：总结、续写、提取待办 | 同上，办公场景深度集成 | 中：企业客户基础好 |
| **Confluence + Atlassian Intelligence** | 页面总结、问答、智能搜索 | 企业知识管理场景，有 RBAC 基础 | 高：Atlassian 有 Jira 工作流引擎 |
| **语雀 AI** | 文档总结、知识库问答 | 国内知识库场景 | 低：定位偏知识管理 |

**关键判断：** 这些产品的 AI 能力目前停留在"单文档交互"层面（总结/问答/改写），**没有多角色辩论、没有多维评分报告**。但它们拥有企业客户基础和工作流引擎，**最可能以功能升级方式进入该品类**。

### 7.3 企业"智能评审/审批"平台（层次 2）

| 产品类型 | 代表 | 与 PrismReview 的关系 |
|---------|------|----------------------|
| BPM/工作流平台 | 泛微、致远、Flowable | 有审批流但无 AI 评审能力，可能集成本类产品 |
| 企业 AI 平台 | 钉钉 AI 助理、飞书智能伙伴 | 平台化 AI 能力，可能封装评审场景 |
| GRC 平台 | ServiceNow、MetricStream | 合规评审场景，但基于规则引擎非 LLM |

### 7.4 应用市场（层次 3）

| 市场 | 当前状态 | 与 PrismReview 的关系 |
|------|---------|----------------------|
| **GPT Store** | 大量定制 Prompt，包括"方案评审"类 | 单 Prompt 无法实现多轮辩论，但占据用户心智 |
| **Dify 模板市场** | 工作流模板，可能有评审类 | 可视化编排可实现部分能力 |
| **Coze 插件市场** | 字节跳动 Bot 平台 | 国内生态，可实现多 Agent 工作流 |

### 7.5 通用 LLM 直接替代（层次 4）

| 替代方式 | 说明 | 威胁程度 |
|---------|------|---------|
| ChatGPT/Claude + 定制 Prompt | 用户手动构造"你是 CTO，评审这份文档" | **高**：零成本，用户基数大 |
| 通义千问/Kimi 长文档 | 支持长文档输入 + 分析 | 中：国内用户首选 |
| Claude Projects / GPTs | 可保存上下文 + 系统 Prompt | 中：平台锁定效应 |

**关键判断：** 通用 LLM + 定制 Prompt 是**最大的潜在竞争**——不是因为它们能力强，而是因为**用户已经在那里**。PrismReview 必须提供 Prompt 无法实现的价值：**多角色交互、多轮迭代、评分一致性、审计溯源**。

### 7.6 最可能进入该品类的主体 + 时间窗

| 主体 | 进入路径 | 时间窗 | 威胁等级 |
|------|---------|--------|---------|
| **Anthropic (Claude)** | 多 Agent 工程博客已发布，Claude Projects 可封装 | 6–18 个月 | 🔴 高 |
| **Atlassian (Confluence)** | 有 Jira 工作流 + 企业客户 + AI 团队 | 6–12 个月 | 🔴 高 |
| **Notion** | Notion AI 升级，增加多角色模式 | 12–24 个月 | 🟡 中 |
| **飞书/钉钉** | 国内办公套件 + AI 平台化 | 12–24 个月 | 🟡 中 |
| **OpenAI (GPTs)** | GPT Store 可能出现"评审 Bot" | 6–12 个月 | 🟡 中 |

**结论：** PrismReview 的窗口期约 **6–18 个月**，之后商业巨头可能以功能升级方式进入。**差异化壁垒（加权评分 + 审计溯源 + RBAC）和垂直场景的品牌认知**是守住窗口的关键。

---

## 八、需求侧证据

> **本节为 v1.1 新增，回应评审反馈 P1-6："蓝海与死海在数据上无法区分"。**

### 8.1 支持"市场存在"的间接证据

| 证据类型 | 数据点 | 解读 |
|---------|--------|------|
| **论文引用量** | Du et al. 2023 (Multiagent Debate) 为多 Agent 辩论方向奠基论文（具体引用数多平台口径不一，待核验） | 学术社区对"多 Agent 辩论"机制有强烈兴趣 |
| **企业 LLM 需求** | Gartner 2025 调查：75% 受访者已试点/部署某种 AI Agent，但仅 15% 的 IT 应用负责人考虑/试点/部署完全自主 Agent（来源：Gartner 新闻稿 2025-09-30） | AI Agent 是企业趋势，但自主度仍低，需管理预期 |
| **垂直产品验证** | PaperJury 858★、Lavern 284★、Codesteward 38★ | 垂直领域有产品与用户基础（star 量级仍普遍偏低） |
| **GitHub 趋势** | GitHub `multi-agent` topic 当前约 12,389 个仓库（2026-08-03 实测） | 开发者社区有持续活动（历史增长率未核验） |

### 8.2 警示信号

| 信号 | 数据 | 解读 |
|------|------|------|
| **Tier 1 项目 star 偏低** | 多数 < 100★ | 可能暗示需求未被充分验证 |
| **无商业成功案例** | 无 Tier 1 项目公布付费客户 | 产品-市场契合度未验证 |
| **通用评审无标杆** | 无"通用商业文档评审"品类领导者 | 可能是蓝海，也可能是死海 |

### 8.3 市场验证缺口

**当前状态：** 本报告仅完成供给侧调研（"别人在做什么"），**未完成需求侧验证（"用户是否愿意买单"）**。

**建议的市场验证动作（纳入阶段 1 行动方案）：**

| 验证方式 | 目标 | 数量 | 时间 |
|---------|------|------|------|
| 目标用户访谈 | CTO 办公室 / PMO / 咨询公司 | 5–10 人 | 与考古并行 |
| 竞品试用 | 用 ChatGPT + Prompt 模拟评审流程 | 3–5 次 | 1 周 |
| 付费意愿测试 | 是否愿意为"正式评审报告"付费 | 5 人 | 访谈时同步 |

**结论：** 供给侧证据支持"机制被验证"，但需求侧证据缺失。**在获得 5–10 个目标用户反馈前，"空白市场"应标记为"待验证假设"而非确定结论。**

---

## 九、评分可信度验证方案

> **本节为 v1.1 新增，回应评审反馈 P0-2：加权多维评分若无验证协议，只是装饰性数字。**

### 9.1 问题陈述

企业 CTO/PMO 用 LLM 分数做决策的第一问题是：**"分数凭什么可信？"**

当前 PrismReview 的加权多维评分是**黑盒输出**——没有验证协议，无法证明分数与人类专家判断一致。这是企业级产品的生死线。

### 9.2 可借鉴的验证方法

| 来源 | 方法 | 可复用度 |
|------|------|---------|
| **agentic-paper-review** | Spearman ρ = 0.74 与人类评审相关性 | ⭐⭐⭐ 直接复用其相关性验证协议 |
| **AssessmentAI** | AI+人工对比模式（correlation + error analysis） | ⭐⭐⭐ 双模式对比框架 |
| **Eureka ML Insights** | 超越单一分数的评估哲学 + 可配置流水线 | ⭐⭐ 评估流水线设计 |
| **ChatEval** | 多 Agent 辩论达成共识评分 | ⭐⭐ 共识机制可参考 |
| **LLM-as-a-Judge (Zheng et al.)** | 评分校准 + 偏差分析（位置偏好、冗长偏好） | ⭐⭐⭐ 偏差检测直接可用 |

### 9.3 PrismReview 评分可信度验证方案

#### 阶段 A：构建 Gold Standard（建议 2 3 周）

| 步骤 | 内容 | 产出 |
|------|------|------|
| 1. 选取文档 | 10–20 份真实方案文档（覆盖不同行业/规模） | 标注数据集 |
| 2. 人工评分 | 3 位领域专家独立评分（盲评） | 人工评分矩阵 |
| 3. 计算一致性 | 人工评分间一致性（Fleiss κ ≥ 0.6 为可接受） | 一致性报告 |

#### 阶段 B：定义一致性指标

| 指标 | 定义 | 通过阈值 |
|------|------|---------|
| **Spearman ρ** | AI 评分与人工评分的等级相关性 | ≥ 0.70 |
| **MAE** | 平均绝对误差（分数尺度上） | ≤ 1.0（10 分制） |
| **Kendall W** | 多位人工评分者间一致性 | ≥ 0.60 |
| **Calibration** | 置信区间覆盖率 | ≥ 80% |
| **Bias 检测** | 位置偏好、冗长偏好、self-enhancement | 无显著偏差 |

#### 阶段 C：验证执行

| 轮次 | 内容 | 通过条件 |
|------|------|---------|
| Round 1 | 全量 gold standard 跑 AI 评分 | 计算全部指标 |
| Round 2 | 分析失败案例，调整 prompt/权重 | 指标改善 |
| Round 3 | 新一批文档泛化测试 | 指标稳定 |

#### 阶段 D：持续监控

| 机制 | 说明 |
|------|------|
| **评分漂移检测** | 每月用 gold standard 重跑，检测分数漂移 |
| **人工抽检** | 5–10% 的评审报告人工复核 |
| **用户反馈闭环** | 用户对评分的纠正反馈纳入优化 |

### 9.4 与 LLM-as-a-Judge 研究的对接

根据 *Judging LLM-as-a-Judge* (Zheng et al., 2023) 的研究，LLM 评分存在以下已知偏差，需在验证方案中检测：

| 偏差类型 | 说明 | 检测方法 |
|---------|------|---------|
| **位置偏好** | 偏好排在前面的回答 | 随机化输入顺序 |
| **冗长偏好** | 偏好更长的回答 | 控制输出长度 |
| **self-enhancement** | 偏好自己生成的回答 | 多模型交叉验证 |
| **格式偏好** | 偏好特定格式（如 Markdown 列表） | 控制输出格式 |

**输出：** 本节内容将作为阶段 3 的前置交付物，形成独立的《评分可信度验证方案》文档。

---

## 十、评审成本模型与分层策略

> **本节为 v1.1 新增，回应评审反馈 P1-5：多 persona × 多轮辩论的 token 成本会快速失控。**

### 10.1 成本驱动因素

| 因素 | 影响 | 量级 |
|------|------|------|
| **文档长度** | 输入 token 与页数成正比 | 50 页 ≈ 15,000–30,000 input tokens |
| **Persona 数量** | 每个角色独立调用 LLM | N 角色 = N 倍调用 |
| **辩论轮次** | 每轮所有角色 + Moderator 各调用一次 | M 轮 = M × (N+1) 次调用 |
| **上下文累积** | 每轮历史上下文增长 | 线性或滚动压缩 |
| **模型选择** | GPT-4o vs Claude vs 本地模型 | 成本差 10–100 倍 |

### 10.2 单次评审成本估算

**假设：** 50 页文档、每角色每轮 ~5K input + ~2K output tokens

| 配置 | 角色数 | 轮次 | 总调用 | 总 Token（估） | GPT-4o 成本（估） | 本地模型成本 |
|------|--------|------|--------|--------------|------------------|-------------|
| **快速档** | 2 | 1–2 | 4–6 | ~30K | ~$0.15–0.30 | ~$0 |
| **标准档** | 4 | 2 | 10 | ~70K | ~$0.35–0.70 | ~$0 |
| **深度档** | 6 | 3 | 24 | ~170K | ~$0.85–1.70 | ~$0 |
| **Lavern 量级** | 67 | 10 | 670+ | ~5M+ | ~$25–50+ | ~$0 |

> **参考：** Lavern 的 67 专家 × 10 轮验证循环是极端量级，单次评审成本可达 $25–50+。这验证了"硬闸兜底"（max_rounds / max_turns_per_reviewer）的必要性。

### 10.3 延迟估算

| 配置 | 串行延迟（估） | 并行优化后（估） |
|------|--------------|----------------|
| **快速档** | 30–60s | 15–30s |
| **标准档** | 60–120s | 30–60s |
| **深度档** | 180–300s | 60–120s |

> **关键：** 同轮次的多个角色可**并行调用**（无依赖），延迟主要取决于轮次数而非角色数。

### 10.4 分层策略建议

```
┌─────────────────────────────────────────────────────────────┐
│                     PrismReview 产品分层                      │
├─────────────────────────────────────────────────────────────┤
│  🚀 快速档（Quick Scan）                                      │
│     2 角色 × 1–2 轮 → 1 页摘要 + 风险标记                     │
│     定价：免费或极低 → 引流 + 体验                            │
│     场景：日常方案快筛、团队自检                              │
├─────────────────────────────────────────────────────────────┤
│  📊 标准档（Standard Review）                                │
│     4 角色 × 2 轮 → 完整评分报告 + 改进建议                   │
│     定价：中等 → 主力付费产品                                 │
│     场景：项目立项评审、架构评审                              │
├─────────────────────────────────────────────────────────────┤
│  🏛️ 深度档（Deep Dive）                                      │
│     6 角色 × 3 轮 → 正式评审报告 + 审计溯源 + HITL           │
│     定价：高端 → 企业定制                                     │
│     场景：投融资尽调、合规评审、高管决策                      │
└─────────────────────────────────────────────────────────────┘
```

### 10.5 成本控制机制

| 机制 | 说明 |
|------|------|
| **硬闸兜底** | max_rounds / max_turns_per_reviewer 已有 |
| **上下文压缩** | 蒸馏式 Memory + 多轮 rolling summary 已有 |
| **模型分级** | 快速档用便宜模型，深度档用高端模型 |
| **缓存复用** | 文档解析/embedding 结果缓存 |
| **预算告警** | 用户/租户级别 token 预算上限 |

---

## 十一、对比矩阵

### 11.1 PrismReview vs Tier 1 项目

| 能力维度 | PrismReview | Lavern | PR Council | PaperJury | Solutioning | Doc-Review | manuscript | agentic-paper | AssessmentAI |
|---------|-------------|--------|------------|-------------|-------------|------------|------------|---------------|--------------|
| 多专家 persona | ✅ CTO/CFO/PMO… | ✅ 67 专家 | ✅ 7 角色 | ❌ 单人 | ✅ 4 角色 | ✅ 3 角色 | ✅ 6 审稿人 | ❌ 单人 | ❌ 单人 |
| 多轮辩论 | ✅ | ✅ 10 轮 | ✅ 动态循环 | ✅ 多轮 | ✅ 实时 | ❌ | ❌ | ❌ | ❌ |
| Moderator 收敛 | ✅ | ✅ | ✅ Lead | ❌ | ✅ EM | ❌ | ❌ | ❌ | ❌ |
| 多维评分 | ✅ 加权 | ❌ | ✅ Judge | ❌ | ❌ | ✅ 分类 | ✅ 矩阵 | ✅ 维度 | ✅ 权重 |
| 结构化报告 | ✅ MD | ✅ | ✅ JSON/MD | ❌ | ✅ ADR | ✅ JSON/TXT | ✅ docx | ❌ | ✅ |
| 状态机脊柱 | ✅ 9 值 | ✅ | ✅ FindingLifecycle | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ 7 节点 |
| Checkpoint/Resume | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| HITL | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| RBAC + 审计 | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 来源溯源 | ✅ 五态 | ✅ 证据 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 通用文档 | ✅ | ❌ 法律 | ❌ 代码 | ❌ 学术 | ✅ 架构 | ✅ 商业 | ❌ 学术 | ❌ 学术 | ❌ 教育 |

### 11.2 编排框架对比

| # | 框架 | 编排模型 | Checkpoint | HITL | Multi-agent | Structured Output | 辩论适配 | 语言 |
|---|------|----------|------------|------|-------------|-------------------|----------|------|
| 21 | **LangGraph** | 状态机/图 | ✅✅ | ✅✅ | ✅✅ | ✅ | ⭐⭐⭐ | Python |
| 22 | **Semantic Kernel** | Process 状态机 | ✅✅ | ✅✅ | ✅ | ✅ | ⭐⭐⭐ | .NET |
| 23 | **AutoGen v0.4** | 对话轮次 | ⚠️ | ✅ | ✅✅ | ✅ | ⭐⭐ | Python |
| 24 | **Dify** | 可视化 DAG | ⚠️ | ✅✅ | ⚠️ | ✅ | ⭐⭐⭐ | — |
| 25 | **CrewAI** | 角色/流程 | ⚠️ | ⚠️ | ✅✅ | ⚠️ | ⭐⭐ | Python |
| 26 | **Pydantic AI** | Agent 图 | ⚠️ | ⚠️ | ✅ | ✅✅ | ⭐⭐ | Python |
| 27 | **LlamaIndex** | 事件工作流 | ⚠️ | ⚠️ | ⚠️ | ✅ | ⭐⭐ | Python |
| 28 | **Haystack** | Pipeline/DAG | ⚠️ | ⚠️ | ⚠️ | ✅✅ | ⭐⭐ | Python |
| 29 | **LangFlow** | 可视化图 | ⚠️ | ⚠️ | ⚠️ | ✅ | ⭐⭐ | — |
| 30 | **DSPy** | 声明式模块 | ❌ | ❌ | ❌ | ⚠️ | ⭐ | Python |

---

## 十二、关键论文参考

### 12.1 核心论文（v1.0 已有）

| 论文 | 年份/会议 | 与 PrismReview 的关系 |
|------|-----------|----------------------|
| *Improving Factuality and Reasoning in Language Models through Multiagent Debate* (Du et al.) | 2023, arXiv:2305.14325 | **多 Agent 辩论的理论基础** |
| *ChatEval: A Multi-Agent Evaluation Framework* | NeurIPS 2023 | 辩论评估对话系统的方法论 |
| *PaperJury: Due-Process Review for Bounded LaTeX Revision* | 2025, arXiv:2606.16322 | 多轮评审循环的工程实现 |
| *TradingAgents: Multi-Agent LLM Financial Trading Framework* | 2024, arXiv:2412.20138 | 牛熊辩论 + 结构化报告 |
| *Eureka ML Insights: Standardizing Evaluations of Foundation Models* | 2024, arXiv:2409.10566 | 超越单一分数的评估哲学 |
| *OpenReviewer: Specialized LLM for Scientific Paper Reviews* | NAACL 2025 | 专家评审微调方法论 |
| *MetaGPT: Meta Programming for Multi-Agent Collaborative Framework* | 2023 | 多角色协作的 SOP 模式 |
| *CAMEL: Communicative Agents for "Mind" Exploration* | 2023 | 角色扮演 Agent 框架 |
| *AutoGen: Enabling Next-Gen LLM Applications via Multi-Agent Conversation* | 2023 | 多 Agent 对话编排 |

### 12.2 新增论文（v1.1 补充，回应评审反馈 P1-8）

| 论文 | 年份/会议 | 与 PrismReview 的关系 |
|------|-----------|----------------------|
| *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena* (Zheng et al.) | 2023, arXiv:2306.05685 | **评分校准与 LLM 当裁判的偏差**（位置偏好、冗长偏好），直接支撑加权评分设计和第九节验证方案 |
| *How we built our multi-agent research system* (Anthropic Engineering Blog) | 2025 | **子代理并行 + 编排的工程实践**，2025 年标杆，支撑编排层设计参考 |
| *Generative Agents: Interactive Simulacra of Human Behavior* (Park et al.) | 2023, arXiv:2304.03442 | **Persona 与 Memory 设计**（记忆流、反思、规划），支撑蒸馏式 Memory 的借鉴来源 |
| *Multi-Agent Debate: A Survey* | 2024 | 辩论机制的系统化综述 |
| *Constitutional AI: Harmlessness from AI Feedback* (Bai et al.) | 2022, arXiv:2212.08073 | AI 自我批评与宪法模式，支撑 Solutioning Room 的"宪法"模式参考 |

---

## 十三、战略建议

### 13.1 差异化壁垒（必须守住）

| 壁垒 | 为什么是壁垒 | 竞品情况 |
|------|-------------|---------|
| **"多 persona × 多轮辩论 × 加权评分 × 审计溯源"可组合能力** | 这是 PrismReview 独有的核心价值 | 无任何项目把这四项组合 |
| **RBAC + 审计 + provenance** | 企业级能力 | 开源项目均无此能力 |
| **通用文档评审** | 不做垂直，做通用平台 | 所有竞品都是垂直领域 |
| **9 值状态机 + checkpoint** | 长评审可恢复，可审计可测试 | 仅 Lavern 有类似能力 |

### 13.2 状态机决策：吸收模式，不整体迁移

> **v1.1 按评审反馈 P0-3 修订：原"复用编排轮子"改为"借鉴模式而非更换实现"。**

**决策：不整体迁移到 LangGraph / Semantic Kernel，但吸收其模式。**

| 理由 | 说明 |
|------|------|
| **语言边界** | LangGraph = Python，SK = .NET，PrismReview = NestJS/TS |
| **承重决策** | 自研 9 值状态机是产品差异化的组成部分（可审计性、可测试性、Moderator 中心化） |
| **测试覆盖** | 53 项单测覆盖的自研状态机，迁移会丢失测试资产 |
| **依赖重量** | 引入 LangChain 生态 = 引入巨大依赖树和 Python 运行时 |

**应吸收的模式（来自 Tier 3 框架）：**

| 模式 | 来源 | 如何吸收 |
|------|------|---------|
| Checkpoint 持久化 | LangGraph Checkpointer | 将当前 checkpoint 序列化格式标准化，支持导出/导入 |
| Interrupt 语义 | LangGraph interrupt | HITL 中断恢复的语义更形式化 |
| 条件边 | LangGraph conditional edges | route* 方法的路由表可更显式 |
| 事件驱动步骤 | LlamaIndex Workflows | 状态转换可加入事件发布/订阅 |

**阶段 2 Go/No-Go 决策门：**

| 评估项 | Go 条件 | No-Go 条件 |
|--------|---------|-----------|
| 语言边界成本 | 能找到 TS 等价实现 | 必须写 Python 桥接 |
| 可审计性损失 | 自研状态机可保留核心 | 必须替换核心状态机 |
| 依赖重量 | 增加 < 50MB | 增加 > 200MB |
| 迁移工作量 | ≤ 3 天 | > 1 周 |

**预判：大概率 No-Go（不迁移），但用 3 天验证。**

### 13.3 楔子策略

> **按评审反馈 P2-10：平台化内核 + 垂直楔子。**

```
┌──────────────────────────────────────────────────┐
│           PrismReview 平台化内核                  │
│  （通用评审引擎：状态机 + 评分 + 审计 + RBAC）     │
└────────────────────┬─────────────────────────────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ 商业方案 │ │ 架构评审 │ │ 投融资   │
    │ 评审     │ │          │ │ 尽调     │
    │ (楔子)   │ │          │ │          │
    └──────────┘ └──────────┘ └──────────┘
```

**楔子选择：商业方案评审（第一楔子）**
- 市场空白最大
- 已有 MultiAgent-Doc-Review-Agent 验证用例
- PMO/CTO 办公室付费意愿高

**"预设 4 种 workflow"** 保留为能力证明，不作为垂直投入承诺。

### 13.4 市场定位建议

| 领域 | 已有产品 | PrismReview 策略 |
|------|---------|-----------------|
| 学术评审 | PaperJury, OpenReviewer | ❌ 不做 |
| 代码评审 | CodeRabbit, Codesteward | ❌ 不做 |
| 法律文档 | Lavern | ❌ 不做 |
| **通用商业方案评审** | **空白** | ✅ **主打楔子** |
| 架构评审 | Solutioning Room（开源） | ✅ 第二梯队 |
| 合规/审计 | 无直接产品 | ✅ 第三梯队 |

---

## 十四、行动方案

### 阶段 1："考古式学习" + 市场验证（建议 1–2 周）

#### 1.1 供给侧：克隆学习（按评审反馈调整优先级）

| 优先级 | 仓库 | 学习重点 | 预计时间 |
|--------|------|---------|---------|
| **P0** | PR Review Agent Council | FindingLifecycle 状态机设计 | 1 天 |
| **P0** | Lavern | 多轮验证循环 + 人工门控 | 1 天 |
| **P0** | PaperJury | ★升 P0：dogfood 验证 + 风险分级门控 | 1 天 |
| P1 | manuscript-review-skill | 评分矩阵 UI 与报告生成 | 0.5 天 |
| P1 | AssessmentAI | LangGraph 编排 + 权重配置 | 0.5 天 |
| P1 | The Solutioning Room | 有在线 demo，运行成本最低 | 0.5 天 |

**输出：** 一份"设计模式提取"文档，提炼可复用的设计模式。

#### 1.2 需求侧：市场验证（v1.1 新增，与考古并行）

| 验证方式 | 目标 | 数量 | 时间 |
|---------|------|------|------|
| 目标用户访谈 | CTO 办公室 / PMO / 咨询公司 | 5–10 人 | 与考古并行 |
| 竞品试用 | 用 ChatGPT + Prompt 模拟评审流程 | 3–5 次 | 2–3 天 |
| 付费意愿测试 | 是否愿意为"正式评审报告"付费 | 5 人 | 访谈时同步 |

**输出：** 一份"市场验证报告"，包含用户痛点排序、付费意愿、功能优先级。

### 阶段 2：技术栈决策 — "证明或放弃"（建议 ≤ 3 天）

> **v1.1 按评审反馈 P0-3 修订：不预设迁移，设 Go/No-Go 决策门。**

评估将编排层迁移到 LangGraph 的可行性：

| 评估项 | Go 条件 | No-Go 条件 |
|--------|---------|-----------|
| 语言边界成本 | 能找到 TS 等价实现 | 必须写 Python 桥接 |
| 可审计性损失 | 自研状态机可保留核心 | 必须替换核心状态机 |
| 依赖重量 | 增加 < 50MB | 增加 > 200MB |
| 迁移工作量 | ≤ 3 天 | > 1 周 |
| Moderator 中心化 | 可保留 | 必须改为分布式 |

**决策门：**
- 全部满足 Go 条件 → 启动迁移
- 任一 No-Go 条件触发 → **停止迁移，转为"模式吸收"路径**

**预判：大概率 No-Go。** 3 天验证后，把精力投入阶段 3 产品化。

### 阶段 3：聚焦壁垒（持续）

将省下的精力全部投入：

| 优先级 | 投入方向 | 产出 |
|--------|---------|------|
| P0 | 评分可信度验证方案（见第九节） | 《评分可信度验证方案》文档 |
| P0 | 评分算法的打磨（加权多维聚合） | 可验证的评分引擎 |
| P0 | 商业方案评审楔子场景 | 第一个垂直场景的 workflow |
| P1 | 企业级能力（RBAC/审计/provenance） | 企业客户可用的安全合规 |
| P1 | 产品化（Dashboard/报告导出/实时进度） | 可演示的 MVP |
| P2 | Workflow 模板丰富（架构/合规/尽调） | 第二、第三梯队的 workflow |

---

## 附录 A：30 个项目速查表

> **v1.2 修订：全部 30 项 star/URL 经 GitHub API 实测复核（2026-08-03），替换 v1.1 的"量级复核/未获取"标注。**

| # | 名称 | 类型 | Stars | 来源 | 置信度 | 语言 | 领域 | URL |
|---|------|------|-------|------|--------|------|------|-----|
| 1 | Lavern | 产品 | 284 | API 实测 | 🟢 高 | TS | 法律 | github.com/AnttiHero/lavern |
| 2 | PR Review Agent Council | 产品 | 84 | API 实测 | 🟢 高 | Python | 代码 | github.com/csy-csy123/pr-review-agent-council |
| 3 | PaperJury | 产品 | 858 | API 实测 | 🟢 高 | JS | 学术 | github.com/u7079256/paperjury |
| 4 | The Solutioning Room | 产品 | 0 | API 实测 | 🟢 高 | Python | 架构 | github.com/gauri-bhardwaj/solutioning-room-multiagent-orchestration |
| 5 | MultiAgent-Doc-Review-Agent | 产品 | 2 | API 实测 | 🟢 高 | Python | 商业 | github.com/louiswang524/MultiAgent-Doc-Review-Agent |
| 6 | manuscript-review-skill | 产品 | 18 | API 实测 | 🟢 高 | JS | 学术 | github.com/shaowen-ye/manuscript-review-skill |
| 7 | agentic-paper-review | 产品 | 8 | API 实测 | 🟢 高 | Python | 学术 | github.com/debashis1983/agentic-paper-review |
| 8 | AssessmentAI | 产品 | 0 | API 实测 | 🟢 高 | Python | 教育 | github.com/Fatima0923/AssessmentAI |
| 9 | MetaGPT | 框架 | 69,641 | API 实测 | 🟢 高 | Python | 软件 | github.com/FoundationAgents/MetaGPT |
| 10 | TradingAgents | 产品 | 95,389 | API 实测 | 🟢 高 | Python | 金融 | github.com/TauricResearch/TradingAgents |
| 11 | Codesteward | 产品 | 38 | API 实测 | 🟢 高 | TS | 代码 | github.com/Codesteward/codesteward |
| 12 | ai-legal-claude | 产品 | 1,606 | API 实测 | 🟢 高 | Python | 法律 | github.com/zubair-trabzada/ai-legal-claude |
| 13 | FAROS | 框架 | 3,124 | API 实测 | 🟢 高 | Python | 科研 | github.com/OpenNSWM-Lab/FAROS |
| 14 | OpenReviewer | 产品 | 14 | API 实测 | 🟢 高 | Python | 学术 | github.com/maxidl/openreviewer |
| 15 | Eureka ML Insights | 框架 | 185 | API 实测 | 🟢 高 | Python | 评估 | github.com/microsoft/eureka-ml-insights |
| 16 | PromptKit | 工具 | 91 | API 实测 | 🟢 高 | — | Prompt | github.com/microsoft/PromptKit |
| 17 | AuditPilot | 产品 | 1,164 | API 实测 | 🟢 高 | — | 审计 | github.com/Ricky-7-Yan/intelligent-audit-system |
| 18 | mission-control | 产品 | 5,905 | API 实测 | 🟢 高 | — | 平台 | github.com/builderz-labs/mission-control |
| 19 | Agentic-Research-Paper-Evaluator | 产品 | 1 | API 实测 | 🟢 高 | — | 学术 | github.com/DINAKAR-S/Agentic-Research-Paper-Evaluator |
| 20 | ChatEval | 框架 | 341 | API 实测 | 🟢 高 | — | 评估 | github.com/thunlp/ChatEval |
| 21 | LangGraph | 框架 | 38,715 | API 实测 | 🟢 高 | Python | 编排 | github.com/langchain-ai/langgraph |
| 22 | Semantic Kernel | 框架 | 28,409 | API 实测 | 🟢 高 | 多语言 | 编排 | github.com/microsoft/semantic-kernel |
| 23 | AutoGen | 框架 | 60,175 | API 实测 | 🟢 高 | Python | 编排 | github.com/microsoft/autogen |
| 24 | Dify | 平台 | 151,130 | API 实测 | 🟢 高 | — | 编排 | github.com/langgenius/dify |
| 25 | CrewAI | 框架 | 56,529 | API 实测 | 🟢 高 | Python | 编排 | github.com/joaomdmoura/crewAI |
| 26 | Pydantic AI | 框架 | 19,017 | API 实测 | 🟢 高 | Python | 编排 | github.com/pydantic/pydantic-ai |
| 27 | LlamaIndex Workflows | 框架 | 51,324 | API 实测 | 🟢 高 | Python | 编排 | github.com/run-llama/llama_index |
| 28 | Haystack 2.x | 框架 | 26,092 | API 实测 | 🟢 高 | Python | 编排 | github.com/deepset-ai/haystack |
| 29 | LangFlow | 工具 | 152,767 | API 实测 | 🟢 高 | — | 编排 | github.com/langflow-ai/langflow |
| 30 | DSPy | 框架 | 36,558 | API 实测 | 🟢 高 | Python | 优化 | github.com/stanfordnlp/dspy |

**置信度说明（v1.2）：**
- 全部 30 项均为 GitHub API 实测，核验日期 2026-08-03
- v1.1 曾将 MetaGPT/TradingAgents 标注为"量级复核（~50k/~15k）"系误判，v1.2 已按 API 实测修正（69,641 / 95,389）

---

## 附录 B：搜索关键词与方法

### 搜索关键词

**多 Agent 辩论方向：**
- `multi-agent debate LLM`
- `multi-agent deliberation consensus`
- `multiagent debate Du et al 2023`
- `agent debate framework`
- `LLM peer review multi-agent`

**AI 文档评审方向：**
- `AI architecture review multi-criteria scoring`
- `AI proposal review automated scoring rubric`
- `LLM as a judge multi-dimensional scoring`
- `automated peer review AI academic papers`
- `rubric-based evaluation LLM agent`

**Agent 编排方向：**
- `multi-agent orchestration state machine checkpoint`
- `LLM workflow engine state machine HITL`
- `LangGraph multi-agent workflow`
- `agent orchestration framework 2024 2025`

**商业 SaaS 方向（v1.1 新增）：**
- `Notion AI document review enterprise`
- `飞书 钉钉 文档智能评审 AI`
- `Confluence Atlassian Intelligence review`
- `multi-agent LLM cost token budget estimation`
- `LLM-as-a-Judge bias calibration Zheng`

### 调研方法

1. **多维度并行搜索：** 同时从"多 Agent 辩论"、"AI 文档评审"、"Agent 编排"、"商业 SaaS"四个方向搜索
2. **GitHub API 验证：** 通过 GitHub API 获取真实 star 数和描述
3. **README 深度阅读：** 对 Tier 1 项目完整阅读 README 和核心代码
4. **对比分析：** 构建能力矩阵进行系统化对比
5. **商业桌面调研：** v1.1 新增，扫描办公套件 AI 和 SaaS 竞争格局

### 数据局限性说明

- 附录 A 全部 30 项 star 与 URL 已于 2026-08-03 经 GitHub API 实测复核（v1.2 数据层消毒），明细见《verified-facts-20260803.md》
- 各项目"核心机制 / 借鉴价值"等叙述性内容基于 README 与二手资料，未逐条深入源码验证，需在执行阶段 1 考古学习时确认
- 论文引用核验日期统一标注在论文引用表中

---

## 附录 C：评审反馈响应追踪

> **本节为 v1.1 新增，逐条追踪评审反馈的响应情况。**

| # | 评审反馈 | 严重度 | 响应状态 | 响应位置 |
|---|---------|--------|---------|---------|
| 1 | "0 竞品"结论过强，检索范围只覆盖开源+学术 | P0 | ✅ 已修正 | 结论 1 收窄 + 第七节商业扫描 + 第八节需求侧证据 |
| 2 | 评分可信度验证缺失 | P0 | ✅ 已新增 | 第九节 评分可信度验证方案 |
| 3 | 自研状态机 vs LangGraph 口径矛盾 | P0 | ✅ 已修正 | 13.2 改为"借鉴模式非换库" + 阶段 2 Go/No-Go 决策门 |
| 4 | 商业 SaaS/办公套件/应用市场未覆盖 | P1 | ✅ 已新增 | 第七节 商业与平台侧竞争扫描 |
| 5 | 缺评审成本/延迟预算模型 | P1 | ✅ 已新增 | 第十节 评审成本模型与分层策略 |
| 6 | 行动方案缺市场验证动作 | P1 | ✅ 已新增 | 阶段 1.2 市场验证（5–10 人访谈 + 竞品试用） |
| 7 | 事实核查（star/URL/拼写） | P1 | ✅ v1.2 已复核 | 附录 A 全部 30 项 API 实测（2026-08-03）；ChatEval → thunlp/ChatEval；3.1 拼写修正 |
| 8 | 执行摘要结论 3 口径矛盾 | P2 | ✅ 已修正 | 结论 3 改为"可组合能力"表述 |
| 9 | PaperJury 应升 P0 | P2 | ✅ 已调整 | 考古优先级：PaperJury 升 P0 |
| 10 | 缺 LLM-as-a-Judge/Anthropic/Generative Agents 文献 | P2 | ✅ 已补充 | 12.2 新增 5 篇论文 |
| 11 | 附录 A star 列大量未填充 + 3.1 OpenRevw 拼写 | P2 | ✅ v1.2 已补齐 | 附录 A 全部 30 项填入实测 star；3.1 拼写修正为 OpenReviewer |

### 交付标准 Checklist（评审人提供，逐项确认）

> **v1.2 补充：** v1.1 将 TradingAgents/MetaGPT 的 star"量级复核"为 ~15k/~50k 系训练知识误判（API 实测为 95,389/69,641）；ChatEval 地址在 v1.1 中被"修正"至另一错误地址（THUDM/ChatEval，404），v1.2 已修正为 thunlp/ChatEval（341★）。

- [x] 结论 1 已收窄为"开源/学术范围内"表述，且附"商业 SaaS / 办公套件 / 应用市场"扫描章节
- [x] 新增"需求侧证据"章节（第八节，含警示信号和市场验证缺口）
- [x] 新增"评分可信度验证方案"（第九节：gold standard + 一致性指标 + 通过阈值）
- [x] 9.2 已改为"借鉴模式而非更换实现"，阶段 2 评估含语言边界与 Go/No-Go 决策门
- [x] 新增"评审成本模型 + 快速档/深度档分层策略"（第十节）
- [x] 行动方案包含市场验证动作（5–10 个目标用户访谈/试用）
- [x] 附录 A 全部 30 项：star/URL 已 API 实测复核、置信度已标注（v1.2）
- [x] ChatEval URL 已修正为 thunlp/ChatEval（API 实测 341★，2026-08-03）
- [x] TradingAgents 95,389★ / MetaGPT 69,641★ 已 API 实测确认（v1.2 修正 v1.1 量级误判）
- [x] OpenReviewer 拼写已修正为 OpenReviewer
- [x] 执行摘要结论 3 口径已修正为"组合能力"表述
- [x] 文档头已注明"v1.1（按评审反馈修订，2026-08-03）"

---

> **文档版本：** v1.2（数据层核验修订，2026-08-03）
> **上一版本：** v1.1（2026-08-03，数据层已消毒）
> **下一步行动：** 提交专家评审 v1.2 → 根据反馈调整 → 执行阶段 1