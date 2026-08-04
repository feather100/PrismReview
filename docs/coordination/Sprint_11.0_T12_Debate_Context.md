# Sprint 11.0 — T12: 排除自己历史的滚动上下文（Debate Context）

> **分支：** main 直接提交（f2ba09d 后）
> **基线：** docs/research/phase3-task-list-20260803.md T12（Solutioning Room 模式 R）
> **日期：** 2026-08-04
> **状态：** ✅ 完成（tsc 0 error / jest 208 全绿，含新增 4 例；无 schema 变更）

---

## 1. 目标

辩论轮（round≥2）给评审员注入**其他专家**的上轮意见（回应对象），但：
1. **排除自己**的上轮意见（防回声自我强化）；
2. **滚动窗口**保留最近 N 轮（默认 2）；
3. 无他人意见时不注入（不污染 prompt）。

## 2. 改动清单

| 文件 | 改动 |
|------|------|
| util/debate-context.ts（新增） | 纯函数 `buildDebateContext(opinions, excludeReviewerId, windowRounds)`：排除自己 + 窗口过滤 + 排序格式化 |
| queue/service.ts | debate 轮（turnPhase==='debate' && round>=2）加载前序轮次他人意见（排除 rejected + 自己）→ 注入 prompt；失败非致命 |
| tests/debate-context.spec.ts（新增） | 4 例：排除自己 / 滚动窗口 / 格式 / 空输入 |

## 3. 设计要点

- **先补上下文再排除**：原系统 debate 轮完全无上轮上下文（评审员各说各话）；T12 先注入"他人意见"作为回应对象，同时排除自己实现防回声；
- **数据来源**：前序轮次 completed/failed turns → opinions（排除 rejected），按 turn 映射 reviewer；
- **格式**：`[r{round} {reviewerId}] 维度(风险): issue → recommendation`，按轮次升序；
- **窗口**：默认最近 2 轮（滚动，防止上下文无限膨胀）。

## 4. 验证

- `npx tsc --noEmit`：0 error
- `npx jest`：208/208（新增 4 例）
- 无 schema 变更

## 5. 已知边界

- 依赖 opinion.reviewerId 经 turn.roleVersionId 映射；失败降级为不注入（不影响主流程）；
- mock 辩论回复暂不真正"回应"注入的他人意见（固定回复）；真实 LLM 才会利用该上下文。
