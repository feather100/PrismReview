# Sprint 11.0 总结（调研 → 评审 → 阶段 3 落地 T1–T6）

> **版本：** v1.0（2026-08-03）
> **范围：** 从竞品调研评审起步，到 Phase 3 六项 P0 工程任务全部落地并合入 main
> **main：** `473e1a3`（tsc 0 error / jest 182/182 / DB 迁移 16/16）

---

## 一、时间线（2026-08-03 一天内）

```
调研报告评审 → 数据层消毒（GitHub API 全量核验）
→ 考古（6 仓库/15 模式）→ 任务清单（T1–T14）
→ Sprint 10.1 收口 → 分支合并（策略 B）
→ T1 意见生命周期 → T2 收敛信号 → T3 评分纪律
→ T4 评分 pass → T5 按动作降级 → T6 成本硬闸
→ polish（mock stance / gold-standard kit / 卫生+纪律）
→ DB 迁移实跑 → T7 交接沉淀
```

## 二、交付资产

| 类别 | 内容 |
|------|------|
| 调研/决策 | `docs/research/` 8 份（调研报告 v1.2、评审反馈、verified-facts、设计模式、任务清单、评分验证方案、gold-standard kit、访谈提纲） |
| 工程功能 | T1 意见生命周期/去重；T2 收敛三选一；T3 评分纪律/通胀检测；T4 观察-判断分离；T5 按动作降级；T6 成本硬闸 |
| 测试 | jest 53 → **182**（每任务追加 11–21 例），tsc 0 error |
| 数据库 | Postgres 迁移 16/16 实跑（含 T1/T2/T4 + Sprint 10.1），数据无损 |
| 运维 | `Deployment_Migration_Checklist.md`（15 迁移总表 + 执行/验证/风险） |
| 协调 | ACTIVE_SPRINT + Continuity_Handoff + T1–T6 交付文档 |
| 安全 | Sprint 10.1 Round 3 收口（P0-4 等 4 项修复 + 回归测试） |

## 三、关键决策与教训（沉淀）

1. **数据可信**：调研 agent 在检索 0 结果时用训练知识冒充"实测"，导致 star/URL 系统性错误 → 确立 `verified-facts` 唯一基线 + CONTRIBUTING 四条纪律（实测须可复现 / 0 结果必停 / 基线唯一 / Checklist 真实）。
2. **架构**：自研状态机**不迁移** LangGraph（只吸收 checkpoint/interrupt 模式）——T1/T2 均按此落地，老测试全绿验证向后兼容。
3. **评分语义修正**：confidenceScore 原是"评审员自评"却当"维度质量分"用（通胀源）→ T4 引入 `score`（Moderator 评分 pass），聚合时 score 优先。
4. **成本与收敛**：成本超限 = 强制收敛（产出报告），与 maxRounds 的 force_stop（abort）语义分离——企业场景"花超了也要有交付物"。
5. **合并顺序**：T 链（main 祖先）可快进；Sprint 10.1 与 T 链改同一批文件 → 单独合并 + 冲突手工解决；**新任务务必先建分支**（T5/T6 曾误直接提交 main）。
6. **迁移是雷**：migrations 被 gitignore 且本地从未实跑 → 用 Docker 实跑闭环 + 出清单；建议后续取消 gitignore。

## 四、当前系统状态

- **评审主链路**：诊断 → 角色选择 → 多轮辩论（T2 收敛三选一）→ 收敛 → ScoringPass（T4）→ finalize（T1 去重）→ 加权评分报告（T3 纪律 + T6 成本审计）；
- **降级与安全**：provider 按动作降级（T5）+ fail-closed（Sprint 10.1）+ 成本上限（T6）；
- **测试**：182 单测全绿；e2e 冒烟待跑（DB 已就绪）。

## 五、遗留事项与下一步

- **P1 任务**：T7 可升级辩论（下一步）→ T8 风险分级 HITL → T9 段落锚点 → T10 校准对照 → T11 并发加固；
- **数据**：gold standard 人工收集（5 份文档 + 3 专家，工具包已就绪）；
- **运维**：migrations 入库讨论、CI 迁移检查、e2e 冒烟。

---

> **一句话沉淀：** 从"一份不可信的调研报告"到"评分可信、收敛显式、成本可控、可审计的评审引擎"，一天内完成 P0 六项——下一步是 P1 的可升级辩论与人工衔接。