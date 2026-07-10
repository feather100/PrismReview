# PrismReview — Demo Rehearsal Report

> Sprint 2.3 — 从零运行路线 A / 路线 B，记录结果与问题。

---

## 1. 环境状态

| 组件 | 状态 | 详情 |
|---|---|---|
| Docker (postgres) | ✅ Up 5h (healthy) | `prismreview-postgres` |
| Docker (redis) | ✅ Up 5h (healthy) | `prismreview-redis` |
| Docker (minio) | ✅ Up 5h (healthy) | `prismreview-minio` |
| API (`:4000`) | ✅ HTTP 200 | `GET /api/auth/me` 正常返回 |
| Web (`:3000`) | 🟡 HTTP 500 | Next.js 启动成功但首页返回 500（antigravity 负责的页面尚未就绪） |

**说明**：前端返回 500 不影响 API 演示。Demo 时可直接用 curl 或浏览器打开 API URL 查看 JSON 响应。

---

## 2. 路线 A — 纯 Mock 演示

### 命令

```powershell
node scripts\setup-demo-review.js
```

### 结果

```
✅ Review created: "PrismReview MVP Demo"
✅ Diagnosed — 3 tags, 5 roles available
✅ Roles saved: CTO, CFO, PMO
✅ Review started (status: running)
Route:       A (pure mock)
Report src:  mock_fallback
```

### Report API 验证

```json
{
  "source": "mock_fallback",
  "opinionCount": 3,
  "generatedFromTurns": false,
  "verdict": "conditionally_approved"
}
```

### URL

| 页面 | URL |
|---|---|
| Diagnosis | `/reviews/{id}` |
| Meeting | `/reviews/{id}/meeting` |
| Report | `/reviews/{id}/report` |
| SSE Stream | `/api/reviews/{id}/meeting/stream` |

---

## 3. 路线 B — Runner + DB Opinions

### 命令

```powershell
node scripts\setup-demo-review.js --with-runner
```

### 结果

```
✅ Review created: "PrismReview MVP Demo"
✅ Diagnosed — 3 tags, 5 roles available
✅ Roles saved: CTO, CFO, PMO
✅ Review started (status: running)
⏳ Running agent turns...
✅ mock provider, 3/3 turns completed
Route:       B (runner + DB opinions)
Report src:  db_opinions
```

### Report API 验证

```json
{
  "source": "db_opinions",
  "opinionCount": 3,
  "generatedFromTurns": true,
  "verdict": "conditionally_approved",
  "opinions": [
    { "agentCode": "CTO", "dimension": "架构合理性", "riskLevel": "high", "confidenceScore": 78 },
    { "agentCode": "CFO", "dimension": "投入产出分析", "riskLevel": "medium", "confidenceScore": 72 },
    { "agentCode": "PMO", "dimension": "交付风险", "riskLevel": "medium", "confidenceScore": 65 }
  ]
}
```

---

## 4. 发现的问题

| # | 问题 | 影响 | 状态 |
|---|---|---|---|
| 1 | Web 前端 (`:3000`) 首页返回 HTTP 500 | Demo 时无法在浏览器查看 UI 页面 | 🟡 antigravity 修复中 |
| 2 | 无 | — | — |

### 说明

- **问题 1**：前端页面是 antigravity 的工作范畴，本 repo 的 sprint 仅负责后端和 CLI 脚本。Demo 时建议直接展示 API JSON 响应（curl），或等待 antigravity 的前端修复完成后展示 UI。
- **无其他问题**：Docker 稳定运行 5h+，API 零错误，runner 稳定，smoke 全通过。

---

## 5. Smoke 验证状态

```powershell
node scripts\smoke-runtime.js   → 27/27 passed
node scripts\smoke-runner.js    → 11/11 passed
node scripts\setup-demo-review.js          → Route A: source=mock_fallback ✅
node scripts\setup-demo-review.js --with-runner → Route B: 3/3, source=db_opinions ✅
```

---

## 6. Demo 讲解建议

| 环节 | 建议表述 |
|---|---|
| 开场 | "PrismReview 是一个多 Agent 评审中枢。用户提交方案后，系统自动组建跨领域 AI 评审委员会。" |
| 路线 A | "当前演示使用内置 mock 数据，展示了从发起评审到生成报告的完整闭环。" |
| Report source | "注意 Report 的 `source` 字段清晰标明数据来源：`mock_fallback` 表示 mock，`db_opinions` 表示来自真实 agent turn。" |
| 路线 B | "开启 `--with-runner` 后，runner 会串行执行 3 个 agent turn，将结构化评审意见写入数据库。" |
| 三个角色 | "技术审核员 CTO 关注架构风险，商业控制者 CFO 关注投入产出，交付守护者 PMO 关注排期依赖——每个角色从不同维度审查方案。" |
| 数据透明 | "每条意见包含风险等级、置信度分数和改进建议，且来源可追溯。" |
| 后续 | "后续 sprint 将接入真实 LLM 模型、实时 SSE 推送和 RAG 知识检索。" |
