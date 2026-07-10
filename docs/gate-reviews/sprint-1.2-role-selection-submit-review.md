# Sprint 1.2 Role Selection Submit Review

Date: 2026-07-07
Reviewer: Codex
Scope: Diagnosis → save role selection → start review → navigate to static Meeting page

## Gate Result

**Go**

Sprint 1.2 is accepted. The core submit flow works end to end, and Meeting remains static.

## Backend Review

### Files Reviewed

- `apps/api/src/modules/reviews/dto/save-role-selection.dto.ts`
- `apps/api/src/modules/reviews/reviews.controller.ts`
- `scripts/smoke-runtime.js`

### Passed

- `SaveRoleSelectionDto` validates:
  - `roles` is an array;
  - `roles` has at least one item;
  - `roleId` is UUID v4;
  - `weight` is integer 0–100;
  - nested role items are validated.
- `POST /api/reviews/{reviewId}/roles` uses `SaveRoleSelectionDto`.
- Review ID params are guarded by `ParseUUIDPipe`.
- Existing state guards are preserved:
  - save roles only in `ready`;
  - start only in `ready` with role selection;
  - start transitions to `running`;
  - running review rejects role save.
- No Prisma schema changes.
- No Report API, RAG, Embedding, MinIO, external model, Agent turn, or Meeting stream work.

### Verification

Command:

```powershell
cd D:\workspace\PrismReview\apps\api
.\node_modules\.bin\tsc.CMD --noEmit --incremental false
```

Result: **0 errors**.

Smoke command:

```powershell
cd D:\workspace\PrismReview
node scripts\smoke-runtime.js
```

Result:

```text
17/17 passed, 0/17 failed
```

Smoke covers:

- create review;
- diagnose review;
- get diagnosis with recommended roles;
- save role selection;
- available roles exclude saved roles;
- start review;
- running review rejects role save;
- start without role selection returns 400;
- invalid UUID returns 400;
- valid missing UUID returns 404.

## Frontend Review

### Files Reviewed

- `apps/web/src/lib/api-client/client.ts`
- `apps/web/src/features/diagnosis/DiagnosisPage.tsx`
- `apps/web/src/features/meeting/**`

### Passed

- `apiClient` now has typed methods:
  - `saveRoleSelection(reviewId, roles)`;
  - `startReview(reviewId)`.
- `DiagnosisPage` enables `Confirm Committee` when recommended roles exist.
- Confirm flow performs:
  1. map `recommendedRoles` to `{ roleId, weight }[]`;
  2. save role selection;
  3. start review;
  4. route push to `/reviews/{reviewId}/meeting`.
- Submit loading state exists.
- Error path uses `message.error`.
- `Cancel` remains disabled.
- `+ Add Role` remains disabled.
- Meeting feature still has no `EventSource`, `WebSocket`, `fetch`, `axios`, `apiClient`, `/api/`, or `http://` usage.

### Verification

Command:

```powershell
cd D:\workspace\PrismReview\apps\web
.\node_modules\.bin\tsc.CMD --noEmit --incremental false
```

Result: **0 errors**.

Browser flow tested with review:

```text
1b2e062d-f8f8-43df-848c-4335a7a9054a
```

Before click:

```text
http://localhost:3000/reviews/1b2e062d-f8f8-43df-848c-4335a7a9054a
```

After clicking `Confirm Committee`:

```text
http://localhost:3000/reviews/1b2e062d-f8f8-43df-848c-4335a7a9054a/meeting
```

Backend review status after click:

```text
running
```

## P1 Findings

These do not block Sprint 1.2, but should be cleaned before broader demo polish:

1. Ant Design warning after click:

   ```text
   [antd: message] Static function can not consume context like dynamic theme. Please use 'App' component instead.
   ```

   Recommended fix later: wrap app with AntD `App` provider and use `App.useApp()` message API.

2. Ant Design deprecation warning in Meeting components:

   ```text
   [antd: Card] `bodyStyle` is deprecated. Please use `styles.body` instead.
   ```

3. Root dashboard route `/` returned 500 during one local probe. Sprint 1.2 target routes `/reviews/{id}` and `/reviews/{id}/meeting` both returned 200 and the flow passed. Track dashboard 500 separately if it reproduces.

## Decision

### Antigravity

- **Go** for Role Selection Submit UI.
- Do not proceed to Meeting SSE/WebSocket without a new gate.
- Do not build role editor yet.
- Do not enable Report API/export/Jira.

### Reasonix

- **Go** for backend submit contract.
- Keep smoke-runtime coverage.
- No new API/schema/RAG/Embedding/MinIO/model work without a new gate.

## Next Recommended Step

Before live Meeting, create a **Meeting Event Contract + Mock Stream Plan**. Reasonix should define event protocol first; Antigravity should not connect UI until the contract is reviewed.

## Next Gate Required Before

Return for review before starting any of:

- Meeting SSE/WebSocket integration;
- Agent turn execution;
- custom role editor;
- Report API integration;
- PDF/Markdown export;
- Jira sync;
- real RAG/vector retrieval.
