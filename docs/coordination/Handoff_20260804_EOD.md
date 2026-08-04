# 交接文档（2026-08-04 EOD，次日续接用）

> **背景：** 上午交接（`Handoff_20260804.md`）的基础上，本日已完成交接项 #1（demo 验证 + 根因修复）与 #2（README 更新 + GitHub 页面装饰）。本文件是次日续接的**最新入口**。
> **必读：** 本文件 → `docs/coordination/Handoff_20260804.md`（上午版，含 Sprint 11.0 背景）→ `docs/coordination/ACTIVE_SPRINT.md` → `docs/coordination/Sprint_11.0_Summary.md`

---

## 1. 当前状态（提交到哪）

- **main = `e9c77d7`**（已推送 origin/main）
  - `480d82b` **fix(demo)**：resume 卡 running 根因修复（幂等拦截绕过 + 人工放行收敛）
  - `e9c77d7` **docs**：README 更新至 Sprint 11.0 现状 + 报告截图装饰
  - 前置：`2e4213e`（T1–T12 + Demo/CI + migrations 入库 + 上午交接）
- **基线（已实测）**：`tsc` 0 error / `jest` **211/211** / e2e 冒烟 5/5 + Sprint 10.1 verify 5/5 / DB 迁移 **19/19**（已入库，CI 用 `prisma migrate deploy`）
- **工作区**：无未提交改动；仅剩本地未跟踪文件（`.ghpush_explore.py` / `CLAUDE_CODE_GOAL_PROMPT.md` / `apps/api/report_local.json`，按用户说明可忽略）

## 2. 本日完成（原交接项 #1 / #2）

1. ✅ **research demo 全链路验证 + 根因修复**（原 #1，review `62b567dc` 终态 **completed**）
   - 根因 A：`ReviewOrchestrator.resume()` 的 `checkMeetingComplete` 入队会被 queue 进程内 `processedIds` 幂等拦截（该轮 meeting.complete 已处理过一次）→ `handleTurnsComplete` 永不触发 → 卡 running。
     修复：resume 先判定当前轮是否已全部终态，是则跳过重派发、直接走 `handleTurnsComplete`。
   - 根因 B：`MockModerator.decide()` 人工放行（`humanGateApproved=true`）后，round≥2 未收敛 + 已扩容一次会再次 `escalate_to_human` → interrupted 死循环。
     修复：新增 `humanGateApproved → converge` 分支（人工放行 → 收敛交付报告）。
   - 测试：`apps/api/src/tests/review-orchestrator.resume.spec.ts`（新，2 例）+ `moderator.decide.spec` 补 demo resume 场景；jest 208 → **211**。
   - 验证链路：r1 advance → r2 escalate（扩容 +2）→ r3 risk_gate → interrupted → 自动 resume → completed（ScoringPass scored=14 + finalize accepted=14 均跑）。
2. ✅ **README 更新 + GitHub 页面装饰**（原 #2）
   - 更新至 Sprint 11.0：徽章/副标题、特性表补 T1–T12、质量保障（211/e2e/迁移）、文档索引、路线图（Phase 3 完成 + P6 含 T13/T14）。
   - 新增「🖼️ 效果预览」节：`docs/demo/report-screenshot.png`（企业报告）+ `docs/demo/report-research.png`（research 模式，本次入库）。
   - 截图统一转真 PNG（原为 JPEG 字节 + .png 后缀，GitHub 渲染更可靠）。
   - 新增一键真 LLM Demo 说明：`DEMO_MODE=enterprise|research node scripts/demo-run.js`。

## 3. 遗留未完成项（下次接着做）

1. **gold standard 人工收集（D）**：需用户提供 **5 份脱敏方案文档 + 3 位专家** → `node scripts/gold-standard-kappa.js` 跑 κ → 评分可信度 ρ/MAE 白皮书。（阻塞在人工输入，工具包已就绪）
2. **ACTIVE_SPRINT.md 刷新**：当前仍停在 Sprint 11.0 T1–T11 / jest 204 / main `1f3f4ef` / migrations gitignore——与现状（T1–T12、211、`e9c77d7`、migrations 入库）严重脱节，它是仓库「单一入口」，建议下次先更新。
3. **report.verdict 语义观察**（未改）：报告页顶层 `verdict` 是既有启发式（存在 high-risk 意见即 `conditionally_approved`，从不返回 rejected），与 `scoring.verdict`（按阈值，如 32→rejected）不一致；README/报告页迭代时可统一。
4. **前端切片 D**（可选）：成本看板（T6）+ 校准页（T10）+ risk_gate 中断原因提示。
5. **P2（T13/T14）**：确定性-语义分层 / 复评闭环（可选继续，见 phase3-task-list）。

## 4. 关键背景速览

- **Sprint 11.0 完成**：T1–T12（生命周期/收敛信号/评分纪律/评分分离/降级/成本/升级/风险门/段落锚点/校准/并发/辩论上下文）。
- **Demo 已跑通**：LongCat 真 LLM；research 模式全链路（多轮 + 扩容 + 风险门 + 中断→resume→completed）；enterprise 模式更快。
- **CI**：pnpm 版本冲突已修；smoke 用 `migrate deploy`（migrations 已入库，19 迁移）。
- **数据库**：docker 三件套（postgres/redis/minio）当前 Up & healthy。

## 5. 环境/工具备忘

- 数据库：`docker compose up -d postgres`；迁移 `npx prisma migrate status/deploy`。
- API 冒烟：`node scripts/e2e-smoke.js`（5/5）；Sprint 10.1 verify：`node scripts/e2e-verify-sprint-10.1.js`（5/5）。
- 真 LLM demo：`DEMO_MODE=research|enterprise node scripts/demo-run.js`（LongCat provider 在 DB，~20–30s/轮；`--cleanup` 清理服务进程）。
- 测试：`cd apps/api && npx jest`（211 基线）；类型：`npx tsc --noEmit`。
- 浏览器查看：in-app browser（`agent.browsers.getForUrl`），截图存 `docs/demo/`。
- **坑**：仓库文件 CRLF，行级编辑最稳；node_repl 里 prisma client 缓存旧 schema（改 schema 后需 `prisma generate` + 新进程）；PowerShell 管道传中文给 `node -` stdin 会按 GBK 乱码（改用 node_repl 或写脚本文件）。
