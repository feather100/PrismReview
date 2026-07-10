# Sprint 1 Code Review — Backend Phase 1-4 + Frontend Diagnosis Scaffold

> 日期：2026-07-06  
> 输入：reasonix 后端 Phase 1-4 编码、antigravity 前端 App Shell + Diagnosis Scaffold  
> 结论：No-Go for merge/build claim。代码方向正确，但存在明确编译/运行阻塞项；修复后再进入 Meeting Page 或下一模块。

## 1. 总体结论

- SoT 遵守情况：通过。未发现新增 Prisma 表，`schema.prisma` 仍为 14 个 model。
- 外部模型边界：通过。未发现真实 OpenAI/Anthropic 调用进入代码路径。
- 后端功能覆盖：方向正确，覆盖 G01/G05/G10/G21/G22/G24。
- 前端 scaffold：方向正确，诊断页使用 mock adapter 且高影响按钮 disabled。
- 当前质量门：不通过。至少存在 3 个 P0 编译/运行风险。

## 2. P0 必修问题

### P0-1. `@Delete` 未导入，RolesController 会编译失败

文件：`apps/api/src/modules/roles/roles.controller.ts`

现状：第 66 行使用 `@Delete(':roleId')`，但第 1 行未从 `@nestjs/common` 导入 `Delete`。

修复：

```ts
import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards, UseInterceptors, ClassSerializerInterceptor } from '@nestjs/common';
```

### P0-2. `verify.bat` 是 Bash 风格注释，Windows batch 会失败

文件：`apps/api/verify.bat`

现状：`.bat` 文件使用 `#` 注释。Windows cmd 不把 `#` 当注释。

修复：改为 `.ps1` 或使用 `REM` / `::` 注释。建议新增 `verify.ps1`，因为本项目主要在 PowerShell 环境使用。

### P0-3. Mock diagnosis 使用不存在的 roleId，角色选择无法通过真实校验

文件：`apps/api/src/modules/reviews/reviews.service.ts`

现状：`buildMockDiagnosis()` 返回 `mock-cto-id` 等硬编码 ID。`saveRoleSelection()` 会查询 `agentRole.findMany({ id in roleIds, tenantId, status: enabled })`。如果 seed 不创建这些固定 ID，用户确认推荐角色会失败。

修复方案二选一：

1. 诊断时从 DB 查询当前租户启用角色，根据 code 匹配 CTO/CFO/PMO/Compliance/UserAdvocate 后填真实 roleId。
2. 或 seed 固定这 5 个 UUID，并让 mock diagnosis 使用同一组 ID。

推荐方案 1，避免 mock ID 漂移。

## 3. P1 高优先修复

### P1-1. listRoles 的 `available_for_review` 未校验 review 租户

文件：`apps/api/src/modules/roles/roles.service.ts`

现状：读取 review 后没有确认 `review.tenantId === tenantId`；虽然最终 roles where 带 tenantId，但不应允许拿其他租户 reviewId 驱动筛选逻辑。

修复：`findFirst({ where: { id: reviewId, tenantId } })`。

### P1-2. 预置角色不可删除/禁用规则未实现

PRD 规定预置角色不可删除，可禁用。当前 `deleteRole()` 对所有角色软删。建议：

- `type === 'preset'` 时删除返回 400/409。
- `disableRole()` 允许 preset/custom。

### P1-3. CreateRoleDto 未落实系统提示词 ≥200 字规则

PRD 要求系统提示词不少于 200 字。当前 `systemPrompt` 可缺省且短 prompt 自动生成。MVP 如要降级，应在文档中标注；否则需要 validator。

### P1-4. TenantGuard 未全局接入

`TenantGuard` 已实现，但没有在 AppModule 或 controller 中使用。当前多数 service 自行按 tenantId 查询，尚可；但如果保留该 Guard，需明确接入策略，否则容易产生“以为有守卫”的错觉。

### P1-5. Knowledge local path 使用相对路径

文件：`apps/api/src/modules/knowledge/knowledge.service.ts`

`./data/uploads/{tenantId}` 依赖进程启动目录。建议使用配置项或 `process.cwd()` 明确路径，并在 `.gitignore` 确认 `data/uploads` 不入库。

## 4. 前端评审

通过项：

- App shell + Ant Design Registry + Theme 已成型。
- DiagnosisPage 使用 mock adapter，可独立开发。
- 高影响按钮默认 disabled，符合权限未知默认只读。
- 未发现全局 snake_case converter。

需修正：

- Mock roles 使用 `ARCHITECT` / `SEC`，与后端/PRD 预置角色不一致。建议改成 CTO / Compliance / PMO 等真实 code。
- DiagnosisPage 暂无 error state，只显示普通 div。建议接入 `ErrorAlert` 或 AntD Alert。

## 5. 下一步裁决

No-Go 进入 Meeting Page 或新后端模块，先修 P0。

修完 P0 后可继续：

1. 运行/提供可复现编译命令结果。
2. Seed + mock diagnosis roleId 对齐。
3. 再做 API smoke test：`/api/auth/me`、`/api/roles`、`POST /api/reviews`、`POST /api/reviews/:id/diagnose`、`GET /api/reviews/:id/diagnosis`。

## 6. 可转发修复指令

```text
请先修 Sprint 1 P0 阻塞项，不要继续新增功能：
1. roles.controller.ts 导入 Delete。
2. verify.bat 改为可运行的 Windows 脚本（建议 verify.ps1），不要用 # 注释。
3. mock diagnosis 不要返回 mock-cto-id 等不存在 roleId；从 DB 按 code 查询真实启用角色填充 recommendedRoles。
4. 修复后给出 tsc/build 或至少 TypeScript noEmit 的可复现结果。
```
