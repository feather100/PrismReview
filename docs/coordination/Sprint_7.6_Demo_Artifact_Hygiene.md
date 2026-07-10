# Sprint 7.6 — Demo Artifact Hygiene（演示交付物卫生清理）

> **角色**：workbuddy-coder（仅演示交付物卫生清理，不改业务逻辑）
> **模式**：演示交付物清理（非功能开发，标准流程卫生环节）
> **前置必读**：`docs/coordination/Sprint_7.5_Workbuddy_Review.md`
> **日期**：2026-07-10
> **结论**：**Done（无需 Gate 复审）** — 运行残留已清除，`.env.example` 掩码密钥已替换为纯占位符，验证 grep 全过，零业务代码改动。

---

## 1. 前置阅读与基线

已读 `Sprint_7.5_Workbuddy_Review.md`。其 §备注（非阻塞）明确给出两条本 Sprint 的清理标的：

1. **`apps/api/pilot-instance.log`** — 7.4 E2E 运行残留日志（含 cap 警告行），非源码、非交付物，建议演示前清理。
2. **`.env.example:10`** — `MINIO_SECRET_KEY="pris**********cret"` 为历史掩码值（非真实密钥，但形似半真实 secret），建议改为纯占位符。

本 Sprint 严格按这两条建议执行，未扩大范围。

---

## 2. 执行范围（契约边界）

| 项 | 是否允许 | 本 Sprint 处理 |
|----|----------|----------------|
| 清理运行残留（`*.log` / 临时 pilot 输出） | ✅ 允许 | 删除 `pilot-instance.log` |
| `.env.example` 掩码密钥 → 占位符 | ✅ 允许 | `MINIO_*` → `<change-me>` |
| 改业务代码 / schema / 前端逻辑 | ❌ 禁止 | 未触碰 |
| 运行真实外部模型 | ❌ 禁止 | 未运行 |
| 删除标准构建缓存（`*.tsbuildinfo`） | ❌ 不在范围 | 保持不动（详见 §4.3） |

---

## 3. 执行步骤与证据

### 3.1 清除运行残留

**扫描**：`find . -name '*.log' -not -path './node_modules/*'`
- 删除前命中：`apps/api/pilot-instance.log`（9.5 KB，mtime 09:04，7.4 E2E 专用 pilot 实例 :4100 的 stdout/stderr 日志）。
- 执行：`rm -f apps/api/pilot-instance.log`。
- 删除后复扫：`*.log`（排除 node_modules）**零命中**。

> 该日志为未跟踪文件（`git status --porcelain` 干净，已被 gitignore 排除出交付），物理删除兼具磁盘卫生与防误打包双重目的。

### 3.2 修正 `.env.example` 掩码密钥

`MINIO_ACCESS_KEY` 原为 `"[redacted]"`（掩码占位但不统一），`MINIO_SECRET_KEY` 原为 `"pris**********cret"`（历史掩码值，形似半真实 secret）。统一改为明显占位符：

```diff
- MINIO_ACCESS_KEY="[redacted]"
- MINIO_SECRET_KEY="pris**********cret"
+ MINIO_ACCESS_KEY="<change-me>"
+ MINIO_SECRET_KEY="<change-me>"
```

改动仅 2 行，未触及任何其他变量、未写真实密钥。

### 3.3 未清理项说明（刻意保持）

- **`*.tsbuildinfo`**（位于 `node_modules/.pnpm/*`、`apps/api/dist/`、`apps/web/`）：标准 TypeScript 增量构建缓存，非 pilot 输出、不含密钥，不在本 Sprint "运行残留 / 临时 pilot 输出" 范围内，保持不动。
- **`DATABASE_URL="postgresql://prismreview:prismreview@localhost..."`**：`prismreview:prismreview` 为 localhost 开发默认示例凭据（非掩码、非半真实密钥），7.5 Review 未将其列为问题；改为占位符会破坏 Demo 的复制即用性，故保持。仅 `MINIO_SECRET_KEY` 这类"历史掩码值"按契约替换。
- **`# MODEL_API_KEY="sk-..."`**（注释行）：注释掉的占位符*格式示例*（含 `...` 表明"在此填入你的 Key"），非真实 Key，保留作格式说明。

---

## 4. 最小验证（任务 §4）

### 4.1 grep 确认无 `pilot-instance.log` 残留

```
grep -rn "pilot-instance\.log" .  → 仅命中 docs/coordination/Sprint_7.5_Workbuddy_Review.md
                                 （文档"引用"该文件名作为清理建议，非文件残留）
find . -name '*.log'  → 零命中（排除 node_modules）
```

**结论**：文件已物理删除，交付物中无任何 `*.log` 运行残留。

### 4.2 grep 确认 `.env.example` 无看似真实 / 半真实 secret

```
grep 半真实密钥模式 (sk-<realkey> | pris**** | <val>{8,}\*{2,}<val> | [redacted])  →
  命中仅：
    L2  DATABASE_URL="...prismreview:prismreview@localhost..."  ← localhost 默认示例，非密钥
    L11 MINIO_BUCKET="prismreview"                              ← 默认桶名，非密钥
    L35 # MODEL_API_KEY="sk-..."                               ← 注释掉的占位符格式示例
grep "\*{4,}" 全仓（排除 node_modules） → 零命中（无任何 **** 掩码残留）
```

**结论**：`MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` 均为 `<change-me>`；无 `pris**********cret` 式半真实掩码、无 `[redacted]`、无 `sk-` 真实 Key。

### 4.3 终态快照

```bash
# .env.example (L8–L11)
MINIO_ENDPOINT="localhost:9000"
MINIO_ACCESS_KEY="<change-me>"
MINIO_SECRET_KEY="<change-me>"
MINIO_BUCKET="prismreview"
```

---

## 5. 红线合规

| 红线 | 状态 |
|------|------|
| 不改业务代码 | ✅ 仅改 `.env.example` 2 行注释性占位符 |
| 不改 schema | ✅ 未触碰 |
| 不改前端逻辑 | ✅ 未触碰 |
| 不运行真实外部模型 | ✅ 仅做静态清理与 grep 验证 |
| 不写真实密钥 | ✅ 替换为 `<change-me>`，无真实 secret 写入 |
| 不扩大调用次数 / 不接付费 API | ✅ 无关改动，不涉及 |

---

## 6. 交付物

| 文件 | 类型 | 说明 |
|------|------|------|
| `docs/coordination/Sprint_7.6_Demo_Artifact_Hygiene.md` | 新增 | 本卫生清理文档 |
| `apps/api/pilot-instance.log` | **已删除** | 7.4 运行残留清除 |
| `.env.example` | 修改 | `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` → `<change-me>` |

**复现命令**：

```bash
# 1) 删除运行残留
rm -f apps/api/pilot-instance.log

# 2) 验证无 log 残留
find . -name '*.log' -not -path './node_modules/*'

# 3) 验证 .env.example 无半真实 secret（应仅命中长期示例与注释占位符格式）
grep -nE '(sk-[A-Za-z0-9]+|pris[*]+|\[redacted\]|[a-z0-9]{8,}\*{2,})' .env.example
```

---

## 7. 结论

演示交付物卫生清理完成：**运行残留日志已删除**，**历史掩码密钥已替换为纯占位符 `<change-me>`**，验证 grep 全数通过，且**零业务代码 / schema / 前端改动**、**未运行任何真实外部模型**、**未写入任何真实密钥**。本环节为演示交付前卫生清理，无功能性变更，建议直接进入 Demo 冻结/发布流程（无需 Gate 复审）。
