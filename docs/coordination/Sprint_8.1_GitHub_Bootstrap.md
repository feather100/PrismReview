# Sprint 8.1 — GitHub Repository Bootstrap

> **角色**：workbuddy-coder（真实项目首次 Git 初始化 + 首个提交 + 配置远端 + 推送）
> **前置前提**：真实项目根 `D:\workspace\PrismReview`；未在 Codex/Qoderwork 包装区初始化；目标首次提交并推送到 `https://github.com/feather100/PrismReview`
> **日期**：2026-07-10
> **结论**：**首次 Git 引导完成并成功推送到 GitHub**：commit `a4da677…` 已推送至 `origin/main`（254 文件，本地仓库级身份 `feather100`）。配置 GitHub 连接器后 `git push -u origin main` 成功（退出码 0）。未改任何业务逻辑。

---

## 1. 执行环境核查

| 项 | 结果 |
|----|------|
| `.git` 是否存在 | 否 → 已 `git init`（空仓库） |
| `git` 版本 | 2.54.0.windows.1 |
| `gh` CLI | 未安装（推送走 `git` HTTPS） |
| git 身份 | 全局/本地均未设 → 已设**仓库级**身份 `feather100 <feather100@users.noreply.github.com>`（仅本仓库生效，可后续 `git commit --amend --author` 修正） |
| 凭据 | 初始 `credential.helper=helper-selector` 无已存凭据；配置 **GitHub 连接器**后推送获得凭据（由连接器注入，token 值不在此记录） → `git push -u origin main` 成功（退出码 0） |

---

## 2. .gitignore 完善

原有规则已覆盖：`node_modules/`、`.pnpm-store/`、`.next/`、`dist/`、`.turbo/`、`*.tsbuildinfo`、`.env`/`.env.local`/`.env.*.local`、`*.log`、`__pycache__/`、Prisma migrations、`data/minio/`。

**本 Sprint 新增**（Sprint 8.1 段）：
```
apps/api/.env          # 显式排除本地 env（原 .env 已覆盖，补充明确性）
data/                  # 运行数据整目录（原仅 data/minio/）
_*.json                # 调试转储（_diag.json / _r1.json）
_rid.txt               # 调试 id 文件
.reasonix/             # 本地 agent 状态
.workbuddy/            # 本地 agent 状态
reasonix.toml          # 本地 Reasonix 权限快照（与 .reasonix/ 同类，补充文件级）
pilot-*.log            # 临时 pilot 输出
*.debug / debug/       # 临时 debug 输出
fix_uuid.js            # 一次性 codemod（非 MVP 源码）
fix_uuid2.js           # 一次性 codemod
setup-test-review.js   # 本地测试 helper
```

**`git check-ignore` 验证**：`node_modules` / `apps/api/.env` / `data` / `_rid.txt` / `_diag.json` / `_r1.json` / `fix_uuid.js` / `fix_uuid2.js` / `setup-test-review.js` / `.reasonix` / `.workbuddy` / `reasonix.toml` —— **全部 IGNORED**。

**`git add -n` dry-run 过滤**（`node_modules/`、`/\.env$`、`data/`、`_rid.txt`、`_diag.json`、`_r1.json`、`fix_uuid`、`setup-test-review`、`/\.log$`、`tsbuildinfo`、`reasonix.toml`）—— **零命中**，确认无禁止项会被暂存。

---

## 3. 敏感信息扫描（仅摘要，不输出真实值）

> 扫描范围：仓库内全部文件，排除 `node_modules`/`dist`/`.git`（ripgrep 默认遵循 `.gitignore`，故被忽略的 `.env` 等不计入可提交文件）。以下仅列**匹配文件路径**，绝不输出真实密钥值。

| 类别 | 命中情况 | 判断 |
|------|----------|------|
| `sk-` + 10+ 字符（OpenAI 式 Key） | 1 个文档 `Sprint_5.0_Agent_Output_Observability_Contract.md` | 文档对 `MODEL_API_KEY` 占位符格式（`sk-...`）的**说明性提及**，非真实 Key |
| `Bearer` + 真实 token | **零命中** | 无真实 Bearer token |
| `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`MODEL_API_KEY=` 带值 | **零命中** | 无已赋值的真实 Key（`.env.example` 中 `MODEL_API_KEY` 仅为注释占位 `sk-...`） |
| 本机绝对路径 `C:\`/`/c/`/`/Users/`/`/home/`/`D:\` | 命中若干 `docs/*.md`（文档叙述）、`scripts/run-agent-turns-for-review.js:26`、`reasonix.toml` | 文档为叙述性提及；`run-agent-turns-for-review.js:26` 硬编码 `D:\workspace\PrismReview\apps\api\node_modules\@prisma\client`（**非密钥**，仅本地结构，低风险）；`reasonix.toml` 为本地 agent 状态（已忽略，见 §2） |
| 半真实掩码 secret（`pris****` / `[redacted]` 等） | 命中 7 个 `docs/*.md` | 均为文档对"曾存在的掩码值"（如 7.5/7.6 Review 提及 `pris**********cret` 作为**清理对象**）的引用性描述，非真实密钥 |

**结论**：可提交文件中**未发现真实 API Key / 真实 Bearer token / 已赋值密钥 / 真实半真实 secret**。`apps/api/.env`（708 字节，含真实本地值）**存在但已被 `.gitignore` 排除，未进入任何提交**（§5 验证）。

---

## 4. 根目录临时文件判断（先记录，不盲删）

| 文件 | 大小 | 性质 | 判断 | 处理 |
|------|------|------|------|------|
| `fix_uuid.js` | 678 B | 一次性 `ParseUUIDPipe` codemod 改写脚本 | **应忽略** | 加入 `.gitignore`，保留本地、不提交 |
| `fix_uuid2.js` | 723 B | 同上（目录遍历版）一次性 codemod | **应忽略** | 同上加忽略 |
| `setup-test-review.js` | 2432 B | 本地 `localhost:4000` 测试 helper（含硬编码 `Bearer test-token`，为 mock 测试令牌、非真实密钥） | **应忽略** | 同上加忽略 |
| `_diag.json` | 85 B | 运行时错误响应转储 `{"code":"INTERNAL_ERROR",...}` | **应忽略** | 匹配 `_*.json` 忽略 |
| `_r1.json` | 267 B | 草稿 review 对象调试转储 | **应忽略** | 匹配 `_*.json` 忽略 |
| `_rid.txt` | 37 B | review id 调试文件 | **应忽略** | 匹配 `_rid.txt` 忽略 |

**说明**：6 个文件均判定「应忽略」（从仓库排除、保留本地），**未做删除**——遵循"不要盲删，先记录判断"。它们全部被 `.gitignore` 排除，不会进入提交。

---

## 5. 提交与推送结果

### 5.1 首次提交（成功）
```bash
git init                                              # 空仓库
git config user.name "feather100"                    # 仓库级
git config user.email "feather100@users.noreply.github.com"
git add .
git commit -m "chore: bootstrap PrismReview MVP demo"
```
- **Commit hash**：`a4da677d110d9ccdfb5c380dd0651283312391cd`
- **分支**：`main`
- **提交文件数**：254（working tree clean；仅 LF/CRLF 换行归一化警告，无害）
- **入库校验**（`git ls-files | grep -iE '\.env$|node_modules|reasonix\.toml|_rid\.txt|_diag\.json|fix_uuid|setup-test-review'`）：**空** → 无 `.env` / `node_modules` / 本地 agent 状态 / 调试文件入库。

### 5.2 远端配置（成功）
```bash
git remote add origin https://github.com/feather100/PrismReview.git
# → origin = https://github.com/feather100/PrismReview.git
git branch -M main
```

### 5.3 推送（成功 ✅）
```bash
git push -u origin main
# → * [new branch]      main -> main
# → branch 'main' set up to track 'origin/main'.
# → 退出码 0
```
**验证**：`git ls-remote --heads origin main` 返回 `a4da677d110d9ccdfb5c380dd0651283312391cd`（与本地 HEAD 一致） → 远端 `origin/main` 已建立，首个提交已上线。

---

## 6. 红线合规核对

| 红线 | 状态 |
|------|------|
| 不提交 `.env` | ✅ `apps/api/.env` 已忽略，未入库 |
| 不提交 `node_modules` | ✅ 已忽略，未入库 |
| 不提交 `.reasonix` / `.workbuddy` 本地 agent 状态 | ✅ 二者（含 `reasonix.toml`）已忽略，未入库 |
| 不提交 `data/` 运行数据 | ✅ `data/` 已忽略，未入库 |
| 不提交真实 API Key | ✅ 扫描无真实 Key；`.env` 未提交 |
| 不改业务逻辑 | ✅ 仅 `git init` + `.gitignore` + 文档；零源码/配置业务改动 |

---

## 7. 推送完成确认

> 推送已通过 **GitHub 连接器**注入的凭据成功完成，无需用户本地额外操作。

```bash
git ls-remote --heads origin main
# → a4da677d110d9ccdfb5c380dd0651283312391cd	refs/heads/main
```

访问 `https://github.com/feather100/PrismReview` 可确认 `main` 分支与首个提交 `a4da677` 已上线。后续提交只需 `git push`。

---

## 8. 交付物

- **提交**：`a4da677d110d9ccdfb5c380dd0651283312391cd`（"chore: bootstrap PrismReview MVP demo"，254 files，分支 `main`）
- **远端**：`https://github.com/feather100/PrismReview.git`（已配置为 `origin`）
- **`.gitignore`**：已完善（见 §2）
- **本文档**：`docs/coordination/Sprint_8.1_GitHub_Bootstrap.md`

**推送状态**：✅ 已成功推送至 `origin/main`（`a4da677…`）。后续提交只需 `git push`。
