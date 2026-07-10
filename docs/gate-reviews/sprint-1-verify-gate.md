# Sprint 1 Verify Gate — Build Passed

> 日期：2026-07-07  
> 输入：reasonix `verify.ps1` 通过结果、Prisma schema 编译修复说明  
> 结论：Build Gate 通过，可进入最小 API smoke test。

## 1. 已确认

- `apps/api/verify.ps1` 工作目录已修正为 `$PSScriptRoot`。
- `verify.ps1` 四步通过：依赖安装、Prisma Client 生成、TypeScript noEmit、NestJS build。
- Prisma schema 仍为 14 个 model，未新增表。
- `Tenant.knowledgeChunks` 为反向关系声明，不新增表。
- `AgentRole.activeVersionId @unique` 会产生唯一约束/索引，用于满足 Prisma 一对一 activeVersion 关系；语义可接受。

## 2. 通过条件

可进入最小 API smoke test，但仍需遵守：

- 不接真实外部模型。
- 不上传真实企业文档。
- 先运行 seed，保证 5 个预置角色存在。
- smoke test 完成前，不继续 Meeting Page 或报告页联调。

## 3. 最小 Smoke Test 清单

建议按以下顺序执行：

1. `docker compose up -d`
2. `cd apps/api && pnpm prisma:seed`
3. `pnpm dev`
4. `GET /api/auth/me`
5. `GET /api/roles`
6. `POST /api/reviews`
7. `POST /api/reviews/{reviewId}/diagnose`
8. `GET /api/reviews/{reviewId}/diagnosis`
9. `GET /api/roles?available_for_review={reviewId}`
10. `POST /api/reviews/{reviewId}/roles`
11. `GET /api/reviews/{reviewId}/diagnose/stream`
12. `POST /api/knowledge/documents`
13. `GET /api/knowledge/documents`
14. `POST /api/knowledge/search-test`

## 4. 裁决

Go for API smoke test.

如果 smoke test 通过，可以放行前端 Diagnosis Page 从 mock adapter 切到真实 API adapter，并开始 Meeting Page 的低风险静态 scaffold。
