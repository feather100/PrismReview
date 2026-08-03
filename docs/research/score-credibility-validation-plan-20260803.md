# 评分可信度验证方案（Score Credibility Validation Plan）

> **版本：** v1.0（2026-08-03）
> **依据：** 《20260803-competitive-landscape-research.md》v1.2 第九节 + 《phase1-design-patterns-20260803.md》模式 N/O/P + 现状代码核对
> **定位：** 阶段 3 P0 前置交付物；T3（评分纪律）与 T10（校准对照）的验收基准
> **一句话：** 用"人工专家 gold standard 对照"证明 PrismReview 的加权多维评分可信，并把可信度做成产品特性。

---

## 一、问题与目标

### 1.1 为什么必须做

企业 CTO/PMO 用 LLM 分数做决策的第一问题是"分数凭什么可信"。没有验证协议，加权多维评分只是装饰性数字（v1.2 第九节原话）。这也是目标用户访谈中预判的头号疑虑（访谈提纲 4.2/4.4）。

### 1.2 目标

1. 建立可复现的验证协议：gold standard → 一致性指标 → 通过阈值 → 持续监控；
2. 工程上落实"评分纪律"（防通胀）与"AI-人工对照"（可解释）；
3. 把验证结果变成**对外证据**（如"与 100 份人工评审相关性 ρ=0.8"）——这是销售话术的一部分。

### 1.3 现状基础（不重复造）

- ScoringService 已有：加权总分、riskPenalty、confidenceAvg、ConfigSnapshot 审计快照（scoring.service.ts）；
- QualityService 已有评测基础设施（quality.service.ts，703 行）；
- 考古已确认可借鉴参数：AssessmentAI 的 `|AI−人工|>15` 与相似度 <0.40、Lavern 的每条意见 confidence 字段、manuscript 的"默认 5–6 分"纪律。

---

## 二、阶段 A：构建 Gold Standard（目标 2–3 周，可与 P0 任务并行）

| 步骤 | 内容 | 产出 | 责任人 |
|------|------|------|--------|
| A1 选文档 | 10–20 份真实方案/架构/需求文档（覆盖 3+ 行业、不同篇幅与复杂度；建议先凑 5 份启动） | 文档清单（含脱敏） | 团队 + 用户提供 |
| A2 定维度 | 采用 enterprise workflow 的 scoringWeights 维度作为评分口径（与产品一致，避免"验证口径 ≠ 产品口径"） | 维度定义 v1 | 团队 |
| A3 人工评分 | 3 位领域专家独立盲评（互不可见）；每位给出维度分 + 总体分 + 关键意见 | 人工评分矩阵 | 3 位专家 |
| A4 一致性检验 | 计算人工间一致性（Fleiss κ；若 κ < 0.6：先对齐 rubric 再重评，不进入下一步） | 一致性报告 | 团队 |

**启动门槛：** 完成 5 份文档 + 3 位专家 + κ ≥ 0.6 即可进入阶段 B（不必等满 20 份）。

---

## 三、阶段 B：指标与通过阈值（验收基准）

| 指标 | 定义 | 通过阈值 | 计算位置 |
|------|------|---------|---------|
| **Spearman ρ** | AI 评分与人工总体分的等级相关 | ≥ 0.70 | quality.service 新增 |
| **MAE** | 平均绝对误差（换算到 100 分制） | ≤ 10.0 | quality.service 新增 |
| **Kendall W** | 3 位人工间一致性（AI 报告应不高于此上限，即"AI 分差不能比人还飘"） | ≥ 0.60 | 人工矩阵 |
| **Calibration** | 置信区间覆盖率（AI confidence 与实际命中率一致） | ≥ 80% | quality.service 新增 |
| **Bias 检测** | 位置偏好/冗长偏好/self-enhancement（Zheng et al. 2023） | 无显著偏差 | 评分纪律模块 |

**附加工程检查（T3 落地）：**
- 分数通胀：`above70Pct ≤ 0.30`（10 分制映射 70 分以上占比），超限出 inflationWarning；
- 高分论证：70 分以上维度必须附带理由（prompt 纪律 + 校验）。

---

## 四、阶段 C：验证执行（3 轮）

| 轮次 | 内容 | 通过条件 | 说明 |
|------|------|---------|------|
| Round 1 | 全量 gold standard 跑 AI 评分（mock + 真 LLM 各一次） | 输出全部指标 | 记录 baseline；mock 与 llm 分开看 |
| Round 2 | 分析失败案例 → 调整 prompt/权重/纪律参数 | 指标改善（ρ↑、MAE↓） | 每次调整写版本化 prompt 记录（复用 prompt 注册表） |
| Round 3 | 新一批文档（gold standard 之外的 5 份）泛化测试 | 指标不低于 Round 2 | 防过拟合验证集 |

**mock 与 LLM 双轨：** mock 路径的评分是确定性的（用于 CI 与回归）；LLM 路径是产品真实路径。两条都要跑指标，报告注明 provider。

---

## 五、阶段 D：持续监控（上线后）

| 机制 | 频率 | 触发动作 |
|------|------|---------|
| 评分漂移检测 | 每月用 gold standard 子集重跑 | ρ 下滑 > 0.05 → 冻结 prompt 版本并告警 |
| 人工抽检 | 5–10% 线上评审人工复核 | 发现系统性偏差 → 回滚 prompt / 调权重 |
| 用户反馈闭环 | 持续 | 用户对分数的纠正写入校准集（逐步扩充 gold standard） |
| 分布监控 | 每评审 | 分数分布异常（通胀/塌缩）→ inflationWarning 进审计 |

---

## 六、工程落地清单（对应任务清单）

| # | 工程项 | 任务 | 涉及文件 |
|---|--------|------|---------|
| 1 | 评分纪律（默认锚定 + 分布约束 + 通胀检测） | T3 | workflow/registry + scoring/service |
| 2 | 校准 run（AI-人工对照 + 阈值标记） | T10 | quality/service + knowledge |
| 3 | confidence 字段贯通（每条维度分带置信度与依据） | T1/T4 | scoring + opinion + reporting |
| 4 | 观察-判断分离（评分来自 scoring pass） | T4 | orchestrator + moderator + scoring |
| 5 | 对照结果可导出（证据页/白皮书素材） | T10 | reporting |

**数据模型增量（prisma）：**
- `EvaluationRun`：{ id, reviewIds, provider, metrics(JSON), status, createdAt }；
- `EvaluationResult`：{ runId, documentId, humanScore, aiScore, delta, similarity, flagged }；
- Review 表加 `calibrationSnapshotId?`（可选，标注该评审使用了哪套校准锚点）。

---

## 七、里程碑与验收

| 里程碑 | 时间 | 验收 |
|--------|------|------|
| M1：gold standard ≥5 份 + κ ≥ 0.6 | 2–3 周内 | 一致性报告 |
| M2：Round 1 baseline 指标 | 依赖 T3/T4 完成 | 指标表（mock + llm 双轨） |
| M3：Round 2 达标（ρ ≥ 0.70, MAE ≤ 10） | M2 + 1–2 周 | 指标 + prompt 版本记录 |
| M4：Round 3 泛化 + 持续监控上线 | M3 + 1 周 | 泛化报告 + 监控脚本 |

**对外产出：** 一份《评分可信度白皮书》（方法 + 指标 + 案例），供市场/销售使用——这就是"评分可信度"从工程能力变成商业壁垒的那一步。

---

## 八、风险与对策

| 风险 | 对策 |
|------|------|
| 人工专家难找/成本高 | 先 3 位内部专家 + 5 份文档起步；白皮书阶段再引入外部专家背书 |
| κ 达不到 0.6（rubric 不清） | 先做 rubric 对齐工作坊（维度定义 + 示例打分），再正式盲评 |
| LLM 路径指标不稳定（模型更换） | prompt 版本化 + 每次升级跑 Round 1 回归 |
| 泛化失败（过拟合验证集） | Round 3 用全新文档；gold standard 持续扩充 |
| 分数通胀顽固 | 强纪律（T3）+ 通胀检测告警 + 必要时重训权重 |

---

> **文档版本：** v1.0（2026-08-03）
> **下一步：** 启动 gold standard 收集（5 份文档 + 3 位内部专家）与 T1–T4 工程改造并行；M1 与 M2 在同一 Sprint 收尾。
