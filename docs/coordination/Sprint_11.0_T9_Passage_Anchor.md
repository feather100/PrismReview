# Sprint 11.0 — T9: 段落级锚点（Passage Anchors）

> **分支：** codex/t9-passage-anchor（基于 main ad42cd6）
> **基线：** docs/research/phase3-task-list-20260803.md T9（PaperJury 模式 J passage_id）
> **日期：** 2026-08-03
> **状态：** ✅ 完成（tsc 0 error / jest 194 全绿，含新增 7 例；迁移 #6 待 DB 环境应用）

---

## 1. 目标

评审意见锚定到原文段落（passageId + excerpt），报告/详情支持跳转原文：
1. 文档按段落切分，生成稳定 passageId（p1, p2, …）；
2. 评审员 prompt 带段落索引（可引用 passageRefs）；模型输出缺失时用关键词匹配兜底；
3. 意见落库 passageRefs；报告意见与评审详情暴露（前端跳转用）。

## 2. 改动清单

| 文件 | 改动 |
|------|------|
| prisma/schema.prisma | Review.passages（段落索引）+ ReviewOpinion.passageRefs（意见引用）+ 迁移 #6；**修复 createReview 不落库 content 的既有缺口** |
| util/passages.ts（新增） | 纯函数：extractPassages（空行切段 + 稳定 id）、extractKeywords（CJK 二元组 + 拉丁词）、linkPassages（issue→段落关键词重叠 topK） |
| reviews.service.ts | createReview 落库 content + passages；toResponseDto 暴露 passages |
| queue/service.ts | prompt 注入段落索引（passageId + 前 120 字）；意见创建写 passageRefs（模型输出优先，linkPassages 兜底） |
| reporting/service.ts | 报告意见带 passageRefs |
| review-response.dto.ts | ReviewResponseDto.passages |
| tests/passages.spec.ts（新增） | 7 例：切段/id、关键词、链接/无匹配/topK/空输入 |

## 3. 设计要点

- **稳定 id**：按段落位置 p1..pn（评审期间文档不变，位置即稳定）；
- **确定性兜底**：模型未输出 passageRefs 时，issue 关键词与段落重叠匹配（topK=2），纯函数可单测；
- **兼容**：passageRefs 列可空；无匹配意见为空数组，报告/前端不受影响；
- **prompt 提示**：段落索引块注入 reviewer prompt，真实 LLM 可主动引用。

## 4. 验证

- `npx tsc --noEmit`：0 error
- `npx jest`：194/194（新增 7 例）
- 迁移 #6（passages / passage_refs）待 DB 环境应用

## 5. 已知边界

- 前端"点击跳转原文"依赖 passages 字段（已暴露），UI 实现属前端任务；
- 关键词匹配是确定性启发式，非语义检索；真实 LLM 输出 passageRefs 时优先采用；
- content 落库修复：旧评审无 content/passages（可空，不阻塞）。

## 6. 与后续任务衔接

- T10（校准对照）：gold standard 的人工意见可与 passageRefs 对齐（人工意见同样锚定段落）；
- 前端：报告意见 passageRefs + 评审详情 passages → 跳转交互。
