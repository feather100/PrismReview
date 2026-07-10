# Sprint 8.2 — Repo Operating Rules（GitHub 主干协作规则）

> **角色**：workbuddy-docs（纯文档，不改业务代码）
> **上游**：`Sprint_8.1_GitHub_Bootstrap.md`（Git 引导完成，已推送 `origin/main`）+ `Sprint_8.1_Workbuddy_Review.md`（Go）
> **协议落点**：本规则同步写入 `AGENT_COORDINATION_PROTOCOL.md` §9（GitHub 工作规则）
> **日期**：2026-07-10
> **目的**：把 GitHub 主干协作规则写清楚，避免后续 agent 在错误目录、错误分支、未同步状态下工作。

---

## 1. 背景与现状锚点

Sprint 8.1 已完成 PrismReview 的真实 Git 引导：

- 项目根 `D:\workspace\PrismReview` 已 `git init`，分支 `main`。
- `origin` = `https://github.com/feather100/PrismReview.git`（fetch/push 一致），首个提交 `a4da677…` 已推送 `origin/main`。
- `.gitignore` 已完善，覆盖 `.env` / `node_modules` / `data/` / `.reasonix/` / `.workbuddy/` / `reasonix.toml` / `_*.json` / `_rid.txt` / `fix_uuid*.js` / `setup-test-review.js` / `pilot-*.log` / `*.log` / `dist/` / `*.tsbuildinfo`。
- 父目录 `/d/workspace` **不存在** `.git`（无包装工作区仓库），引导严格限定在项目根内。

本 Sprint 把"如何在已就绪的 Git 仓库中正确协作"固化为规则，供所有后续 agent（reasonix / antigravity / qoderwork / workbuddy / Codex）开工前遵守。

> 开工前务必先读 `ACTIVE_SPRINT.md`（确认当前 Sprint 与输入/输出契约）与本文（确认 Git 工作基线）。

---

## 2. 七条强制规则（无例外）

| # | 规则 | 强制级别 | 违反后果 |
|---|------|----------|----------|
| 1 | **开工目录必须是 `D:\workspace\PrismReview` 或 GitHub clone 的 PrismReview 根目录** | P0 | 不在项目根 → 立即停止，切换目录 |
| 2 | **开工前必须 `git status` + `git remote -v`** | P0 | 未核查状态/远端 → 不得动手 |
| 3 | **开工前必须 `git pull --ff-only origin main`** | P0 | 未同步 → 不得动手（避免基于陈旧代码工作） |
| 4 | **不得在 Codex / Qoderwork 包装工作区初始化 Git** | P0 | 在包装区 `git init` → 立即停止并清理 |
| 5 | **不得提交 `.env` / `node_modules` / `data` / `.reasonix` / `.workbuddy` / 日志** | P0 | 误提交敏感/本地状态 → 必须回退 |
| 6 | **每个 Sprint 输出文档必须入 `docs/coordination/`** | P1 | 散落根目录/临时目录 → 文档不可被发现 |
| 7 | **代码改动必须记录验证命令** | P1 | 无验证命令 → Gate 不受理（同协议 §6.3） |

---

## 3. 规则详解

### 3.1 开工目录（规则 1）

- 唯一有效工作根是 **PrismReview 项目根**：本地 `D:\workspace\PrismReview`，或 `git clone` 后的同名目录。
- 开工前用 `git rev-parse --show-toplevel` 校验，输出必须等于 PrismReview 根，且**不得**是上层包装目录（如 `/d/workspace`、Codex/Qoderwork 自动生成的工作区）。
- 任何"看起来像项目但 toplevel 不对"的目录都视为错误目录，先停下确认，不盲干。

### 3.2 开工三连查（规则 2 + 3）

每次开工（含文档 Sprint）先执行：

```bash
git rev-parse --show-toplevel     # 确认在 PrismReview 根
git status                        # 确认工作树状态（有无未提交改动）
git remote -v                     # 确认 origin 指向 feather100/PrismReview
git pull --ff-only origin main    # 快进同步到最新 main
```

- `--ff-only` 保证**只快进、不自动 merge/rebase**：若本地有分叉提交，pull 会拒绝并提示，此时先处理分叉（rebase 或核对），不强制覆盖。
- 若 `git pull` 因分叉失败：停下，向用户/Gate 报告，**不得**用 `--force` / `--no-ff` 强行合并。
- 当前基线（2026-07-10）：本地 `main` 与 `origin/main` 同步于 `a4da677…`，工作树干净（仅 8.1 两份文档未跟踪）。

### 3.3 禁止在包装工作区初始化 Git（规则 4）

- Codex / Qoderwork 等平台常生成**包装工作区**（外层目录 + 内层项目），外层可能已存在或会被自动注入 `.git`。
- **绝不在**此类包装区执行 `git init` 或把整个包装区作为仓库根。
- Sprint 8.1 已确认：`/d/workspace` 无 `.git`，引导只发生在 `D:\workspace\PrismReview` 项目根。后续若在某平台收到"clone 到临时区"的任务，先确认 toplevel 仍是 PrismReview 根、且 remote 指向 `feather100/PrismReview`，再开工。
- 若误在包装区 init：立即 `rm -rf <包装区>/.git`（仅删误建仓库，不删项目文件）或放弃该工作区，回项目根重来。

### 3.4 忽略清单（规则 5）

以下**永不入库**（已由 8.1 `.gitignore` 覆盖，提交前务必 `git status` 二次确认未被暂存）：

| 类别 | 路径/模式 | 原因 |
|------|-----------|------|
| 密钥 | `.env` / `apps/api/.env` / `.env.*.local` | 含真实本地值，禁止入库 |
| 依赖 | `node_modules/` | 可重新安装 |
| 运行数据 | `data/` | 本地 Postgres/MinIO 数据，非源码 |
| 本地 agent 状态 | `.reasonix/` / `reasonix.toml` / `.workbuddy/` | 本地协作/会话状态，非项目资产 |
| 日志/调试 | `*.log` / `pilot-*.log` / `_*.json` / `_rid.txt` / `debug/` | 临时输出 |
| 一次性脚本 | `fix_uuid.js` / `fix_uuid2.js` / `setup-test-review.js` | 本地 codemod/helper，非 MVP 源码 |

- 提交前用 `git ls-files | grep -iE '\.env$|node_modules|^data/|\.reasonix|\.workbuddy|\.log$|_rid\.txt|_diag\.json|_r1\.json|fix_uuid|setup-test-review'` 校验入库清单为空。
- 若发现误暂存：立即 `git restore --staged <file>` 并确认其被 `.gitignore` 排除；已推送则按 8.1 方式回退。

### 3.5 文档落点（规则 6）

- 所有 Sprint 协作产物（Contract / Review / Gate / 规则 / 冻结文档）**必须**落在 `docs/coordination/`，命名遵循协议 §4（`Sprint_X.Y_*.md`）。
- 演示素材/截图落 `docs/demo/`，实现记录落 `docs/implementation/`，路线图落 `docs/roadmap/`。
- 禁止散落项目根或临时目录；根目录仅允许项目自身配置文件（如 `docker-compose.yml`、`package.json`、`reasonix.toml`——后者已忽略）。

### 3.6 验证命令留痕（规则 7）

- 任何**代码改动** Sprint，必须在产出文档中记录可复现的验证命令与结果：
  - `tsc --noEmit` 错误数（0 / N）；
  - smoke 脚本命令与通过数（如 `node scripts/smoke-export.js` → 21/21）；
  - 手动验收命令（如 `curl .../report/export.md`）与关键响应（状态码、Content-Disposition、字节数）。
- 纯文档 Sprint（如本 Sprint、7.5 冻结）无代码改动，不强制 smoke/tsc，但需声明"纯文档、未改代码"。
- 无验证命令 = Gate 不受理（协议 §6.3）。

---

## 4. 推荐提交纪律（供代码 Sprint 参考）

> 本文为规则文档，不要求本次执行提交。以下纪律供后续代码 Sprint 与 Gate 共同遵守。

1. 分支策略：主干协作，**直接在 `main` 工作并快进推送**；如需隔离实验，用短生命周期分支，合入前 rebase 到最新 `main`。
2. 提交粒度：每 Sprint 一个逻辑提交，message 含 Sprint 编号与范围（如 `feat(7.3): cap lmstudio roles at 3`）。
3. 提交前自检：`git status` + 入库清单 grep（§3.4）+ 敏感扫描（`sk-` / `Bearer <20+>` / `pris[*]{3,}`）+ `tsc`/smoke。
4. 推送：`git push`（已设 upstream 后无需 `-u`）；若被拒（非快进），先 `git pull --ff-only` 再推，禁止 `--force` 到 `main`。

---

## 5. 红线合规核对（本 Sprint）

| 红线 | 状态 |
|------|------|
| 不改业务代码 | ✅ 仅新增/更新文档（本文 + 协议 §9 + ACTIVE_SPRINT 滚动） |
| 不运行模型 | ✅ 无模型调用 |
| 不写密钥 | ✅ 仅引用 `sk-...` 占位格式说明，未写任何真实 Key |
| 不提交禁止项 | ✅ 本 Sprint 不执行提交；规则已明确要求后续禁止项不入库 |
| 文档落点正确 | ✅ 本文位于 `docs/coordination/` |

---

## 6. 交付物

- `docs/coordination/Sprint_8.2_Repo_Operating_Rules.md`（本文）
- `docs/coordination/AGENT_COORDINATION_PROTOCOL.md`（新增 §9 GitHub 工作规则）
- `docs/coordination/ACTIVE_SPRINT.md`（滚动到 8.2，补记 8.1 Go）

**Gate 状态**：In Progress（纯文档规则固化；规则本身被协议采纳即推进，待后续代码 Sprint 实际遵守时由 Gate 持续核查）。
