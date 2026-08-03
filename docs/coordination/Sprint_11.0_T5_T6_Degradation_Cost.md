# Sprint 11.0 — T5+T6: 按动作降级 + 成本硬闸

> **分支：** codex/t5-t6-degradation-cost（基于 main 7535897）
> **基线：** docs/research/phase3-task-list-20260803.md T5（PR Council 模式 C）+ T6（Lavern 模式 H / v1.2 第十节成本模型）
> **日期：** 2026-08-03
> **状态：** ✅ 完成（tsc 0 error / jest 182 全绿，含新增 21 例；无 schema 变更，迁移仍 16/16）

---

## T5 — 按动作降级

### 改动
| 文件 | 改动 |
|------|------|
| provider/degradation.ts（新增） | 纯策略层：`classifyTurnError`（auth/guard → fail_closed；真实 provider 运行时错误 → 单 turn 降级 mock；mock 自失败 → fail_closed）、`DEGRADATION_MATRIX`、`buildTurnObservability` |
| queue/service.ts | catch 分支改用 `classifyTurnError`（语义不变，策略显式化 + 可测）；成功观测带完整 token 明细（T6 输入） |
| tests/degradation-cost.spec.ts（新增） | classifyTurnError 四类 / 矩阵 / observability |

### 语义
- **降级粒度 = 动作**：单个 reviewer 失败只降级该 turn（fallback_mock 有标签，不进真实统计），不拖垮整场；
- Moderator LLM 失败 → MockModerator 确定性决策链（已有，T2 起）；T5 补充测试覆盖 providerSource 标记与审计。

## T6 — 成本硬闸

### 改动
| 文件 | 改动 |
|------|------|
| provider/cost-model.ts（新增） | `estimateCostUsd`（mock/lmstudio/fallback_mock=0；openai_compatible 默认 $1.5/M in + $4/M out，env 可覆盖）、`extractTokens`/`extractProviderName` |
| workflow.registry.ts | `WorkflowConfig.maxCostUsd?` + 4 preset 分档（enterprise 1.0 / code-review 0.5 / research 1.5 / thesis 1.0 USD）+ validateCustom |
| queue/service.ts | 观测对象存 `tokens {prompt, completion, total}` |
| review-orchestrator.ts | `buildState` 从意见 modelOutputRef 聚合 totalTokens/totalCost；`resolveHardGates` 传 `maxCostPerReview: config.maxCostUsd ?? ∞` |
| moderator.ts / llm-moderator.ts | **成本超限 → 强制收敛**（进入评分阶段产出报告，不 abort）；硬闸 force_stop 仅剩 rounds/tokens/turns；审计事件 `review.cost_cap_reached`（AuditService 注入 Moderator 工厂） |
| reviews.module.ts | MODERATOR 工厂注入 AuditService |

### 语义
- **成本上限按 workflow 档位**：企业 1.0 / 代码 0.5 / 科研 1.5 / 论文 1.0 USD；自定义 workflow 缺省不设限；
- **超限 = 强制收敛**：Moderator 决策为 converge（reasoning 标注 cost cap reached），评审进入评分/报告阶段，不再消耗 token；与 maxRounds 的 force_stop（abort）语义分离；
- **审计**：`review.cost_cap_reached` 事件 + ModeratorDecision 记录（ruleCheckResult.maxCostOk=false）；
- **成本来源**：适配器 usage（已采集）→ modelOutputRef → buildState 聚合 → computeRuleCheck。

## 验证

- `npx tsc --noEmit`：0 error
- `npx jest`：182/182（T1 20 + T2 17 + T3 16 + T4 11 + T5/T6 21 + 原有 97）
- 无 schema 变更（token/成本在现有 JSON 字段聚合），迁移 16/16 不变

## 已知边界

- 成本估算基于默认单价表（openai_compatible 假设性单价）；真实单价经 env `MODEL_INPUT_PRICE_PER_1K`/`MODEL_OUTPUT_PRICE_PER_1K` 覆盖；
- 成本聚合发生在 buildState（Moderator 决策时），非实时逐 token 记账——对硬闸语义足够（决策前聚合当前累计）；
- mock/lmstudio 本地路径成本恒 0，成本硬闸主要约束外部托管模型。
