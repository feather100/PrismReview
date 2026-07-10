# Backend Demo Freeze QA — Sprint 2.7

> 冻结当前 MVP Demo 后端行为，确保演示前不被回归破坏。

---

## 1. Smoke 验证结果

| 脚本 | 结果 |
|---|---|
| `node scripts/smoke-runtime.js` | ✅ **27/27 passed, 0/27 failed** |
| `node scripts/smoke-runner.js` | ✅ **11/11 passed, 0/11 failed** |
| `node scripts/setup-demo-review.js` | ✅ **Route A: source=mock_fallback** |
| `node scripts/setup-demo-review.js --with-runner` | ✅ **Route B: 3/3 turns, source=db_opinions** |

---

## 2. 文档一致性检查

| 文档 | 命令 | 与实际一致？ |
|---|---|---|
| `docs/demo/MVP_Demo_Runbook.md` | `node scripts/setup-demo-review.js` | ✅ |
| `docs/demo/MVP_Demo_Runbook.md` | `node scripts/setup-demo-review.js --with-runner` | ✅ |
| `docs/demo/MVP_Demo_Runbook.md` | `node scripts/smoke-runtime.js` | ✅ |
| `docs/demo/MVP_Demo_Runbook.md` | `node scripts/smoke-runner.js` | ✅ |
| `README.md` | `node scripts/smoke-runtime.js` | ✅ |
| `README.md` | `setup-demo-review.js` | ❌ 未提及（职责在 demo runbook） |

README 未包含 `setup-demo-review` 命令是刻意的——README 是项目入口，demo 操作指南在 `docs/demo/` 中。

---

## 3. LM Studio 依赖检查

**确认：默认 Demo 不要求 LM Studio。**

- `setup-demo-review.js` 默认使用 `mock` provider
- `--with-runner` 也使用 `mock` provider（由 `run-agent-turns-for-review.js` 内部调用 `getProvider()`，默认返回 mock）
- LM Studio 仅在显式设置 `MODEL_PROVIDER=lmstudio` + `ALLOW_EXTERNAL_MODEL_CALLS=true` 时才会被调用
- `docs/demo/MVP_Demo_Runbook.md` 已明确标注："LM Studio **不是默认演示依赖**"

---

## 4. Demo 前置条件

```
1. Docker 运行中（postgres + redis + minio）
   docker compose up -d

2. 数据库已初始化
   cd apps/api
   pnpm prisma:migrate --name init
   pnpm prisma:seed
   cd ../..

3. API 服务运行中（:4000）
   apps/api/node_modules/.bin/nest.CMD start --watch

4. （可选）Web 前端运行中（:3000）
   apps/web/node_modules/.bin/next.CMD dev

5. 默认 Demo
   node scripts/setup-demo-review.js
   → 无需 LM Studio，无需额外配置
```

---

## 5. 回归 Guard

以下变更必须重新运行本 QA 后才能合入 Demo 分支：

- 修改 `provider-adapter.js`
- 修改 `run-agent-turns-for-review.js`
- 修改 `setup-demo-review.js`
- 修改 `reviews.service.ts` 中的 report 逻辑
- 修改 `report-response.dto.ts`
- 新增或修改 API 路由
- 修改 Prisma schema

---

## 6. 结论

**后端 MVP Demo 已冻结，可以随时演示。**

| 维度 | 状态 |
|---|---|
| smoke-runtime | ✅ 27/27 |
| smoke-runner | ✅ 11/11 |
| Route A (mock) | ✅ source=mock_fallback |
| Route B (runner) | ✅ 3/3, source=db_opinions |
| 无 LM Studio 依赖 | ✅ |
| 文档一致 | ✅ |
