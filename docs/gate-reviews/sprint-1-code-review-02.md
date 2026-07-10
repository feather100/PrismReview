# Sprint 1 Code Review — P0 Fix Follow-up

> 日期：2026-07-06  
> 输入：reasonix P0/P1 修复、antigravity Diagnosis 前端修复  
> 结论：P0 基本修复，可进入本地 build/smoke test；但需清理遗留 `verify.bat`，并修正 mock diagnosis 缺 seed fallback 策略。

## 1. 已确认修复

### 后端

- `roles.controller.ts` 已导入 `Delete`，`@Delete(':roleId')` 编译阻塞解除。
- 已新增 `apps/api/verify.ps1`，使用 PowerShell 合法语法。
- `buildMockDiagnosis()` 已改为按 `CTO/CFO/PMO/Compliance/UserAdvocate` 从 DB 查询真实角色 ID。
- `available_for_review` 已加入 review tenant 校验逻辑。
- 预置角色删除已阻止，提示使用 disable。

### 前端

- mock role code 已改为 `CTO` / `Compliance` / `PMO`。
- `DiagnosisPage` 已加入 AntD `Alert` 错误态和 Retry 动作。
- Meeting Page 已暂停，符合上轮裁决。

## 2. 仍需修正

### P0.1 遗留 `verify.bat` 仍存在

`apps/api/verify.bat` 仍保留旧内容，并且仍包含非法 `#` 注释。虽然已有 `verify.ps1`，但旧脚本会误导后来者。

裁决：删除 `verify.bat`，或改成只提示使用 `verify.ps1` 的合法 batch。

### P0.2 mock diagnosis fallback 不能用 role code 作为 roleId

`buildMockDiagnosis()` 当前在 seed 未跑时 fallback 到 code，例如 `roleId: 'CTO'`。这会在 `saveRoleSelection()` 中被真实 DB 校验拒绝。

裁决：不要 fallback 到 code。若预置角色缺失，应返回明确错误或在诊断结果中只包含实际查到的角色。推荐：

- 若 5 个预置角色未齐全，抛出 `BadRequestException('Preset roles not seeded')`。
- 或自动降级，只推荐查到的角色，并在诊断结果加入 `warnings`。

MVP 更推荐前者，迫使开发者先运行 seed。

## 3. 可进入的下一步

在修复上面两个小尾巴后，可以进入本地验证：

```powershell
cd D:\workspace\PrismReview\apps\api
.\verify.ps1
```

随后启动 DB 和 seed：

```powershell
cd D:\workspace\PrismReview
docker compose up -d
cd apps\api
pnpm prisma:seed
pnpm dev
```

最小 smoke test：

- `GET /api/auth/me`
- `GET /api/roles`
- `POST /api/reviews`
- `POST /api/reviews/:reviewId/diagnose`
- `GET /api/reviews/:reviewId/diagnosis`
- `POST /api/reviews/:reviewId/roles`

## 4. 裁决

Conditional Go to local build/smoke test.

不建议继续开发新页面或新后端模块，直到 `verify.ps1` 和上述 smoke test 至少跑通一次。
