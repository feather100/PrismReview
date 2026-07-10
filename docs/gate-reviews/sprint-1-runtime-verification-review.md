# Sprint 1 Runtime Verification Review

Date: 2026-07-07
Reviewer: Codex
Scope: Local backend/frontend runtime verification for DiagnosisPage

## Gate Result

**Go** for Sprint 1 Diagnosis runtime path.

Runtime verification passed after one backend bug fix: invalid non-UUID `reviewId` now returns a validation error instead of Prisma 500.

## Environment Started

Docker containers verified:

- `prismreview-postgres` healthy on `5432`
- `prismreview-redis` healthy on `6379`
- `prismreview-minio` healthy on `9000/9001`

API started via local Nest CLI:

```powershell
cd D:\workspace\PrismReview\apps\api
.\node_modules\.bin\nest.CMD start --watch
```

Web started via local Next CLI:

```powershell
cd D:\workspace\PrismReview\apps\web
.\node_modules\.bin\next.CMD dev
```

Note: `pnpm dev` in this Codex environment attempted an automatic dependency check and failed on non-interactive module purge / sandbox write behavior. Direct local package binaries worked.

## Test Review Setup

Command:

```powershell
cd D:\workspace\PrismReview
node setup-test-review.js
```

Created review:

```text
035e3bfc-5d41-4fcf-b6c5-607892106f57
```

Success URL:

```text
http://localhost:3000/reviews/035e3bfc-5d41-4fcf-b6c5-607892106f57
```

Error URL:

```text
http://localhost:3000/reviews/invalid-id-123
```

## Success Path Verification

API:

```text
GET http://localhost:4000/api/reviews/035e3bfc-5d41-4fcf-b6c5-607892106f57/diagnosis
Status: 200
recommendedRoles: 5
```

Browser-rendered page contained:

- `Review Diagnosis`
- Summary for `Automated Setup Review (Go Microservices)`
- Tags: `架构设计`, `技术可行性`, `高并发`
- Risk Radar list with scores, including `架构合理性: 72 / 100`
- Recommended Committee with five roles
- No `Diagnosis Error` in success path

## Error Path Bug Found

Before fix:

```text
GET /api/reviews/invalid-id-123/diagnosis
Status: 500
Cause: Prisma UUID parse error in ReviewsService.getDiagnosis()
```

Root cause: controller accepted arbitrary `reviewId` strings and passed invalid UUID strings directly into Prisma UUID fields.

## Fix Applied

File:

```text
D:\workspace\PrismReview\apps\api\src\modules\reviews\reviews.controller.ts
```

Change:

- Imported `ParseUUIDPipe` from `@nestjs/common`.
- Applied `@Param('reviewId', ParseUUIDPipe)` to all `reviewId` params in `ReviewsController`.
- Removed unused `Query` import while touching the import line.

Validation:

```powershell
cd D:\workspace\PrismReview\apps\api
.\node_modules\.bin\tsc.CMD --noEmit
```

Result: **pass, 0 errors**.

## Error Path Verification After Fix

API:

```text
GET http://localhost:4000/api/reviews/invalid-id-123/diagnosis
Status: 400
```

Browser-rendered page contained:

- `Diagnosis Error`
- `Validation failed (uuid is expected)`
- `Retry`
- No success content such as `Recommended Committee`

## Non-Blocking Finding

Browser console contains an Ant Design warning:

```text
[antd: Spin] `tip` only work in nest or fullscreen pattern.
```

This does not block Sprint 1 runtime, but Antigravity should clean the loading state later by nesting `Spin` content or removing `tip`.

## Decision

### Antigravity

- **Go**: Diagnosis runtime integration is verified.
- Do not connect Meeting SSE/WebSocket yet.
- Next UI work may proceed to polish Diagnosis loading/error display or prepare the next static page, but must stay within approved scope.

### Reasonix

- **Go**: backend runtime support is verified.
- Keep `ParseUUIDPipe` fix.
- No new API/RAG/Embedding/MinIO/model integration is approved in this gate.

## Next Gate

Return for review before enabling any of:

- Meeting SSE/WebSocket connection;
- role selection write flow from the frontend;
- report page API integration;
- real RAG/Embedding/vector retrieval.
