# 🎯 PrismReview MVP Demo - Frontend QA Checklist (Sprint 2.7)

> [!NOTE]
> 本文档记录了 Sprint 2.7 冻结前端体验时的最后一轮自检情况，确保用于演示的 MVP 流程稳定、流畅且符合中文体验标准。

## ✅ 1. 核心链路验证 (Verified Path)
**已验证完整跑通路径**：`首页 → 诊断 → 会议 → 报告 → 返回首页`

- [x] **首页加载**：页面正常加载，控制台无报错。
- [x] **创建评审**：点击“创建 Mock 演示评审”后，能够自动完成建会、生成诊断并保存当前 `reviewId` 至 `localStorage`。
- [x] **诊断页 (Diagnosis)**：正确拉取并展示 Mock 架构数据和专家团信息；点击“确认评审团”正常跳转至会议室。
- [x] **会议室 (Meeting)**：进入后能渲染智能体面板，并在连接完成后模拟接收流式吐词。断开连接时不白屏，保持当前状态并给出弱提示。
- [x] **报告页 (Report)**：会议完成后点击跳转，能完整渲染执行摘要、整改行动项和专家意见列表。
- [x] **持久化链路回溯 (返回首页)**：从 Report/Meeting 退回首页后，“最近评审”卡片依旧悬浮在首页顶端，且可无缝二次进入任意节点。

## ✅ 2. 国际化与文案一致性 (Localization)
- [x] 抹除了 API 层抛出的所有英文异常，翻译为标准中文（如“获取评审详情失败。请检查 ID 是否有效”）。
- [x] 修正顶部导航和状态徽标（如 Admin User -> 管理员，等待中 / 发言中 / 已发言 / 异常）。
- [x] 会议室 ContextPanel 遗漏的英文 Mock 已更新为中文架构描述。
- [x] 所有角色名已通过 `src/lib/i18n/role-mapper.ts` 翻译为架构师、项目经理等专业名称，杜绝机翻感。

## ⚠️ 3. 已知限制与防误触机制 (Known Limitations & Disabled Controls)
为了保证 MVP Demo 的稳定性，以下功能暂未开放或采用了轻量化方案：

- [x] **最近评审缓存机制**：仅采用前端 `localStorage` 保存 `reviewId`，未接入后端真实的 List API。
- [x] **无大模型依赖 (No LLM by default)**：“快速 Mock 演示”路线默认不连接真实的 LLM 和 Runner 服务，纯依赖 DB/代码内置 Mock 保证演示绝对可控。
- [x] **动作按钮禁用**：
  - **报告页**: 导出 PDF、同步至 Jira（未连接）均已 `Disabled`；**导出 Markdown 已在 Sprint 6.2 启用**（仅 Markdown 可导出，PDF / Jira 仍未接入）。
  - **会议室**: 中断、强制结束、注入条件（人工干预）均已 `Disabled`。
  - **诊断页**: 取消按钮、+ 添加角色 均已 `Disabled`。

## ✅ 4. 容错性与健壮性 (Error Handling & Stability)
- [x] **无效 Review ID**：未建会的 ID 被优雅拦截（404/400），并在前端弹出带有“重试”按钮的红色中文 Alert 面板。
- [x] **后端失联**：Meeting 进行中途后端挂掉或 SSE 断连，页面状态静默维持，仅在顶部提示 `Alert`，不陷入白屏。
- [x] **状态机保护**：一旦评审开始，诊断页面的“确认评审团”按钮及接口将拦截二次提交，提示“该评审已开始，请进入会议室继续查看”。
- [x] **工程质量**：前端项目 (`apps/web`) 全局 `tsc` 验证通过 (0 errors)。

---

## ✅ 5. 生成来源摘要 (Report Provider Summary) — Sprint 5.4 刷新

> 对应后端 Sprint 5.1–5.3 已落地的 `providerSummary` 字段与前端"生成来源摘要"展示模块。本段为 Demo QA 新增检查项，确保来源可观测性在演示中表现正确、稳健。

- [ ] **Report providerSummary 展示**：打开路线 A / B 的 Report URL，报告页底部出现"生成来源摘要"模块，显示"总发言数"与 `Mock(N) / LMStudio(N) / OpenAI(N) / Fallback(N) / Failed(N)` 五态分布。
- [ ] **缺失 providerSummary 页面不崩**：触发后端不返回 `providerSummary` 的场景（如使用 Sprint 5.3 之前的老数据、或临时关闭该字段），Report 页其余内容（执行摘要、整改行动项、专家意见列表）仍正常渲染，**无白屏、无控制台报错**。
- [ ] **fallback / failed 标签语义正确**：
  - 存在 `fallback_mock` turn → 显示橙色 **"已发生 Fallback"** 标签，且 `fallbackCount` 计数正确；
  - 存在 `failed` turn（guard 拦截 / 401·403 鉴权失败）→ 显示红色 **"存在失败 Turn"** 标签，且 `failedCount` 计数正确；
  - 含 `lmstudio` 或 `openai_compatible` → 显示蓝色 **"真实模型参与"** 标签（`hasRealProvider === true`）；
  - 仅 `mock` 默认来源 → 不触发任何额外标签。
- [ ] **零敏感信息泄漏**：摘要仅含 provider 类型 / 模型名 / 计数，不展示 prompt、原始模型输出、API Key 或脱敏前的错误原文。
- [ ] **中文文案一致性**：标签"生成来源摘要 / 真实模型参与 / 已发生 Fallback / 存在失败 Turn / 总发言数"与 Sprint 5.3 实现一致，无英文残留、无歧义。

#### 实测状态回填（Sprint 5.5 — UI 补测）

> 实测环境：Docker（postgres/redis/minio healthy）+ API `:4000` 运行中；**前端 `:3000` 已启动（Next.js 14.2.35，apps/web dev）**；浏览器（agent-browser + Chromium）实测。
> 约定：✅ 实测 = 经 Report API 与浏览器 UI 双重验证；⚠️ 未端到端触发 = 代码守卫已确认，但需异常数据场景才能正向触发（默认 mock 不产生该数据）。
> 截图证据：`docs/demo/screenshots/sprint-5.5/`（`01-homepage.png` / `02-diagnosis-jury.png` / `03-meeting.png` / `04-report.png`）

| # | 检查项 | 实测方式 | 状态 | 说明 |
|---|--------|----------|------|------|
| 1 | Report providerSummary 展示 | Report API + 浏览器 UI | ✅ 实测 | 报告页渲染"生成来源摘要"模块，实测显示：总发言数 3 / 分布 Mock(3) LMStudio(0) OpenAI(0) Fallback(0) Failed(0) / 模型 mock；无"真实模型参与"标签（hasRealProvider=false，符合 mock 默认态）。见 `04-report.png` |
| 2 | 缺失 providerSummary 页面不崩 | 浏览器 UI + 源码守卫 | ⚠️ 守卫已确认，未端到端触发 | 源码 `ReportPage.tsx:128` 以 `data.providerSummary && (...)` 短路守卫渲染模块；缺失时模块整体跳过、其余六章结构正常（`:86-92` 无数据走 Empty 分支）。默认 mock 数据均含该字段，未构造缺失场景，故未端到端触发；逻辑层保证不崩 |
| 3 | fallback / failed 标签语义 | 浏览器 UI + 源码守卫 | ⚠️ 守卫已确认，未端到端触发（正向分支） | 源码 `ReportPage.tsx:144-146`：`hasRealProvider`→蓝标、`fallbackCount>0`→橙标 `已发生 Fallback`、`failedCount>0`→红标 `存在失败 Turn`。默认 mock 不产生 `fallback_mock`/`failed` 数据，故蓝/橙/红标签未正向渲染；语义与 Sprint 5.3 实现一致 |
| 4 | 零敏感信息泄漏 | Report API 结构 | ✅ 实测 | `providerSummary` 仅含 providerSource / modelName / 计数，无 key / prompt / rawText（同 Sprint 5.5 后端验证） |
| 5 | 中文文案一致性 | 浏览器 UI | ✅ 实测 | 报告页实测渲染"生成来源摘要 / 总发言数 / 分布"等中文文案，与 Sprint 5.3 实现及 5.4 文档一致，无英文残留。见 `04-report.png` |

> 注：第 2、3 项属"负向/异常分支"，需构造不含 `providerSummary` 的 review 或真实 provider 失败（guard/401·403）场景才能端到端触发；当前默认 mock Demo 不产生该类数据，故标记为"守卫已确认、未端到端触发"，不伪造成通过。五态 UI 渲染（含蓝/橙/红标签）建议在有真实 provider 接入的 Sprint（如 4.4C 之后）补测。

---

## ✅ 6. 报告导出（Markdown Export）— Sprint 6.3 刷新

> 对应 Sprint 6.0（契约）/ 6.1（后端 `GET /api/reviews/{id}/report/export.md`）/ 6.2（前端按钮启用）已落地的导出能力。本段为 Demo QA 新增检查项，确保"导出 Markdown"在演示中行为正确、稳健，且 PDF / Jira 仍保持禁用。

- [ ] **Markdown 导出按钮可点击**：打开 `completed` review 的 Report URL，报告页右上角"导出 Markdown"按钮**非 disabled**，点击后触发浏览器下载（按钮进入 `loading` 态防连击，下载完成/失败均解锁）。
- [ ] **PDF / Jira 仍 disabled**：同页"导出 PDF""同步至 Jira（未连接）"按钮保持 `disabled`，点击无效（本轮仅启用 Markdown 导出，PDF / Jira 后端未接入）。
- [ ] **下载文件名与非空内容**：下载文件名为 `prismreview-{reviewId前8位}.md`（后端 `Content-Disposition` 优先；缺失时前端 fallback `prismreview-{reviewId}.md`）；文件**非空**，首行 `# PrismReview 评审报告`，含评审目标（objective）/ 评审结论（verdict 中文）/ 生成来源摘要（providerSummary）/ 风险清单 / 各角色评审意见等章节；不含 `rawText` / `prompt` / API Key / `modelOutputRef` 原始 JSON。

#### 实测状态回填（待 Sprint 6.3 Demo 执行）

> 本节检查项在 Sprint 6.3 Runbook 刷新时**新增**，尚未在浏览器端到端实测。建议在下一次 live demo（路线 A 或 B 的 completed review）中执行并回填 ✅ / ⚠️ 状态与截图证据（如 `docs/demo/screenshots/sprint-6.3/export-markdown.png`）。
> 后端导出接口已在 Sprint 6.1 / 6.1B / 6.2 复审中实跑验证：200 + `Content-Disposition: attachment; filename="prismreview-{前8位}.md"` + 非空 `text/markdown`（约 2.3 KB，含 providerSummary / verdict / objective / risks / opinions 等），可作前端下载内容的等价证据。

---

## ✅ 7. 真实模型参与可观测性（Dev-only LM Studio Demo 就绪）— Sprint 7.5 冻结

> 本节为 Sprint 7.5 Demo 就绪冻结新增的前端核查项，对应 `MVP_Demo_Runbook.md` §11（Dev-only LM Studio 路线）与 `Sprint_7.5_Demo_Readiness_Freeze.md`。
> 核心口径：**默认 mock 演示不显示任何"真实模型参与"信号；仅当显式 env guard 启用本地 LM Studio 时，来源摘要才会出现 lmstudio / fallback_mock / failed 三态及对应标签。**

- [ ] **默认 mock 不显示真实模型参与**：打开路线 A / B 的 `completed` review Report URL，"生成来源摘要"仅显示 `Mock(N)` 分布，**无 `LMStudio(N)` / `OpenAI(N)` 分布、无蓝色"真实模型参与"标签**（`hasRealProvider=false`）。这是 MVP 标准 Demo 的默认且唯一预期表现。
- [ ] **providerSummary 中 lmstudio 展示核查**（仅 dev-only LM Studio 路线下出现）：当 review 含 `providerSource=lmstudio` 的 opinion 时，摘要显示 `LMStudio(N)` 分布 + 蓝色 **"真实模型参与"** 标签（`hasRealProvider=true`）。
- [ ] **providerSummary 中 fallback_mock 展示核查**（仅弱输出/超时段出现）：当 review 含 `providerSource=fallback_mock` 的 opinion 时，摘要显示 `Fallback(N)` 分布 + 橙色 **"已发生 Fallback"** 标签（`fallbackCount>0`）。该状态属**受控兜底、非系统失败**，不得被描述为"模型成功"。
- [ ] **providerSummary 中 failed 展示核查**（仅 guard/auth 拦截段出现）：当 review 含 `providerSource=failed` 的 opinion 时，摘要显示 `Failed(N)` 分布 + 红色 **"存在失败 Turn"** 标签（`failedCount>0`）。该状态属 **fail-closed 正确拦截**，不得被描述为"系统崩溃"。
- [ ] **零敏感信息泄漏（沿用 §5 第 4 项）**：无论何种来源，摘要仅含 provider 类型 / 模型名 / 计数；不展示 prompt、原始模型输出、API Key 或脱敏前错误原文。

#### 实测状态回填（待 Sprint 7.5 后 live demo / 或沿用既有证据）

> 默认 mock 的"不显示真实模型参与"已在 Sprint 5.5 实测确认（见 §5 第 1 项：`hasRealProvider=false`，无蓝标）。
> lmstudio / fallback_mock / failed 三态 UI 渲染的**正向触发**需在有本地 LM Studio 且显式 env guard 的 dev-only 路线下演示；其字段语义与渲染守卫已由 Sprint 7.3（代码 `applyPilotRoleCap` / `buildProviderSummary`）与 Sprint 7.4（E2E 15/15、providerSource 四态可区分）实证，前端 `ReportPage.tsx` 展示逻辑为 Sprint 5.3 既有能力、无 pilot 接线改动。
> 建议在下次 dev-only LM Studio 演示中回填三态 UI 的 ✅ / ⚠️ 状态与截图（如 `docs/demo/screenshots/sprint-7.5/`）— 但**该演示不是 MVP 对外标准 Demo**，不应作为"默认能力"宣称。
