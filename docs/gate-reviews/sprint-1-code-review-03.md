# Sprint 1 Code Review — Tail Fix Follow-up

> 日期：2026-07-06  
> 输入：reasonix verify.bat + buildMockDiagnosis 修复  
> 结论：两个尾巴本体已修复；但 `verify.ps1` 当前工作目录计算错误，需修正后再执行验证。

## 1. 已确认

- `apps/api/verify.bat` 已改为合法 batch stub，使用 `REM` 注释并引导运行 `verify.ps1`。
- `buildMockDiagnosis()` 已移除 role code fallback。
- 预置角色不齐时会抛出 `BadRequestException('Preset roles not seeded...')`。
- 未发现 `mock-cto-id` 等假 roleId 在有效逻辑中继续使用。

## 2. 新发现：verify.ps1 目录错误

文件：`apps/api/verify.ps1`

当前逻辑：

```powershell
$RootDir = Split-Path -Parent $PSScriptRoot
Push-Location $RootDir
```

当脚本位于 `D:\workspace\PrismReview\apps\api\verify.ps1` 时：

- `$PSScriptRoot` = `D:\workspace\PrismReview\apps\api`
- `Split-Path -Parent $PSScriptRoot` = `D:\workspace\PrismReview\apps`

这会进入 `apps` 目录，而不是 `apps/api`。随后 `pnpm prisma:generate`、`pnpm build` 等脚本可能找不到正确 package scripts。

## 3. 必修修复

将：

```powershell
$RootDir = Split-Path -Parent $PSScriptRoot
Push-Location $RootDir
```

改为：

```powershell
Push-Location $PSScriptRoot
```

或者显式命名：

```powershell
$ApiDir = $PSScriptRoot
Push-Location $ApiDir
```

## 4. 修复后验证

在本地终端运行：

```powershell
cd D:\workspace\PrismReview\apps\api
.\verify.ps1
```

预期至少完成：

- `pnpm install`
- `pnpm prisma:generate`
- `npx tsc --noEmit --pretty`
- `pnpm build`

## 5. 裁决

Conditional No-Go：不要继续新功能，先修 `verify.ps1` 工作目录并跑一次验证。

修完且 verify 通过后，可进入 API smoke test。
