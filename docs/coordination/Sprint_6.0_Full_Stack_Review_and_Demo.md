# Sprint 6.0 — Full-Stack Review + Real LLM Demo

> **角色**：workbuddy-coder（标准 Gate — review + demo，不改源代码）
> **模式**：review-first（代码审查 + 真实 LLM E2E demo + 前端启动演示）
> **基线**：main = `4cfaec9`（Sprint 5.3 P5 已入库）
> **日期**：2026-07-14
> **Owner**：workbuddy-coder

---

## 0. 三连查

```bash
git rev-parse --show-toplevel   # = D:/workspace/PrismReview
git status --short
git remote -v                   # = feather100/PrismReview
git pull --ff-only origin main  # 4cfaec9
```

---

## 1. Part A — 全栈代码审查（只读）

> 不改代码。对以下每个模块读取关键文件，评估质量/一致性/潜在问题。

### 1.1 审查清单

| 模块 | 关注点 |
|------|--------|
| **orchestrator/** | moderator.ts（P1 mock）、llm-moderator.ts（P4 LLM）、review-orchestrator.ts（P1/P3/P4 改动点）；边界 flag 是否完整 |
| **queue/queue.service.ts** | promptService 调用 + phase pattern 派发 + runningReviews flag；是否有内存泄漏（processedIds / runningReviews Map 随 review 完成清理？） |
| **modules/prompt/** | PromptService.compose 四层组装确定性；version 回填 |
| **modules/memory/** | rolling summary 截断边界；distillation 幂等 |
| **modules/tool/** | A2A 是否真正只经 Moderator；tool_approval 状态机完整 |
| **modules/workflow/** | preset 兼容性兜底；validateCustom 边界 |
| **modules/reviews/scoring/** | scoringConfig snapshot 写入时机；NaN/空 opinions 边界 |
| **modules/reviews/reporting/** | getReport 委托与旧方法 deprecated wrapper 并存是否冲突；export.md 评分小节格式 |
| **modules/reviews/reviews.service.ts** | 构造函数可选依赖注入是否都 fallback；interrupt/resume 双路径（DB 翻牌 + orchestrator flag）是否一致 |
| **apps/web/** | 前端页面增减（首页/我的评审/新建/诊断/会议室/报告）；API client 接口对齐；RBAC/评分字段是否有 UI 展示 |
| **docs/coordination/** | ACTIVE_SPRINT.md 是否与各 Sprint commit 对齐 |

### 1.2 审查维度

每个模块回答：
1. **完整性**：契约声明的接口是否完整实现？是否有 TODO 遗留？
2. **一致性**：P1→P5 跨 Sprint 改动是否风格统一（logger、错误红线性、审计落库）？
3. **健壮性**：边界条件（空 opinions / 单 role / NaN scoring / 并发 interrupt）是否处理？
4. **安全性**：是否有任何路径可绕过 RBAC / 是否有日志泄漏 secrets / 是否有未校验 input？
5. **死代码**：是否有被新方法替代但未删的旧逻辑？

### 1.3 审查输出格式

```
## 模块：orchestrator/review-orchestrator.ts
- ✅ 完整性：start/interrupt/resume/handleTurnsComplete 均已实现
- ⚠️ 一致性：runningReviews Map 在 review 进入终态后未清理 → 内存膨胀风险
- ⚠️ 健壮性：interrupt 后若 turn 超时（>30s）无兜底 resume → 可能永久卡 interrupted
- 🔴 安全：无问题
- 🗑️ 死代码：第 XX 行的 legacy if 分支（P1 旧逻辑）未被替代

（每个模块一节）
```

---

## 2. Part B — 真实 LongCat LLM E2E Demo

> **允许**：修改 .env 启动配置（测试模式，不提交）；调真实 LLM API。
> **禁止**：不改源代码；测试后恢复 mock 默认。

### 2.1 前置检查

```bash
# 读取 LongCat key（仅用于测试，不落库/不提交/回报中不输出 key）
# 文件：C:\Users\sugon\Desktop\longcatapi.txt
```

### 2.2 启动真实 LLM 模式

启动 API server 时注入 env：
```bash
cd apps/api
ALLOW_EXTERNAL_MODEL_CALLS=true \
MODEL_PROVIDER=longcat \
MODEL_BASE_URL=https://api.longcat.chat/openai/v1 \
MODEL_NAME=LongCat-2.0 \
MODEL_API_KEY=<读自 longcatapi.txt，不输出> \
DATABASE_URL=<既有 .env 的值> \
node dist/main.js
```

### 2.3 E2E 测试（mock + longcat 双模式对比）

1. **mock 基线**（默认 env）: POST /api/reviews → /diagnose → /roles → /start → 等待完成 → GET /api/reviews/:id/report
   - 记录：providerSources、opinionCount、verdict、scoring.overallScore、narrative 来源
2. **longcat 真实**（按 2.2 启动）: 同样流程
   - 记录：providerSources（是否 = longcat）、opinion 真实内容、scoring、总耗时、模型名
3. **对比**：两种模式的报告结构一致性；真实 LLM 是否在 60s 内完成；是否有降级（fallback_mock / failed）

### 2.4 关键断言（真实模式）

- opinions[].dimension / riskLevel / issue / recommendation 均由 LongCat 生成（非 mock 固定值）
- modelOutputRef JSON 中 providerSource === 'longcat'
- scoringConfig 中 workflowId 正确 + dimensionScores 非空
- narrative 由 LlmModerator.narrate() 生成（若 MODERATOR_PROVIDER=llm）或由 fallback 路径生成
- 无 ERROR 日志；无未处理 rejection

### 2.5 测试后清理

- 停止 ​​longcat 模式 server
- 确认 .env 文件中 MODEL_PROVIDER 保持 unset/mock（不提交任何 env 改动）
- 记录测试结论

---

## 3. Part C — 前端启动演示

### 3.1 启动前端

```bash
cd apps/web
npm install  # 若 node_modules 缺失
npm run dev  # 默认 port 3000
```

### 3.2 前端功能走查（手动或脚本辅助）

启动后访问 `http://localhost:3000`，逐页验证：

| 页面 | 路径 | 验证点 |
|------|------|--------|
| 首页（我的评审）| `/reviews` | 列表加载 / 搜索 / 筛选 / 分页 / 归档按钮 |
| 新建评审 | `/reviews/new` | 表单 / workflow selector（enterprise/code-review/research/thesis） / mode 切换 |
| 创建成功 → 诊断 → 选角色 → 启动 | `/reviews/:id` | 诊断结果 / 角色推荐 + 自定义 / 启动流程 |
| 会议室 | 同上 tab | SSE 流 / turns / opinions / interrupt/resume 按钮 |
| 报告 | `/reviews/:id/report` | 报告加载 / scoring 小节 / narrative / 图表 / export.md 下载 |

### 3.3 与后端对齐检查（若后端 server 已运行）

1. 浏览器登录（mock user）
2. 触发完整 评审流程（mock 模式即可） — 确认 API 200、数据一致
3. 检查 Console 无 CORS / 500 错误
4. 确认前端 scoring 展示正确解析 `report.scoring` 字段

### 3.4 若前端无真实后端

- 使用 MSW / mock API 走查纯前端交互
- 记录哪些页面因 API 契约未对齐而显示异常

---

## 4. 红线（绝对守）

| # | 红线 |
|---|------|
| 1 | LongCat key 仅从 `C:\Users\sugon\Desktop\longcatapi.txt` 读取；不落盘/不提交/回报/日志中不输出明文 |
| 2 | 默认 mock；真实 LLM 仅测试时显式 env 启用 |
| 3 | Part A 审查**只读**不改代码；Part B 可以**启动时注入 env** 但不改源 |
| 4 | 不 --force；不 git commit / push（交 Codex 走 Gate 决定是否纳入正式 commit） |
| 5 | 测试后恢复 mock 默认（env 文件不提交） |
| 6 | grep 用 `git grep` |

---

## 5. 交付

### 5.1 审查报告（Part A）

输出 `docs/coordination/Sprint_6.0_Full_Stack_Review.md`，包含：
- 各 P1→P5 模块审查结果（按 §1.3 格式）
- 🔴 安全/严重问题清单
- 🗑️ 死代码 / 技术债清单
- 总体质量评分（1-10）与改进优先级

### 5.2 LLM Demo 报告（Part B）

输出到 §7 报告模板，包含：
- mock vs longcat 对比表
- 真实模式总耗时 + 各 turn 耗时
- 是否触发 fallback / 降级
- 截图或 log excerpt 为证（不泄漏 key）

### 5.3 前端走查报告（Part C）

- 各页面状态（✅ 正常 / ⚠️ 有部分异常 / 🔴 严重异常）
- 与后端 API 契约对齐问题
- 用户体验 note

### 5.4 整改 P0/P1/P2 清单

若审查发现严重问题，列出整改任务（不实施，仅登记）。

---

## 6. 回报格式

```
【Sprint 6.0 workbuddy-coder Full-Stack Review + Demo 报告】

## 三连查 ✓

## Part A: 全栈审查
（各模块一节）
- 🔴 安全/严重: N 项
- 🗑️ 死代码/技术债: N 项
- 总体评分: X/10

## Part B: LongCat 真实 LLM Demo
- mock 基线: N opinions, verdict=X, scoring=Y
- longcat 真实: N opinions, providerSource=longcat, 总耗时=Xs
- 降级情况: 无 / 有（原因）
- 结论: ✅ 真实 LLM 跑通 / ⚠️ 降级到 mock / 🔴 失败

## Part C: 前端走查
- 我的评审页面: ✅/⚠️/🔴 + 问题描述
- 新建评审页面: ...
- 会议室页面: ...
- 报告页面: ...

## 整改清单
- P0（阻塞）: ...
- P1（重要）: ...
- P2（可延后）: ...

## 结论
建议后续 Sprint / 建议立即整改
```
