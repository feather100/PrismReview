# Sprint 1.1 Runtime Hardening Review

Date: 2026-07-07
Reviewer: Codex
Scope: Antigravity Diagnosis polish + Reasonix runtime hardening

## Gate Result

**Go**

Sprint 1.1 Runtime Hardening + Diagnosis Polish is accepted after one reviewer-side fix to the runtime smoke script.

## Frontend Review — Antigravity

### Passed

- `apps/web/src/lib/api-client/client.ts` now uses `NEXT_PUBLIC_API_BASE_URL` with fallback `http://localhost:4000/api`.
- Diagnosis response types are defined in `client.ts`:
  - `DiagnosisResponse`
  - `RecommendedRole`
  - `RadarDimension`
- `DiagnosisPage.tsx` no longer uses broad `any` for diagnosis rendering data.
- Loading state was adjusted; browser console no longer reports the previous Ant Design `Spin tip` warning.
- Diagnosis UI now renders:
  - `confidenceScore`
  - `roleCode`
  - `roleName`
  - `weight`
  - `reason`
- Disabled high-impact buttons have read-only/permissions tooltip copy.
- `null` data path renders Ant Design `Empty` instead of a blank page.
- No Meeting SSE/WebSocket/API connection was introduced.

### Verification

Command:

```powershell
cd D:\workspace\PrismReview\apps\web
.\node_modules\.bin\tsc.CMD --noEmit --incremental false
```

Result: **pass, 0 errors**.

Browser verification against:

```text
http://localhost:3000/reviews/035e3bfc-5d41-4fcf-b6c5-607892106f57
```

Observed:

- `Confidence: 82%`
- `Recommended Committee`
- role codes: `CTO`, `CFO`, `PMO`, `Compliance`, `UserAdvocate`
- `Reason:` rows rendered
- no `Diagnosis Error` on success path
- browser warning/error logs: none

## Backend Review — Reasonix

### Passed

- UUID guards were added to Roles and Knowledge controllers.
- Reviews controller already has `ParseUUIDPipe` on `reviewId` params from the prior runtime fix.
- Invalid UUID paths now return 400 instead of Prisma 500.
- Valid UUID not found returns 404.
- No Prisma schema/table changes were introduced.
- No real RAG, embeddings, MinIO integration, or external model calls were introduced.
- README includes Windows direct binary startup guidance.

### Verification

Command:

```powershell
cd D:\workspace\PrismReview\apps\api
.\node_modules\.bin\tsc.CMD --noEmit --incremental false
```

Result: **pass, 0 errors**.

## Reviewer Fix Applied

### Issue

`scripts/smoke-runtime.js` reported `8/8 passed`, but skipped the diagnosis chain because `check()` did not return the result object. This meant the created review ID was lost and tests 7–9 never ran.

### Fix

Updated `check()` to return the result object and normalized success/failure symbols.

### Verified Smoke Result

Command:

```powershell
cd D:\workspace\PrismReview
node scripts\smoke-runtime.js
```

Result:

```text
11/11 passed, 0/11 failed
```

Covered endpoints:

- `GET /api/auth/me` → 200
- `GET /api/roles` → 200, 5 roles
- `GET /api/roles/not-a-uuid` → 400
- `GET /api/knowledge/documents/bad-id` → 400
- `PATCH /api/knowledge/chunks/bad/review-status` → 400
- `POST /api/reviews` → 201 with id
- `POST /api/reviews/{id}/diagnose` → 201
- `GET /api/reviews/{id}/diagnosis` → 200 with diagnosis
- `GET /api/roles?available_for_review={id}` → 200
- `GET /api/reviews/invalid-uuid/diagnosis` → 400
- `GET /api/reviews/{valid-missing-uuid}/diagnosis` → 404

## Remaining P1 Items

- Some script comments still contain mojibake from earlier encoding issues. Non-blocking, but should be cleaned later.
- Validation error `code` normalization is still imperfect for `ParseUUIDPipe`; keep as P1 unless frontend needs strict code matching.
- `NEXT_PUBLIC_API_BASE_URL` should be documented in `apps/web/.env.example` or root `.env.example` before demos beyond local machine.

## Decision

### Antigravity

- **Go** for Diagnosis polish completion.
- May proceed to prepare the next approved static page or small UI polish.
- Do **not** connect Meeting SSE/WebSocket yet.
- Do **not** enable role selection write flow yet.

### Reasonix

- **Go** for runtime hardening completion.
- Keep supporting runtime issues only.
- No new API surface, schema changes, RAG/Embedding/MinIO/model integration without a new gate.

## Next Gate Required Before

Return for review before starting any of:

- Meeting SSE/WebSocket integration;
- role selection submit flow from frontend;
- report page API integration;
- real RAG/vector retrieval work;
- global error-code normalization if it changes response contract.
