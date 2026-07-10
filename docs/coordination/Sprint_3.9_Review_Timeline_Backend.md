# Sprint 3.9 — Review Detail Timeline Contract

> 为评审详情页/状态时间线定义最小后端契约。
> 不改代码，不改 schema。

---

## 1. 现有 `GET /api/reviews/{id}` 返回字段

| 字段 | 类型 | 来源 |
|---|---|---|
| `id` | string | DB |
| `title` | string | DB |
| `objective` | string | DB |
| `status` | string | DB |
| `mode` | string | DB |
| `inputType` | string | DB |
| `createdBy` | string (UUID) | DB |
| `createdAt` | string (ISO) | DB |
| `updatedAt` | string (ISO) | DB |

**不包含**：`roleSelection`、`diagnosis`、`report` 信息。

---

## 2. 前端时间线所需的 8 条信息

| # | 信息 | 来源 | 获取方式 |
|---|---|---|---|
| 1 | 当前 status | `GET /reviews/{id}` | ✅ 单字段 |
| 2 | 创建时间 createdAt | `GET /reviews/{id}` | ✅ 单字段 |
| 3 | 更新时间 updatedAt | `GET /reviews/{id}` | ✅ 单字段 |
| 4 | 是否已有 diagnosis | `GET /reviews/{id}/diagnosis` → `null` 或对象 | ⚠️ 需第 2 次调用 |
| 5 | 是否已选角色 | `GET /reviews/{id}` 当前不返回 roleSelection | ❌ 无法直接判断 |
| 6 | 是否已开始 meeting | `status === 'running'` 即表明已开始 | ✅ 从字段 1 可推断 |
| 7 | 是否已有 report | `GET /reviews/{id}/report` → 200 或 400 | ⚠️ 需第 3 次调用 |
| 8 | 下一步建议 nextAction | 需从上述信息组合计算 | ❌ 需前端或后端逻辑 |

### 当前组合成本

```
GET  /api/reviews/{id}           → status, createdAt, updatedAt
GET  /api/reviews/{id}/diagnosis → null 或结果（判断是否已诊断）
GET  /api/reviews/{id}/report    → 200(有) / 400(无/不可用)
```

前端需发起 **3 次调用** 才能获取完整时间线信息。

---

## 3. 可用接口组合分析

### 现有接口

```
GET /reviews/{id}         — 基本字段（无 roleSelection）
GET /reviews/{id}/diagnosis   — 诊断结果/null
GET /reviews/{id}/report      — 报告/错误
```

### 能判断的节点

| 时间线步骤 | 判断依据 |
|---|---|
| 已创建 | status 存在即可 |
| 已诊断 | `GET /diagnosis` 返回非 null |
| 已选择角色 | ❌ 无法从现有 API 直接判断（roleSelection 在 DB 但不在 DTO 中） |
| 评审中 | status === running |
| 已完成 | status === completed |
| 报告就绪 | `GET /report` → source 为 db_opinions 或 mock_fallback |

### 缺口

**无法判断 "已选择角色"（第 5 条）**：
- `GET /reviews/{id}` 不返回 `roleSelection`
- `GET /reviews/{id}/report` 对 `ready` 状态的 report 返回 200 mock，但无法区分是 mock 生成还是有真实 roleSelection

---

## 4. 推荐方案

### 方案 A：前端组合现有接口（推荐 ✅）

```
并行调用：
  GET /reviews/{id}           → 获取 status / createdAt / updatedAt
  GET /reviews/{id}/diagnosis → 判断是否已诊断
  
条件调用：
  status === ready → 可推断"已诊断 + 可组局"
  status === running → 可推断"已组局 + 已开始"
  status === completed → 可推断"已完成"
```

**前端推导逻辑**：

```typescript
const timeline = [];
timeline.push({ key: 'created', label: '已创建', status: 'completed', timestamp: review.createdAt });

if (diagnosis !== null) {
  timeline.push({ key: 'diagnosed', label: '已诊断', status: 'completed' });
}

if (review.status === 'ready' || /* running/completed */) {
  timeline.push({ key: 'roles-selected', label: '已确认评审团', status: 'completed' });
} else if (diagnosis !== null) {
  timeline.push({ key: 'roles-selected', label: '确认评审团', status: 'pending', action: '前往诊断书' });
}

if (review.status === 'running' || review.status === 'completed') {
  timeline.push({ key: 'meeting', label: '评审会议', status: 'completed' });
} else if (review.status === 'ready' && diagnosis !== null) {
  timeline.push({ key: 'meeting', label: '开始评审', status: 'pending', action: '进入会议室' });
}

if (review.status === 'completed') {
  timeline.push({ key: 'report', label: '报告已生成', status: 'completed', action: '查看报告' });
}
```

**估值**：约 30 行前端逻辑，无需后端改动。

**优点**：
- 零后端变更
- 数据源实时一致
- 加入 `roleSelection` 到 DTO 的 minor 改进可延迟

**缺点**：
- 前端需处理 2-3 次调用
- status > ready 的部分信息是隐含推断而非显式数据

### 方案 B：后端新增 `GET /api/reviews/{id}/timeline`（备选）

```
GET /api/reviews/{id}/timeline

Response 200:
{
  reviewId: string,
  status: string,
  steps: [
    { key: 'created', label: '已创建', order: 1, status: 'completed', timestamp: '...' },
    { key: 'diagnosed', label: '已诊断', order: 2, status: 'completed', timestamp: '...' },
    { key: 'roles-selected', label: '已确认评审团', order: 3, status: 'completed', timestamp: '...' },
    { key: 'meeting', label: '评审会议', order: 4, status: 'completed', timestamp: '...' },
    { key: 'report', label: '报告已生成', order: 5, status: 'completed' }
  ],
  nextAction: '查看报告' | '进入会议室' | '组局开始评审' | '生成诊断书' | null
}
```

**优点**：
- 单次调用即可渲染
- 数据精确（不依赖前端推断）

**缺点**：
- 需新增 API + DTO + smoke 测试
- 后端需读取 diagnosis 和 roleSelection 来推导状态
- 当前 Sprint 3 范围中属于额外功能

---

## 5. 推荐：方案 A

| 维度 | 方案 A（前端组合） | 方案 B（后端 timeline） |
|---|---|---|
| 后端变更 | 零 | 新增 endpoint + test |
| 前端复杂度 | 中等（30 行逻辑） | 低 |
| 调用次数 | 2-3 次 | 1 次 |
| 维护成本 | 低 | 需随状态机同步更新 |
| sprint 可行性 | 当前可做 | 需排入待办 |

**推荐理由**：
1. 现有 3 个接口组合可推导出全部 8 条信息（仅"已选择角色"需从 status 推断）
2. 零后端变更，不改 schema，不新增 API
3. 前端组合方案约 30 行 TypeScript，成本极低
4. 如果后续发现性能问题（并发调用），可再引入方案 B

---

## 6. 可选改进（不改代码，仅记录）

如果未来选择方案 B，建议字段：

```typescript
interface TimelineStep {
  key: 'created' | 'diagnosed' | 'roles-selected' | 'meeting' | 'report';
  label: string;
  order: number;
  status: 'completed' | 'in_progress' | 'pending' | 'skipped' | 'failed';
  timestamp?: string;     // 仅 completed / in_progress 有
  action?: string;        // 仅 pending 有：引导按钮文案
}
```

---

## Backend Recommendation

**方案 A — 前端组合现有接口** ✅

**是否建议进入实现 Sprint**：**否** — 无需后端实现，直接交付前端开发即可。

### 给 antigravity 的前端开发指南

1. 打开评审详情页时并发调用：
   ```typescript
   const [review, diagnosis] = await Promise.all([
     api.get(`/api/reviews/${id}`),
     api.get(`/api/reviews/${id}/diagnosis`),
   ]);
   ```
2. 推导时间线逻辑见第 4 节方案 A。
3. `nextAction` 可前端计算：status=draft → "生成诊断书", status=ready → "组局开始评审", status=completed → "查看报告"。
4. report 链接可在 status=completed 时直接展示，无需额外调用。
