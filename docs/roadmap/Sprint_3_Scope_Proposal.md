# Sprint 3 — 后端范围建议

> 依据：Sprint 1~2 完成状态、MVP Demo Freeze (Sprint 2.7) 基线。
> 不写新功能，先明确下一阶段优先级。

---

## 1. 当前 MVP Freeze 状态

### 1.1 已完成

| 能力 | 状态 | 说明 |
|---|---|---|
| 首页 (Auth) | ✅ | `GET /api/auth/me` — mock JWT, 权限派生 |
| 发起评审 | ✅ | `POST /api/reviews` — 创建 draft |
| 方案诊断 | ✅ | `POST /api/reviews/{id}/diagnose` + `GET /api/reviews/{id}/diagnosis` — mock Chairman |
| 角色管理 | ✅ | 5 预置角色 (CTO/CFO/PMO/Compliance/UA) + CRUD API |
| 保存评审团 | ✅ | `POST /api/reviews/{id}/roles` — 带 DTO 校验 |
| 开始评审 | ✅ | `POST /api/reviews/{id}/start` — 状态机守卫 |
| 评审会议室 (Mock SSE) | ✅ | `GET /api/reviews/{id}/meeting/stream` — 15 事件 + 3 角色 |
| 评审报告 (Mock) | ✅ | `GET /api/reviews/{id}/report` — source=db_opinions / mock_fallback |
| Agent Turn Runner | ✅ | `scripts/run-agent-turns-for-review.js` — 写 DB, 幂等, --force |
| 知识库 (Mock) | ✅ | `POST /api/knowledge/documents` + `POST /api/knowledge/search-test` |
| 一键 Demo | ✅ | `scripts/setup-demo-review.js` — Route A (mock) / Route B (runner) |
| Provider Adapter | ✅ | `scripts/provider-adapter.js` — mock + lmstudio + guard |

### 1.2 默认不依赖 LM Studio

- 所有默认 Demo 使用 mock provider（0ms，零外部依赖）
- LM Studio 需显式设置 `MODEL_PROVIDER=lmstudio` + `ALLOW_EXTERNAL_MODEL_CALLS=true`
- 文档已明确标注

### 1.3 Smoke 基线

```
smoke-runtime:  27/27 passed
smoke-runner:   11/11 passed
```

---

## 2. Sprint 3 推荐主线

### 评审列表 + 真实业务入口

**当前问题**：用户无法查看自己的评审历史。前端仅通过 localStorage 维护最近评审，不是真业务系统。

**推荐优先级 P0**：评审列表页所需的后端能力。

### 为什么不先做其他方向

| 方向 | 暂缓原因 |
|---|---|
| 真实 Agent Queue | 无评审列表就没有业务入口；用户无法选择要看的评审 |
| RAG/知识库 | Mock 已可用，真实 RAG 需要 pgvector + embedding，应在核心闭环稳定后 |
| Report 导出 | PDF/DOCX 非 MVP 必须，可延后 |
| Jira | 集成不阻塞评审闭环 |
| 权限/审计 | Mock 已可用，细化可在 Dashboard 之后 |

---

## 3. 后端建议任务

### 3.1 GET /api/reviews — 评审列表

**当前状态**：已有 `GET /api/reviews`，返回自己创建的所有 review，无分页无过滤。

**建议增强**：

```typescript
// Query params
interface ListReviewsQuery {
  status?: 'draft' | 'diagnosing' | 'ready' | 'running' | 'completed' | 'failed';
  mode?: 'round_robin' | 'free_debate';
  limit?: number;   // 默认 20, 最大 100
  offset?: number;  // 默认 0
}

// Response
interface ReviewListItem {
  id: string;
  title: string;
  objective: string;
  status: string;
  mode: string;
  createdAt: string;
  updatedAt: string;
  // 可选（轻量 JOIN）
  createdByName?: string;
  roleCount?: number;       // roleSelection 中的角色数
  riskSummary?: string;     // "2 high, 3 medium"
  opinionCount?: number;    // 仅 completed 有效
}
```

### 3.2 不做的范围

- ❌ 复杂搜索（全文检索、标签过滤）
- ❌ 排序选项（仅按 `createdAt DESC`）
- ❌ 软删除 / 归档 API
- ❌ 批量操作
- ❌ 统计聚合（评审数、平均耗时等 — 留给 Dashboard 专用端点）

### 3.3 不改现有状态机

Review 的 status 流转保持不变，列表 API 只读，不修改。

### 3.4 不接 LLM / RAG / Runner

列表 API 不调用 provider，不触发 agent turn，不检索知识库。

---

## 4. 备选方向（暂缓）

| 方向 | 建议 Sprint | 前置依赖 |
|---|---|---|
| 真实 Agent Queue (BullMQ) | Sprint 4+ | 评审列表完成、Provider 稳定 |
| RAG / pgvector | Sprint 4+ | 知识库有真实文档、embedding 模型可用 |
| Report 导出 (PDF/MD) | Sprint 4+ | Report API 稳定, 前端确认格式 |
| Jira/飞书集成 | Sprint 5+ | Action Item API 稳定, Webhook 抽象 |
| 权限/审计细化 | Sprint 3/4 边缘 | 当前 mock 够用, 可配合用户系统 |
| Dashboard 数据统计 | Sprint 4+ | 列表 API 完成, 有数据可统计 |

---

## 5. 风险与红线

| # | 红线 | 说明 |
|---|---|---|
| R01 | **不随意改 schema** | 列表 API 不新增字段；如需 `roleCount` / `opinionCount` 查现有 JSON 字段计算 |
| R02 | **不把 runner 接进 startReview** | runner 是独立脚本，Phase B 设计不阻塞 `POST /start` |
| R03 | **不让前端猜 API 字段** | 列表 API 返回结构必须与 DTO 一致，前端不依赖响应中的隐藏字段 |
| R04 | **不改现有 status 流转** | 列表 API 只读，不改变 `draft → diagnosing → ready → running → completed / failed` |
| R05 | **不新增 provider 调用** | 列表 API 不触发 LLM / provider / runner |
| R06 | **不引入 Worker / Queue** | Sprint 3 列表 API 无异步任务 |

---

## 6. 建议 Sprint 3 验收标准

```text
1. GET /api/reviews 支持 ?status=&mode=&limit=&offset=
2. 返回字段覆盖：id, title, status, mode, createdAt, updatedAt
3. 不修改 review status
4. 不调用 provider / LLM
5. smoke-runtime 不回归 (27/27)
6. smoke-runner 不回归 (11/11)
```
