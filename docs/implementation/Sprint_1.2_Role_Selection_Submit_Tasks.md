# Sprint 1.2 — Role Selection Submit Flow Tasks

Date: 2026-07-07
Owner: Codex coordination
Status: Ready for antigravity + reasonix execution

## Goal

Connect the first real product flow after Diagnosis:

```text
DiagnosisPage
  → save recommended committee
  → start review session
  → navigate to static MeetingPage
```

This sprint enables the user to confirm the recommended AI committee. It does **not** enable live Meeting streaming.

## Scope Boundary

### Approved

- Frontend calls existing backend endpoints:
  - `POST /api/reviews/{reviewId}/roles`
  - `POST /api/reviews/{reviewId}/start`
  - optional `GET /api/roles?available_for_review={reviewId}` for display-only available role list
- Diagnosis page enables `Confirm Committee` only when diagnosis data has recommended roles.
- On success, navigate to:

  ```text
  /reviews/{reviewId}/meeting
  ```

- Meeting page remains static mock after navigation.
- Backend may add DTO validation and smoke coverage for the existing endpoints.

### Not Approved

- No Meeting SSE/WebSocket.
- No Agent turn execution.
- No real RAG/Embedding/MinIO/model calls.
- No Prisma schema/table changes.
- No custom role creation UI.
- No drag/drop committee editor.
- No Jira/PDF/Markdown/export work.
- No Report API integration.

## Current Backend APIs

### Save Role Selection

```http
POST /api/reviews/{reviewId}/roles
Content-Type: application/json

{
  "roles": [
    { "roleId": "uuid", "weight": 30 },
    { "roleId": "uuid", "weight": 20 }
  ]
}
```

Expected response:

```json
{
  "roles": [
    {
      "roleId": "uuid",
      "roleCode": "CTO",
      "roleName": "技术审核员",
      "weight": 30,
      "removable": false
    }
  ]
}
```

### Start Review

```http
POST /api/reviews/{reviewId}/start
```

Expected response:

```json
{
  "sessionId": "session-{reviewId}",
  "status": "running"
}
```

## Antigravity Tasks

### A1. Extend API Client

File:

```text
apps/web/src/lib/api-client/client.ts
```

Add typed methods:

```ts
saveRoleSelection(reviewId: string, roles: RoleSelectionInput[]): Promise<RoleSelectionResponse>
startReview(reviewId: string): Promise<StartReviewResponse>
```

Required types:

```ts
export interface RoleSelectionInput {
  roleId: string;
  weight: number;
}

export interface SelectedRole {
  roleId: string;
  roleCode: string;
  roleName: string;
  weight: number;
  removable: boolean;
}

export interface RoleSelectionResponse {
  roles: SelectedRole[];
}

export interface StartReviewResponse {
  sessionId: string;
  status: 'running';
}
```

Acceptance:

- Uses `NEXT_PUBLIC_API_BASE_URL` fallback already established.
- Uses same mock bearer header as current local API calls.
- Does not add global snake_case/camelCase conversion.

### A2. Enable Confirm Committee Flow

File:

```text
apps/web/src/features/diagnosis/DiagnosisPage.tsx
```

Behavior:

1. Keep `Cancel` disabled.
2. Enable `Confirm Committee` only when:
   - diagnosis data is loaded;
   - `recommendedRoles.length > 0`;
   - not currently submitting.
3. On click:
   - POST recommended roles as `{ roleId, weight }[]` to `/roles`;
   - then POST `/start`;
   - then navigate to `/reviews/{reviewId}/meeting`.
4. While submitting:
   - show button loading state;
   - disable `+ Add Role`;
   - show success/error message using AntD `message` or `Alert`.

Acceptance:

- Success path navigates to static Meeting page.
- Failed save/start keeps user on Diagnosis page and shows error.
- No Meeting SSE/WebSocket is added.
- `+ Add Role` remains disabled; do not implement role editor yet.

### A3. UI Copy

Required button states:

- Before diagnosis loaded: disabled.
- After diagnosis loaded: `Confirm Committee` enabled.
- During submit: loading text such as `Starting Review...`.
- After failure: visible error message.

Required guard copy:

- `+ Add Role`: tooltip says `Role editing is not available in this sprint.`
- `Cancel`: tooltip says `Cancel flow is not available in this sprint.`

### A4. Frontend Verification

Run:

```powershell
cd D:\workspace\PrismReview\apps\web
.\node_modules\.bin\tsc.CMD --noEmit --incremental false
```

Runtime verification:

1. Use `node setup-test-review.js` to create a diagnosed review.
2. Open `http://localhost:3000/reviews/{reviewId}`.
3. Click `Confirm Committee`.
4. Confirm navigation to `http://localhost:3000/reviews/{reviewId}/meeting`.
5. Confirm no console errors.

Evidence to return:

- typecheck result;
- reviewId tested;
- final URL after click;
- any console/network errors.

## Reasonix Tasks

### R1. Add DTO Validation for Role Selection

Add DTO file if absent:

```text
apps/api/src/modules/reviews/dto/save-role-selection.dto.ts
```

Suggested DTO:

```ts
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsUUID, Max, Min, ValidateNested, ArrayMinSize } from 'class-validator';

export class RoleSelectionItemDto {
  @IsUUID('4')
  roleId: string;

  @IsInt()
  @Min(0)
  @Max(100)
  weight: number;
}

export class SaveRoleSelectionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RoleSelectionItemDto)
  roles: RoleSelectionItemDto[];
}
```

Wire it in:

```text
apps/api/src/modules/reviews/reviews.controller.ts
```

Acceptance:

- Invalid role ID format returns 400 before Prisma.
- Empty roles array returns 400.
- Weight outside 0–100 returns 400.
- Valid payload still works.

### R2. Preserve Existing State Guards

Required behavior:

- Save roles allowed only in `ready` state.
- Start allowed only in `ready` state with role selection present.
- Start changes review status to `running`.
- Re-saving roles after `running` should fail with 400.

Do not change status model or schema.

### R3. Extend Runtime Smoke Script

File:

```text
scripts/smoke-runtime.js
```

Add or verify tests for:

1. Create review.
2. Diagnose review.
3. Get diagnosis and extract `recommendedRoles`.
4. Save role selection with `{ roleId, weight }[]`.
5. Call `GET /api/roles?available_for_review={reviewId}` and verify selected roles are excluded or count decreases.
6. Start review.
7. Verify second `POST /roles` after start returns 400.
8. Verify `POST /start` on a fresh diagnosed review without role selection returns 400.

Acceptance:

- Smoke script must not skip tests when intermediate data is missing.
- It must fail loudly if `reviewId`, `recommendedRoles`, or selected role IDs are absent.
- Expected result should be at least existing 11 tests + new role selection/start tests.

### R4. Backend Verification

Run:

```powershell
cd D:\workspace\PrismReview\apps\api
.\node_modules\.bin\tsc.CMD --noEmit --incremental false
```

Run smoke:

```powershell
cd D:\workspace\PrismReview
node scripts\smoke-runtime.js
```

Evidence to return:

- typecheck result;
- smoke output;
- whether selected roles are excluded by `available_for_review`;
- status returned by `/start`.

## Joint Acceptance Criteria

This sprint passes only if all are true:

- User can create/diagnose a review with existing setup script.
- Diagnosis page renders recommended roles.
- `Confirm Committee` saves the recommended roles.
- Review starts and status becomes `running`.
- Browser navigates to static Meeting page.
- Meeting page remains static; no SSE/WebSocket/network streaming.
- Invalid role payloads return 400, not 500.
- Typecheck passes on both web and api.
- Runtime smoke covers save-role + start-review path.

## Gate Review Required

Return to Codex for **Sprint 1.2 Role Selection Submit Review** before doing any of:

- Meeting SSE/WebSocket;
- Agent turn execution;
- Report API integration;
- export/Jira integration;
- real RAG/Embedding/vector retrieval;
- schema changes.
