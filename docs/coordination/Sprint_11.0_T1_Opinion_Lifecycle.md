# Sprint 11.0 — T1: Opinion Lifecycle + Content-Key Dedup（意见生命周期与同题归并）

> **分支：** codex/t1-opinion-lifecycle
> **基线：** docs/research/phase3-task-list-20260803.md T1（源自《phase1-design-patterns》模式 A/C：PR Council FindingLifecycle）
> **日期：** 2026-08-03
> **状态：** ✅ 完成（tsc 0 error / jest 73 全绿，含新增 20 例）

---

## 1. 目标

1. 评审意见获得生命周期状态：`candidate → challenged → accepted / rejected / downgraded`（T2 辩论将驱动挑战/裁决，本 Sprint 先落地状态机与数据模型）；
2. 内容键去重：同一评审内不同 reviewer 提出相同问题自动归并，报告不再重复出现；
3. 每次状态迁移写审计日志；
4. 报告只输出 accepted + downgraded（candidate 兜底可见），rejected 仅审计可查。

## 2. 改动清单

| 文件 | 改动 |
|------|------|
| prisma/schema.prisma | ReviewOpinion 新增 `status`（默认 accepted 兼容存量）、`resolution_reason`、`dedup_key`、`merged_reviewer_ids`(JSONB)、`canonical_opinion_id`；新增 `(review_id, dedup_key)` 索引 |
| orchestrator/opinion.ts | 新增 `OpinionStatus`/OPINION_STATUSES、`normalizeIssueKey`/`computeDedupKey`（保守归一化：折叠标点/空白，不删除空格）、StructuredOpinion 可选 status/resolutionReason/dedupKey、validateOpinion 枚举校验 |
| orchestrator/opinion-lifecycle.ts（新增） | ① 纯层：`isReportable`、`VALID_TRANSITIONS`/`assertTransition`、`computeFinalization`（dedup+受理决策）、`collectMerges`；② 服务层：`finalizeReview`（事务落库 + 审计）、`transition`（T2 用） |
| orchestrator/review-orchestrator.ts | `next==='completed'` 分支调用 `finalizeReview`（失败非阻塞，报告 candidate 兜底） |
| queue/queue.service.ts | 正常意见创建置 `status:'candidate'` + 写入 `dedupKey`；校验失败/fail-closed 存根置 `status:'rejected'`（不进报告，仅审计） |
| reporting/reporting.service.ts | `buildReportFromDb` 过滤 reportable（accepted/downgraded/candidate；rejected 排除）；providerSummary 仍基于全量（保留 mock/llm/failed 统计）；opinion 增加 status/resolutionReason 字段 |
| reviews.module.ts | 引入 AuditModule + 注册 OpinionLifecycleService |
| tests/opinion-lifecycle.spec.ts（新增） | 20 例：纯规则（isReportable/transitions/dedup 键）+ 服务层（内存 prisma mock：finalize 归并、transition 校验、审计调用） |
| prisma/migrations/20260803000000_t1_opinion_lifecycle/ | 迁移 SQL（本地；migrations 目录按仓库惯例被 .gitignore，不入库） |

## 3. 设计要点

- **向后兼容：** DB 默认 `status='accepted'`，存量意见照常进报告；新意见创建时显式置 candidate，终结时收束。
- **内容键：** `computeDedupKey(dimension, issue)`，normalize 只折叠标点与空白（保守，避免误合并不同问题）。
- **去重语义：** 终结化时按 createdAt 升序，首个同键意见成为 canonical；后续同键 → `rejected` + `canonical_opinion_id` + canonical.`merged_reviewer_ids` 追加来源 reviewer；已 rejected 的意见不占位。
- **审计：** 每次迁移经 AuditService.log（action `review.opinion.accepted` / `review.opinion.rejected.duplicate` 等），.catch 兜底不阻塞主流程（红线 #8）。
- **报告兜底：** isReportable 含 candidate —— finalize 失败不会导致报告空白；rejected（含历史失败存根）不进报告但 providerSummary 保留统计。

## 4. 验证

- `npx tsc --noEmit`：0 error（需先 `prisma generate` 重新生成 client）
- `npx jest`：73/73 全绿（含新增 opinion-lifecycle.spec.ts 20 例；基线 53 例 + 原有其余）
- 迁移：SQL 已生成（本地），待有数据库环境时 `prisma migrate dev` 应用

## 5. 与 T2 的衔接

- `OpinionLifecycleService.transition(reviewId, opinionId, to, reason)` 已就绪，T2"收敛判定显式化"的 Moderator 可据此驱动 challenge/accept/reject/downgrade；
- `assertTransition` 规则表已定义，T2 只需接入决策来源（LLM/Mock 输出 → transition 调用）。

## 6. 已知边界

- dedup 键基于 issue 文本归一化，**不包含语义相似**（同义改写不归并）——语义归并留给 T2/后续（可选接 embedding）；
- 报告 DTO 未新增独立字段展示 rejected 清单（可通过 audit 日志查询）；
- 根目录仍散落历史调研 scratch 文件（_*.html 等，未入库）。
