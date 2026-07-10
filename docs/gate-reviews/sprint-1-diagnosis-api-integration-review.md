# Sprint 1 Diagnosis API Integration Gate Review

Date: 2026-07-07
Reviewer: Codex
Scope: Antigravity frontend P0 fixes + DiagnosisPage real REST adapter + Reasonix pgvector deviation note

## Gate Result

**No-Go for frontend handoff / Conditional Go after P0 fix**

Backend remains **Go**. Diagnosis API response shape matches the frontend adapter expectation.

Frontend is **not yet Go** because `apps/web` typecheck currently fails: `@ant-design/icons` is declared in `apps/web/package.json` but is not installed/resolvable in `node_modules`.

## Verification Performed

Command run from `D:\workspace\PrismReview\apps\web`:

```powershell
npx.cmd tsc --noEmit --incremental false
```

Observed result:

```text
src/features/meeting/components/ContextPanel.tsx(3,30): error TS2307: Cannot find module '@ant-design/icons' or its corresponding type declarations.
src/features/meeting/components/MeetingHeader.tsx(4,71): error TS2307: Cannot find module '@ant-design/icons' or its corresponding type declarations.
src/features/meeting/components/SpeechCard.tsx(3,42): error TS2307: Cannot find module '@ant-design/icons' or its corresponding type declarations.
```

Dependency path checks:

- `D:\workspace\PrismReview\node_modules\@ant-design\icons` — missing
- `D:\workspace\PrismReview\apps\web\node_modules\@ant-design\icons` — missing

## Backend Findings

### Passed

- `GET /api/reviews/{reviewId}/diagnosis` returns the expected bare diagnosis JSON shape:
  - `summary`
  - `tags`
  - `radarDimensions`
  - `confidenceScore`
  - `recommendedRoles`
- Reasonix documented the pgvector local-Docker deviation in `docs/sprint-0-kickoff.md §4.5`.
- `docker-compose.yml` contains a visible comment pointing to the pgvector recovery plan.
- Scope guard is intact: no real RAG, embeddings, MinIO, or external model integration started.

## Frontend Findings

### Passed

- Meeting route import path was changed to `../../../../features/meeting/MeetingPage`.
- `@ant-design/pro-components` import was removed from `MeetingHeader.tsx`.
- DiagnosisPage now calls `http://localhost:4000/api/reviews/{reviewId}/diagnosis`.
- Meeting Page still has no SSE/WebSocket/fetch/axios integration.

### P0 Blocker

- `@ant-design/icons` is not actually installed/resolvable despite being added to `apps/web/package.json`.
- Until this is fixed, `apps/web` cannot pass TypeScript verification.

### P1 Cleanup

- `apps/web/src/features/meeting/MeetingPage.tsx` still contains mojibake in mock role names. TypeScript may parse it, but this contradicts the reported “pure English placeholders” fix and should be cleaned before UI review.
- `apps/web/src/features/meeting/MeetingPage.tsx` imports `Layout` from `antd` but does not use it.
- Meeting controls remain enabled (`Start`, `Interrupt`, `Force End`, `Inject Condition`). Per prior frontend policy, high-impact controls should default to disabled/read-only until permissions and real actions are connected.
- `ContextPanel` renders `Inject Condition`, but does not expose an `onInject` callback, so the modal cannot be opened from the button.

## Required Fixes

### Antigravity

1. Install dependencies at the correct workspace level using the project package manager:

   ```powershell
   cd D:\workspace\PrismReview
   pnpm install
   ```

   If using npm instead, ensure the installed `node_modules` layout actually resolves from `apps/web`.

2. Re-run:

   ```powershell
   cd D:\workspace\PrismReview\apps\web
   npx.cmd tsc --noEmit --incremental false
   ```

3. Clean Meeting mock strings to stable English/UTF-8 and remove unused `Layout` import.
4. Disable high-impact Meeting controls until permissions/action APIs are wired.

### Reasonix

- No backend action required for this gate.
- Continue standing by for Diagnosis API shape/CORS fixes if frontend runtime test reveals them.

## Next Gate Criteria

Return for review with:

- successful `apps/web` typecheck output;
- evidence `@ant-design/icons` resolves from the workspace;
- cleaned Meeting mock strings;
- screenshot or browser check of DiagnosisPage against a diagnosed review ID;
- if runtime fails, exact browser console/network error.
