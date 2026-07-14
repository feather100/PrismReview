# Contributing to PrismReview

感谢你考虑为 PrismReview 做贡献。本文档覆盖从环境搭建到提交约定的全流程。架构层面的决策与协作纪律请同时参阅 [docs/coordination/AGENT_COORDINATION_PROTOCOL.md](docs/coordination/AGENT_COORDINATION_PROTOCOL.md)。

---

## 📜 行为准则（Code of Conduct）

- 保持专业、尊重与善意。对事不对人，批评针对方案而非个人。
- 默认公开、可追溯：讨论走 Issue / PR，避免私下一对一决策。
- 不提交任何真实密钥、用户数据或凭据（见下方「红线」）。

---

## 🧰 开发环境（Prerequisites）

| 依赖 | 版本 | 说明 |
|------|------|------|
| **Node.js** | 22 LTS（引擎 `>= 20`） | `node -v` 校验；推荐 22 |
| **pnpm** | 9.x | `corepack enable && corepack prepare pnpm@9 --activate` |
| **Docker Desktop** | 最新稳定 | 提供 PostgreSQL 16 / Redis 7 / MinIO |
| **Git** | 任意较新版本 | 需能访问 `feather100/PrismReview` |

> ⚠️ 当前主分支即 `main`，远程为 `https://github.com/feather100/PrismReview.git`。所有改动从 `main` 拉分支，禁止在包装目录（`Codex/` `Qoderwork/` 等）内 `git init`。

---

## 🚀 一键启动

```bash
# 1. 拉起基础设施
docker compose up -d

# 2. 安装依赖并初始化数据库
pnpm install
cd apps/api && pnpm prisma:generate && pnpm prisma:migrate --name init && pnpm prisma:seed && cd ../..

# 3. 启动开发服务（turbo 并行 web + api）
pnpm dev
```

| 服务 | 地址 |
|------|------|
| Web (Next.js) | http://localhost:3000 |
| API (NestJS) | http://localhost:4000/api |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |
| MinIO | localhost:9000（控制台 9001） |

> Windows 若 `pnpm dev` 卡在非交互检查，可分别启动：
> `apps/api/node_modules/.bin/nest.CMD start --watch` 与 `apps/web/node_modules/.bin/next.CMD dev`。

---

## 🔀 分支 / 提交 / 标准 Gate 约定

PrismReview 采用 **标准 Gate（Standard Gate）** 与 **快速 Gate（Fast-Gate）** 双轨评审（详见协议 §5 / §6 / §7）：

1. **开工三连查**：每次动手前确认 `git rev-parse --show-toplevel` = 项目根、`git remote -v` = `feather100/PrismReview`、`git status` 已知、`git pull --ff-only origin main` 已同步。
2. **分支策略**：从 `main` 拉 `feature/<sprint>-<topic>` 或 `docs/<topic>`；不直推 `main`。
3. **提交纪律**：
   - 提交信息用 Conventional Commits：`feat:` / `fix:` / `docs:` / `refactor:` / `test:`。
   - **文档 Sprint（docs/）走快速 Gate**：不改 schema / 状态机实现 / 模型 / 前端 / 依赖时，纯文档可走 fast-gate。
   - **任何改动 Prisma schema、状态机实现、模型调用、前端或依赖** → 触发**标准 Gate**（协议 §5.2 / §5.4 + §7.1 退回标准流程），需 reviewer（qoderwork）审查 + `tsc` / smoke 证据，不得走 fast-gate。
4. **不 --force push**；推送前先 rebase 到最新 `main`。
5. **不提交**：`.env` / `node_modules` / `data/` / `.reasonix/` / `.workbuddy/` / 日志。

---

## ✅ 如何跑 Smoke

仓库内置多组 smoke 脚本（`scripts/`），用于验证不同维度：

```bash
# 全链路自愈（默认 mock）：create → diagnose → start → report
node scripts/smoke-runtime.js

# 队列 / runner / SSE / 导出 等专项
node scripts/smoke-queue.js
node scripts/smoke-runner.js
node scripts/smoke-sse.js
node scripts/smoke-export.js

# P1–P5 专项验证（gitignored，独立可重跑）
cd apps/api && node scripts/verify-9.5b-multiround.js        # P1 多轮回合
node scripts/verify-sprint-5-rbac-audit.js   # P4 RBAC+审计
node scripts/verify-sprint-5.1-prompt-memory.js # P3 Prompt+Memory
node scripts/verify-sprint-5.2-tool-hitl.js  # P4 Tool+HITL
node scripts/verify-sprint-5.3-workflow-scoring.js # P5 评分
node scripts/verify-review-history.js        # 历史管理
node scripts/verify-quality.js               # 质量评测
cd ../..

# 一键 demo（见 README Demo 路线）
node scripts/setup-demo-review.js                 # Route A 纯 mock
node scripts/setup-demo-review.js --with-runner   # Route B runner + DB
```

前端类型检查：

```bash
cd apps/web && npx tsc --noEmit --incremental false && cd ../..
```

提交前请确保 `tsc apps/api` 0 errors、`tsc apps/web` 0 errors、至少 `smoke-runtime.js` 31/31 通过。

---

## 📁 `docs/` 目录约定

| 目录 / 文件 | 用途 |
|-------------|------|
| `docs/coordination/` | Sprint 文档、Gate 记录、Agent 协议、ACTIVE_SPRINT |
| `docs/roadmap/` | 产品路线图与架构决策锁定 |
| `docs/demo/` | Demo 操作手册 |
| `docs/design/` `docs/predesign/` `docs/implementation/` | 设计前置 / 预设计 / 实现记录 |
| `docs/gate-reviews/` | 各 Sprint 的 Gate 复审材料 |
| `docs/ARCHITECTURE.md` | **系统架构总览（用户向 + 开发者向）** |

**文档落点规则**：
- 用户向门面文档放在仓库根（`README.md` / `CONTRIBUTING.md`）。
- 架构与协议文档放在对应 `docs/` 子目录，命名遵循 `Sprint_<x.y>_<Topic>.md`。
- 纯文档改动不碰任何 `.ts` / `.tsx` / `.prisma` / orchestrator 实现；仅在 `docs/` 内增改。

---

## 🚧 红线（Red Lines）

- 不提交真实密钥（`sk-…` / `Bearer …` / 数据库密码）；环境变量只写占位格式。
- 默认 mock：真模型（LM Studio / OpenAI-compatible）仅在显式 env + Gate 下启用，且 dev-only 有数量上限。
- 不 `--force`、不绕 Gate、不在错误目录 `git init`。

如有疑问，先开 Issue 讨论，再动手实现。期待你的 PR！ 🙌
