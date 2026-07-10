# Sprint 0.5 Gate Review

> 日期：2026-07-06  
> 评审对象：reasonix Sprint 0.5 工程骨架、antigravity 高保真 UI 探索  
> 结论：有条件放行进入 Sprint 1，但必须先补成本闸和设计归档引用。

## 1. 放行结论

- 工程骨架：通过。monorepo、Next.js、NestJS、Python Worker、Docker Compose、Prisma 14 表、5 个预置角色 seed 均已形成。
- 文档修正：通过。14 表口径、D01-D07、D03 默认不允许文档离境均已写入 `docs/sprint-0-kickoff.md`。
- UI 方向：通过。高保真方向从“AI 科幻感”转向 B 端工业 SaaS，符合产品定位。
- 放行级别：Conditional Go。

## 2. 阻塞项

### B1. 外部模型/Embedding 成本闸仍缺失

当前 Worker 中已有以下 TODO：

- `apps/worker/src/jobs/embed_document.py`：计划使用 OpenAI `text-embedding-3-small`。
- `apps/worker/src/jobs/diagnose_review.py`：计划 LLM call。
- `apps/worker/src/jobs/run_agent_turn.py`：计划 LLM + RAG。

但工程中尚未看到硬性开关，例如：

- `ALLOW_EXTERNAL_MODEL_CALLS=false` 默认关闭。
- `ALLOW_REAL_DOCUMENT_TO_EXTERNAL_MODEL=false` 默认关闭。
- 测试租户/脱敏样例白名单。
- 外部调用前的统一 guard。

Sprint 1 前必须补齐，否则不得接真实模型 API。

### B2. 高保真 UI 需要进入项目事实源

已归档到：

- `docs/design/high-fidelity/High_Fidelity_Mockups.md`
- `docs/design/high-fidelity/*.png`

后续 antigravity 产物不得只留在本地 `.gemini` 临时目录。

## 3. 主要发现

### 工程侧

- `docs/sprint-0-kickoff.md` 已正确标注 14 张表。
- `apps/api/prisma/schema.prisma` 中实际存在 14 个 model。
- `Report.status` 已包含 `human_review_required`。
- `ReviewTurn.status` 已包含 `interrupted_pending`。
- 项目当前不是 Git 仓库或当前目录未初始化 Git；如需版本化，请尽快 `git init` 或绑定远端。

### 设计侧

- 诊断书、会议室、报告页三个关键页面方向正确。
- 当前高保真仍是图片级探索，不是可实现设计系统；下一轮需要补组件规格、状态稿、表单/异常态。
- 会议室三栏结构与前置 IA 一致。

## 4. Sprint 1 准入条件

进入 Sprint 1 前必须完成：

- [ ] 增加外部模型调用成本闸，默认关闭。
- [ ] 增加 `.env.example` 中的外部调用开关说明。
- [ ] Worker 统一通过 model provider guard，不允许 job 直接调用外部 API。
- [ ] 将 high-fidelity 设计稿纳入 `docs/design/` 并在 README 或设计索引中引用。
- [ ] 如准备持续开发，初始化 Git 并提交当前基线。

## 5. Sprint 1 建议范围

### reasonix

- Auth/Tenant/RBAC 最小实现。
- Prisma schema 校验、migration、seed 可执行化。
- Role Service CRUD。
- Review draft 创建 API。
- Knowledge document mock upload API。
- 外部模型调用 guard + mock provider。

### antigravity

- 诊断书、会议室、报告页继续细化为组件级规格。
- 补齐空态、加载态、错误态、权限态、断连态。
- 输出 Ant Design 风格 token：颜色、间距、字体、表格、Tag、Card、Button、Layout。

## 6. 最终裁决

Conditional Go：允许进入 Sprint 1 的骨架实现与设计细化；不允许接真实企业文档或真实外部模型 API，直到成本闸和数据离境开关完成。
