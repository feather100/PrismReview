# 06. Agent Orchestration Spec

## 1. Agent 体系

### 1.1 预置角色

| 代号 | 名称 | 核心视角 |
|---|---|---|
| CTO | 技术审核员 | 架构、可行性、性能、安全、技术债务 |
| CFO | 商业控制者 | 投入产出、预算、ROI、商业风险 |
| PMO | 交付守护者 | 排期、资源、依赖、延期风险 |
| Compliance | 合规审查员 | 法规、隐私、安全制度、许可证 |
| UserAdvocate | 用户代言人 | 体验、认知负荷、门槛、可用性 |

### 1.2 Agent 输入

- 方案全文或摘要。
- 一句话评审目标。
- 当前会议模式与阶段。
- 当前 Agent 角色配置。
- 角色挂载知识库检索结果。
- 已完成发言摘要（视会议模式决定是否注入）。
- 用户干预条件。

### 1.3 Agent 输出

必须结构化：

- 审查维度。
- 风险等级。
- 具体问题。
- 证据引用。
- 改进建议。
- 信心指数。
- 理由摘要。

## 2. Chairman 职责

Chairman 是编排者，不是万能裁判。

| 阶段 | 职责 |
|---|---|
| 预扫描 | 摘要方案、领域标签、风险维度、推荐角色 |
| 组局 | 根据用户调整生成会议计划 |
| 会议中 | 调度发言、检测新观点、处理干预、控制轮次 |
| 汇总 | 聚合意见、去重、冲突归纳、生成报告大纲 |
| 质量控制 | 标记低信心、超时、不完整、引用不足意见 |

## 3. 会议状态机

```text
created
→ diagnosing
→ role_selection
→ ready
→ running
  → phase_started
  → agent_turn_queued
  → retrieving_context
  → generating_output
  → validating_output
  → turn_completed
→ summarizing
→ report_ready
```

异常分支：

```text
running → interrupted → running
running → failed → summarizing_partial
```

## 4. 会议模式 MVP

### 4.1 Round-Robin

- Agent 按权重降序依次发言。
- 不注入其他 Agent 发言，保证独立视角。
- 所有 Agent 完成后 Chairman 汇总。
- 单 Agent 超时 120 秒。

### 4.2 Free Debate

- 首轮按 Round-Robin 输出初始意见。
- Chairman 聚合冲突点。
- 后续最多 5 轮，每轮选择最相关 Agent 发言。
- 连续 2 轮无新观点时结束。
- 允许撤回意见，但保留审计记录。

## 5. P1 模式预留

### 5.1 Blind Consensus

- 并行盲审。
- 输出评分卡。
- 计算分歧指数。
- 高争议维度进入专项讨论。

### 5.2 Red Team vs Blue Team

- Chairman 按倾向分组。
- 红队攻击，蓝队防守。
- 3 轮后输出对抗总结。

## 6. RAG 注入策略

检索 Query 组成：

```text
{review_objective}
{agent_dimension_focus}
{current_phase_question}
{document_summary_keywords}
```

Top-K 建议：

- MVP：Top 5 chunks。
- 每个 chunk 限制 800-1200 字。
- 优先已审核 chunk。
- 废弃 chunk 不参与检索。

## 7. 信心指数规则版

MVP 先采用规则计算：

```text
confidence = base
  + citation_score
  + retrieval_relevance_score
  + cross_agent_support_score
  + role_knowledge_score
  - hallucination_risk_penalty
  - schema_repair_penalty
  - timeout_penalty
```

建议权重：

| 因子 | 分值 |
|---|---:|
| 基础分 | 50 |
| 有 ≥1 条高相关引用 | +15 |
| 引用来自已审核知识条目 | +10 |
| 被其他 Agent 独立支持 | +10 |
| 角色专属知识命中 | +5 |
| 无引用但做强断言 | -20 |
| 输出经 schema repair | -10 |
| Agent 超时或部分输出 | -15 |

分段展示：

- 80-100：高可信。
- 60-79：中可信。
- 0-59：低可信，需人工确认。

## 8. Prompt 模板约束

所有 Prompt 应模板化并版本化：

```text
/system
你是 {role_name}，你的职责是 {role_mission}。
你必须从以下维度审查：{dimensions}。
你必须输出 JSON，遵循 schema：{output_schema}。
不得编造知识库引用。没有证据时 citations 为空，并降低 confidence_score。

/user
评审目标：{objective}
方案内容摘要：{document_summary}
相关知识库片段：{retrieved_chunks}
会议上下文：{meeting_context}
用户新增条件：{human_interventions}
```

## 9. 质量防线

- JSON Schema 校验。
- 引用 ID 必须存在且属于当前租户可访问范围。
- 风险等级必须枚举化。
- 强制填充 recommendation。
- 低信心意见进入报告第六章。
- 超时或失败 Agent 不阻塞全局，但报告标注完整性风险。

## 10. AI 评测集

建议建立 `tests/evaluation`：

- 10 份技术方案。
- 5 份产品方案。
- 5 份合规敏感方案。
- 每份方案人工标注：关键风险、期望角色、不可接受幻觉。
- 每次 Prompt/模型升级跑回归评测。
