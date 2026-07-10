# Sprint 1 Smoke & Meeting Scaffold Gate Review

Date: 2026-07-07
Reviewer: Codex
Scope: Backend smoke-test side effects + Antigravity Meeting Page static scaffold

## Gate Result

**Conditional Go**

- Backend/API smoke gate: **Go** for DiagnosisPage real API adapter.
- Frontend Meeting static scaffold: **No-Go until P0 compile blockers are fixed**.
- pgvector removal: **Accepted as temporary MVP deviation**, must be documented and restored before real RAG/embedding work.

## Backend Review

### Passed

- Prisma schema remains at **14 models**: `Tenant`, `Department`, `User`, `AgentRole`, `AgentRoleVersion`, `KnowledgeDocument`, `KnowledgeChunk`, `Review`, `ReviewTurn`, `ReviewOpinion`, `Report`, `ActionItem`, `AuditLog`, `BusinessEvent`.
- Seed now creates mock tenant + mock user matching `JwtAuthGuard` IDs:
  - `00000000-0000-0000-0000-000000000001`
- Smoke report is plausible and consistent with current Sprint 1 mock scope:
  - Auth, Role, Review Draft, Diagnosis mock, SSE diagnosis stream, Knowledge mock upload/search.
- No new table was introduced during smoke-test repair.

### Accepted Temporary Deviation

- `data/postgres/init` is empty and pgvector init SQL was removed because `postgres:16-alpine` does not provide the vector extension.
- This is acceptable for Sprint 1 because Knowledge search is mock/LIKE-based and no embedding retrieval is in scope.
- This must not be interpreted as deleting the RAG roadmap. Before AI/RAG Spike resumes, choose one:
  - switch Postgres image to a pgvector-enabled image; or
  - install/enable pgvector in the DB container; or
  - document local-only fallback and keep production architecture on pgvector.

### P1 Cleanup

- `apps/api/src/common/guards/jwt-auth.guard.ts` contains mojibake comments. Logic is correct, but comments should be rewritten in UTF-8 English/Chinese during the next backend cleanup.
- `apps/api/prisma/seed.ts` also has mojibake in one console log. Non-blocking.

## Frontend Meeting Review

### Passed

- Meeting Page is static mock only: no `EventSource`, `WebSocket`, `fetch`, or `axios` integration was added.
- Three-column structure matches the design direction: Agent Panel / Speech Flow / Context Panel.
- Speech card folding is acceptable as a static degradation.

### P0 Blockers

1. **Broken import path in Meeting route**

   File: `apps/web/src/app/reviews/[reviewId]/meeting/page.tsx`

   Current import:

   ```ts
   import MeetingPage from '../../../features/meeting/MeetingPage';
   ```

   From `app/reviews/[reviewId]/meeting/page.tsx`, this resolves incorrectly under `app/`. Use either:

   ```ts
   import MeetingPage from '@/features/meeting/MeetingPage';
   ```

   if `baseUrl`/alias is configured, or:

   ```ts
   import MeetingPage from '../../../../features/meeting/MeetingPage';
   ```

2. **Syntax-breaking mojibake string**

   File: `apps/web/src/features/meeting/MeetingPage.tsx`

   The third `mockAgents` item has an unterminated/broken string around `roleName`, which will fail TypeScript/Next compile. Replace mock Chinese strings with stable UTF-8 text or English labels. Recommended role codes:

   - `CTO`
   - `Compliance`
   - `PMO`

### P1 Issues

- `MeetingHeader.tsx` imports `PageHeader` from `@ant-design/pro-components`, but `apps/web/package.json` does not include `@ant-design/pro-components`, and `PageHeader` is unused. Remove the import instead of adding a dependency.
- `MeetingPage.tsx` imports `Layout` from `antd`, but it is unused. Remove it.
- `ContextPanel` has an `Inject Condition` button but does not receive or call an `onInject` handler, so the modal is never opened. Either wire it or disable the button for the current static scaffold.
- High-impact controls (`Start`, `Interrupt`, `Force End`, `Inject Condition`) should default to disabled/read-only until real permissions are connected.

## Decision

### Reasonix

- **Go**: backend can proceed to support DiagnosisPage API integration.
- Do not start real RAG, pgvector, embeddings, MinIO, or real model integration in this step.
- Add a short note to the implementation docs that pgvector is temporarily disabled in local Docker for Sprint 1 mock mode.

### Antigravity

- **Fix P0 first** before any real API integration or Meeting expansion:
  1. fix Meeting route import path;
  2. replace broken mock strings;
  3. remove missing/unused `@ant-design/pro-components` import.
- After the frontend compiles, proceed with **DiagnosisPage real REST adapter only**.
- Do not connect Meeting SSE/WebSocket yet.

## Next Gate

Return for review after Antigravity provides:

- `apps/web` typecheck/build result;
- fixed Meeting route + mock data;
- DiagnosisPage REST adapter diff;
- evidence that failed/forbidden/loading states still render.
