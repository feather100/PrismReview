# 阶段 1 考古：设计模式提取报告

> **考古日期：** 2026-08-03
> **考古对象：** 6 个仓库（v1.2 阶段 1 清单：P0 ×3 + P1 ×3）
> **方法：** clone 全部仓库 → 精读核心编排/评审代码 → 逐条对照 v1.2 中"README 声称"与"源码实际"
> **基线文档：** 《20260803-competitive-landscape-research.md》v1.2 + 《verified-facts-20260803.md》
> **用途：** 作为 PrismReview 阶段 3"聚焦壁垒"与 P6 规划的设计输入

---

## 〇、考古清单与版本

| 优先级 | 仓库 | commit | 日期 | 核心文件 |
|--------|------|--------|------|---------|
| P0 | pr-review-agent-council | da4144a | 2026-05-24 | agents/review_agent.py（4709 行） |
| P0 | lavern | 9d32167 | 2026-07-26 | src/dispatch.ts / src/workflows/executor.ts / src/types/verification.ts |
| P0 | paperjury | fdb1d34 | 2026-06-30 | references/review-engine-v3.md / references/spine.md |
| P1 | manuscript-review-skill | b96f135 | 2026-07-16 | SKILL.md / references/agent-profiles.md |
| P1 | AssessmentAI | 4e5b371 | 2026-06-21 | pipeline_graph.py / config.py |
| P1 | solutioning-room | f1754ec | 2026-07-08 | orchestrator.py / blackboard.py |

---

## 一、总览：六个仓库各贡献了什么

| 仓库 | 一句话结论 | 最值得吸收的模式 |
|------|-----------|-----------------|
| PR Council | 意见级状态机 + 动态辩论动作分发 + 确定性降级链 | **FindingLifecycle**、**debate action dispatcher**、**LLM 不可用时的确定性降级** |
| Lavern | 模板化 workflow + 10-pass 验证 + 加权总分报告 | **workflow registry/通用执行器**、**overallScore = 各 pass 加权平均**、**置信度路由人工门控** |
| PaperJury | 确定性脚本与语义 workflow 分离 + 陪审团审判机制 | **passage_id 段落级锚点**、**trial 审判 + quorum + 升级**、**ledger 单一事实源** |
| manuscript | 高规格 persona 工程 + 评分纪律 | **persona 模板（人设叙事+清单+示例）**、**默认 5–6 分防通胀** |
| AssessmentAI | 观察与判断分离 + 校准上下文 + HITL 阈值 | **reasoning 无分 → scoring 基于 reasoning**、**人工锚定样本注入**、**|AI−人工|>15 自动标记** |
| Solutioning Room | 防锚定开场 + @mention 协议 + AGREE 共识判定 | **独立开场立场**、**全员最近一轮 AGREE = 收敛**、**blackboard 滚动窗口** |

---

## 二、逐仓库分析

### 2.1 PR Review Agent Council（P0）

**README 声称 vs 源码实际：** 全部核实。FindingLifecycle、Debate Council Loop、AI Judge、EvidenceStore、Transcript 均存在。

**模式 A：FindingLifecycle 意见级状态机（review_agent.py L546–641）**

```
candidate(finding, proposed_by)
  ├─ 内容键去重：(file, line, category, title) → 同一键直接返回已有 finding
  ├─ challenge(finding_id, by, reason)   → challenged
  ├─ accept / reject / downgrade(severity)
  └─ revise(finding, reason)             → 回到 candidate（resolution="revised"）
```

要点：
- **每次状态迁移都带 reason 并写 transcript 事件**（可审计）；
- **去重是内容键而非 ID**——多 reviewer 提出同一问题时自动归并（噪声控制的核心）；
- downgrade 保留原 finding 但改 severity，不丢历史。

**模式 B：Debate action dispatcher（L3478–3540）**

Lead Debate Controller 输出一个 action，由 dispatcher 分发，共 9 种动作：
`ask_critic / request_reviewer_defense / request_more_evidence / revise_finding / merge_duplicates / accept_finding / reject_finding / ask_report_writer / finalize`。

- 每个 action 都返回 `{type, ok, error}`（统一结果信封，异常不炸流程）；
- **merge_duplicates** 直接把 source 标记 rejected + 记录合并证据 + 通知报告器；
- **revision 由控制器提出**，不是 reviewer 自己改（保持中心化）。

**模式 C：确定性降级链（L3447–3468）—— 与 PrismReview"失败降级 mock"直接对应**

LLM 辩论动作不可用时，按确定性顺序兜底：
`未处理 candidate → ask_critic（一次）→ 未解决 → accept_finding → 全部解决 → finalize`。

启示：PrismReview 当前是"整体降级到 mock"；可升级为**按动作降级**——只有 Moderator 决策降级，reviewer 意见仍走真实调用，减少质量损失。

**模式 D：辩论状态压缩（L3428–3445）**

传给 LLM 的状态不是全量历史，而是：findings（含证据链）+ 最近 30 条消息 + 最近 10 条观察 + 质量目标字符串（"maximize true critical coverage while minimizing duplicates, unsupported claims, and severity inflation"）。

启示：PrismReview 的 rolling summary 可增加**显式质量目标注入**，让 Moderator 每次决策都带上同一目标。

### 2.2 Lavern（P0）

**README 声称 vs 源码实际：** 核实。67 专家（59 专家 + 7 编排器）来自 agents/prompts 目录逐一命名；10-pass verification pipeline 在 types/verification.ts 完整定义；workflow 模板注册表（8 个模板）在 src/workflows/templates/。

**模式 E：Workflow registry + 通用执行器（dispatch.ts + workflows/executor.ts）**

`dispatch()` → `routeRequest()`（LLM 或确定性路由）→ `workflowRegistry.get(id)` → `runGenericWorkflow()`。8 个模板（counsel/review/adversarial/roundtable/full-bench/legal-design/pre-engagement/verification）全部走同一个执行器，无特例路径。

启示：PrismReview 的 4 预设 workflow 可以升级为**模板注册表 + 请求分类器**（LLM 分类：requestType/complexity/riskLevel → selectedWorkflow），而不是硬编码分支。

**模式 F：10-pass 验证 + 加权总分（types/verification.ts）—— 加权多维评分的直接范本**

```
VERIFICATION_PASS_NAMES = context, ux, clarity, structure, accuracy,
                          completeness, risk, formatting, legal_design, delivery
PassResult = { pass, status, score(0.0–1.0), findings[], criticalCount, majorCount, minorCount }
VerificationReport = { verdict: PASS|CONDITIONAL_PASS|FAIL,
                       overallScore: "Weighted average of pass scores", ... }
```

每条 finding 带：pass / severity(critical|major|minor) / location / description / evidence / suggestion / **autoFixable** / **confidence(0–1)**。

启示：PrismReview 的加权多维评分应补齐两样 Lavern 已有而我们没有的：**每条意见的 confidence** 与 **autoFixable 标记**（决定意见进"待人工处理"还是"可直接采纳"）。

**模式 G：置信度路由人工门控（orchestrator prompt 第 4 步）**

人工门控**不是全流程必过**，而是"如果 RED ethics findings 则请求批准（confidence-routed）"。配合 `intensity`（engagement 强度）→ effort/团队规模/门控频率/预算的映射，以及 `yoloMode`（自动批准所有门控）。

启示：PrismReview 的 HITL 可改为**按风险分级触发**（低风险自动过、高风险才中断），并引入强度档位（与 v1.2 第十节"快速/标准/深度档"呼应，Lavern 已有工程实现先例）。

**模式 H：会话级状态隔离 + 预算硬闸**

SessionState 持有全部状态；MCP server / audit hooks / cost hooks / gate hooks 全部**按会话工厂创建**（避免跨会话泄漏）。`maxBudgetUsd` 在 cost hooks 中执行（超出即 halt）。

### 2.3 PaperJury（P0）

**README 声称 vs 源码实际：** 核实。review → verdict → revise → verify 多轮引擎、deliberation（trial 审判）、risk-tiered guardrails（风险分级门控）、dogfood 样本（samples/dogfood/ 含前后 PDF + RUN_REPORT）均存在。

**模式 I：确定性脚本与语义 workflow 分离**

12 个确定性脚本（decompose/ledger/journal/apply-patch/anchor-diff/cross-ref/spine/compile-guard/compliance-check/rekey 等）在 orchestrator 侧跑；10 个语义 workflow（assign-reviewers/reading-check/coverage-auditor/merge/trial/polish/recall-audit/drafter/edit-audit/meaning-audit）做语义扇出。**workflow 之间不互相 import，通过 ledger 传数据**。

启示：PrismReview 可把"确定性检查"（schema 校验、引用解析、去重、段落定位）与"语义评审"（意见生成、辩论、收敛）分层，确定性层用代码保证，语义层只做判断。

**模式 J：段落级锚点 passage_id（decompose.js）**

把文档切成 reading units + 带稳定 `passage_id` 的段落（`frontmatter#p1#<hash>`），作为防漂移基底与引证锚点。

启示：PrismReview 的"来源可观测"可从 provider 级（mock/llm 来源）**增强到段落级**：每条意见锚定 passage_id + 引用原文片段，报告可直接跳转原文。

**模式 K：trial 审判机制（5 层→可升级 12 人陪审团）**

`whole-paper defense → local-context jury（5）→ quorum/majority → 未决则 escalate 到 12`。verdict 空间：`invalid-drop / valid-fixable / author-required / escalate`。共识过滤：`tally.valid >= 0.8 × jury_size` 才算强共识。

启示：PrismReview 的 Moderator 收敛可引入**可升级辩论**：常规轮次内意见未收敛 → 触发更大规模陪审团/更多轮次 → 仍不收敛则 escalate 给人工。这比"固定 max_rounds 后强制停止"更接近真实评审。

**模式 L：意义审计四态（spine.md）**

`holds / weakened / contradicted / now-unsupported`——区分"措辞软化"与"支撑证据消失"两种不同失败。

启示：若 PrismReview 将来支持"评审 → 修订 → 复评"闭环，这四态可直接用作复评意见的状态机。

### 2.4 manuscript-review-skill（P1）

**README 声称 vs 源码实际：** 核实。6 角色面板、双语标注 docx、评分矩阵（内嵌 [Score: X/10]）、优先级分级（Critical/Major/Minor）均存在。

**模式 M：persona 工程模板（agent-profiles.md）**

每个 agent 包含五件套：**色彩编码**（UI 区分）、**人设叙事**（"A senior editor who has handled 500+ manuscripts…"）、**逐维度检查清单**（exhaustive checklist）、**must-ask 问题**（每段必答）、**"带牙的批评"示例**（具体到引用原文的示范批评）。

启示：PrismReview 的 CTO/CFO/PMO persona 应升级为同样结构，特别是**检查清单**（把"这个角色看什么"显式化）与**示例批评**（Few-shot，显著提升意见质量）。

**模式 N：评分纪律（SKILL.md L141, L205）**

- **校准原则**：分数对标"目标期刊 top 10% 被接受论文"的标准；
- **默认假设**：一段内容默认 5–6 分（adequate but needs improvement），**没有充分理由不许给 7+**——直接对抗 LLM 分数通胀。

启示：这是"评分可信度"的第一道工程防线，比事后相关性验证更便宜。PrismReview 应在 workflow 模板里内置"分数分布约束 + 默认锚定"，并在第九节验证方案中把"分数通胀检测"作为指标之一。

### 2.5 AssessmentAI（P1）

**README 声称 vs 源码实际：** 核实。7 节点 LangGraph、criterion weights、AI+人工对比、HITL 异常标记均存在。注意：README 说"criterion weights 可配置"，但 config.py 里是**四等权 25×4**（权重配置框架在，实际为等权）。

**模式 O：观察与判断分离（pipeline_graph.py L125–170）**

Node 2 reasoning 只产出**不带分数的结构化观察**（"Separates observation from judgment, reducing anchoring bias"）；Node 3 scoring 基于 reasoning log 打分（"Grounded scoring prevents the anchoring bias of direct read-and-score"）。

启示：直接映射到 PrismReview——**先让 Reviewer 产出观察（不带分），再由 Moderator 依据观察聚合打分**，而不是让 Reviewer 边读边打分。

**模式 P：校准上下文 + HITL 阈值（pipeline_graph.py / config.py）**

- calibration_context：人工打过分锚定样本注入 prompt；
- HITL 自动标记阈值：`|AI − 人工| > 15`（百分制）或语义相似度 < 0.40；
- 低温度 0.3 + 算术 moderation pass（USE_REFLECTION，打分后做一次算术一致性检查）。

启示：v1.2 第九节"评分可信度验证"可以直接引用这三项工程化参数作为默认值。

### 2.6 Solutioning Room（P1）

**README 声称 vs 源码实际：** 核实。4 角色、锚定防止、@mention、AGREE、ADR 合成、宪法 guardrails 均存在（guardrails/ 下三个 md 文件加载到 system prompt）。

**模式 Q：防锚定开场 + 共识判定（orchestrator.py）**

- Phase 1：每个 agent **独立陈述开场立场**（看不到别人），然后才进入辩论；
- 共识判定：**全员最近一轮发言均为 AGREE: 前缀 → 辩论结束**；任一实质回复会把该人从 agreed 集合移除（重新入场）；
- @mention 跳到目标发言者；`max_turns` 硬闸后强制进入合成。

启示：PrismReview 的 Moderator 收敛条件可以显式化为"**最近一轮全员 AGREE**"或"**Moderator 判定 no-new-arguments**"两种终止信号，而不是仅靠轮数硬闸。

**模式 R：blackboard 滚动窗口（blackboard.py）**

`max_entries` 窗口 + 老条目弹出；给每个 agent 的转录**排除其自己的发言**（`exclude_agent`）——避免角色与自己历史自我强化。

启示：PrismReview 的上下文压缩可吸收"排除自己历史"策略，减少辩论中的回声效应。

---

## 三、跨项目模式汇总（按 PrismReview 落点分组）

| # | 模式 | 来源 | PrismReview 落点 | 优先级 |
|---|------|------|-----------------|--------|
| 1 | 意见级生命周期 + 内容键去重 | PR Council | 评审意见模型升级（opinion → finding lifecycle） | P0 |
| 2 | 按动作确定性降级（非整体降级） | PR Council | Moderator/provider 降级策略 | P0 |
| 3 | 加权总分 = 各 pass 加权平均 + 每条意见 confidence | Lavern | 加权多维评分引擎补 confidence 字段 | P0 |
| 4 | 默认 5–6 分锚定 + 分数分布约束 | manuscript | workflow 模板内置评分纪律 | P0 |
| 5 | 观察与判断分离（先观察后打分） | AssessmentAI | Reviewer → Moderator 流程改造 | P0 |
| 6 | 共识判定显式化（全员 AGREE / no-new-arguments） | Solutioning Room | Moderator 收敛条件 | P1 |
| 7 | 可升级辩论（5→12 陪审团 / escalate 给人工） | PaperJury | Moderator 收敛 + HITL 升级路径 | P1 |
| 8 | 段落级 passage_id 锚点 | PaperJury | 来源可观测增强（provider 级 → 段落级） | P1 |
| 9 | 置信度路由人工门控 + 强度档位 | Lavern | HITL 按风险分级触发 | P1 |
| 10 | 预算硬闸 maxBudgetUsd + 成本 hooks | Lavern | 成本控制机制（v1.2 10.5 落地） | P1 |
| 11 | 会话级状态隔离 + 按会话工厂 | Lavern | 多租户/并发安全 | P1 |
| 12 | HITL 阈值（|AI−人工|>15 / 相似度<0.40）+ 校准样本注入 | AssessmentAI | 评分可信度验证默认参数 | P1 |
| 13 | 排除自己历史的滚动上下文 | Solutioning Room | 上下文压缩防回声 | P2 |
| 14 | 确定性检查与语义评审分层 | PaperJury | 编排架构分层 | P2 |
| 15 | 意义审计四态（holds/weakened/contradicted/unsupported） | PaperJury | 未来"评审→修订→复评"闭环 | P2 |

---

## 四、对 README 声称的核验修正（回应 v1.2 附录 B 的承诺）

| 仓库 | v1.2 声称 | 源码核验结果 |
|------|----------|-------------|
| Lavern 67 专家 / 10-pass | "67 个专家（59+7）"、"10 轮验证循环" | ✅ 确证：prompts 目录逐一命名；verification.ts 定义 10 pass |
| PR Council FindingLifecycle | "candidate→challenged→accepted→rejected→downgraded" | ✅ 确证 + 发现 revise 第 6 态（回到 candidate） |
| PaperJury dogfood | "附带真实 dogfood 样本" | ✅ 确证：samples/dogfood/ 前后 PDF + RUN_REPORT |
| manuscript 评分矩阵 | "reviewer × section 1–10 分" | ✅ 确证：内嵌 [Score: X/10] + 校准原则 |
| AssessmentAI criterion weights | "可配置评估 persona（含 criterion weights）" | ⚠️ 部分：persona 可配置 ✅；权重目前为 4×25 **等权**（框架有，实为等权） |
| Solutioning Room 共识 | "共识达成后合成 ADR" | ✅ 确证：全员最近一轮 AGREE 判定 + max_turns 兜底 |

---

## 五、对 PrismReview 阶段 3 的落地建议（按 P0 优先）

1. **意见模型升级（P0）**：把现有 opinion 模型升级为 FindingLifecycle 语义（candidate/challenged/accepted/rejected/downgraded + 内容键去重 + 证据链），复用 PR Council 的状态机思路，但落在 NestJS 域模型上；
2. **评分引擎补 confidence（P0）**：每条维度分数带 confidence 与依据（Lavern 模式），报告展示"分数 + 置信度 + 依据引用"；
3. **评分纪律入模板（P0）**：workflow 模板注入"默认 5–6 分锚定 + 分布约束 + 分数通胀检测"；
4. **流程改造（P0）**：Reviewer 先出观察（无分），Moderator 基于观察聚合打分（AssessmentAI 模式）；
5. **降级细化（P0）**：provider/Moderator 按动作降级，而非整体降级到 mock；
6. **收敛显式化（P1）**：Moderator 终止条件 = 全员 AGREE 或 no-new-arguments 或 max_rounds（三选一触发）；
7. **验证方案对齐（P1）**：第九节验证参数直接采用 AssessmentAI 默认阈值 + Lavern confidence 字段。

---

> **文档版本：** v1.0（2026-08-03）
> **下一步：** 据此更新阶段 3 任务清单；《评分可信度验证方案》独立文档建议在 P0 改造后立即起草。
