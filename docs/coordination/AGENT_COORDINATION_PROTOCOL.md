# Agent Coordination Protocol（Agent 协作协议）

> 项目：PrismReview（reasonix → antigravity → qoderwork 文档协作模式）
> 定版：Sprint 3.11
> 目的：把已跑通的"文档驱动协作"模式固化为项目规则，避免对话过长后丢失上下文。
> 适用范围：所有涉及后端契约、前端实现、独立审查、Gate 判定的 Sprint。

---

## 0. 一句话原则

**所有协作通过文档完成，不通过口头/对话上下文。文档即契约，契约即真相。**

每个 agent 只读取上一环节产出的文档，向下一环节产出文档。上下文丢失时，从文档恢复，而不是从记忆恢复。

---

## 1. 角色分工（Roles）

| Agent | 职责范围 | 不做什么 |
|-------|----------|----------|
| **reasonix**（后端） | 后端契约（Contract）、状态机定义、DTO 定义、smoke 验证、技术边界声明 | 不随意改 schema；不写前端 UI；不绕过契约直接给前端口头承诺 |
| **antigravity**（前端） | 前端 UI 实现、中文体验、页面交互、状态展示 | 不得猜 API 字段；不得自行推断状态机；不得改变后端已定契约 |
| **qoderwork**（审查） | 独立代码审查，**只审查不改代码** | 不修改任何源码；不替 antigravity 写实现；不替 reasonix 改契约 |
| **Codex / 用户侧 Gate** | 最终 Go / No-Go 判定 | 只根据文档 + 验证证据判定，不凭印象 |

### 1.1 角色边界详解

- **reasonix** 是契约的唯一来源。前端能用的字段、状态流转、接口路径，全部由 reasonix 在 Contract 文档中显式声明。
- **antigravity** 必须在 Contract 文档约束内实现。遇到契约未覆盖的需求，回到 reasonix 补充 Contract，而不是直接猜测。
- **qoderwork** 是"第三方眼睛"。它读取 reasonix + antigravity 两份文档，交叉验证前端是否严格遵循契约；它的产出是 Review 文档，不是代码 diff。
- **Gate** 是决策终端。它不产出实现，只消费三份文档 + 验证证据，给出 Go / No-Go。

---

## 2. 标准 Sprint 流程（Standard Flow）

顺序不可颠倒。每一环必须基于上一环的文档，而非口头约定。

```
┌─────────────┐    Contract 文档    ┌──────────────┐   Frontend 文档   ┌──────────────┐
│  reasonix   │ ──────────────────▶ │  antigravity  │ ───────────────▶ │   qoderwork   │
│  Backend    │                     │  Frontend     │                  │   Review      │
└─────────────┘                     └──────────────┘                  └──────┬───────┘
                                                                             │ Review 文档
                                                                             ▼
                                                                     ┌──────────────┐
                                                                     │  Gate (Go/No-Go) │
                                                                     └──────────────┘
```

### 2.1 步骤

1. **reasonix 先输出 Backend / Contract 文档**
   - 声明接口路径、请求/响应 DTO、字段类型、状态机（所有合法 status 及流转）。
   - 声明本次 Sprint 的"技术边界"：哪些做、哪些不做、哪些是 mock / 占位。
   - 标注 smoke 验证情况（能跑通 / 仅类型校验 / 未执行）。

2. **antigravity 读取 Contract 后输出 Frontend Implementation 文档**
   - 明确列出"所依赖的 Contract 字段/接口清单"，逐条对应 reasonix 声明。
   - 说明页面交互、中文文案、状态展示逻辑。
   - 标注未覆盖的边界情况（如 `diagnosing` / `archived` 等过渡态）。

3. **qoderwork 读取两份文档后输出 Review 文档**
   - 交叉验证：前端是否只使用了 Contract 声明的字段？是否猜了字段？是否自行推断了状态机？
   - 审计状态推导矩阵、按钮状态机是否变动、是否引入新的推进能力。
   - 给出 Gate 结论建议（Go / No-Go）及 P0/P1/P2 清单。

4. **Gate 只根据文档 + 验证证据判定**
   - 不重读代码、不重做实现，只看三份文档 + tsc/smoke/手动验收证据。
   - 判定 Go（进入下一 Sprint）或 No-Go（打回对应环节）。

> ⚠️ 若任一环节文档缺失，下游环节必须停下来追问，不得"先猜后补"。

---

## 3. 固定目录（Fixed Directories）

所有协作产物必须落在以下目录，禁止散落根目录或临时目录。

| 目录 | 用途 |
|------|------|
| `docs/coordination/` | 跨 agent 协作产物：Contract、Review、Gate Summary、本协议 |
| `docs/implementation/` | 各 Sprint 的实现记录、技术决策、落地细节 |
| `docs/roadmap/` | Sprint 路线图、长期规划、版本计划 |
| `docs/demo/` | 演示素材、截图、验收用例、演示脚本 |

---

## 4. 文档命名规范（Naming Convention）

Sprint 编号格式：`Sprint_X.Y`（例如 `Sprint_3.11`）。

| 文档类型 | 命名模板 | 示例 |
|----------|----------|------|
| 后端契约 | `Sprint_X.Y_Backend.md` | `Sprint_3.11_Backend.md` |
| 前端实现 | `Sprint_X.Y_Frontend.md` | `Sprint_3.11_Frontend.md` |
| 独立审查 | `Sprint_X.Y_Qoderwork_Review.md` | `Sprint_3.11_Qoderwork_Review.md` |
| Gate 总结 | `Sprint_X.Y_Gate_Summary.md` | `Sprint_3.11_Gate_Summary.md` |

### 4.1 命名约定细则

- 编号统一用 `X.Y`（点分隔），不用 `X-Y` 或 `X_Y`。
- 角色后缀固定：`_Backend` / `_Frontend` / `_Qoderwork_Review` / `_Gate_Summary`。
- 子任务可在编号后追加语义，例如 `Sprint_3.6_P1_Hardening_Backend.md`。
- 协议类、流程类文档直接语义命名，如本文件 `AGENT_COORDINATION_PROTOCOL.md`。

---

## 5. 红线（Red Lines / 不可逾越）

以下规则无例外。违反任意一条，Gate 直接判 No-Go。

1. **antigravity 不得猜 API 字段。**
   所有使用的字段必须能在 reasonix 的 Contract 文档中找到显式声明。未在 Contract 中的字段，先让 reasonix 补充，再使用。

2. **antigravity 不得自行推断状态机。**
   状态（`status`）的合法值、流转条件、按钮可见性，全部以 reasonix 声明为准。前端不得新增、合并或重命名状态。

3. **qoderwork 不改代码。**
   Review 文档只描述问题、给出证据、建议修复方向。任何源码修改由对应实现 agent 执行。

4. **reasonix 不随意改 schema。**
   DTO / 数据库 schema 变更必须先更新 Contract 文档并通知下游；禁止"顺手改了字段类型"而不留痕。

5. **真实 LLM / RAG / Runner / Queue 需要单独 Gate。**
   涉及真实模型推理、检索增强、异步任务执行、消息队列的集成，不随普通 UI Sprint 一起放行，必须走独立 Gate 审查（性能、成本、失败重试、数据安全）。

---

## 6. Gate 标准（Gate Criteria）

### 6.1 严重级别定义

| 级别 | 含义 | Gate 行为 |
|------|------|-----------|
| **P0** | 阻塞级缺陷：破坏契约、猜字段、改状态机、改 schema 未留痕、真实集成无 Gate | **必须阻塞**，No-Go |
| **P1** | 重要问题：边界未覆盖、文案/体验缺陷、次要逻辑错误 | 可按 Sprint 决定是否阻塞（由 Gate 裁决） |
| **P2** | 可延后：deprecation warning、edge case 优化、遗留清理 | **留档**，不阻塞当前 Sprint |

### 6.2 判定流程

1. Gate 读取三份文档（Backend / Frontend / Qoderwork_Review）。
2. 核对验证证据是否齐备（见 6.3）。
3. 若存在任意 **P0** → **No-Go**，打回责任环节。
4. 若仅 **P1/P2** → Gate 裁决是否放行；放行的 P1 必须登记到下一 Sprint 跟进。
5. 输出 `Sprint_X.Y_Gate_Summary.md` 记录结论与证据索引。

### 6.3 必须写入文档的验证证据

以下证据**必须**出现在对应文档中，Gate 才会受理：

- **tsc 证据**：`tsc --noEmit` 的错误数（0 errors / N errors），注明执行环境。
- **smoke 证据**：关键接口能否跑通，mock 还是真实后端，失败点记录。
- **手动验收证据**：关键交互路径的验收结论（如状态时间线 5 态 + failed 推导逐条核对）。

> 无证据 = 无 Gate 受理。证据缺失视为 P0（验证不可信）。

---

## 7. 快速 Gate 模式（Fast Gate）

适用于**小改动/纯测试/纯文档** Sprint，在标准流程（§2）基础上简化，**不改 schema、不改状态机、不涉及真实 LLM/队列核心变更**。

### 7.1 触发条件

同时满足以下所有条件才能走快速 Gate：

1. **不改 Prisma schema**
2. **不改状态机流转**
3. **不涉及真实 LLM/Embedding/MinIO 的首次接入**
4. **不改前端主页面**
5. **不引入新外部依赖**

任何一条不满足 → 退回标准流程（§2）。

### 7.2 流程

```
reasonix（小改/测试/文档）
    │
    ▼
qoderwork（只查 P0/P1，最多 5 条证据）
    │
    ▼
Gate（Go / No-Go，简化判定）
```

- antigravity 本阶段无任务（除非涉及前端 mock 调整）。
- qoderwork 仅输出 P0/P1 清单，证据不超过 5 条。
- Gate 不要求全量三文档，reasonix 文档 + qoderwork 简短复审即可。

### 7.3 快速 Gate checklist

- [ ] 是否满足 7.1 所有触发条件？
- [ ] reasonix 是否描述了变更内容和验证方式？
- [ ] qoderwork 是否确认无 P0/P1？
- [ ] tsc / smoke 是否通过？

### 7.4 不符合快速 Gate 的例子

| 场景 | 理由 | 走标准流程 |
|------|------|-----------|
| 修改 Prisma schema | 触发红线 §5.4 | ✅ |
| 修改 Review.status 流转 | 触发红线 §5.2 | ✅ |
| 首次接入 BullMQ | 新外部依赖 | ✅ |
| 修改 roleSelection 结构 | 状态机相关 | ✅ |

---

建议后续新增 **`docs/coordination/ACTIVE_SPRINT.md`**，作为所有 agent 的**单一入口**，避免"从长对话里翻上下文"。

该文件记录当前 Sprint 的实时状态，结构建议如下：

```markdown
# ACTIVE_SPRINT

## 当前 Sprint
Sprint 3.11 — Agent Coordination Protocol

## 当前阶段
[ Backend → Frontend → Review → Gate ]  ← 高亮当前所在

## 负责人
- Backend: reasonix
- Frontend: antigravity
- Review: qoderwork
- Gate: Codex / 用户

## 输入文档
- 上游契约：docs/coordination/Sprint_3.10_*.md（上一 Sprint）

## 输出文档
- Backend:  docs/coordination/Sprint_3.11_Backend.md
- Frontend: docs/coordination/Sprint_3.11_Frontend.md
- Review:   docs/coordination/Sprint_3.11_Qoderwork_Review.md
- Gate:     docs/coordination/Sprint_3.11_Gate_Summary.md

## Gate 状态
[ 待定 / Go / No-Go ]  + 阻塞项链接
```

### 7.1 使用约定

- 每当进入新阶段，更新 `当前阶段` 与对应文档链接。
- 任一 agent 开工前，先读 `ACTIVE_SPRINT.md` 确认输入/输出契约。
- Gate 判定后，回填 `Gate 状态` 并指向下一 Sprint 编号。
- 该文件是"活文档"，随 Sprint 滚动更新，不归档。

---

## 8. 本 Sprint 说明（Sprint 3.11）

- **范围**：仅编写本协议文档（第 1–7 节），**不改任何代码**。
- **产出**：`docs/coordination/AGENT_COORDINATION_PROTOCOL.md`（即本文件）。
- **Gate 结论**：文档类 Sprint，无代码变更，无 tsc/smoke 证据需求；由用户侧确认采纳即视为 Go。
- **后续动作**：建议按第 7 节创建 `ACTIVE_SPRINT.md`，作为下一 Sprint 的起点。

---

## 9. GitHub 工作规则（Repo Operating Rules）

> 定版：Sprint 8.2（配合 `Sprint_8.1_GitHub_Bootstrap.md` 已建立的 `origin = https://github.com/feather100/PrismReview.git` + `main` 分支 + `.gitignore`）。
> 目的：避免后续 agent 在错误目录、错误分支、未同步状态下工作。所有涉及代码的 Sprint 开工前**必须遵守**本节。

### 9.1 开工三连查（强制，P0）

每次开工（含文档 Sprint）先执行以下命令，确认基线正确后再动手：

```bash
git rev-parse --show-toplevel   # 必须等于 PrismReview 根，不得是上层包装目录
git status                      # 确认工作树状态（有无未提交改动）
git remote -v                   # 确认 origin 指向 feather100/PrismReview
git pull --ff-only origin main  # 快进同步到最新 main（仅快进，不自动 merge）
```

- `--ff-only` 保证只快进：若本地有分叉提交，pull 会拒绝，此时先处理分叉（rebase 或核对），**不得**用 `--force` / `--no-ff` 强行合并。
- 未做三连查 → 不得动手（避免基于陈旧/错误代码工作）。

### 9.2 开工目录规则（强制，P0）

- 唯一有效工作根：**`D:\workspace\PrismReview`**（本地）或 GitHub clone 的同名 PrismReview 根目录。
- 开工前用 `git rev-parse --show-toplevel` 校验；输出必须是 PrismReview 根，**不得**是上层包装目录（如 `/d/workspace`、`/Users/.../work` 或 Codex/Qoderwork 生成的包装区）。
- 目录不对 → 立即停下切换，不盲干。

### 9.3 禁止在包装工作区初始化 Git（强制，P0）

- Codex / Qoderwork 等平台可能生成**包装工作区**（外层目录 + 内层项目）。**绝不在**此类包装区执行 `git init` 或把整个包装区作为仓库根。
- 若在某平台收到"clone 到临时区"的任务，先确认 `toplevel` 仍是 PrismReview 根、remote 指向 `feather100/PrismReview`，再开工。
- 误在包装区 init：立即 `rm -rf <包装区>/.git`（仅删误建仓库，不删项目文件）或放弃该工作区，回项目根重来。

### 9.4 禁止提交的产物（强制，P0）

以下**永不入库**（已由 8.1 `.gitignore` 覆盖；提交前 `git status` 二次确认未被暂存）：

| 类别 | 路径/模式 |
|------|-----------|
| 密钥 | `.env` / `apps/api/.env` / `.env.*.local` |
| 依赖 | `node_modules/` |
| 运行数据 | `data/` |
| 本地 agent 状态 | `.reasonix/` / `reasonix.toml` / `.workbuddy/` |
| 日志/调试 | `*.log` / `pilot-*.log` / `_*.json` / `_rid.txt` / `debug/` |
| 一次性脚本 | `fix_uuid.js` / `fix_uuid2.js` / `setup-test-review.js` |

提交前校验入库清单为空：
```bash
git ls-files | grep -iE '\.env$|node_modules|^data/|\.reasonix|\.workbuddy|\.log$|_rid\.txt|_diag\.json|_r1\.json|fix_uuid|setup-test-review'
# → 期望：无输出
```
若误暂存：`git restore --staged <file>` 并确认其被 `.gitignore` 排除；已推送则按 8.1 方式回退。

### 9.5 文档落点（强制，P1）

- 每个 Sprint 的协作产物（Contract / Review / Gate / 规则 / 冻结文档）**必须**入 `docs/coordination/`，命名遵循 §4（`Sprint_X.Y_*.md`）。
- 演示素材/截图 → `docs/demo/`；实现记录 → `docs/implementation/`；路线图 → `docs/roadmap/`。
- 禁止散落根目录或临时目录。

### 9.6 代码改动须记录验证命令（强制，P1）

- 任何代码改动 Sprint，产出文档必须记录可复现的验证命令与结果：`tsc --noEmit` 错误数、smoke 脚本通过数、关键 `curl` 响应（状态码 / `Content-Disposition` / 字节数）。
- 纯文档 Sprint 无代码改动，不强制 smoke/tsc，但需声明"纯文档、未改代码"。
- 无验证命令 = Gate 不受理（同 §6.3）。

### 9.7 提交纪律（供代码 Sprint 参考）

1. 主干协作：直接在 `main` 工作并快进推送；实验用短生命周期分支，合入前 rebase 到最新 `main`。
2. 提交粒度：每 Sprint 一个逻辑提交，message 含 Sprint 编号与范围。
3. 提交前自检：`git status` + 入库清单 grep（§9.4）+ 敏感扫描（`sk-` / `Bearer <20+>` / `pris[*]{3,}`）+ `tsc`/smoke。
4. 推送：`git push`；若被拒（非快进），先 `git pull --ff-only` 再推，**禁止 `--force` 到 `main`**。

---

## 附录 A：快速 checklist（供 Gate 使用）

- [ ] reasonix 是否输出了显式 Contract（接口 + DTO + 状态机 + 边界）？
- [ ] antigravity 是否逐条对应 Contract 字段，无猜测？
- [ ] antigravity 是否沿用 reasonix 状态机，无自行推断？
- [ ] qoderwork 是否只读审查，未改代码？
- [ ] 三份文档是否齐备（Backend / Frontend / Review）？
- [ ] tsc / smoke / 手动验收证据是否写入文档？
- [ ] 若存在真实 LLM/RAG/Runner/Queue，是否走了单独 Gate？
- [ ] Gate Summary 是否产出并记录结论？
