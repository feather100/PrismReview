# Sprint 5.1 — P3 Prompt + Memory 实现

> **角色**：workbuddy-coder（标准 Gate）
> **模式**：标准 Guard（3 新表 + 既表加列 + 新 module(schema改动触发标准 Gate)
> **架构权威**：`docs/coordination/Sprint_5.1_P3_Prompt_Memory_Contract.md`
> **基线**：main = `332b5b0`（Sprint 5.0 已入库）
> **日期**：2026-07-14
> **Owner**：workbuddy-coder

---

## 0. 开工三连查（强制 P0）

```bash
git rev-parse --show-toplevel   # 必须 = D:/workspace/PrismReview
git status --short
git remote -v                   # 必须指向 feather100/PrismReview
git pull --ff-only origin main  # 快进到 332b5b0
```

---

## 1. 必读

先读 **`docs/coordination/Sprint_5.1_P3_Prompt_Memory_Contract.md`** 全文。所有接口签名 / schema delta / 红线以该 Contract 为准。

---

## 2. 实现范围

### 2.1 Schema 变更（3 新表 + 1 加列）

按 Contract §6 实施：

- `ReviewerMemory`（@@unique([tenantId, roleCode, reviewerUserId])）
- `ProjectMemory`（@@unique([tenantId, projectId])）
- `PromptTemplateRecord`（@@unique([roleCode, layer, version])）
- `ReviewOpinion.promptRefs Json?`

生成 Prisma migration（`prisma migrate dev`），_apply_，verify `migrate status` = up to date。

### 2.2 新建模块

**`modules/prompt/`**
- `prompt.service.ts` — PromptService 接口 + 实现
- `prompt.module.ts` — providers + exports
- Queue：`compose()` 四层组装 / `registerTemplate()` / `getActiveTemplate()` / `getTemplateHistory()` / `rollbackTo()`

**`modules/memory/`**
- `memory.service.ts` — MemoryService 接口 + 实现
- `memory.module.ts` — providers + exports
- 含 ReviewerProfile 蒸馏 / ProjectMemory 读写 / rolling summary 压缩（mock 截断）

**`modules/knowledge/`**（改造既有）
- `knowledge.service.ts` 加 `searchRelevantChunks()` + `getKnowledgeContext()`（mock 返回空）

### 2.3 改造

**`app.module.ts`** imports 加 `PromptModule, MemoryModule`。

**`orchestrator/graph-runtime.ts`** NodeCtx：`promptService / memoryService / knowledgeService` 从 `createPromptService()` / `createMemoryService()` / `knowledgeService` 注入（替代 undefined）。

**`modules/reviews/queue/queue.service.ts`**
- 去掉 `SYSTEM_PROMPT` 常量 + 硬编码 prompt 拼接
- `executeAgentTurn` 调 `ctx.promptService.compose({ reviewId, roleCode: roleCodeFromVersion, round, phase })`
- 组装结果写入 `ReviewOpinion.promptRefs`
- 保留既有 mock 降级 + 五态 providerSource

**`orchestrator/modular` 或 `handleTurnsComplete`（summarized 节点）** 调：
- `memoryService.updateReviewerProfile(reviewId)`
- `memoryService.updateProjectMemory(reviewId)`
- round ≥ 3 时调 `memoryService.compressRoundContext(reviewId, round)`

### 2.4 数据迁移（首次）

seed 脚本或 migration 后脚本：把 `AgentRoleVersion.systemPrompt` 同步为 `PromptTemplateRecord` base 层 v1.0（确保每个 preset role 有 base 模板供 compose 使用）。

---

## 3. In / Out

**In**：PromptService / MemoryService / KnowledgeService (mock) / 3 新表 / queue.service 改造 / graph runtime 注入 / 蒸馏 mock 规则 / rolling summary mock 截断 / 数据迁移脚本

**Out**：真 embedding / RAG 检索 / MCP tool / 真 LLM Moderator / 管理 REST 端点 / schema 未声明的改动

---

## 4. 红线

| # | 红线 |
|---|------|
| 1 | 仅实施 Contract §6 声明的 schema delta，不扩展 |
| 2 | 不改 `apps/web/` |
| 3 | 不写密钥、不引入 bcrypt/jwt 新依赖（prompt 不调真实 LLM） |
| 4 | 不提交 `.env` / `node_modules` / `data` / `.reasonix` / `.workbuddy` |
| 5 | 不 `--force` push |
| 6 | 蒸馏不调 LLM（确定性规则 / 截断） |
| 7 | **memory 不存聊天历史**（仅蒸馏 profile + project 摘要） |
| 8 | verify 脚本命名 `verify-sprint-5.1-*.js`（gitignore 通配符覆盖） |
| 9 | 未 commit / push / --force |

---

## 5. 验收标准

### 5.1 静态门
- `tsc apps/api` = 0 / `tsc apps/web` = 0
- `prisma migrate status` = up to date（1 新 migration）
- 密钥 scan exit=1 / 入库清单 grep 无输出

### 5.2 运行时
- `smoke-runtime.js` 31/31
- `verify-sprint-5.1-prompt-memory.js` ≥ 18 场景 PASS（见 §5.3）
- 9.5b 22/22 / review-history 16/16 / quality 32/32 / sprint-5 22/22 回归

### 5.3 verify-sprint-5.1 场景（最低 18 项）

| S# | 场景 | 期望 |
|----|------|------|
| T1 | PromptService.compose() 返回 4 层 templateRefs | PASS |
| T2 | compose() 的 system 含 base 层内容 | PASS |
| T3 | ReviewOpinion 写入后 promptRefs 非空 | PASS |
| T4 | registerTemplate 创建新版本，旧版本不可变 | PASS |
| T5 | getActiveTemplate 返回最新版本 | PASS |
| T6 | rollbackTo 创建新版本内容 = 历史版本 | PASS |
| T7 | AgentRoleVersion 数据迁移后 PromptTemplateRecord base v1.0 存在 | PASS |
| T8 | updateReviewerProfile 后 ReviewerMemory 有记录（维度擅长聚合） | PASS |
| T9 | updateProjectMemory 后 ProjectMemory 有 decisions | PASS |
| T10 | 重复 updateReviewerProfile 幂等（totalReviews 不重复累加） | PASS |
| T11 | compressRoundContext round ≥ 3 返回非空摘要 | PASS |
| T12 | 蒸馏 profile 不含聊天历史原文（无 opinion.issue 原文存放） | PASS |
| T13 | KnowledgeService.searchRelevantChunks 返回空数组（mock） | PASS |
| T14 | 多轮 (round ≥ 3) 时 summarize 节点触发压缩 + 聚合 | PASS |
| T15 | mock 下调 compose + 不调真实 LLM（无出域） | PASS |
| T16 | GET /api/roles /reviews /audit 等既有 API 不破 | 200 |
| T17 | memory 写失败不阻塞 review 主流程（catch 兜底） | PASS |
| T18 | PromptTemplateRecord @@unique([roleCode, layer, version]) 重复写入 → catch | PASS |

---

## 6. 实施顺序

1. schema 改 + migration → `migrate status` up to date
2. 新建 PromptModule（service + 数据迁移 base v1.0） → 单测 compose
3. 新建 MemoryModule（蒸馏 + project + rolling）
4. 改造 queue.service.ts 调 PromptService（promptRefs 落库）
5. 改造 graph runtime NodeCtx 注入三 service
6. 改造 summarize 节点调 MemoryService 聚合
7. 写 verify-sprint-5.1 脚本
8. 全量回归（含 smoke 31/31 + 既有 verify）
9. 回报 Codex，不 commit

---

## 7. 交付物

| 文件 | 类型 |
|------|------|
| `modules/prompt/prompt.service.ts` | 新建 |
| `modules/prompt/prompt.module.ts` | 新建 |
| `modules/memory/memory.service.ts` | 新建 |
| `modules/memory/memory.module.ts` | 新建 |
| `modules/knowledge/knowledge.service.ts` | 修改（加 searchRelevantChunks / getKnowledgeContext） |
| `orchestrator/graph-runtime.ts` | 修改（NodeCtx 注入三 service） |
| `modules/reviews/queue/queue.service.ts` | 修改（compose 替代硬编码） |
| `modules/reviews/orchestrator/{moderator或review-orchestrator}.ts` | 修改（summarized 节点聚合） |
| `prisma/schema.prisma` | 修改（3 新表 + 1 列） |
| `prisma/migrations/xxxx_add_p3_memory_prompt/` | 新建（migration） |
| `prisma/seed-prompt-templates.ts` 或 migration 后脚本 | 新建（gitignored 或 并入 seed） |
| `app.module.ts` | 修改（imports 加 PromptModule + MemoryModule） |
| `scripts/verify-sprint-5.1-prompt-memory.js` | 新建（gitignore） |
| `docs/coordination/ACTIVE_SPRINT.md` | 修改（滚动 5.1） |

纪律：不引入新 npm 包 / 不跑真实 LLM / 不伪造验证 / 不 commit/push/--force。完事回报 Codex。

---

## 8. 回报模板

```
【Sprint 5.1 workbuddy-coder 交付报告】

## 三连查 ✓

## 范围（git status 文件列表）

## P0 红线
- schema delta 仅 Contract §6 声明范围
- web 未动 / 密钥零命中 / 不 --force / 不 memory 存聊天历史

## 验证
- tsc api=0 / tsc web=0
- migrate status = up to date（1 migration: xxx_add_p3_memory_prompt）
- smoke 31/31
- verify-sprint-5.1 N/N
- 9.5b 22/22 / review-history 16/16 / quality 32/32 / sprint-5 22/22
- git status 未提交

## 结论
建议标准 Guard 复审 / Go / No-Go
```
