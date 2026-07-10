<#
.SYNOPSIS
    PrismReview API — Build & Verify Script
.DESCRIPTION
    Installs dependencies, generates Prisma Client, checks TypeScript compilation,
    and builds the NestJS API project.
#>

$ErrorActionPreference = "Stop"

Write-Host "=== Step 1: Install dependencies ===" -ForegroundColor Cyan
Push-Location $PSScriptRoot
pnpm install
if ($LASTEXITCODE -ne 0) { throw "pnpm install failed" }

Write-Host "=== Step 2: Generate Prisma Client ===" -ForegroundColor Cyan
pnpm prisma:generate
if ($LASTEXITCODE -ne 0) { throw "prisma generate failed" }

Write-Host "=== Step 3: TypeScript type check (noEmit) ===" -ForegroundColor Cyan
npx tsc --noEmit --pretty
if ($LASTEXITCODE -ne 0) { throw "TypeScript compilation failed" }

Write-Host "=== Step 4: NestJS build ===" -ForegroundColor Cyan
pnpm build
if ($LASTEXITCODE -ne 0) { throw "NestJS build failed" }

Write-Host "" -ForegroundColor Green
Write-Host "=== Build successful! ===" -ForegroundColor Green
Write-Host ""
Write-Host "=== Step 5: Start dev server (requires Docker) ===" -ForegroundColor Yellow
Write-Host "  docker compose up -d          (from project root)"
Write-Host "  pnpm dev                       (from apps/api)"
Write-Host ""
Write-Host "=== Verify endpoints ===" -ForegroundColor Yellow
Write-Host "  curl http://localhost:4000/api/auth/me"
Write-Host "  curl http://localhost:4000/api/roles"
Write-Host "  curl http://localhost:4000/api/reviews"
Write-Host ""
Write-Host "=== Prisma seed (one-time, requires DB) ===" -ForegroundColor Yellow
Write-Host "  pnpm prisma:seed"

Pop-Location
