# PrismReview MVP Snapshot

> **稳定的 MVP 锚点文档**：汇总截至 Sprint 6.3 已落地的能力、演示路线、默认安全边界、验证基线与已知限制，供后续 Sprint 作为对照基线。
> 本文档**只描述现状，不修改任何代码**。所有结论均来自既有 Sprint 文档 / 复审 / 实跑证据交叉核对。

---

## 1. Release 名称与日期

| 字段 | 值 |
|------|----|
| Release 名称 | **PrismReview MVP Snapshot** |
| 日期 | 2026-07-09 |
| 锚定 Sprint | Sprint 6.3（Export Demo Runbook Refresh，Gate: Go） |
| 状态 | 可演示（Demo-Ready，默认 mock 路线零外部模型依赖） |
| 红线基线 | 默认 mock、不调真实模型、API Key 不落文档、PDF/Jira 保持 disabled |

---

## 2. 已完成能力清单

> 端点 / 脚本以既有 Sprint 文档与复审为准。带 ⚠️ 项为"可用但有限制"，详见 §6。

| # | 能力 | 状态 | 关键端点 / 脚本 | 来源 Sprint |
|---|------|------|------------------|-------------|
| 1 | 创建评审 | ✅ | `POST /api/reviews` | 1.x |
| 2 | 我的评审列表 | ✅（前端 localStorage）⚠️ | 首页"最近评审"卡片；`localStorage` 持久化 `reviewId`，**未接入后端 List API** | 2.7 |
| 3 | 方案诊断 (Mock Chairman) | ✅ | `POST /api/reviews/{id}/diagnose` + `GET /diagnosis` | 1.x |
| 4 | 确认评审团 | ✅ | `POST /api/reviews/{id}/roles` + `POST /start`；5 预置角色 | 1.x |
| 5 | Meeting SSE | ✅ | `GET /api/reviews/{id}/meeting/stream`（DB turns + mock fallback） | 4.3 |
| 6 | Report API | ✅ | `GET /api/reviews/{id}/report`（`source=db_opinions` / `mock_fallback`） | 4.3 / 5.2 |
| 7 | providerSummary 来源可观测性 | ✅ | `modelOutputRef` JSON + `reasoningSummary`；五态分布（Mock/LMStudio/OpenAI/Fallback/Failed）+ 蓝/橙/红条件标签 | 5.1–5.4 |
| 8 | Markdown 导出 | ✅ | `GET /api/reviews/{id}/report/export.md`；前端"导出 Markdown"按钮已启用（PDF/Jira 仍 disabled） | 6.0–6.2 |
| 9 | Demo Runbook / QA Checklist | ✅ | `docs/demo/MVP_Demo_Runbook.md`（含 §8 来源摘要、§10 导出说明）、`docs/demo/Frontend_Demo_QA_Checklist.md`（含 §5 来源摘要、§6 导出检查） | 5.4 / 6.3 |

**说明**：
- 能力 2（我的评审列表）为前端 `localStorage` 缓存的"最近评审"卡片，并非后端真实 List 接口（QA Checklist §3 已注明），需在权限/多用户阶段补后端 List API。
- 能力 7 / 8 的实跑证据：Sprint 6.1B `smoke-export` 21/21；Sprint 6.2 后端导出实跑 200 + `Content-Disposition: attachment; filename="prismreview-{前8位}.md"` + 2323 字节非空 Markdown；`apps/web tsc` 0 errors。

---

## 3. 演示路线

### Route A — 默认 mock（纯 Mock，零外部模型）

- **一键设置**：`node scripts/setup-demo-review.js`
- **特征**：`Route: A (pure mock)`；`Report src: mock_fallback`；所有 opinion 来源 `mock`，摘要显示 `Mock(N)`，无真实模型标签。
- **演示步骤**：
  1. 打开 Diagnosis URL → 方案摘要、风险雷达图、5 个推荐角色。
  2. 打开 Meeting URL → 静态三栏布局（Agent 席位 / 发言流 / 上下文面板）。
  3. 打开 Report URL → 六章结构报告，`source=mock_fallback`，底部"生成来源摘要"显示 `Mock(N)`。
  4. **点击报告页右上角"导出 Markdown"** → 浏览器下载 `prismreview-{id前8位}.md`，非空，含标题/目标/结论/来源摘要/风险/意见。

### Route B — mock runner / db_opinions（真实数据写入流程）

- **一键设置**：`node scripts/setup-demo-review.js --with-runner`
- **特征**：`Route: B (runner + DB opinions)`；`Report src: db_opinions`；使用 mock provider（无需 LM Studio）写入 DB，每角色一条 opinion（含 dimension/riskLevel/confidenceScore）。
- **演示步骤**：
  1. 打开 Diagnosis URL → 同路线 A。
  2. 确认 runner 输出 → 3/3 turns completed，CTO/CFO/PMO 各有 opinion。
  3. 打开 Report URL → 真实 DB opinions，`source=db_opinions`，来源摘要显示各角色 provider 分布。
  4. 查看 opinions → 每条来自不同角色，有维度/风险/置信度。
  5. **点击报告页右上角"导出 Markdown"** → 同路线 A，内容与 DB opinions 报告一致。
- **幂等重跑（dev/test 辅助）**：`node scripts/setup-demo-review.js --with-runner --review-id=<id>` → runner 检测到已有 completed turns，输出 `idempotent skip`（预期行为，非失败）。重新生成用 `--force`。

### Markdown 导出步骤（两条路线共用）

- **入口**：Report 页 Header 右侧"导出 Markdown"按钮（与"导出 PDF""同步至 Jira（未连接）"并列）。
- **启用条件**：仅 `status=completed` 且报告数据就绪后可点；加载中 / 出错 / 无数据时不渲染该按钮。
- **行为**：点击 → `loading` 防连击 → 调后端 `GET /api/reviews/{id}/report/export.md` → 服务端生成 Markdown（`blob` 下载，**前端不拼装**）→ 文件名优先用后端 `Content-Disposition`，缺失时 fallback `prismreview-{id}.md`；失败弹中文提示。
- **导出内容章节**：头部（标题/objective/ID/状态/来源/意见数）、`verdict` 中文映射、生成来源摘要 `providerSummary`、执行摘要、指标、风险清单、各角色意见、行动项、低置信度意见；**不含** `rawText` / `modelOutputRef` 原始 JSON / API Key / prompt。
- **默认 mock 也能导出**：导出复用 `getReport`，不调 provider、不消耗付费 API；路线 A/B 报告均可正常导出。

---

## 4. 当前默认安全边界

| # | 安全边界 | 状态 / 依据 |
|---|----------|-------------|
| 1 | 默认 mock | ✅ 未设置 `MODEL_PROVIDER` 时走 mock（0ms 响应），纯 Demo 零外部依赖 |
| 2 | 不默认调用真实模型 | ✅ `ALLOW_EXTERNAL_MODEL_CALLS` 默认 `false`；仅显式设 `MODEL_PROVIDER=lmstudio/openai_compatible` 才接入真实模型 |
| 3 | API Key 不写文档 | ✅ 文档仅出现占位 demo token（`test-token`）与条件性说明（`MODEL_PROVIDER=lmstudio` 未实际设置）；真实 Key 入 `.env`（已 gitignore），不落文档 / 不落代码 |
| 4 | PDF / Jira 仍 disabled | ✅ 报告页"导出 PDF""同步至 Jira（未连接）"保持 `disabled`；仅 Markdown 可导出 |
| 5 | 真实 Provider / BullMQ / PDF 需独立 Gate | ✅ 凡涉真实外部模型、新外部依赖（BullMQ/Redis）、前端主交互或新端点，必须走对应标准/独立 Gate（见 `Sprint_5.7_MVP_Freeze_Next_Track.md` §5），不得以"风险低"跳过 |

---

## 5. 验证基线

> 各 smoke 脚本与 `tsc` 的近期实跑结果，作为后续 Sprint 的回归基线。

| 验证项 | 基线结果 | 依据 |
|--------|----------|------|
| `scripts/smoke-runtime.js` | ✅ 通过（runtime 31） | Sprint 5.7 汇总 |
| `scripts/smoke-runner.js` | ✅ 通过（runner 15） | Sprint 5.7 汇总 |
| `scripts/smoke-queue.js` | ✅ 通过（queue 15） | Sprint 5.7 汇总 |
| `scripts/smoke-sse.js` | ✅ 通过（SSE 5） | Sprint 5.7 汇总 |
| `scripts/smoke-provider-robustness.js` | ✅ 通过（robustness 14，14 种格式解析） | Sprint 5.7 汇总 |
| `scripts/smoke-export.js` | ✅ 通过（21/21，含 providerSummary 断言 + mock_fallback + 无 key/prompt/sk-/modelOutputRef 断言） | Sprint 6.1B |
| `apps/web` `tsc --noEmit` | ✅ 0 errors（managed node 22.22.2） | Sprint 6.2 复审 |
| `apps/api` `tsc --noEmit` | ✅ 通过（Runbook §6 演示前校验项） | MVP_Demo_Runbook §6 |

> 注：后端导出接口（`/report/export.md`）在 Sprint 6.1 / 6.1B / 6.2 中多次实跑验证（HTTP 200、非空 `text/markdown`、命名正确）。前端"点击→落盘"浏览器端到端为 Sprint 6.3 §6 新增检查项，**待下次 live demo 回填**（已有后端等价证据，不阻塞）。

---

## 6. 已知限制 / 技术债

| # | 限制 / 技术债 | 类型 | 影响 | 来源 |
|---|---------------|------|------|------|
| 1 | 真实模型成功路径未验证 | P1 | `lmstudio` 本地已跑通，`openai_compatible` 付费接口未端到端验证 | Sprint 5.7 §3 |
| 2 | BullMQ 未接（in-memory queue） | P2 | 当前进程内 queue，进程重启丢失 turns；Worker 未独立 | Sprint 5.7 §3 |
| 3 | PDF / Jira 未接 | P2 | 报告仅 Markdown 导出；Jira 同步 Action Items 仍 Mock | Sprint 5.7 §3 |
| 4 | 权限 / 多用户未接 | P2 | Mock user；`audit_logs` 表空；"我的评审列表"仅 localStorage，无后端 List API | Sprint 5.7 §3 / QA §3 |
| 5 | 目录非 git 仓库 → diff 留痕弱 | P2 | 无法用 diff 证明"零后端变更"，Gate 证据靠端点一致性 + 交付物范围论证 | Sprint 6.2 §1/§4 P2#2 |
| 6 | Markdown 导出前端端到端未回填 | P2 | 后端导出已实跑验证；前端"点击→.md 落盘"待 live demo 实测，现为 Sprint 6.3 §6 `[ ]` 项 | Sprint 6.3 |

> 补充（非阻塞、已在 5.7 登记）：Meeting SSE `running partial` 轮询缺自动测试；pgvector 已移除、检索用 LIKE；`real_document_to_external_model` 开关逻辑未跟进。

---

## 7. 下一阶段候选

> 顺序说明：Sprint 5.7 §5 推荐产品优先级 **B → A → C**（Controlled Real Provider → Export → BullMQ）；下表按本 Snapshot 任务给定的候选项列出，其中"① Markdown export live QA 回填"为 6.3 的就近收尾项。

| # | 候选项 | 类型 | 说明 / 入口 |
|---|--------|------|-------------|
| ① | Markdown export live QA 回填 | 收尾 | 在 live demo（路线 A/B 的 completed review）实测 Sprint 6.3 §6 三项导出检查并回填 ✅/⚠️ + 截图（如 `docs/demo/screenshots/sprint-6.3/export-markdown.png`） |
| ② | PDF Export Contract | 路线 A | 报告 PDF 渲染 + 端点；前端"导出 PDF"按钮从 disabled→enabled，需走标准 Gate | Sprint 5.7 §5 路线 A |
| ③ | Controlled Real Provider Pilot | 路线 B | 真实 `lmstudio`/`openai_compatible` 成功路径验证；需独立 Gate + Key 管理 + 预算审查 + standalone spike | Sprint 5.7 §5 路线 B |
| ④ | BullMQ Persistent Queue | 路线 C | Redis 持久队列 + Worker 独立 + SSE 从 DB 读；新外部依赖需标准 Gate + e2e | Sprint 5.7 §5 路线 C |

**Gate 提示**：任一候选项均**不得用快速 Gate 直接放行**（路线 A 属前端主交互、路线 B 触真实模型红线、路线 C 引新外部依赖）；各路线强制流程见 `Sprint_5.7_MVP_Freeze_Next_Track.md` §5。

---

## 附：本 Snapshot 证据链

- 能力 / 端点：Sprint 5.7 §1 能力清单、Sprint 6.0–6.2 导出链路。
- 演示路线：MVP_Demo_Runbook §2.2 / §3.2 / §10；Frontend_Demo_QA_Checklist §3 / §6。
- 安全边界：Sprint 5.7 §2 红线、Sprint 6.2 §1（PDF/Jira disabled）、Sprint 6.3（API Key 不落文档）。
- 验证基线：Sprint 5.7 §1 smoke 计数、Sprint 6.1B（21/21）、Sprint 6.2（`tsc` 0 errors）。
- 技术债：Sprint 5.7 §3、Sprint 6.2 §4 P2、Sprint 6.3 §6。
- 下一阶段：Sprint 5.7 §4–§5。

> 本文件为只读锚点，后续 Sprint 不在此直接编辑能力状态；状态变更请回到对应 Sprint 文档并滚动 `ACTIVE_SPRINT.md`。
